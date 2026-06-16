# Handoff: make the MCP email designer first-class

Goal: an AI agent should one-shot a great, on-brand email through the MCP. Today
it can't, it composes blind, documented props silently drop, and the section/
component style model collides. This is the prioritized work to fix that. Every
item below was found by dogfooding the live MCP against a real brand.

## Source of truth (read first)

- `api/app/services/email/renderer.rb` and `api/app/services/email/sections/*.rb`
  (`base.rb` holds the `style_attr_pairs(target: :section|:content)` model).
- `api/app/services/email/style_schema.rb`, `designs/style_normalizer.rb`.
- `api/app/services/email/accessibility_lint.rb` (already resolves button
  background as `props || styles || theme`, the renderer does not, they disagree).
- `api/app/services/ai/email_generator.rb` (emits button color into `styles`).
- `api/app/services/mcp/email_composition_contracts/compiler.rb` (the contract).
- The `nitro://schema` resource and the `nitro_compose_campaign` /
  `nitro_manage_template` / `nitro_review_delivery` / `nitro_set_brand_kit` tools.

## Work items (in priority order)

### 1. Give the agent the rendered result (not just a human preview link)

The `preview_url` is a client-rendered SPA; an agent cannot read it. The server
already produces HTML via `Email::Renderer#to_html`.

- Return the **compiled HTML** in the result of `compose_campaign` (draft),
  `manage_template`, and `review_delivery` (it reports `html_preview: true` and a
  byte size but never the body).
- Add a **computed-style digest**: per section, the final resolved
  color/background/font/padding after theme resolution, plus contrast flags
  (e.g. "button #ff2e88 on band #ff2e88 → 1.0:1, invisible"). Reuse
  `accessibility_lint` and `Email::ColorContrast`.
- Stretch: a server-rendered static HTML or PNG render endpoint the agent can
  fetch. The human `preview_url` stays as-is.

Outcome: the agent self-corrects in-tool and only sends a test when confident,
instead of emailing itself to see the result.

### 2. No silent drops; one precedence everywhere

Right now `props.background_color` (documented) is ignored by the renderer, which
reads `styles`; `border_radius: 12` silently fails because it wants `"12px"`.

- Adopt one precedence, `props || styles || theme`, in the **renderer**, matching
  what `accessibility_lint` already does. The renderer must read `props`.
- In the `validate` path, return a **no-effect inputs** list (keys set but not
  consumed) and **typed coercion errors** ("border_radius expects a CSS length
  like '8px', got 12").

### 3. Decouple the section band from the component

The "merged block" bug: an `mj-section` band and its `mj-button` both read the
same `styles['background_color']`, so coloring the button paints the band
identically, with no way to separate them.

- Separate the section-band styles (`background_color`→band, `padding`) from the
  component's own style namespace in `StyleSchema`/`base.rb`. A component's own
  background must never paint its section wrapper.
- Add a regression test: a button with its own background plus a different
  section background must render two distinct colors.

### 4. The contract must hand over the exact section schema

`nitro_compose_campaign` (composition_mode `intent`) returns `next_call` with
`sections: []` and no shape, so the agent guesses the `{type, props:{...}}`
nesting, the prop names, and the value types, and gets them wrong.

- Embed the **precise section schema and a filled example** for the sections the
  contract expects, inside the contract response, so there is nothing to guess.

### 5. Theme capture that survives dark sites, and is verifiable

`set_brand_kit` scraping captured a **white** background for a near-black site,
so every email was off-brand until set by hand.

- Detect background luminance and capture the real bg/text; capture **primary and
  accent** as separate slots (a vivid CTA color vs a soft link color).
- Return a **swatch/digest** so the agent can confirm the theme against the site
  before composing.

### 6. First-class primitives (stop forcing hand-rolled HTML)

The agent had to build a wordmark and a working button as raw inline `<a>`
because the natives couldn't do it.

- A **text/wordmark header** variant (not logo-image only).
- A **fully styleable button**: `font_weight`, `font_family`, `text_transform`,
  and **table-based bulletproof** rendering for Outlook, baked in.

### 7. Make transactional a first-class path, not a campaign

For a lifecycle email the MCP auto-created a `trigger_event: "manual"` flow,
which is the wrong shape for transactional.

- Surface the **transactional send** (`nitro_send_message` + `data.*` merge tags)
  and **event-triggered flows** as the obvious path for lifecycle email, distinct
  from broadcast campaigns. Do not default lifecycle sends to a manual-trigger
  flow.

## Hard rules

- Keep changes consistent across the three places that resolve style today
  (renderer, `accessibility_lint`, `email_generator`); fixing one and not the
  others reintroduces the disagreement.
- Every renderer change ships with a `renderer_spec` case asserting the resolved
  MJML/HTML attribute.
- No silent behavior: if an input is dropped or coerced, the `validate` path must
  say so.

## Acceptance

- An agent can compose a styled email and read back the compiled HTML + a
  computed-style/contrast digest in the same tool result, no test send required
  to see it.
- A documented prop set by the agent either renders or is reported as no-effect.
- A button and its section band can hold different backgrounds.
- The composition contract carries the exact section schema for its expected
  sections.
- `set_brand_kit` returns a theme the agent can verify, correct on a dark site.
