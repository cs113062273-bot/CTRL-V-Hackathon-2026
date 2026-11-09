# Evaluation

All numbers below come from `npm run eval` (raw data in `eval/results.json`) and `npm test`, run on 2026-11-09 on Windows 11 with headless Chrome. The CLI, the evaluation, and the UI share one engine.

## Method

- **Corpus (21 pages)**
  - 4 bundled samples (clinic booking, benefits application, school portal, transit widget).
  - 4 **W3C WAI "Before and After Demonstration"** inaccessible pages: independent and deliberately broken.
  - **13 real public-service home pages**, snapshotted on first run with CSS and images loaded live: Hacker News, CalFresh, Chicago.gov, gov.tw (Chinese), IRS, NYC.gov, FoodPantries.org, 211.org, SFUSD, Craigslist, HealthCare.gov, Berkeley Library, Feeding America.
  - LAUSD returned HTTP 403 to automated requests and is excluded.
- **Metric**: axe-core 4.14 violations (WCAG 2.0–2.2 A/AA plus best practice) per element instance, plus PasteProof's own checks.
- **Verification**: a fix counts as *verified* only if the final audit no longer reports that rule on the element or anything inside it.
- **Safety metrics**
  - *New rule types*: rules failing after fixing that did not fail before.
  - *Text kept*: share of the original words still present.
  - *Layout kept*: share of visible original elements whose position and size moved by 2 px or less.
- **Baseline**: W3C's own expert-remediated "after" pages (axe-only, for fairness).

## Results

| Page | Before | After (excl. optional) | Optional target-size | Fixes (verified) | Review | Input | Layout kept |
|---|---:|---:|---:|---:|---:|---:|---:|
| sample/clinic-booking | 52 | 1 | 0 | 48 (48) | 19 | 1 | 100% |
| sample/benefits-application | 62 | 0 | 0 | 51 (51) | 21 | 0 | 100% |
| sample/school-portal | 35 | 1 | 0 | 25 (25) | 8 | 1 | 100% |
| sample/transit-widget | 13 | 0 | 2 | 10 (10) | 6 | 0 | 100% |
| w3c-bad/home | 75 | 3 | 2 | 52 (52) | 33 | 3 | 100% |
| w3c-bad/news | 56 | 1 | 2 | 50 (50) | 29 | 1 | 100% |
| w3c-bad/tickets | 52 | 1 | 2 | 45 (45) | 22 | 1 | 100% |
| w3c-bad/survey | 67 | 5 | 2 | 43 (43) | 28 | 5 | 100% |
| news.ycombinator.com | 280 | 1 | 31 | 246 (246) | 4 | 0 | 100% |
| getcalfresh.org | 5 | 1 | 0 | 4 (4) | 1 | 1 | 100% |
| chicago.gov | 4 | 0 | 0 | 4 (4) | 4 | 0 | 100% |
| gov.tw | 62 | 0 | 0 | 16 (16) | 1 | 0 | 29.8%* |
| irs.gov | 9 | 0 | 0 | 12 (12) | 7 | 0 | 100% |
| nyc.gov | 3 | 0 | 0 | 4 (4) | 1 | 0 | 100% |
| foodpantries.org | 124 | 0 | 0 | 121 (121) | 4 | 0 | 100% |
| 211.org | 6 | 0 | 0 | 8 (8) | 3 | 0 | 100% |
| sfusd.edu | 20 | 0 | 0 | 24 (24) | 8 | 0 | 100% |
| craigslist.org | 668 | 1 | 642 | 9 (9) | 2 | 0 | 100% |
| healthcare.gov | 4 | 0 | 0 | 4 (4) | 3 | 0 | 100% |
| lib.berkeley.edu | 1 | 0 | 0 | 1 (1) | 0 | 0 | 100% |
| feedingamerica.org | 6 | 0 | 0 | 4 (4) | 4 | 0 | 100% |
| **Total** | **1604** | **15** | **683** | **781 (781)** | **208 (27%)** | **13** | |

\* gov.tw's image server refused 39 hotlinked images inside the headless render. The alt text then rendered in their place, which moves elements in the measurement but not for a real visitor whose images load. **On every page where all images loaded, layout was 100% unchanged.**

