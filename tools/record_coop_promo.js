'use strict';

/* 用 H5 实际的 CoopSim + Render 固定 dt 录制双人 / 三人战斗母带。
 * 不连接线上房间；帧通过 CDP 逐帧送入 ffmpeg，不落 JPEG 序列。 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { once } = require('events');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/promo/coop-30-assets');
const URL = 'file://' + path.join(ROOT, 'output/h5/index.html');
const FFMPEG = '/Users/zhaochen/.local/bin/ffmpeg';
const W = Number(process.argv[2]) || 2560;
const H = Math.round(W * 9 / 16);
const FPS = 30;
const SMOKE = process.argv.includes('--smoke');

const build = [
  { type: 'barricade', col: 2, lane: 0 },
  { type: 'turret', col: 4, lane: 0 },
  { type: 'flame', col: 3, lane: 1 },
  { type: 'lamp', col: 1, lane: 1 },
  { type: 'tesla', col: 4, lane: 2 },
  { type: 'turret', col: 2, lane: 2 },
];

async function record(browser, count) {
  const context = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'zh-CN',
  });
  await context.addInitScript(() => {
    window.__forceQuality = 'high';
    window.__vnow = 0;
    window.__pending = [];
    window.requestAnimationFrame = cb => { window.__pending.push(cb); return window.__pending.length; };
    window.cancelAnimationFrame = () => {};
    performance.now = () => window.__vnow;
    window.__advance = dt => {
      window.__vnow += dt * 1000;
      const q = window.__pending; window.__pending = [];
      for (const cb of q) cb(window.__vnow);
    };
    let seed = 20260928;
    Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(URL);
    await page.waitForFunction(() => window.Game && window.CoopSim && Game.state === 'menu');
    await page.evaluate(({ count, build }) => {
      Game.save.tutorialDone = true;
      Game.save.muted = true;
      const players = Array.from({ length: count }, (_, seat) => ({
        seat, rank: 1400, relics: [],
        build: build.map((u, index) => ({
          ...u, col: Math.min(8, u.col + (seat === 1 && index % 2 ? 1 : 0)),
          type: seat === 2 && u.type === 'lamp' ? 'frost' : u.type,
        })),
      }));
      const battle = CoopSim.createBattle(players, 6, 20260928 + count, 1400);
      battle.coopViewerSeat = 0;
      battle.coopHomes.forEach((home, i) => { home.name = ['守夜人甲', '守夜人乙', '守夜人丙'][i]; });
      battle.t = 52;
      battle.baseWave.maxTime = 180;
      battle.wave.maxTime = 180;
      battle.wave.interval0 = 0.18;
      battle.wave.interval1 = 0.13;
      battle.wave.pulseEvery = 1.3;
      battle.wave.pulseSize = 4;
      battle.spawnTimer = 0;
      battle.pulseTimer = 0;
      battle.pulseQueue = count * 5;
      for (let i = 0; i < count * 12; i++) battle.spawnOne();
      Game.coopMode = true;
      Game.coopLocked = true;
      Game.coopSeat = 0;
      Game.coopHomes = battle.coopHomes;
      Game.roundIndex = 6;
      Game.coins = 0;
      Game.battle = battle;
      Game.state = 'coopReplay';
      UI.el.overlay.style.display = 'none';
      UI.overlayMode = null;
      UI.el.coopHud.style.display = 'block';
      UI.el.coopHud.innerHTML = '<div class="coopHudBox"><div class="coopHudTop">合作守夜 · ' + count +
        ' 人同场</div><div class="coopHudBody"><div class="coopRoster">' +
        battle.coopHomes.map(h => h.name + ' 100 HP').join(' · ') + '</div></div></div>';
      window.__promoStep = dt => {
        battle.advanceCoop(dt);
        if (battle.over) battle.over = false;
        for (const home of battle.coopHomes) {
          if (home.hp < 1) { home.hp = 1; home.alive = true; }
        }
      };
      UI.syncAll();
    }, { count, build });
    await page.evaluate(() => window.__advance(0));
    if (SMOKE) {
      await page.evaluate(() => { for (let i = 0; i < 20; i++) {
        window.__promoStep(1 / 30); window.__advance(1 / 30);
      } });
      const file = path.join(OUT, `battle-${count}-smoke.png`);
      await page.screenshot({ path: file });
      console.log(`SMOKE ${file} zombies=${await page.evaluate(() => Game.battle.zombies.length)}`);
      return;
    }

    const dest = path.join(OUT, `battle-${count}-fixed.mp4`);
    const ff = spawn(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error', '-f', 'mjpeg', '-framerate', String(FPS),
      '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffError = '';
    ff.stderr.on('data', buf => { ffError += buf.toString(); });
    const client = await context.newCDPSession(page);
    let sequence = 0;
    let latest = null;
    let resolveFrame = null;
    client.on('Page.screencastFrame', async frame => {
      latest = Buffer.from(frame.data, 'base64');
      sequence++;
      try { await client.send('Page.screencastFrameAck', { sessionId: frame.sessionId }); } catch (_) {}
      if (resolveFrame) { const done = resolveFrame; resolveFrame = null; done(); }
    });
    await client.send('Page.startScreencast', {
      format: 'jpeg', quality: 93, maxWidth: W, maxHeight: H, everyNthFrame: 1,
    });
    const total = FPS * (count === 2 ? 8 : 9);
    for (let i = 0; i < total; i++) {
      const before = sequence;
      const arrived = new Promise(resolve => { resolveFrame = resolve; });
      await page.evaluate(dt => { window.__promoStep(dt); window.__advance(dt); }, 1 / FPS);
      if (sequence === before) {
        await Promise.race([arrived, new Promise((_, reject) => setTimeout(() => reject(new Error('screencast timeout')), 5000))]);
      }
      resolveFrame = null;
      if (!ff.stdin.write(latest)) await once(ff.stdin, 'drain');
      if (i % 60 === 0) console.log(`RECORD ${count}p ${i}/${total} zombies=${await page.evaluate(() => Game.battle.zombies.length)}`);
    }
    await client.send('Page.stopScreencast');
    ff.stdin.end();
    const [code] = await once(ff, 'close');
    if (code) throw new Error(`ffmpeg ${code}: ${ffError}`);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`VIDEO ${dest}`);
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--headless=new'] });
  try {
    await record(browser, 2);
    await record(browser, 3);
  } finally { await browser.close(); }
}

main().catch(e => { console.error(e); process.exit(1); });
