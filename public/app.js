import { run, buildRenderHtml, isFragment } from './engine/pipeline.js';
import { createCaptioner } from './engine/caption.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;

const state = {
  source: '',
  baseUrl: null,
  label: '',
  fileName: 'page.html',
  overrides: {},
  pending: {},
  reviewed: new Set(),
  result: null,
  captioner: null,
  running: false,
};

// ---------- tabs (WAI-ARIA pattern with arrow keys) ----------
function setupTabs(list, onChange) {
  const tabs = [...list.querySelectorAll('[role=tab]')];
  const select = tab => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    onChange?.(tab);
  };
  list.addEventListener('click', e => { const t = e.target.closest('[role=tab]'); if (t) select(t); });
  list.addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = tabs.length - 1;
    if (j !== null) { e.preventDefault(); tabs[j].focus(); select(tabs[j]); }
  });
  return { select, tabs };
}
const sourceTabs = setupTabs($('.source-tabs'));
const resultTabs = setupTabs($('.result-tabs'), tab => { if (tab.id === 'rt-preview') renderPreview(); });

// ---------- status ----------
function status(msg, kind = '') {
  const el = $('#status');
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.innerHTML = kind === 'busy' ? `<span class="spinner" aria-hidden="true"></span>${esc(msg)}` : esc(msg);
}

function setSource(html, { baseUrl = null, label = '', fileName = 'page.html' } = {}) {
  state.source = html;
  state.baseUrl = baseUrl;
  state.label = label;
  state.fileName = fileName;
  state.overrides = {};
  state.pending = {};
  state.reviewed = new Set();
  $('#source').value = html;
  $('#source-label').textContent = label;
}

// ---------- inputs ----------
$('#run-btn').addEventListener('click', () => {
  const v = $('#source').value;
  if (v !== state.source) setSource(v, { label: 'Pasted HTML' });
  analyze();
});

$('#source').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#run-btn').click(); }
});

document.addEventListener('paste', e => {
  const t = e.target;
  if (t.closest && t.closest('input, textarea, [contenteditable]')) {
    // Pasting into the empty editor also runs immediately: Ctrl+V is the whole workflow.
    if (t.id === 'source' && !t.value.trim()) setTimeout(() => { setSource(t.value, { label: 'Pasted HTML' }); analyze(); }, 0);
    return;
  }
  const plain = e.clipboardData.getData('text/plain');
  const rich = e.clipboardData.getData('text/html');
  const html = /<[a-z!][\s\S]*>/i.test(plain) ? plain : rich || plain;
  if (!html.trim()) return;
  e.preventDefault();
  sourceTabs.select(sourceTabs.tabs[0]);
  setSource(html, { label: rich && html === rich ? 'Pasted rich content (clipboard HTML)' : 'Pasted HTML' });
  analyze();
});

$('#url-form').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('#url-input').value.trim();
  status(`Fetching ${url}…`, 'busy');
  try {
    const res = await fetch('/api/fetch?url=' + encodeURIComponent(url) + ($('#render-js').checked ? '' : '&render=0'));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    let name = 'page.html';
    try { name = (new URL(data.url).hostname + new URL(data.url).pathname).replace(/[^a-z0-9.]+/gi, '-').replace(/-+$/, '') + '.html'; } catch { /* */ }
    setSource(data.html, { baseUrl: data.url, label: `${data.url}${data.rendered ? ' (rendered)' : ''}`, fileName: name });
    analyze();
  } catch (err) {
    status(`Couldn't fetch the page: ${err.message}`, 'error');
  }
});

async function loadFile(file) {
  if (!file) return;
  if (file.size > 3e6) return status('That file is over 3 MB. Choose a single page.', 'error');
  const text = await file.text();
  setSource(text, { label: file.name, fileName: file.name.replace(/(\.html?)?$/i, '.html') });
  analyze();
}
$('#file-input').addEventListener('change', e => loadFile(e.target.files[0]));
const dz = $('#dropzone');
for (const target of [dz, $('#source')]) {
  target.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  target.addEventListener('dragleave', () => dz.classList.remove('drag'));
  target.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); loadFile(e.dataTransfer.files[0]); });
}

