# LinkedIn Company-First Sourcing: Adapter Handoff

Status: design handoff, not yet a scafld spec. Convert to `scafld plan linkedin-sourcing-adapter` when ready to build.
Date: 2026-07-06.
Inputs: Jeff's proven agency-outreach POC (2026-07-03 Austin benchmark) + a full map of the current `api/` sourcing pipeline and the `app/` outreach UI.

---

## 1. Why this exists

The outreach pipeline today searches PEOPLE through Apollo and Prospeo. Both providers skew hard toward tech/SaaS. Real failure case: a search for "dirtbikes" returned nothing, almost certainly because Apollo has no meaningful people coverage in powersports. LinkedIn covers every vertical. Jeff independently proved a LinkedIn-based pipeline end to end (company search, founder extraction, verified email) at agency scale, and it tripled his yield versus narrow searching.

The proposal: add LinkedIn as another sourcing provider. The catch: Jeff's flow is COMPANY-first (find companies, then find the one decision-maker per company), and our whole stack is PERSON-first. That mismatch is the only real architecture work. Everything else is a drop-in.

---

## 2. What Jeff's POC proves (do not re-derive any of this)

Source: `~/Downloads/nitrosend/linkedin-finder-code.zip` (extracted and read 2026-07-06). Working scripts: `harvest_companies.mjs`, `extract_founders.mjs`, `nb_dedup_focused.mjs`. Vibe-coded POC quality, but the API mechanics and yields are verified.

### 2.1 The 3-stage pipeline

1. **Company search (Apify)**. Actor `harvestapi~linkedin-company-search` via `POST https://api.apify.com/v2/acts/harvestapi~linkedin-company-search/run-sync-get-dataset-items?token=<APIFY_TOKEN>`. Body:
   ```json
   {
     "searchQuery": "email marketing agency",
     "locations": ["Austin, Texas"],
     "companySize": ["1-10", "11-50"],
     "scraperMode": "short",
     "maxItems": 500,
     "takePages": 10
   }
   ```
   Returns `[{name, linkedinUrl, industry, location}]`. Cost roughly $0.002/company, about $0.50 per city sweep.

2. **Founder + email (ContactOut Decision Makers)**. `GET https://api.contactout.com/v1/people/decision-makers?reveal_info=true&linkedin_url=<company_url>`. Also `GET /v1/linkedin/enrich?profile=<person_url>` for single-person enrichment. Response shape: `profiles: { <li_url>: { full_name, title, headline, company: {domain}, contact_info: { work_emails[], personal_emails[], emails[] } } }`.

3. **Verify + output**. NeverBounce work emails only, keep personal as-is, dedup by email, one founder per company.

### 2.2 Hard-won gotchas (each one cost Jeff a debugging session)

- `companySize` takes LABEL STRINGS (`"1-10"`, `"11-50"`, ... `"10001+"`), NOT LinkedIn's internal B/C codes. B/C returns an invalid-input error.
- `scraperMode: "short"` = name + url + industry only. Use `"full"` if you need the company website domain.
- Do NOT pass a raw LinkedIn search URL to the actor. It takes structured params only.
- ContactOut requires a REAL BROWSER User-Agent header. Cloudflare error 1010 "browser_signature_banned" means missing/bot UA, not bad auth. A real 401 means bad creds. Header set: `token: <key>`, `Accept: application/json`, `User-Agent: <browser UA>`.
- The ContactOut key that works is the 24-char key. The 48-char one is wrong.
- **DEAD END**: the Apify `harvestapi~linkedin-company-employees` actor returns 0 items even for its own prefill example. Jeff's `harvest_people.mjs` and `harvest_agencies.mjs` both hit this wall. Decision-makers via ContactOut is the working person-finder. Do not retry the employees actor.
- ContactOut decision-maker lists are INCOMPLETE. It sometimes misses the actual founder entirely (MARION Marketing returned a VP, an email-less Owner, and a random person; the real founder was never returned). Rule: if a company yields no founder-level person with an email, SKIP the company. Never fall back to a VP.
- Yield is capped by ContactOut coverage: roughly 26-32% of companies produce a usable founder.
- Jeff throttled ContactOut calls at 350ms between requests and NeverBounce at 120ms.

### 2.3 Title ranking (Jeff's rule, verbatim from `extract_founders.mjs`)

