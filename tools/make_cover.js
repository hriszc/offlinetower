'use strict';

/* 从 tools/cover.html 导出 4:3 游戏封面 PNG。
 * 用法：node tools/make_cover.js
 * 母版 2048×1536 由游戏自身的绘制代码生成，缩放全部在页面内完成，保证确定性。
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const PAGE = 'file://' + path.join(ROOT, 'tools', 'cover.html');
const OUT = path.join(ROOT, 'output', 'cover');
const WIDTHS = [2048, 1200];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => { console.error('pageerror:', e.message); process.exitCode = 1; });
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });

  await page.goto(PAGE);
  await page.waitForFunction(() => window.COVER_READY === true, null, { timeout: 60000 });

  const metrics = await page.evaluate(() => window.COVER_METRICS);
  console.log(JSON.stringify(metrics, null, 2));
  if (metrics.warnings.length) console.error('WARN:', metrics.warnings.join(' / '));

  const shots = await page.evaluate((widths) => {
    const master = document.getElementById('cover');
    const out = {};
    for (const w of widths) {
      const h = Math.round(w * master.height / master.width);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(master, 0, 0, w, h);
      out[w] = c.toDataURL('image/png');
    }
    return out;
  }, WIDTHS);

  fs.mkdirSync(OUT, { recursive: true });
  for (const w of WIDTHS) {
    const h = Math.round(w * 1536 / 2048);
    const file = path.join(OUT, `cover-4x3-${w}x${h}.png`);
    fs.writeFileSync(file, Buffer.from(shots[w].split(',')[1], 'base64'));
    console.log('wrote', path.relative(ROOT, file));
  }

  await browser.close();
})();
