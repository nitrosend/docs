import { defineConfig } from "sourcey";

export default defineConfig({
  name: "Nitrosend",
  prettyUrls: "strip",
  theme: {
    colors: {
      primary: "#FF4D00",
      light: "#FF6B2C",
      dark: "#CC3D00",
    },
  },
  logo: {
    light: "./logo/light.svg",
    dark: "./logo/dark.svg",
    href: "https://nitrosend.com",
  },
  favicon: "./favicon.svg",
  repo: "https://github.com/nitrosend/docs",
  editBranch: "main",
  search: {
    featured: ["introduction", "quickstart", "authentication"],
  },
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        groups: [
          {
            group: "Getting Started",
            pages: ["introduction", "quickstart", "authentication"],
          },
          {
            group: "MCP Integrations",
            pages: [
              "integrations/overview",
              "integrations/claude-desktop",
              "integrations/claude-cowork",
              "integrations/claude-code",
              "integrations/cursor",
              "integrations/chatgpt",
              "integrations/codex",
              "integrations/gemini",
              "integrations/vscode",
              "integrations/windsurf",
              "integrations/zed",
              "integrations/mcp-brand-memory",
            ],
          },
          {
            group: "API Integrations",
            pages: ["integrations/rest-api", "integrations/vercel-ai-sdk"],
          },
          {
            group: "Guides",
            pages: [
              "guides/sending-emails",
              "guides/managing-contacts",
              "guides/building-flows",
              "guides/creating-campaigns",
            ],
          },
          {
            group: "Concepts",
            pages: [
              "concepts/contacts",
              "concepts/templates",
              "concepts/flows",
              "concepts/campaigns",
              "concepts/segments",
            ],
          },
        ],
      },
      {
        tab: "MCP Tools",
        slug: "mcp",
        mcp: "./nitrosend.mcp.json",
      },
      {
        tab: "CLI",
        slug: "cli",
        groups: [
          {
            group: "Get Started",
            pages: ["cli/overview", "cli/install"],
          },
          {
            group: "Operating",
            pages: ["cli/agent-mode", "cli/project-config", "cli/recipes"],
          },
          {
            group: "Reference",
            pages: ["cli/reference"],
          },
        ],
      },
      {
        tab: "API Reference",
        slug: "api",
        openapi: "https://api.nitrosend.com/openapi.yaml",
      },
    ],
  },
  navbar: {
    links: [],
    primary: {
      type: "button",
      label: "Dashboard",
      href: "https://app.nitrosend.com",
    },
  },
  footer: {
    links: [
      { type: "github", href: "https://github.com/nitrosend" },
    ],
  },
  redirects: [
    { source: "/api", destination: "/api-reference" },
    { source: "/mcp", destination: "/integrations/overview" },
    { source: "/sdk", destination: "/integrations/rest-api" },
  ],
});
