import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// cli/reference.mdx is written from the command descriptors @nitrosend/cli
// publishes, so the page lists exactly the commands and options of the pinned
// CLI. The prose around each group is the only hand-written part.
const require = createRequire(import.meta.url);
const contract = JSON.parse(readFileSync(require.resolve("@nitrosend/cli/dist/descriptors.json"), "utf8"));

const GROUPS = [
  ["core", "Core"],
  ["auth", "Auth"],
  ["messages", "Messages"],
  ["contacts", "Contacts", undefined, "To move contacts from another email platform, see [Move from another email platform](/cli/recipes#move-from-another-email-platform). `migrate prepare` works only for a brand where `migrate sources` reports a one-time import (`move_once`), and `migrate status` reads an import it prepared."],
  ["integrations", "Integrations", "Open an integration's setup screen for the brand your CLI profile uses. You finish the connection in the browser."],
  ["data", "Data", "Read-only list commands call `nitro_query` and return paginated rows."],
  ["inbox", "Inbox", "Read and act on the agent inbox. An account without the agent inbox reports that it is not enabled."],
  ["mcp", "MCP", "The CLI is the Nitrosend MCP, callable from a shell. These commands dispatch JSON-RPC over HTTP to the same endpoint chat MCP clients use.", "The full set of available tools (`nitro_get_status`, `nitro_compose_campaign`, …) is documented under the [MCP Tools](/mcp) tab."],
  ["agent", "Agent", "These commands are stable stubs for agent approval handoff."],
  ["fixtures", "Fixtures", "Test commands that exercise destructive safety UX without touching live data."],
  ["release", "Release"]
];

const known = new Set(GROUPS.map(([id]) => id));
const unknown = [...new Set(contract.commands.map((command) => command.group))].filter((group) => !known.has(group));
if (unknown.length > 0) throw new Error(`Name the new command groups in generate-cli-reference.mjs: ${unknown.join(", ")}`);

const cell = (text) => text.replaceAll("|", "\\|");
const sections = GROUPS.flatMap(([id, title, intro, outro]) => {
  const commands = contract.commands.filter((command) => command.group === id);
  if (commands.length === 0) return [];
  return [
    `## ${title}`,
    ...(intro ? [intro] : []),
    ["| Command | Summary |", "|---|---|", ...commands.map((command) => `| \`${cell(command.usage)}\` | ${cell(command.summary)} |`)].join("\n"),
    ...(outro ? [outro] : [])
  ];
});

const options = contract.global_options.map((option) => {
  const flag = `--${option.name}${option.placeholder ? ` ${option.placeholder}` : ""}`;
  return `| \`${cell(flag)}\` | ${cell(option.description ?? "")} |`;
});
const aliases = Object.entries(contract.flag_aliases).map(([alias, name]) => `\`--${alias}\` for \`--${name}\``);

const page = `---
title: Command reference
description: Every Nitrosend CLI command and global option, generated from the CLI's command descriptors
---

# Command reference

This page is generated from the command descriptors of \`@nitrosend/cli\` ${contract.version}. \`nitrosend <command> --help\` prints the same usage and examples, and \`nitrosend describe <command> --json\` returns the full descriptor: every flag with its type and allowed values, which are required, the safety class and the idempotency policy.

<Tip>
  In agent runners, prefer \`nitrosend describe\` over this page. The descriptor returned by the CLI always matches the binary you're running.
</Tip>

${sections.join("\n\n")}

## Global options

Every command takes these.

| Option | Effect |
|---|---|
${options.join("\n")}

Older spellings still work: ${aliases.join(", ")}.

See [Agent mode](/cli/agent-mode) for the full envelope shape and exit code map.
`;

writeFileSync(new URL("../cli/reference.mdx", import.meta.url), page);
console.log(`cli/reference.mdx written from @nitrosend/cli ${contract.version}.`);
