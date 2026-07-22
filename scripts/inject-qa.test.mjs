#!/usr/bin/env node
// inject-qa.test.mjs — zero-dependency tests (node stdlib only) for the
// docs Q&A injection pipeline and the inlined widget's XSS invariant.
// Run: node scripts/inject-qa.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const injectScript = path.join(scriptDir, 'inject-qa.js');
const verifyScript = path.join(scriptDir, 'verify-qa-injection.mjs');
const { MARKER, WIDGET_SOURCE } = createRequire(import.meta.url)('./inject-qa.js');

const PAGE = '<!doctype html><html><head><title>t</title></head><body><main>content</main></body></html>';
const NO_BODY_PAGE = '<!doctype html><html><head><title>t</title></head><main>content</main></html>';

function makeDist(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dist-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function runInject(distDir) {
  return spawnSync(process.execPath, [injectScript, distDir], { encoding: 'utf8' });
}

function runVerify(distDir, extraArgs = []) {
  return spawnSync(process.execPath, [verifyScript, distDir, ...extraArgs], { encoding: 'utf8' });
}

function markerCount(file) {
  const html = fs.readFileSync(file, 'utf8');
  return html.split(MARKER).length - 1;
}

// --- injector -------------------------------------------------------------

test('injects exactly one marker before </body> in every HTML file, nested included', () => {
  const dist = makeDist({ 'index.html': PAGE, 'guides/sending.html': PAGE, 'notes.txt': 'not html' });

  const result = runInject(dist);

  assert.equal(result.status, 0, result.stderr);
  for (const rel of ['index.html', 'guides/sending.html']) {
    const html = fs.readFileSync(path.join(dist, rel), 'utf8');
    assert.equal(markerCount(path.join(dist, rel)), 1, `${rel} should carry one marker`);
    assert.ok(html.indexOf(MARKER) < html.lastIndexOf('</body>'), 'snippet sits before </body>');
    assert.ok(html.trimEnd().endsWith('</html>'), 'document still closes');
  }
  assert.equal(fs.readFileSync(path.join(dist, 'notes.txt'), 'utf8'), 'not html', 'non-HTML untouched');
});

test('is idempotent: a second run never double-injects', () => {
  const dist = makeDist({ 'index.html': PAGE, 'guides/sending.html': PAGE });

  assert.equal(runInject(dist).status, 0);
  const second = runInject(dist);

  assert.equal(second.status, 0);
  assert.match(second.stdout, /2 already injected/);
  assert.equal(markerCount(path.join(dist, 'index.html')), 1);
  assert.equal(markerCount(path.join(dist, 'guides/sending.html')), 1);
});

test('fails loudly when dist is missing', () => {
  const result = runInject(path.join(os.tmpdir(), 'qa-definitely-missing-dist'));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not found/);
});

test('fails loudly when dist holds no HTML files', () => {
  const dist = makeDist({ 'llms.txt': 'text only' });

  const result = runInject(dist);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no HTML files/);
});

test('warns on a </body>-less file and leaves it untouched', () => {
  const dist = makeDist({ 'index.html': PAGE, 'weird.html': NO_BODY_PAGE });

  const result = runInject(dist);

  assert.equal(result.status, 0);
  assert.match(result.stderr, /weird\.html/);
  assert.match(result.stderr, /no <\/body>/);
  assert.equal(fs.readFileSync(path.join(dist, 'weird.html'), 'utf8'), NO_BODY_PAGE);
  assert.equal(markerCount(path.join(dist, 'index.html')), 1);
});

// --- verifier -------------------------------------------------------------

test('verifier passes a fully injected dist', () => {
  const dist = makeDist({ 'index.html': PAGE, 'guides/sending.html': PAGE });
  runInject(dist);

  const result = runVerify(dist);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exactly one widget marker/);
});

