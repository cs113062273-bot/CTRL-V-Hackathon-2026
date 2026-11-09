#!/usr/bin/env node
// Evaluation: does PasteProof remove real barriers without breaking pages?
// Corpus = the 4 bundled samples + W3C WAI "Before and After Demonstration" (BAD) pages, an
// independent, deliberately inaccessible site. Baseline = W3C's own expert-remediated "after" pages.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEngine } from '../lib/headless.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'eval', '.cache');
const BAD = 'https://www.w3.org/WAI/demos/bad/';
const BAD_PAGES = ['home', 'news', 'tickets', 'survey'];
const SAMPLES = ['clinic-booking', 'benefits-application', 'school-portal', 'transit-widget'];
// Real public-service pages (snapshotted on first run into eval/.cache; CSS and images load live).
const REAL = ['https://news.ycombinator.com/', 'https://www.getcalfresh.org/', 'https://www.lausd.org/', 'https://www.chicago.gov/city/en.html', 'https://www.gov.tw/', 'https://www.irs.gov/', 'https://www.nyc.gov/', 'https://www.foodpantries.org/', 'https://www.211.org/', 'https://www.sfusd.edu/', 'https://www.craigslist.org/about/sites', 'https://www.healthcare.gov/', 'https://www.lib.berkeley.edu/', 'https://www.feedingamerica.org/'];
const ONLY = process.argv[2] ? new RegExp(process.argv[2]) : null;

async function cached(url) {
  await mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, url.replace(/[^a-z0-9]+/gi, '_') + '.html');
  if (existsSync(file)) return readFile(file, 'utf8');
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36 PasteProof-eval' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const html = await res.text();
  await writeFile(file, html);
  return html;
}

function words(html) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
function textPreserved(a, b) {
  const bag = new Map();
  for (const w of words(b)) bag.set(w, (bag.get(w) || 0) + 1);
  const orig = words(a);
  let kept = 0;
  for (const w of orig) if (bag.get(w) > 0) { kept++; bag.set(w, bag.get(w) - 1); }
  return orig.length ? kept / orig.length : 1;
}

