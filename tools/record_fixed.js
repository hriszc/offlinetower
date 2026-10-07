'use strict';

/* 固定 dt 录屏：接管 rAF 与 performance.now，用虚拟时钟驱动游戏主循环。
 * 画面内容由代码决定（stage() 写死），录屏只作为容器，不需要人工审片。
 *
 * 用法：node tools/record_fixed.js <scene> [--w 2560] [--h 1440] [--fps 60] [--sec 15]
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');
const { execFileSync } = require('child_process');

const FFMPEG = '/Users/zhaochen/.local/bin/ffmpeg';
const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const SCENE = process.argv[2] || 'a';
const W = arg('w', 2560);
const H = arg('h', 1440);
const FPS = arg('fps', 60);
const SEC = arg('sec', 15);
const OUT = path.join(ROOT, 'output', 'promo', 'raw-fixed', SCENE);
const FRAMES = Math.round(FPS * SEC);
const STEP = 1 / FPS;

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
  await page.evaluate(() => document.querySelector('#startBtn').click());
  // rAF 已被接管，需手动推帧走完 1.55s 匹配动画才能进入战斗
  await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__advance(1 / 60); });
  await page.waitForFunction(() => Game.state === 'battle' && Game.battle, null, { timeout: 15000 });
}

async function stage(page) {
  if (SCENE === 'a') return;
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
    });
  }
}

/* 冻结胜负判定，保证 15s 内始终处于战斗画面 */
async function freezeBattle(page) {
  await page.evaluate(() => {
    const origUpdate = Game.update.bind(Game);
    Game.update = function (dt) {
      if (Game.matchmaking) { Game.updateMatchmaking(dt); return; }
      if (Game.state === 'battle' && Game.battle) {
        Game.battle.update(dt);
        if ('hp' in Game.battle && Game.battle.hp && Game.battle.hp.p != null) {
          Game.battle.hp.p = Math.max(1, Game.battle.hp.p);
        }
        if (Game.battle.dead) Game.battle.dead.p = null;
        if (Game.battle.over) { Game.battle.over = false; Game.battle.decided = false; }
      } else {
        origUpdate(dt);
      }
    };
  });
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

  // 接管 rAF 与 performance.now：两者共用同一条虚拟时钟
  await context.addInitScript(() => {
    window.__forceQuality = 'high';   // 录屏固定最高画质，自适应降级不参与
    window.__vnow = 0;
    window.__pending = [];
    window.requestAnimationFrame = function (cb) { window.__pending.push(cb); return window.__pending.length; };
    window.cancelAnimationFrame = function () {};
    const realNow = performance.now.bind(performance);
    window.__realNow = realNow;
    performance.now = function () { return window.__vnow; };
    window.__advance = function (dt) {
      window.__vnow += dt * 1000;
      const q = window.__pending; window.__pending = [];
      const now = window.__vnow;
      for (const cb of q) cb(now);
    };
    // 固定随机源：镜像名、种子、音效噪声全部可复现
    let seed = 20260922;
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const client = await context.newCDPSession(page);
  const frames = [];
  let frameResolve = null;
  client.on('Page.screencastFrame', async (f) => {
    frames.push(f.data);
    try { await client.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (_) {}
    if (frameResolve) { const r = frameResolve; frameResolve = null; r(); }
  });

  try {
    await page.goto(URL);
    await setup(page);
    await stage(page);
    await freezeBattle(page);
    await page.evaluate(() => { bootStep = null; });

    // 让 rAF 队列先入队，再开始逐帧推进
    await page.evaluate(() => window.__advance(0));

    await client.send('Page.startScreencast', {
      format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1,
    });

    const started = Date.now();
    for (let i = 0; i < FRAMES; i++) {
      const before = frames.length;
      let done = false;
      const waitFrame = new Promise((res) => { frameResolve = () => { if (!done) { done = true; res(); } }; });
      await page.evaluate((dt) => window.__advance(dt), STEP);
      await Promise.race([waitFrame, new Promise((r) => setTimeout(r, 3000))]);
      frameResolve = null;
      // screencast 可能多推帧，只保留最新一张
      if (frames.length > before + 1) frames.splice(before, frames.length - before - 1);
      if (i % 60 === 0) {
        const el = (Date.now() - started) / 1000;
        console.log(`${SCENE} ${i}/${FRAMES} ${(el / Math.max(1, i)).toFixed(3)}s/frame frames=${frames.length}`);
      }
    }
    await client.send('Page.stopScreencast');
    await new Promise((r) => setTimeout(r, 500));

    console.log(`CAPTURED ${SCENE} ${frames.length} frames in ${((Date.now() - started) / 1000).toFixed(1)}s errors=${errors.length}`);
    if (errors.length) console.log(errors.slice(0, 3).join('\n'));

    // 写入 JPEG 序列再用 ffmpeg 合成，避免依赖 screencast 的时序
    const seqDir = path.join(OUT, 'seq');
    fs.mkdirSync(seqDir, { recursive: true });
    frames.forEach((b64, i) => {
      fs.writeFileSync(path.join(seqDir, 'f' + String(i).padStart(4, '0') + '.jpg'), Buffer.from(b64, 'base64'));
    });
    const videoFile = path.join(OUT, `${SCENE}.mp4`);
    execFileSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-framerate', String(FPS), '-i', path.join(seqDir, 'f%04d.jpg'),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoFile,
    ], { stdio: ['ignore', 'inherit', 'pipe'] });
    fs.rmSync(seqDir, { recursive: true, force: true });
    console.log(`VIDEO ${videoFile}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