$('#sample-select').addEventListener('change', async e => {
  const name = e.target.value;
  if (!name) return;
  const res = await fetch('samples/' + name);
  const html = await res.text();
  sourceTabs.select(sourceTabs.tabs[0]);
  setSource(html, { baseUrl: new URL('samples/', location.href).href, label: `Sample: ${e.target.selectedOptions[0].textContent}`, fileName: name });
  analyze();
});

$('#ai-toggle').addEventListener('change', e => {
  if (e.target.checked && !state.captioner) {
    state.captioner = createCaptioner({
      onStatus: s => { if (state.running) status(s, 'busy'); },
    });
  }
  if (state.result) status('Alt-text model ' + (e.target.checked ? 'enabled' : 'disabled') + '. Run the check again to use it.');
});

// ---------- run ----------
async function analyze() {
  if (state.running) return;
  if (!state.source.trim()) return status('Paste some HTML first (or press Ctrl+V anywhere).', 'error');
  state.running = true;
  $('#run-btn').disabled = true;
  status('Rendering the page in a locked sandbox…', 'busy');
  try {
    const result = await run(state.source, {
      baseUrl: state.baseUrl,
      overrides: state.overrides,
      captioner: $('#ai-toggle').checked ? state.captioner : null,
      onProgress: msg => status(msg + '…', 'busy'),
    });
    state.result = result;
    state.pending = {};
    renderResults();
    const b = result.before.summary, a = result.after.summary;
    status(`Done in ${(result.ms / 1000).toFixed(1)} s: ${plural(b.instances, 'issue')} found, ${a.instances === 1 ? "1 issue remains" : `${a.instances} issues remain`}.`);
    $('.input-panel').classList.add('compact');
    $('#empty').hidden = true;
  } catch (err) {
    console.error(err);
    status(err.message || String(err), 'error');
  } finally {
    state.running = false;
    $('#run-btn').disabled = false;
  }
}

// ---------- results ----------
function renderResults() {
  const r = state.result;
  $('#results').hidden = false;
  const applied = r.fixes.filter(f => f.status === 'applied');
  const verified = applied.filter(f => f.verified);
  const review = applied.filter(f => f.needsReview && !state.reviewed.has(f.id));
  const input = r.fixes.filter(f => f.status === 'needs-input');
  const suggested = r.fixes.filter(f => f.status === 'suggested');
  const b = r.before.summary, a = r.after.summary;
  const pct = b.instances ? Math.round(100 * (b.instances - a.instances) / b.instances) : 0;
  $('#summary').innerHTML = `
    <div class="metric ${a.instances === 0 ? 'good' : ''}">
      <div class="label">Issues</div>
      <div class="value"><span class="from">${b.instances} →</span> ${a.instances}</div>
      <div class="sub">${b.instances ? `${pct}% resolved · ` : ''}${a.wcagInstances} WCAG A/AA left${suggested.length ? ` · ${suggested.length} optional` : ''}</div>
    </div>
    <div class="metric">
      <div class="label">Fixes applied</div>
      <div class="value">${applied.length}</div>
      <div class="sub">${verified.length} verified by re-audit</div>
    </div>
    <div class="metric ${review.length + input.length ? 'attn' : 'good'}">
      <div class="label">Your attention</div>
      <div class="value">${review.length + input.length}</div>
      <div class="sub">${plural(input.length, 'needs', 'need')} input · ${review.length} to review</div>
    </div>
    <div class="metric export">
      <div class="row">
        <button class="btn btn-primary btn-sm" id="dl-html" type="button">Download fixed HTML</button>
        <button class="btn btn-sm" id="copy-html" type="button">Copy</button>
      </div>
      <div class="row">
        <button class="btn btn-sm" id="dl-md" type="button">Report (.md)</button>
        <button class="btn btn-sm" id="dl-json" type="button">JSON</button>
      </div>
    </div>`;
  $('#dl-html').onclick = () => download(state.fileName.replace(/\.html?$/i, '') + '.accessible.html', r.output, 'text/html');
  $('#copy-html').onclick = async () => { try { await navigator.clipboard.writeText(r.output); status('Fixed HTML copied to the clipboard.'); } catch { status('Clipboard access was blocked — use Download instead.', 'error'); } };
  $('#dl-md').onclick = () => download(state.fileName.replace(/\.html?$/i, '') + '.a11y-report.md', markdownReport(r), 'text/markdown');
  $('#dl-json').onclick = () => download(state.fileName.replace(/\.html?$/i, '') + '.a11y-report.json', JSON.stringify(jsonReport(r), null, 2), 'application/json');

  const counts = { 'rt-fixes': review.length + input.length || r.fixes.length, 'rt-remaining': r.after.summary.instances };
  for (const [id, n] of Object.entries(counts)) {
    const tab = document.getElementById(id);
    tab.querySelector('.count')?.remove();
    tab.insertAdjacentHTML('beforeend', `<span class="count" aria-label="(${n})">${n}</span>`);
  }
  renderFixes();
  renderDiff();
  renderScreenReader();
  renderRemaining();
  if (!document.querySelector('#rp-preview').hidden) renderPreview();
  else previewDirty = true;
}

