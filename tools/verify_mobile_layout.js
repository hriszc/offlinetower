'use strict';

// 一次启动覆盖矮屏、旋转、文字尺寸与开始按钮的真实点击。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/playwright/mobile-layout');
const sizes = [[480, 216], [640, 200], [568, 320], [667, 375], [844, 390],
  [360, 640], [390, 844], [1280, 720]];
const errors = [], results = [];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 216 }, hasTouch: true });
    // 布局检查无需实时满帧绘制；用确定性推进保留真实匹配/战斗状态。
    await page.addInitScript(() => {
      let clock = 0, queue = [];
      requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
      performance.now = () => clock;
      window.__advance = dt => {
        clock += dt * 1000; const pending = queue; queue = [];
        pending.forEach(callback => callback(clock));
      };
    });
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => window.Game && Game.state === 'menu' && Render.battleScene && Render.animalAtlas && Render.animalAtlasReadable === true);
    await page.evaluate(() => {
      Game.save.tutorialDone = true;
      Game.save.muted = true;
      Game.save.rank = 3500;
      Game.save.loadout = ['turret', 'flame', 'frost', 'barricade', 'spike', 'lamp'];
      Game.startRun();
      document.getElementById('loadoutConfirm').click();
    });
    await page.waitForFunction(() => Game.state === 'build' && UI.overlayMode === null);

    for (const lang of ['zh', 'en']) {
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        const result = await page.evaluate(({ lang }) => {
          I18N.lang = lang;
          document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
          I18N.applyStatic();
          Game.loadout.forEach(type => { UNITS[type].name = L('unit.' + type + '.name'); });
          UI.buildCards(Game.loadout);
          UI.fit();
          UI.syncAll();
          for (let frame = 0; frame < 4; frame++) __advance(1 / 60);
          const rect = el => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
          };
          const inside = (a, b) => a.x >= b.x - 1 && a.y >= b.y - 1 &&
            a.right <= b.right + 1 && a.bottom <= b.bottom + 1;
          const viewport = { x: 0, y: 0, right: innerWidth, bottom: innerHeight };
          const button = rect(UI.el.startBtn);
          const center = document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2);
          const cards = Array.from(UI.el.cards.children).map(card => {
            const r = rect(card);
            return inside(r, rect(UI.el.cards)) && inside(r, viewport) &&
              ['.cn', '.cc'].every(sel => inside(rect(card.querySelector(sel)), r));
          });
          const stageRect = UI.el.stage.getBoundingClientRect();
          const cardPoints = [...UI.el.cards.children].map(card => UI.stageOffset(card));
          const lastLane = CONFIG.LANES.length - 1;
          const lastLaneHits = CONFIG.P_COLS.map(x => {
            const point = UI.fieldPoint(x, CONFIG.LANES[lastLane]);
            const screen = UI.portrait ? { x: stageRect.right - point.y, y: stageRect.top + point.x }
              : { x: stageRect.x + point.x, y: stageRect.y + point.y };
            const target = document.elementFromPoint(screen.x, screen.y);
            return { x, point, screen, clear: target === UI.el.game, target: target && (target.id || target.className) };
          });
          return { lang, button, visible: inside(button, viewport), clickable: center === UI.el.startBtn,
            cards, size: UI.el.stage.getAttribute('data-shop-size'),
            bottomTray: getComputedStyle(UI.el.buildBar).display === 'grid' && UI.stageOffset(UI.el.buildBar).y > UI.fieldBottom(),
            horizontalCards: cardPoints.every((point, i) => Math.abs(point.y - cardPoints[0].y) < 1 && (!i || point.x > cardPoints[i - 1].x)),
            lastLaneHits };
        }, { lang });
        results.push({ width, height, ...result });
        if (!result.visible || !result.clickable || !result.cards.every(Boolean) || !result.bottomTray || !result.horizontalCards || !result.lastLaneHits.every(hit => hit.clear)) {
          await page.screenshot({ path: path.join(OUT, `failure-${lang}-${width}x${height}.png`) });
        }
        assert(result.visible && result.clickable, `${lang} ${width}x${height}: start button clipped or covered`);
        assert(result.cards.length === 6 && result.cards.every(Boolean), `${lang} ${width}x${height}: card/name/price clipped`);
        assert(result.bottomTray && result.horizontalCards, `${lang} ${width}x${height}: six-card shop must remain a bottom horizontal tray`);
        assert(result.lastLaneHits.every(hit => hit.clear), `${lang} ${width}x${height}: final lane is covered by tray or label`);
        if (lang === 'zh' && [216, 375, 844].includes(height)) {
          await page.evaluate(() => { __advance(1 / 60); __advance(1 / 60); });
          await page.screenshot({ path: path.join(OUT, `build-${width}x${height}.png`) });
        }
      }
    }

    // 首页的新局与续局入口均须能滚动到并命中；旋转后使用舞台尺寸。
    const buildState = await page.evaluate(() => {
      Game.checkpoint();
      return { state: Game.state, run: Game.save.run };
    });
    for (const lang of ['zh', 'en']) {
      for (const [width, height] of sizes) {
        await page.setViewportSize({ width, height });
        for (const resume of [false, true]) {
          await page.evaluate(({ lang, resume, run }) => {
            I18N.lang = lang;
            document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : 'en';
            Game.save.run = resume ? run : null;
            Game.state = 'menu'; UI.fit(); UI.syncAll(); UI.showMenu();
          }, { lang, resume, run: buildState.run });
          const menuIds = await page.evaluate(() =>
            ['playBtn', 'coopBtn', 'continueRunBtn'].filter(id => document.getElementById(id)));
          assert(menuIds.includes('playBtn') && (!resume || menuIds.includes('continueRunBtn')),
            `${lang} ${width}x${height}: menu lost new/resume entry`);
          for (const id of menuIds) {
            const button = page.locator('#' + id);
            await button.scrollIntoViewIfNeeded();
            const hit = await button.evaluate(el => {
              const r = el.getBoundingClientRect();
              const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 &&
                (target === el || el.contains(target));
            });
            assert(hit, `${lang} ${width}x${height} menu resume=${resume}: ${id} clipped or covered`);
          }
        }
      }
    }
    await page.evaluate(({ state, run }) => {
      Game.state = state; Game.save.run = run; UI.closeOverlay(); UI.syncAll();
    }, buildState);

    // 合作商店左右两侧与准备按钮文字，使用本地状态，不访问线上房间。
    for (const side of ['p', 'g']) {
      await page.setViewportSize({ width: 480, height: 216 });
      const cooperative = await page.evaluate(side => {
        Game.coopMode = true;
        Game.coopSide = side;
        Game.coopSeat = side === 'p' ? 0 : 3;
        UI.fit(); UI.syncAll();
        const r = UI.el.startBtn.getBoundingClientRect();
        return { side, visible: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          label: UI.el.startBtn.textContent, clickable: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === UI.el.startBtn };
      }, side);
      assert(cooperative.visible && cooperative.clickable, `coop ${side}: ready button clipped`);
      results.push({ cooperative });
    }
    await page.evaluate(() => { Game.coopMode = false; Game.coopSide = 'p'; UI.syncAll(); });
    await page.tap('#startBtn');
    await page.evaluate(() => { for (let frame = 0; frame < 125; frame++) __advance(1 / 60); });
    await page.waitForFunction(() => Game.state === 'battle');
    await page.screenshot({ path: path.join(OUT, 'battle-480x216.png') });
    assert.strictEqual(errors.length, 0, errors.join('\n'));
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, errors, battle: true }, null, 2));
    console.log(`PASS: ${sizes.length * 2} bottom-tray shop layouts and final-lane hit checks, ${sizes.length * 4} new/resume bilingual menus, 2 cooperative sides, touch start -> battle; 0 browser errors`);
  } finally {
    await browser.close();
  }
}
main().catch(e => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'partial.json'), JSON.stringify({ results, errors, failure: e.message }, null, 2));
  console.error(e); process.exitCode = 1;
});
