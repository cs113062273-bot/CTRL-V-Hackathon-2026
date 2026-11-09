// Renders a working document inside an isolated, script-locked iframe and audits it with axe-core.

export const PAGE_ONLY_RULES = ['html-has-lang', 'html-lang-valid', 'document-title', 'landmark-one-main', 'region', 'bypass', 'page-has-heading-one', 'meta-viewport', 'meta-viewport-large', 'landmark-no-duplicate-main', 'landmark-unique', 'heading-order'];

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const IMPACT_RANK = { critical: 4, serious: 3, moderate: 2, minor: 1 };

/** Copy of the document that is safe to render: no user scripts, handlers, or javascript: URLs. */
const VENDOR = new URL('../vendor/', import.meta.url).href;

export function buildRenderHtml(doc, { baseUrl, fragment, withAxe, cssProxy }) {
  const clone = doc.cloneNode(true);
  clone.querySelectorAll('script, base, meta[http-equiv]').forEach(n => n.remove());
  for (const el of clone.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name) && /^\s*javascript:/i.test(attr.value)) el.setAttribute(attr.name, '#');
    }
  }
  clone.querySelectorAll('iframe, frame').forEach(f => { f.removeAttribute('src'); f.removeAttribute('srcdoc'); });
  if (withAxe && cssProxy) {
    for (const link of clone.querySelectorAll('link[rel~=stylesheet][href]')) {
      let abs;
      try { abs = new URL(link.getAttribute('href'), baseUrl || location.href).href; } catch { continue; }
      link.setAttribute('data-pp-href', abs);
      if (/^https?:/.test(abs) && new URL(abs).origin !== location.origin) link.setAttribute('href', new URL(`api/css?url=${encodeURIComponent(abs)}`, cssProxy).href);
    }
  }
  const head = clone.head || clone.documentElement.insertBefore(clone.createElement('head'), clone.body);
  const csp = clone.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', `script-src ${VENDOR}; object-src 'none'; form-action 'none'; frame-src 'none'`);
  head.prepend(csp);
  if (baseUrl) {
    const base = clone.createElement('base');
    base.setAttribute('href', baseUrl);
    csp.after(base);
  }
  if (withAxe) {
    const s = clone.createElement('script');
    s.src = VENDOR + 'axe.min.js';
    (clone.body || clone.documentElement).append(s);
  }
  if (fragment) {
    clone.documentElement.setAttribute('lang', clone.documentElement.getAttribute('lang') || 'en');
    if (!clone.querySelector('title')) { const t = clone.createElement('title'); t.textContent = 'Component'; head.append(t); }
  }
  return '<!DOCTYPE html>\n' + clone.documentElement.outerHTML;
}

function wcagCriteria(tags) {
  return tags.map(t => t.match(/^wcag(\d)(\d)(\d+)$/)).filter(Boolean).map(m => `${m[1]}.${m[2]}.${m[3]}`);
}

function levelOf(tags) {
  if (tags.some(t => /^wcag2(1|2)?a$/.test(t))) return 'A';
  if (tags.some(t => /^wcag2(1|2)?aa$/.test(t))) return 'AA';
  return 'Best practice';
}

/** Mount the render copy and return { win, iframe } once loaded (or after a timeout). */
export async function mount(doc, opts) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.title = 'Audit sandbox';
  iframe.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:900px;opacity:0;pointer-events:none;z-index:-1;border:0;';
  document.body.appendChild(iframe);
  const html = buildRenderHtml(doc, { ...opts, withAxe: true });
  await new Promise(resolve => {
    const timer = setTimeout(resolve, opts.loadTimeout ?? 12000);
    iframe.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    iframe.srcdoc = html;
  });
  const win = iframe.contentWindow;
  const start = Date.now();
  while (!win.axe) {
    if (Date.now() - start > 8000) { iframe.remove(); throw new Error('Audit engine failed to load inside the sandbox.'); }
    await new Promise(r => setTimeout(r, 50));
  }
  return { win, iframe };
}

/** Run axe and normalise results. Elements are returned as live references in the render document. */
export async function audit(win, { fragment }) {
  const rules = {};
  if (fragment) for (const r of PAGE_ONLY_RULES) rules[r] = { enabled: false };
  const res = await win.axe.run(win.document, {
    runOnly: { type: 'tag', values: AXE_TAGS },
    rules,
    resultTypes: ['violations', 'incomplete'],
    elementRef: true,
  });
  const shape = v => ({
    rule: v.id,
    impact: v.impact || 'minor',
    help: v.help,
    description: v.description,
    helpUrl: v.helpUrl,
    wcag: wcagCriteria(v.tags),
    level: levelOf(v.tags),
    nodes: v.nodes.map(n => ({
      element: n.element,
      ppid: n.element?.getAttribute?.('data-ppid') || null,
      html: n.html,
      target: n.target,
      failureSummary: n.failureSummary,
      data: [...(n.any || []), ...(n.all || []), ...(n.none || [])].map(c => ({ id: c.id, data: c.data, message: c.message })),
    })),
  });
  const violations = res.violations.map(shape).sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact]);
  const incomplete = res.incomplete.map(shape);
  return { violations, incomplete };
}

