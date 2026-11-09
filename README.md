# PasteProof

**Paste inaccessible HTML. Get accessible code back. Every fix is re-checked.**

**Live demo:** https://cs113062273-bot.github.io/pasteproof/ (runs fully in your browser; URL fetching needs the local app). Submission materials: [`submission/`](submission/).

PasteProof audits a web page or component with [axe-core](https://github.com/dequelabs/axe-core) (WCAG 2.2 A/AA plus best practices) and its own extra checks. It repairs the **source HTML and CSS**, then re-renders the result and audits it again. Each change is labelled *verified* or *still failing*. It also measures that the page layout and text did not change. Fixes it is unsure about wait in a review queue, where you can accept, edit, or reject each one.

It is not an overlay. Nothing is injected into your site at runtime. You get a normal HTML file, a diff, a CSS patch for your stylesheet files, and a report.

## Why

- 94.8% of the top million home pages have detectable WCAG failures. The most common are low-contrast text, missing alt text, missing form labels, and empty links and buttons ([WebAIM Million 2025](https://webaim.org/projects/million/2025)).
- Checkers (axe, WAVE, Lighthouse) *find* these problems but leave the fixing to developers. Overlays claim to fix them at runtime. The FTC ordered accessiBe to pay $1M for overstating such claims ([TechCrunch, Jan 2025](https://techcrunch.com/2025/01/03/ftc-orders-ai-accessibility-startup-accessibe-to-pay-1m-for-misleading-advertising); finalised April 2025).
- The people blocked are applicants for benefits, clinic patients, parents on school portals, and transit riders. These are the "access to essential services" barriers this hackathon targets.

## Quick start

Requirements: Node 18+ and Chrome, Edge, or Chromium. There are no API keys, paid services, or GPU requirements.

```bash
npm install
npm start            # → http://127.0.0.1:5173
```

Ways to get a page in:

- **Ctrl+V anywhere** on the page pastes the clipboard and runs immediately.
- **From URL**: the local server opens the page in headless Chrome so JavaScript-built sites (React, Vue, …) are captured. Every request the page makes is checked against a private-network block.
- **Send to PasteProof bookmarklet**: for pages behind a login (benefit portals, school accounts). Drag it to your bookmarks bar and click it on the page while signed in. The live DOM goes straight to your PasteProof tab and no server is involved.
- **Upload or drop** an `.html` file, or open one of the four realistic samples.

Optional: tick **On-device AI alt text** to describe images that have no other clues, using Florence-2 running in your browser (Transformers.js, WebGPU or WASM). The model downloads once (about 275–360 MB) and is cached. Images never leave your machine.

## What you get

| View | Purpose |
|---|---|
| **Fixes** | Every change with its WCAG criterion, impact, confidence, and reason. Groups: *Needs your input* → *Review these guesses* → *Applied automatically* → *Optional (may change layout)*. Edit any text or colour, reject or apply a fix, then **Re-run with my changes**. Accept all and Apply all are available. |
| **Code diff** | Line and word diff of the HTML, plus a **CSS patch** for external stylesheets (file → selector → old and new value). |
| **Screen reader** | What a screen reader announces from top to bottom, before and after, using axe-core's role and name computation. Unnamed controls and images read out by file name are shown in red. |
| **Preview** | The original and fixed versions side by side, with scripts disabled. |
| **Remaining** | Issues still failing, plus items axe-core could not decide (for example, text over images). |
| **Export** | Fixed HTML (download or copy), a Markdown report, a JSON report, and the CSS patch. |

## What it repairs

| Area | Repair | Decided by |
|---|---|---|
| Contrast (1.4.3) | Smallest same-hue change that reaches the ratio. It edits the `<style>` rule that sets the colour, following inheritance up the tree; for external CSS it adds one equally specific override and writes a patch for the file. Each choice is verified in the CSSOM, with inline styles only as a last resort. | Deterministic |
| Images (1.1.1) | Text read from inside SVG files (logos), decorative detection (spacers, layout slices, repeated bullets, furniture file names), alt text that repeats nearby text removed, linked images named by their destination, captions, titles, on-device AI captions, meaningful file names. Otherwise it asks you. | Heuristic or AI, flagged for review |
| Form labels (1.3.1, 4.1.2, 3.3.2) | Connects the visible neighbouring label (sibling, table cell, wrapping text) via `aria-labelledby`/`for`, replaces placeholder-only labels, and marks asterisk-only required fields. It never wraps text in new elements, because new elements can match your CSS. | Heuristic |
| Names (4.1.2, 2.4.4, 2.5.3) | Icon classes (`fa-search` → "Search"), SVG titles, link destinations, logo links, click-handler names. It fixes names that don't contain the visible text and hides icons inside already-labelled controls. | Heuristic |
| Keyboard (2.1.1) | `<div onclick>` → `role`, `tabindex`, Enter/Space handler (skipped for delegated containers that hold links) | Deterministic |
| Structure | `lang` (detected), `<title>`, the main landmark (author-named and visible containers first, never hidden off-canvas menus), header/navigation/footer, unique landmark names, nested and duplicate landmarks, skip link, heading levels via `aria-level` (no visual change), lists | Deterministic or heuristic |
| Other | Zoom blocking, ARIA typos and invalid values (preserving current browser behaviour), focusable content inside `aria-hidden`, positive tabindex, `<marquee>`/`<blink>` (same box), vague link text, `autocomplete` input purpose (1.3.5) | Mostly deterministic |
| Target size (2.5.8) | Offered as an **optional** suggestion and never applied silently, because enlarging targets reflows the page | Opt-in |

## CLI (CI-friendly)

```bash
node cli.js page.html -o page.accessible.html --json report.json
node cli.js https://example.org --fail-on serious   # exit 1 if serious/critical issues remain
```

The CLI runs exactly the same engine as the UI in headless Chrome or Edge. Set `PASTEPROOF_BROWSER` if neither is in a standard location.

## Evaluate and test

Static build for any free host (GitHub Pages, Cloudflare Pages): `npm run build:static` writes `dist/`.

```bash
npm run eval   # 21 pages: 4 samples, 4 W3C "BAD" demo pages (vs W3C's expert fixes), 13 real public-service sites
npm test       # 4 tests: contrast math, image naming, human-review round trip, UI self-audit
```

Results are in [EVALUATION.md](EVALUATION.md).

## Architecture

```
public/
  index.html, app.js, styles.css     UI (no framework, no build step)
  engine/pipeline.js                 audit → fix → re-render → re-audit (≤4 passes) → per-fix verification + layout check
  engine/audit.js                    script-free, CSP-locked sandbox iframe + axe-core; screen-reader view
  engine/fixers.js                   repairs per axe rule + PasteProof's own checks
  engine/color.js, names.js, lang.js pure helpers
  engine/caption-worker.js           Florence-2 in a Web Worker
server.js                            static files; guarded fetch of pages (headless-rendered), images, stylesheets
cli.js, lib/headless.js, lib/browser.js   same engine in headless Chrome/Edge
eval/run.js                          evaluation harness
```

**Safety.**

- Pasted or fetched HTML is audited with every script, inline handler, and `javascript:` URL removed, under a Content-Security-Policy that allows only PasteProof's own vendored axe-core.
- The fixed output keeps your original scripts.
- The fetch proxy and the headless renderer block private and loopback addresses for every request (`PASTEPROOF_ALLOW_PRIVATE=1` allows a local dev server) and limit size, redirects, and time.

## Limitations

- Automated checks cover only part of WCAG. Always test with a keyboard and a screen reader.
- Framework source (JSX, templates) is not rewritten. Copy the changes from the diff and the CSS patch.
- One page at a time; there is no site crawl.

## Credits and licences

axe-core (MPL-2.0), jsdiff (BSD-3-Clause), puppeteer-core (Apache-2.0), Transformers.js (Apache-2.0), Florence-2 (MIT). Sample photos are public domain from Wikimedia Commons. Third-party pages are fetched at evaluation time and not redistributed. PasteProof itself is MIT-licensed.
