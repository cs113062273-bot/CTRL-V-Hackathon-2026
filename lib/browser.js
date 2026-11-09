// Locates a locally installed Chromium-family browser (Chrome, Edge, Chromium). No download needed.
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.PASTEPROOF_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean);

export function findBrowser({ optional = false } = {}) {
  const found = CANDIDATES.find(p => existsSync(p));
  if (!found && !optional) throw new Error('No Chrome, Edge or Chromium found. Set PASTEPROOF_BROWSER to the browser executable.');
  return found || null;
}