const STATUS_ORDER = { 'needs-input': 0, applied: 1, rejected: 2 };

function renderFixes() {
  const r = state.result;
  const input = r.fixes.filter(f => f.status === 'needs-input');
  const review = r.fixes.filter(f => f.status === 'applied' && f.needsReview && !state.reviewed.has(f.id));
  const rejected = r.fixes.filter(f => f.status === 'rejected');
  const suggested = r.fixes.filter(f => f.status === 'suggested');
  const auto = r.fixes.filter(f => f.status === 'applied' && (!f.needsReview || state.reviewed.has(f.id)));
  const panel = $('#rp-fixes');
  if (!r.fixes.length) {
    panel.innerHTML = r.before.summary.instances ? '<p>No automatic fixes were possible. See <strong>Remaining</strong> for what to change by hand.</p>' : '<div class="allclear">No automatically detectable issues. Remember to test with a keyboard and a screen reader too.</div>';
    return;
  }
  let html = '';
  if (input.length) html += group('Needs your input', 'PasteProof could not infer these safely. Type the text and re-run.', input.map(fixCard).join(''));
  if (review.length) html += group('Review these guesses', 'Applied, but inferred from heuristics or AI. Accept, edit, or reject.', review.map(fixCard).join(''), review.length > 1 ? `<button class="btn btn-sm" id="accept-all" type="button">Accept all ${review.length}</button>` : '');
  if (auto.length) {
    const byRule = new Map();
    for (const f of auto) { if (!byRule.has(f.rule)) byRule.set(f.rule, []); byRule.get(f.rule).push(f); }
    const blocks = [...byRule.values()].map(list => `<details class="bulk"><summary>${esc(list[0].help)} <span class="chip ok">${list.length} fixed</span>${list.some(f => !f.verified) ? `<span class="chip fail">${list.filter(f => !f.verified).length} not verified</span>` : ''}</summary>${list.map(fixCard).join('')}</details>`).join('');
    html += group('Applied automatically', 'Deterministic repairs. Expand a rule to inspect each change.', blocks);
  }
  if (suggested.length) html += group('Optional — may change the layout', 'Not applied automatically because they resize elements. Apply the ones you want.', suggested.map(fixCard).join(''), suggested.length > 1 ? `<button class="btn btn-sm" id="apply-all-suggested" type="button">Apply all ${suggested.length}</button>` : '');
  if (rejected.length) html += group('Rejected by you', 'Left unchanged in the output.', rejected.map(fixCard).join(''));
  panel.innerHTML = html;
  panel.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', onFixAction));
  panel.querySelector('#apply-all-suggested')?.addEventListener('click', () => {
    for (const f of suggested) state.pending[f.id] = { value: f.value };
    renderFixes();
    updatePendingBar();
  });
  panel.querySelector('#accept-all')?.addEventListener('click', () => {
    for (const f of review) if (!state.pending[f.id]) state.reviewed.add(f.id);
    renderResults();
    status(`Marked ${plural(review.length, 'guess', 'guesses')} as reviewed.`);
  });
  panel.querySelectorAll('input[data-fix]').forEach(inp => inp.addEventListener('input', onFixEdit));
}

