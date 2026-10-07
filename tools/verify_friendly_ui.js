'use strict';

// One Chrome session: redesigned screens, readable phone layouts and choice interactions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/playwright/friendly-ui');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], checks = [], layouts = [];
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 720 } });
    await context.addInitScript(() => {
      let time = 0, queue = [], seed = 20261006;
      requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
      performance.now = () => time;
      Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      window.__advance = dt => { time += dt * 1000; const pending = queue; queue = []; pending.forEach(cb => cb(time)); };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const check = (ok, name) => { assert(ok, name); checks.push(name); };
    const advance = async (frames = 3) => page.evaluate(frames => {
      for (let i = 0; i < frames; i++) __advance(1 / 60);
      UI.syncAll();
    }, frames);
    const shot = async name => { await advance(); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
    const click = async selector => { await page.locator(selector).first().click(); await advance(); };
    const previewEntry = path.join(ROOT, 'output/h5/index.html');
    await page.goto(process.env.GAME_URL || 'file://' + (fs.existsSync(previewEntry) ? previewEntry : path.join(ROOT, 'index.html')));
    await page.waitForFunction(() => window.Game && Game.state === 'menu' && Render.battleScene && Render.animalAtlasReadable === true);
    await page.evaluate(() => { Game.save.muted = true; Sfx.setEnabled(false); });
    await page.locator('.menuScene').evaluate(img => img.decode());
    check(await page.evaluate(() => document.title === '僵尸在敲门' &&
      document.querySelector('.menuScene').naturalWidth >= 700 && !document.getElementById('menuHelp').open),
    'home has matching brand, cached illustration and collapsed help');
    await shot('01-home-desktop');
    await click('#helpBtn');
    check(await page.evaluate(() => document.getElementById('menuHelp').open &&
      document.querySelectorAll('#menuHelp li').length === 6 &&
      document.getElementById('helpBtn').getAttribute('aria-expanded') === 'true'), 'help retains all six rules');
    await page.evaluate(() => UI.showMenu());
    for (const [width, height] of [[844, 390], [568, 320], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => UI.fit());
      const layout = await page.evaluate(() => {
        const button = document.getElementById('playBtn'), rect = button.getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, inside: rect.x >= -1 && rect.y >= -1 &&
          rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        clickable: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button ||
          button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
      });
      layouts.push(layout);
      check(layout.inside && layout.clickable, `home ${width}x${height} start button fits and is reachable`);
      await shot('home-' + width + 'x' + height);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      UI.fit(); Game.save.rank = 1000; Game.save.tutorialDone = true;
      Game.startRun();
    });
    await shot('02-friends-desktop');
    check(await page.locator('.loRole').count() === 22 && await page.locator('.unitDetail').count() === 22,
      'all partners retain roles and detailed statistics');
    await click('#loadoutConfirm');
    await page.evaluate(() => {
      Game.coins = 10000;
      Game.place('barricade', 7, 1); Game.place('turret', 6, 1); Game.place('lamp', 8, 2);
      UI.syncAll();
    });
    await shot('03-build-desktop');
    await page.evaluate(() => Game.beginFormChoice(7, 1));
    await shot('05-upgrade-desktop');
    const before = await page.evaluate(() => Game.coins);
    await click('.formDetails summary');
    check(await page.evaluate(before => Game.formChoice && Game.coins === before, before),
      'reading upgrade details does not buy an upgrade');
    await click('.formCard');
    check(await page.evaluate(before => !Game.formChoice && Game.coins < before && Game.grid['7|1'].lv === 2, before),
      'choosing an upgrade pays once and applies it');
    await click('#startBtn');
    await advance(125);
    check(await page.evaluate(() => Game.state === 'battle'), 'build proceeds through matchmaking to battle');
    await advance(480);
    await shot('04-battle-desktop');
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => UI.fit());
    await shot('battle-phone');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      UI.fit(); let frames = 0;
      while (Game.state === 'battle' && frames++ < 36000) Game.update(1 / 60);
      UI.syncAll();
    });
    check(await page.evaluate(() => Game.state === 'result'), 'actual combat produces a result');
    await shot('06-result-desktop');
    await click('#nextBtn');
    await shot('05-reward-desktop');
    check(await page.locator('.relic').count() === 3, 'reward retains three selectable items');
    await click('.relic');
    check(await page.evaluate(() => Game.state === 'build' && Game.relics.length === 1),
      'selected reward persists into the next build phase');
    await page.evaluate(() => UI.showMatchEnd(8, 20, 980, 1000));
    await shot('06-watch-summary');
    check(errors.length === 0, 'no browser errors');
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks, layouts, errors }, null, 2));
    console.log(`PASS: ${checks.length} friendly UI checks; desktop/phone screens captured; 0 browser errors`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
