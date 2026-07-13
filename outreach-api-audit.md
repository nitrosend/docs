# Outreach API: Correctness, Data-Integrity & Good-Data-Suppression Audit

Status: audit findings, not yet actioned. Companion to `linkedin-search-adapter-handoff.md` and `outreach-ux-audit.md`.
Date: 2026-07-06. Auditor: direct read of the pipeline + downstream services on `main`.
Scope read end-to-end: `sourcing/run.rb`, `lead.rb`, `lead_search.rb`, `sourcing/run_job.rb`, `outreach/activator.rb`, `outreach/execution_guard.rb`, `outreach/send_policy.rb`, `outreach/activation_stopper.rb`, `outreach/inbound_reply_handler.rb`, `models/outreach/activation.rb`, `flow/executor.rb` (guard wiring), plus the earlier full map of the registry/provider/estimator layer.

**Headline:** the pipeline's *orchestration* is unusually disciplined — the reveal/verify invariant lives in one place, the sourcing run is idempotent under a row-lock claim, and the funnel counters read authoritatively off the Lead rows so they can't drift. The real risks are concentrated in **(1) two good-data-suppression filters that silently drop usable leads before they're ever revealed**, **(2) two narrow-but-real concurrency races on the downstream send/activation path**, and **(3) a cluster of new-direction frictions where the LinkedIn company-first shape breaks person-keyed assumptions.** None are catastrophic; several are one-liners.

---

## CRITICAL / HIGH

### H1 — `owned_by_identity?` suppresses good leads by name alone (suppression)
`api/app/services/sourcing/run.rb:469-475`
```ruby
def owned_by_identity?(candidate)
  first = candidate['first_name'].to_s.strip
  last  = candidate['last_name'].to_s.strip
  return false if first.blank? && last.blank?
  brand.contacts.where(first_name: first, last_name: last).exists?
end
```
This runs in `pre_reveal_dedupe` (run.rb:430) and drops a candidate **before any reveal** if the brand has *any contact with the same first+last name* — company is not considered (the comment admits "contacts carry no normalized company field to match on, so this is name-only").

Failure scenario: brand already has a contact "John Smith" (from an import, a newsletter signup, anyone). A search surfaces a *different* John Smith, founder of a target company. He is silently dropped, never revealed, never landed. For common names this is a meaningful false-positive rate; for the **LinkedIn founder direction it is worse** — founder searches return exactly the common-name population, and any brand with a sizeable contact list will shadow-drop a slice of every search.

Why it's bad: the drop is invisible (it doesn't even increment `unrevealable` — it's rejected as a dedupe, so it vanishes with no metric), and it's pre-reveal so there's no email to later reconcile.

Fix: require a company match too (fuzzy on `company`/`company_domain`), or demote this to a soft signal that still reveals but flags "possibly-owned," or drop it entirely and rely on the authoritative post-reveal `owned?` email check (which is exact and already exists, run.rb:496-500). At minimum, count these drops under a distinct metric so the suppression is visible.

