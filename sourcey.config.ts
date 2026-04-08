import { defineConfig } from "sourcey";

export default defineConfig({
  name: "Nitrosend",
  theme: {
    colors: {
      primary: "#6366F1",
      light: "#818CF8",
      dark: "#4F46E5",
    },
  },
  logo: "./logo/light.svg",
  darkLogo: "./logo/dark.svg",
  favicon: "./favicon.svg",
  repo: "https://github.com/Nitrosend/docs",
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
              "integrations/mcp-brand-memory",
            ],
          },
          {
            group: "API Integrations",
            pages: ["integrations/gemini", "integrations/rest-api"],
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
        tab: "API Reference",
        slug: "api",
        openapi: "https://api.nitrosend.com/openapi.yaml",
      },
    ],
  },
  navbar: {
    links: [
      { type: "github", href: "https://github.com/Nitrosend" },
    ],
    primary: {
      type: "button",
      label: "Dashboard",
      href: "https://app.nitrosend.com",
    },
  },
  footer: {
    links: [
      { type: "github", href: "https://github.com/Nitrosend" },
    ],
  },
  redirects: [
    { source: "/api", destination: "/api-reference" },
    { source: "/mcp", destination: "/integrations/overview" },
    { source: "/sdk", destination: "/integrations/rest-api" },
  ],
});
