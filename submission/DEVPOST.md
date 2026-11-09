# Devpost submission — copy each block into the matching field

---

## Project name

PasteProof

## Short description (tagline)

Ctrl+V a broken web page, get it back accessible. PasteProof fixes the HTML and CSS itself and re-audits every fix, without moving a pixel of your layout. Free, and it runs entirely on your machine.

---

## Detailed description

### The problem

94.8% of the top one million home pages fail WCAG, and the average page has about 51 errors ([WebAIM Million 2025](https://webaim.org/projects/million/2025)). The same few failures appear everywhere:

- low-contrast text;
- images without alt text;
- form fields without labels;
- buttons and links with no name;
- missing page language.

Each one locks real people out of essential services:

- **Blind and low-vision people** using screen readers hear "button, button, link, image IMG_2041.jpg". They cannot book a clinic visit, file a benefits application, or check a child's school bus.
- **Keyboard and switch users** (motor disabilities) cannot reach a "button" that is really a `<div onclick>`.
- **Low-vision users** cannot read grey-on-white text or zoom into pages that block zoom.
- **Voice-control users** say the label they see ("English"), and nothing happens because the hidden name is "Language".
- **People with memory or motor impairments** retype their name, phone, and address on every form because no field declares its `autocomplete` purpose.

The people who own these pages are clinic web admins, school district staff, city IT, food banks, and small nonprofits. They don't have an accessibility specialist. Existing tools fail them in two ways:

- **Checkers** (axe, WAVE, Lighthouse) list hundreds of problems and leave every fix to the developer.
- **Overlays** inject a script that patches the page at runtime. The source stays broken, and the FTC fined the best-known overlay vendor $1M in 2025 for claiming its AI made sites compliant.

The pressure is real and dated. US state and local governments must meet WCAG 2.1 AA under the DOJ's ADA Title II rule (deadline April 2027 for large entities), and the European Accessibility Act has applied since June 2025.

### What PasteProof does

**Paste HTML, press Ctrl+V anywhere on the page, give it a URL, or click a bookmarklet. Seconds later you get repaired source code, and every single repair is proven.**

1. **Audit.** PasteProof renders the page in a locked sandbox (no page scripts, strict CSP) and runs axe-core (WCAG 2.2 A/AA plus best practices). It adds its own checks for barriers axe misses:
   - mouse-only click handlers;
   - vague links ("Click here");
   - missing input purpose;
   - asterisk-only required fields;
   - placeholder-only labels.
2. **Repair the source.** More than 50 targeted repairs, each mapped to a WCAG success criterion:
   - **Contrast:** the smallest colour change that passes, keeping the brand hue. It edits the actual CSS rule (even through inheritance), not inline styles. For external stylesheets it writes an equally specific override **and a CSS patch for the original file**. On Hacker News, 241 low-contrast texts become **6 rule changes**.
   - **Images:** on-device AI alt text (Florence-2 running in your browser via WebGPU, no upload). It also detects decorative images (spacers, layout slices, bullets), names linked images by their destination, and removes alt text that repeats the adjacent text.
   - **Forms:** connects the visible label already on screen, marks required fields for screen readers, and adds `autocomplete` tokens so browsers fill in name, email, phone, and address.
   - **Names:** reads intent from icon classes (`fa-search` → "Search"), SVG titles, link destinations, and click-handler names. It fixes spoken names that don't contain the visible text.
   - **Keyboard:** turns `<div onclick>` into a focusable, Enter/Space-operable control.
   - **Structure:** page language (detected from the text), title, main/header/nav/footer landmarks, skip link, heading levels (via `aria-level`, so nothing changes visually), ARIA typos and invalid values, zoom blocking, `<marquee>`.
3. **Re-audit and prove it.** The fixed page is rendered and audited again, up to 4 passes. Every fix is marked **verified** only when the final audit no longer reports it. PasteProof also measures that **all page text is kept** and **every element keeps its position and size**. Fixes that would reflow the page, such as enlarging 642 links on Craigslist, are offered as one-click optional suggestions and never forced.
4. **Keep the human in charge.** Deterministic fixes apply automatically. Guesses (AI or heuristic) are applied but flagged for review, with editable text, Accept, and Reject. If PasteProof cannot know something, like the meaning of a photo with no clues, it asks rather than inventing a placeholder. Re-run with your edits and everything is re-verified.

What you see:

| View | What it shows |
|---|---|
| **Fixes** | Every repair, grouped *Needs input → Review → Applied → Optional*. |
| **Screen reader** | What a blind user hears before and after: 12 unnamed controls and images → 0 on the clinic sample. |
| **Code diff** | The HTML diff plus the CSS patch. |
| **Preview** | Original and fixed versions side by side. |
| **Remaining** | Anything still open. |
| **Export** | Fixed HTML, Markdown report, JSON, and the CSS patch. |

Get any page in:

| Input | What it does |
|---|---|
| **Ctrl+V anywhere** | Pastes and runs immediately. The keyboard shortcut is the whole workflow. |
| **URL** | Rendered in headless Chrome so React and Vue sites are captured; private-network addresses are blocked on every request. |
| **"Send to PasteProof" bookmarklet** | Captures pages **behind a login**, like a benefits portal or a parent account, straight from your browser. Nothing goes to a server. |
| **CLI for CI** | `node cli.js page.html --fail-on serious` blocks a deploy that would ship new barriers. |

### Proof: tested on 21 pages, 13 of them live public-service websites

We did not stop at our own demo pages. We ran PasteProof against **Hacker News, IRS.gov, NYC.gov, HealthCare.gov, Chicago.gov, gov.tw, 211.org, CalFresh, SFUSD, Craigslist, FoodPantries.org, Feeding America, and Berkeley Library**, plus W3C's official inaccessible demo site.

| Result | |
|---|---|
| Accessibility issues | **1,604 → 15** (plus 683 optional target-size suggestions offered, not forced) |
| Applied fixes verified by re-audit | **781 / 781** |
| New problems introduced | **0** on 21 pages |
| Page text preserved | **100%** on every page |
| Layout preserved | **100%** of elements unchanged on every page whose images loaded |
| vs. W3C's own expert hand-fixed pages | **18 remaining axe issues vs. 79** |
| Speed | about 2 seconds per page, including all re-audits |

Real barriers it removed:

- **NYC.gov:** the language button's spoken name, "Language", didn't contain its visible label, "English". Voice-control users could not press it. Fixed.
- **FoodPantries.org:** 117 WCAG failures → 0.
- **Hacker News:** 280 → 1. The grey text is fixed with 6 CSS rules plus a patch for `news.css`, with no layout change.

Running real sites exposed 15 edge cases in our own engine, such as a footer misread as navigation or a hidden menu chosen as "main". We fixed every one and re-verified. PasteProof's own interface passes axe with **zero violations** in every view, in light and dark mode and on mobile, enforced by an automated test.

### How we built it

- **Engine (browser JavaScript, no framework, no build step):**
  - DOMParser working copy;
  - sandboxed `srcdoc` render with CSP that allows only our vendored axe-core;
  - axe-core 4.14 audit;
  - a rule-to-fixer registry;
  - a CSSOM-verified stylesheet editor;
  - a re-render loop with per-fix verification and element-box layout comparison;
  - screen-reader linearisation using axe-core's own role and accessible-name computation.
- **AI:** Florence-2 (base) in a Web Worker through Transformers.js, on WebGPU with a WASM fallback. Fully on-device, so no image ever leaves the machine.
- **Server (Node, zero framework):** static hosting plus a guarded fetch proxy for pages, images, and stylesheets. It uses DNS-checked private-network blocking, size and redirect limits, and Puppeteer to render JavaScript pages.
- **CLI and evaluation:** the same engine driven in headless Chrome or Edge, an evaluation harness against W3C's expert baseline, and 4 focused tests.
- **Cost:** $0. No API keys, no paid services, no GPU required.

### What's next

- A GitHub Action that comments fixes on pull requests.
- Patches mapped back to JSX and template source.
- A site-wide crawl report for city and school web teams facing the 2027 deadline.

---

## Built with

javascript, node.js, axe-core, transformers.js, florence-2, webgpu, onnx-runtime-web, puppeteer, chrome-headless, jsdiff, html5, css3, wcag

## Links

- Live demo: https://cs113062273-bot.github.io/pasteproof/
- Source: https://github.com/cs113062273-bot/pasteproof

## Screenshots (upload in this order)

`submission/screenshots/`:

1. `01-results.png`
2. `02-review-ai.png`
3. `03-screen-reader.png`
4. `07-real-site-summary.png`
5. `06-real-site-css-patch.png`
6. `08-real-site-diff.png`
7. `05-preview.png`
8. `04-diff.png`
9. `00-start.png`
