'use strict';

/* Capture the actual H5 cooperative UI with deterministic local room responses.
 * No room is created on the live service. Used only for promotional assets. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/promo/coop-30-assets');
const URL = 'file://' + path.join(ROOT, 'output/h5/index.html');

function payload(size, phase) {
  const players = Array.from({ length: size }, (_, seat) => ({
    seat, nicknameIndex: [0, 2, 3][seat], rank: 1000, ready: seat === 1,
    continued: false,
  }));
  return {
    room: {
      code: 'DUSK472P', phase, ownerSeat: 0, roundIndex: 0,
      deadline: Date.now() + 120000, players, teamHistory: [],
    },
    self: {
      seat: 0, rank: 1000, coins: 500,
      loadout: ['barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla'],
      relics: [], draft: { build: [], coins: 500 }, continued: false,
    },
  };
}

async function capture(browser, size) {
  let phase = size === 2 ? 'lobby' : 'preparing';
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'zh-CN',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://coop.pikafun.com/api/**', async (route) => {
    if (route.request().url().endsWith('/start')) phase = 'preparing';
    await route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
      body: JSON.stringify(payload(size, phase)),
    });
  });
  try {
    await page.goto(URL);
    await page.waitForSelector('#coopBtn', { state: 'visible' });
    await page.click('#coopBtn');
    await page.click('#createCoopBtn');
    if (size === 2) {
      await page.waitForSelector('#startTwoCoopBtn', { state: 'visible' });
      await page.locator('.overlayBox.coopRoom').screenshot({ path: path.join(OUT, 'room-2.png') });
      await page.click('#startTwoCoopBtn');
    }
    await page.waitForFunction(() => Game.coopMode && Game.state === 'build');
    await page.evaluate(() => {
      Game.coins = 900;
      for (const [type, col, lane] of [
        ['barricade', 3, 0], ['turret', 2, 0], ['flame', 3, 1],
        ['lamp', 2, 1], ['tesla', 3, 2], ['barricade', 2, 2],
      ]) Game.place(type, col, lane);
      UI.syncAll();
    });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `build-${size}.png`) });
    await page.locator('#coopHud').screenshot({ path: path.join(OUT, `hud-${size}.png`) });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`CAPTURED ${size} players`);
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--headless=new'] });
  try { await capture(browser, 2); await capture(browser, 3); }
  finally { await browser.close(); }
}

main().catch((e) => { console.error(e); process.exit(1); });
