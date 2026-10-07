#!/usr/bin/env node
/**
 * 出 App Store 截图（iPhone 6.9" 横版 2868×1320）。
 *
 *   node tools/make_screenshots.js          # 英文（发行主语言，默认）
 *   node tools/make_screenshots.js --zh     # 中文（出到 screenshots-zh/）
 *
 * 沿用 record_fixed.js 的固定 dt / 虚拟时钟 / 固定随机源：每个镜头推固定帧数后
 * 截一张 PNG，同参数两次产出内容一致，不需要人工审片。
 *
 * 视口按 iPhone 17 Pro Max 的 **逻辑尺寸** 写（956×440pt @3x），
 * 这样截出来的就是真机横屏的样子，而不是把 16:9 画布硬拉宽。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
/* 主语言是 en-US，所以默认出英文；中文版另存一个目录，别互相覆盖。 */
const ZH = process.argv.includes('--zh');
const LOCALE = ZH ? 'zh-CN' : 'en-US';
const OUT = path.join(ROOT, 'output/appstore/screenshots' + (ZH ? '-zh' : ''));

// iPhone 17 Pro Max：440×956pt，横屏 956×440pt，@3x → 2868×1320px
const W = 956;
const H = 440;
const SCALE = 3;
const STEP = 1 / 60;

/** 截图用的一套"有战绩"存档，免得画面上全是 0。 */
const SAVE = {
  rank: 1000,
  matches: 7,
  totalWins: 12,
  bestWins: 12,
  tutorialDone: true,
  muted: true,
  loadout: ['barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla'],
};

/** 备战期摆好的阵型（与 record_fixed.js 的 a 场景一致）。 */
const BUILDS = [
  ['barricade', 3, 0], ['turret', 2, 0], ['flame', 3, 1],
  ['lamp', 2, 1], ['tesla', 3, 2], ['barricade', 2, 2],
];

function initScript() {
  window.__forceQuality = 'high';   // 截图固定最高画质
  window.__vnow = 0;
  window.__pending = [];
  window.requestAnimationFrame = function (cb) { window.__pending.push(cb); return window.__pending.length; };
  window.cancelAnimationFrame = function () {};
  performance.now = function () { return window.__vnow; };
  window.__advance = function (dt) {
    window.__vnow += dt * 1000;
    const q = window.__pending; window.__pending = [];
    const now = window.__vnow;
    for (const cb of q) cb(now);
  };
  let seed = 20260922;
  Math.random = function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

async function advance(page, frames) {
  await page.evaluate(({ frames, step }) => {
    for (let i = 0; i < frames; i++) window.__advance(step);
  }, { frames, step: STEP });
}

async function shot(page, name, results) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file });
  results.push([name, fs.statSync(file).size]);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
    /* 界面语言由 navigator.language 决定（见 js/i18n.js），所以这里设 locale
       就等于切换整个界面的语言，无需改代码。 */
    locale: LOCALE,
  });
  await context.addInitScript(initScript);

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const results = [];
  try {
    await page.goto(URL);
    await page.waitForFunction(() => window.Game && Game.state === 'menu' && document.querySelector('#playBtn'));
    await page.evaluate((save) => {
      Object.assign(Game.save, save);
      Game.persist();
      UI.showMenu();
    }, SAVE);
    await advance(page, 90);
    await shot(page, '01-menu', results);

    await page.evaluate(() => document.querySelector('#playBtn').click());
    await page.waitForSelector('#loadoutConfirm', { state: 'visible' });
    await advance(page, 45);
    await shot(page, '02-loadout', results);

    await page.evaluate(() => document.querySelector('#loadoutConfirm').click());
    await page.waitForFunction(() => Game.state === 'build');
    await page.evaluate((cells) => {
      Game.coins = 1000;
      for (const item of cells) Game.place(item[0], item[1], item[2]);
      Game.coins = 86;
      Game.tutorialActive = false;
      UI.syncAll();
    }, BUILDS);
    await advance(page, 45);
    await shot(page, '03-build', results);

    await page.evaluate(() => document.querySelector('#startBtn').click());
    // rAF 已被接管，必须手动推帧走完 1.55s 匹配动画才会进入 battle
    await advance(page, 130);
    await page.waitForFunction(() => Game.state === 'battle' && Game.battle, null, { timeout: 15000 });
    await advance(page, 480);
    await shot(page, '04-battle', results);

    await advance(page, 600);
    await shot(page, '05-battle-late', results);
  } finally {
    await browser.close();
  }

  console.log('语言: ' + LOCALE);
  console.log('输出: ' + path.relative(ROOT, OUT));
  results.forEach(([name, size]) => {
    console.log('  ' + name + '.png  ' + (size / 1024).toFixed(0) + 'KiB');
  });
  console.log('尺寸: ' + (W * SCALE) + '×' + (H * SCALE) + 'px（iPhone 6.9" 横版）');
  if (errors.length) {
    console.error('页面报错 ' + errors.length + ' 条:');
    errors.slice(0, 10).forEach((e) => console.error('  ✗ ' + e));
    process.exitCode = 1;
  } else {
    console.log('页面报错: 0');
  }
}

main();
