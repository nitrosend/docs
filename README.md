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

### First-time setup

1. Sign up at [mintlify.com/start](https://mintlify.com/start)
2. Install the [Mintlify GitHub App](https://github.com/apps/mintlify) on the `Nitrosend/docs` repo
3. It auto-deploys to `nitrosend.mintlify.app` on every push to main

### Custom domain (`docs.nitrosend.com`)

Add a CNAME record in Cloudflare pointing `docs` to the target Mintlify provides during setup. Then configure the custom domain in the Mintlify dashboard.

### API Reference

Auto-generated from `api.nitrosend.com/openapi.yaml` — no manual pages needed. Any changes to the OpenAPI spec are reflected automatically.