function group(title, sub, body, extra = '') {
  return `<div class="group"><div class="group-head"><h3>${esc(title)}</h3><p>${esc(sub)}</p>${extra}</div>${body}</div>`;
}

function fixCard(f) {
  const pend = state.pending[f.id];
  const val = pend && 'value' in pend ? pend.value : f.value;
  const editable = f.editable && f.status !== 'rejected' && f.status !== 'suggested';
  const chips = [
    `<span class="chip ${f.impact}">${esc(f.impact)}</span>`,
    f.wcag?.length ? `<span class="chip">WCAG ${esc(f.wcag.join(', '))} · ${esc(f.level)}</span>` : `<span class="chip">${esc(f.level)}</span>`,
    f.method === 'ai' ? '<span class="chip ai">AI</span>' : '',
    f.status === 'applied' ? (f.verified ? '<span class="chip ok">verified</span>' : '<span class="chip fail">still failing</span>') : '',
    f.userEdited ? '<span class="chip">edited by you</span>' : '',
  ].join('');
  const inputId = 'v-' + f.id.replace(/[^a-z0-9]/gi, '-');
  const editor = editable ? `<div class="edit-row">
      <label for="${inputId}">${f.editable === 'color' ? 'Colour' : f.rule === 'image-alt' ? 'Alt text' : f.editable === 'lang' ? 'Language' : 'Text'}</label>
      ${f.editable === 'color'
        ? `<input type="color" id="${inputId}" data-fix="${esc(f.id)}" value="${esc(val)}"><code>${esc(val)}</code>`
        : `<input type="text" id="${inputId}" data-fix="${esc(f.id)}" value="${esc(val)}" placeholder="${f.rule === 'image-alt' ? 'Describe the image (leave empty if decorative)' : 'Enter text'}">`}
    </div>` : '';
  const actions = [];
  if (f.status === 'applied' && f.needsReview && !state.reviewed.has(f.id)) actions.push(`<button class="btn btn-sm" data-act="accept" data-id="${esc(f.id)}" type="button">Accept</button>`);
  if (f.status === 'suggested') actions.push(`<button class="btn btn-sm" data-act="apply" data-id="${esc(f.id)}" type="button">${pend ? 'Will apply on re-run' : 'Apply'}</button>`);
  else if (f.status !== 'rejected') actions.push(`<button class="btn btn-sm btn-ghost" data-act="reject" data-id="${esc(f.id)}" type="button">${pend?.reject ? 'Undo reject' : 'Reject'}</button>`);
  else actions.push(`<button class="btn btn-sm" data-act="restore" data-id="${esc(f.id)}" type="button">Restore fix</button>`);
  if (f.rule === 'image-alt' && f.status === 'needs-input') actions.push(`<button class="btn btn-sm btn-ghost" data-act="decorative" data-id="${esc(f.id)}" type="button">It's decorative</button>`);
  return `<article class="fix ${f.status === 'rejected' || pend?.reject ? 'rejected' : ''}">
    <div class="fix-top"><span class="fix-title">${esc(f.help)}</span>${chips}</div>
    <p class="reason">${esc(f.reason)}</p>
    ${editor}
    <div class="code-pair">
      <pre class="old"><span class="cap">Before</span>${esc(f.before)}</pre>
      <pre class="${f.status === 'applied' ? 'new' : 'same'}"><span class="cap">${f.status === 'applied' ? 'After' : 'Unchanged'}</span>${esc(f.status === 'applied' ? f.after : f.before)}</pre>
    </div>
    <div class="edit-row">${actions.join('')}</div>
  </article>`;
}

