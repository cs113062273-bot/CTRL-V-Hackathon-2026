#!/usr/bin/env node
// PasteProof local server: static UI, vendored libraries, and a guarded fetch proxy for URLs/images.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser } from './lib/browser.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const VENDOR = {
  'axe.min.js': path.join(ROOT, 'node_modules/axe-core/axe.min.js'),
  'diff.min.js': path.join(ROOT, 'node_modules/diff/dist/diff.min.js'),
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const ALLOW_PRIVATE = process.env.PASTEPROOF_ALLOW_PRIVATE === '1';

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublic(url) {
  let u;
  try { u = new URL(url); } catch { throw httpError(400, 'That is not a valid URL.'); }
  if (!/^https?:$/.test(u.protocol)) throw httpError(400, 'Only http and https URLs can be fetched.');
  if (ALLOW_PRIVATE) return u;
  const addrs = await lookup(u.hostname, { all: true }).catch(() => { throw httpError(502, `Could not resolve ${u.hostname}.`); });
  if (addrs.some(a => isPrivate(a.address))) throw httpError(403, 'Private and local network addresses are blocked. Set PASTEPROOF_ALLOW_PRIVATE=1 to audit a local dev server.');
  return u;
}

function httpError(status, message) { return Object.assign(new Error(message), { status }); }

async function guardedFetch(url, { accept, maxBytes, kind }) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current);
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': 'PasteProof/1.0 (accessibility checker)', accept },
      signal: AbortSignal.timeout(15000),
    }).catch(e => { throw httpError(502, `Could not reach the site: ${e.cause?.code || e.message}`); });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      continue;
    }
    if (!res.ok) throw httpError(502, `The site answered ${res.status} ${res.statusText}.`);
    const type = res.headers.get('content-type') || '';
    if (kind === 'html' && !/html|xml|text\/plain/i.test(type)) throw httpError(415, `Expected an HTML page but got ${type || 'unknown content'}.`);
    if (kind === 'image' && !/^image\//i.test(type)) throw httpError(415, 'Not an image.');
    if (kind === 'css' && /html|javascript|image|font/i.test(type)) throw httpError(415, 'Not a stylesheet.');
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { reader.cancel(); throw httpError(413, `Response is larger than ${maxBytes / 1e6} MB.`); }
      chunks.push(value);
    }
    return { body: Buffer.concat(chunks), type, finalUrl: current };
  }
  throw httpError(508, 'Too many redirects.');
}

// Render a page in headless Chrome so JavaScript-built content (React, Vue, …) is captured.
// Every request the page makes is checked against the same private-network guard.
let browserPromise = null;
async function getBrowser() {
  const exe = findBrowser({ optional: true });
  if (!exe) throw new Error('no browser');
  if (!browserPromise) {
    browserPromise = import('puppeteer-core').then(({ default: puppeteer }) => puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-first-run', '--disable-extensions'] }));
    browserPromise.catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

async function renderPage(target) {
  await assertPublic(target);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', async req => {
      try {
        if (!/^https?:/.test(req.url())) return req.url().startsWith('data:') ? req.continue() : req.abort();
        await assertPublic(req.url());
        req.continue();
      } catch { req.abort().catch(() => {}); }
    });
    const response = await page.goto(target, { waitUntil: 'networkidle2', timeout: 20000 }).catch(e => { if (/timeout/i.test(e.message)) return null; throw httpError(502, `Could not load the page: ${e.message.split('\n')[0]}`); });
    if (response && !response.ok()) throw httpError(502, `The site answered ${response.status()}.`);
    const html = await page.evaluate(() => (document.doctype ? '<!DOCTYPE html>\n' : '') + document.documentElement.outerHTML);
    if (html.length > 3e6) throw httpError(413, 'Rendered page is larger than 3 MB.');
    return { url: page.url(), html };
  } finally {
    page.close().catch(() => {});
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
  res.end(body);
}

async function serveFile(res, file, cache) {
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    send(res, 200, await readFile(file), TYPES[path.extname(file)] || 'application/octet-stream', { 'cache-control': cache });
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, JSON.stringify({ error: 'Method not allowed' }));
      if (url.pathname === '/api/health') return send(res, 200, JSON.stringify({ ok: true, renderer: !!findBrowser({ optional: true }) }));
      if (url.pathname === '/api/fetch') {
        const target = url.searchParams.get('url');
        if (!target) throw httpError(400, 'Missing url parameter.');
        if (url.searchParams.get('render') !== '0') {
          const rendered = await renderPage(target).catch(e => ({ error: e }));
          if (!rendered.error) return send(res, 200, JSON.stringify({ ...rendered, rendered: true }));
          if (rendered.error.status) throw rendered.error;
        }
        const { body, finalUrl } = await guardedFetch(target, { accept: 'text/html,application/xhtml+xml', maxBytes: 3e6, kind: 'html' });
        return send(res, 200, JSON.stringify({ url: finalUrl, html: body.toString('utf8'), rendered: false }));
      }
      if (url.pathname === '/api/css') {
        const target = url.searchParams.get('url');
        if (!target) throw httpError(400, 'Missing url parameter.');
        const { body, finalUrl } = await guardedFetch(target, { accept: 'text/css,*/*;q=0.1', maxBytes: 3e6, kind: 'css' });
        // Keep fonts/images/imports pointing at the original site.
        const css = body.toString('utf8')
          .replace(/url\(\s*(['"]?)(?!data:|#)([^'")]+)\1\s*\)/gi, (m, q, ref) => { try { return `url(${q}${new URL(ref, finalUrl).href}${q})`; } catch { return m; } })
          .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, ref) => { try { return `@import ${q}${new URL(ref, finalUrl).href}${q}`; } catch { return m; } });
        return send(res, 200, css, 'text/css; charset=utf-8', { 'cache-control': 'max-age=600' });
      }
      if (url.pathname === '/api/image') {
        const target = url.searchParams.get('url');
        if (!target) throw httpError(400, 'Missing url parameter.');
        const { body, type } = await guardedFetch(target, { accept: 'image/*', maxBytes: 10e6, kind: 'image' });
        return send(res, 200, body, type, { 'cache-control': 'max-age=3600' });
      }
      if (url.pathname.startsWith('/vendor/')) {
        const file = VENDOR[url.pathname.slice(8)];
        return file ? serveFile(res, file, 'max-age=86400') : send(res, 404, 'Not found', 'text/plain');
      }
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.normalize(path.join(PUBLIC, rel));
      if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
      return serveFile(res, file, 'no-cache');
    } catch (e) {
      return send(res, e.status || 500, JSON.stringify({ error: e.status ? e.message : 'Internal error' }));
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5173;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`PasteProof running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
  const shutdown = async () => { try { (await browserPromise)?.close(); } catch { /* not started */ } process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
