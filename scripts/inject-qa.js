#!/usr/bin/env node
/*
 * inject-qa.js — appends the community Q&A widget to EVERY built docs page.
 *
 * MAINTENANCE NOTES
 * -----------------
 * Sourcey's page templates live in node_modules with no repo-controlled
 * hook, so this post-build injector is the only every-page injection point
 * we own. It runs from vercel.json's buildCommand:
 *
 *   npx sourcey build && node scripts/inject-qa.js && node scripts/verify-qa-injection.mjs
 *
 * Behaviour:
 * - Idempotent: pages already carrying the MARKER are skipped, so a double
 *   run never double-injects.
 * - Inserts the snippet immediately before the LAST </body> in each file.
 * - Fails loudly (non-zero exit) when dist/ is missing or holds no HTML —
 *   a silent no-op here would ship docs without the widget.
 * - If a Sourcey upgrade ever emits an HTML file without </body>, this
 *   script warns per file and leaves it untouched; the build then FAILS in
 *   verify-qa-injection.mjs unless that file is explicitly allowlisted
 *   there. That is deliberate: injection coverage regressions must be loud.
 *
 * WIDGET INVARIANTS (binding, mirrored by inject-qa.test.mjs)
 * - XSS: every user/LLM-originated string (question bodies, answer bodies,
 *   first names) is inserted via document.createTextNode ONLY. No
 *   innerHTML, no attribute sinks, no CSS interpolation for untrusted
 *   values. The only dynamic attribute is the Ask link's href, built from
 *   the page_key AFTER charset validation (^\/[a-z0-9\-\/]{0,120}$) and
 *   URL-encoding — question/answer/user strings never reach attributes.
 * - page_key normalization mirrors the API: decode percent-encoding once
 *   (invalid encoding -> render nothing), lowercase, collapse repeated
 *   slashes, strip trailing slash then a .html suffix, "/" or "" ->
 *   "/introduction". Keys that still fail validation render nothing.
 * - Fetch/render failure removes only the widget container (the style tag
 *   lives inside the container, so removal is atomic). Docs pages never
 *   break because the Q&A API is down.
 * - Reading is public; asking always deep-links into the signed-in app.
 * - Theme-aware via Sourcey's `.dark` class on <html> (CSS variants only).
 */

const fs = require('fs');
const path = require('path');

const MARKER = 'data-nitro-qa="1"';

