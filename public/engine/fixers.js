// Source-level repairs keyed by axe-core rule id (plus PasteProof's own checks).
// A fixer inspects the failing element and returns a *plan*:
//   { value, apply(value), reason, method: 'rule'|'heuristic'|'ai', confidence: 'high'|'medium'|'low',
//     editable?: 'text'|'color'|'lang', requiresInput?: true }
// The pipeline decides whether to apply it (user overrides / rejections) and records the result.

import { parseColor, toHex, repairColor, contrast, isNeutralExtreme } from './color.js';
import { detectLanguage } from './lang.js';
import { iconLabel, humanizeIdentifier, labelFromHref, altFromFilename, isVagueLinkText, autocompleteToken, looksDecorative } from './names.js';

const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable=true]';
const clip = (s, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function tokensOf(el) {
  const parts = [];
  const add = e => {
    parts.push(e.getAttribute('class') || '', e.id || '', e.getAttribute('name') || '', e.getAttribute('data-icon') || '');
    const src = e.getAttribute('src');
    if (src && !src.startsWith('data:')) parts.push(src.split('/').pop());
    const use = e.getAttribute('href') || e.getAttribute('xlink:href');
    if (e.tagName.toLowerCase() === 'use' && use) parts.push(use);
  };
  add(el);
  el.querySelectorAll('*').forEach(add);
  return parts.join(' ');
}

let uid = 0;
function ensureId(el, prefix) {
  if (!el.id) {
    const doc = el.ownerDocument;
    let id;
    do { id = `${prefix}-${++uid}`; } while (doc.getElementById(id));
    el.id = id;
  }
  return el.id;
}
export function resetIds() { uid = 0; }

const setAttr = (el, name) => v => el.setAttribute(name, v);

/** Set one declaration in the style attribute without re-serialising the others (keeps hex notation). */
export function setStyle(el, prop, value, important = false) {
  const decls = (el.getAttribute('style') || '').split(';').map(d => d.trim()).filter(d => d && d.split(':')[0].trim().toLowerCase() !== prop);
  decls.push(`${prop}: ${value}${important ? ' !important' : ''}`);
  el.setAttribute('style', decls.join('; '));
}

// ---------- names for interactive controls ----------

function inferControlName(el, kind) {
  const title = el.getAttribute('title')?.trim();
  if (title) return { value: title, method: 'rule', confidence: 'high', reason: 'Copied from the title tooltip' };
  const svgTitle = el.querySelector('svg title, svg desc');
  if (svgTitle && text(svgTitle)) return { value: text(svgTitle), method: 'rule', confidence: 'high', reason: 'Taken from the SVG <title>' };
  const imgAlt = [...el.querySelectorAll('img[alt]')].map(i => i.getAttribute('alt').trim()).find(Boolean);
  if (imgAlt) return { skip: true }; // already named via its image
  const tokens = tokensOf(el);
  if (kind === 'link' && /\blogo/i.test(tokens)) {
    const site = ctx_site(el.ownerDocument);
    if (site) return { value: `${site} home`, method: 'heuristic', confidence: 'medium', reason: 'Linked logo: named after the site it returns to' };
  }
  const icon = iconLabel(tokens);
  const BRANDS = /^(Twitter|Facebook|Instagram|LinkedIn|YouTube|GitHub|TikTok|WhatsApp)$/;
  if (icon) return { value: icon, method: 'heuristic', confidence: BRANDS.test(icon) ? 'high' : 'medium', reason: `Inferred from icon markup ("${clip(tokens.trim().split(/\s+/).find(t => iconLabel(t)) || tokens.trim(), 40)}")` };
  if (kind === 'link') {
    const fromHref = labelFromHref(el.getAttribute('href'));
    if (fromHref) return { value: fromHref, method: 'heuristic', confidence: /^(Twitter|X \(Twitter\)|Facebook|Instagram|LinkedIn|YouTube|GitHub|TikTok|WhatsApp|Pinterest|Reddit)$|^(Email|Call) /.test(fromHref) ? 'high' : 'medium', reason: `Inferred from the link destination (${clip(el.getAttribute('href'), 50)})` };
  }
  const handler = (el.getAttribute('onclick') || '').match(/^\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/);
  if (handler && !/^(void|function|toggle|handle|on|click|go|do|fn|cb)$/i.test(handler[1])) {
    const h = humanizeIdentifier(handler[1].replace(/^(handle|on|do)(?=[A-Z])/, ''));
    if (h) return { value: h, method: 'heuristic', confidence: 'low', reason: `Derived from its click handler ${handler[1]}()` };
  }
  if (kind === 'button' && el.closest('form') && (el.getAttribute('type') || 'submit') === 'submit') {
    return { value: 'Submit', method: 'heuristic', confidence: 'low', reason: 'Submit button of a form; no other clues available' };
  }
  const ident = humanizeIdentifier(el.id || el.getAttribute('name'));
  if (ident) return { value: ident, method: 'heuristic', confidence: 'low', reason: `Derived from the identifier "${el.id || el.getAttribute('name')}"` };
  return null;
}

function ctx_site(doc) {
  const og = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (og) return og.trim();
  const t = (doc.title || '').split(/\s[|\-–—:]\s/).map(x => x.trim()).filter(Boolean);
  return t.length > 1 ? t[t.length - 1] : t[0] || '';
}

function decorativeInControl(el) {
  const host = el.parentElement?.closest('a,button,[role=button],[role=link],label,summary');
  if (host) {
    const clone = host.cloneNode(true);
    clone.querySelectorAll('svg,img,[role=img]').forEach(n => n.remove());
    if (text(clone)) return { value: 'true', method: 'rule', confidence: 'high', reason: `Icon inside a control that already has text ("${clip(text(clone), 40)}"); hid it from screen readers`, apply: () => el.setAttribute('aria-hidden', 'true') };
  }
  const sib = [...(el.parentElement?.childNodes || [])].filter(n => n !== el).map(n => n.textContent).join(' ').trim();
  if (sib && sib.length <= 120 && el.parentElement?.children.length <= 3) return { value: 'true', method: 'heuristic', confidence: 'medium', reason: `Icon next to the text "${clip(sib, 40)}"; treated as decorative`, apply: () => el.setAttribute('aria-hidden', 'true') };
  return null;
}

function namePlan(kind) {
  return el => {
    if (kind === 'img') { const deco = decorativeInControl(el); if (deco) return deco; }
    const guess = inferControlName(el, kind);
    if (guess?.skip) return null;
    if (guess) return { ...guess, editable: 'text', apply: setAttr(el, 'aria-label') };
    return { value: '', editable: 'text', requiresInput: true, method: 'rule', confidence: 'low', reason: 'No usable clue in the markup — describe what this control does', apply: setAttr(el, 'aria-label') };
  };
}

// ---------- form field labels ----------

function shortText(el) {
  if (!el || el.querySelector?.('input,select,textarea,button')) return null;
  const t = el.nodeType === 3 ? el.textContent.replace(/\s+/g, ' ').trim() : text(el);
  return t && t.length <= 80 ? t.replace(/[:：]\s*$/, '') : null;
}

function adjacentLabel(el) {
  const doc = el.ownerDocument;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const after = type === 'checkbox' || type === 'radio';
  const sibling = dir => {
    let n = dir < 0 ? el.previousSibling : el.nextSibling;
    while (n && ((n.nodeType === 3 && !n.textContent.trim()) || (n.nodeType === 1 && n.tagName === 'BR'))) n = dir < 0 ? n.previousSibling : n.nextSibling;
    return n;
  };
  for (const dir of after ? [1, -1] : [-1]) {
    const n = sibling(dir);
    if (!n) continue;
    if (n.nodeType === 1 && n.matches(INTERACTIVE)) continue;
    const t = shortText(n);
    if (!t) continue;
    if (n.nodeType === 1 && n.tagName === 'LABEL' && !n.getAttribute('for')) return { node: n, text: t, isLabel: true };
    if (n.nodeType === 1 && n.tagName === 'LABEL') continue;
    return { node: n, text: t };
  }
  const cell = el.closest('td,th');
  if (cell) {
    let prev = cell.previousElementSibling;
    if (prev && shortText(prev)) return { node: prev, text: shortText(prev) };
  }
  const parent = el.parentElement;
  if (parent && parent !== doc.body && parent.querySelectorAll('input,select,textarea').length === 1) {
    const own = [...parent.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (own && own.length <= 80) {
      const tn = [...parent.childNodes].find(c => c.nodeType === 3 && c.textContent.trim());
      return { node: tn, text: own.replace(/[:：]\s*$/, '') };
    }
  }
  return null;
}

function fieldLabel(el) {
  const adj = adjacentLabel(el);
  if (adj) {
    const { node, text: t } = adj;
    return {
      value: t, editable: 'text', method: 'heuristic', confidence: 'medium',
      reason: adj.isLabel ? 'Connected the neighbouring <label> to this field' : 'Linked the visible text next to the field as its label',
      apply: v => {
        if (v !== t) { el.setAttribute('aria-label', v); return; }
        if (adj.isLabel) { node.setAttribute('for', ensureId(el, 'pp-field')); return; }
        if (node.nodeType === 3) { el.setAttribute('aria-label', t); return; }
        const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        ids.push(ensureId(node, 'pp-label'));
        el.setAttribute('aria-labelledby', ids.join(' '));
      },
    };
  }
  const type = (el.getAttribute('type') || el.tagName).toLowerCase();
  if (type === 'search') return { value: 'Search', editable: 'text', method: 'rule', confidence: 'high', reason: 'Search field', apply: setAttr(el, 'aria-label') };
  const ident = humanizeIdentifier(el.getAttribute('name') || el.id);
  if (ident) return { value: ident, editable: 'text', method: 'heuristic', confidence: 'low', reason: `No visible label; derived from field name "${el.getAttribute('name') || el.id}"`, apply: setAttr(el, 'aria-label') };
  return { value: '', editable: 'text', requiresInput: true, method: 'rule', confidence: 'low', reason: 'No label, name, or nearby text — enter the field\'s label', apply: setAttr(el, 'aria-label') };
}

// ---------- images ----------

function resolveUrl(src, base) {
  try { return new URL(src, base || undefined).href; } catch { return null; }
}

async function imageAlt(el, node, ctx) {
  const r = node.element;
  const src = el.getAttribute('src') || '';
  const w = r?.naturalWidth || parseInt(el.getAttribute('width')) || 0;
  const h = r?.naturalHeight || parseInt(el.getAttribute('height')) || 0;
  const tokens = `${el.getAttribute('class') || ''} ${el.id} ${src.split('/').pop()}`.toLowerCase().replace(/[_\-./]/g, ' ');
  const apply = setAttr(el, 'alt');
  const base = { editable: 'text', apply };
  if ((w && h && w <= 3 && h <= 3) || /\b(spacer|pixel|tracking|blank|shim|divider|separator|ornament|decor|decoration|decorative|flourish)\b/.test(tokens)) {
    return { ...base, value: '', method: 'rule', confidence: 'high', reason: 'Spacer, tracking pixel or ornament — marked decorative so screen readers skip it' };
  }
  const host = el.closest('a,button');
  if (host && text(host)) {
    return { ...base, value: '', method: 'rule', confidence: 'high', reason: `The ${host.tagName === 'A' ? 'link' : 'button'} already has text ("${clip(text(host), 40)}"); the image is redundant` };
  }
  if (!host) {
    const box = r?.getBoundingClientRect?.();
    const bw = box?.width || w, bh = box?.height || h;
    const small = Math.min(bw, bh), large = Math.max(bw, bh);
    const sameSrc = src ? [...ctx.doc.querySelectorAll('img')].filter(i => i.getAttribute('src') === src && !i.closest('a,button')).length : 0;
    if (looksDecorative(src, el.getAttribute('class'))) {
      return { ...base, value: '', method: 'heuristic', confidence: large && large <= 48 ? 'high' : 'medium', reason: `File name "${clip(src.split('/').pop(), 40)}" describes page furniture (border, slice, bullet…) — marked decorative` };
    }
    if (small > 0 && small <= 10 && large >= small * 4) {
      return { ...base, value: '', method: 'heuristic', confidence: 'high', reason: `${Math.round(bw)}×${Math.round(bh)}px strip — a layout slice, marked decorative` };
    }
    if (sameSrc >= 3 && large > 0 && large <= 32) {
      return { ...base, value: '', method: 'heuristic', confidence: 'medium', reason: `Small image repeated ${sameSrc}× on the page — used as a bullet or ornament, marked decorative` };
    }
  }
  const caption = el.closest('figure')?.querySelector('figcaption');
  let ai = null;
  if (ctx.captioner && src) {
    const url = resolveUrl(src, ctx.baseUrl);
    if (url && /^(https?:|data:image\/)/.test(url)) {
      try { ai = await ctx.captioner(url); } catch (e) { ctx.warn?.(`Alt-text model could not read ${clip(src, 60)}: ${e.message}`); }
    }
  }
  const fileAlt = altFromFilename(src);
  // SVG images carry real text (<title>, <text>): read it instead of guessing.
  let svgText = null;
  if (/\.svg(\?|#|$)/i.test(src) || /^data:image\/svg/i.test(src)) {
    try {
      const url = resolveUrl(src, ctx.baseUrl || undefined);
      const res = url && await fetch(url);
      if (res?.ok) {
        const svg = new DOMParser().parseFromString(await res.text(), 'image/svg+xml');
        const t = (svg.querySelector('title')?.textContent || [...svg.querySelectorAll('text')].map(x => x.textContent).join(' ')).replace(/\s+/g, ' ').trim();
        if (t && t.length <= 80) svgText = t;
      }
    } catch { /* cross-origin or unreadable: fall through */ }
  }
  const isLogo = /\blogo\b/.test(tokens);
  if (host) {
    const dest = labelFromHref(host.getAttribute('href'));
    const logo = /\blogo\b/.test(tokens);
    if (svgText) return { ...base, value: isLogo ? `${svgText} home` : svgText, method: 'rule', confidence: 'high', reason: 'Linked SVG: used the text inside the image file' };
    if (logo) {
      const site = ctx_site(ctx.doc);
      const v = site ? `${site} home` : (dest || 'Home');
      return { ...base, value: v, method: 'heuristic', confidence: 'medium', reason: 'Linked logo — alt text names the link destination' };
    }
    const icon = iconLabel(tokens);
    if (icon) return { ...base, value: icon, method: 'heuristic', confidence: 'medium', reason: 'Icon is the only content of a link; alt text names the action' };
    const pathDest = dest && !/\./.test(dest) ? dest : null;
    let homeLink = false;
    try { const u = new URL(host.getAttribute('href'), ctx.baseUrl || 'https://relative.invalid/'); homeLink = /^\/?(index\.\w+)?$/.test(u.pathname) && (!ctx.baseUrl || u.hostname === new URL(ctx.baseUrl).hostname || u.hostname === 'relative.invalid'); } catch { /* */ }
    const site = ctx_site(ctx.doc);
    if (homeLink && site) return { ...base, value: `${site} home`, method: 'heuristic', confidence: 'medium', reason: 'Image-only link to the home page: named after the site' };
    if (pathDest || fileAlt || dest) return { ...base, value: pathDest || fileAlt || dest, method: 'heuristic', confidence: 'low', reason: 'Only content of a link; alt text must describe where it goes' };
  }
  if (caption && text(caption)) return { ...base, value: clip(text(caption), 120), method: 'rule', confidence: 'medium', reason: 'Matched the figure caption' };
  const title = el.getAttribute('title')?.trim();
  if (title) return { ...base, value: title, method: 'rule', confidence: 'medium', reason: 'Copied from the title tooltip' };
  if (svgText) return { ...base, value: isLogo && !/logo/i.test(svgText) ? `${svgText} logo` : svgText, method: 'rule', confidence: 'high', reason: 'Used the text inside the SVG file' };
  if (ai) return { ...base, value: ai, method: 'ai', confidence: 'medium', reason: 'Described by the on-device vision model (Florence-2) — check it conveys the image\'s purpose' };
  if (fileAlt) return { ...base, value: fileAlt, method: 'heuristic', confidence: 'low', reason: `Derived from the file name "${clip(src.split('/').pop(), 40)}"` };
  return { ...base, value: '', requiresInput: true, method: 'rule', confidence: 'low', reason: 'No caption, title or meaningful file name. Describe the image, or confirm it is decorative' };
}

// ---------- contrast ----------

// Find the author stylesheet rule (in a <style> element of the document) that sets `prop` on the element.
function findStyleRule(renderEl, prop, ctx) {
  const sheets = [];
  for (const sheet of ctx.win.document.styleSheets) {
    const owner = sheet.ownerNode;
    if (!owner || !/^(STYLE|LINK)$/.test(owner.tagName) || !owner.getAttribute('data-ppid')) continue;
    try { sheets.push({ owner, rules: [...sheet.cssRules] }); } catch { /* unreadable sheet */ }
  }
  const inlineSets = el => new RegExp(`(^|;)\s*${prop}\s*:`, 'i').test(el.getAttribute('style') || '') || (prop === 'color' && el.tagName === 'FONT' && el.hasAttribute('color'));
  // Colour is inherited: walk up to the nearest element whose own rules set it (verified later in the CSSOM).
  for (let el = renderEl; el && el.tagName !== 'HTML'; el = prop === 'color' ? el.parentElement : null) {
    if (inlineSets(el)) return null;
    let hit = null;
    for (const { owner, rules } of sheets) for (const rule of rules) {
      if (rule.type !== 1 || !rule.style.getPropertyValue(prop)) continue;
      try { if (el.matches(rule.selectorText)) hit = { rule, owner }; } catch { /* unsupported selector */ }
    }
    if (hit) return hit;
  }
  return null;
}

const normSel = sel => sel.replace(/\s+/g, ' ').replace(/\s*([>+~,])\s*/g, '$1').trim().toLowerCase();

/** Replace `prop` in the last source block whose selector equals `selector`. Returns new text or null. */
function rewriteRule(cssText, selector, prop, value) {
  const masked = cssText.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
  const want = normSel(selector);
  // `background: #4da3ff` (a lone colour in the shorthand) is treated like background-color.
  const names = prop === 'background-color' ? 'background-color|background(?=\\s*:\\s*(?:#[0-9a-f]{3,8}|rgba?\\([^)]*\\)|[a-z]+)\\s*(?:!important\\s*)?(?:;|$))' : prop;
  const declRe = new RegExp(`(^|[;{\\s])(${names})(\\s*:\\s*)([^;!}]+)`, 'i');
  let target = null;
  for (const m of masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (normSel(m[1]) === want && declRe.test(m[2])) target = { start: m.index + m[1].length + 1, body: m[2] };
  }
  if (!target) return null;
  const body = cssText.slice(target.start, target.start + target.body.length);
  const replaced = body.replace(declRe, (all, pre, name, colon, val) => `${pre}${name}${colon}${value}${/\s$/.test(val) ? ' ' : ''}`);
  return cssText.slice(0, target.start) + replaced + cssText.slice(target.start + target.body.length);
}

// The colour comes from an external stylesheet we cannot edit in place: add an equally specific
// override rule (verified in the CSSOM to win the cascade) and record a patch for the source file.
function externalRuleFix({ node, ctx, rule, owner, prop, hex, ratio, key, edits, inline }) {
  const pri = rule.style.getPropertyPriority(prop) ? ' !important' : '';
  const win = ctx.win;
  const probe = win.document.createElement('style');
  probe.textContent = `${rule.selectorText}{${prop}:${hex}${pri}}`;
  win.document.head.append(probe);
  const controls = toHex(parseColor(win.getComputedStyle(node.element)[prop]) || { r: -1, g: -1, b: -1 }) === hex;
  probe.remove();
  if (!controls) return inline;
  const file = owner.getAttribute('data-pp-href') || owner.getAttribute('href');
  const oldRaw = rule.style.getPropertyValue(prop);
  const old = parseColor(oldRaw) ? toHex(parseColor(oldRaw)) : oldRaw;
  const affected = win.document.querySelectorAll(rule.selectorText).length;
  return {
    value: hex, editable: 'color', method: 'rule', confidence: 'high', group: key,
    reason: `${ratio}. The colour comes from ${file.split('/').pop().split('?')[0]} (\`${rule.selectorText}\`${affected > 1 ? `, ${affected} elements` : ''}); added one override rule and a CSS patch for that file`,
    apply: v => {
      let sheet = ctx.doc.getElementById('pasteproof-fixes');
      if (!sheet) {
        sheet = ctx.doc.createElement('style');
        sheet.id = 'pasteproof-fixes';
        sheet.textContent = '/* Accessibility fixes by PasteProof. Better: apply the CSS patch to the original stylesheet and delete this block. */\n';
        ctx.doc.head.append(sheet);
        ctx.adopt(sheet);
      }
      sheet.textContent += `${rule.selectorText} { ${prop}: ${v}${pri}; }\n`;
      edits.set(key, { pass: ctx.pass, value: v });
      (ctx.memo.cssPatch ||= []).push({ file, selector: rule.selectorText, property: prop, from: old, to: v });
    },
  };
}

function colorContrast(el, node, ctx) {
  const d = node.data.find(c => c.id === 'color-contrast' || c.id === 'color-contrast-enhanced')?.data;
  if (!d || !d.fgColor || !d.bgColor) return null;
  const fg = parseColor(d.fgColor), bg = parseColor(d.bgColor);
  if (!fg || !bg) return null;
  const target = parseFloat(String(d.expectedContrastRatio).split(':')[0]) || 4.5;
  const cs = node.element && ctx.win.getComputedStyle(node.element);
  const own = cs && parseColor(cs.backgroundColor);
  let prop = 'color', from = fg, against = bg;
  if (own && own.a > 0.95 && isNeutralExtreme(fg)) { prop = 'background-color'; from = bg; against = fg; }
  const fixed = repairColor(from, against, target);
  if (!fixed) return null;
  const hex = toHex(fixed.color);
  const ratio = `${contrast(fg, bg).toFixed(2)}:1 → ${fixed.ratio.toFixed(2)}:1 (needs ${target}:1). ${prop === 'color' ? 'Text' : 'Background'} ${toHex(from)} → ${hex}, same hue`;
  const inline = { value: hex, editable: 'color', method: 'rule', confidence: 'high', reason: ratio, apply: v => setStyle(el, prop, v, ctx.attempt > 0) };

  // Prefer editing the stylesheet rule that sets the colour: one clean change instead of many inline styles.
  const hit = node.element && ctx.attempt === 0 && findStyleRule(node.element, prop, ctx);
  if (!hit) return inline;
  const { rule, owner } = hit;
  const styleEl = ctx.doc.querySelector(`[data-ppid="${owner.getAttribute('data-ppid')}"]`);
  if (!styleEl) return inline;
  const edits = (ctx.memo.cssEdits ||= new Map());
  const key = `${owner.getAttribute('data-ppid')}|${normSel(rule.selectorText)}|${prop}`;
  const prior = edits.get(key);
  if (prior && prior.pass === ctx.pass) {
    return { value: prior.value, method: 'rule', confidence: 'high', group: key, reason: `Covered by the same stylesheet fix: ${rule.selectorText} { ${prop}: ${prior.value} }`, apply: () => {} };
  }
  if (prior) return inline; // rule already edited in an earlier pass but this element still fails (different background)
  if (owner.tagName === 'LINK') return externalRuleFix({ el, node, ctx, rule, owner, prop, hex, ratio, key, edits, inline });
  // Verify in the live CSSOM that this rule really controls the element's colour.
  const old = rule.style.getPropertyValue(prop), pri = rule.style.getPropertyPriority(prop);
  rule.style.setProperty(prop, hex, pri);
  const controls = toHex(parseColor(ctx.win.getComputedStyle(node.element)[prop]) || { r: -1, g: -1, b: -1 }) === hex;
  rule.style.setProperty(prop, old, pri);
  if (!controls || !rewriteRule(styleEl.textContent, rule.selectorText, prop, hex)) return inline;
  const affected = ctx.win.document.querySelectorAll(rule.selectorText).length;
  return {
    value: hex, editable: 'color', method: 'rule', confidence: 'high', group: key,
    reason: `${ratio}. Edited the stylesheet rule \`${rule.selectorText}\`${affected > 1 ? ` (used by ${affected} elements)` : ''} instead of adding inline styles`,
    apply: v => {
      const next = rewriteRule(styleEl.textContent, rule.selectorText, prop, v);
      if (next === null) { setStyle(el, prop, v); return; }
      styleEl.textContent = next;
      edits.set(key, { pass: ctx.pass, value: v });
    },
  };
}

// ---------- document level ----------

const LANG_NAMES = { english: 'en', spanish: 'es', espanol: 'es', español: 'es', french: 'fr', francais: 'fr', français: 'fr', german: 'de', deutsch: 'de', chinese: 'zh', japanese: 'ja', korean: 'ko', portuguese: 'pt', italian: 'it', dutch: 'nl', russian: 'ru', arabic: 'ar', hindi: 'hi', vietnamese: 'vi' };

function langPlan(el, ctx) {
  const current = (el.getAttribute('lang') || '').trim();
  const mapped = LANG_NAMES[current.toLowerCase()] || (/^[a-z]{2,3}([_-][a-z0-9]{2,8})*$/i.test(current) ? current.replace(/_/g, '-') : null);
  if (mapped && mapped !== current) return { value: mapped, editable: 'lang', method: 'rule', confidence: 'high', reason: `Normalised "${current}" to a valid BCP 47 tag`, apply: setAttr(el, 'lang') };
  const det = detectLanguage(text(ctx.doc.body));
  return { value: det.lang, editable: 'lang', method: 'heuristic', confidence: det.confidence === 'high' ? 'high' : 'medium', reason: `Detected page language from its text (${det.confidence} confidence)`, apply: setAttr(el, 'lang') };
}

function documentTitle(el, node, ctx) {
  const doc = ctx.doc;
  const h1 = doc.querySelector('h1');
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const any = doc.querySelector('h2,h3,[class*=title],[class*=logo]');
  const value = (h1 && text(h1)) || og || (any && text(any)) || '';
  return {
    value: clip(value, 70), editable: 'text', requiresInput: !value, method: 'heuristic', confidence: h1 ? 'medium' : 'low',
    reason: h1 ? 'Used the main heading as the page title' : 'Used the most prominent text as the page title',
    apply: v => {
      let t = doc.querySelector('title');
      if (!t) { t = doc.createElement('title'); doc.head.append(t); }
      t.textContent = v;
    },
  };
}

function metaViewport(el) {
  const content = el.getAttribute('content') || '';
  const fixed = content.split(',').map(s => s.trim()).filter(p => p && !/^user-scalable\s*=\s*(no|0)$/i.test(p) && !/^maximum-scale\s*=/i.test(p)).join(', ');
  return { value: fixed, method: 'rule', confidence: 'high', reason: 'Removed zoom blocking (user-scalable=no / maximum-scale) so low-vision users can pinch-zoom', apply: v => el.setAttribute('content', v) };
}

const HEADERISH = /\b(header|masthead|top-?bar|site-head|banner)\b/i;
const NAVISH = /\b(nav|navbar|navigation|menu|main-menu|topnav|sidebar-nav)\b/i;
const FOOTERISH = /\b(footer|site-foot|bottom|colophon)\b/i;
const MAINISH = /\b(main|content|main-content|page-content|primary|maincontent)\b/i;
const sig = el => `${el.id} ${el.getAttribute('class') || ''}`;

const EXACT_MAIN = /^(main|content|main-content|maincontent|main_content|page-content|pagecontent|primary|site-content|content-main|main-container|main-wrapper|content-wrapper)$/i;
const LANDMARK_SEL = 'header,nav,footer,aside,main,[role=banner],[role=navigation],[role=contentinfo],[role=complementary],[role=main],[role=search],[role=region]';
const renderOf = (el, ctx) => el && ctx.win?.document.querySelector(`[data-ppid="${el.getAttribute('data-ppid')}"]`);
const visible = (el, ctx) => { const r = renderOf(el, ctx); if (!r) return true; const b = r.getBoundingClientRect(); return b.width > 0 && b.height > 0 && ctx.win.getComputedStyle(r).visibility !== 'hidden'; };
// Same notion axe uses for headings: rendered (not display:none / visibility:hidden) and not aria-hidden; size may be zero.
const exposed = (el, ctx) => { if (el.closest('[aria-hidden=true]')) return false; const r = renderOf(el, ctx); return !r || (r.checkVisibility ? r.checkVisibility({ visibilityProperty: true }) : true); };
const tokens = el => [el.id, ...(el.getAttribute('class') || '').split(/\s+/)].filter(Boolean);
const textShare = (el, doc) => text(el).length / Math.max(1, text(doc.body).length);
const NON_CONTENT = ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META'];
const contentChildren = (el, ctx) => [...el.children].filter(c => !NON_CONTENT.includes(c.tagName) && !c.classList.contains('pp-skip') && visible(c, ctx));

function landmarkMain(el, node, ctx) {
  const doc = ctx.doc;
  if (doc.querySelector('main,[role=main]')) return null;
  const mark = (target, reason, confidence) => ({ value: 'main', method: 'heuristic', confidence, reason, target, apply: () => { target.setAttribute('role', 'main'); ensureId(target, 'main'); } });
  // 1. A container the author named as the content area, visible, holding real content, not wrapping header/footer.
  const named = [...doc.body.querySelectorAll('div,section,article,td')]
    .filter(e => tokens(e).some(t => EXACT_MAIN.test(t)) && !e.closest(LANDMARK_SEL) && !e.querySelector('header,footer,[role=banner],[role=contentinfo]') && visible(e, ctx) && textShare(e, doc) > 0.15)
    .sort((a, b) => (b.id && EXACT_MAIN.test(b.id)) - (a.id && EXACT_MAIN.test(a.id)) || text(b).length - text(a).length);
  if (named[0]) return mark(named[0], `The author named #${named[0].id || tokens(named[0])[0]} as the content area; marked it as the main landmark`, 'high');
  // 2. Structure: descend single wrappers, then trim header-like blocks at the top and footer-like blocks at the bottom.
  let container = doc.body;
  for (let kids = contentChildren(container, ctx); kids.length === 1 && /^(DIV|ARTICLE|SECTION|CENTER|FORM)$/.test(kids[0].tagName) && !kids[0].getAttribute('role'); kids = contentChildren(container, ctx)) container = kids[0];
  const kids = contentChildren(container, ctx);
  const small = c => textShare(c, doc) < 0.5;
  const isTop = c => small(c) && (['HEADER', 'NAV'].includes(c.tagName) || /^(banner|navigation|search)$/.test(c.getAttribute('role') || '') || HEADERISH.test(sig(c)) || NAVISH.test(sig(c)));
  const isBottom = c => small(c) && (c.tagName === 'FOOTER' || c.getAttribute('role') === 'contentinfo' || FOOTERISH.test(sig(c)));
  let a = 0, b = kids.length - 1;
  while (a <= b && isTop(kids[a])) a++;
  while (b >= a && isBottom(kids[b])) b--;
  if (a > b) return null;
  if (a === b) {
    if (kids[a].matches(LANDMARK_SEL) || kids[a].querySelector('header,footer,[role=banner],[role=contentinfo],main')) return null;
    return mark(kids[a], 'The page content sits in one block between header and footer; marked it as the main landmark', 'medium');
  }
  return {
    value: 'main', method: 'heuristic', confidence: 'medium', reason: `Wrapped the ${b - a + 1} content blocks between header and footer in <main>`,
    apply: () => {
      const main = doc.createElement('main');
      main.id = doc.getElementById('main') ? 'main-content' : 'main';
      kids[a].before(main);
      for (let i = a; i <= b; i++) main.append(kids[i]);
      ctx.adopt(main);
    },
  };
}

function region(el, node, ctx) {
  const doc = ctx.doc;
  let top = el;
  while (top.parentElement && top.parentElement !== doc.body && !top.parentElement.querySelector('main,[role=main]')) top = top.parentElement;
  if (top.querySelector('main,[role=main]') || top.closest('main,[role=main]')) return null;
  if (top === doc.body || top.getAttribute('role') || /^(MAIN|HEADER|NAV|FOOTER|ASIDE)$/.test(top.tagName)) return null;
  // Never turn a page-sized block into a header/nav/footer, and never call the content area navigation.
  if (textShare(top, doc) > 0.5 || tokens(top).some(t => EXACT_MAIN.test(t))) {
    if (doc.querySelector('main,[role=main]')) return null;
    return null;
  }
  const s = sig(top) + ' ' + top.tagName;
  const links = top.querySelectorAll('a').length;
  const words = text(top).split(' ').length;
  let role = null, confidence = 'medium';
  const noBanner = !doc.querySelector('header,[role=banner]'), noFooter = !doc.querySelector('footer,[role=contentinfo]');
  if (noBanner && HEADERISH.test(s)) { role = 'banner'; confidence = 'high'; }
  else if (noFooter && FOOTERISH.test(s)) { role = 'contentinfo'; confidence = 'high'; }
  else if (NAVISH.test(s) && links >= 2) { role = 'navigation'; confidence = 'high'; }
  else if (noBanner && top === firstContent(doc) && top.querySelector('img,h1,a')) role = 'banner';
  else if (noFooter && top === lastContent(doc)) role = 'contentinfo';
  else if (links >= 3 && links * 6 >= words) role = 'navigation';
  if (!role) {
    const h = top.querySelector('h1,h2,h3,h4,h5,h6');
    const name = /\bstep\s*\d/i.test(text(top)) ? 'Progress' : h ? text(h) : wordClip(text(top), 40);
    if (!name) return null;
    return { value: name, editable: 'text', method: 'heuristic', confidence: 'low', reason: 'Content outside every landmark; made it a named region so screen-reader users can find it', apply: v => { top.setAttribute('role', 'region'); top.setAttribute('aria-label', v); }, target: top };
  }
  return { value: role, method: 'heuristic', confidence, reason: `Identified this block as the page ${role === 'contentinfo' ? 'footer' : role === 'banner' ? 'header' : 'navigation'}${confidence === 'high' ? ` (the author called it "${(s.match(role === 'banner' ? HEADERISH : role === 'contentinfo' ? FOOTERISH : NAVISH) || [''])[0]}")` : ''}`, apply: () => top.setAttribute('role', role), target: top };
}
const contentKids = doc => [...doc.body.children].filter(c => !['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'MAIN'].includes(c.tagName) && c.getAttribute('role') !== 'main');
const firstContent = doc => contentKids(doc)[0];
const lastContent = doc => contentKids(doc).slice(-1)[0];

function bypass(el, node, ctx) {
  const doc = ctx.doc;
  const main = doc.querySelector('main,[role=main]');
  if (!main) return null;
  return {
    value: 'Skip to main content', editable: 'text', method: 'rule', confidence: 'high', reason: 'Added a skip link (visible on keyboard focus) so keyboard users can bypass repeated navigation',
    apply: v => {
      const id = ensureId(main, 'main');
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      const style = doc.createElement('style');
      style.textContent = '.pp-skip{position:absolute;left:-9999px;top:0;z-index:9999;padding:.75em 1em;background:#000;color:#fff;font:600 1rem/1.2 system-ui,sans-serif}.pp-skip:focus{left:.5rem;top:.5rem}';
      doc.head.append(style);
      const a = doc.createElement('a');
      a.className = 'pp-skip';
      a.href = '#' + id;
      a.textContent = v;
      doc.body.prepend(a);
      ctx.adopt(a);
    },
  };
}

function headingOrder(el, node, ctx) {
  if (!ctx.memo.outline) {
    // Compute the corrected outline once, from the author's original levels, so siblings stay siblings.
    const heads = [...ctx.doc.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(h => exposed(h, ctx));
    const origMap = (ctx.memo.origLevels ||= new WeakMap());
    const orig = h => {
      if (!origMap.has(h)) origMap.set(h, h.getAttribute('role') === 'heading' ? parseInt(h.getAttribute('aria-level')) || 2 : parseInt(h.tagName[1]));
      return origMap.get(h);
    };
    const outline = new Map();
    const levelFor = {};
    let prevOrig = 0, prevNew = 0;
    for (const h of heads) {
      const L = orig(h);
      let nl;
      if (!prevOrig) nl = L;
      else if (L > prevOrig) nl = Math.min(L, prevNew + 1);
      else if (L === prevOrig) nl = prevNew;
      else nl = Math.min(L, levelFor[L] ?? L);
      levelFor[L] = nl;
      for (const k in levelFor) if (+k > L) delete levelFor[k];
      outline.set(h, nl);
      prevOrig = L; prevNew = nl;
    }
    ctx.memo.outline = outline;
  }
  const want = ctx.memo.outline.get(el);
  const cur = parseInt(el.getAttribute('aria-level')) || parseInt(el.tagName[1]) || 2;
  if (!want || want === cur) return null;
  return { value: String(want), method: 'rule', confidence: 'high', reason: `Heading level skipped (h${cur} after a higher level); exposed it as level ${want} without changing its look`, apply: v => { el.setAttribute('role', 'heading'); el.setAttribute('aria-level', v); } };
}

function headingOne(el, node, ctx) {
  const win = ctx.win;
  let best = null, bestSize = 19;
  for (const r of win.document.body.querySelectorAll('div,span,p,strong,b,font,td,a')) {
    const own = [...r.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join('').trim();
    if (own.length < 3 || own.length > 90 || r.closest('h1,h2,h3,h4,h5,h6,[role=heading],button,nav,footer,[role=navigation],[role=contentinfo]')) continue;
    const size = parseFloat(win.getComputedStyle(r).fontSize);
    if (size > bestSize) { bestSize = size; best = r; }
  }
  const target = best && ctx.doc.querySelector(`[data-ppid="${best.getAttribute('data-ppid')}"]`);
  if (!target) return null;
  return { value: '1', method: 'heuristic', confidence: 'medium', reason: `"${clip(text(target), 50)}" looks like the page title (${Math.round(bestSize)}px) but was not a heading; exposed it as heading level 1`, apply: () => { target.setAttribute('role', 'heading'); target.setAttribute('aria-level', '1'); }, target };
}

const LANDMARK_OF = {
  banner: doc => [...doc.querySelectorAll('header,[role=banner]')].filter(e => (e.getAttribute('role') || 'banner') === 'banner' && (e.getAttribute('role') === 'banner' || !e.parentElement.closest('article,aside,main,nav,section,[role=main],[role=region]'))),
  contentinfo: doc => [...doc.querySelectorAll('footer,[role=contentinfo]')].filter(e => (e.getAttribute('role') || 'contentinfo') === 'contentinfo' && (e.getAttribute('role') === 'contentinfo' || !e.parentElement.closest('article,aside,main,nav,section,[role=main],[role=region]'))),
  main: doc => [...doc.querySelectorAll('main,[role=main]')].filter(e => (e.getAttribute('role') || 'main') === 'main'),
  complementary: doc => [...doc.querySelectorAll('aside,[role=complementary]')].filter(e => (e.getAttribute('role') || 'complementary') === 'complementary'),
};

function demoteLandmark(role, duplicateRule = false) {
  return (el, node, ctx) => (duplicateRule && LANDMARK_OF[role](ctx.doc).length <= 1 ? null : {
    value: 'none', method: 'rule', confidence: 'medium',
    reason: `A second or nested ${role} landmark confuses landmark navigation; kept the element but removed its landmark role`,
    apply: () => {
      if (el.tagName === 'MAIN') { el.setAttribute('role', 'region'); return; }
      if (el.matches(INTERACTIVE) || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) el.setAttribute('role', 'group'); // role=none would conflict with a name or focus
      else el.setAttribute('role', 'none');
    },
  });
}

// ---------- structure & ARIA ----------

function listRule(el) {
  const bad = [...el.children].filter(c => !['LI', 'SCRIPT', 'TEMPLATE'].includes(c.tagName) && c.getAttribute('role') !== 'listitem');
  if (!bad.length) return null;
  return {
    value: '', method: 'rule', confidence: 'medium', reason: `Fixed ${bad.length} invalid child element(s) of the list`,
    apply: () => bad.forEach(c => {
      const lis = c.querySelectorAll(':scope > li');
      if (lis.length && lis.length === c.children.length) c.replaceWith(...c.childNodes);
      else c.setAttribute('role', 'listitem');
    }),
  };
}

function listItem(el) {
  const parent = el.parentElement;
  if (!parent || parent.tagName === 'UL' || parent.tagName === 'OL') return null;
  if ([...parent.children].every(c => c.tagName === 'LI')) {
    return { value: 'list', method: 'rule', confidence: 'high', reason: 'Items were in a <' + parent.tagName.toLowerCase() + '>; gave the container role="list" (no visual change)', apply: () => parent.setAttribute('role', 'list') };
  }
  return { value: 'none', method: 'rule', confidence: 'medium', reason: 'Stray <li> outside a list; exposed as plain content', apply: () => el.setAttribute('role', 'none') };
}

function duplicateId(el, node, ctx) {
  const id = el.id;
  const all = [...ctx.doc.querySelectorAll('[id]')].filter(e => e.id === id);
  if (all.length < 2 || all[0] === el) return null;
  const k = all.indexOf(el);
  return {
    value: `${id}-${k + 1}`, method: 'rule', confidence: 'medium', reason: `id "${id}" was used ${all.length} times; renamed this copy (and its matching label, if any)`,
    apply: v => {
      const labels = [...ctx.doc.querySelectorAll('label[for]')].filter(l => l.getAttribute('for') === id);
      if (labels[k]) labels[k].setAttribute('for', v);
      el.id = v;
    },
  };
}

const ARIA_TYPOS = { 'aria-labeledby': 'aria-labelledby', 'aria-lable': 'aria-label', 'aria-labelby': 'aria-labelledby', 'aria-describeby': 'aria-describedby', 'aria-desribedby': 'aria-describedby', 'aria-role': 'role', 'aria-hide': 'aria-hidden', 'aria-required ': 'aria-required' };

function ariaValidAttr(el) {
  const bad = [...el.attributes].filter(a => a.name.startsWith('aria-') && ARIA_TYPOS[a.name] !== undefined || (a.name.startsWith('aria-') && !(a.name in KNOWN_ARIA)));
  if (!bad.length) return null;
  return {
    value: '', method: 'rule', confidence: 'high', reason: bad.map(a => ARIA_TYPOS[a.name] ? `${a.name} → ${ARIA_TYPOS[a.name]}` : `removed unknown ${a.name}`).join('; '),
    apply: () => bad.forEach(a => { const fix = ARIA_TYPOS[a.name]; if (fix && !el.hasAttribute(fix)) el.setAttribute(fix, a.value); el.removeAttribute(a.name); }),
  };
}
const KNOWN_ARIA = Object.fromEntries('activedescendant atomic autocomplete braillelabel brailleroledescription busy checked colcount colindex colindextext colspan controls current describedby description details disabled dropeffect errormessage expanded flowto grabbed haspopup hidden invalid keyshortcuts label labelledby level live modal multiline multiselectable orientation owns placeholder posinset pressed readonly relevant required roledescription rowcount rowindex rowindextext rowspan selected setsize sort valuemax valuemin valuenow valuetext'.split(' ').map(k => ['aria-' + k, 1]));

const BOOL = { yes: 'true', no: 'false', on: 'true', off: 'false', 1: 'true', 0: 'false', '': 'false' };
function ariaValidValue(el) {
  const fixes = [];
  for (const a of [...el.attributes]) {
    if (!a.name.startsWith('aria-')) continue;
    const v = a.value.trim().toLowerCase();
    if (['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-errormessage', 'aria-flowto', 'aria-details'].includes(a.name)) {
      const ids = a.value.split(/\s+/).filter(Boolean);
      const ok = ids.filter(id => el.ownerDocument.getElementById(id));
      if (ok.length !== ids.length) fixes.push([a.name, ok.join(' ') || null]);
    } else if (['aria-hidden', 'aria-required', 'aria-expanded', 'aria-checked', 'aria-pressed', 'aria-selected', 'aria-disabled', 'aria-invalid', 'aria-readonly', 'aria-modal', 'aria-multiline', 'aria-atomic', 'aria-busy'].includes(a.name) && !['true', 'false', 'mixed', 'undefined', 'grammar', 'spelling'].includes(v)) {
      if (a.name === 'aria-hidden') fixes.push([a.name, null]); // invalid = not hidden today; keep content exposed
      else if (v in BOOL) fixes.push([a.name, BOOL[v]]);
      else fixes.push([a.name, null]);
    }
  }
  if (!fixes.length) return null;
  return {
    value: '', method: 'rule', confidence: 'medium', reason: fixes.map(([n, v]) => (v === null ? `removed broken ${n}` : `${n}="${v}"`)).join('; '),
    apply: () => fixes.forEach(([n, v]) => (v === null ? el.removeAttribute(n) : el.setAttribute(n, v))),
  };
}

function ariaAllowedAttr(el, node) {
  const names = node.data.flatMap(c => (Array.isArray(c.data) ? c.data : [])).map(s => String(s).split('=')[0].trim()).filter(n => n.startsWith('aria-'));
  if (!names.length) return null;
  return { value: '', method: 'rule', confidence: 'medium', reason: `Removed ${names.join(', ')} (not allowed on this element's role)`, apply: () => names.forEach(n => el.removeAttribute(n)) };
}

const REQUIRED_DEFAULTS = { 'aria-checked': 'false', 'aria-level': '2', 'aria-valuenow': '0', 'aria-selected': 'false', 'aria-expanded': 'false', 'aria-controls': null };
function ariaRequiredAttr(el, node) {
  const missing = node.data.flatMap(c => (Array.isArray(c.data) ? c.data : [])).filter(n => REQUIRED_DEFAULTS[n]);
  if (!missing.length) return null;
  return { value: '', method: 'rule', confidence: 'medium', reason: `Added required ${missing.map(m => `${m}="${REQUIRED_DEFAULTS[m]}"`).join(', ')} — confirm the initial state`, apply: () => missing.forEach(m => el.setAttribute(m, REQUIRED_DEFAULTS[m])) };
}

function removeRole(el) {
  const role = el.getAttribute('role');
  return { value: '', method: 'rule', confidence: 'medium', reason: `Removed invalid/inappropriate role="${role}"`, apply: () => el.removeAttribute('role') };
}

function ariaHiddenFocus(el) {
  const focusables = [el, ...el.querySelectorAll(INTERACTIVE)].filter(f => f.matches(INTERACTIVE) && f.getAttribute('tabindex') !== '-1');
  if (!focusables.length) return null;
  return { value: '-1', method: 'rule', confidence: 'high', reason: `Removed ${focusables.length} hidden element(s) from the tab order so keyboard focus never lands on something screen readers can't see`, apply: () => focusables.forEach(f => f.setAttribute('tabindex', '-1')) };
}

function ariaProhibitedAttr(el, node) {
  const names = ['aria-label', 'aria-labelledby'].filter(n => el.hasAttribute(n));
  if (!names.length) return null;
  return { value: '', method: 'rule', confidence: 'medium', reason: `${names.join(', ')} is ignored on a generic element; moved the text to title so sighted users still see it`, apply: () => { const v = el.getAttribute('aria-label'); if (v && !el.title) el.title = v; names.forEach(n => el.removeAttribute(n)); } };
}

function replaceTag(el, tag, ctx) {
  const n = el.ownerDocument.createElement(tag);
  for (const a of el.attributes) n.setAttribute(a.name, a.value);
  n.append(...el.childNodes);
  el.replaceWith(n);
  ctx.adopt(n);
}

function emptyHeading(el) {
  return { value: 'none', method: 'rule', confidence: 'medium', reason: 'Empty heading removed from the heading outline (kept for layout)', apply: () => el.setAttribute('role', 'none') };
}

function autocompleteValid(el) {
  const tok = autocompleteToken(`${el.getAttribute('name') || ''} ${el.id} ${el.getAttribute('placeholder') || ''}`, el.getAttribute('type'));
  return { value: tok || 'off', method: 'heuristic', confidence: tok ? 'medium' : 'low', reason: `Invalid autocomplete="${el.getAttribute('autocomplete')}" → "${tok || 'off'}"`, apply: setAttr(el, 'autocomplete') };
}

function frameTitle(el) {
  const src = el.getAttribute('src') || '';
  let host = '';
  try { host = new URL(src, 'https://x.invalid').hostname.replace(/^www\./, ''); } catch { /* */ }
  const known = /youtube|vimeo/.test(host) ? 'Embedded video' : /google\.[a-z.]+$/.test(host) && /map/.test(src) ? 'Embedded map' : host && host !== 'x.invalid' ? `Embedded content from ${host}` : 'Embedded content';
  return { value: known, editable: 'text', method: 'heuristic', confidence: 'low', reason: 'Frames need a title describing their content — refine this', apply: setAttr(el, 'title') };
}

// ---------- PasteProof checks beyond axe ----------

export const CUSTOM_RULES = {
  'pp-click-handler': { impact: 'serious', wcag: ['2.1.1', '4.1.2'], level: 'A', help: 'Clickable element is not reachable or operable by keyboard' },
  'pp-vague-link': { impact: 'moderate', wcag: ['2.4.4'], level: 'A', help: 'Link text does not describe its purpose' },
  'pp-input-purpose': { impact: 'moderate', wcag: ['1.3.5'], level: 'AA', help: 'Personal-data field does not identify its purpose (autocomplete)' },
  'pp-required-hint': { impact: 'moderate', wcag: ['3.3.2', '1.3.1'], level: 'A', help: 'Required field is marked only visually (asterisk)' },
  'pp-placeholder-label': { impact: 'serious', wcag: ['1.3.1', '3.3.2'], level: 'A', help: 'Field is named only by its placeholder, but has a visible label that is not connected' },
};

/** Detect issues axe-core does not cover. Returns [{ rule, el }] on the working document. */
export function customChecks(doc) {
  const found = [];
  for (const el of doc.querySelectorAll('[onclick]')) {
    if (el.matches('a[href],button,input,select,textarea,summary,label,option,body,html') || el.getAttribute('role') || el.hasAttribute('tabindex') || el.querySelector(INTERACTIVE)) continue;
    found.push({ rule: 'pp-click-handler', el });
  }
  for (const a of doc.querySelectorAll('a[href]')) {
    if (a.hasAttribute('aria-label') || a.hasAttribute('aria-labelledby')) continue;
    if (isVagueLinkText(text(a))) found.push({ rule: 'pp-vague-link', el: a });
  }
  for (const f of doc.querySelectorAll('input:not([type]),input[type=text],input[type=email],input[type=tel],input[type=password]')) {
    if (f.hasAttribute('autocomplete')) continue;
    if (autocompleteToken(fieldHaystack(f), f.getAttribute('type'))) found.push({ rule: 'pp-input-purpose', el: f });
  }
  for (const f of doc.querySelectorAll('input[placeholder],textarea[placeholder]')) {
    if (f.hasAttribute('aria-label') || f.hasAttribute('aria-labelledby') || f.closest('label') || (f.id && [...doc.querySelectorAll('label[for]')].some(l => l.getAttribute('for') === f.id))) continue;
    const adj = adjacentLabel(f);
    if (adj && adj.text.toLowerCase() !== (f.getAttribute('placeholder') || '').toLowerCase()) found.push({ rule: 'pp-placeholder-label', el: f });
  }
  for (const f of doc.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')) {
    if (f.required || f.hasAttribute('aria-required')) continue;
    const lab = labelTextFor(f);
    if (lab && /\*\s*:?\s*$|^\s*\*|\(required\)/i.test(lab)) found.push({ rule: 'pp-required-hint', el: f });
  }
  return found;
}

function labelTextFor(f) {
  const doc = f.ownerDocument;
  if (f.id) { const l = [...doc.querySelectorAll('label[for]')].find(x => x.getAttribute('for') === f.id); if (l) return text(l); }
  const wrap = f.closest('label');
  if (wrap) return text(wrap);
  const ids = (f.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  if (ids.length) return ids.map(id => text(doc.getElementById(id))).join(' ');
  const adj = adjacentLabel(f);
  return adj ? adj.text + (adj.node?.textContent?.includes('*') ? ' *' : '') : f.getAttribute('aria-label') || '';
}
const fieldHaystack = f => `${f.getAttribute('name') || ''} ${f.id} ${f.getAttribute('placeholder') || ''} ${labelTextFor(f)} ${f.getAttribute('aria-label') || ''}`;

function clickHandler(el) {
  const handler = el.getAttribute('onclick') || '';
  const nav = /location(\.href)?\s*=|window\.open\(|location\.assign/.test(handler);
  const role = nav ? 'link' : 'button';
  return {
    value: role, method: 'rule', confidence: nav ? 'high' : 'medium',
    reason: `<${el.tagName.toLowerCase()} onclick> only worked with a mouse. Added role="${role}", tabindex="0" and an Enter${nav ? '' : '/Space'} key handler`,
    apply: () => {
      el.setAttribute('role', role);
      el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('onkeydown')) el.setAttribute('onkeydown', nav ? "if(event.key==='Enter'){this.click()}" : "if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}");
    },
  };
}

const LANDMARK_STOP = 'body,main,[role=main],header,footer,nav,aside,form,[role=banner],[role=contentinfo],[role=navigation]';
const wordClip = (t, n) => (t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n)).replace(/[,;:–—-]+$/, '') + '…');

function vagueLink(el) {
  const label = text(el);
  const bare = label.replace(/[\s»›→.…>]+$/, '');
  const mk = (value, why) => ({ value, editable: 'text', method: 'heuristic', confidence: 'medium', reason: `"${label}" is meaningless out of context (screen-reader link lists). ${why}`, apply: setAttr(el, 'aria-label') });
  const title = el.getAttribute('title')?.trim();
  if (title) return mk(`${bare}: ${title}`, 'Used its title tooltip');
  const rel = (el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
  if (rel.includes('next')) return mk(`${bare}: next page`, 'The link is marked rel="next"');
  if (rel.includes('prev')) return mk(`${bare}: previous page`, 'The link is marked rel="prev"');
  const after = [];
  for (let n = el.nextSibling; n && after.join(' ').length < 120; n = n.nextSibling) {
    if (n.nodeType === 1 && n.matches('a,button,br,div,p,li,table,ul,ol,h1,h2,h3,h4,h5,h6')) break;
    after.push(n.textContent);
  }
  const tail = after.join(' ').replace(/\s+/g, ' ').split(/[.!?]/)[0].trim();
  if (tail.length >= 8 && /^[a-z(]/.test(tail)) return mk(`${label} ${wordClip(tail, 80)}`, 'Extended the link name with the rest of its sentence');
  // Nearest preceding heading inside the same card/section (never across landmarks or the page body).
  for (let p = el.parentElement, depth = 0; p && depth < 4 && !p.matches(LANDMARK_STOP); p = p.parentElement, depth++) {
    const heads = [...p.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(h => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (heads.length) return mk(`${bare}: ${text(heads[heads.length - 1])}`, 'Added the heading of its section');
  }
  const href = el.getAttribute('href') || '';
  const dest = labelFromHref(href);
  if (dest && !/^#?$/.test(href) && !/\./.test(dest)) return mk(`${bare}: ${dest}${/\.pdf(\?|#|$)/i.test(href) ? ' (PDF)' : ''}`, 'Named it after its destination');
  const para = el.closest('p,li,td');
  if (para) {
    const sentence = text(para).replace(label, '').replace(/\s+/g, ' ').trim();
    if (sentence.length >= 8) return mk(`${bare}: ${wordClip(sentence.replace(/[.,;:–—-]+$/, ''), 60)}`, 'Added the surrounding sentence');
  }
  return { value: '', editable: 'text', requiresInput: true, method: 'rule', confidence: 'low', reason: `"${label}" gives no destination. Write a link name that makes sense on its own`, apply: setAttr(el, 'aria-label') };
}

function inputPurpose(el) {
  const tok = autocompleteToken(fieldHaystack(el), el.getAttribute('type'));
  if (!tok) return null;
  const high = ['email', 'tel'].includes(tok) || el.getAttribute('type') === 'password';
  return { value: tok, method: 'heuristic', confidence: high ? 'high' : 'medium', reason: `Added autocomplete="${tok}" so browsers and assistive tech can fill it for users with motor or memory impairments`, apply: setAttr(el, 'autocomplete') };
}

function requiredHint(el) {
  return { value: 'true', method: 'rule', confidence: 'high', reason: 'The label shows "*" but screen readers were not told the field is required', apply: () => el.setAttribute('aria-required', 'true') };
}

// ---------- registry ----------

export const FIXERS = {
  'image-alt': imageAlt,
  'role-img-alt': namePlan('img'),
  'svg-img-alt': namePlan('img'),
  'input-image-alt': el => ({ value: el.getAttribute('value') || iconLabel(tokensOf(el)) || 'Submit', editable: 'text', method: 'heuristic', confidence: 'low', reason: 'Image button needs alt text naming its action', apply: setAttr(el, 'alt') }),
  'area-alt': el => { const v = labelFromHref(el.getAttribute('href')); return { value: v || '', requiresInput: !v, editable: 'text', method: 'heuristic', confidence: 'low', reason: 'Image-map area needs alt text', apply: setAttr(el, 'alt') }; },
  'button-name': namePlan('button'),
  'input-button-name': el => { const g = inferControlName(el, 'button'); return { value: g?.value || 'Submit', editable: 'text', method: 'heuristic', confidence: 'low', reason: g?.reason || 'Button has no text', apply: setAttr(el, 'value') }; },
  'link-name': namePlan('link'),
  'aria-command-name': namePlan('button'),
  'aria-toggle-field-name': namePlan('field'),
  'aria-input-field-name': namePlan('field'),
  'aria-tooltip-name': namePlan('field'),
  'aria-progressbar-name': el => ({ value: 'Progress', editable: 'text', method: 'heuristic', confidence: 'low', reason: 'Progress bar needs a name', apply: setAttr(el, 'aria-label') }),
  'aria-meter-name': el => ({ value: 'Meter', editable: 'text', method: 'heuristic', confidence: 'low', reason: 'Meter needs a name', apply: setAttr(el, 'aria-label') }),
  'aria-dialog-name': el => { const h = el.querySelector('h1,h2,h3,h4'); return h && text(h) ? { value: text(h), method: 'rule', confidence: 'high', reason: 'Named the dialog by its heading', apply: () => el.setAttribute('aria-labelledby', ensureId(h, 'pp-dialog-title')) } : { value: '', requiresInput: true, editable: 'text', method: 'rule', confidence: 'low', reason: 'Dialog has no heading to use as a name', apply: setAttr(el, 'aria-label') }; },
  label: fieldLabel,
  'select-name': fieldLabel,
  'label-title-only': el => ({ value: el.getAttribute('title'), editable: 'text', method: 'rule', confidence: 'high', reason: 'Title tooltips are unreliable labels; promoted to aria-label', apply: setAttr(el, 'aria-label') }),
  'color-contrast': colorContrast,
  'link-in-text-block': el => ({ value: 'underline', method: 'rule', confidence: 'high', reason: 'Links inside text were distinguishable by colour only; added an underline', apply: () => setStyle(el, 'text-decoration', 'underline') }),
  'html-has-lang': (el, n, ctx) => langPlan(el, ctx),
  'html-lang-valid': (el, n, ctx) => langPlan(el, ctx),
  'valid-lang': el => { const v = LANG_NAMES[(el.getAttribute('lang') || '').toLowerCase()]; return { value: v || '', method: 'rule', confidence: v ? 'high' : 'medium', reason: v ? 'Normalised language name to a BCP 47 tag' : 'Removed invalid lang value', apply: x => (x ? el.setAttribute('lang', x) : el.removeAttribute('lang')) }; },
  'document-title': documentTitle,
  'meta-viewport': metaViewport,
  'meta-viewport-large': metaViewport,
  'landmark-one-main': landmarkMain,
  region,
  bypass,
  'heading-order': headingOrder,
  'empty-heading': emptyHeading,
  list: listRule,
  listitem: listItem,
  'duplicate-id-aria': duplicateId,
  'duplicate-id': duplicateId,
  'duplicate-id-active': duplicateId,
  tabindex: el => ({ value: '0', method: 'rule', confidence: 'high', reason: `tabindex="${el.getAttribute('tabindex')}" forced an unnatural focus order; set to 0 (follows reading order)`, apply: setAttr(el, 'tabindex') }),
  'scrollable-region-focusable': el => ({ value: '0', method: 'rule', confidence: 'high', reason: 'Scrollable area could not be scrolled with a keyboard; made it focusable', apply: setAttr(el, 'tabindex') }),
  'frame-title': frameTitle,
  marquee: (el, n, ctx) => ({ value: 'div', method: 'rule', confidence: 'high', reason: 'Replaced moving <marquee> with static text (same box, so the layout does not move)', apply: () => {
    const r = n.element?.getBoundingClientRect?.();
    replaceTag(el, 'div', ctx);
    const div = ctx.doc.querySelector(`[data-ppid="${el.getAttribute('data-ppid')}"]`) || el;
    setStyle(div, 'display', 'inline-block');
    setStyle(div, 'width', '100%');
    setStyle(div, 'overflow', 'hidden'); // same baseline rule as <marquee>; height stays auto so text is never clipped
    if (r?.height) setStyle(div, 'min-height', `${Math.round(r.height)}px`);
  } }),
  blink: (el, n, ctx) => ({ value: 'span', method: 'rule', confidence: 'high', reason: 'Replaced <blink> with static text', apply: () => replaceTag(el, 'span', ctx) }),
  'aria-valid-attr': ariaValidAttr,
  'aria-valid-attr-value': ariaValidValue,
  'aria-allowed-attr': ariaAllowedAttr,
  'aria-required-attr': ariaRequiredAttr,
  'aria-roles': removeRole,
  'aria-allowed-role': removeRole,
  'aria-hidden-focus': ariaHiddenFocus,
  'aria-prohibited-attr': ariaProhibitedAttr,
  'autocomplete-valid': autocompleteValid,
  'pp-click-handler': clickHandler,
  'pp-vague-link': vagueLink,
  'pp-input-purpose': inputPurpose,
  'pp-required-hint': requiredHint,
  'pp-placeholder-label': el => { const p = fieldLabel(el); return p.requiresInput ? null : { ...p, reason: 'Placeholder text disappears while typing; connected the visible label instead' }; },
  'page-has-heading-one': headingOne,
  'landmark-banner-is-top-level': demoteLandmark('banner'),
  'landmark-contentinfo-is-top-level': demoteLandmark('contentinfo'),
  'landmark-complementary-is-top-level': demoteLandmark('complementary'),
  'landmark-no-duplicate-banner': demoteLandmark('banner', true),
  'landmark-no-duplicate-contentinfo': demoteLandmark('contentinfo', true),
  'landmark-no-duplicate-main': demoteLandmark('main', true),
  'landmark-main-is-top-level': demoteLandmark('main'),
  'label-content-name-mismatch': el => {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('svg,img').forEach(n => n.remove()); // aria-hidden text is still *visible* text
    const visibleText = text(clone);
    if (!visibleText) return null;
    const old = el.getAttribute('aria-label') || '';
    const v = old && !visibleText.toLowerCase().includes(old.toLowerCase()) && old.length <= 40 ? `${visibleText} (${old})` : visibleText;
    return { value: v, editable: 'text', method: 'rule', confidence: 'high', reason: `Spoken name "${clip(old, 30)}" did not contain the visible text "${clip(visibleText, 30)}", so voice-control users saying what they see could not activate it`, apply: setAttr(el, 'aria-label') };
  },
  'image-redundant-alt': el => ({ value: '', editable: 'text', method: 'rule', confidence: 'high', reason: `Alt text "${clip(el.getAttribute('alt') || '', 40)}" repeats the text right next to it, so screen readers said it twice; marked the image decorative`, apply: setAttr(el, 'alt') }),
  'landmark-unique': (el, node, ctx) => {
    if (/^(none|presentation|group)$/.test(el.getAttribute('role') || '')) return null;
    if (el.getAttribute('role') === 'region' && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
      const hd = el.querySelector('h1,h2,h3,h4,h5,h6');
      if (hd && text(hd)) return { value: text(hd), method: 'rule', confidence: 'high', reason: 'Region named by its own heading', apply: () => el.setAttribute('aria-labelledby', ensureId(hd, 'pp-region')) };
      return { value: '', method: 'rule', confidence: 'high', reason: 'role="region" without a name is not a usable landmark; removed the role (screen readers already ignored it)', apply: () => el.removeAttribute('role') };
    }
    const role = el.getAttribute('role') || { NAV: 'navigation', ASIDE: 'complementary', HEADER: 'banner', FOOTER: 'contentinfo', SECTION: 'region', FORM: 'form' }[el.tagName] || 'region';
    const same = [...ctx.doc.querySelectorAll(`[role=${role}]${role === 'navigation' ? ',nav' : role === 'complementary' ? ',aside' : ''}`)];
    const h = [...el.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(x => x.parentElement.closest('nav,aside,section,form,header,footer,[role=navigation],[role=complementary],[role=region],[role=search]') === el);
    const idx = same.indexOf(el);
    const names = { navigation: ['Main', 'Secondary', 'Additional'], complementary: ['Related', 'More', 'Additional'] };
    const nameOf = x => (x.getAttribute('aria-labelledby') ? x.getAttribute('aria-labelledby').split(/\s+/).map(id => text(ctx.doc.getElementById(id))).join(' ') : x.getAttribute('aria-label') || '').trim().toLowerCase();
    const taken = new Set(same.filter(x => x !== el).map(nameOf));
    const where = el.closest('footer,[role=contentinfo]') ? 'Footer' : el.closest('header,[role=banner]') ? 'Header' : null;
    let label = h && text(h) && !taken.has(text(h).toLowerCase()) ? text(h) : h && text(h) && where ? `${text(h)} (${where.toLowerCase()})` : `${where || (names[role] || [])[idx] || `Section ${idx + 1}`}${role === 'navigation' ? ' navigation' : ''}`;
    for (let k = 2; taken.has(label.toLowerCase()); k++) label = label.replace(/( \d+)?$/, ` ${k}`);
    if (where && taken.has(label.toLowerCase()) === false && h && taken.has(text(h).toLowerCase())) label = `${text(h)} (${where.toLowerCase()})`;
    return { value: clip(label, 60), editable: 'text', method: 'heuristic', confidence: 'low', reason: `Several ${role} landmarks had the same or no name; screen-reader users could not tell them apart`, apply: v => {
      // Re-check at apply time: another landmark may have been named in this same pass.
      const now = new Set(same.filter(x => x !== el).map(nameOf));
      let final = v;
      for (let k = 2; now.has(final.toLowerCase()); k++) final = v.replace(/( \d+)?$/, ` ${k}`);
      el.removeAttribute('aria-labelledby');
      el.setAttribute('aria-label', final);
    } };
  },
  'target-size': (el, node) => {
    const r = node.element?.getBoundingClientRect?.();
    if (!r || (r.width >= 24 && r.height >= 24)) return null;
    const inline = node.element.ownerDocument.defaultView.getComputedStyle(node.element).display === 'inline';
    return { value: '24px', optIn: true, method: 'rule', confidence: 'medium', reason: `Target was ${Math.round(r.width)}×${Math.round(r.height)}px; enlarged to at least 24×24px (WCAG 2.5.8) — not applied automatically because resizing can shift the layout`, apply: v => { setStyle(el, 'min-width', v); setStyle(el, 'min-height', v); if (inline) setStyle(el, 'display', 'inline-block'); } };
  },
};

/** Fix order: content-level fixes first so that later checks (link names, landmarks) see their effect. */
export const FIX_ORDER = ['landmark-banner-is-top-level', 'landmark-contentinfo-is-top-level', 'landmark-main-is-top-level', 'landmark-complementary-is-top-level', 'html-has-lang', 'html-lang-valid', 'document-title', 'meta-viewport', 'meta-viewport-large', 'image-alt', 'input-image-alt', 'role-img-alt', 'svg-img-alt', 'area-alt', 'label', 'select-name', 'label-title-only', 'button-name', 'input-button-name', 'link-name', 'landmark-one-main'];
