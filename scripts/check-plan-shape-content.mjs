import { readFileSync, readdirSync } from "node:fs";

const pricing = readFileSync(new URL("../pricing.mdx", import.meta.url), "utf8");
if (!pricing.includes("https://nitrosend.com/PRICING.md") ||
    /Email validation has no included allowance on any plan/.test(pricing)) {
  console.error("pricing.mdx must defer numeric terms to the generated catalog and describe account-specific validation inclusion");
  process.exit(1);
}

function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["node_modules", "dist"].includes(entry.name)) continue;
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) checkDirectory(path);
    else if (/\.mdx?$/.test(entry.name) &&
        /\b(?:8,000 free emails|8,000 emails (?:up front|to start)|Pro and (?:above|up))\b/i.test(readFileSync(path, "utf8"))) {
      throw new Error(`${path.pathname}: retired pricing claim; use current pricing`);
    }
  }
}

checkDirectory(new URL("../", import.meta.url));

console.log("Plan-shape content check passed.");
