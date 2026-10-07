'use strict';

// One Chrome, fixed RAF: safe areas, house-side controls and real touch placement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/playwright/ios-mobile');
const CASES = [
  { id: 'se', width: 667, height: 375, insets: {}, lang: 'zh' },
  { id: 'mini', width: 812, height: 375, insets: { left: 44, right: 44, bottom: 21 }, lang: 'zh', large: true },
  { id: 'iphone', width: 844, height: 390, insets: { left: 47, right: 47, bottom: 21 }, lang: 'zh', shots: true },
  { id: 'max-en-large', width: 932, height: 430, insets: { left: 59, right: 59, bottom: 21 }, lang: 'en', large: true },
  { id: 'portrait-css-large', width: 390, height: 844, insets: { top: 47, bottom: 34 }, lang: 'zh', large: true, source: 'css' },
  { id: 'asymmetric-host', width: 844, height: 390, insets: { left: 59, right: 13, bottom: 21 }, lang: 'en', large: true },
  { id: 'asymmetric-css', width: 844, height: 390, insets: { left: 13, right: 59, bottom: 21 }, lang: 'zh', source: 'css' },
];
const filteredIds = (process.env.IOS_MOBILE_CASES || '').split(',').filter(Boolean);
const gestureIds = (process.env.IOS_MOBILE_GESTURES || '').split(',').filter(Boolean);
const cameraOnly = process.env.IOS_MOBILE_CAMERA_ONLY === '1';
const focusOnly = cameraOnly || process.env.IOS_MOBILE_FOCUS_ONLY === '1';
const RUN_CASES = focusOnly ? [] : filteredIds.length ? CASES.filter(config => filteredIds.includes(config.id)) : CASES;
assert(RUN_CASES.length || focusOnly, 'IOS_MOBILE_CASES must select a known configuration');
const previous = (filteredIds.length || focusOnly) && fs.existsSync(path.join(OUT, 'results.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'results.json'), 'utf8')) : { checks: [], results: [], errors: [] };
const rerunGesture = id => /^gesture-/.test(id || '') && (!gestureIds.length || gestureIds.includes(id));
const retained = item => item.case !== 'boot' && item.case !== 'iphone-final-screens' && !rerunGesture(item.case) &&
  !RUN_CASES.some(config => config.id === (item.case || item.id));
const checks = previous.checks.filter(retained), results = previous.results.filter(retained), errors = previous.errors.filter(retained);
const gestures = (previous.gestures || []).filter(item => !rerunGesture(item.id));
let current = 'boot';
function check(ok, name, detail) {
  const rec = { case: current, name, passed: !!ok };
  if (!ok) rec.detail = detail;
  checks.push(rec);
  assert(ok, `${current}: ${name}${ok ? '' : ' ' + JSON.stringify(detail)}`);
}
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', hasTouch: true, deviceScaleFactor: 2 });
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
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push({ case: current, message: error.message }));
    page.on('console', message => {
      if (message.type() === 'error') errors.push({ case: current, message: message.text() });
    });
    const advance = async (n = 3) => page.evaluate(n => {
      for (let i = 0; i < n; i++) __advance(1 / 60);
      UI.syncAll();
    }, n);
    const snap = async name => { await advance(); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
    const tap = async selector => {
      const b = await page.locator(selector).first().boundingBox();
      check(!!b, `touch control exists: ${selector}`);
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await advance();
    };
    const configure = async config => {
      await page.setViewportSize({ width: config.width, height: config.height });
      return page.evaluate(config => {
        const safe = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(edge => [edge, config.insets[edge] || 0]));
        for (const edge of Object.keys(safe)) document.documentElement.style.removeProperty('--device-safe-' + edge);
        if (config.source === 'css') {
          delete window.__gameHostViewport;
          for (const edge of Object.keys(safe)) document.documentElement.style.setProperty('--device-safe-' + edge, safe[edge] + 'px');
          window.dispatchEvent(new Event('resize'));
        } else {
          window.__gameHostViewport = { safeArea: safe };
          window.dispatchEvent(new Event('gamehostviewportchange'));
        }
        return { actual: UI.safeArea, expected: safe, portrait: UI.portrait };
      }, config);
    };
    const controls = async selectors => {
      const value = await page.evaluate(selectors => {
        const safe = UI.safeArea;
        const safeRect = { x: safe.left, y: safe.top, right: innerWidth - safe.right, bottom: innerHeight - safe.bottom };
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const inside = r => r.x >= safeRect.x - 1 && r.y >= safeRect.y - 1 && r.right <= safeRect.right + 1 && r.bottom <= safeRect.bottom + 1;
        const items = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        }).map(el => {
          const r = rect(el), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { selector, id: el.id, rect: r, inside: inside(r), touch: r.width >= 43.5 && r.height >= 43.5,
            reachable: hit === el || el.contains(hit), target: hit && (hit.id || hit.className) };
        }));
        return { safeRect, stage: rect(UI.el.stage), stageInside: inside(rect(UI.el.stage)), items };
      }, selectors);
      check(value.stageInside, 'rotated stage fits physical safe area', value);
      for (const item of value.items) {
        check(item.inside, `${item.selector} fits safe area`, item);
        check(item.touch, `${item.selector} has a 44px touch target`, item);
        check(item.reachable, `${item.selector} is reachable`, item);
      }
      return value;
    };
    const point = async (side, col, lane) => page.evaluate(({ side, col, lane }) => {
      const r = UI.el.stage.getBoundingClientRect();
      const local = UI.fieldPoint((side === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS)[col], CONFIG.LANES[lane]);
      return UI.portrait ? { x: r.right - local.y, y: r.top + local.x }
        : { x: r.left + local.x, y: r.top + local.y };
    }, { side, col, lane });
    const shopControls = async () => {
      const result = await controls(['#startBtn', '#pauseBtn']);
      const cards = page.locator('#cards .card');
      check(await cards.count() === 6, 'six house-side shop cards are available');
      for (let index = 0; index < await cards.count(); index++) {
        await cards.nth(index).evaluate(el => {
          document.querySelectorAll('[data-mobile-test-card]').forEach(previous => previous.removeAttribute('data-mobile-test-card'));
          el.setAttribute('data-mobile-test-card', 'active'); el.scrollIntoView({ block: 'nearest' });
        });
        const card = await controls(['[data-mobile-test-card="active"]']);
        result.items.push(...card.items);
        const text = await cards.nth(index).evaluate(el => {
          const card = el.getBoundingClientRect();
          return ['.cn', '.cc'].map(selector => {
            const item = el.querySelector(selector), r = item.getBoundingClientRect();
            return { selector, value: item.textContent, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, card: { x: card.x, y: card.y, width: card.width, height: card.height },
              contained: r.left >= card.left - 1 && r.top >= card.top - 1 && r.right <= card.right + 1 && r.bottom <= card.bottom + 1,
              unclipped: item.scrollWidth <= item.clientWidth + 1 && item.scrollHeight <= item.clientHeight + 1 };
          });
        });
        for (const item of text) check(item.contained && item.unclipped, `card ${index}: name/price stay readable`, item);
      }
      await page.locator('.shopTray').evaluate(el => { el.scrollTop = 0; });
      return result;
    };
    const inspectField = async () => page.evaluate(() => {
      const r = UI.el.stage.getBoundingClientRect(), hits = [];
      const mode = Game.coopMode, ownSide = Game.coopSide;
      for (const side of ['p', 'g']) {
        Game.coopMode = side === 'g'; Game.coopSide = side;
        const cols = side === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS;
        for (let col = 0; col < cols.length; col++) for (const lane of col === 0 || col === cols.length - 1 ? [0, 8] : [8]) {
          const local = UI.fieldPoint(cols[col], CONFIG.LANES[lane]);
          const screen = UI.portrait ? { x: r.right - local.y, y: r.top + local.x }
            : { x: r.left + local.x, y: r.top + local.y };
          const back = UI.toVirtual(screen.x, screen.y), cell = UI.cellAt(back.x, back.y);
          const target = document.elementFromPoint(screen.x, screen.y);
          hits.push({ side, col, lane, screen, inverse: Math.abs(back.x - cols[col]) < .01 && Math.abs(back.y - CONFIG.LANES[lane]) < .01,
            sameCell: !!cell && cell.col === col && cell.lane === lane, clear: target === UI.el.game,
            target: target && (target.id || target.className) });
        }
      }
      Game.coopMode = mode; Game.coopSide = ownSide;
      return hits;
    });
    const prepare = async side => {
      await page.evaluate(side => {
        Game.coopMode = side === 'g'; Game.coopSide = side; Game.coopSeat = side === 'g' ? 5 : 2;
        Game.coopLocked = false; Game.coopRoom = null; Game.coopHomes = null;
        Game.grid = {}; Game.roundIndex = 2; Game.coins = 10000; Game.paused = false;
        Game.tutorialActive = false; Game.matchmaking = null; UI.flareArmed = false; UI.closeOverlay(); Game.beginBuild();
      }, side); await advance();
    };
    const touchPath = async points => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
      for (const p of points.slice(1)) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] });
        await advance(1); await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(80); await advance();
    };
    const dragFinalLane = async () => {
      const card = await page.locator('#cards .card[data-type="turret"]').boundingBox();
      const start = { x: card.x + card.width / 2, y: card.y + card.height / 2 }, end = await point('p', 0, 8);
      const portrait = await page.evaluate(() => UI.portrait);
      // First move across the rail: a vertical first movement intentionally scrolls.
      const across = portrait ? { x: start.x, y: start.y + 80 } : { x: start.x + 80, y: start.y };
      const points = [start, across];
      for (let step = 1; step <= 6; step++) points.push({ x: across.x + (end.x - across.x) * step / 6, y: across.y + (end.y - across.y) * step / 6 });
      await touchPath(points);
      check(await page.evaluate(() => !!Game.grid['0|8'] && Game.grid['0|8'].type === 'turret'), 'horizontal exit then real touch drag places final-lane unit');
    };
    const scroll = async selector => {
      const status = await page.locator(selector).evaluate(el => {
        el.scrollTop = 0; const overflow = el.scrollHeight - el.clientHeight;
        el.scrollTop = el.scrollHeight;
        return { overflow, moved: el.scrollTop, mode: getComputedStyle(el).overflowY };
      });
      check(status.overflow <= 1 || (status.moved > 0 && /auto|scroll/.test(status.mode)), `${selector} can scroll when content overflows`, status);
    };
    await page.goto(process.env.GAME_URL || 'file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => window.Game && Game.state === 'menu' && Render.battleScene && Render.animalAtlasReadable === true);
    check(await page.evaluate(() => Render.animalAtlas.src.startsWith('data:')), 'formal atlas is readable from embedded dataURL');
    const cdp = await context.newCDPSession(page);
    for (const config of RUN_CASES) {
      current = config.id;
      console.log(`CASE ${current}: safe area, touch placement, drag and skills`);
      const applied = await configure(config);
      check(JSON.stringify(applied.actual) === JSON.stringify(applied.expected), `${config.source || 'host'} safe-area probe/event applied`, applied);
      await page.evaluate(config => {
        Game.save.muted = true; Sfx.setEnabled(false); Game.save.tutorialDone = true; Game.save.rank = 3500;
        Game.save.largeText = !!config.large; Game.save.reducedMotion = true;
        I18N.lang = config.lang; document.documentElement.lang = config.lang === 'zh' ? 'zh-Hans' : 'en';
        I18N.applyStatic(); UNIT_ORDER.forEach(id => { UNITS[id].name = L('unit.' + id + '.name'); });
        UI.applyPreferences(); UI.showMenu();
      }, config); await advance();
      const home = await controls([]);
      await scroll('.overlayBox.menu');
      const menuIds = await page.evaluate(() => ['playBtn'].concat(window.Coop ? ['coopBtn'] : [], ['helpBtn', 'settingsBtn']));
      for (const id of menuIds) {
        const menuState = await page.evaluate(() => ({ phase: Game.state, overlay: UI.overlayMode,
          ids: [...document.querySelectorAll('.overlayBox.menu button')].map(el => el.id), coop: !!window.Coop }));
        check(menuState.ids.includes(id), `menu contains ${id}`, menuState);
        await page.locator('#' + id).evaluate(el => el.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
        await advance(1);
        home.items.push(...(await controls(['#' + id])).items);
      }
      await page.locator('.overlayBox.menu').evaluate(el => { el.scrollTop = 0; });
      if (config.shots) await snap('01-iphone-home');
      await page.evaluate(() => {
        Game.save.loadout = ['turret', 'flame', 'frost', 'barricade', 'spike', 'lamp']; Game.startRun();
      }); await advance();
      await controls(['#loadoutConfirm']); await scroll('.loadout .overlayBody');
      const textStatus = await page.evaluate(() => {
        const family = getComputedStyle(document.body).fontFamily;
        const buttons = [...document.querySelectorAll('.loadoutCard, #loadoutConfirm')];
        return { inherits: buttons.every(el => getComputedStyle(el).fontFamily === family),
          hasGlyph: document.querySelector('.loadout').textContent.includes('◍'),
          coins: document.querySelectorAll('.loCost .coinIcon').length, total: UNIT_ORDER.length,
          footerHeight: document.querySelector('.loadout .overlayFoot').offsetHeight };
      });
      check(textStatus.inherits, 'Chinese/English form controls inherit body font', textStatus);
      check(!textStatus.hasGlyph && textStatus.coins === textStatus.total,
        'all costs use coin shapes without missing-font glyphs', textStatus);
      check(textStatus.footerHeight <= 84, 'compact team footer leaves room for animal list', textStatus);
      await page.locator('.loadout .overlayBody').evaluate(el => { el.scrollTop = 0; });
      if (config.shots) await snap('02-iphone-partners');
      await tap('#loadoutConfirm'); await prepare('p');
      const build = await shopControls();
      const field = await inspectField();
      for (const hit of field) check(hit.inverse && hit.sameCell && hit.clear,
        `${hit.side} col ${hit.col} lane ${hit.lane}: XY roundtrip and canvas accessible`, hit);
      if (config.shots) await snap('03-iphone-build');
      // Real taps place a one-cell unit in all nine positions of the final lane.
      await tap('#cards .card[data-type="turret"]');
      for (let col = 0; col < 9; col++) {
        const p = await point('p', col, 8); await page.touchscreen.tap(p.x, p.y); await advance();
        check(await page.evaluate(col => !!Game.grid[col + '|8'] && Game.grid[col + '|8'].type === 'turret', col), `tap places last-lane col ${col}`);
      }
      // The opposite side uses the actual cooperative confirm path.
      await page.evaluate(() => {
        Game.tutorialActive = true; Game.tutorialTarget = { col: 8, lane: 8 };
      });
      for (let step = 1; step <= 7; step++) {
        const bubble = await page.evaluate(step => {
          Game.tutorialStep = step; UI.syncTutorial();
          const label = document.querySelector('.tutLbl'), stage = UI.el.stage.getBoundingClientRect();
          const r = label.getBoundingClientRect();
          return { inside: r.left >= stage.left - 1 && r.top >= stage.top - 1 && r.right <= stage.right + 1 && r.bottom <= stage.bottom + 1,
            text: label.textContent, width: r.width, height: r.height };
        }, step);
        check(bubble.inside, `tutorial step ${step} bubble stays inside safe stage`, bubble);
      }
      await page.evaluate(() => { Game.tutorialActive = false; UI.syncTutorial(); });
      await prepare('g'); await tap('#cards .card[data-type="turret"]');
      for (const col of [0, 8]) {
        const p = await point('g', col, 8); await page.touchscreen.tap(p.x, p.y); await advance();
        check(await page.evaluate(col => !!Game.pendingPlacement && Game.pendingPlacement.col === col && Game.pendingPlacement.lane === 8, col), `right-side tap previews col ${col}`);
        await controls(['#placementConfirm button']); await tap('#placementConfirm [data-action="confirm"]');
        check(await page.evaluate(col => !!Game.grid[col + '|8'], col), `right-side confirm places col ${col}`);
      }
      await prepare('p');
      await dragFinalLane();
      // Relayout and host changes retain cell identity, including asymmetric insets.
      const resized = { ...config, width: config.height, height: config.width,
        insets: { top: 47, bottom: 34 }, source: 'host' };
      await configure(resized); await advance();
      await page.evaluate(() => { Game.armedType = null; Game.selectedCell = null; UI.syncAll(); });
      const same = await point('p', 0, 8); await page.touchscreen.tap(same.x, same.y); await advance();
      check(await page.evaluate(() => Game.selectedCell && Game.selectedCell.col === 0 && Game.selectedCell.lane === 8), 'orientation/host inset update selects the same stored cell');
      await configure(config); await advance();
      await page.evaluate(() => { Game.selectedCell = null; UI.showSettings('menu'); }); await advance();
      await scroll('.settingsScroll'); await controls(['#settingsBackBtn']);
      const settingRows = page.locator('.settingRow');
      for (let row = 0; row < await settingRows.count(); row++) {
        await settingRows.nth(row).evaluate(el => {
          document.querySelectorAll('[data-mobile-test-row]').forEach(previous => previous.removeAttribute('data-mobile-test-row'));
          el.setAttribute('data-mobile-test-row', 'active'); el.scrollIntoView({ block: 'center' });
        });
        await controls(['[data-mobile-test-row="active"]']);
      }
      if (config.shots) await snap('05-iphone-settings');
      await tap('#settingsBackBtn'); await prepare('p');
      await tap('#startBtn'); await advance(125);
      check(await page.evaluate(() => Game.state === 'battle'), 'real start button enters battle after deterministic matching');
      await page.evaluate(() => { Game.battle.hp.p = Game.battle.maxHp.p - 20; UI.syncAll(); });
      const battle = await controls(['#flareBtn', '#repairBtn', '#pauseBtn']);
      const repairBefore = await page.evaluate(() => Game.repair);
      await tap('#repairBtn');
      check(await page.evaluate(n => Game.repair === n - 1, repairBefore), 'repair skill has a working real touch target');
      await tap('#flareBtn');
      check(await page.evaluate(() => UI.flareArmed), 'flare skill touch arms field targeting');
      if (config.shots) await snap('04-iphone-battle');
      results.push({ ...config, applied, safeRect: home.safeRect, stage: home.stage,
        buildControls: build.items, battleControls: battle.items, field });
      console.log(`PASS ${current}: ${checks.length} accumulated checks`);
    }
    for (const config of [
      { id: 'gesture-mini-en-large', width: 812, height: 375, insets: { left: 44, right: 44, bottom: 21 }, lang: 'en', large: true },
      { id: 'gesture-portrait-en-large', width: 375, height: 812, insets: { top: 47, bottom: 34 }, lang: 'en', large: true, source: 'css' },
    ].filter(config => !cameraOnly && (!gestureIds.length || gestureIds.includes(config.id)))) {
      current = config.id; console.log(`CASE ${current}: native rail pan and horizontal drag`);
      await configure(config);
      await page.evaluate(config => {
        I18N.lang = config.lang; document.documentElement.lang = 'en'; I18N.applyStatic();
        UNIT_ORDER.forEach(id => { UNITS[id].name = L('unit.' + id + '.name'); });
        Game.save.largeText = true; UI.applyPreferences();
      }, config);
      await prepare('p');
      const before = await page.evaluate(() => {
        const rail = document.querySelector('.shopTray'); rail.scrollTop = 0;
        Game.armedType = 'barricade'; UI.syncAll();
        return { overflow: rail.scrollHeight - rail.clientHeight, armed: Game.armedType, units: Object.keys(Game.grid).length, portrait: UI.portrait };
      });
      check(before.overflow > 0, 'large English rail genuinely overflows', before);
      const box = await page.locator('#cards .card').nth(2).boundingBox();
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, points = [start];
      for (let step = 1; step <= 8; step++) points.push(before.portrait
        ? { x: start.x + 80 * step / 8, y: start.y }
        : { x: start.x, y: start.y - 80 * step / 8 });
      await touchPath(points);
      const after = await page.evaluate(() => ({ scroll: document.querySelector('.shopTray').scrollTop,
        dragging: UI.dragging, armed: Game.armedType, units: Object.keys(Game.grid).length,
        ghost: !!UI.dragEl && getComputedStyle(UI.dragEl).display !== 'none' }));
      check(after.scroll > 1, 'real finger pan scrolls the rail', { before, after });
      check(!after.dragging && !after.ghost && after.units === before.units && after.armed === before.armed,
        'native pointercancel leaves no ghost or placement and restores armed choice', { before, after });
      await page.locator('.shopTray').evaluate(el => { el.scrollTop = 0; });
      await dragFinalLane();
      await prepare('g'); await tap('#cards .card[data-type="turret"]');
      const last = await point('g', 8, 8); await page.touchscreen.tap(last.x, last.y); await advance();
      check(await page.evaluate(() => !!Game.pendingPlacement && Game.pendingPlacement.col === 8 && Game.pendingPlacement.lane === 8), 'tap after native pan still previews the opposite-side final cell');
      await tap('#placementConfirm [data-action="confirm"]');
      check(await page.evaluate(() => !!Game.grid['8|8']), 'confirmation after native pan places the opposite-side unit');
      let settings = null;
      if (before.portrait) {
        await page.evaluate(() => UI.showSettings('menu')); await advance();
        const settingsBefore = await page.locator('.settingsScroll').evaluate(el => {
          el.scrollTop = 0; return { overflow: el.scrollHeight - el.clientHeight, touchAction: getComputedStyle(el).touchAction };
        });
        check(settingsBefore.overflow > 0, 'portrait settings genuinely overflow', settingsBefore);
        const rect = await page.locator('.settingsScroll').boundingBox();
        const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, points = [start];
        for (let step = 1; step <= 8; step++) points.push({ x: start.x + 80 * step / 8, y: start.y });
        await touchPath(points);
        settings = await page.locator('.settingsScroll').evaluate(el => ({ scroll: el.scrollTop, overflow: el.scrollHeight - el.clientHeight }));
        check(settings.scroll > 1, 'real finger pan scrolls portrait settings', { before: settingsBefore, after: settings });
      }
      gestures.push({ ...config, before, after, settings }); console.log(`PASS ${current}`);
    }
    // Refresh only the two screenshots affected by the final normal card height.
    current = 'iphone-final-screens'; await configure(CASES.find(config => config.id === 'iphone'));
    await page.evaluate(() => {
      I18N.lang = 'zh'; document.documentElement.lang = 'zh-Hans'; I18N.applyStatic();
      UNIT_ORDER.forEach(id => { UNITS[id].name = L('unit.' + id + '.name'); });
      Game.save.largeText = false; Game.save.muted = true; Game.save.tutorialDone = true; Game.save.rank = 3500;
      Game.save.loadout = UNIT_ORDER.slice(0, 6); UI.applyPreferences(); Game.startRun();
    });
    await prepare('p');
    if (!cameraOnly) {
      await shopControls();
      for (const hit of await inspectField()) check(hit.inverse && hit.sameCell && hit.clear, 'final representative field stays accessible', hit);
    }
    const cameraUnits = await page.evaluate(() => {
      const units = [
        { type: 'barricade', col: 4, lane: 2 }, { type: 'spike', col: 6, lane: 6 },
        { type: 'turret', col: 2, lane: 4 }, { type: 'flame', col: 7, lane: 1 },
      ];
      for (const unit of units) {
        if (!Game.loadout.includes(unit.type)) throw new Error('Camera fixture is outside loadout: ' + unit.type);
        unit.placed = Game.place(unit.type, unit.col, unit.lane);
        if (unit.placed !== true) throw new Error('Camera fixture failed placement: ' + JSON.stringify(unit) + ' ' + UI.el.toast.textContent);
      }
      Game.armedType = null; UI.syncAll();
      clearTimeout(UI._tt); UI.el.toast.classList.remove('show'); UI.el.toast.textContent = '';
      return units;
    });
    console.log('Camera placements: ' + JSON.stringify(cameraUnits));
    await snap('03-iphone-build'); await tap('#startBtn'); await advance(160);
    if (!cameraOnly) await controls(['#flareBtn', '#repairBtn', '#pauseBtn']);
    await snap('04-iphone-battle');
    check(errors.length === 0, 'no browser errors', errors);
    console.log(cameraOnly ? 'PASS: camera-only build/battle refreshed; regression report preserved' :
      `PASS: ${checks.length} iOS mobile checks; ${results.length} safe-area/language/text configurations; ${gestures.length} native pan configurations; 5 iPhone screens; 0 browser errors`);
  } finally {
    if (!cameraOnly) fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks, results, gestures, errors }, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