- **Verified**: 781 of 781 applied fixes.
- **New rule types introduced**: 0 of 21 pages.
- **Text kept**: 100% on every page.
- **Remaining 15**: 13 are fields and images PasteProof could not name and deliberately asked the user about (*needs input*). 2 are a page-level heading and a link on CalFresh.
- **Optional**: 683 target-size (WCAG 2.5.8) suggestions are offered with an *Apply* button instead of being applied. Enlarging 642 links on Craigslist would reflow the whole page. Applying them works: transit widget 13 → 0 in the UI test.
- **Time**: median about 2 s per page for the whole loop, including re-audits.

### Against W3C's expert remediation (axe-only, 4 BAD pages)

| | Original | PasteProof automatic | W3C expert "after" |
|---|---:|---:|---:|
| All axe instances | 246 | 18 (8 of them optional target-size) | 79 |
| WCAG A/AA instances | 183 | 18 → **10** excluding the optional suggestions | 8 (all target-size) |

The expert pages still fail `region` best practices (65) and WCAG 2.2 target-size (8), because the demo predates WCAG 2.2. PasteProof's 10 non-optional leftovers are unlabeled selects and fields and undescribed images that it routes to the user. **Fair summary:** on automated checks, PasteProof matches expert hand remediation once the user answers its questions. It does not replace the manual testing that experts also do.

### Real-world barriers it removed (examples from the output)

- **Hacker News**: 241 low-contrast texts were fixed by **6 rule-level overrides** plus a patch for `news.css` (for example `td { color: #828282 → #6f6f6f }`), with 0 inline styles and the layout unchanged.
- **NYC.gov**: the language button's spoken name "Language" did not contain its visible text "English", so voice-control users could not activate it. It is now "English (Language)".
- **FoodPantries.org**: 117 WCAG failures → 0. The main landmark went on the real content area, not the hidden off-canvas menu that also matched "content".

## Tests (`npm test`): 4 of 4 passing

1. Contrast repair reaches the target without overshooting.
2. Image-name inference: page furniture is decorative, meaningful names are kept, noise is rejected.
3. Human-in-the-loop round trip: a user's alt text is applied and verified. Rejecting a stylesheet contrast fix keeps it unapplied for **every** element sharing that rule, and the issue is still reported.
4. PasteProof's own UI has 0 axe violations in the empty state and in all 5 result views. A separate manual run also covered dark mode and 390 px mobile width, with no horizontal overflow.

The bookmarklet flow was verified end to end in headless Chrome: page A → bookmarklet → a new PasteProof tab analysed it, 35 → 1.

## Defects found by running on real output, all fixed and re-verified

1. A new `<span>` around label text matched author CSS and *created* a contrast failure. PasteProof no longer adds wrapper elements.
2. `aria-hidden="yes"` → `"true"` would have hidden an error message that is currently exposed. Invalid values now preserve browser behaviour.
3. File-name alt text ("Border left top") for layout images. Decorative classifier added.
4. Sibling headings drifted to different levels. The outline is now computed from the original levels.
5. Vague-link context borrowed a heading from elsewhere on the page. Search now stops at landmarks.
6. Contrast fixes were scattered as inline `rgb()`. They now edit or override the CSS rule after CSSOM verification.
7. **target-size enlargement reflowed whole pages (HN: 3% of layout kept).** It is now opt-in.
8. Click handler on a container of links → nested interactive. Now skipped.
9. Craigslist: a page-wide wrapper with class `flexed-footer` became a "banner". Size guards were added and single wrappers are descended.
10. FoodPantries: `#content` labelled navigation, and main placed on a hidden menu. Visibility-ranked main detection fixed both.
11. Duplicate banners: both were demoted, leaving none. Duplicate fixes now re-check after nested ones.
12. Unnamed `role=region`, and an outer nav borrowing a nested nav's heading. Both fixed.
13. Name-mismatch fixer ignored `aria-hidden` visible text. Aligned with axe.
14. `<marquee>` replacement shifted layout by 3 px. It now keeps the same box (`inline-block`, `overflow: hidden`).
15. A field labelled "Swap" from a nearby icon. That fallback was removed.
