// Runs the PasteProof engine inside a real headless Chromium-family browser (same code as the web UI).
import puppeteer from 'puppeteer-core';
import { createServer } from '../server.js';
import { findBrowser } from './browser.js';

export { findBrowser };

export async function startEngine() {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-first-run', '--disable-extensions'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.PasteProof, { timeout: 15000 });
  return {
    origin,
    /** Run the full audit → fix → verify pipeline. Returns the same result object the UI renders. */
    async fix(html, { baseUrl = null, overrides = {} } = {}) {
      return page.evaluate((h, b, o) => window.PasteProof.run(h, { baseUrl: b, overrides: o, cssProxy: location.origin + '/' }), html, baseUrl, overrides);
    },
    async close() { await browser.close(); server.close(); },
  };
}