Only these titles qualify; pick the single highest-ranked person per company:

| Title match | Rank |
|---|---|
| Founder / Co-Founder / Cofounder | 5 |
| Owner | 4 |
| CEO / Chief Executive | 4 |
| Managing Director / Managing Partner | 3 |
| Principal | 3 |
| everything else | 0, REJECT |

- "President" is BANNED as a match string. It false-matches "Vice President" and is a weak signal anyway.
- A founder keyword WINS even when the title also contains a rejected word ("Founder & Creative Strategist" is a founder). Check top keywords FIRST; reject only titles with none of them.

### 2.4 Email preference + verification rules

- Prefer the WORK email; fall back to personal only if no work email exists. Tag each row `email_kind = work | personal`.
- ContactOut WORK emails MUST be NeverBounce-verified; keep only `result: valid`.
- ContactOut PERSONAL emails are pre-validated by ContactOut. Jeff's rule: NEVER NeverBounce a personal email.
- Dedup by email. One founder per company.

### 2.5 Query broadening (the 3x yield lever)

A single narrow query undercounts badly. Jeff ran 14 query variants for the same ICP ("email marketing agency", "Klaviyo agency", "retention marketing agency", "Shopify agency", etc.) and deduped by company `linkedinUrl` across queries.

Austin benchmark: narrow 4-query = 219 companies, 57 founders. Broad 14-query = 886 companies, minus the noisy generic "marketing agency" query (~268) = 617 focused companies, 174 founders, 155 clean after NeverBounce + dedup. Broad tripled the yield. Expect 30-40% residual noise plus junk names ("Asdf", single letters); a light relevance filter is needed before delivery.

### 2.6 The scoring layer (later scripts, relevant to our fit-scoring)

`run_relevance.mjs` + `FEATURE_SPEC_scoring.md` add a Haiku (`claude-haiku-4-5`) two-dimension scorer per person: `relevance` 0-100 (ICP fit) and `partnership` 0-100 (likelihood to join a partner program), plus `persona` and `rationale`, from name/title/headline/company/location/industry/summary. Explicitly NO regex/keyword matching. Worker pool of 5, 30s timeout per call, filters like `relevance>=70 AND partnership>=50 AND nb_status='valid'`. This is a direct upgrade path for our `Run#score`, which today only grades title/seniority.

---

## 3. Current API architecture (mapped 2026-07-06, file:line refs)

### 3.1 Registry

`api/app/services/capabilities/registry.rb`, `Capabilities::Registry`. Three capabilities: `:search`, `:reveal`, `:verify`. `Entry = Struct.new(:key, :klass, :priority, :enabled)`; lower priority wins; `enabled` is a context lambda. Selection is ONLY here:

```ruby
def configured_providers(capability, context)
  entries(capability)
    .select { |entry| entry.enabled_for?(context) }
    .map { |entry| entry.klass.new }
    .select(&:configured?)
end
```

Providers are zero-arg-constructable and expose `#configured?`. Registration lives in ONE place: `api/config/initializers/enrichment_providers.rb` (rebuilt on `to_prepare`). Current stack:

- SEARCH: Prospeo priority 10, Apollo priority 20, both always-enabled.
- REVEAL: Prospeo 10, Apollo 20 (Apollo gated on `ctx.apollo_opt_in?`).
- VERIFY: NeverBounce 10, Null 99.

Nothing assumes exactly two search providers. `Estimator` and `Run#search` iterate the list generically. A third search provider is purely additive.

### 3.2 SEARCH provider interface

`api/app/services/sourcing/providers/base.rb`, `Sourcing::Providers::Base`:

- `#search(icp)` returns `{ people: [candidate, ...], total_entries:, pagination: }`
- `#estimate(icp)` returns Integer pool size or nil (nil drops it from the estimate)
- `#configured?`

Candidates are STRING-keyed normalized hashes:

```
"id"           => provider person id (reveal/dedupe key)
"source"       => "apollo" | "prospeo" (add "linkedin")
"first_name", "last_name", "title", "company"
"domain"       => bare host
"linkedin_url" => Apollo locks this to nil; Prospeo exposes it
"seniority", "industry"
"raw"          => untouched provider payload
```

Templates: `sourcing/providers/apollo.rb`, `sourcing/providers/prospeo.rb`.

### 3.3 The ICP object and per-provider translation