const engine = await startEngine();
const rows = [];
try {
  const corpus = [
    ...SAMPLES.map(s => ({ name: `sample/${s}`, load: () => readFile(path.join(ROOT, 'public/samples', s + '.html'), 'utf8'), base: `${engine.origin}/samples/` })),
    ...BAD_PAGES.map(p => ({ name: `w3c-bad/${p}`, load: () => cached(`${BAD}before/${p}.html`), base: `${BAD}before/${p}.html`, expert: () => cached(`${BAD}after/${p}.html`), expertBase: `${BAD}after/${p}.html` })),
    ...REAL.map(u => ({ name: 'real/' + new URL(u).hostname.replace(/^www\./, ''), load: () => cached(u), base: u })),
  ].filter(c => !ONLY || ONLY.test(c.name));
  for (const item of corpus) {
    let html, r;
    try {
      html = await item.load();
      r = await engine.fix(html, { baseUrl: item.base });
    } catch (e) { console.log(`${item.name.padEnd(30)} ERROR ${e.message}`); rows.push({ page: item.name, error: e.message }); continue; }
    const applied = r.fixes.filter(f => f.status === 'applied');
    const beforeRules = new Set(r.before.violations.map(v => v.rule));
    const introduced = r.after.violations.filter(v => !beforeRules.has(v.rule)).map(v => `${v.rule}×${v.nodes.length}`);
    const axeOnly = list => list.filter(v => !v.custom).reduce((n, v) => n + v.nodes.length, 0);
    const axeWcag = list => list.filter(v => !v.custom && v.level !== 'Best practice').reduce((n, v) => n + v.nodes.length, 0);
    const row = {
      page: item.name,
      beforeAxe: axeOnly(r.before.violations), afterAxe: axeOnly(r.after.violations),
      beforeAxeWcag: axeWcag(r.before.violations), afterAxeWcag: axeWcag(r.after.violations),
      before: r.before.summary.instances, beforeWcag: r.before.summary.wcagInstances,
      after: r.after.summary.instances, afterWcag: r.after.summary.wcagInstances,
      critSeriousBefore: r.before.summary.byImpact.critical + r.before.summary.byImpact.serious,
      critSeriousAfter: r.after.summary.byImpact.critical + r.after.summary.byImpact.serious,
      fixes: applied.length, verified: applied.filter(f => f.verified).length,
      review: applied.filter(f => f.needsReview).length, needsInput: r.fixes.filter(f => f.status === 'needs-input').length,
      introducedRules: introduced,
      textPreserved: +textPreserved(r.normalized, r.output).toFixed(4),
      ms: r.ms,
      layoutUnchanged: +r.layout.unchanged.toFixed(4), layoutMoved: r.layout.moved, layoutCompared: r.layout.compared, brokenImages: r.layout.brokenImages,
      suggested: r.fixes.filter(f => f.status === 'suggested').length,
      afterExclSuggested: r.after.summary.instances - r.fixes.filter(f => f.status === 'suggested').length,
      remaining: r.after.violations.map(v => `${v.rule}×${v.nodes.length}`),
    };
    if (item.expert) {
      const e = await engine.fix(await item.expert(), { baseUrl: item.expertBase, overrides: {} });
      row.expertAll = e.before.summary.instances;
      row.expertAxe = axeOnly(e.before.violations);
      row.expertWcag = axeWcag(e.before.violations);
      row.expertRules = e.before.violations.filter(v => !v.custom).map(v => `${v.rule}×${v.nodes.length}`);
    }
    rows.push(row);
    console.log(`${row.page.padEnd(30)} ${String(row.before).padStart(4)} → ${String(row.after).padStart(3)}  (WCAG ${row.beforeWcag} → ${row.afterWcag})  fixes ${row.fixes}, verified ${row.verified}, review ${row.review}, input ${row.needsInput}, text kept ${(row.textPreserved * 100).toFixed(1)}%, layout kept ${(row.layoutUnchanged * 100).toFixed(1)}%${row.brokenImages ? ` (${row.brokenImages} images failed to load)` : ''}, opt-in ${row.suggested}, ${row.ms} ms${row.expertAxe !== undefined ? `  | axe-only: ours ${row.afterAxe} (WCAG ${row.afterAxeWcag}) vs W3C expert ${row.expertAxe} (WCAG ${row.expertWcag})` : ''}${introduced.length ? '  NEW: ' + introduced.join(', ') : ''}`);
  }
} finally {
  await engine.close();
}

const failed = rows.filter(r => r.error);
rows.splice(0, rows.length, ...rows.filter(r => !r.error));
const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
const totals = {
  pages: rows.length, failedToLoad: failed.map(r => r.page),
  minLayoutUnchanged: Math.min(...rows.map(r => r.layoutUnchanged)), before: sum('before'), after: sum('after'), beforeWcag: sum('beforeWcag'), afterWcag: sum('afterWcag'),
  critSeriousBefore: sum('critSeriousBefore'), critSeriousAfter: sum('critSeriousAfter'),
  fixes: sum('fixes'), verified: sum('verified'), review: sum('review'), needsInput: sum('needsInput'),
  suggested: sum('suggested'), afterExclSuggested: sum('afterExclSuggested'),
  minLayoutUnchangedAllImagesLoaded: Math.min(...rows.filter(r => !r.brokenImages).map(r => r.layoutUnchanged)),
  pagesWithBrokenImages: rows.filter(r => r.brokenImages).map(r => `${r.page} (${r.brokenImages} images failed, layout kept ${(r.layoutUnchanged * 100).toFixed(1)}%)`),
  pagesWithNewRules: rows.filter(r => r.introducedRules.length).length,
  minTextPreserved: Math.min(...rows.map(r => r.textPreserved)),
  medianMs: rows.map(r => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
};
const bad = rows.filter(r => r.expertAxe !== undefined);
for (const k of ['beforeAxe', 'afterAxe', 'beforeAxeWcag', 'afterAxeWcag', 'expertAxe', 'expertWcag', 'suggested']) totals['bad_' + k] = bad.reduce((s, r) => s + r[k], 0);
console.log('\nTotals', totals);
await writeFile(path.join(ROOT, 'eval', 'results.json'), JSON.stringify({ generated: new Date().toISOString(), totals, rows }, null, 2));
console.log('Wrote eval/results.json');
