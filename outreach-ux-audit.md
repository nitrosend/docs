# Outreach Frontend: UX & Design Audit

Status: audit findings, not yet actioned. Companion to `linkedin-search-adapter-handoff.md`.
Date: 2026-07-06.
Scope: `app/src/views/my/outreach/*`, `app/src/components/my/outreach/*`, `app/src/stores/my/outreach.js`, `app/src/composables/{useLiveResource,useLiveList}.js`, `ProgressFunnel.vue`, `DataTable` wiring.
Bar: Attio/Linear calibre. Every finding cites file:line. All source files were read end-to-end (both large views in full).

The single worst pattern found: **failed loads are indistinguishable from empty results across the entire area** (H1). For a lead-gen tool, that means a backend outage looks identical to "you have no leads." Fix that first.

---

## Ranked findings

### HIGH

**H1. Failed loads masquerade as empty states — everywhere.**
No outreach store action catches read errors, and no view renders an error state for list loads.
- `app/src/stores/my/outreach.js:51-105` — `fetchSearches`/`fetchSequences`/`fetchReplies` have `finally` but no `catch`; loading flips false and the rejection escapes.
- `app/src/views/my/outreach/OutreachSearchesView.vue:20-22` — `onMounted(() => outreachStore.fetchSearches())` unhandled; a 500 shows "No searches yet" with a cheerful CTA.
- `app/src/composables/useLiveList.js:43-45` — "Swallow: a transient fetch failure should not break the live loop" — a *persistent* failure means Sequences/Replies show "No active sequences yet" / "No replies yet" forever, silently.
- `app/src/views/my/outreach/OutreachSearchDetailView.vue:94-105` — destructures only `{ resource, restart }` from `useLiveResource`; the composable's `timedOut` signal (`useLiveResource.js:139,127-131`) is computed and thrown away. Detail-view fetch failures render the "No ready leads yet" empty state.

Operator pain: the worst possible failure mode for a lead-gen tool — data loss indistinguishable from "you have nothing."
Fix: store-level `error` refs per collection, an inline alert-with-retry component on all four surfaces, and consume `timedOut` on the detail view ("This search stopped updating — Retry").

**H2. Refetch races on the leads grid: three uncoordinated triggers, no request sequencing.**
`fetchSearch` (`outreach.js:129-168`) has no sequence token or in-flight guard, so last-*resolved* response wins, not last-issued. Concurrent triggers:
- landed_count watcher: `OutreachSearchDetailView.vue:297-310`
- per-lead cable broadcast refetch: `:311-317` (`cable.onEntityType("lead", …)` — fires per lead landing, no debounce; a batch of 25 leads = 25 refetches)
- `useLiveResource` 3s poll: `useLiveResource.js:118-125`
- user pagination: `:470-477`

