import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// cli/flags.mdx is written from the command descriptors @nitrosend/cli
// publishes, so the page lists exactly the flags, types, safety classes and
// idempotency policies of the pinned CLI. cli/reference.mdx lists the commands
// and the global options; this page is the per-command detail the descriptors
// carry but the summary table cannot show.
//
// The generator never fails the build: a descriptor shape it does not
// recognise is rendered as-is and an unreadable descriptor file leaves the
// committed page untouched.
const require = createRequire(import.meta.url);

const OUT = new URL("../cli/flags.mdx", import.meta.url);

const GROUP_ORDER = [
  ["core", "Core"],
  ["auth", "Auth"],
  ["messages", "Messages"],
  ["contacts", "Contacts"],
  ["data", "Data"],
  ["inbox", "Inbox"],
  ["mcp", "MCP"],
  ["agent", "Agent"],
  ["fixtures", "Fixtures"],
  ["release", "Release"],
];

const cell = (text) => String(text ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");

const placeholders = (usage) => {
  const found = new Map();
  for (const match of String(usage ?? "").matchAll(/\[--([a-z0-9-]+)(?: [<]([^>\]]+)[>\]])?\]/g)) {
    found.set(match[1], match[2] ?? "");
  }
  return found;
};

const flagsOf = (command) => {
  const flags = command?.input_schema?.properties?.flags;
  const properties = flags?.properties ?? {};
  const required = new Set(flags?.required ?? []);
  return Object.entries(properties).map(([name, spec]) => ({
    name,
    type: spec?.type ?? "string",
    required: required.has(name),
    enum: spec?.enum,
    description: spec?.description,
    placeholder: placeholders(command.usage).get(name) ?? "",
  }));
};

const isPlaceholderOnly = (flag) => {
  const description = String(flag.description ?? "").trim();
  if (description.length === 0) return true;
  if (flag.placeholder && description === flag.placeholder) return true;
  return /^[<[].*[>\]]$/.test(description);
};

const readContract = () => {
  try {
    return JSON.parse(readFileSync(require.resolve("@nitrosend/cli/dist/descriptors.json"), "utf8"));
  } catch (error) {
    console.warn(`cli/flags.mdx left unchanged: ${error.message}`);
    return null;
  }
};

const contract = readContract();
if (contract) {
  const commands = Array.isArray(contract.commands) ? contract.commands : [];
  const known = new Set(GROUP_ORDER.map(([id]) => id));
  const extraGroups = [...new Set(commands.map((command) => command.group))].filter((group) => !known.has(group));
  const groups = [...GROUP_ORDER, ...extraGroups.map((id) => [id, id])];

  const allFlags = commands.flatMap((command) =>
    flagsOf(command).map((flag) => ({ ...flag, command: command.name })),
  );
  const undocumented = allFlags.filter((flag) => !String(flag.description ?? "").trim());
  const placeholderOnly = allFlags.filter(
    (flag) => String(flag.description ?? "").trim() && isPlaceholderOnly(flag),
  );
  const described = allFlags.length - undocumented.length - placeholderOnly.length;
  const commandsWithFlags = commands.filter((command) => flagsOf(command).length > 0).length;

  const sections = groups.flatMap(([id, title]) => {
    const groupCommands = commands.filter((command) => command.group === id);
    if (groupCommands.length === 0) return [];
    return [
      `## ${title}`,
      ...groupCommands.flatMap((command) => {
        const flags = flagsOf(command);
        const safety = command.safety ?? {};
        const idempotency = command.idempotency?.mode ?? "none";
        const cache = command.cache?.mode ?? "none";
        const rows = flags.map((flag) => {
          const label = flag.placeholder ? `--${flag.name} <${flag.placeholder}>` : `--${flag.name}`;
          const allowed = flag.enum ? flag.enum.map((value) => `\`${cell(value)}\``).join(", ") : "—";
          return `| \`${label}\` | ${flag.type} | ${flag.required ? "yes" : "no"} | ${allowed} | ${cell(flag.description) || "—"} |`;
        });
        const examples = (command.examples ?? []).map((example) => `- ${cell(example.description)} — \`${cell(example.command)}\``);
        return [
          `### \`${cell(command.usage)}\``,
          cell(command.summary),
          rows.length > 0
            ? ["| Flag | Type | Required | Allowed values | Description |", "|---|---|---|---|---|", ...rows].join("\n")
            : "This command takes no flags of its own.",
          `Safety class \`${cell(safety.class ?? "unknown")}\` · dry-run ${safety.supports_dry_run ? "supported" : "not supported"} · confirmation ${safety.requires_confirmation ? "required" : "not required"} · idempotency \`${cell(idempotency)}\` · cache \`${cell(cache)}\`${command.cache?.ttl_seconds ? ` (${command.cache.ttl_seconds}s)` : ""}.`,
          examples.length > 0 ? ["Examples:", ...examples].join("\n") : "",
        ]
          .filter((part) => part !== "")
          .join("\n\n");
      }),
    ];
  });

  const page = `---
title: Flag reference
description: Every per-command flag, type, safety class and idempotency policy, generated from the CLI command descriptors
---

# Flag reference

This page is generated from the command descriptors of \`@nitrosend/cli\` ${contract.version}, the same source the [command reference](/cli/reference) is generated from. It lists the flags each command accepts, their types, whether they are required, the allowed values, and the safety class, idempotency policy and cache mode the command runs with.

<Tip>
  \`nitrosend describe <command> --json\` returns the same descriptor for the binary you are running, including the input schema this page is generated from.
</Tip>

${sections.join("\n\n")}

## Coverage

This page covers ${commands.length} commands and ${allFlags.length} per-command flags, plus ${contract.global_options?.length ?? 0} global options. ${commandsWithFlags} commands take at least one flag.

${described} of the ${allFlags.length} per-command flags carry a description of their own. ${placeholderOnly.length} carry only their value placeholder as the description, and ${undocumented.length} carry no description at all, so \`--help\` and this page can show their type but not what they do:

${undocumented.map((flag) => `- \`--${flag.name}\` (\`${flag.type}\`${flag.placeholder ? `, \`${cell(flag.placeholder)}\`` : ""}) on \`${cell(flag.command)}\``).join("\n")}

Flag descriptions live in the command descriptors in \`@nitrosend/cli\`; adding one there is what makes it appear here and in \`nitrosend <command> --help\`.
`;

  writeFileSync(OUT, page);
  console.log(`cli/flags.mdx written from @nitrosend/cli ${contract.version}: ${commands.length} commands, ${allFlags.length} flags, ${undocumented.length} without a description.`);
}
