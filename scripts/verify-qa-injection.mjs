#!/usr/bin/env node
// verify-qa-injection.mjs — hard gate after inject-qa.js in the Vercel
// buildCommand. FAILS the build unless EVERY generated HTML file contains
// exactly one widget marker. No grep pipelines, no sampling: zero markers
// (missed injection) and 2+ markers (double injection) are both fatal.
//
// Files that legitimately cannot carry the widget (no </body> — none
// today) must be listed in ALLOWLIST below, by dist-relative path, with a
// reason. Allowlisted files are excused from the exactly-one rule but
// still fail on 2+ markers.
//
// Usage: node scripts/verify-qa-injection.mjs [distDir] [--allow rel/path]...
// (positional distDir + --allow exist for the test harness; production
// runs with no arguments.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Single source of truth for the marker — drift between injector and
// verifier would make the gate lie.
const { MARKER, collectHtmlFiles } = createRequire(import.meta.url)('./inject-qa.js');

// dist-relative paths, e.g. 'some/page.html'. Keep reasons inline.
const ALLOWLIST = [
  // (none — every Sourcey page currently emits </body>)
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const allow = [...ALLOWLIST];
  let distDir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow') {
      allow.push(argv[++i]);
    } else if (!distDir) {
      distDir = argv[i];
    }
  }
  return { distDir: path.resolve(distDir || path.join(scriptDir, '..', 'dist')), allow };
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

const { distDir, allow } = parseArgs(process.argv.slice(2));

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  console.error(`[verify-qa] dist directory not found: ${distDir}`);
  process.exit(1);
}

const files = collectHtmlFiles(distDir);
if (files.length === 0) {
  console.error(`[verify-qa] no HTML files found in ${distDir} — an empty build must not pass.`);
  process.exit(1);
}

const failures = [];
for (const file of files) {
  const rel = path.relative(distDir, file);
  const count = countOccurrences(fs.readFileSync(file, 'utf8'), MARKER);
  const allowlisted = allow.includes(rel);

  if (count === 1) continue;
  if (count === 0 && allowlisted) continue;

  if (count === 0) {
    failures.push(`${rel}: widget marker missing (not injected, not allowlisted)`);
  } else {
    failures.push(`${rel}: ${count} widget markers (double injection)`);
  }
}

if (failures.length > 0) {
  console.error(`[verify-qa] FAILED — ${failures.length} of ${files.length} HTML files are wrong:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`[verify-qa] OK — ${files.length} HTML files each carry exactly one widget marker` +
  (allow.length ? ` (${allow.length} allowlisted)` : '') + '.');
