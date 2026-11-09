# Research — CTRL-V Hackathon 2026

Researched 2026-11-09. **V** = verified from the cited source, **I** = inference from evidence, **U** = unknown.

## Competition facts

| | Finding | Source |
|---|---|---|
| V | Theme: "making access easier". Use AI/technology to remove barriers to education, healthcare, information, opportunities, communities, and essential services. Examples include disability accessibility, government services, and developer tools. | [Overview](https://ctrl-v-hackathon-31831.devpost.com/), [Rules](https://ctrl-v-hackathon-31831.devpost.com/rules) |
| V | Requirements: a real-world access problem, technology at the core, built during the hackathon, and a working prototype. | Overview, Rules |
| V | Judging: **Impact 30%, Innovation 25%, Technical Implementation 25%** (quality of engineering, AI integration, functionality), **UX 10%** (including accessibility), **Presentation 10%**. Ties go to Impact, then Innovation. | Overview, Rules |
| V | Dates: hacking from 2026-11-06. Submission deadline is shown as Nov 10, 2026 5:00 pm EST on the overview banner and 11/10/2026 11:59 PM UTC in the rules. **Use the earlier one.** Judging from 11/11, winners on 11/17. | Overview, Rules |
| V | Submission: name, short and detailed description, demo video (≤5 min in the rules, under 3 recommended), screenshots, repo or link, and technologies used. | Overview, Rules |
| V | Judges: Anna Abramova and Ivan Zabila (organizers), Mayur Jain (Senior Software Engineer, Bridgestone Americas), Kyrylo Sotnykov (Senior Software Engineer, ScreenMeet). | Overview |
| V | About 150 participants. Teams of 1–4. The overview says "students only", while the rules say open to all backgrounds (conflicting). Prize: Adaption Platform credits plus certificates. | Overview, Rules |
| V | The project gallery was not published at research time, so competing submissions cannot be inspected. | [Gallery](https://ctrl-v-hackathon-31831.devpost.com/project-gallery) |
| U | Judges' past judging records, the organizers' earlier events, and Discord discussions. Nothing reliable was found publicly. One search hit mirrors an older "CTRL-V Hackathon" listing with the same two organizer names, but it could not be verified. | — |

## Implications

- **I:** Two of the four judges are senior software engineers, and "Technical Implementation" explicitly covers engineering quality and functionality. A product whose output can be *checked* (diffs, re-audits, tests) plays to that.
- **I:** The UX criterion names *accessibility*. An accessibility product whose own UI fails an audit would be self-defeating. PasteProof's UI passes axe-core in every state, in light and dark themes and at mobile width.
- **I:** The theme lists "accessibility-focused products" and "developer tools". A tool that removes barriers at the source scales: one developer fixes a page that thousands of people use.

## Problem evidence

| | Finding | Source |
|---|---|---|
| V | 94.8% of the top 1M home pages have detectable WCAG 2 failures, about 51 errors per page on average. Low-contrast text appears on 79.1% of pages and missing alt text is the next most common failure. Six issue types make up about 96% of errors. | [WebAIM Million 2025](https://webaim.org/projects/million/2025) (as summarised by [WeAreDevelopers](https://www.wearedevelopers.com/magazine/570-the-state-of-accessibility-on-the-web-in-2025-webaim-million-report-findings)) |
| V | The FTC ordered accessiBe (the accessWidget overlay) to pay $1M for misrepresenting that its AI tool could make sites WCAG-compliant. Proposed in Jan 2025, finalised in Apr 2025. | [TechCrunch](https://techcrunch.com/2025/01/03/ftc-orders-ai-accessibility-startup-accessibe-to-pay-1m-for-misleading-advertising), [JD Supra](https://jdsupra.com/legalnews/ftc-targets-accessibility-overlays-5593127) |
| V | W3C WAI publishes deliberately inaccessible demo pages with expert-remediated counterparts (BAD). They serve as an independent test corpus and baseline. | [W3C BAD](https://www.w3.org/WAI/demos/bad/) |

## Competitors and prior art

| Product / project | Does well | Gap that PasteProof targets |
|---|---|---|
| axe DevTools / axe-core, WAVE, Lighthouse (checkers) | Reliable detection and rule documentation | They report problems; developers must work out and write every fix by hand. No verification loop for proposed fixes. |
| accessiBe, UserWay and similar overlays | Zero effort to install | Runtime JS patches, not source fixes. The FTC acted against accessiBe's claims. Users of assistive tech and accessibility professionals widely oppose them. |
| Generic LLM assistants ("make this accessible") | Flexible rewrites | Unverified output. They can invent ARIA, change content, or break layout, and they need a paid API. |
| Hackathon projects (Devpost search: Claimly, PlainSpeak, DocSimplified, GovEase…) | Plain-language and benefits explainers | Help one user read one document. They do not remove the barrier from the service itself. |

Sources for the hackathon projects: [devpost.com/software/claimly-claims](https://devpost.com/software/claimly-claims), [plainspeak-u174s8](https://devpost.com/software/plainspeak-u174s8), [docsimplified](https://devpost.com/software/docsimplified), [govease](https://devpost.com/software/govease).