// NOTE: WIDGET_SOURCE sits inside a JS template literal — keep the widget
// code free of backticks and "${", and never include a literal
// "</script>" sequence in its strings.
const WIDGET_SOURCE = `(function (w, d) {
  'use strict';

  var API_BASE = 'https://api.nitrosend.com';
  var ASK_BASE = 'https://app.nitrosend.com/learning/community/ask';
  var PAGE_KEY_RE = /^\\/[a-z0-9\\-\\/]{0,120}$/;

  var CSS = '' +
    '.nitro-qa{max-width:48rem;margin:3rem auto 2rem;padding:1.5rem 1rem 0;border-top:1px solid #e7e5e4;font-size:.9375rem;line-height:1.6;color:#44403c}' +
    '.dark .nitro-qa{border-top-color:#292524;color:#d6d3d1}' +
    '.nitro-qa-title{font-size:1.125rem;font-weight:600;margin:0 0 1rem;color:#1c1917}' +
    '.dark .nitro-qa-title{color:#fafaf9}' +
    '.nitro-qa-item{margin:0 0 1.5rem}' +
    '.nitro-qa-meta{font-size:.8125rem;color:#78716c;margin:0 0 .25rem}' +
    '.dark .nitro-qa-meta{color:#a8a29e}' +
    '.nitro-qa-q{font-weight:600;margin:0 0 .5rem;white-space:pre-wrap;color:#1c1917}' +
    '.dark .nitro-qa-q{color:#fafaf9}' +
    '.nitro-qa-answer{margin:0 0 .75rem;padding-left:1rem;border-left:2px solid #e7e5e4}' +
    '.dark .nitro-qa-answer{border-left-color:#292524}' +
    '.nitro-qa-answer-label{font-size:.8125rem;color:#78716c;margin:0 0 .25rem}' +
    '.dark .nitro-qa-answer-label{color:#a8a29e}' +
    '.nitro-qa-answer-body{margin:0;white-space:pre-wrap}' +
    '.nitro-qa-unanswered{font-size:.8125rem;font-style:italic;color:#78716c;margin:0}' +
    '.dark .nitro-qa-unanswered{color:#a8a29e}' +
    '.nitro-qa-empty,.nitro-qa-foot{margin:.5rem 0 0}' +
    '.nitro-qa-ask{color:#ea580c;text-decoration:none;font-weight:500}' +
    '.nitro-qa-ask:hover{text-decoration:underline}';

  function normalizePageKey(pathname) {
    var key = String(pathname == null ? '' : pathname);
    if (key === '') return null;
    try {
      key = decodeURIComponent(key);
    } catch (e) {
      return null;
    }
    key = key.toLowerCase();
    key = key.replace(/\\/+/g, '/');
    key = key.replace(/\\/$/, '');
    key = key.replace(/\\.html$/, '');
    if (key === '' || key === '/') key = '/introduction';
    if (!PAGE_KEY_RE.test(key)) return null;
    return key;
  }

  // The ONLY insertion helpers. Untrusted strings pass exclusively through
  // createTextNode here — never innerHTML, never attributes.
  function el(tag, cls, text) {
    var node = d.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) {
      node.appendChild(d.createTextNode(String(text)));
    }
    return node;
  }

  function askLink(pageKey, label) {
    var a = el('a', 'nitro-qa-ask', label);
    // pageKey is charset-validated above and URL-encoded here; no other
    // dynamic value ever reaches an attribute.
    a.href = ASK_BASE + '?page_key=' + encodeURIComponent(pageKey);
    return a;
  }

  function answerLabel(answer) {
    if (answer.source === 'ai') {
      return answer.verified_at
        ? 'Answered by NitroLLM \\u00b7 verified by the team'
        : 'Answered by NitroLLM \\u00b7 not yet verified';
    }
    var name = answer.author && answer.author.first_name ? answer.author.first_name : 'a community member';
    return 'Answered by ' + name;
  }

  function renderAnswer(answer) {
    var box = el('div', 'nitro-qa-answer');
    box.appendChild(el('p', 'nitro-qa-answer-label', answerLabel(answer)));
    box.appendChild(el('p', 'nitro-qa-answer-body', answer.body));
    return box;
  }

  function renderQuestion(question) {
    var item = el('div', 'nitro-qa-item');
    var name = question.user && question.user.first_name ? question.user.first_name : 'Someone';
    var when = '';
    try {
      when = new Date(question.created_at).toLocaleDateString();
    } catch (e) {
      when = '';
    }
    item.appendChild(el('p', 'nitro-qa-meta', name + (when ? ' \\u00b7 ' + when : '')));
    item.appendChild(el('p', 'nitro-qa-q', question.body));
    var answers = question.answers || [];
    for (var i = 0; i < answers.length; i++) {
      item.appendChild(renderAnswer(answers[i]));
    }
    if (!question.answered) {
      item.appendChild(el('p', 'nitro-qa-unanswered', 'Not answered yet.'));
    }
    return item;
  }

  function render(container, pageKey, questions) {
    container.appendChild(el('h2', 'nitro-qa-title', 'Community Q&A'));
    if (!questions.length) {
      var empty = el('p', 'nitro-qa-empty');
      empty.appendChild(d.createTextNode('No questions about this page yet. '));
      empty.appendChild(askLink(pageKey, 'Ask the first question'));
      container.appendChild(empty);
      return;
    }
    for (var i = 0; i < questions.length; i++) {
      container.appendChild(renderQuestion(questions[i]));
    }
    var foot = el('p', 'nitro-qa-foot');
    foot.appendChild(askLink(pageKey, 'Ask a question about this page'));
    container.appendChild(foot);
  }

  function main() {
    if (typeof w.fetch !== 'function') return Promise.resolve();
    var pageKey = normalizePageKey(w.location && w.location.pathname);
    if (!pageKey) return Promise.resolve();
    var host = d.querySelector('main') || d.body;
    if (!host) return Promise.resolve();

    var container = el('section', 'nitro-qa');
    var style = d.createElement('style');
    style.appendChild(d.createTextNode(CSS));
    container.appendChild(style);
    host.appendChild(container);

    return w.fetch(API_BASE + '/v1/public/questions?page_key=' + encodeURIComponent(pageKey))
      .then(function (res) {
        if (!res || !res.ok) throw new Error('questions request failed');
        return res.json();
      })
      .then(function (payload) {
        render(container, pageKey, (payload && payload.questions) || []);
      })
      .catch(function () {
        // Never break a docs page over the widget: remove it wholesale.
        if (container && typeof container.remove === 'function') container.remove();
      });
  }

  var done = main();
  if (typeof w.__nitroQaOnDone === 'function') w.__nitroQaOnDone(done);
})(window, document);`;

const SNIPPET = '\n<script ' + MARKER + '>\n' + WIDGET_SOURCE + '\n</' + 'script>\n';

function collectHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

function injectFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  if (html.includes(MARKER)) return 'skipped';

  const at = html.lastIndexOf('</body>');
  if (at === -1) {
    console.warn(`[inject-qa] WARNING: ${file} has no </body>; left untouched. ` +
      'The verifier will fail unless this file is allowlisted in verify-qa-injection.mjs.');
    return 'no_body';
  }

  const injected = html.slice(0, at) + SNIPPET + html.slice(at);
  fs.writeFileSync(file, injected);
  return 'injected';
}

function injectDir(distDir) {
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`[inject-qa] dist directory not found: ${distDir} — run the build first.`);
  }
  const files = collectHtmlFiles(distDir);
  if (files.length === 0) {
    throw new Error(`[inject-qa] no HTML files found in ${distDir} — refusing to no-op on an empty build.`);
  }

  const summary = { injected: 0, skipped: 0, no_body: 0, total: files.length };
  for (const file of files) {
    summary[injectFile(file)] += 1;
  }
  return summary;
}

if (require.main === module) {
  const distDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
  try {
    const summary = injectDir(distDir);
    console.log(`[inject-qa] ${summary.total} HTML files: ` +
      `${summary.injected} injected, ${summary.skipped} already injected, ${summary.no_body} without </body>.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { MARKER, WIDGET_SOURCE, SNIPPET, injectDir, collectHtmlFiles };
