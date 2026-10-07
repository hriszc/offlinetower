'use strict';
// Validate pixels as well as DOM bounds: images must contain complete silhouettes.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'output/playwright/unit-thumbs');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, locale: 'zh-CN' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => Game.state === 'menu' && Render.battleScene && Render.animalAtlasReadable === true);
    const bounds = await page.evaluate(() => {
      const checks = [];
      for (const density of [1, 2, 3]) for (const size of [32, 38, 46]) for (const level of [1, 2, 3]) for (const id of UNIT_ORDER) {
        Render.dpr = density; Render.scale = 1;
        const c = Render.unitThumb(id, size, level).img, a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let left = c.width, top = c.height, right = -1, bottom = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          // Ignore the faint outer halo; solid artwork must never meet an edge.
          if (a[(y * c.width + x) * 4 + 3] < 20) continue;
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
        checks.push({ id, density, size, level, left, top, right, bottom, px: c.width });
      }
      Render.dpr = devicePixelRatio; UI.fit();
      Game.save.rank = 3500; Game.save.tutorialDone = true; Game.startRun();
      return checks;
    });
    bounds.forEach(b => assert(b.left > 0 && b.top > 0 && b.right < b.px - 1 && b.bottom < b.px - 1,
      `clipped ${b.id} level ${b.level} at ${b.size}px @${b.density}: ${JSON.stringify(b)}`));
    await page.screenshot({ path: path.join(OUT, 'landscape.png') });
    await page.setViewportSize({ width: 422, height: 1280 });
    await page.evaluate(() => UI.fit());
    assert(await page.evaluate(() => UI.portrait && UI.el.stage.style.transform === 'rotate(90deg)'), 'portrait rotation must stay unchanged');
    assert(await page.locator('#loadoutConfirm').isVisible(), 'confirmation remains visible');
    await page.screenshot({ path: path.join(OUT, 'rotated-preview.png') });
    assert.deepStrictEqual(errors, []);
    fs.writeFileSync(path.join(OUT, 'bounds.json'), JSON.stringify(bounds, null, 2));
    console.log(`PASS: ${bounds.length} thumbnail pixel bounds; 22 animals, 3 levels, 3 sizes, 3 densities; rotation preserved; no JS errors`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