function onFixEdit(e) {
  const id = e.target.dataset.fix;
  state.pending[id] = { value: e.target.value };
  if (e.target.type === 'color') e.target.nextElementSibling.textContent = e.target.value;
  updatePendingBar();
}

function onFixAction(e) {
  const { act, id } = e.currentTarget.dataset;
  const f = state.result.fixes.find(x => x.id === id);
  if (act === 'accept') { state.reviewed.add(id); renderResults(); return; }
  if (act === 'reject') {
    if (state.pending[id]?.reject) delete state.pending[id]; else state.pending[id] = { reject: true };
  }
  if (act === 'restore') state.pending[id] = { restore: true };
  if (act === 'decorative') state.pending[id] = { value: '' };
  if (act === 'apply') { if (state.pending[id]) delete state.pending[id]; else state.pending[id] = { value: f.value }; }
  renderFixes();
  updatePendingBar();
  void f;
}

function updatePendingBar() {
  const n = Object.keys(state.pending).length;
  $('#pending-bar').hidden = n === 0;
  $('#pending-text').textContent = `${plural(n, 'change')} not applied yet`;
}

$('#rerun-btn').addEventListener('click', () => {
  for (const [id, p] of Object.entries(state.pending)) {
    if (p.restore) delete state.overrides[id];
    else state.overrides[id] = p;
    if ('value' in p) state.reviewed.add(id);
  }
  state.pending = {};
  updatePendingBar();
  analyze();
});
$('#discard-btn').addEventListener('click', () => { state.pending = {}; updatePendingBar(); renderFixes(); });

// ---------- diff ----------
function renderDiff() {
  const r = state.result;
  const panel = $('#rp-diff');
  if (r.normalized === r.output) { panel.innerHTML = '<p>No changes were made to the code.</p>'; return; }
  const parts = Diff.diffLines(r.normalized, r.output);
  const rows = [];
  let o = 1, n = 1;
  const lines = s => s.replace(/\n$/, '').split('\n');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.removed && parts[i + 1]?.added) {
      const words = Diff.diffWordsWithSpace(p.value, parts[i + 1].value);
      const oldHtml = words.filter(w => !w.added).map(w => (w.removed ? `<del>${esc(w.value)}</del>` : esc(w.value))).join('');
      const newHtml = words.filter(w => !w.removed).map(w => (w.added ? `<ins>${esc(w.value)}</ins>` : esc(w.value))).join('');
      for (const l of splitHtmlLines(oldHtml)) rows.push(`<tr class="del"><td class="ln">${o++}</td><td class="ln"></td><td class="code">${l}</td></tr>`);
      for (const l of splitHtmlLines(newHtml)) rows.push(`<tr class="ins"><td class="ln"></td><td class="ln">${n++}</td><td class="code">${l}</td></tr>`);
      i++;
      continue;
    }
    const ls = lines(p.value);
    if (p.added) for (const l of ls) rows.push(`<tr class="ins"><td class="ln"></td><td class="ln">${n++}</td><td class="code"><ins>${esc(l)}</ins></td></tr>`);
    else if (p.removed) for (const l of ls) rows.push(`<tr class="del"><td class="ln">${o++}</td><td class="ln"></td><td class="code"><del>${esc(l)}</del></td></tr>`);
    else {
      const keep = 3;
      ls.forEach((l, k) => {
        const nearPrev = k < keep && i > 0;
        const nearNext = k >= ls.length - keep && i < parts.length - 1;
        if (nearPrev || nearNext) rows.push(`<tr><td class="ln">${o}</td><td class="ln">${n}</td><td class="code">${esc(l)}</td></tr>`);
        else if (k === keep || (i === 0 && k === 0)) {
          const hiddenCount = ls.length - (i > 0 ? keep : 0) - (i < parts.length - 1 ? keep : 0);
          if (hiddenCount > 0) rows.push(`<tr class="skip"><td colspan="3">⋯ ${plural(hiddenCount, 'unchanged line')}</td></tr>`);
        }
        o++; n++;
      });
    }
  }
  const added = parts.filter(p => p.added).reduce((s, p) => s + p.count, 0);
  const removed = parts.filter(p => p.removed).reduce((s, p) => s + p.count, 0);
  panel.innerHTML = cssPatchHtml(r) + `<div class="toolbar"><span>${plural(removed, 'line')} changed → ${plural(added, 'line')}</span></div><div class="diff" tabindex="0" role="region" aria-label="Code diff"><table><caption class="sr-only">Changes between original and fixed HTML</caption><tbody>${rows.join('')}</tbody></table></div>`;
}

