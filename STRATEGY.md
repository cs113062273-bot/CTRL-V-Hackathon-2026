# Strategy

## Decision

**PasteProof** is a verified, source-level accessibility repair tool. You paste HTML (or give a URL or file) and get fixed HTML/CSS back. Every change is re-audited, and every guess goes through human review.

### Directions considered

| Direction | Impact | Originality | Feasible ($0, ~2 days) | Verdict |
|---|---|---|---|---|
| Plain-language explainer for forms/benefits | Medium (one reader at a time) | Low: at least 5 similar Devpost projects | Needs an LLM API or a weak local model | Rejected |
| Benefits eligibility screener | High | Medium | Rules data per state; correctness risk | Rejected: hard to make trustworthy |
| Live captioning / sign language | High | Medium | Model quality on CPU is the bottleneck | Rejected |
| **Source-level WCAG repair with verification** | High: one fix serves every visitor of a page | High: checkers don't fix, overlays don't fix source, LLMs don't verify | Fully local (axe-core, Chrome, Transformers.js) | **Chosen** |

## Target users

- Developers, designers, and content editors at public services, clinics, schools, NGOs, and small businesses who must meet WCAG/ADA/EAA requirements without an accessibility specialist.
- **Indirect beneficiaries:** people using screen readers, keyboard-only users, low-vision users who zoom or need contrast, and people with motor or memory impairments who rely on autofill.

## Winning thesis

1. **It fixes, it doesn't just report.** Most failures (contrast, alt text, labels, names, language, landmarks) follow patterns that can be repaired automatically.
2. **It proves every fix.** The fixed code is rendered and audited again. A fix counts only if the issue is gone, and no fix may introduce a new kind of issue.
3. **It is honest about uncertainty.** Deterministic repairs are applied directly. Heuristic and AI repairs are applied but flagged for review. Anything that cannot be inferred is never filled with placeholder text and is routed to the user.
4. **It stays local and free.** There are no API keys. The vision model runs in the browser, and the code never leaves the machine.

## Differentiation (what we prove, not claim)

| Claim | Evidence ([EVALUATION.md](EVALUATION.md)) |
|---|---|
| Removes the automatically detectable barriers | 21 pages (13 live public-service sites): 1604 → 15, excluding 683 opt-in target-size suggestions |
| Every fix is checked | 781/781 applied fixes verified by re-audit |
| Does not break pages | 0 new rule types; 100% of text kept; 100% of element positions and sizes unchanged on every page whose images loaded |
| Matches expert hand remediation on automated checks | W3C BAD pages: ours 10 non-optional WCAG A/AA left (all routed to the user) vs W3C experts' 8 (all target-size) |
| Professional diffs, even for external CSS | Hacker News: 241 contrast failures → 6 rule overrides plus a patch for `news.css`, 0 inline styles |
| Works on real-world pages, not only pasted snippets | JavaScript-rendered URL fetch and a bookmarklet for logged-in pages |
| Its own UI is accessible | Automated test: 0 axe violations in every view |

## Out of scope (deliberately)

Crawling whole sites, rewriting framework source (JSX/templates), and runtime overlays. External CSS files get a patch and an override, not an in-place edit. These are documented as limitations. The single paste → fix → verify → export workflow is the product.
