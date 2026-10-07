'use strict';

/* 渲染性能剖析：统计一帧内各绘制段的耗时，用来定位手机发烫的元凶。
 * 用法：node tools/profile_perf.js [--dpr 2] [--w 960] [--h 540] [--frames 180]
 * 输出：每段 ms/帧（同一段相对比较有效，绝对值随机器变化）
 */

const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const W = arg('w', 960);
const H = arg('h', 540);
const DPR = arg('dpr', 2);
const FRAMES = arg('frames', 180);
const ZCOUNT = arg('zcount', -1);
const QUALITY = process.argv.indexOf('--quality') >= 0 ? process.argv[process.argv.indexOf('--quality') + 1] : 'high';

const BUILDS = [
  ['barricade', 3, 0], ['turret', 2, 0], ['lamp', 2, 1], ['flame', 3, 1],
  ['tesla', 3, 2], ['frost', 2, 2], ['totem', 3, 3], ['spike', 2, 3],
  ['quake', 3, 4], ['sniper', 2, 4],
];

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: DPR,
  });
  await context.addInitScript((q) => { window.__forceQuality = q; }, QUALITY);
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => window.Game && Game.state === 'menu' && document.querySelector('#playBtn'));
  await page.evaluate(() => {
    Game.save.rank = 1000;
    Game.save.tutorialDone = true;
    Game.save.loadout = ['barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla', 'frost', 'totem', 'quake', 'sniper'];
    Game.save.muted = true;
    Game.persist();
  });
  await page.evaluate(() => document.querySelector('#playBtn').click());
  await page.waitForSelector('#loadoutConfirm', { state: 'visible' });
  await page.evaluate(() => document.querySelector('#loadoutConfirm').click());
  await page.waitForFunction(() => Game.state === 'build');
  await page.evaluate((cells) => {
    Game.coins = 1000;
    for (const c of cells) Game.place(c[0], c[1], c[2]);
    Game.coins = 86;
    Game.tutorialActive = false;
    UI.syncAll();
  }, BUILDS);
  await page.evaluate(() => document.querySelector('#startBtn').click());
  await page.evaluate(() => { for (let i = 0; i < 120; i++) Game.update(1 / 60); });
  await page.waitForFunction(() => Game.state === 'battle' && Game.battle);

  // 造高压场景：怪多、粒子多，胜负冻结
  await page.evaluate((ZCOUNT_ARG) => {
    const b = Game.battle;
    b.t = 60;
    b.wave.interval0 = 0.10; b.wave.interval1 = 0.07;
    b.wave.pulseEvery = 0.5; b.wave.pulseSize = 10;
    b.spawnTimer = 0; b.pulseTimer = 0;
    const want = ZCOUNT_ARG < 0 ? 44 : ZCOUNT_ARG;
    for (let i = 0; i < want; i++) b.spawnOne();
    for (const z of b.zombies) if (z.side === 'p') z.x = 260 + Math.abs(Math.round(z.x * 3 + z.y * 5)) % 320;
    const orig = Game.update.bind(Game);
    Game.update = function (dt) {
      orig(dt);
      b.hp.p = Math.max(1, b.hp.p); b.dead.p = null; b.over = false;
    };
  }, ZCOUNT);

  const out = await page.evaluate(async (frames) => {
    const names = ['drawSkyGlow', 'drawRift', 'drawLockedLanes', 'drawHome', 'drawFog',
      'drawGridOverlay', 'drawUnits', 'drawZombies', 'drawShots', 'drawDust',
      'updateParts', 'drawParts', 'drawFogFront', 'drawWatcher', 'drawSideDanger',
      'drawMidVignette', 'drawGlitch', 'draw'];
    // canvas 指令计数：比计时更稳，能反映真实绘制负载
    const ctx = Render.ctx;
    let ops = 0;
    const hot = ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'drawImage',
      'createLinearGradient', 'createRadialGradient', 'save', 'restore', 'clip'];
    const raw = {};
    for (const m of hot) {
      raw[m] = ctx[m].bind(ctx);
      ctx[m] = function () { ops++; return raw[m].apply(ctx, arguments); };
    }
    const acc = {}, accOps = {};
    const orig = {};
    for (const n of names) {
      acc[n] = 0; accOps[n] = 0; orig[n] = Render[n];
      Render[n] = function () {
        const t0 = performance.now();
        const o0 = ops;
        const r = orig[n].apply(this, arguments);
        acc[n] += performance.now() - t0;
        accOps[n] += ops - o0;
        return r;
      };
    }
    // 按类型细分
    const byType = {};
    const origUnit = Render.drawUnit;
    Render.drawUnit = function (u) {
      const o0 = ops; const r = origUnit.apply(this, arguments);
      const k = 'unit:' + u.type; byType[k] = (byType[k] || 0) + (ops - o0);
      const c = 'unitc:' + u.type; byType[c] = (byType[c] || 0) + 1;
      return r;
    };
    const origZomb = Render.drawZombie;
    Render.drawZombie = function (z) {
      const o0 = ops; const r = origZomb.apply(this, arguments);
      const k = 'z:' + z.type; byType[k] = (byType[k] || 0) + (ops - o0);
      const c = 'zc:' + z.type; byType[c] = (byType[c] || 0) + 1;
      return r;
    };
    const scene = () => ({
      battle: Game.battle, buildPhase: Game.state === 'build', roundIndex: Game.roundIndex,
      hoverCell: Game.hoverCell, armedType: Game.armedType, coins: Game.coins,
      tutorialActive: false, tutorialStep: 0, tutorialTarget: null,
    });
    const step = 1 / 60;
    // 预热
    for (let i = 0; i < 20; i++) { Game.update(step); Render.draw(scene(), step); }
    for (const n of names) { acc[n] = 0; accOps[n] = 0; }
    ops = 0;
    let simMs = 0;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      const s0 = performance.now();
      Game.update(step);
      simMs += performance.now() - s0;
      Render.draw(scene(), step);
    }
    const wall = performance.now() - t0;
    const res = { wall: wall / frames, sim: simMs / frames, ops: ops / frames,
      dpr: Render.dpr, quality: Render.quality, frames, zombies: Game.battle.zombies.length, units: Game.battle.units.length, parts: Render.parts.length };
    for (const n of names) res[n] = acc[n] / frames;
    for (const n of names) res['op_' + n] = accOps[n] / frames;
    for (const n of names) Render[n] = orig[n];
    Render.drawUnit = origUnit; Render.drawZombie = origZomb;
    const types = {};
    for (const k in byType) types[k] = byType[k] / frames;
    res.types = types;
    return res;
  }, FRAMES);

  const rows = Object.keys(out).filter((k) => typeof out[k] === 'number' && k !== 'wall' && k !== 'sim' && k !== 'ops')
    .sort((a, b) => out[b] - out[a]);
  console.log('quality ' + QUALITY + '  viewport ' + W + 'x' + H + ' dpr ' + DPR);
  console.log('zombies ' + out.zombies + '  units ' + out.units + '  parts ' + out.parts);
  console.log('frame total: ' + out.wall.toFixed(2) + ' ms  (' + (1000 / out.wall).toFixed(0) + ' fps cap)');
  console.log('sim (Game.update): ' + out.sim.toFixed(2) + ' ms');
  console.log('实际 dpr ' + out.dpr + ' / 档位 ' + out.quality);
  console.log('--- 分段 (ms/帧) ---');
  for (const k of rows) console.log('  ' + k.padEnd(18) + out[k].toFixed(3));
  const opRows = Object.keys(out).filter((k) => k.indexOf('op_') === 0)
    .map((n) => [n.slice(3), out[n]]).sort((a, b) => b[1] - a[1]);
  console.log('canvas ops/frame: ' + out.ops.toFixed(0));
  for (const r of opRows) if (r[1] > 0.5) console.log('  ' + r[0].padEnd(18) + r[1].toFixed(1));
  console.log('--- 单位/僵尸 op 细分 (每帧) ---');
  const tk = Object.keys(out.types || {}).sort((a, b) => out.types[b] - out.types[a]);
  for (const k of tk) {
    if (k.indexOf('unitc:') === 0) continue;
    const cnt = k.indexOf('unit:') === 0 ? out.types['unitc:' + k.slice(5)] : out.types['zc:' + k.slice(2)];
    console.log('  ' + k.padEnd(20) + out.types[k].toFixed(1) + '  (n=' + (cnt || 0).toFixed(1) +
      ', ' + (out.types[k] / Math.max(1, cnt)).toFixed(1) + '/个)');
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
