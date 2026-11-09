// Audit → repair → re-render → re-audit loop. Every applied fix is verified against the final audit.

import { mount, audit, summarize, screenReaderView, buildRenderHtml } from './audit.js';
import { FIXERS, FIX_ORDER, CUSTOM_RULES, customChecks, resetIds } from './fixers.js';

export { buildRenderHtml };

export function isFragment(source) {
  return !/<(html|head|body)[\s>]/i.test(source) && !/<!doctype/i.test(source);
}

function stripIds(root) {
  for (const e of root.querySelectorAll('[data-ppid]')) e.removeAttribute('data-ppid');
  root.documentElement?.removeAttribute?.('data-ppid');
  return root;
}

export function serialize(doc, fragment) {
  const clone = stripIds(doc.cloneNode(true));
  if (fragment) {
    const headBits = [...clone.head.children].map(c => c.outerHTML).join('\n');
    return (headBits ? headBits + '\n' : '') + clone.body.innerHTML;
  }
  return (doc.doctype ? '<!DOCTYPE html>\n' : '') + clone.documentElement.outerHTML + '\n';
}

const snippet = el => {
  if (!el) return '';
  const c = el.cloneNode(true);
  if (c.nodeType === 1) { c.removeAttribute('data-ppid'); c.querySelectorAll?.('[data-ppid]').forEach(e => e.removeAttribute('data-ppid')); }
  let h = c.outerHTML || '';
  if (el.tagName === 'HTML') h = h.slice(0, h.indexOf('>') + 1);
  return h.length > 360 ? h.slice(0, 359) + '…' : h;
};

function customAsViolations(found) {
  const by = new Map();
  for (const { rule, el } of found) {
    if (!by.has(rule)) by.set(rule, { rule, ...CUSTOM_RULES[rule], description: CUSTOM_RULES[rule].help, custom: true, nodes: [] });
    by.get(rule).nodes.push({ ppid: el.getAttribute('data-ppid'), html: snippet(el), element: null, data: [] });
  }
  return [...by.values()];
}

const RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const order = rule => { const i = FIX_ORDER.indexOf(rule); return i < 0 ? FIX_ORDER.length : i; };

/**
 * @param {string} source  HTML document or fragment
 * @param {object} opts    { baseUrl, overrides: { [fixId]: { value } | { reject: true } }, captioner, onProgress, maxPasses }
 */