`api/app/services/sourcing/icp.rb`, `Sourcing::Icp`, built from LeadSearch's JSONB `icp` column. Fields: `titles`, `seniorities` (closed enum), `industries`, `employee_ranges` (band strings like `"1,10"`), `person_locations`, `organization_locations`, `keywords`, `email_statuses`, `page`, `per_page` (50). The vocabulary is Apollo-native (`#to_query` emits Apollo param names). Prospeo translates via `#filters_for` (prospeo.rb:122-138) with its own name/enum maps, and notably OMITS company size because the field format was unconfirmed.

`resilient_post` pattern (prospeo.rb:100-113): Prospeo rejects a whole request if one filter is invalid, naming the offender; the adapter drops that filter and retries recursively. The Apify adapter needs its own equivalent robustness (its failure mode is different: an invalid-input error object instead of an items array).

NL parsing: `Sourcing::IcpParser` (an `AI::Base`) extracts chips using a tool schema that IS the Apollo filter slots.

### 3.4 REVEAL waterfall and interface

`api/app/services/enrichment/capability.rb`, `Enrichment::Capability`: tries reveal providers in priority order, first usable Reveal wins (email present AND verdict != :invalid), winner-record semantics, per-provider errors swallowed, re-raises only if ALL attempted providers raised.

Interface, `api/app/services/enrichment/providers/base.rb`:

```ruby
Reveal = Struct.new(:email, :status, :source, :verdict, :raw, keyword_init: true)
#reveal(first_name:, last_name:, domain:, vendor_ref: nil, linkedin_url: nil, source: nil) => Reveal
#can_reveal?(...) => Bool   # gate before paid attempt
#configured?
```

`Enrichment::Providers::Prospeo` is the template for ContactOut: keys on `linkedin_url` when present, else name+domain; `can_reveal?` requires one of those identities.

### 3.5 Estimator, fail-soft, dedup, verify

- `Sourcing::Estimator#perform`: `providers.filter_map { estimate_safely(p) }.max`. Free, no persistence. Errors become nil and drop out.
- `Sourcing::Run#search` (run.rb:295-342): per-provider rescue; partial failure proceeds, total failure re-raises. `REVEAL_ERROR_LIMIT = 5` consecutive reveal errors bails the run. `pool_exhausted?` hard-codes `APOLLO_PAGE_CEILING = 50_000`, an Apollo-specific wall applied to the whole pool.
- Dedup, pre-reveal (free): candidate `id` vs brand `external_id`s (cross-run credit saver); `dedupe_key` = downcased `first|last|company` (cross-source collapse); name match vs existing contacts. Post-reveal (authoritative): by email via `brand.leads.for_email` + `Contact::Resolver`, backstopped by unique index `index_leads_on_brand_id_and_lower_email`.
- Verify: stage 5, after reveal. `Verification::Capability` picks first configured verify provider. THE invariant lives in `Deliverability::Policy` (policy.rb:45-52): only a verifier-`:valid` email lands as "verified". Finder verdicts alone land check/hold.

### 3.6 Credentials

Pure ENV, read in each provider's `initialize` default arg: `APOLLO_API_KEY`, `PROSPEO_API_KEY`, `NEVERBOUNCE_API_KEY`. Transports: `Apollo::Transport` (raises on 4xx), `Prospeo::Transport` (does not raise on 4xx, business errors come as HTTP 400 JSON; per-bucket `Http::ProviderQuota` rate limiting). Both use `Http::Resilience` for 429/5xx.

**Known gap: `PROSPEO_API_KEY` is missing from `config/deploy.yml` (only `APOLLO_API_KEY` and `NEVERBOUNCE_API_KEY` are listed at deploy.yml:251-252). Fix this while adding the new keys.**

---

## 4. Current UI architecture (app/, mapped 2026-07-06)

The outreach area is internal-only, gated to `@nitrosend.com` in `src/router/index.js:308-380`. Six routes: searches index, new-search form, detail, sequences, replies, activation.

