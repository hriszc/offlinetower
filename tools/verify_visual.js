'use strict';

/* 一次性视觉验证：同一趟浏览器里检查
 *  1) 有没有 pageerror
 *  2) 备战期（拒马精灵烘焙）画面正常
 *  3) 战斗期：探照灯照亮 vs 空转、建筑作战指示灯
 * 产出 3 张截图到 output/playwright/
 * 用法：node tools/verify_visual.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'output', 'playwright');

const BUILDS = [
  // 第 1 小局开放裂隙侧的 3×3；两种长建筑各占一整列的三路。
  ['turret', 8, 0], ['barricade', 7, 0], ['spike', 6, 0],
  ['lamp', 8, 1], ['flame', 8, 2],
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  // 固定 dt，画面可复现；不接管则用真实时间
  await context.addInitScript(() => {
    let seed = 20260924;
    Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL);
  await page.waitForFunction(() => window.Game && Game.state === 'menu' && document.querySelector('#playBtn'));
  await page.evaluate(() => {
    Game.save.rank = 1000;
    Game.save.tutorialDone = true;
    Game.save.loadout = ['barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla', 'frost', 'quake'];
    Game.save.muted = true;
    Game.persist();
  });
  await page.evaluate(() => document.querySelector('#playBtn').click());
  await page.waitForSelector('#loadoutConfirm', { state: 'visible' });
  await page.evaluate(() => document.querySelector('#loadoutConfirm').click());
  await page.waitForFunction(() => Game.state === 'build');
  await page.evaluate(() => {
    const assert = (ok, message) => { if (!ok) throw new Error('grid/range check failed: ' + message); };
    assert(unlockedCols(0).join(',') === '8,7,6' && unlockedLanes(0).join(',') === '0,1,2', 'round 1 opens 3×3 at the Rift');
    assert(unlockedCols(1).length === 6 && unlockedLanes(1).length === 6, 'round 2 opens 6×6');
    assert(unlockedCols(2).length === 9 && unlockedLanes(2).length === 9, 'round 3 opens 9×9');
    assert(CONFIG.P_COLS.every((x, i) => x + CONFIG.G_COLS[i] === CONFIG.W), 'player and mirror columns match');
    assert(unitAnchorLane('barricade', 0, 9) === 1 && unitAnchorLane('barricade', 8, 9) === 7,
      'long buildings snap at both outer edges');

    Game.coins = 100000;
    const edgeWall = Game.canPlace(7, 0, 'barricade');
    assert(edgeWall.ok && edgeWall.lane === 1 && edgeWall.rows.join(',') === '0,1,2', 'top edge snaps a 3-row wall into the open grid');
    assert(Game.canPlace(7, 2, 'spike').lane === 1, 'bottom edge snaps to the same valid center');
    Game.place('barricade', 7, 0);
    const wall = Game.unitAt(7, 1);
    assert(wall && Game.unitAt(7, 0) === wall && Game.unitAt(7, 2) === wall, 'all wall cells resolve to one unit');
    assert(!Game.canPlace(7, 0, 'spike').ok, 'overlapping footprints are blocked');
    Game.sellAt(7, 2);
    assert(!Game.unitAt(7, 1), 'selling from an occupied edge removes the whole wall');

    const battle = new Battle({ roundIndex: 2, playerBuild: [], ghostBuild: [] });
    battle.addUnit('p', { type: 'turret', col: 8, lane: 4 });
    const tower = battle.units[0];
    const crossLane = { id: -1, side: 'p', lane: 5, x: tower.x - 70, y: CONFIG.LANES[5], dead: false };
    battle.zombies = [crossLane]; battle.rebuildBuckets();
    assert(battle.nearestZombieInRadius(tower) === crossLane, 'turret locks a nearby zombie in the next lane');
    battle.zombies = [{ id: -2, side: 'p', lane: 5, x: tower.x - 280, y: CONFIG.LANES[5], dead: false }];
    battle.rebuildBuckets();
    assert(battle.nearestZombieInRadius(tower) === null, 'turret ignores a target outside the circle');

    const areaBattle = new Battle({ roundIndex: 2, playerBuild: [], ghostBuild: [] });
    areaBattle.addUnit('p', { type: 'lamp', col: 8, lane: 4 });
    const lamp = areaBattle.units[0];
    const areaTarget = { id: -3, side: 'p', lane: 5, x: lamp.x, y: CONFIG.LANES[5], hp: 100, dead: false,
      slowAmt: 0, slowT: 0, strobeLock: 1, burnT: 0 };
    areaBattle.zombies = [areaTarget]; areaBattle.rebuildBuckets(); lamp.cd = 0;
    areaBattle.updateUnits(1 / 60);
    assert(areaTarget.hp < 100, 'circular area effect reaches the neighboring lane');

    const sprayBattle = new Battle({ roundIndex: 2, playerBuild: [], ghostBuild: [] });
    sprayBattle.addUnit('p', { type: 'flame', col: 8, lane: 4 });
    const flame = sprayBattle.units[0];
    const forward = { id: -4, side: 'p', lane: 4, x: flame.x + 30, y: CONFIG.LANES[4], r: 10, hp: 100, dead: false, burnDps: 0 };
    const rear = { id: -5, side: 'p', lane: 4, x: flame.x - 30, y: CONFIG.LANES[4], r: 10, hp: 100, dead: false, burnDps: 0 };
    sprayBattle.zombies = [forward, rear]; sprayBattle.rebuildBuckets(); flame.cd = 0;
    sprayBattle.updateUnits(1 / 60);
    assert(forward.hp < 100 && rear.hp === 100, 'flame keeps its one-way spray');

    const wallBattle = new Battle({ roundIndex: 2, playerBuild: [{ type: 'barricade', col: 8, lane: 4 }], ghostBuild: [] });
    const sharedWall = wallBattle.units[0];
    assert([3, 4, 5].every((lane) => wallBattle.uBuckets.p[lane].includes(sharedWall)), 'wall collision buckets span all three lanes');
    const bite = (lane) => ({ type: 'walker', side: 'p', lane, x: sharedWall.x + 15,
      y: CONFIG.LANES[lane], r: 10, dmg: 7, attackKind: 'unit', attackTarget: sharedWall,
      attackT: 0, attackTotal: 0, attackHitT: 0, attackHitTotal: 0 });
    const sharedHp = sharedWall.hp;
    wallBattle.resolveZombieAttack(bite(3));
    wallBattle.resolveZombieAttack(bite(5));
    assert(sharedWall.hp === sharedHp - 14, 'hits from either edge reduce the same wall health');
  });
  await page.evaluate((cells) => {
    Game.coins = 100000;
    for (const c of cells) Game.place(c[0], c[1], c[2]);
    Game.coins = 86;
    Game.tutorialActive = false;
    UI.syncAll();
    Render.t = 12.4;
    Render.draw({ battle: Game.battle, buildPhase: true, roundIndex: Game.roundIndex,
      hoverCell: { col: 8, lane: 0, side: 'p', valid: true }, armedType: 'lamp', coins: 86,
      selectedCell: { col: 7, lane: 1 }, playerMods: Game.playerMods(),
      tutorialActive: false, tutorialStep: 0, tutorialTarget: null }, 1 / 60);
  }, BUILDS);
  await page.screenshot({ path: path.join(OUT, 'v1-build-phase.png') });

  // 进入战斗
  await page.evaluate(() => document.querySelector('#startBtn').click());
  await page.waitForFunction(() => Game.state === 'battle' && Game.battle, null, { timeout: 20000 });

  // 场景 A：探照灯照到丧尸（engaged），旁边放几只在空转范围外的对照
  await page.evaluate((WANT) => {
    const b = Game.battle;
    b.t = 52;
    b.spawnTimer = 0; b.pulseTimer = 0; b.pulseQueue = 0;
    for (let i = 0; i < 80; i++) b.spawnOne();
    const lamp = b.units.find((u) => u.type === 'lamp' && u.lane === 1);
    let n = 0;
    for (const z of b.zombies) {
      if (z.side !== 'p') continue;
      n++;
      if (n % 2 === 0) continue;                     // 一半留在原地（远处）
      if (lamp) {
        z.lane = n % 4 === 1 ? 1 : 2;
        z.x = lamp.x - 40;
        z.y = CONFIG.LANES[z.lane];
      }
    }
    // 推进若干帧：丧尸走进光锥，灯与塔的作战状态就会点亮
    for (let i = 0; i < 90; i++) { b.update(1 / 60); b.hp.p = Math.max(1, b.hp.p); b.dead.p = null; }
    Render.t = 30.2;
    Render.draw({ battle: b, buildPhase: false, roundIndex: Game.roundIndex, hoverCell: null,
      armedType: null, coins: 86, tutorialActive: false, tutorialStep: 0, tutorialTarget: null }, 1 / 60);
    // 读回状态，确认信号真的在
    window.__probe = {
      lamps: b.units.filter((u) => u.type === 'lamp').map((u) => ({ lane: u.lane, engaged: u.engaged, actT: +u.actT.toFixed(2) })),
      engagedAttackers: b.units.filter((u) => u.engaged && u.type !== 'lamp').map((u) => u.type),
      actTAttackers: b.units.filter((u) => u.actT > 0).map((u) => u.type + ':' + u.actT.toFixed(2)),
      zombies: b.zombies.length,
    };
  }, BUILDS);
  await page.screenshot({ path: path.join(OUT, 'v2-battle-lamp-lit.png') });
  // 场景 A2：强制开火帧（actT 拉满），对比指示灯闪白与光锥最亮
  await page.evaluate(() => {
    const b = Game.battle;
    for (const u of b.units) { u.engaged = 1; u.actT = 0.24; }
    Render.t = 30.2;
    Render.draw({ battle: b, buildPhase: false, roundIndex: Game.roundIndex, hoverCell: null,
      armedType: null, coins: 86, tutorialActive: false, tutorialStep: 0, tutorialTarget: null }, 1 / 60);
  });
  await page.screenshot({ path: path.join(OUT, 'v2b-battle-lamp-firing.png') });

  // 场景 B：清空全部丧尸 -> 所有指示灯应熄灭、光锥应压暗
  await page.evaluate(() => {
    const b = Game.battle;
    b.zombies.length = 0; b.dirtyZ = true;
    for (const k in b.zBuckets) for (let i = 0; i < b.zBuckets[k].length; i++) b.zBuckets[k][i].length = 0;
    for (const u of b.units) { u.engaged = 0; u.actT = 0; u.engT = 0; }
    for (let i = 0; i < 6; i++) Game.battle.update(1 / 60);   // 让 unitEngaged 重新评估
    Render.t = 30.2;
    Render.draw({ battle: b, buildPhase: false, roundIndex: Game.roundIndex, hoverCell: null,
      armedType: null, coins: 86, tutorialActive: false, tutorialStep: 0, tutorialTarget: null }, 1 / 60);
    window.__probe2 = {
      lamps: b.units.filter((u) => u.type === 'lamp').map((u) => ({ lane: u.lane, engaged: u.engaged })),
      anyEngaged: b.units.filter((u) => u.engaged).length,
      anyFiring: b.units.filter((u) => u.actT > 0).length,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'v3-battle-idle.png') });

  const probe = await page.evaluate(() => ({ lit: window.__probe, idle: window.__probe2, q: Render.quality, dpr: Render.dpr }));
  console.log('errors: ' + (errors.length ? JSON.stringify(errors, null, 2) : 'none'));
  console.log('quality ' + probe.q + ' @dpr ' + probe.dpr);
  console.log('lamp lit  : ' + JSON.stringify(probe.lit));
  console.log('all idle  : ' + JSON.stringify(probe.idle));
  for (const f of ['v1-build-phase.png', 'v2-battle-lamp-lit.png', 'v2b-battle-lamp-firing.png', 'v3-battle-idle.png']) {
    const p = path.join(OUT, f);
    console.log(f + '  ' + (fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) + ' KB' : 'MISSING'));
  }
  for (const viewport of [{ width: 390, height: 844, portrait: true }, { width: 844, height: 390, portrait: false }]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const layout = await page.evaluate(() => {
      UI.fit();
      Render.draw({ battle: Game.battle, buildPhase: true, roundIndex: Game.roundIndex,
        hoverCell: { col: 8, lane: 0, side: 'p', valid: true }, armedType: 'flame',
        selectedCell: { col: 7, lane: 1 }, playerMods: Game.playerMods(), coins: 100000,
        tutorialActive: false, tutorialStep: 0, tutorialTarget: null }, 1 / 60);
      return { portrait: UI.portrait, vw: Render.vw, vh: Render.vh, scale: Render.scale };
    });
    if (layout.portrait !== viewport.portrait || !(layout.scale > 0) || layout.vw <= 0 || layout.vh <= 0) {
      throw new Error('responsive layout check failed: ' + JSON.stringify(layout));
    }
  }
  await browser.close();
  if (errors.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