function cssPatchText(r) {
  const byFile = new Map();
  for (const p of r.cssPatch) { if (!byFile.has(p.file)) byFile.set(p.file, []); byFile.get(p.file).push(p); }
  return [...byFile].map(([file, list]) => `/* ${file} */\n` + list.map(p => `${p.selector} {\n  ${p.property}: ${p.to}; /* was ${p.from} */\n}`).join('\n')).join('\n\n') + '\n';
}

function cssPatchHtml(r) {
  if (!r.cssPatch?.length) return '';
  setTimeout(() => { const b = document.getElementById('dl-css'); if (b) b.onclick = () => download('accessibility.css-patch.css', cssPatchText(r), 'text/css'); });
  return `<div class="note"><strong>External stylesheet changes.</strong> These colours come from CSS files PasteProof can't edit, so the fixed HTML includes an override block (<code>#pasteproof-fixes</code>). For a clean fix, change these rules in the original files and delete the block.
    <pre class="patch" tabindex="0">${esc(cssPatchText(r))}</pre><button class="btn btn-sm" id="dl-css" type="button">Download CSS patch</button></div>`;
}

function splitHtmlLines(html) {
  const out = html.replace(/\n$/, '').split('\n');
  // Re-balance tags broken across lines so each row is valid markup.
  let open = '';
  return out.map(line => {
    const fixed = open + line;
    const opens = (fixed.match(/<(del|ins)>/g) || []).length, closes = (fixed.match(/<\/(del|ins)>/g) || []).length;
    const tag = (fixed.match(/<(del|ins)>(?![\s\S]*<\/\1>)/) || [])[1];
    open = opens > closes && tag ? `<${tag}>` : '';
    return fixed + (open ? `</${tag}>` : '');
  });
}

// ---------- screen reader ----------
function renderScreenReader() {
  const { before, after } = state.result.screenReader;
  const probs = list => list.filter(x => x.problem).length;
  const col = (title, list) => `<div class="sr-col" tabindex="0" role="region" aria-label="${esc(title)} — screen reader output"><h3>${esc(title)} <span class="chip ${probs(list) ? 'fail' : 'ok'}">${probs(list)} unnamed or unlabeled</span></h3><ol>${list.map(x => {
    const cls = x.problem ? 'problem' : x.landmark ? 'landmark' : '';
    const text = x.problem && !x.text ? '(no name — announced as just the role)' : x.text;
    const st = x.states?.length ? `, ${x.states.join(', ')}` : '';
    return `<li class="${cls}">${x.kind !== 'text' ? `<span class="kind">${esc(x.kind)}${esc(st)}</span>` : ''}${esc(text)}</li>`;
  }).join('')}</ol></div>`;
  $('#rp-sr').innerHTML = `<p class="note">What a screen-reader user hears when reading top to bottom, using axe-core's role and accessible-name computation. Red lines are images and controls with no usable name — e.g. a button announced only as "button", or an image announced by its file name.</p>
    <div class="sr-cols">${col('Original', before)}${col('Fixed', after)}</div>`;
}