- Store: `src/stores/my/outreach.js` (Pinia `my-outreach`). `estimate(icp)` posts to `/v1/my/outreach/searches/estimate` and returns a single scalar `count`. `createSearch` spreads the ICP flat into the POST body plus `estimated_count`. `sourceMore(id)` drives the batch loop.
- Search form: `OutreachSearchNewView.vue` (prompt textarea to `parse`, chip editor, debounced 2200ms live estimate, confirm modal). Chips: `OutreachIcpChips.vue`, vocab in `src/utils/outreachIcp.js` (`emptyIcp()` at :49-58). Fields mirror `Sourcing::Icp` one-to-one: titles (free), seniorities (closed Apollo enum), industries (free), employee_ranges (Apollo band strings `"1,10"`), person/org locations (free), email_statuses (Apollo enum), keywords (free text).
- Detail: `OutreachSearchDetailView.vue`. Live via `useLiveResource("lead_search", id)` (ActionCable + 3s poll), lead re-fetches on `landed_count` change and `lead` entity broadcasts. Bucket tabs + facets from `outreachLeadFacets.js` (fit/deliverability/sequence_state). One-lead-per-row DataTable keyed by lead id; columns prospect / email / fit / state / saved; company is only a subtitle under the person's name.
- Reveal: NO per-lead reveal button anywhere. Reveal is server-side during sourcing; the UI shows only aggregate `reveal_metrics` (e.g. an "unrevealable" skip notice). Emails just appear in the email column with a Deliverable/Unverified badge.
- Provider identity: copy is deliberately vendor-neutral ("the sourcing provider"). The ONLY source-labelled surface is the LeadInspector "Provider evidence" section (`OutreachLeadInspector.vue:517-561`), which renders arbitrary server-driven `intelligence.provider_evidence[]` rows "from {source_label}". This is the natural extension point for LinkedIn/ContactOut evidence with zero new UI.
- Apollo vocabulary is hardcoded in `outreachIcp.js`: `SENIORITY_OPTIONS` (closed enum), `EMPLOYEE_RANGE_OPTIONS`, `EMAIL_STATUS_OPTIONS`, `ARRAY_FIELD_MAP`, and `constrain()` DROPS any value outside the closed enums.

---

## 5. Design

Two phases. Phase 1 is a drop-in that immediately fixes the "dirtbikes problem". Phase 2 is the company-coverage surface work.

### 5.1 Phase 1: LinkedIn search adapter, person-shaped externally, company-first internally

The key insight from the codebase map: the person-centric candidate contract does NOT force us into new capabilities. A single `Sourcing::Providers::Linkedin < Sourcing::Providers::Base` can run Jeff's company-first flow INSIDE `#search(icp)` and emit ordinary person candidates. The pipeline (dedup, reveal waterfall, verify, land) then treats them like any Apollo/Prospeo row.

**`Sourcing::Providers::Linkedin#search(icp)`, internal flow:**

