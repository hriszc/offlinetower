'use strict';

// One Chrome: full-screen scenery with safe-area controls in both orientations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/playwright/fullbleed');
const CASES = [
  { id: 'se', width: 667, height: 375, insets: {} },
  { id: 'mini', width: 812, height: 375, insets: { left: 44, right: 44, bottom: 21 } },
  { id: 'iphone', width: 844, height: 390, insets: { left: 47, right: 47, bottom: 21 }, shots: true },
  { id: 'max', width: 932, height: 430, insets: { left: 59, right: 59, bottom: 21 } },
  { id: 'portrait-css', width: 390, height: 844, insets: { top: 47, bottom: 34 }, source: 'css', shots: true },
  { id: 'asymmetric-host', width: 844, height: 390, insets: { left: 59, right: 13, bottom: 21 } },
  { id: 'asymmetric-css', width: 844, height: 390, insets: { left: 13, right: 59, bottom: 21 }, source: 'css' },
];
const checks = [], errors = [], cases = [];
let current = 'boot', phase = 'boot';
function check(ok, name, detail) {
  checks.push({ case: current, phase, name, passed: !!ok, ...(!ok ? { detail } : {}) });
  assert(ok, `${current}/${phase}: ${name} ${ok ? '' : JSON.stringify(detail)}`);
}
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', hasTouch: true, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
      let time = 0, queue = [], seed = 1007;
      requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
      performance.now = () => time;
      Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      window.__advance = dt => {
        time += dt * 1000; const pending = queue; queue = [];
        pending.forEach(callback => callback(time));
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ case: current, phase, message: error.message }));
    page.on('console', message => { if (message.type() === 'error') errors.push({ case: current, phase, message: message.text() }); });
    const advance = async (n = 3) => page.evaluate(n => {
      for (let i = 0; i < n; i++) __advance(1 / 60);
      UI.syncAll();
    }, n);
    const inspect = async selectors => {
      await advance();
      const layout = await page.evaluate(selectors => {
        const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const safe = UI.safeArea;
        const inside = r => r.left >= safe.left - 1 && r.top >= safe.top - 1 && r.right <= innerWidth - safe.right + 1 && r.bottom <= innerHeight - safe.bottom + 1;
        const bg = document.querySelector('#viewportScene');
        const layer = [...bg.querySelectorAll('canvas,img')].filter(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0);
        return { backdrop: rect(bg), layers: layer.map(el => ({ tag: el.tagName, rect: rect(el) })), stage: rect(UI.el.stage), stageInside: inside(rect(UI.el.stage)), width: innerWidth, height: innerHeight,
          items: selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height && getComputedStyle(el).visibility !== 'hidden'; }).map(el => ({ id: el.id, rect: rect(el), inside: inside(rect(el)) }))) };
      }, selectors);
      const covers = r => Math.abs(r.left) < 1 && Math.abs(r.top) < 1 && Math.abs(r.right - layout.width) < 1 && Math.abs(r.bottom - layout.height) < 1;
      check(covers(layout.backdrop), 'scenery covers all physical viewport edges', layout);
      check(layout.layers.some(layer => covers(layer.rect)), 'visible scene layer fills the screen', layout.layers);
      check(layout.stageInside, 'interactive stage remains in physical safe area', layout.stage);
      for (const selector of selectors) check(layout.items.some(item => item.id === selector.slice(1)), `${selector} is visible`, layout.items);
      for (const item of layout.items) check(item.inside, `${item.id} remains in safe area`, item);
      const screenshot = await page.screenshot();
      const pixels = await page.evaluate(async uri => {
        const img = new Image(); img.src = uri; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const zones = [], safe = UI.safeArea, width = canvas.width, height = canvas.height;
        const collect = (name, points) => {
          const colors = new Set(); let flatBlue = 0;
          for (const [x, y] of points) { const k = (Math.floor(y) * width + Math.floor(x)) * 4; colors.add([...data.slice(k, k + 3)].join(',')); if (data[k] === 35 && data[k + 1] === 56 && data[k + 2] === 76) flatBlue++; }
          zones.push({ name, colors: colors.size, flatBlue, count: points.length });
        };
        if (safe.left) collect('left', Array.from({ length: 100 }, (_, i) => [safe.left / 2, 2 + i * (height - 5) / 100]));
        if (safe.right) collect('right', Array.from({ length: 100 }, (_, i) => [width - safe.right / 2, 2 + i * (height - 5) / 100]));
        if (safe.top) collect('top', Array.from({ length: 100 }, (_, i) => [2 + i * (width - 5) / 100, safe.top / 2]));
        if (safe.bottom) collect('bottom', Array.from({ length: 100 }, (_, i) => [2 + i * (width - 5) / 100, height - safe.bottom / 2]));
        return zones;
      }, 'data:image/png;base64,' + screenshot.toString('base64'));
      for (const zone of pixels) check(zone.colors > 8 && zone.flatBlue < zone.count * .05, `${zone.name} safe-area edge shows scene texture, not a blue bar`, zone);
      return screenshot;
    };
    await page.goto(process.env.GAME_URL || 'file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => window.Game && Game.state === 'menu' && Render.battleScene && Render.animalAtlasReadable === true && document.querySelector('#viewportScene img').complete);
    for (const config of CASES) {
      current = config.id; console.log('CASE ' + current);
      await page.setViewportSize({ width: config.width, height: config.height });
      await page.evaluate(config => {
        const safe = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(edge => [edge, config.insets[edge] || 0]));
        for (const edge of Object.keys(safe)) document.documentElement.style.removeProperty('--device-safe-' + edge);
        if (config.source === 'css') {
          delete window.__gameHostViewport;
          for (const edge of Object.keys(safe)) document.documentElement.style.setProperty('--device-safe-' + edge, safe[edge] + 'px');
          window.dispatchEvent(new Event('resize'));
        } else { window.__gameHostViewport = { safeArea: safe }; window.dispatchEvent(new Event('gamehostviewportchange')); }
        Game.save.muted = true; Sfx.setEnabled(false); Game.save.tutorialDone = true;
        Game.save.rank = 3500; Game.save.largeText = false; Game.save.reducedMotion = true;
        Game.save.loadout = UNIT_ORDER.slice(0, 6); UI.applyPreferences(); Game.returnToMenu();
      }, config);
      phase = 'home'; let png = await inspect(['#playBtn', '#helpBtn', '#settingsBtn']);
      const leaked = await page.evaluate(() => ['#hud', '#buildBar', '#battleBar'].filter(selector => {
        const el = document.querySelector(selector), r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      }));
      check(leaked.length === 0, 'home hides battle HUD, shop and skill controls', leaked);
      if (config.shots) fs.writeFileSync(path.join(OUT, current + '-home.png'), png);
      await page.evaluate(() => { Game.startRun(); });
      phase = 'partners'; await inspect(['#loadoutConfirm']);
      await page.evaluate(() => {
        Game.coopMode = false; Game.coopLocked = false; Game.grid = {}; Game.roundIndex = 2; Game.coins = 10000;
        Game.paused = false; Game.tutorialActive = false; Game.matchmaking = null;
        UI.closeOverlay(); Game.beginBuild();
        for (const unit of [{ type: 'barricade', col: 4, lane: 2 }, { type: 'spike', col: 6, lane: 6 },
          { type: 'turret', col: 2, lane: 4 }, { type: 'flame', col: 7, lane: 1 }]) {
          if (Game.place(unit.type, unit.col, unit.lane) !== true) throw new Error('Fixture placement failed: ' + unit.type);
        }
        Game.armedType = null; clearTimeout(UI._tt); UI.el.toast.classList.remove('show'); UI.el.toast.textContent = '';
      });
      phase = 'build'; png = await inspect(['#startBtn', '#pauseBtn']);
      if (config.shots) fs.writeFileSync(path.join(OUT, current + '-build.png'), png);
      const seam = await page.evaluate(() => {
        const edge = document.querySelector('#viewportScene canvas'), main = Render.canvas;
        const ectx = edge.getContext('2d'), mctx = main.getContext('2d');
        const scaleX = edge.width / parseFloat(getComputedStyle(edge).width), scaleY = edge.height / parseFloat(getComputedStyle(edge).height);
        const safe = UI.safeArea, offsetX = UI.portrait ? safe.top : safe.left, offsetY = UI.portrait ? safe.right : safe.top;
        const samples = [];
        for (let i = 1; i < 25; i++) {
          const x = Render.vw * i / 25, y = 2;
          const a = [...mctx.getImageData(Math.floor(x * Render.dpr), Math.floor(y * Render.dpr), 1, 1).data];
          const b = [...ectx.getImageData(Math.floor((offsetX + x) * scaleX), Math.floor((offsetY + y) * scaleY), 1, 1).data];
          samples.push({ x, delta: Math.max(...a.map((value, index) => Math.abs(value - b[index]))) });
        }
        return { samples, matched: samples.filter(sample => sample.delta <= 3).length };
      });
      check(seam.matched >= 20, 'main canvas top row matches the full-screen static scene crop', seam);
      await page.evaluate(() => { Game.startBattle(); }); await advance(160);
      check(await page.evaluate(() => Game.state === 'battle'), 'battle fixture actually enters combat');
      phase = 'battle'; png = await inspect(['#repairBtn', '#flareBtn', '#pauseBtn']);
      if (config.shots) fs.writeFileSync(path.join(OUT, current + '-battle.png'), png);
      await page.evaluate(() => Game.pause());
      phase = 'pause'; png = await inspect(['#resumeBtn', '#pauseSettingsBtn']);
      if (config.shots) fs.writeFileSync(path.join(OUT, current + '-pause.png'), png);
      cases.push({ id: current, phases: ['home', 'partners', 'build', 'battle', 'pause'] });
    }
    check(errors.length === 0, 'zero browser errors', errors);
    console.log(`PASS: ${checks.length} full-bleed checks; ${cases.length} viewport configurations; zero browser errors`);
  } finally {
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks, cases, errors }, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
