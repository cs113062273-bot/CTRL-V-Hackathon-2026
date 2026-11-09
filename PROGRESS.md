# Progress

## 2026-11-09

**Done**
- Researched the rules, judging criteria, judges, and deadline, plus the problem space and competitors ([RESEARCH.md](RESEARCH.md)).
- Chose verified source-level WCAG repair ([STRATEGY.md](STRATEGY.md)).
- Engine: sandboxed render plus axe-core audit, about 45 fixers, 3-pass fix/re-audit loop, per-fix verification, rule-group rejection, CSS-rule contrast edits, screen-reader linearisation.
- UI: paste / Ctrl+V / URL / file / samples; fixes review queue with edit, reject, accept-all, and re-run; diff; screen-reader before/after; preview; remaining issues; exports (HTML, Markdown, JSON).
- On-device AI alt text (Florence-2 via Transformers.js, WebGPU with WASM fallback), verified working in Chrome.
- CLI with `--fail-on` for CI; evaluation harness against the W3C BAD pages and expert baselines; 3 focused tests.
- Self-audit: PasteProof's UI has 0 axe violations in every state.

**Decisions**
- No overlay and no runtime script: fixes are written into the source.
- Never wrap text in new elements (CSS side effects) → use `aria-labelledby` or `aria-label`.
- Invalid ARIA values are corrected to preserve current browser behaviour, not the guessed author intent (for example, invalid `aria-hidden` is removed).
- Unknown means ask: no placeholder alt text or labels.

**Iteration 2 (push to 95)**
- Added 13 live public-service sites to the evaluation. This exposed 9 real defects (layout reflow from target-size, nested-interactive, page-sized "banner", main on a hidden menu, duplicate-banner over-correction, landmark naming, name-mismatch semantics, marquee box, a wrong field label). All are fixed and re-verified.
- New: layout-preservation metric; external stylesheet reading (guarded CSS proxy) with override rules and a CSS patch; contrast rules followed through inheritance; JavaScript-rendered URL fetch with per-request private-network blocking; bookmarklet for logged-in pages; opt-in suggestions; evidence-based confidence calibration (review share 73% → 27%); fixers for redundant alt, decorative icons, label/name mismatch, and nested or duplicate landmarks.
- Tests 4/4, including a UI self-audit. Internal score 87 → 93.

**Open issues** (see [EVALUATION.md](EVALUATION.md))
- Review burden from medium-confidence heuristics.
- Framework source is not rewritten; one page at a time.
- No study with assistive-tech users.
- Submission items (video, Devpost text) were out of scope for this build.