Concrete bug: operator clicks page 2 → `onPageChange` fetches page 2; a landing lead fires the watcher which refetches at `outreachStore.leadsPagination.page` (still 1 until page 2's response header lands, `outreach.js:156-157`) → page-1 response can resolve last and snap the operator back to page 1 with selection already cleared. Same race makes rows visibly jump mid-review.
Fix: a monotonically increasing request id in `fetchSearch` that discards stale responses; debounce the cable storm (~500ms trailing); suppress the landed_count refetch while a user-initiated fetch is in flight.

**H3. Reply → "Open in leads" navigates to an empty view.**
`OutreachReplyInspector.vue:86-94` builds `{ query: { f: sequence_state=stopped } }` but never sets `bucket`, so the detail view opens on the default `ready` bucket (`OutreachSearchDetailView.vue:68-72`) intersected with the `stopped` facet — near-guaranteed zero rows. The parallel drill-down in `OutreachSequencesView.vue:74-88` explicitly sets `bucket: statKey === "active" ? "in_sequence" : "all"`, confirming the intersection semantics.
Operator pain: the single deep-link out of reply triage dead-ends on "No leads match 'Stopped'".
Fix: add `bucket: "all"` to `leadGridTo`.

**H4. The NL parse silently drops chips it can't map — the operator can't see intent loss.**
`outreachIcp.js:82-93` — `constrain()` filters seniorities/employee_ranges/email_statuses to closed vocab and discards the rest with no return channel; `icpFromRaw` likewise drops unknown keys. The only feedback is `OutreachSearchNewView.vue:99-103`, a toast fired *only when the entire parse is empty*. Prompt "50-200 person companies" → an off-band range is dropped, the search silently broadens, and the estimate (honest to the chips) confirms a search the operator didn't ask for.
Fix: have `icpFromRaw` return `{ icp, dropped }` and render a quiet inline notice under the chips: "Couldn't map: '50-200 employees' — pick a company size below."

**H5. Estimate: zero/null states give no why or how-to-broaden, errors are invisible, and the debounce feels dead.**
- `OutreachSearchNewView.vue:196-203` — `0 matches` renders with no guidance (which chip over-constrained? try removing X); `estimateCount == null` renders "No estimate yet", which is also the *error* state because `runEstimate` (`:72-75`) swallows failures into `null` — a provider outage reads as an ambiguous shrug, and the confirm modal shows "—" (`:355-357`).
- `:49` — `ESTIMATE_DEBOUNCE_MS = 2200` plus request time means ~3s of "Counting matches…" after every keystroke in a chip; Attio-calibre is 400-600ms debounce with the previous number held (dimmed as stale) instead of a spinner takeover.
Fix: separate `estimateError` state with retry; on 0, list the narrowest chips ("Removing 'fintech' would match ~4.2k"); shorten debounce and keep the last count visible while re-counting.

**H6. Activation preview stage can skeleton forever with no error.**
`OutreachActivationView.vue:592-593` — `buildActivationPlan` early-returns when `!canBuildPlan.value` (gate not approved / zero eligible / preview still loading), setting neither `activationPlan` nor `planError`. The template branch `:1081-1090` (`v-else-if="planning || !activationPlan"`) then shows "Building the personalized preview" indefinitely. Reachable via URL hydration into `stage=preview` after eligibility drained, or when the `plan` query param fetch fails (`:198-201` catch → silent null). Related: `previewError` is rendered *only* inside the audience stage (`:885-889`); if `fetchActivationReasons` fails while on the Sequence stage, `gate.approved` stays false and "Use this sequence" is just disabled with no explanation anywhere.
Fix: when `canBuildPlan` is false on preview entry, set a human `planError` naming the failed precondition; render `previewError` in every stage (the footer already has a `panel__error` slot, `:1147-1149`, but only for `planError`).

**H7. The readiness breakdown names exactly the wrong leads "Lead #123".**
`OutreachActivationView.vue:376-389` — `leadById` is built from `outreachStore.leads`, which `loadWorkspace` (`:220`) loads as `bucket: "ready", page: 1` (25 rows). The held/blocked/missing-email leads in the reason drill-down (`:935-939`) are by definition *not* in the ready bucket, so the expansion the operator opens to understand "who is held and why" lists anonymous ids. Also `:936` truncates at `slice(0, 20)` with no "+N more".
Fix: have `activation_preview` return `{lead_id, name, email}` per reason row instead of bare ids; add the remainder count.

### MEDIUM

**M1. Bucket/facet switch shows the previous bucket's rows with zero loading feedback.** `outreach.js:143` — `showSkeleton = this.leads.length === 0`; switching Ready→Review keeps Ready's rows rendered under the active Review tab until the response lands, with `leadsLoading` false. Fix: distinguish "streaming refresh" (no skeleton) from "context change" (skeleton or row-dim + spinner) — pass an explicit flag from the bucket/facet watcher (`OutreachSearchDetailView.vue:111-122`).

**M2. Cross-search stale bleed.** Store `search`/`leads` are never reset on id change; `useLiveResource.startTracking` nulls its own `resource` (`useLiveResource.js:110`) but the view falls back to the store (`OutreachSearchDetailView.vue:107` — `liveSearch.value || outreachStore.search`). Navigating Search A → Search B flashes A's name, ICP summary, inventory numbers, and lead rows on B's page. Fix: reset `search`/`leads`/`leadsPagination` in the searchId watcher, or key the fallback on id match.

**M3. Searches index filter/counters lie beyond page one.** `outreach.js:45-48` filters client-side over `state.searches` — one server page of 25 (`fetchSearches`, `:51-66`) — while pagination is server-side; `OutreachSearchesView.vue:26-56` computes status counts from that same page. Filtering "Failed" shows failed searches *from the current page only*, with pagination controls still counting the unfiltered total. Persisted `pagination`+`filters` (`outreach.js:331-333`) restore a possibly-empty stale page across sessions. Fix: pass `status` to the server and take counts from a summary endpoint or headers.

**M4. Bulk actions are capped at one page.** `onPageChange` clears selection (`OutreachSearchDetailView.vue:470-477`, deliberate given H2), and "Select visible ready" (`:462-466`) is page-scoped. Holding/stopping/starting 500 ready leads means 20 page-by-page repetitions. Fix: a "Select all N ready in this search" affordance backed by server-side scope (the activation path already supports whole-search scope — `scopedLeadIds` null in `OutreachActivationView.vue:37-39`; hold/stop need a `lead_search_id` scope param, which `stopActivations` already accepts, `outreach.js:272-279`).

**M5. Inspector goes blank if the inspected lead streams off the page.** `OutreachSearchDetailView.vue:482-497` — `showLeadInspector` keys on `inspectedLeadId != null` but `inspectedLead` resolves to `null` when a refetch drops the row; the SlideOver stays open with an empty title and body (`OutreachLeadInspector.vue:289,329` are `v-if="lead"`). Fix: snapshot the lead when opened and overlay live updates, or auto-close with a toast ("Lead moved out of this view").

**M6. "Skipped N candidates" explains why, never what to do — and it's the only reveal metric surfaced.** `OutreachSearchDetailView.vue:262-268` renders one info line from `revealMetric("unrevealable")` (`:188-190`); the gap between "checked" and "saved" in the inventory strip (`:151-174`) is otherwise unexplained (verification failures? dedupe? qualification rejects?). Operator pain: no lever — should they broaden the ICP, add a verifier, or accept the yield? Fix: an expandable yield breakdown (checked → revealed → verified → qualified → saved, with per-stage deltas) and one action per dominant loss ("Most losses are unverified emails — connect a verifier").

**M7. Two tab systems and vanishing section chrome.** The index uses `FilterPills variant="tab"` (`OutreachSearchesView.vue:104-110`); the detail invents `bucket-tab` card-tabs (`OutreachSearchDetailView.vue:919-932`, styles `:1109-1127`). Meanwhile `OutreachNav.vue:12-18` declares `my-outreach-detail`/`my-outreach-activate`/`my-outreach-new` as belonging to the Searches tab, but none of those three views render `OutreachNav` — the Searches/Sequences/Replies bar disappears the moment you drill in, so hopping from a search to Replies requires breadcrumb-then-tab. Fix: render OutreachNav on all outreach surfaces; keep the detail bucket cards (they carry counts+captions well) but align their active treatment with the app token set.

**M8. Export scope is silently "whole search" while filters/selection are active.** `OutreachSearchDetailView.vue:536-539` deliberately ignores facets/selection; the visible button says only "Export" (`:884-891`) — the "Whole search as CSV" disclosure lives only in the Cmd+K sublabel (`:831`). Fix: label the button "Export all N" or add the scope note to its tooltip.

**M9. Keyboard support stops at the drawer, and Replies has none.** `anyOverlayOpen` (`OutreachSearchDetailView.vue:560,712`) kills j/k when the inspector is open, and `OutreachLeadInspector.vue` binds no keys to prev/next — the whole point of a record cursor (step-step-step triage) demands ArrowUp/Down or j/k inside the panel. `OutreachRepliesView.vue` has no keyboard layer at all despite an identical cursor pattern. There is also no visible shortcut legend anywhere (the key map exists only in an `aria-label`, `:1002`). Fix: handle j/k/e/h inside the inspector (emit prev/next), mirror the layer in Replies, add a small "? shortcuts" hint.

**M10. Search-creation errors swallow the server's message.** `OutreachSearchNewView.vue:189-190` and `:104-105` catch without reading `e.response.data.message` — a quota/billing rejection ("Lead sourcing requires the Growth plan") flattens to "Couldn't start the search. Try again." The activation view already has the right helper (`apiErrorMessage`, `OutreachActivationView.vue:808-818`) — extract it to a util and use it in all outreach catches (also `OutreachSearchDetailView.vue:285-287` etc., which at least read `.message`).

**M11. Activation click count and forced re-confirmation.** Approved-sequence path: Confirm audience → pick in combobox → "Use this sequence" → "Continue to approval" → "Approve plan" → "Start outreach" — 6 clicks (`OutreachActivationView.vue:85-160,741-806`). When the operator arrives from an explicit "Start ready leads" selection they still start at an Audience stage restating what they just chose. Approve-then-start is two clicks on one screen with no new information between them. Fix: when `lead_ids` are in the launch query, collapse Audience into a confirmation strip on the Sequence stage; merge Approve+Start into one "Approve and start N leads" primary (the checklist is the approval surface; a second click adds ceremony, not safety).

### LOW

**L1. Sequence card unit mix.** `OutreachSequencesView.vue:168-171` — "Sent" is `metrics.messages.sent` (message count) in a row of lead counts (Active/Replied/Stopped); "Replied" drills to the *stopped* cohort (`:66-72`), which includes manual stops. Add "msgs" to the Sent label; facet replies distinctly when the backend can.

**L2. Token drift.** `OutreachSearchNewView.vue:391-402` — hardcoded `rgba(255,77,0,…)` brand shadows and a light-mode-tuned focus glow (near-invisible on dark surfaces); `:417` `text-[0.6875rem]` magic size; `:255-261` `bg-green-500` estimate dot vs `bg-emerald-500` dots in `OutreachActivationView.vue:1285-1293`. FontAwesome (`fa-icon fa-regular fa-check/…`) in the stepper (`OutreachActivationView.vue:857`) and timeline (`OutreachSequenceTimeline.vue:39-47`) vs Heroicons everywhere else in these views.

**L3. ARIA misuse.** `OutreachSearchDetailView.vue:998-1004` — `role="grid"` on a focusable wrapper div containing a table is not a grid pattern (no gridcell/row semantics, no aria-activedescendant for the cursor); bucket tabs (`:919`) aren't a `tablist`/`aria-selected` set.

**L4. Stale default search name.** `OutreachSearchNewView.vue:160-165` — the confirm modal's name defaults from the summary only when blank; edit the ICP, reopen, and the old name for the old ICP persists.

**L5. Reply "Converted" state is session-local.** `OutreachReplyInspector.vue:42-49` — converted ids live in a component Set; a refetch/pagination loses the badge unless the projection carries `converted_at`. The `@converted` emit is unbound in `OutreachRepliesView.vue:181-191`.

---

## New-direction readiness (company-first LinkedIn provider)

These four are where the LinkedIn company-first pipeline (`linkedin-search-adapter-handoff.md`) will actively make the current UX confusing:

1. **Estimate model breaks.** The estimate is a person-match count persisted as the pool (`OutreachSearchNewView.vue:176-186`, `outreach.js:111-122`). With ~70% of companies yielding nothing, "≈12k matches" vs 300 landed leads will read as a broken product. Needs calibrated language at creation ("provider matches; verified leads typically land far lower") and, ideally, a company-count estimate ("~800 companies match; expect leads from a fraction").
2. **The skip notice becomes the headline.** One flat `unrevealable` integer (`OutreachSearchDetailView.vue:188-268`) can't express "checked 40 companies, 28 yielded no contacts." The runtime-notice line needs a company-level breakdown, or it will read as the product failing rather than the market being thin.
3. **The review surface is person-row-only.** No company column grouping, no company facet (`outreachLeadFacets.js:33-57` — fit/deliverability/sequence_state only), and provider evidence in the inspector is a flat per-lead list (`OutreachLeadInspector.vue:517-561`) — company-level evidence will duplicate identically across every lead from that company with no rollup. A group-by-company view (or at minimum a company facet + shared-evidence header in the inspector) is prerequisite.
4. **Bursty batches amplify H2.** Per-company landings mean burst broadcasts; the undebounced per-lead cable refetch (`OutreachSearchDetailView.vue:311-317`) will thrash the grid hardest exactly when the new provider is working.

---

## Ideal flow sketches

**Search:** Type the ICP; chips materialize inline with anything unmappable flagged right there ("couldn't map: X"); the estimate updates within ~600ms, holding the previous number dimmed while recounting; a zero estimate names the narrowest chip and offers one-click broadening; Run opens a confirm that states the expected funnel honestly (matches ≠ leads) and any error comes back verbatim.

**Review:** Rows stream in without ever moving the row under the cursor or reverting the page; a yield strip explains checked → saved losses with one suggested action; the inspector opens as a snapshot, steps with j/k, and hold/stop/convert pulse the grid row; selection can scope "all N ready in this search," not just the visible 25.

**Activate:** Arriving with a selection, audience is a one-line confirmation, not a stage; pick or draft a sequence; the personalized preview builds automatically or says exactly why it can't; one "Approve and start N leads" click against the safety checklist; land back on the In-sequence bucket with the pulse.

**Replies:** Newest-first inbox with classification filter and j/k; each reply opens with the full lead context one keystroke away (a drill-in that actually resolves — H3); "Mark converted" persists visibly on the row; the "sequence already stopped" contract stays explicit.

---

## Already good — do not touch

- **Selection/cursor identity discipline**: selection and keyboard cursor keyed by id, independent of the `leads` array, so refetches don't clear them (`OutreachSearchDetailView.vue:293-296, 576-598`) — the right architecture; H2 is a store-sequencing gap, not a design flaw here.
- **`useLiveResource` terminal lock** (`useLiveResource.js:72-82`) — out-of-order poll responses can't regress a completed search.
- **URL as durable state**: facets in `f` (shareable, back-safe) and the activation stage/flow/plan hydration + back/forward-walking stage machine (`OutreachActivationView.vue:117-318`) is genuinely Linear-calibre plumbing.
- **The keyboard gating** (editable-target / Headless-UI-popover / modifier checks, `OutreachSearchDetailView.vue:562-573,709-744`) is careful and correct.
- **Two-step inline Stop confirm** (`OutreachLeadInspector.vue:64-96`) — right weight for the action.
- **"Why it is safe to send" checklist** (`OutreachActivationView.vue:650-682`) — the approve stage's honesty is a differentiator; keep it (just merge the two clicks after it).
- **Provenance chips ("from your words") with manual-edits-win merge** (`OutreachIcpChips.vue`, `OutreachSearchNewView.vue:112-129`) — the right trust model; it just needs the dropped-chip channel (H4).
- **Context-aware empty states on the detail grid** (`OutreachSearchDetailView.vue:377-424`) quoting the active filter — extend this pattern, don't replace it.
- **Skeleton-only-on-first-load** discipline in the store and the sample-count disclosure in `OutreachPersonalizedPreview.vue:62-73`; the quarantine notes in both inspectors; vendor-neutral badge vocabulary in `outreachIcp.js`.

---

## Suggested sequencing

1. **H1 first** (error states) — it is a correctness issue disguised as UX; ship an inline alert-with-retry component and wire all four surfaces + the detail `timedOut` signal.
2. **H2 + H3** — request sequencing in `fetchSearch` and the one-line reply deep-link fix; both are small and stop active operator confusion.
3. **H4 + H5** — parse-drop visibility and estimate honesty; these are prerequisites for the LinkedIn direction (new-direction readiness #1/#2 build directly on them).
4. **H6 + H7** — activation dead-ends and the mis-named readiness breakdown.
5. Medium batch, then the new-direction surfaces (company facet, yield breakdown, estimate calibration) alongside the LinkedIn adapter build.