test('verifier fails when any file has zero markers', () => {
  const dist = makeDist({ 'index.html': PAGE, 'guides/sending.html': PAGE });
  runInject(dist);
  fs.writeFileSync(path.join(dist, 'guides', 'sending.html'), PAGE); // regress one file

  const result = runVerify(dist);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sending\.html: widget marker missing/);
});

test('verifier fails when any file has two or more markers', () => {
  const dist = makeDist({ 'index.html': PAGE });
  runInject(dist);
  const file = path.join(dist, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, html.replace('</body>', `<script ${MARKER}></` + 'script></body>'));

  const result = runVerify(dist);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index\.html: 2 widget markers/);
});

test('verifier fails a </body>-less file unless explicitly allowlisted', () => {
  const dist = makeDist({ 'index.html': PAGE, 'weird.html': NO_BODY_PAGE });
  runInject(dist);

  const without = runVerify(dist);
  assert.notEqual(without.status, 0);
  assert.match(without.stderr, /weird\.html: widget marker missing/);

  const withAllow = runVerify(dist, ['--allow', 'weird.html']);
  assert.equal(withAllow.status, 0, withAllow.stderr);
});

test('verifier fails on a missing or empty dist', () => {
  assert.notEqual(runVerify(path.join(os.tmpdir(), 'qa-definitely-missing-dist')).status, 0);

  const empty = makeDist({ 'llms.txt': 'no html here' });
  const result = runVerify(empty);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no HTML files/);
});

// --- widget DOM (XSS invariant) ------------------------------------------

// Minimal hand-rolled DOM stub. innerHTML/outerHTML setters THROW: the
// widget completing at all proves no HTML sink was used for any value.
class StubNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.className = '';
    this.parent = null;
  }

  appendChild(node) {
    node.parent = this;
    this.children.push(node);
    return node;
  }

  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
    this.removed = true;
  }

  set innerHTML(_value) {
    throw new Error('XSS invariant violated: innerHTML assignment');
  }

  get innerHTML() {
    throw new Error('XSS invariant violated: innerHTML read/write is out of bounds');
  }

  set outerHTML(_value) {
    throw new Error('XSS invariant violated: outerHTML assignment');
  }

  set insertAdjacentHTML(_value) {
    throw new Error('XSS invariant violated: insertAdjacentHTML');
  }
}

function textNodes(node, out = []) {
  if (node.nodeType === 3) {
    out.push(node.textContent);
    return out;
  }
  for (const child of node.children || []) textNodes(child, out);
  return out;
}

function elementNodes(node, out = []) {
  if (node.nodeType === 1) {
    out.push(node);
    for (const child of node.children) elementNodes(child, out);
  }
  return out;
}

function buildSandbox({ pathname, payload }) {
  const body = new StubNode('body');
  const main = new StubNode('main');
  body.appendChild(main);

  const document = {
    body,
    createElement: (tag) => new StubNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    querySelector: (selector) => (selector === 'main' ? main : null)
  };

  let ready = Promise.resolve();
  const window = {
    location: { pathname },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }),
    __nitroQaOnDone: (promise) => { ready = promise; }
  };

  return { window, document, main, body, ready: () => ready };
}

function runWidget(sandboxParts) {
  const context = {
    window: sandboxParts.window,
    document: sandboxParts.document,
    Promise,
    Date,
    encodeURIComponent,
    decodeURIComponent,
    String,
    Error,
    console
  };
  vm.runInNewContext(WIDGET_SOURCE, context);
  return sandboxParts.ready();
}

const HOSTILE_QUESTION = '<img src=x onerror=alert(1)>';
const HOSTILE_ANSWER = '</scr' + 'ipt><scr' + 'ipt>alert("pwn")</scr' + 'ipt>';
const HOSTILE_NAME = '<svg onload=alert(2)>';