export async function run(source, opts = {}) {
  const t0 = performance.now();
  const { overrides = {}, captioner = null, onProgress = () => {}, maxPasses = 4 } = opts;
  if (typeof source !== 'string' || !source.trim()) throw new Error('Nothing to check — paste some HTML first.');
  if (source.length > 3_000_000) throw new Error('That document is over 3 MB. Paste a single page or component.');
  resetIds();
  const fragment = isFragment(source);
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const baseUrl = opts.baseUrl || doc.querySelector('base[href]')?.getAttribute('href') || null;
  let seq = 0;
  const adopt = root => { for (const e of [root, ...root.querySelectorAll('*')]) if (!e.hasAttribute('data-ppid')) e.setAttribute('data-ppid', String(++seq)); };
  adopt(doc.documentElement);
  const normalized = serialize(doc, fragment);
  const auditOpts = { baseUrl, fragment, loadTimeout: opts.loadTimeout, cssProxy: opts.cssProxy || null };
  const warnings = [];

  onProgress('Rendering and auditing the original');
  let m = await mount(doc, auditOpts);
  let res;
  try {
    res = await audit(m.win, auditOpts);
  } catch (e) { m.iframe.remove(); throw e; }
  const beforeViolations = [...res.violations, ...customAsViolations(customChecks(doc))].sort((a, b) => RANK[b.impact] - RANK[a.impact]);
  const before = { violations: beforeViolations.map(stripElements), incomplete: res.incomplete.map(stripElements), summary: summarize(beforeViolations) };
  const srBefore = screenReaderView(m.win);
  const boxesBefore = layoutBoxes(m.win);

  const records = new Map();
  const rejectedGroups = new Set();
  const ctxBase = { doc, fragment, baseUrl, captioner, adopt, memo: {}, warn: w => warnings.push(w) };
  let passes = 0;

  for (let pass = 1; pass <= maxPasses; pass++) {
    passes = pass;
    const byPpid = new Map([...doc.querySelectorAll('[data-ppid]')].map(e => [e.getAttribute('data-ppid'), e]));
    const renderByPpid = new Map([...m.win.document.querySelectorAll('[data-ppid]')].map(e => [e.getAttribute('data-ppid'), e]));
    const items = [];
    for (const v of res.violations) for (const n of v.nodes) {
      const el = n.ppid && byPpid.get(n.ppid);
      if (el) items.push({ v, n, el });
    }
    for (const v of customAsViolations(customChecks(doc))) for (const n of v.nodes) {
      items.push({ v, n: { ...n, element: renderByPpid.get(n.ppid) || null }, el: byPpid.get(n.ppid) });
    }
    items.sort((a, b) => order(a.v.rule) - order(b.v.rule));
    ctxBase.memo.outline = null;
    const ctx = { ...ctxBase, pass, win: m.win };
    let changed = 0;
    for (const { v, n, el } of items) {
      const fixer = FIXERS[v.rule];
      if (!fixer || !el || !el.isConnected) continue;
      onProgress(`Pass ${pass}: ${v.rule}`);
      let plan;
      try { plan = await fixer(el, n, { ...ctx, attempt: records.get(`${v.rule}@${el.getAttribute('data-ppid')}`)?.attempts || 0 }); } catch (e) { warnings.push(`${v.rule}: ${e.message}`); continue; }
      if (!plan) continue;
      const target = plan.target || el;
      const id = `${v.rule}@${target.getAttribute('data-ppid')}`;
      const prev = records.get(id);
      if (prev && (prev.status !== 'applied' || v.rule !== 'color-contrast')) continue;
      const ov = overrides[id];
      const base = {
        id, rule: v.rule, help: v.help, impact: v.impact, wcag: v.wcag, level: v.level, helpUrl: v.helpUrl, custom: !!v.custom,
        reason: plan.reason, method: plan.method, confidence: plan.confidence, editable: plan.editable || null,
        suggested: plan.value, before: snippet(target), pass,
      };
      if (ov?.reject || (plan.group && rejectedGroups.has(plan.group))) {
        if (plan.group) rejectedGroups.add(plan.group);
        records.set(id, { ...base, status: 'rejected', value: plan.value, ...(ov?.reject ? {} : { reason: 'Shares a stylesheet rule with a fix you rejected' }) });
        continue;
      }
      const userValue = ov && 'value' in ov;
      if (plan.requiresInput && !userValue) { records.set(id, { ...base, status: 'needs-input', value: '' }); continue; }
      if (plan.optIn && !userValue) { records.set(id, { ...base, status: 'suggested', value: plan.value }); continue; }
      const value = userValue ? ov.value : plan.value;
      try { plan.apply(value); } catch (e) { warnings.push(`${v.rule}: ${e.message}`); continue; }
      adopt(doc.documentElement);
      records.set(id, {
        ...base, status: 'applied', value, userEdited: userValue,
        needsReview: !userValue && (plan.confidence !== 'high' || plan.method === 'ai'),
        after: snippet(target.isConnected ? target : null) || '(element replaced)',
        targetPpid: target.getAttribute('data-ppid'),
        attempts: (prev?.attempts || 0) + 1,
      });
      changed++;
    }
    if (!changed) break;
    m.iframe.remove();
    onProgress(`Re-auditing after pass ${pass}`);
    m = await mount(doc, auditOpts);
    res = await audit(m.win, auditOpts);
  }

  // Verification: an applied fix counts as verified only if the final audit no longer reports
  // that rule on the element (or anything inside it).
  const finalCustom = customAsViolations(customChecks(doc));
  const afterViolations = [...res.violations, ...finalCustom].sort((a, b) => RANK[b.impact] - RANK[a.impact]);
  const byPpid = new Map([...doc.querySelectorAll('[data-ppid]')].map(e => [e.getAttribute('data-ppid'), e]));
  const failing = new Map();
  for (const v of afterViolations) for (const n of v.nodes) {
    if (!failing.has(v.rule)) failing.set(v.rule, []);
    const el = byPpid.get(n.ppid);
    if (el) failing.get(v.rule).push(el);
  }
  for (const r of records.values()) {
    if (r.status !== 'applied') continue;
    const target = byPpid.get(r.targetPpid);
    const still = (failing.get(r.rule) || []).some(el => target && (target === el || target.contains(el)));
    r.verified = !still;
  }

  const srAfter = screenReaderView(m.win);
  const layout = compareLayout(boxesBefore, layoutBoxes(m.win));
  m.iframe.remove();
  const output = serialize(doc, fragment);
  const fixes = [...records.values()].sort((a, b) => RANK[b.impact] - RANK[a.impact] || order(a.rule) - order(b.rule));
  return {
    fragment, baseUrl, passes, warnings,
    ms: Math.round(performance.now() - t0),
    normalized, output,
    before,
    after: { violations: afterViolations.map(stripElements), incomplete: res.incomplete.map(stripElements), summary: summarize(afterViolations) },
    fixes,
    screenReader: { before: srBefore, after: srAfter },
    cssPatch: ctxBase.memo.cssPatch || [],
    layout,
  };
}

function stripElements(v) {
  return { ...v, nodes: v.nodes.map(({ element, ...n }) => ({ ...n, html: (n.html || '').replace(/ data-ppid="\d+"/g, '') })) };
}

// Layout preservation: position and size of every original visible element, before vs after.
function layoutBoxes(win) {
  const boxes = new Map();
  for (const el of win.document.querySelectorAll('body [data-ppid]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    boxes.set(el.getAttribute('data-ppid'), [r.left + win.scrollX, r.top + win.scrollY, r.width, r.height]);
  }
  boxes.brokenImages = [...win.document.images].filter(i => i.complete && i.naturalWidth === 0 && i.getAttribute('src')).length;
  return boxes;
}

function compareLayout(before, after) {
  let compared = 0, moved = 0;
  const examples = [];
  for (const [id, a] of before) {
    const b = after.get(id);
    if (!b) continue;
    compared++;
    if (a.some((v, i) => Math.abs(v - b[i]) > 2)) { moved++; if (examples.length < 3) examples.push({ id, before: a.map(Math.round), after: b.map(Math.round) }); }
  }
  return { compared, moved, unchanged: compared ? (compared - moved) / compared : 1, brokenImages: before.brokenImages || 0, examples };
}
