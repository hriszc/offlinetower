'use strict';

/* 出「无限畅玩」内购的审核截图（付费墙）。
 *
 *   node tools/make_iap_screenshot.js          # 英文（商店主语言，默认）
 *   node tools/make_iap_screenshot.js --zh     # 中文
 *
 * 产物：output/appstore/iap/unlimited-play-paywall.png（2868×1320）
 *
 * App Store Connect 建内购时「审核信息 → 截图」是必填项，这张图就给它。
 * 和 make_screenshots.js 同一套路：接管 rAF 走固定 dt、固定随机源、最高画质，
 * 再用假宿主桥（window.webkit.messageHandlers.monetize）冒充 iOS 原生 ——
 * 门禁只在有桥时生效（见 js/monetize.js），没有桥根本长不出付费墙。
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('/Users/zhaochen/.npm/_npx/5c6d8c4f680fcd0a/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const ZH = process.argv.includes('--zh');
const LOCALE = ZH ? 'zh-CN' : 'en-US';
const OUT = path.join(ROOT, 'output/appstore/iap');

// iPhone 17 Pro Max：956×440pt 横屏，@3x → 2868×1320px
const W = 956;
const H = 440;
const SCALE = 3;
const STEP = 1 / 60;

/* 注意：这个函数会被序列化后丢进浏览器上下文执行，外面的变量一个都看不见，
   所以参数必须显式传进来（addInitScript 的第二个参数）。 */
function initScript(opts) {
  const zh = opts.zh;
  window.__forceQuality = 'high';
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
  let seed = 20260924;
  Math.random = function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  /* 冒充 iOS 宿主。商品名与价格走商店给的 displayName / displayPrice，
     所以这里给什么，付费墙上就显示什么 —— 代码里没有写死的金额。 */
  const host = {
    unlocked: false,
    region: 'USA',
    iapAvailable: true,
    adsAvailable: false,
    product: {
      id: 'com.zequnhuang.zombieknock.unlimited',
      title: zh ? '无限畅玩' : 'Unlimited Play',
      price: 'US$1.99',
    },
  };
  window.__host = host;
  function state(extra) {
    return Object.assign({
      type: 'state',
      unlocked: host.unlocked,
      region: host.region,
      iapAvailable: host.iapAvailable,
      adsAvailable: host.adsAvailable,
      product: host.product,
    }, extra || {});
  }
  function reply(obj) { setTimeout(function () { if (window.Monetize) Monetize._recv(obj); }, 0); }
  window.webkit = {
    messageHandlers: {
      monetize: {
        postMessage: function (msg) {
          if (msg.cmd === 'sync') reply(state({ id: msg.id }));
          else if (msg.cmd === 'buy') { host.unlocked = true; reply(state({ id: msg.id, unlocked: true })); }
          else if (msg.cmd === 'restore') reply(state({ id: msg.id }));
        },
      },
    },
  };
}

async function advance(page, frames) {
  await page.evaluate(({ frames, step }) => {
    for (let i = 0; i < frames; i++) window.__advance(step);
  }, { frames, step: STEP });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
    locale: LOCALE,
  });
  await context.addInitScript(initScript, { zh: ZH });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'load' });
  await advance(page, 30);
  await page.waitForTimeout(250);   // 等假桥的异步回话落地
  await advance(page, 10);

  const state = await page.evaluate(() => {
    UI.showMenu();
    UI.showPaywall('menu');
    return {
      overlay: UI.overlayMode,
      title: Monetize.title(),
      price: Monetize.price(),
      unlocked: Monetize.unlocked,
      left: Monetize.info().left,
      buyText: (document.getElementById('buyBtn') || {}).textContent,
      restore: !!document.getElementById('restoreBtn'),
    };
  });
  await advance(page, 6);

  const name = ZH ? 'unlimited-play-paywall-zh.png' : 'unlimited-play-paywall.png';
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  await browser.close();

  const bytes = fs.statSync(file).size;
  console.log('付费墙状态 :', JSON.stringify(state));
  console.log('JS 报错    :', errors.length ? errors.join(' | ') : '无');
  console.log('产物       :', path.relative(ROOT, file), (bytes / 1024).toFixed(1) + 'KiB');

  const bad = [];
  if (state.overlay !== 'paywall') bad.push('付费墙没弹出来');
  if (!state.price) bad.push('价格是空的（付费墙会显示「正在获取价格…」）');
  if (!state.restore) bad.push('没有「恢复购买」按钮');
  if (!state.buyText || !state.buyText.includes('1.99')) bad.push('购买按钮上没带上价格：' + state.buyText);
  if (errors.length) bad.push('有 JS 报错');
  console.log(bad.length ? '\n✗ ' + bad.join('；') : '\n✓ 付费墙、价格、恢复购买都在位');
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
