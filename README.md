# Nitrosend Docs

Public documentation for [Nitrosend](https://nitrosend.com), built with [Sourcey](https://sourcey.com).

Live at: https://docs.nitrosend.com

## Local Development

```bash
npm install
npx sourcey dev
```

Runs at http://localhost:4400.

## Structure

```
sourcey.config.ts      # Sourcey configuration
introduction.mdx       # Landing page
quickstart.mdx         # Getting started guide
authentication.mdx     # API authentication
guides/                # How-to guides
concepts/              # Core concept explanations
integrations/          # MCP + API integration guides
logo/                  # Brand assets (light.svg, dark.svg)
```

The **API Reference** tab is auto-generated from our [OpenAPI spec](https://api.nitrosend.com/openapi.yaml).

## Build

```bash
npx sourcey build
```

Outputs static HTML to `dist/`. Deploy anywhere.

## Custom domain (`docs.nitrosend.com`)

Point a CNAME record for `docs` to wherever the built site is hosted.