const hostilePayload = {
  questions: [
    {
      id: 1,
      body: HOSTILE_QUESTION,
      page_key: '/quickstart',
      created_at: '2026-07-22T04:12:00Z',
      user: { first_name: HOSTILE_NAME },
      answered: true,
      answers: [
        {
          id: 2,
          body: HOSTILE_ANSWER,
          source: 'ai',
          verified_at: null,
          created_at: '2026-07-22T04:13:00Z',
          author: null
        }
      ]
    }
  ]
};

test('widget renders hostile strings strictly as text nodes', async () => {
  const parts = buildSandbox({ pathname: '/quickstart', payload: hostilePayload });

  await runWidget(parts);

  const texts = textNodes(parts.body);
  assert.ok(texts.includes(HOSTILE_QUESTION), 'question body is a text node');
  assert.ok(texts.includes(HOSTILE_ANSWER), 'answer body is a text node');
  assert.ok(texts.some((t) => t.includes(HOSTILE_NAME)), 'first name is inside a text node');

  // No hostile value may reach an attribute-like sink.
  for (const element of elementNodes(parts.body)) {
    const href = element.href || '';
    assert.ok(!href.includes('<'), `href stayed clean: ${href}`);
    assert.ok(!String(element.className).includes('<'), 'className stayed clean');
  }
});

test('widget URL-encodes the page_key into the Ask deep link only', async () => {
  const parts = buildSandbox({ pathname: '/Guides//Sending-Emails.html/', payload: { questions: [] } });

  await runWidget(parts);

  const links = elementNodes(parts.body).filter((element) => element.tagName === 'A');
  assert.equal(links.length, 1, 'quiet empty state renders exactly one ask link');
  assert.ok(links[0].href.endsWith('?page_key=' + encodeURIComponent('/guides/sending-emails')), links[0].href);
});

test('widget page_key normalization matrix matches the API', async () => {
  const cases = [
    ['/quickstart', '/quickstart'],
    ['/QuickStart.html', '/quickstart'],
    ['/guides//sending-emails/', '/guides/sending-emails'],
    ['/%71uickstart', '/quickstart'],
    ['/', '/introduction']
  ];

  for (const [pathname, expected] of cases) {
    const parts = buildSandbox({ pathname, payload: { questions: [] } });
    await runWidget(parts);
    const links = elementNodes(parts.body).filter((element) => element.tagName === 'A');
    assert.equal(links.length, 1, `${pathname} mounts`);
    assert.ok(
      links[0].href.endsWith('?page_key=' + encodeURIComponent(expected)),
      `${pathname} -> ${expected} (got ${links[0].href})`
    );
  }
});

test('widget renders nothing for keys that stay invalid after normalization', async () => {
  for (const pathname of ['/%3Cscript%3E', '/spaced path', '/%ZZbroken', '/' + 'a'.repeat(140)]) {
    const parts = buildSandbox({ pathname, payload: { questions: [] } });
    await runWidget(parts);
    assert.equal(parts.main.children.length, 0, `${pathname} must not mount the widget`);
  }
});

test('widget removes its container (style included) when the fetch fails', async () => {
  const parts = buildSandbox({ pathname: '/quickstart', payload: { questions: [] } });
  parts.window.fetch = () => Promise.reject(new Error('network down'));

  await runWidget(parts);

  assert.equal(parts.main.children.length, 0, 'container removed on fetch failure');
});

test('widget removes its container on a non-OK response', async () => {
  const parts = buildSandbox({ pathname: '/quickstart', payload: { questions: [] } });
  parts.window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) });

  await runWidget(parts);

  assert.equal(parts.main.children.length, 0, 'container removed on non-OK response');
});

test('widget labels AI answers and their verification state', async () => {
  const verified = JSON.parse(JSON.stringify(hostilePayload));
  verified.questions[0].answers[0].verified_at = '2026-07-22T05:00:00Z';
  const parts = buildSandbox({ pathname: '/quickstart', payload: verified });

  await runWidget(parts);

  const texts = textNodes(parts.body);
  assert.ok(texts.some((t) => t.includes('Answered by NitroLLM') && t.includes('verified by the team')));
});
