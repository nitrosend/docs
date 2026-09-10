import { readFileSync } from "node:fs";

const pricing = readFileSync(new URL("../pricing.mdx", import.meta.url), "utf8");
const expected = "| **Free** | $0 | 8,000 starter budget, then 500/mo | 3 | 1 | 100 / 500 / 5,000 | 1 |";
const stale = /\| \*\*Free\*\* \|[^\n]+\| 50 \| 1 \|/;

if (!pricing.includes(expected) || stale.test(pricing)) {
  console.error("pricing.mdx does not expose the approved Free cohort allowances");
  process.exit(1);
}

console.log("Plan-shape content check passed.");