// ---------- preview ----------
let previewDirty = true;
function renderPreview() {
  if (!state.result || !previewDirty) return;
  previewDirty = false;
  const r = state.result;
  const mk = html => buildRenderHtml(new DOMParser().parseFromString(html, 'text/html'), { baseUrl: r.baseUrl, fragment: r.fragment, withAxe: false });
  $('#rp-preview').innerHTML = `<p class="note">Fixes are designed not to change the layout. Compare both versions — scripts are disabled in both previews.</p>
    <div class="preview-cols">
      <figure><figcaption>Original</figcaption><iframe sandbox title="Preview of the original page"></iframe></figure>
      <figure><figcaption>Fixed</figcaption><iframe sandbox title="Preview of the fixed page"></iframe></figure>
    </div>`;
  const [a, b] = $('#rp-preview').querySelectorAll('iframe');
  a.srcdoc = mk(r.normalized);
  b.srcdoc = mk(r.output);
}

// ---------- remaining ----------
function renderRemaining() {
  const r = state.result;
  const v = r.after.violations;
  const inc = r.after.incomplete;
  let html = `<p class="note">Automated testing finds a large share of accessibility problems, but not all. After fixing these, try the page with only a keyboard (Tab, Enter, Space, Esc) and with a screen reader (NVDA, VoiceOver).</p>`;
  if (!v.length) html += '<div class="allclear">No automatically detectable WCAG violations remain.</div>';
  else html += `<h3>Still failing (${r.after.summary.instances})</h3>` + v.map(issueCard).join('');
  if (inc.length) html += `<h3 style="margin-top:1.5rem">Needs a human check (${inc.reduce((s, x) => s + x.nodes.length, 0)})</h3><p class="hint" style="margin-bottom:.6rem">axe-core could not decide these automatically — for example text over background images.</p>` + inc.map(issueCard).join('');
  if (r.warnings.length) html += `<h3 style="margin-top:1.5rem">Warnings</h3><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
  $('#rp-remaining').innerHTML = html;
}

function issueCard(v) {
  return `<div class="issue"><div class="fix-top"><span class="fix-title">${esc(v.help)}</span><span class="chip ${v.impact}">${esc(v.impact)}</span>${v.wcag?.length ? `<span class="chip">WCAG ${esc(v.wcag.join(', '))}</span>` : ''}<span class="chip">${plural(v.nodes.length, 'element')}</span></div>
    ${v.helpUrl ? `<p class="reason"><a href="${esc(v.helpUrl)}" target="_blank" rel="noopener">How to fix: ${esc(v.rule)}<span class="sr-only"> (opens in a new tab)</span></a></p>` : `<p class="reason">${esc(v.description || '')}</p>`}
    ${v.nodes.slice(0, 3).map(n => `<pre>${esc(n.html)}</pre>`).join('')}${v.nodes.length > 3 ? `<p class="hint">…and ${v.nodes.length - 3} more</p>` : ''}</div>`;
}

// ---------- reports ----------
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function jsonReport(r) {
  return {
    tool: 'PasteProof', engine: `axe-core ${window.axeVersion || ''}`.trim(), generated: new Date().toISOString(), source: state.label,
    before: r.before.summary, after: r.after.summary,
    fixes: r.fixes.map(({ before, after, ...f }) => ({ ...f, reviewed: state.reviewed.has(f.id), before, after })),
    cssPatch: r.cssPatch,
    remaining: r.after.violations.map(v => ({ rule: v.rule, impact: v.impact, wcag: v.wcag, help: v.help, elements: v.nodes.map(n => n.html) })),
    needsHumanCheck: r.after.incomplete.map(v => ({ rule: v.rule, help: v.help, elements: v.nodes.length })),
  };
}

function markdownReport(r) {
  const b = r.before.summary, a = r.after.summary;
  const applied = r.fixes.filter(f => f.status === 'applied');
  const md = [
    `# Accessibility remediation report`, '',
    `Source: ${state.label || 'pasted HTML'}  `, `Generated: ${new Date().toLocaleString()} by PasteProof (axe-core audit, WCAG 2.2 A/AA + best practices)`, '',
    `| | Before | After |`, `|---|---:|---:|`,
    `| Issues (element instances) | ${b.instances} | ${a.instances} |`, `| WCAG A/AA instances | ${b.wcagInstances} | ${a.wcagInstances} |`,
    `| Critical | ${b.byImpact.critical} | ${a.byImpact.critical} |`, `| Serious | ${b.byImpact.serious} | ${a.byImpact.serious} |`,
    `| Moderate | ${b.byImpact.moderate} | ${a.byImpact.moderate} |`, `| Minor | ${b.byImpact.minor} | ${a.byImpact.minor} |`, '',
    `**${applied.length} fixes applied, ${applied.filter(f => f.verified).length} verified by re-audit.** ${applied.filter(f => f.needsReview && !state.reviewed.has(f.id)).length} still need human review.`, '',
    `## Fixes`, '',
    `| Rule | WCAG | Change | How | Verified | Reviewed |`, `|---|---|---|---|---|---|`,
    ...r.fixes.map(f => `| ${f.help} | ${f.wcag?.join(', ') || '—'} | ${f.status === 'applied' ? f.reason.replace(/\|/g, '\\|') : f.status} | ${f.method}/${f.confidence} | ${f.status === 'applied' ? (f.verified ? 'yes' : 'no') : '—'} | ${f.needsReview ? (state.reviewed.has(f.id) ? 'yes' : '**pending**') : 'n/a'} |`),
    ...(r.cssPatch?.length ? ['', '## Stylesheet patch', '', 'Apply to the original CSS files, then remove the `#pasteproof-fixes` block:', '', '```css', cssPatchText(r).trim(), '```'] : []),
    ...(r.fixes.some(f => f.status === 'suggested') ? ['', '## Optional (may change layout)', '', ...r.fixes.filter(f => f.status === 'suggested').map(f => `- ${f.help}: ${f.reason}`)] : []),
    '', `## Remaining issues`, '',
    ...(r.after.violations.length ? r.after.violations.map(v => `- **${v.help}** (${v.impact}; WCAG ${v.wcag?.join(', ') || '—'}) — ${v.nodes.length} element(s). ${v.helpUrl || ''}`) : ['None detected automatically.']),
    '', `## Needs manual verification`, '',
    ...(r.after.incomplete.length ? r.after.incomplete.map(v => `- ${v.help} — ${v.nodes.length} element(s)`) : ['None.']),
    '', '_Automated tools cannot detect every WCAG failure. Test with a keyboard and a screen reader before release._', '',
  ];
  return md.join('\n');
}

