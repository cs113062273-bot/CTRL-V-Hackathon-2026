# PasteProof — Demo 影片腳本（2:55）

旁白與字幕用同一句英文（字幕檔：`demo-subtitles.srt`，可直接匯入剪輯軟體或 YouTube）。
「畫面」欄是你要錄的操作；「字幕 / 旁白」是要講、要上的字。

---

## 錄影前準備（5 分鐘，務必做）

1. 終端機：`npm start`，Chrome 開 `http://127.0.0.1:5173`，縮放 110%，關掉書籤列以外的雜物。
2. **先暖機 AI**：勾「On-device AI alt text」→ 選範例 *Community clinic* 跑一次（第一次會下載模型約 3 分鐘），跑完後重新整理頁面、再勾一次 AI。之後每次只要 1–2 秒。
3. 書籤列：把頁面上「Send to PasteProof」按鈕拖到書籤列（From URL 分頁裡）。
4. 另開一個分頁：`http://127.0.0.1:5173/samples/benefits-application.html`（當作「需要登入的福利申請網站」）。
5. VS Code 打開 `public/samples/clinic-booking.html`，先 Ctrl+A、Ctrl+C 複製好。
6. 再開一個終端機，先打好 `node cli.js public/samples/school-portal.html --fail-on serious` 但不要按 Enter。
7. 錄影解析度 1920×1080，滑鼠移動放慢。

---

## 分鏡

| 時間 | 畫面（你要做的事） | 字幕 / 旁白 |
|---|---|---|
| 0:00–0:07 | 打開 `samples/clinic-booking.html` 原始頁面（診所預約表單）。 | 94.8% of the top million websites fail accessibility. This clinic page is one of them. |
| 0:07–0:15 | PasteProof → Preview 不用切，直接講；畫面停在診所頁面，滑鼠指著照片與表單。 | To a blind patient, this photo is "IMG_2041.jpg" and every form field is just "edit text". They can't book a doctor. |
| 0:15–0:22 | 切到 PasteProof 首頁（乾淨畫面）。 | Checkers list problems. Overlays hide them. Nobody fixes the code. So we built PasteProof. |
| 0:22–0:32 | 在頁面空白處直接按 **Ctrl+V**。結果出現：**52 → 0**。 | Ctrl+V. That's the whole workflow. 52 accessibility failures — gone in under two seconds. |
| 0:32–0:40 | 滑鼠指三個數字卡：Issues、Fixes applied、Your attention。 | 49 fixes to the actual source code — and every single one re-audited and verified. |
| 0:40–0:52 | Fixes 分頁：第一張 AI 卡片，指 alt text「Two people in a hospital room with a patient」與 **AI** 標籤。 | The photo gets alt text from Florence-2, a vision model running inside your browser. No upload. No API key. Free. |
| 0:52–1:02 | 往下捲：Form labels 卡片（First name *）、Clickable element（div onclick → 鍵盤可用）。 | It connects the labels already on screen, makes mouse-only buttons work with a keyboard, and marks required fields. |
| 1:02–1:12 | 在 AI 卡片 alt text 改成「Nurse checking a patient's blood pressure」→ 下方浮出「Re-run with my changes」→ 按下。 | You stay in control: edit any guess, reject any fix, re-run — and it's verified again. |
| 1:12–1:27 | Screen reader 分頁：左邊紅字 12 個，右邊 0 個；慢慢往下捲。 | This is what a screen reader says. Before: 12 controls and images with no name. After: zero. Every field, every link, every image speaks. |
| 1:27–1:37 | Preview 分頁：左右兩個版本並排。 | And the page looks exactly the same. We measure it: every element keeps its position and size. |
| 1:37–1:44 | Code diff 分頁，捲過綠色新增的屬性、CSS 規則修改。 | You get a clean diff of real HTML and CSS — not a runtime script. |
| 1:44–2:02 | From URL 分頁 → 輸入 `https://news.ycombinator.com` → Fetch page。結果 **280 → 1**。切 Code diff，指上方 CSS patch。 | Real websites too. Hacker News: 280 failures. PasteProof follows the colors into the external stylesheet and fixes 241 low-contrast texts with just six CSS rules — plus a patch for news.css. |
| 2:02–2:16 | 切到 benefits-application 分頁 → 點書籤列「Send to PasteProof」→ PasteProof 新分頁自動開始分析，結果出現。 | Pages behind a login — benefit portals, school accounts — one click on the bookmarklet sends the live page to PasteProof. Nothing leaves your machine. |
| 2:16–2:26 | 終端機按 Enter，跑 CLI，顯示結果與 exit code。 | For developers, the same engine runs in CI: it blocks any deploy that ships new barriers. |
| 2:26–2:44 | 打開 `EVALUATION.md` 表格（或做一張數字卡）：1,604 → 15、781/781、0、100%。 | We tested it on 21 pages, including IRS, NYC.gov, HealthCare.gov and 211. 1,604 issues down to 15. 781 of 781 fixes verified. Zero new problems. 100% of text and layout preserved. |
| 2:44–2:50 | 同一畫面指 W3C 那列：18 vs 79。 | On W3C's own broken demo site, we leave fewer issues than W3C's expert hand-fixed version: 18 versus 79. |
| 2:50–2:55 | 回到 PasteProof 首頁，畫面打上網址。 | PasteProof. Ctrl+V — and the web opens up for everyone. |

---

## 片尾字卡（最後 2 秒疊在畫面上）

```
PasteProof
Live demo: cs113062273-bot.github.io/pasteproof
Code: github.com/cs113062273-bot/pasteproof
```

## 剪輯提醒

- 0:22 的 Ctrl+V 那一刻放大「52 → 0」數字卡（zoom-in 0.5 秒），這是全片最強畫面。
- 1:12 螢幕閱讀器左右對照，左邊紅字停留久一點。
- 1:44 Hacker News 第一次抓取要 2–5 秒，剪掉等待。
- 背景音樂音量壓低，字幕放畫面下方、白字黑底。
