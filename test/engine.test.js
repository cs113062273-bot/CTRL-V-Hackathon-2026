import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repairColor, contrast, parseColor } from '../public/engine/color.js';
import { looksDecorative, altFromFilename, humanizeIdentifier } from '../public/engine/names.js';
import { startEngine } from '../lib/headless.js';

test('contrast repair reaches the WCAG target with the smallest same-hue change', () => {
  for (const [fg, bg, target] of [['#8fa3b0', '#ffffff', 4.5], ['#4da3ff', '#ffffff', 4.5], ['#777777', '#222222', 4.5], ['#e0a800', '#fafafa', 3]]) {
    const r = repairColor(parseColor(fg), parseColor(bg), target);
    assert.ok(contrast(r.color, parseColor(bg)) >= target, `${fg} on ${bg}`);
    const tooFar = repairColor(parseColor(fg), parseColor(bg), target + 3);
    assert.ok(contrast(r.color, parseColor(bg)) < contrast(tooFar.color, parseColor(bg)), 'should not overshoot');
  }
});

test('image names: furniture is decorative, meaningful names survive, noise is rejected', () => {
  assert.equal(looksDecorative('./img/border_left_top.gif'), true);
  assert.equal(looksDecorative('marker2_w.gif'), true);
  assert.equal(looksDecorative('team-photo.jpg'), false);
  assert.equal(altFromFilename('/img/food-bank_volunteers@2x.jpg'), 'Food bank volunteers');
  assert.equal(altFromFilename('IMG_2041.jpg'), null);
  assert.equal(altFromFilename('teaser_right1.jpg'), null);
  assert.equal(humanizeIdentifier('txtFirstName'), 'First name');
  assert.equal(humanizeIdentifier('a8f3k2x9'), null);
});

test('human decisions are applied and the result is re-verified', { timeout: 60000 }, async () => {
  const engine = await startEngine();
  try {
    const html = await readFile(new URL('../public/samples/clinic-booking.html', import.meta.url), 'utf8');
    const base = `${engine.origin}/samples/`;
    const first = await engine.fix(html, { baseUrl: base });
    const photo = first.fixes.find(f => f.rule === 'image-alt' && f.status === 'needs-input');
    const contrastFix = first.fixes.find(f => f.rule === 'color-contrast' && f.status === 'applied');
    assert.ok(photo && contrastFix);
    assert.ok(first.fixes.filter(f => f.status === 'applied').every(f => f.verified));

    const second = await engine.fix(html, { baseUrl: base, overrides: { [photo.id]: { value: 'Nurse taking a patient\'s blood pressure' }, [contrastFix.id]: { reject: true } } });
    assert.match(second.output, /<img src="img\/IMG_2041\.jpg" alt="Nurse taking a patient's blood pressure">/);
    assert.equal(second.fixes.find(f => f.id === photo.id).verified, true);
    assert.equal(second.fixes.find(f => f.id === contrastFix.id).status, 'rejected');
    assert.ok(second.after.violations.some(v => v.rule === 'color-contrast'), 'rejected contrast issue must still be reported');
    assert.ok(!second.after.violations.some(v => v.rule === 'image-alt'));
  } finally {
    await engine.close();
  }
});

test('PasteProof\'s own UI has no axe violations in any result view', { timeout: 60000 }, async () => {
  const { default: puppeteer } = await import('puppeteer-core');
  const { createServer } = await import('../server.js');
  const { findBrowser } = await import('../lib/browser.js');
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
    const violations = () => page.evaluate(async () => (await axe.run({ exclude: [['iframe']] }, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] })).violations.map(v => v.id));
    assert.deepEqual(await violations(), [], 'empty state');
    await page.select('#sample-select', 'transit-widget.html');
    await page.waitForFunction(() => !document.querySelector('#results').hidden && !document.querySelector('#run-btn').disabled);
    for (const tab of ['rt-fixes', 'rt-diff', 'rt-sr', 'rt-preview', 'rt-remaining']) {
      await page.click('#' + tab);
      assert.deepEqual(await violations(), [], tab);
    }
  } finally {
    await browser.close();
    server.close();
  }
});