### H2 — `dedupe_key` collapses distinct people who share a name+company or have blank names (suppression)
`api/app/services/sourcing/run.rb:460-463`
```ruby
def dedupe_key(candidate)
  [candidate['first_name'], candidate['last_name'], candidate['company']]
    .map { |v| v.to_s.strip.downcase }.join('|').presence
end
```
Two problems:
1. **Blank-name collapse.** If two different candidates from the same company both arrive with blank first+last (possible today from a thin provider row; **near-certain from the LinkedIn company-first path** where a company can yield a person whose name didn't split), the key is `"||acme inc"` for both → the second is dropped as a duplicate. `owned_by_identity?` guards the blank case but `dedupe_key` does not.
2. **Legitimate namesakes.** Two genuinely different people with the same name at the same company string (e.g. a father/son business, or a normalized company collision like "Smith Consulting") collapse to one reveal. Rare, but it's a silent single-person cap per name+company.

Fix: skip dedupe entirely when the name is blank (fall through to reveal, let the email dedupe decide), and prefer the provider `id` as the primary collapse key when present (it already is for the cross-run credit-saver at run.rb:423 — use it for intra-page collapse too, falling back to name+company only when `id` is absent).

### H3 — cross-source `external_id` pooling can drop a new person on an id collision (suppression / integrity)
`api/app/services/sourcing/run.rb:128, 423`
```ruby
sourced_ids = brand.leads.where.not(external_id: nil).pluck(:external_id).to_set
# ...
if candidate['id'].present? && sourced_ids.include?(candidate['id'])
  next true   # drop: "already revealed on a prior batch"
```
`external_id` is stored unqualified by source (Apollo person id, Prospeo id, and — per the LinkedIn plan — a person LinkedIn URL all land in the same `leads.external_id` column, and the index `index_leads_on_lead_search_id_and_external_id` is **not** unique and **not** source-scoped). The credit-saver set mixes all providers' id namespaces and matches on raw string equality.

Failure scenario: provider A's person id equals provider B's id for a *different* person (numeric ids especially). The new person is dropped pre-reveal as "already sourced." Probability is low today (Apollo hex vs Prospeo), but adding a third provider with URL/numeric ids raises it, and the failure is silent.

Fix: key the credit-saver on `(source, external_id)`, not `external_id` alone — both in the `sourced_ids` pluck and the candidate check. Consider a composite `external_ref` column or a `(source, external_id)` unique index scoped to brand.

### H4 — reply-stop vs. in-flight send is an unlocked TOCTOU window (race / integrity)
`api/app/services/flow/executor.rb:217-232` and `api/app/services/outreach/send_policy.rb:23-33`
Both the `ExecutionGuard` (executor.rb:220) and `SendPolicy` (send_policy.rb:24, `return ... unless activation.active?`) read `activation.active?` **without a lock**, while `ActivationStopper` flips the activation to `stopped` under `with_lock` (activation_stopper.rb:14). The reply path and the send path can interleave:

1. Scheduled next-step `ExecutorJob` runs, `ExecutionGuard` reads `active?` → true, proceeds.
2. Reply lands; `InboundReplyHandler` → `ActivationStopper` commits `status: :stopped` + `session.status = :sent`.
3. The already-running executor completes the SES send.

Result: a sequence email delivered **after** the prospect already replied — the exact failure outreach tooling must avoid. The window is one action-execution wide (guard-check → actual send), so it's narrow, but replies frequently arrive while a follow-up is queued, and there is no re-check under lock at the send boundary.

Fix: in `SendPolicy` (the last gate before send), re-read the activation `with_lock` and confirm `active?` inside the same transaction that records the send, or have the executor check `session.data["outreach_stopped"]` immediately before dispatch. The stopper already flips the session to `:sent`; the send path just needs to honor it at the last moment rather than at guard time.

### H5 — a lead can be double-activated into two different flows concurrently (race / integrity)
`api/app/services/outreach/activator.rb:56-71` + `api/app/models/outreach/activation.rb:47,119,155-160`
The DB has a unique index on `(lead_id, flow_id)` and a model validation `single_active_sequence_per_lead`, but **no unique constraint on `lead_id` alone across non-terminal activations**. The in-transaction guard `Outreach::Activation.lock.not_terminal.find_by(lead: lead)` (activator.rb:62) only locks a row that already exists — for a brand-new lead there is nothing to lock.

Failure scenario: two activation plans covering the same lead into two different flows are started at the same moment. Both transactions find no existing not-terminal activation, both pass the `(lead_id, flow_id)` unique index (different flow ids), both `create!`. The model validation can't see the other's uncommitted row. The lead is now in two live sequences and gets double-sent.

Fix: a partial unique index `CREATE UNIQUE INDEX ... ON outreach_activations (lead_id) WHERE status IN (0,1)` (pending/active), or take a Postgres advisory lock on `lead_id` at the top of `activate_lead` so the guard actually serializes new-lead activation.

---

## MEDIUM

### M1 — finder `:invalid` emails are dropped before verification (suppression, by-design but untunable)
`api/app/services/sourcing/run.rb:191-195`
```ruby
if Deliverability::Policy.should_drop?(finder_verdict)
  @metrics['dropped_invalid'] += 1
  next
end
```
A finder-`:invalid` verdict discards the email **without ever asking the verifier** (NeverBounce). Finders are not authoritative on deliverability; NeverBounce will sometimes pass an address a finder flagged invalid. This trades a small verify cost for silently losing real leads. It's a deliberate cost optimization, but it's hard-coded with no override, and it directly contradicts Jeff's LinkedIn learning that finder verdicts and real deliverability diverge (ContactOut work emails are explicitly "verify these," personal emails "never verify"). Fix: make the drop-before-verify a policy toggle, and ensure the LinkedIn/ContactOut reveal maps work emails to `:unknown` (not `:invalid`) so they always reach the verifier.

### M2 — Estimator `.max` + `pool_count` break on a company-first provider (new-direction / logic)
`api/app/services/sourcing/estimator.rb:16-19`, `api/app/services/sourcing/run.rb:117, 382-398`
`pool_count` is the MAX `total_entries` any provider reports, and `pool_exhausted?` gates on `next_page * per_page >= pool_count`. A LinkedIn company-first provider naturally reports a **company** count as `total_entries`, but the pool math is in **people**. With ~29% company→founder yield, a company pool of 800 becomes a person estimate of ~230, yet `.max` would surface 800 (or whatever Apollo also reports) and the exhaustion math would be person-paged against a company denominator — the search would either never latch exhausted or latch early. The UI then shows an inflated "N matches" that lands far lower (see `outreach-ux-audit.md` new-direction #1). Fix: the LinkedIn adapter must report `total_entries` as an *expected reachable person* count (company count × yield constant), or the estimate/pool contract must carry both numbers. Do not let a company count flow into person-paged math.

### M3 — quarantined execution Contacts may leak into billing/segments/audiences (integrity — verify)
`api/app/services/outreach/activator.rb:143-162`
Every activated lead spawns a real `Contact` row (`subscribed_email: false`, `source: "outreach"`, `execution_adapter: true`). `SendPolicy` enforces the quarantine contract *at send time* (send_policy.rb:110-114: not subscribed, no lists). But three leak vectors are unverified by this audit and must be checked:
1. **Billing/plan counters** — does the account's contact-count quota (`Plan::RESOURCES`) count these adapter contacts? If so, outreach silently inflates usage and can trip a cap.
2. **Segment/audience builder** — any segment query that doesn't filter on `subscribed_email` or list membership (e.g. "all contacts", or a filter on `first_name`/`company`) will include quarantined contacts, and a campaign sent to that segment would hit a prospect who never opted in.
3. **Contact search / export** — do they surface in the normal contacts UI and CSV export?
Fix: confirm each path excludes `data->outreach->execution_adapter = true` (or `source = "outreach"` + unsubscribed), and add a spec pinning the exclusion. This is the highest-value *verify* item in the audit.

### M4 — authorization scoping on outreach controllers not confirmed (authz — verify)
`api/app/controllers/api/v1/my/outreach/{leads,activations,activation_plans,replies}_controller.rb`
The area is gated to `@nitrosend.com` by `internal_guard.rb`, and models use `BrandScoped`, but this audit did not read every controller's `set_*`/lookup to confirm that lead/activation/plan/reply ids are scoped to the current brand (not `Model.find(params[:id])` which would be IDOR-able across brands for an internal user with multiple brands). Fix: verify each `set_*` uses `current_brand.leads.find` / `current_brand.outreach_activations.find`, not a bare `.find`.

### M5 — `unique_count` overcounts on a capped dev run (integrity, low blast radius)
`api/app/services/sourcing/run.rb:130, 158, 225-228`
`unique_count` is set to `base_unique + unique.size` (the full post-dedupe page), but when `context.reveal_cap` is present only `unique.first(cap)` are actually revealed (run.rb:158). So a capped run reports more "Matched" than it ever attempted to reveal, and the funnel's Matched→Saved gap looks like verification loss when it's really the cap. Dev-only today (cap is the dev ENV guard), but if `outreach_reveal_cap_per_run` is ever used in prod it misreports. Fix: count `unique_count` off `to_reveal.size` when a cap applies, or expose the cap as its own funnel note.

---

## LOW / NOTES

- **L1 — `APOLLO_PAGE_CEILING = 50_000` is a provider-specific constant applied to the whole union** (run.rb:38, 386). Harmless for small LinkedIn pools but semantically wrong once a non-Apollo provider could paginate deeper; rename/scope if that ever matters.
- **L2 — `owned?` pays for the reveal before discarding an already-owned email** (run.rb:183, 496). The pre-reveal name filter is best-effort, so a person you already hold under a *different* name spelling still costs a find credit before the exact email dedupe drops them. Acceptable, but it's real spend; a pre-reveal email-hint filter (where a provider exposes one) would save it.
- **L3 — `write_profile_facts!` swallows all errors** (run.rb:640-642, `rescue => e ... warn`). A systemic ProfileFacts failure would silently produce leads with no enrichment facts and only a log line. Fine for resilience, but add a metric so a persistent failure is visible.
- **L4 — reply attribution `unique_contact_activation` fallback** (inbound_reply_handler.rb:56-59) only stops a reply when exactly one active activation exists for the contact. A contact with two active activations (only reachable via the H5 race, or historically) gets *no* stop from a header-less reply — the reply is dropped on the floor. Fixing H5 closes this; until then, it's a second reason to enforce single-active-per-lead.

---

## What is actually solid (do not touch)

- **The reveal/verify/land invariant is genuinely single-sourced.** `Deliverability::Policy` is the only place the "only verifier-`:valid` lands verified" rule lives (run.rb:22-25, 203-208); the pipeline only orchestrates. This is the right architecture.
- **Sourcing concurrency is correctly guarded.** `RunJob.perform` claims the run inside `lead_search.with_lock` and bails if already `running` (run_job.rb:18-26) — no duplicate spend, no cursor drift, no double-count. My initial concern here was unfounded; the lock is correct.
- **Funnel counters can't drift.** `landed_count`/`verified_count` read straight off the Lead rows (`leads.count`, `where(verification_status: 'verified').count`), and in-flight frames broadcast without persisting, so an interrupted batch resumes from the committed base instead of double-counting (run.rb:96-104, 225-234). Genuinely careful.
- **Stale-run recovery is sound.** The `updated_at` heartbeat + `stale_running?` (15 min) + `recoverable_empty_pool?` hatch let a dead worker's run resume from the right page (run.rb:259-266, lead_search.rb:134-149).
- **`REVEAL_ERROR_LIMIT` counts only genuine exceptions, not empty reveals.** An empty-email reveal returns a `Reveal` object (not nil), so it resets the consecutive-error counter; only a raised waterfall (all providers failed) increments it (run.rb:165-174). One flaky provider can't burn the limit because `Enrichment::Capability` only re-raises when *every* provider raised.
- **Title matching is robust.** Token-containment with abbreviation expansion and stopword stripping (run.rb:531-552) correctly matches "VP of Sales" ↔ "Vice President, Sales" without false-matching "VP of Marketing." Good.
- **Activation scope validation is thorough.** `Activator#validate_context!` (activator.rb:28-40) and the four `*_scope_consistency` model validations (activation.rb:127-153) enforce brand/account/campaign-free/live/approved/trigger invariants before any activation. The double-activation *into the same flow* is correctly prevented by the `(lead_id, flow_id)` unique index; only the cross-flow race (H5) slips through.
- **Reply idempotency is handled.** `ConversationMessage` upsert keys on `inbound_idempotency_key` (inbound_reply_handler.rb:110-117, 153-158), and `ActivationStopper` is a no-op if already terminal (activation_stopper.rb:15) — a redelivered inbound webhook won't double-stop or double-record.

---

## Priority order for the fix spec

1. **H1 + H2** (name-only ownership drop, blank-name/namesake dedupe) — pure suppression, one-file, and they bite the LinkedIn direction hardest. Ship with the LinkedIn adapter.
2. **H4 + H5** (reply-stop send race, cross-flow double-activation) — correctness on the sending side; a partial unique index + a lock-and-recheck at the send boundary. Small, high-value.
3. **H3 + M2** (source-qualified external_id, company-vs-person pool math) — prerequisites for the LinkedIn provider not to silently drop or misestimate.
4. **M3** (quarantine leak verification) — highest-value *verify*; if it's leaking into billing or segments it's a live correctness/compliance issue, not just outreach.
5. **M1, M4, M5** and the LOW notes — batch into cleanup.

Each fix wants a targeted spec: `spec/services/sourcing/run_spec.rb` for H1-H3/M1/M5, `spec/services/outreach/activator_spec.rb` + a concurrency spec for H5, `spec/services/outreach/send_policy_spec.rb` for H4, and a segment/billing exclusion spec for M3.
