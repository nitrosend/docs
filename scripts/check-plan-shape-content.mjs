import { readFileSync } from "node:fs";

const pricing = readFileSync(new URL("../pricing.mdx", import.meta.url), "utf8");
if (!pricing.includes("https://nitrosend.com/PRICING.md") ||
    /Email validation has no included allowance on any plan/.test(pricing)) {
  console.error("pricing.mdx must defer numeric terms to the generated catalog and describe account-specific validation inclusion");
  process.exit(1);
}

console.log("Plan-shape content check passed.");
