'use strict';

/* 录制高分辨率（默认 2560x1440）实机素材，供 9:16 竖版放大裁切使用。 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output', 'promo');
const RAW = path.join(OUT, 'raw-hd');
const STILLS = path.join(OUT, 'stills-hd');
const URL = 'file://' + path.join(ROOT, 'index.html');
const W = Number(process.env.PROMO_W || 2560);
const H = Number(process.env.PROMO_H || 1440);

function mkdirs() {
  for (const dir of [OUT, RAW, STILLS]) fs.mkdirSync(dir, { recursive: true });
}

async function waitForGame(page) {
  await page.waitForFunction(() => window.Game && Game.state === 'menu' && document.querySelector('#playBtn'));
}

async function configureSave(page) {
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
}

async function openBuild(page) {
  await configureSave(page);
  await page.evaluate(() => document.querySelector('#playBtn').click());
  await page.waitForSelector('#loadoutConfirm', { state: 'visible' });
  await page.evaluate(() => document.querySelector('#loadoutConfirm').click());
  await page.waitForFunction(() => Game.state === 'build');
}

async function placeBuild(page, cells) {
  await page.evaluate((list) => {
    Game.coins = 1000;
    for (const item of list) Game.place(item[0], item[1], item[2]);
    Game.coins = 86;
    Game.tutorialActive = false;
    UI.syncAll();
  }, cells);
}

async function startBattle(page) {
  await page.evaluate(() => document.querySelector('#startBtn').click());
  await page.waitForFunction(() => Game.state === 'battle' && Game.battle, null, { timeout: 10000 });
}

async function makeContext(browser, name, videoStart) {
  const dir = path.join(RAW, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: W, height: H } },
  });
  videoStart.set(name, Date.now());
  return context;
}

async function recordScene(browser, name, scene, videoStart, holdMs) {
  const context = await makeContext(browser, name, videoStart);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  let battleReadyAt = 0;
  try {
    await page.goto(URL);
    await waitForGame(page);
    await openBuild(page);
    if (scene === 'a') {
      await placeBuild(page, [
        ['barricade', 3, 0], ['turret', 2, 0],
        ['flame', 3, 1], ['lamp', 2, 1],
        ['tesla', 3, 2], ['barricade', 2, 2],
      ]);
      await startBattle(page);
      await page.screenshot({ path: path.join(STILLS, 'scene-a.png') });
      await page.waitForTimeout(holdMs);
    } else if (scene === 'b') {
      await placeBuild(page, [
        ['barricade', 3, 0], ['turret', 2, 0],
        ['flame', 3, 1], ['tesla', 2, 1],
        ['barricade', 3, 2], ['turret', 2, 2],
      ]);
      await startBattle(page);
      await page.waitForTimeout(1200);
      await page.evaluate(() => {
        const b = Game.battle;
        b.t = 63;
        b.baseWave.interval0 = 0.10;
        b.baseWave.interval1 = 0.07;
        b.baseWave.pulseEvery = 0.65;
        b.baseWave.pulseSize = 8;
        b.wave.interval0 = 0.10;
        b.wave.interval1 = 0.07;
        b.wave.pulseEvery = 0.65;
        b.wave.pulseSize = 8;
        b.spawnTimer = 0;
        b.pulseTimer = 0;
        b.pulseQueue = 14;
        for (let i = 0; i < 34; i++) b.spawnOne();
        for (const z of b.zombies) {
          if (z.side === 'p') z.x = Math.min(z.x, 470 + (iSeed(z) % 80));
        }
        function iSeed(z) { return Math.abs(Math.round(z.x + z.y * 3)); }
      });
      await page.waitForTimeout(holdMs);
    } else if (scene === 'd') {
      await placeBuild(page, [
        ['barricade', 3, 0], ['turret', 2, 0],
        ['flame', 3, 1], ['tesla', 2, 1],
        ['barricade', 3, 2], ['lamp', 2, 2],
      ]);
      await startBattle(page);
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        const b = Game.battle;
        b.hp.p = 9;
        b.maxHp.p = 100;
        b.dead.p = null;
        b.t = 52;
        b.baseWave.interval0 = 0.12;
        b.baseWave.interval1 = 0.09;
        b.wave.interval0 = 0.12;
        b.wave.interval1 = 0.09;
        b.spawnTimer = 0;
        for (let i = 0; i < 40; i++) b.spawnOne();
        for (const z of b.zombies) {
          if (z.side === 'p') {
            z.x = 330 + (iSeed(z) % 300);
            z.y = CONFIG.LANES[z.lane];
          }
        }
        function iSeed(z) { return Math.abs(Math.round(z.x * 3 + z.y * 5)); }
        Game.update = function (dt) {
          if (Game.matchmaking) {
            Game.updateMatchmaking(dt);
            return;
          }
          if (Game.state === 'battle' && Game.battle) {
            Game.battle.update(dt);
            Game.battle.hp.p = Math.max(1, Game.battle.hp.p);
            Game.battle.dead.p = null;
            if (Game.battle.over) {
              Game.battle.over = false;
              Game.battle.decided = false;
            }
          }
        };
      });
      await page.waitForTimeout(5200);
      await page.evaluate(() => { Game.flare = 3; Game.useFlare(480, CONFIG.LANES[1]); });
      await page.waitForTimeout(4200);
      await page.evaluate(() => { Game.flare = 3; Game.useFlare(430, CONFIG.LANES[3]); });
      await page.waitForTimeout(Math.max(0, holdMs - 10400));
    } else {
      await placeBuild(page, [
        ['barricade', 3, 0], ['barricade', 2, 0],
        ['barricade', 3, 1], ['barricade', 2, 1],
        ['barricade', 3, 2], ['barricade', 2, 2],
      ]);
      await startBattle(page);
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        const b = Game.battle;
        b.hp.p = 1;
        b.maxHp.p = 100;
        b.dead.p = null;
        b.t = 34;
        for (let i = 0; i < 18; i++) b.spawnOne();
        for (const z of b.zombies) {
          if (z.side === 'p') {
            z.x = 165 + (iStagger(z) % 38);
            z.y = CONFIG.LANES[z.lane];
          }
        }
        function iStagger(z) { return Math.abs(Math.round(z.y * 7 + z.x)); }
        Game.update = function (dt) {
          if (Game.matchmaking) {
            Game.updateMatchmaking(dt);
            return;
          }
          if (Game.state === 'battle' && Game.battle) {
            Game.battle.update(dt);
            Game.battle.hp.p = Math.max(1, Game.battle.hp.p);
            Game.battle.dead.p = null;
            if (Game.battle.over) {
              Game.battle.over = false;
              Game.battle.decided = false;
            }
          }
        };
      });
      await page.waitForTimeout(holdMs);
    }
    battleReadyAt = Date.now();
  } finally {
    await context.close();
  }
  const files = fs.existsSync(path.join(RAW, name))
    ? fs.readdirSync(path.join(RAW, name)).filter((file) => file.endsWith('.webm'))
    : [];
  const metadata = {
    name,
    scene,
    width: W,
    height: H,
    videoStartAt: videoStart.get(name),
    battleReadyAt,
    startOffsetSeconds: Math.max(0, (battleReadyAt - videoStart.get(name)) / 1000 - 0.25),
    file: files[0] ? path.join(RAW, name, files[0]) : null,
    errors,
  };
  fs.writeFileSync(path.join(RAW, name + '.json'), JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify(metadata, null, 2));
  return metadata;
}

async function main() {
  mkdirs();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const videoStart = new Map();
  const holdMs = Number(process.env.PROMO_HOLD_MS || 26000);
  try {
    const requested = process.argv[2];
    if (!requested || requested === 'a') await recordScene(browser, 'scene-a', 'a', videoStart, holdMs);
    if (!requested || requested === 'b') await recordScene(browser, 'scene-b', 'b', videoStart, holdMs);
    if (!requested || requested === 'c') await recordScene(browser, 'scene-c', 'c', videoStart, holdMs);
    if (!requested || requested === 'd') await recordScene(browser, 'scene-d', 'd', videoStart, holdMs);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
