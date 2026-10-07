'use strict';
// Export the actual transparent animal thumbnails and one compact review sheet.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
const variant = process.argv[2] || 'before';
if (!['before', 'after'].includes(variant)) throw new Error('Usage: node tools/preview_animals.js before|after');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/playwright/animal-art', variant);
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      let time = 0, callbacks = [], seed = 20261007;
      requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
      performance.now = () => time;
      Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      window.__advance = dt => { time += dt * 1000; const pending = callbacks; callbacks = []; pending.forEach(callback => callback(time)); };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => window.Render && window.UNIT_ORDER && window.Game && Game.state === 'menu' && Render.animalAtlasReadable === true);
    const result = await page.evaluate(() => {
      // Exactly 128 output pixels; never enlarge a small DOM thumbnail.
      Render.dpr = 1; Render.scale = 1;
      const columns = 6, cellWidth = 176, cellHeight = 176;
      const sheet = document.createElement('canvas');
      sheet.width = columns * cellWidth;
      sheet.height = Math.ceil(UNIT_ORDER.length / columns) * cellHeight;
      const ctx = sheet.getContext('2d');
      ctx.fillStyle = '#fff5df'; ctx.fillRect(0, 0, sheet.width, sheet.height);
      const animals = UNIT_ORDER.map((id, index) => {
        const image = Render.unitThumb(id, 128, 1).img;
        const x = (index % columns) * cellWidth, y = Math.floor(index / columns) * cellHeight;
        ctx.drawImage(image, x + 24, y + 8, 128, 128);
        ctx.fillStyle = '#31495c'; ctx.font = '16px "Heiti SC", sans-serif';
        ctx.textAlign = 'center'; ctx.fillText(UNITS[id].name, x + cellWidth / 2, y + 154, cellWidth - 12);
        const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
        let solidPixels = 0, transparentPixels = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] > 150) solidPixels++;
          if (pixels[i] === 0) transparentPixels++;
        }
        return { id, name: UNITS[id].name, width: image.width, height: image.height,
          solidPixels, transparentPixels, png: image.toDataURL('image/png').split(',')[1] };
      });
      return { animals, contactSheet: sheet.toDataURL('image/jpeg', 0.9).split(',')[1], width: sheet.width, height: sheet.height };
    });
    for (const animal of result.animals) {
      fs.writeFileSync(path.join(OUT, animal.id + '.png'), Buffer.from(animal.png, 'base64'));
      delete animal.png;
    }
    fs.writeFileSync(path.join(OUT, 'contact-sheet.jpg'), Buffer.from(result.contactSheet, 'base64'));
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ variant, animals: result.animals, contactSheet: { width: result.width, height: result.height }, errors }, null, 2));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`${variant}: ${result.animals.length} transparent 128px PNGs, ${result.width}x${result.height} contact sheet`);
    console.log(OUT);
    await context.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