export function summarize(violations) {
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let instances = 0, wcagInstances = 0;
  for (const v of violations) {
    byImpact[v.impact] += v.nodes.length;
    instances += v.nodes.length;
    if (v.level !== 'Best practice') wcagInstances += v.nodes.length;
  }
  return { rules: violations.length, instances, wcagInstances, byImpact };
}

const LEAF_ROLES = new Set(['img', 'image', 'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'slider', 'spinbutton', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option']);
const LANDMARKS = new Set(['banner', 'navigation', 'main', 'contentinfo', 'complementary', 'form', 'search', 'region']);
const ROLE_SPEECH = { img: 'image', image: 'image', textbox: 'edit text', searchbox: 'search edit', combobox: 'combo box', listbox: 'list box', spinbutton: 'spin button', menuitem: 'menu item', banner: 'banner landmark', navigation: 'navigation landmark', main: 'main landmark', contentinfo: 'content info landmark', complementary: 'complementary landmark', form: 'form landmark', search: 'search landmark', region: 'region' };

/**
 * Approximate what a screen reader announces in browse mode, using axe-core's own
 * role and accessible-name computation on the rendered DOM.
 */
export function screenReaderView(win, limit = 600) {
  const { axe } = win;
  const out = [];
  try { axe.setup(win.document); } catch { /* already set up */ }
  const name = el => {
    try { return axe.commons.text.accessibleTextVirtual(axe.utils.getNodeFromTree(el)).trim(); } catch { return (el.getAttribute('aria-label') || el.textContent || '').trim(); }
  };
  const role = el => { try { return axe.commons.aria.getRole(el, { dpub: true }); } catch { return null; } };
  const hidden = el => {
    if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return true;
    const cs = win.getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  };
  const walk = node => {
    for (const child of node.childNodes) {
      if (out.length >= limit) return;
      if (child.nodeType === 3) {
        const t = child.textContent.replace(/\s+/g, ' ').trim();
        if (t) {
          const last = out[out.length - 1];
          if (last && last.kind === 'text' && last.parent === node) last.text += ' ' + t;
          else out.push({ kind: 'text', text: t, parent: node });
        }
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link'].includes(tag) || hidden(el)) continue;
      const r = role(el);
      if (r && LEAF_ROLES.has(r)) {
        let n = name(el);
        let problem = false;
        if (!n) {
          problem = true;
          if (r === 'img' || r === 'image') {
            const src = el.getAttribute('src') || '';
            n = src && !src.startsWith('data:') ? decodeURIComponent(src.split('/').pop().split('?')[0]) : '';
          }
        }
        if ((r === 'img' || r === 'image') && el.getAttribute('alt') === null && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) problem = true;
        const states = [];
        if (el.required || el.getAttribute('aria-required') === 'true') states.push('required');
        if (el.getAttribute('aria-invalid') === 'true') states.push('invalid');
        if (el.checked || el.getAttribute('aria-checked') === 'true') states.push('checked');
        if (el.getAttribute('aria-expanded')) states.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
        out.push({ kind: ROLE_SPEECH[r] || r, text: n || '', states, problem, ppid: el.getAttribute('data-ppid') });
        continue;
      }
      if (r === 'heading') {
        const lvl = el.getAttribute('aria-level') || (tag.match(/^h([1-6])$/) || [])[1] || '2';
        const n = name(el);
        out.push({ kind: `heading level ${lvl}`, text: n, problem: !n, ppid: el.getAttribute('data-ppid') });
        continue;
      }
      if (r && LANDMARKS.has(r)) out.push({ kind: ROLE_SPEECH[r] || r, text: name(el), landmark: true });
      if (r === 'list') out.push({ kind: 'list', text: `${el.querySelectorAll(':scope > li, :scope > [role=listitem]').length} items`, structural: true });
      if (r === 'table') out.push({ kind: 'table', text: name(el), structural: true });
      walk(el);
    }
  };
  walk(win.document.body || win.document.documentElement);
  try { axe.teardown(); } catch { /* noop */ }
  return out.map(({ parent, ...rest }) => rest);
}