// ---------- bookmarklet: receive a live page's DOM from another tab ----------
{
  const origin = location.origin;
  const code = `(()=>{const o=${JSON.stringify(origin)};const w=window.open(o+'/#receive','pasteproof');const d={type:'pasteproof-page',url:location.href,html:(document.doctype?'<!DOCTYPE html>\\n':'')+document.documentElement.outerHTML};let n=0;const t=setInterval(()=>{if(++n>60)clearInterval(t);try{w.postMessage(d,o)}catch(e){}},250);addEventListener('message',e=>{if(e.origin===o&&e.data==='pasteproof-ack')clearInterval(t)})})()`;
  $('#bookmarklet').href = 'javascript:' + encodeURIComponent(code);
  $('#bookmarklet').addEventListener('click', e => { e.preventDefault(); status('Drag the "Send to PasteProof" button to your bookmarks bar, then click it on the page you want to fix.'); });
  let received = false;
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || d.type !== 'pasteproof-page' || typeof d.html !== 'string' || typeof d.url !== 'string') return;
    e.source?.postMessage('pasteproof-ack', e.origin);
    if (received) return;
    received = true;
    let name = 'page.html';
    try { name = new URL(d.url).hostname + '.html'; } catch { /* */ }
    sourceTabs.select(sourceTabs.tabs[0]);
    setSource(d.html, { baseUrl: d.url, label: `${d.url} (sent from your browser)`, fileName: name });
    analyze();
    setTimeout(() => { received = false; }, 3000);
  });
  if (location.hash === '#receive') status('Waiting for the page from your other tab…', 'busy');
}

// Expose the engine for the CLI / evaluation harness (same code path as the UI).
window.PasteProof = { run, isFragment };
