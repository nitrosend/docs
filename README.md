# Nitrosend Docs

Public documentation for [Nitrosend](https://nitrosend.com), built with [Mintlify](https://mintlify.com).

Live at: https://docs.nitrosend.com

## Local Development

```bash
npx mintlify dev
```

Runs at http://localhost:3000. Requires Node.js 20.17+.

## Structure

```
docs.json              # Mintlify configuration
introduction.mdx       # Landing page
quickstart.mdx         # Getting started guide
authentication.mdx     # API authentication
guides/                # How-to guides
concepts/              # Core concept explanations
logo/                  # Brand assets (light.svg, dark.svg)
```

The **API Reference** tab is auto-generated from our [OpenAPI spec](https://api.nitrosend.com/openapi.yaml).

## Deployment

Pushes to `main` auto-deploy via the Mintlify GitHub App.
