# Nitrosend Investor Pitch

## 1. One-liner and the story

Nitrosend is the approve-and-ship AI growth co-pilot for Stripe-native SaaS and B2B teams.

We point an agent at the data a SaaS team actually runs on, the CRM lifecycle in HubSpot or Attio and the subscription revenue in Stripe, and it proposes the next revenue-moving send. A human approves it, and a deliverability gate enforced at our own send path makes sure the agent never torches the sending domain. The reason this is not "Klaviyo plus an MCP server" is that the safety gate and the approval loop have to live inside the platform that owns the SES sending substrate, and Klaviyo's intelligence is built for Shopify order data it cannot get from a B2B SaaS account, so the quadrant we are claiming, Stripe MRR plus B2B CRM data, is the one Klaviyo is structurally weak in.

## 2. Problem

Marketers still run on dashboards built for the pre-agent era. The interface assumes a human will open a tab, read a chart, decide what to do, and then go build it by hand. That model is now backwards. The work that should be automated, reading the state of the account and proposing the obvious next move, is the part a human still does manually, and the work that genuinely needs a human, approving a send that goes to real customers, is treated as an afterthought.

The second gap is sharper. SaaS and B2B teams are served by tools built for Shopify ecommerce. Klaviyo is laser-focused on ecommerce and its strongest stack is Klaviyo plus Shopify ([Klaviyo solutions](https://www.klaviyo.com/solutions/ai); [emailvendorselection](https://www.emailvendorselection.com/klaviyo-alternatives/)). Mailchimp's February 2026 release was explicitly ecommerce-focused, adding 26 percent more ecommerce triggers and deep Shopify, WooCommerce, and Wix integrations ([Mailchimp Feb 2026 release](https://mailchimp.com/february-2026-release-data-driven-ecommerce-marketing/)). These tools understand product catalogs and shopping carts. They do not understand subscription tiers, billing cycles, MRR, or a CRM deal stage. A SaaS team that wants to act on "trial about to expire" or "deal moved to stage X" or "subscription about to renew" is forced to wire it together by hand, on a platform whose intelligence was tuned for a different business.

## 3. Why now

Three shifts landed at the same time.

The agent shift is real and standardized. MCP went from roughly 2 million to more than 97 million monthly SDK downloads in about 16 months, and Anthropic counted more than 10,000 active public MCP servers as of its December 9, 2025 announcement, when it donated MCP to the Linux Foundation's Agentic AI Foundation alongside Block and OpenAI ([Anthropic AAIF announcement](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)). MCP is now a vendor-neutral standard, not a single-vendor bet. Gartner projects 40 percent of enterprise apps will feature task-specific AI agents by the end of 2026, up from less than 5 percent in 2025 ([Gartner, Aug 26 2025](https://www.gartner.com/en/newsroom/press-releases/2025-08-26-gartner-predicts-40-percent-of-enterprise-apps-will-feature-task-specific-ai-agents-by-2026-up-from-less-than-5-percent-in-2025)). An agent operating your marketing stack is now a realistic distribution channel.

Deliverability became a hard pass-fail gate, not a best practice. Since February 1, 2024, senders of more than 5,000 messages a day to Gmail must keep spam rates below 0.30 percent (Google recommends staying below 0.10 percent), pass SPF, DKIM, and DMARC with From-header alignment, and offer one-click unsubscribe ([Google bulk sender rules](https://support.google.com/a/answer/81126)). Yahoo adopted the same threshold. Providers began rejecting non-compliant mail outright from April 2024 and ramped the rejection rate over time ([Mailgun deliverability summary](https://www.mailgun.com/state-of-email-deliverability/chapter/yahoogle-bulk-senders/)). The moment you let an agent send mail, deliverability stops being a tip and becomes the thing that can destroy a domain.

The workflow shift is toward AI-assisted but human-approved. Gartner forecasts that more than 40 percent of agentic AI projects will be canceled by the end of 2027, citing cost, unclear value, and weak controls ([Gartner, Jun 25 2025](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027)). Buyers want the leverage of an agent with a human approval gate, not full autonomy. That is exactly the shape of the product we built.

## 4. Product: the approve-and-ship co-pilot

The product is a co-pilot, not an autopilot. The loop is: the agent reads the account state, proposes a send, a human approves or rejects it, and the platform enforces a deliverability gate before anything leaves.

The human-in-the-loop loop already exists in code, and it is the part most worth understanding. Our in-app chat agent runs through `Chat::Orchestrator`. Read-only tools (search, status, insights) are classified as safe and execute automatically. Any tool that writes or sends, composing a campaign or triggering delivery, is held in a pending state until a person acts. The orchestrator exposes `approve_tool` and `reject_tool`. Approving runs the tool and feeds the result back into the conversation. Rejecting injects a declined result and continues. Every tool call and its state, pending, completed, error, or rejected, is persisted on `ChatMessage.tool_calls` for audit. The agent cannot run away: there is a hard cap of 20 tool rounds per turn. This is built and working today.

The deliverability gate is the second, independent enforcement layer, and it sits at our own send path. We run multi-tenant SES cohorts that move accounts through probation, standard, trusted, and quarantine tiers based on bounce and complaint rates, with auto-silencing when critical thresholds breach (`Deliverability::CohortEvaluator`). A warmup enforcer caps daily volume by domain age and account tier (`Email::WarmupEnforcer`). New, unproven accounts are vetted at the send path by an LLM judge that catches impersonation and credential capture (`Trust::SendVetting`); content is spam-scored before auto-release (`Mcp::SpamScorer`); and the auto-approve policy requires a sufficient trust level, a recipient count under threshold, and a clean first-send guard (`Delivery::AutoApprovePolicy`). An agent connected to Nitrosend cannot send mail that bypasses this gate, because the gate is the send path.

Honest scope: what the agent reads about CRM lifecycle and customer revenue today is thin, and we treat it as roadmap, not a shipped claim. Section 10 lays out exactly what is built versus what is sequenced.

## 5. The wedge and the ICP

The wedge is vertical in go-to-market and horizontal in product. We sell to one customer and serve a broad set of jobs for them.

The customer is the Stripe-native SaaS, subscription, or B2B team that runs on HubSpot or Attio, not Shopify. The buyer is RevOps or growth, the person who owns the number, not the contact list. Willingness to pay is anchored to revenue influence, not contact count.

The data-gravity flip is the core of the thesis. For a DTC brand, the gravity is the Shopify order stream, and that is Klaviyo's home. For a SaaS company, the gravity is somewhere else entirely: subscription state in Stripe and deal or lifecycle stage in the CRM. A platform whose intelligence is tuned for order events is sitting next to the wrong data. We position to sit next to the right data.

Pricing follows the wedge. Klaviyo and Customer.io both bill on total profile count, you pay for stockpiled contacts whether or not you email them. Klaviyo moved to total-active-profile billing on February 18, 2025 ([Klaviyo billing change](https://help.klaviyo.com/hc/en-us/articles/33136281415451)), and at 200,000 profiles the Email plan runs roughly $2,070 a month ([Omnisend pricing breakdown](https://www.omnisend.com/blog/klaviyo-pricing/); [Retainful](https://www.retainful.com/blog/klaviyo-pricing)). Customer.io Essentials is $100 a month for 5,000 profiles, then $0.009 per additional profile ([Customer.io pricing](https://customer.io/pricing)). For a PLG SaaS company with a large free-tier user base, that model punishes the exact thing that makes the business work. Nitrosend prices on revenue influence and usage, not on dormant contacts.

The honest cost of the wedge: a smaller TAM than horizontal email, a longer sales cycle, lower send volume per account, and a competitor set that shifts from Mailchimp toward Customer.io, HubSpot Marketing Hub, and Outreach. We are choosing a narrower, defensible lane on purpose.

## 6. Why we win versus Klaviyo plus MCP

This is the question YC rejected us on, so we answer it directly and without overstatement.

First, what we concede. Klaviyo runs an official, generally available, OAuth, remotely hosted MCP server with more than 40 write-capable tools spanning campaigns, flows, profiles, segments, and reporting, including campaign creation and sending ([Klaviyo MCP docs](https://developers.klaviyo.com/en/docs/klaviyo_mcp_server)). On May 7, 2026 it announced an expanded Anthropic integration bringing agentic workflows into Claude.ai and Claude Cowork ([Klaviyo investor release](https://investors.klaviyo.com/news/news-details/2026/Klaviyo-Expands-Integration-with-Anthropic-to-Bring-Agentic-Marketing-Workflows-to-Claude/default.aspx)). Klaviyo has a real agent story. We do not claim otherwise, and any pitch that did would be disproven by their own docs. We also concede Shopify DTC outright. That is Klaviyo's turf and we are not contesting it.

What separates us is a stack of three things, ranked by how real they are today.

The enforced HITL and deliverability gate is the strongest and it is built. The reason this is not trivially copyable: Klaviyo cannot expose an enforced deliverability gate to a third-party agent without rebuilding its sending substrate, because once an external agent has write access to campaign creation and send jobs through an open MCP server, the platform has handed the send decision to the agent. Our gate works precisely because we own the SES cohort logic, the warmup enforcer, and the new-account vetting judge, and because the agent's send requests route through `Delivery::AutoApprovePolicy` and the approval holds rather than around them. The gate is not a feature we bolted on, it is where the send happens. This is also our highest-incident subsystem, which is the honest reason we treat it as a discipline and not a marketing line.

Presence where SaaS data lives is the second. Klaviyo's native Stripe integration ingests only invoice and payment events, four metrics: issued invoice, successful payment, failed payment, and refund ([Klaviyo Stripe docs](https://help.klaviyo.com/hc/en-us/articles/115005082267)). It does not natively ingest subscription objects, plan, billing cycle, or renewal date, so renewal-aware and plan-aware automation requires bolting on a third-party connector. More important, Klaviyo's flagship predictive analytics, predicted CLV, churn risk, next-order date, are gated behind ecommerce order data: at least 500 customers who placed an order, at least 180 days of order history, and an ecommerce integration or order events carrying a dollar value ([Klaviyo predictive requirements](https://help.klaviyo.com/hc/en-us/articles/360020919731)). For a B2B SaaS account with no order stream, that intelligence does not function. This is a data-model prerequisite, not something a prompt fixes.

The per-tenant accept, edit, reject, and outcome loop is the third, and it is the one compounding moat. It is described in full in Section 7.

The honest bound on this argument: even after we win on location and gate, Nitrosend is weaker than Klaviyo on raw data density. Klaviyo owns first-party purchase data; we hold a second-hand copy of CRM and revenue signals. Our edge is location, an enforced gate Klaviyo structurally cannot expose to a third-party agent, a per-tenant history that compounds, and speed. That is a defensible wedge. It is not a guaranteed win, and we do not pitch it as one.

## 7. The compounding moat

The compounding moat is a per-tenant learning loop, and the simple version is this: every time a Nitrosend customer accepts a proposed send, edits it before approving, or rejects it, that decision is captured, and over time the system learns what that specific customer will and will not ship.

Why per-tenant and not global. A global model, trained across every customer, favors the incumbent, because the incumbent has the most customers and therefore the most data. We cannot win that race and we are not trying to. But marketing preference is not a global truth, it is a per-account truth. What a buttoned-up B2B SaaS company will approve is the opposite of what a casual prosumer tool will approve. The asset that matters is not a global average, it is the decision history of one customer, and that history belongs to whoever holds the customer's approval surface. We hold that surface. The accept, edit, and reject signal is generated at our approval gate and nowhere else, so the longer a customer is with us, the better we get at proposing things they will actually approve, and the more friction they would face leaving.

The infrastructure for this is partly built and partly wireable this quarter. We have an append-only reflection corpus: every agent decision pairs a `ReflectionCandidate` with an `AgentReflection` that carries an edit delta, a reward measured by outcome probes, and human labels. Honest current state: this loop is not yet live on the path that matters. The compose path does not currently capture a generation event, so reflections do not fire when the agent writes a campaign (the provenance gap in `compose_campaign` and `compose_flow`). The only labeler today is our internal team's Slack emoji reactions, and the training export is hardcoded to internal scope. Wiring the customer's own accept, edit, reject decisions into this corpus is the work that turns a real piece of infrastructure into a real moat, and it is a one-to-two-week job per piece, sequenced in Section 10.

## 8. Market and TAM

Lead with marketing automation as the market and email as the wedge.

The marketing automation market is roughly $47.02 billion in 2025, projected to $81.01 billion by 2030 at an 11.5 percent CAGR ([MarketsandMarkets](https://www.marketsandmarkets.com/Market-Reports/marketing-automation-software-market-155627928.html)). Estimates vary by definition, so we anchor to one firm and one definition rather than blending.

Email marketing, the wedge channel, is roughly $12.5 to $13 billion in 2025 with a low-teens to mid-teens CAGR. MarkNtel puts it at $12.53 billion growing to $30.4 billion by 2030 at 15.92 percent ([MarkNtel](https://www.marknteladvisors.com/press-release/email-marketing-market-growth)); Mordor is more conservative at $12.84 billion to $22.93 billion by 2031 at 10.82 percent ([Mordor](https://www.mordorintelligence.com/industry-reports/email-marketing-market)). Email returns roughly $36 per $1 spent, the highest of any channel, per the industry benchmark cited by Litmus and the DMA ([Litmus](https://www.litmus.com/blog/infographic-the-roi-of-email-marketing)). We present this as a survey benchmark, not audited accounting.

The customer pool is large and growing. The global SaaS market is roughly $317 billion in 2025 ([Statista](https://www.statista.com/statistics/505243/worldwide-software-as-a-service-revenue/); [Fortune Business Insights](https://www.fortunebusinessinsights.com/software-as-a-service-saas-market-102222)). Secondary aggregators count more than 30,800 SaaS companies globally, roughly 17,000 in the US, with about 1,500 new SaaS startups founded each month ([Ascendix](https://ascendixtech.com/number-saas-companies-statistics/)); these counts are directional, not a primary census. The budget is there: 47 percent of organizations now put 20 to 40 percent of total marketing budget into technology, and 14 percent put more than 40 percent, up from 6 percent in 2024 ([Ascend2 MarTech 2025](https://ascend2.com/wp-content/uploads/2024/11/The-Future-of-the-MarTech-Stack-2025.pdf)).

So the TAM ladder is: a customer pool of tens of thousands of SaaS companies, a budget envelope where martech is 20 to 40 percent of marketing spend, a channel that returns roughly $36 per $1, and a $47 billion to $81 billion marketing automation market with email as the entry wedge.

## 9. Competitive landscape

A note on reading this matrix: "agent / MCP" is now table stakes. Klaviyo, Customer.io, and HubSpot all ship write-capable MCP servers, so we do not claim to be the only one with an agent. The differentiated columns are the enforced HITL plus deliverability gate, predictive (where we honestly hold a cell open), and per-tenant learning.

| Capability | Nitrosend | Klaviyo | Customer.io | HubSpot | Mailchimp |
|---|---|---|---|---|---|
| SaaS / Stripe fit | Built for it; Stripe subscription read on roadmap | Weak; predictive needs ecommerce order data | Strong event model; Stripe is a generic pipeline you wire | CRM gravity, but not built for product or order events | SMB and ecommerce centric |
| Agent / MCP | Yes, MCP-native plus in-app chat agent | Yes, official GA MCP, 40+ write tools | Yes, live read, write, delete with write:live scope | Yes, GA MCP; cannot create or update marketing campaigns or emails | Bidirectional Claude/ChatGPT app, not an open MCP server |
| Enforced HITL + deliverability gate | Yes, enforced at own SES send path | Open MCP can create and send; no enforced platform gate to a 3rd-party agent | write:live scope is admin-gated, but not a deliverability gate | No deliverability gate over agent writes | Manual approval, no enforced gate |
| Predictive (churn / LTV / intent) | Not claimed; no scoring code today | Mature but ecommerce-order-gated | No native predictive scoring | AI forecasting and predictive lead scoring | Marketed high-value / at-risk, separate older tier |
| Per-tenant learning loop | Infrastructure built; wiring the customer-decision loop this quarter | Global K:AI model | Agent memory into MCP on roadmap | Breeze AI over CRM | Agent that "learns from results," marketed |

Sources for the cells: [Klaviyo MCP](https://developers.klaviyo.com/en/docs/klaviyo_mcp_server), [Klaviyo predictive requirements](https://help.klaviyo.com/hc/en-us/articles/360020919731), [Customer.io MCP](https://docs.customer.io/ai/mcp/get-started/), [HubSpot MCP GA](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available), [Mailchimp Claude app](https://mailchimp.com/newsroom/introducinganalyticsai/).

The honest read of this table: Customer.io is the real benchmark, not Mailchimp. It ships a live read, write, and delete MCP server with a `write:live` scope that gates sending and is admin-off by default ([Customer.io MCP docs](https://docs.customer.io/ai/mcp/get-started/)), and it has the strongest event-driven data model for product-led SaaS. Our differentiation against Customer.io is not the existence of MCP, it is an enforced deliverability gate that goes beyond a single live-write toggle, a turnkey Stripe-native posture rather than a generic event pipeline the customer must wire, and usage pricing instead of profile pricing. HubSpot is the clearest wedge on the matrix: its GA MCP server explicitly cannot create or update marketing campaigns or marketing emails ([HubSpot MCP GA changelog](https://developers.hubspot.com/changelog/remote-hubspot-mcp-server-is-now-generally-available)), so the largest CRM incumbent has not shipped agent-driven campaign creation.

## 10. Where we are and the roadmap

Honest current state. The human-in-the-loop chat agent with approve and reject is built and working (`Chat::Orchestrator`). The enforced deliverability and trust gate is built and is our most battle-tested and highest-incident subsystem (SES cohorts, warmup enforcer, new-account vetting, auto-approve policy). The MCP surface is built: 24 tools and roughly 15 resources. The host-composed composition architecture is built and is model-agnostic (`EmailCompositionContracts::Compiler`). CRM OAuth and webhook plumbing for Attio and HubSpot is built.

What is not true today, stated plainly so no claim in this deck is false in code:

- CRM sync maps only name, email, and phone. Deal stage, lifecycle stage, company, and custom fields are fetched and then dropped at ingest. No recommendation, segment, or compose code reads enriched CRM data.
- Customer Stripe revenue is a phantom. Stripe is billing-only via the Pay gem. There is no Connect integration and no read of a customer's own charges.
- "Money made today" is unanswerable, because outbound links carry no `message_id` to join on, `events.amount` is orphaned, and `last_interacted_at` is offered as a segment filter but written by zero code.
- We do not claim predictive scoring. There is no churn, LTV, or intent scoring code, and we will not pretend there is.

The six-step build sequence, with what each step unlocks for the buyer:

1. Stamp `message_id` on outbound links. About 1 week. Unlocks the attribution join key, so a send can be tied to a downstream event.
2. Write `last_interacted_at`. About 3 days. Unlocks recency segmentation that today silently returns empty sets.
3. Map and read enriched CRM fields (deal stage, lifecycle, company, custom). About 3 to 4 weeks. This is the YC-killer: it is what makes the agent actually read the SaaS team's CRM lifecycle instead of just name and email. Steps 1 through 3 together make the demo true.
4. Fix the compose-path provenance gap. About 1 to 2 weeks. Unlocks reflections firing on the path where the agent writes campaigns.
5. Make the customer the labeler. About 1 to 2 weeks. Unlocks the per-tenant accept, edit, reject loop, the compounding moat from Section 7. Steps 4 and 5 together make the moat real.
6. Honest revenue v1 from posted checkout events. About 2 to 3 weeks. Unlocks a directional, comparative revenue view without overclaiming. Full Stripe Connect reconciliation is deferred to a later 18-to-24-week effort, and we will use a customer-provisioned restricted API key plus signed webhooks, not Connect OAuth read-only, which is closed to new integrators ([Stripe restricted keys](https://docs.stripe.com/keys/restricted-api-keys); [Stripe Connect OAuth](https://docs.stripe.com/connect/oauth-reference)).

We are deliberate about what we will not build: false-precision prediction, becoming a CDP (we own the join, not the data, and persist only source values with provenance), full autonomy (the trust gate is age-based and gameable, so a human stays in the loop), cross-account network effects (the learning loop is per-tenant only), and a tool-count arms race.

## 11. The ask

We are raising a [SEED / SERIES A] round of [$AMOUNT] to make the demo true and the moat real, then take the approve-and-ship co-pilot to the Stripe-native SaaS vertical.

Use of funds, tied directly to the build sequence and the GTM:

- [PERCENT / $AMOUNT] to engineering, to ship steps 1 through 5 of the build sequence: the attribution join key, recency writes, enriched CRM read (the differentiation step), the compose-path provenance fix, and the customer-as-labeler loop. This is the work that turns the pitch into a working product and the infrastructure into a defensible moat.
- [PERCENT / $AMOUNT] to a focused SaaS-vertical go-to-market: RevOps and growth buyers at Stripe-native, HubSpot- or Attio-running SaaS companies, pursuing placement in Claude's official MCP partner directory as a credibility and distribution milestone, and revenue-influence-anchored pricing rather than contact-count pricing.
- [PERCENT / $AMOUNT] to deliverability and reliability hardening on the SES cohort and trust subsystem, which is both our moat and our highest-incident area.
- [PERCENT / $AMOUNT] reserve for honest revenue v1 (step 6) and, if traction warrants, the start of full Stripe Connect reconciliation.

The round is sized to reach [MILESTONE: e.g., true CRM-aware demo plus first N paying SaaS accounts plus a live per-tenant learning loop], which is the proof point for the next raise.

## 12. Risks and what we are betting on

We would rather state the uncomfortable truths than have an investor find them.

Data-density gap versus Klaviyo. Klaviyo owns first-party purchase data; we hold a second-hand copy of CRM and revenue signals. Mitigation: we do not compete on density, we compete on location, on an enforced gate Klaviyo cannot expose to a third-party agent, and on per-tenant history. We win where Klaviyo's data does not function, the B2B SaaS account with no order stream.

Incumbent-inertia bet. We are betting that marketers will let an agent operate their stack and that SaaS teams will prefer a tool built for their data over the default Shopify-era tools. If the agent shift stalls or buyers stay on incumbents out of inertia, our wedge narrows. Mitigation: MCP is already a cross-vendor standard with mainstream adoption ([Anthropic AAIF](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)), and the human-approval shape we built is the one Gartner's data says buyers actually want, given that more than 40 percent of fully autonomous agentic projects are forecast to be canceled by 2027 ([Gartner](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027)).

Cold-start on the learning loop. The per-tenant moat compounds with time-in-market, which means a brand-new account has none of it. Mitigation: the enforced deliverability gate and the CRM-aware proposals deliver value on day one, before the loop has any history, so the compounding moat is a retention and depth advantage layered on top of a product that is already useful cold.

Execution risk on the differentiation step. The enriched CRM read (step 3) is the single most important piece and the longest, at 3 to 4 weeks, and it touches both CRM clients, the mappers, and the field catalog. Mitigation: the extension points are mapped against real source code and follow an existing precedent (the Apollo enrichment pattern already stores enriched fields and registers them with the field catalog), so this is extending a proven path, not inventing one.

What we are betting on, in one sentence: that the team holding the customer's send decision, with an enforced gate the open-MCP incumbents cannot safely expose and a per-tenant history that compounds, wins the Stripe-native SaaS lane even while conceding Shopify DTC to Klaviyo.
