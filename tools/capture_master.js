'use strict';

/* 确定性逐帧抓取“母带”：
 *   - 用固定 dt 手动驱动 Game.update / Render.draw，禁用 rAF，避免实时录屏的低帧率；
 *   - 只抓 canvas（战场本体），DOM HUD 由后期字幕承担；
 *   - 输出 JPEG 序列，交给 ffmpeg 做竖版裁切与合成。
 *
 * 用法：node tools/capture_master.js <scene> [--w 2560] [--h 1440] [--fps 25] [--sec 15] [--q 0.93]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const SCENE = process.argv[2] || 'a';
const W = arg('w', 2560);
const H = arg('h', 1440);
const FPS = arg('fps', 25);
const SEC = arg('sec', 15);
const Q = arg('q', 0.93);
const FRAMES = Math.round(FPS * SEC);
const OUT = path.join(ROOT, 'output', 'promo', 'master', SCENE);

const BUILDS = {
  a: [['barricade', 3, 0], ['turret', 2, 0], ['flame', 3, 1], ['lamp', 2, 1], ['tesla', 3, 2], ['barricade', 2, 2]],
  b: [['barricade', 3, 0], ['turret', 2, 0], ['flame', 3, 1], ['tesla', 2, 1], ['barricade', 3, 2], ['turret', 2, 2]],
  c: [['barricade', 3, 0], ['barricade', 2, 0], ['barricade', 3, 1], ['barricade', 2, 1], ['barricade', 3, 2], ['barricade', 2, 2]],
  d: [['barricade', 3, 0], ['turret', 2, 0], ['flame', 3, 1], ['tesla', 2, 1], ['barricade', 3, 2], ['lamp', 2, 2]],
};

async function setup(page) {
  await page.waitForFunction(() => window.Game && Game.state === 'menu' && document.querySelector('#playBtn'));
  await page.evaluate(() => {
    Game.save.rank = 1000;
    Game.save.matches = 7;
    Game.save.totalWins = 12;
    Game.save.bestWins = 12;
    Game.save.tutorialDone = true;
    Game.save.loadout = ['barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla'];
    Game.save.muted = true;
    Game.persist();
  });
  await page.evaluate(() => document.querySelector('#playBtn').click());
  await page.waitForSelector('#loadoutConfirm', { state: 'visible' });
  await page.evaluate(() => document.querySelector('#loadoutConfirm').click());
  await page.waitForFunction(() => Game.state === 'build');
  await page.evaluate((cells) => {
    Game.coins = 1000;
    for (const item of cells) Game.place(item[0], item[1], item[2]);
    Game.coins = 86;
    Game.tutorialActive = false;
    UI.syncAll();
  }, BUILDS[SCENE]);
  await page.evaluate(() => {
    document.querySelector('#startBtn').click();
    if (Game.matchmaking) Game.enterBattle();
  });
  await page.waitForFunction(() => Game.state === 'battle' && Game.battle, null, { timeout: 20000 });
}

/* 每段母带的“剧本”：把战场推到想要的戏剧状态 */
async function stage(page) {
  if (SCENE === 'a') return;                       // 开局推进：展示裂隙与布防
  if (SCENE === 'b') {
    await page.evaluate(() => {
      const b = Game.battle;
      b.t = 63;
      b.baseWave.interval0 = 0.10; b.baseWave.interval1 = 0.07;
      b.baseWave.pulseEvery = 0.65; b.baseWave.pulseSize = 8;
      b.wave.interval0 = 0.10; b.wave.interval1 = 0.07;
      b.wave.pulseEvery = 0.65; b.wave.pulseSize = 8;
      b.spawnTimer = 0; b.pulseTimer = 0; b.pulseQueue = 14;
      for (let i = 0; i < 34; i++) b.spawnOne();
    });
    return;
  }
  if (SCENE === 'c') {
    await page.evaluate(() => {
      const b = Game.battle;
      b.hp.p = 1; b.maxHp.p = 100; b.dead.p = null; b.t = 34;
      for (let i = 0; i < 18; i++) b.spawnOne();
      for (const z of b.zombies) {
        if (z.side === 'p') { z.x = 175 + (Math.abs(Math.round(z.y * 7)) % 40); z.y = CONFIG.LANES[z.lane]; }
      }
      freeze();
      function freeze() {
        Game.update = function (dt) {
          if (Game.matchmaking) { Game.updateMatchmaking(dt); return; }
          if (Game.state === 'battle' && Game.battle) {
            Game.battle.update(dt);
            Game.battle.hp.p = Math.max(1, Game.battle.hp.p);
            Game.battle.dead.p = null;
            if (Game.battle.over) { Game.battle.over = false; Game.battle.decided = false; }
          }
        };
      }
    });
    return;
  }
  if (SCENE === 'd') {
    await page.evaluate(() => {
      const b = Game.battle;
      b.hp.p = 11; b.maxHp.p = 100; b.dead.p = null; b.t = 52;
      b.baseWave.interval0 = 0.12; b.baseWave.interval1 = 0.09;
      b.wave.interval0 = 0.12; b.wave.interval1 = 0.09;
      b.spawnTimer = 0;
      for (let i = 0; i < 40; i++) b.spawnOne();
      for (const z of b.zombies) {
        if (z.side === 'p') { z.x = 330 + (Math.abs(Math.round(z.x * 3 + z.y * 5)) % 300); z.y = CONFIG.LANES[z.lane]; }
      }
      Game.update = function (dt) {
        if (Game.matchmaking) { Game.updateMatchmaking(dt); return; }
        if (Game.state === 'battle' && Game.battle) {
          Game.battle.update(dt);
          Game.battle.hp.p = Math.max(1, Game.battle.hp.p);
          Game.battle.dead.p = null;
          if (Game.battle.over) { Game.battle.over = false; Game.battle.decided = false; }
        }
      };
    });
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    window.__forceQuality = 'high';   // 录屏固定最高画质
    window.requestAnimationFrame = function () { return 0; };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    await page.goto(URL);
    await setup(page);
    await stage(page);
    await page.evaluate(() => {
      window.__step = function (dt) {
        Game.update(dt);
        if (Game.battle) {
          const fx = Game.battle.drainFx();
          for (let i = 0; i < fx.length; i++) Render.handleFx(fx[i]);
        }
        Render.draw({
          battle: Game.battle,
          buildPhase: Game.state === 'build',
          roundIndex: Game.roundIndex,
          hoverCell: Game.hoverCell,
        }, dt);
      };
    });
    const started = Date.now();
    for (let i = 0; i < FRAMES; i++) {
      if (SCENE === 'd' && i === Math.round(FPS * 5)) {
        await page.evaluate(() => { Game.flare = 3; Game.useFlare(470, CONFIG.LANES[1]); });
      }
      if (SCENE === 'd' && i === Math.round(FPS * 9)) {
        await page.evaluate(() => { Game.flare = 3; Game.useFlare(560, CONFIG.LANES[3]); });
      }
      await page.evaluate(() => window.__step(1 / 25));
      const data = await page.evaluate((q) => document.getElementById('game').toDataURL('image/jpeg', q), Q);
      fs.writeFileSync(path.join(OUT, 'f' + String(i).padStart(4, '0') + '.jpg'), Buffer.from(data.slice(23), 'base64'));
      if (i % 25 === 0) {
        const el = (Date.now() - started) / 1000;
        console.log(`${SCENE} ${i}/${FRAMES} ${(el / Math.max(1, i)).toFixed(2)}s/frame`);
      }
    }
    console.log(`DONE ${SCENE} ${FRAMES} frames in ${((Date.now() - started) / 1000).toFixed(1)}s errors=${errors.length}`);
    if (errors.length) console.log(errors.slice(0, 3).join('\n'));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