1. Translate the ICP to Apify company-search input:
   - `searchQuery`: derive a QUERY SET, not one query (Jeff's 3x lever). Base it on `icp.keywords` + `icp.industries`. Start simple: one query per industry/keyword term; a later iteration can LLM-expand synonyms the way Jeff hand-curated his 14 variants.
   - `locations`: `icp.organization_locations` (fall back to `person_locations`).
   - `companySize`: map `employee_ranges` bands to actor label strings (`"1,10"` -> `"1-10"`, `"11,50"` -> `"11-50"`, etc.). Labels, never B/C codes.
   - `scraperMode: "short"` (we do not need the website domain at search time; ContactOut returns `company.domain` per person).
2. Dedup companies by `linkedinUrl` across the query set (in-adapter `Map`, exactly like `harvest_companies.mjs:21-26`).
3. For each company page-slice, call ContactOut decision-makers, apply Jeff's title ranking (section 2.3 verbatim, including the President ban and keyword-first override), pick the single best person WITH an email, skip the company otherwise (never a VP).
4. Emit normalized candidates:
   - `"id"` = person LinkedIn URL (stable reveal/dedupe key)
   - `"source"` = `"linkedin"`
   - `"first_name"/"last_name"` split from `full_name`; `"title"`; `"company"` = company name; `"domain"` = ContactOut `company.domain`
   - `"linkedin_url"` = person profile URL (this is what makes downstream reveal reliable)
   - `"seniority"` = map rank to the closed enum (`founder`/`owner`/`c_suite`/`partner`)
   - `"raw"` = full ContactOut profile INCLUDING `contact_info` (so the reveal provider can short-circuit without a second paid call, see 5.2)
5. Pagination: `icp.page`/`per_page` map onto slices of the deduped company list. Persist/derive the company list deterministically per page (see open decision D3).

**Registration** in `enrichment_providers.rb`:

```ruby
registry.register(:search, key: :linkedin, klass: Sourcing::Providers::Linkedin,
                  priority: 30, enabled: ->(ctx) { ctx.linkedin_enabled? })
```

Gate behind `ENV["SOURCING_LINKEDIN_ENABLED"]` on `Capabilities::ProviderContext` (same pattern as `apollo_opt_in?`), so it can ship dark and be enabled per-environment.

**Transport**: new `Apify::Transport` and `Contactout::Transport` following `Prospeo::Transport` (business errors in JSON body, `Http::ProviderQuota` buckets, `Http::Resilience`). ContactOut transport MUST send the browser UA header (section 2.2). Apify note: `run-sync-get-dataset-items` blocks for the actor runtime, which can be tens of seconds per query. Set generous read timeouts (120s+) or use async actor runs with polling. The sourcing Run is a GoodJob background job, so long calls are acceptable but must not trip default HTTP timeouts.

**`#estimate(icp)`**: cheap company-count probe (one representative query, `maxItems` small, count only) multiplied by the founder-yield constant `0.29` (midpoint of ContactOut's measured 26-32%), rounded. Or return nil initially and let Apollo/Prospeo carry the estimate; nil is explicitly allowed and drops out of `Estimator#perform`'s `.max`. Recommend nil for the first cut, constant-yield estimate as a fast follow.

**Credentials**: `APIFY_API_TOKEN`, `CONTACTOUT_API_KEY` (the 24-char key) as ENV; add BOTH to `config/deploy.yml`, and fix the missing `PROSPEO_API_KEY` at the same time.

### 5.2 Phase 1: ContactOut reveal provider

`Enrichment::Providers::Contactout < Enrichment::Providers::Base`, registered at REVEAL priority 15 (between Prospeo 10 and Apollo 20).

- `can_reveal?`: require `linkedin_url.present?` (ContactOut's strong key). Optionally allow name+domain later; start strict.
- `reveal`: two paths.
  1. **Short-circuit**: when `source == "linkedin"` the candidate's `raw` already carries `contact_info` from the decision-makers call, and re-calling ContactOut would pay twice. `Enrichment::Capability#reveal` receives `vendor_ref` and `linkedin_url`; thread the cached payload through (see open decision D2 for the mechanism).
  2. **Live enrich**: `GET /v1/linkedin/enrich?profile=<linkedin_url>` for candidates from OTHER sources that carry a `linkedin_url` (Prospeo candidates expose one). This makes ContactOut useful beyond the LinkedIn search path: it becomes a general reveal fallback.
- Email preference inside the provider: work emails first, personal fallback, per Jeff's rule. Return `Reveal.new(email:, status: "work"|"personal", source: "contactout", verdict:, raw:)`.
- New verdict map `Deliverability::Verdict::CONTACTOUT`: ContactOut does not return a per-email deliverability grade the way finders do, so map work emails to `:unknown` (forces NeverBounce downstream, which is exactly Jeff's rule) and personal emails to `:valid`-as-finder-verdict ONLY IF we accept decision D1 below; otherwise `:unknown` too.

### 5.3 Where Jeff's rules land in OUR pipeline

| Jeff's rule | Our seam |
|---|---|
| Founder-only title ranking | Inside `Sourcing::Providers::Linkedin` candidate selection (provider-internal, not `Run#score`) |
| Work email NeverBounce-verified, keep only valid | Already the pipeline invariant: `Deliverability::Policy` only lands "verified" on verifier `:valid` |
| Personal emails never NeverBounced | CONFLICTS with the invariant. Decision D1 |
| Dedup by email, one founder per company | Post-reveal email dedup already exists; one-per-company is enforced in-adapter |
| Company name cleaning (de-shout, drop LLC/taglines) | Adapter normalization when setting `"company"`; keep original in `raw` |
| Broad query set + drop noisy generic query | Adapter query-set builder; log per-query counts like the POC does |
| Junk-name filtering ("Asdf") | Adapter-level guard + existing fit scoring; Haiku scoring phase strengthens this later |
| Haiku relevance/partnership scoring | Future phase, upgrades `Run#score` (today only title/seniority). UI fit facet already exists |

### 5.4 Open decisions (resolve before build, in the scafld harden pass)

- **D1, personal emails vs the verify invariant.** Jeff: never NeverBounce a personal email (ContactOut pre-validates them). Our `Deliverability::Policy`: only verifier-`:valid` lands "verified"; everything else lands check/hold. Options: (a) NeverBounce personal emails anyway, cheap and safe, violates Jeff's rule but personal gmails verify fine in practice; (b) map ContactOut-personal to a finder verdict that lands check/hold, so they arrive but not as "verified"; (c) extend Policy with a trusted-finder carve-out. Recommend (a); it keeps ONE invariant and costs a fraction of a cent per email. Note separately: cold outreach to personal mailboxes has deliverability/compliance implications; flag to the operator.
- **D2, avoiding the double ContactOut spend.** The reveal interface passes `vendor_ref`/`linkedin_url` but not the candidate's `raw`. Options: (a) pass the ContactOut payload as `vendor_ref` (it is an opaque provider ref by contract; Apollo already uses source-gated vendor_ref trust); (b) let the SEARCH adapter emit candidates with the email attached and teach `Run` to skip reveal when the candidate already carries one, a bigger contract change; (c) an in-run memo cache keyed by linkedin_url. Recommend (a) or (c); do NOT widen the candidate contract with an email field in phase 1.
- **D3, page determinism.** `Run` paginates by `icp.page`, but the deduped company list is built per-search-request. Rebuilding the query fan-out every page re-spends Apify money and can reorder. Options: (a) cache the company list per LeadSearch (JSONB or a keyed cache) on first page and slice it thereafter; (b) accept re-query per page with `takePages` windows. Recommend (a).
- **D4, `pool_exhausted?` ceiling.** `APOLLO_PAGE_CEILING = 50_000` is applied to the whole pool. LinkedIn company pools are small (hundreds to low thousands); exhaustion should come from the empty-page/degraded path, which already works. Verify no false "exhausted" latch; rename or scope the constant if touched.
- **D5, ToS/compliance posture.** Apify LinkedIn scraping and ContactOut usage carry LinkedIn ToS risk. Today the outreach area is internal-only (@nitrosend.com gate), which contains the exposure; flag before this ever becomes customer-facing.

---

## 6. UI flow changes

### 6.1 Phase 1: near-zero UI change (deliberate)

Because the LinkedIn adapter emits ordinary person candidates and the UI is already vendor-neutral, phase 1 ships with almost nothing in `app/`:

- No provider toggle, no new search mode. The registry fans out to LinkedIn alongside Apollo/Prospeo automatically.
- Copy already says "the sourcing provider"; nothing to rename.
- Leads land in the same one-per-row table with the same fit/deliverability facets.
- ONE recommended addition: feed company-level evidence rows into `intelligence.provider_evidence[]` (source label "LinkedIn") so the LeadInspector's existing Provider evidence section (`OutreachLeadInspector.vue:517-561`) shows why the company matched (query hit, industry, size band). Server-side data only; zero new components.

Small but real phase 1 items:

- **Vocabulary strain**: `outreachIcp.js` enums are Apollo's, and `constrain()` DROPS values outside them. The LinkedIn adapter maps FROM these chips, so nothing breaks, but the mapping table (band strings to actor labels, seniority enum to title ranks) must live server-side in the adapter, never in the UI.
- **Estimate honesty**: `estimate` returns one aggregate scalar and the UI shows "N matches". If the LinkedIn estimator returns nil (recommended first cut), nothing changes. If it returns company-derived numbers later, they fold into the same `.max`; still one number. Fine for phase 1.
- **Keywords field carries more weight**: for non-tech verticals ("dirtbikes"), `keywords`/`industries` chips drive the Apify query set. Consider updating the prompt placeholder examples in `OutreachSearchNewView.vue` to include a non-tech example so operators learn the pipeline now covers those.
- **Reveal-metrics notice**: the detail view already surfaces aggregate skip notices from `reveal_metrics`. Add a metric for "companies skipped: no founder-level contact" so the ContactOut coverage cap (roughly 70% of companies yield nothing) is visible instead of looking like a weak search.

### 6.2 Phase 2: company-coverage surfaces (only if company-first becomes a first-class mode)

If we later want the operator to SEE the company-first funnel rather than just receive its person output, these are the gaps the UI map identified, in priority order:

1. **Two-number estimate**: "~620 companies matched, ~180 reachable decision-makers expected". Today there is one scalar slot in the estimate row, the confirm modal, and `estimated_count` persistence. Requires an estimate payload shape change plus small edits in `OutreachSearchNewView.vue` and the index "N matches" label.
2. **Company-coverage counters**: `OutreachInventorySummary` gains "companies found / with contact / skipped" alongside the lead counters, driven by new fields on `search.inventory`. The ProgressFunnel on the index gets a "companies" stage before "sourced" (it already renders arbitrary server-driven stages, so this is API-side work plus a stage label).
3. **Company grouping in results**: today rows are strictly leads keyed by id, company is a subtitle. A grouped-by-company view (or a company facet) is a real DataTable change; defer until an operator actually asks. One-founder-per-company means grouping adds little in practice.
4. **Search-mode toggle** ("find people" vs "find companies first"): recommend NEVER exposing this. Mode is a backend routing concern; the operator describes an ICP and the registry decides. Keeping one mental model is worth more than the control.
5. **Fit-scoring upgrade UI**: when the Haiku relevance/partnership scorer lands, the existing fit facet buckets absorb it; optionally show the two sub-scores in the LeadInspector qualification section. No new surface needed.

The lead-centric buckets/facets (`outreachLeadFacets.js`) stay as-is in both phases; company state belongs in inventory counters and evidence, not in lead facets.

---

## 7. Suggested build plan (for the scafld spec)

Phase 1 slices, each independently shippable:

1. **Transports + creds**: `Apify::Transport`, `Contactout::Transport` (browser UA, quota buckets, resilience, long timeouts). ENV keys + deploy.yml (including the PROSPEO_API_KEY fix). Specs with stubbed HTTP.
   - Validate: `cd api && bundle exec rspec spec/services/apify spec/services/contactout`
2. **`Sourcing::Providers::Linkedin`**: ICP translation, query-set fan-out, company dedup, decision-makers, title ranking (port `extract_founders.mjs:11-21` faithfully, President ban included), candidate normalization, page determinism per D3. Registry entry behind `SOURCING_LINKEDIN_ENABLED`.
   - Validate: `cd api && bundle exec rspec spec/services/sourcing/providers/linkedin_spec.rb` with fixture payloads captured from Jeff's real Austin JSON (`harvest_austin-focused_companies.json` in the zip makes a perfect fixture).
3. **`Enrichment::Providers::Contactout`** + `Deliverability::Verdict::CONTACTOUT` + D1/D2 resolutions.
   - Validate: `cd api && bundle exec rspec spec/services/enrichment/providers/contactout_spec.rb`
4. **Reveal-metrics + provider evidence**: "no founder-level contact" skip metric; company-match evidence rows for the inspector.
   - Validate: targeted run spec asserting the metric increments; manual check of the inspector on a dev search.
5. **End-to-end dev drill**: real keys in `api/.env`, run a search with keywords "dirtbike dealership" + a non-tech location, confirm leads land where Apollo/Prospeo return zero. This is the acceptance test for the original problem.

Phase 2 (separate spec, only on demand): two-number estimate, company inventory counters, funnel stage, Haiku scoring.

Cost guardrails to carry into the spec: Apify ~$0.002/company; ContactOut decision-makers is the expensive call (respect `Capabilities::ProviderContext#reveal_cap` and add a per-run company cap); Jeff's whole 6-7 city sweep cost $40-50, so per-search cost is bounded but must be visible in reveal metrics.

---

## 8. Artifacts

- POC zip: `~/Downloads/nitrosend/linkedin-finder-code.zip` (scripts + Austin result JSON/CSVs; `.env` secrets excluded). Key scripts: `harvest_companies.mjs` (stage 1), `extract_founders.mjs` (stage 2 + ranking), `nb_dedup_focused.mjs` (stage 3), `FEATURE_SPEC_scoring.md` + `run_relevance.mjs` (Haiku scoring layer).
- Jeff's workflow doc: "AGENCY OUTREACH WORKFLOW" (2026-07-03 Austin benchmark), reproduced in section 2.
- Credentials live with Jeff (`linkedin-finder/.env`, `~/.claude-secrets/neverbounce.json`); Nitrosend needs its own Apify + ContactOut accounts before build slice 1.
