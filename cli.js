#!/usr/bin/env node
// pasteproof <file.html | URL> [-o fixed.html] [--json report.json] [--fail-on serious]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startEngine } from './lib/headless.js';

const RANK = { none: 99, critical: 4, serious: 3, moderate: 2, minor: 1, any: 0 };
const args = process.argv.slice(2);
const opt = (names, def = null) => { const i = args.findIndex(a => names.includes(a)); return i >= 0 ? args.splice(i, 2)[1] : def; };
if (!args.length || args.includes('-h') || args.includes('--help')) {
  console.log(`Usage: pasteproof <file.html | https://url> [options]

  -o, --out <file>      write the fixed HTML (default: <name>.accessible.html)
  --json <file>         write a machine-readable report
  --base <url>          base URL for resolving relative CSS/images of a local file
  --fail-on <level>     exit 1 if issues of this impact or worse remain after fixing
                        (critical | serious | moderate | minor | any | none; default: none)`);
  process.exit(0);
}
const out = opt(['-o', '--out']);
const json = opt(['--json']);
let base = opt(['--base']);
const failOn = opt(['--fail-on'], 'none');
if (!(failOn in RANK)) { console.error(`Unknown --fail-on level "${failOn}"`); process.exit(2); }
const input = args[0];

let html, name;
if (/^https?:\/\//i.test(input)) {
  const res = await fetch(input, { headers: { 'user-agent': 'PasteProof/1.0 (accessibility checker)' } });
  if (!res.ok) { console.error(`Fetch failed: ${res.status} ${res.statusText}`); process.exit(2); }
  html = await res.text();
  base ??= res.url;
  name = new URL(res.url).hostname + '.html';
} else {
  html = await readFile(input, 'utf8').catch(e => { console.error(`Cannot read ${input}: ${e.message}`); process.exit(2); });
  name = path.basename(input);
}

const engine = await startEngine();
// Local files: serve relative assets through file:// is blocked in srcdoc, so default to the engine's own origin only when inside /public.
if (!base && !/^https?:/i.test(input)) {
  const pub = path.resolve('public') + path.sep;
  const abs = path.resolve(input);
  if (abs.startsWith(pub)) base = engine.origin + '/' + path.relative(pub, path.dirname(abs)).split(path.sep).join('/') + '/';
}
try {
  const r = await engine.fix(html, { baseUrl: base });
  const outFile = out || name.replace(/\.html?$/i, '') + '.accessible.html';
  await writeFile(outFile, r.output);
  const b = r.before.summary, a = r.after.summary;
  const applied = r.fixes.filter(f => f.status === 'applied');
  console.log(`${name}: ${b.instances} issues → ${a.instances} remaining (${applied.length} fixes, ${applied.filter(f => f.verified).length} verified, ${applied.filter(f => f.needsReview).length} to review, ${r.fixes.filter(f => f.status === 'needs-input').length} need input) in ${(r.ms / 1000).toFixed(1)}s`);
  for (const v of r.after.violations) console.log(`  remaining  ${v.impact.padEnd(8)} ${v.rule} ×${v.nodes.length}  ${v.help}`);
  for (const w of r.warnings) console.log(`  warning    ${w}`);
  for (const f of r.fixes.filter(x => x.status === 'needs-input')) console.log(`  input      ${f.rule}  ${f.before.slice(0, 90)}`);
  console.log(`Fixed HTML → ${outFile}`);
  if (json) {
    await writeFile(json, JSON.stringify({ source: input, before: r.before.summary, after: r.after.summary, fixes: r.fixes, remaining: r.after.violations, incomplete: r.after.incomplete }, null, 2));
    console.log(`Report → ${json}`);
  }
  const worst = Math.max(0, ...r.after.violations.map(v => RANK[v.impact]));
  process.exitCode = worst >= RANK[failOn] && r.after.violations.length ? 1 : 0;
} finally {
  await engine.close();
}
void pathToFileURL;
