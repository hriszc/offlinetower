'use strict';

/* 一次性验证变现门禁：同一趟浏览器里跑完，只出 2 张截图。
 *
 *   node tools/verify_monetize.js
 *
 * 用一个假的宿主桥（window.webkit.messageHandlers.monetize）冒充 iOS 原生，
 * 走完「3 局免费 → 付费墙 → 买断解锁 → 跨天重置」主链路；
 * 再验两条支路：国内店面（没有内购）必须放行、宿主报 adsAvailable 时广告那条缝还在。
 * 最后开一个没有桥的页面，确认网页版 / H5 仍然不限局。截图放 output/playwright/。
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'output', 'playwright');

/** 冒充原生的宿主：回话一律异步，和 StoreKit 的真实时序一致。 */
function fakeHost() {
  const host = {
    unlocked: false,
    region: 'USA',
    iapAvailable: true,
    adsAvailable: false,   // iOS 壳不接广告；置 true 可验证留给小工具渠道的那条缝
    adOk: true,
    product: { id: 'com.zequnhuang.zombieknock.unlimited', title: '无限畅玩', price: 'US$1.99' },
    log: [],
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

  function reply(obj) {
    setTimeout(function () { if (window.Monetize) Monetize._recv(obj); }, 0);
  }

  window.webkit = {
    messageHandlers: {
      monetize: {
        postMessage: function (msg) {
          host.log.push(msg.cmd);
          if (msg.cmd === 'sync') reply(state({ id: msg.id }));
          else if (msg.cmd === 'buy') { host.unlocked = true; reply(state({ id: msg.id, unlocked: true })); }
          else if (msg.cmd === 'restore') reply(state({ id: msg.id }));
          else if (msg.cmd === 'ad') reply({ id: msg.id, type: 'ad', ok: host.adOk, reason: host.adOk ? 'ok' : 'nofill' });
        },
      },
    },
  };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail === undefined ? '' : '  → ' + detail));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];

  /* ---------- 一、有宿主桥：门禁生效 ---------- */
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await context.addInitScript(fakeHost);
  const page = await context.newPage();
  page.on('pageerror', function (e) { errors.push(String(e)); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.waitForFunction(function () { return window.Monetize && Monetize.ready; });

  const boot = await page.evaluate(function () {
    return {
      active: Monetize.active, info: Monetize.info(), line: Monetize.line(),
      title: Monetize.title(), price: Monetize.price(), cmds: window.__host.log.slice(),
    };
  });
  check('桥在 = 门禁在', boot.active === true);
  check('宿主 sync 收到回话', boot.info.freeLeft === 3 && boot.info.limit === 3, JSON.stringify(boot.info));
  check('商品名与价格都取自商店', boot.title === '无限畅玩' && boot.price === 'US$1.99',
    boot.title + ' / ' + boot.price + ' · 收到 ' + boot.cmds.join(','));
  check('主菜单显示额度', boot.line === '今日剩余 3 / 3 局免费', boot.line);

  const menu0 = await page.evaluate(function () {
    UI.showMenu();
    return {
      quota: document.querySelector('#overlay .quota').textContent,
      play: document.getElementById('playBtn').textContent,
      unlock: !!document.getElementById('unlockBtn'),
    };
  });
  check('主菜单画出额度行与解锁入口', menu0.quota === boot.line && menu0.unlock === true, JSON.stringify(menu0));

  const free = await page.evaluate(function () {
    var n = 0;
    for (var i = 0; i < 3; i++) Monetize.requestMatch(function () { n++; });
    return { played: n, left: Monetize.info().left, overlay: UI.overlayMode };
  });
  check('前三局直接放行', free.played === 3 && free.left === 0 && free.overlay !== 'paywall', JSON.stringify(free));

  const denied = await page.evaluate(function () {
    var ran = false;
    var ok = Monetize.requestMatch(function () { ran = true; });
    return {
      ok: ok, ran: ran, overlay: UI.overlayMode,
      hasAd: !!document.getElementById('adBtn'),
      hasBuy: !!document.getElementById('buyBtn'),
      hasRestore: !!document.getElementById('restoreBtn'),
      buy: (document.getElementById('buyBtn') || {}).textContent || '',
    };
  });
  check('第四局被拦下并弹付费墙', denied.ok === false && denied.ran === false && denied.overlay === 'paywall', JSON.stringify(denied));
  check('纯内购：付费墙只有买断 + 恢复购买，没有广告按钮',
    denied.hasBuy === true && denied.hasRestore === true && denied.hasAd === false);
  check('买断按钮带商店给的价格', denied.buy.indexOf('无限畅玩') === 0 && denied.buy.indexOf('US$1.99') > 0, denied.buy);
  await page.screenshot({ path: path.join(OUT, 'monetize-paywall.png') });

  const menu1 = await page.evaluate(function () {
    UI.showMenu();
    return { play: document.getElementById('playBtn').textContent, quota: document.querySelector('#overlay .quota').textContent };
  });
  check('额度用尽后主按钮改成「解锁」', menu1.play.indexOf('解 锁') >= 0, JSON.stringify(menu1));
  await page.screenshot({ path: path.join(OUT, 'monetize-menu.png') });

  /* 跨天：免费额度还回来 */
  const rollover = await page.evaluate(function () {
    Monetize.quota.used = 3;
    Monetize.quota.day = '2000-01-01';
    Monetize._write();
    return Monetize.info();
  });
  check('跨天重置免费额度', rollover.freeLeft === 3, JSON.stringify(rollover));

  /* 买断 */
  const bought = await page.evaluate(function () {
    return new Promise(function (resolve) {
      Monetize.buy(function (ok, why) {
        resolve({ ok: ok, why: why, unlocked: Monetize.unlocked, left: Monetize.info().left, line: Monetize.line() });
      });
    });
  });
  check('买断后解锁', bought.ok === true && bought.unlocked === true && bought.left === -1, JSON.stringify(bought));
  check('买断后不再弹付费墙', bought.line.indexOf('已解锁') === 0, bought.line);

  const unlimited = await page.evaluate(function () {
    var n = 0;
    for (var i = 0; i < 10; i++) Monetize.requestMatch(function () { n++; });
    return { n: n, overlay: UI.overlayMode };
  });
  check('解锁后不再扣额度', unlimited.n === 10 && unlimited.overlay !== 'paywall', JSON.stringify(unlimited));

  /* ---------- 二、留给小工具渠道的广告缝：宿主报 adsAvailable 才长出来 ---------- */
  const seam = await page.evaluate(function () {
    window.__host.unlocked = false;
    window.__host.adsAvailable = true;
    Monetize.unlocked = false;
    Monetize.quota.used = 3;
    Monetize.quota.credits = 0;
    Monetize._recv({
      type: 'state', unlocked: false, region: 'USA', iapAvailable: true,
      adsAvailable: true, product: window.__host.product,
    });
    UI.showPaywall('quota');
    return {
      ads: Monetize.adsAvailable,
      hasAd: !!document.getElementById('adBtn'),
      play: (UI.showMenu(), document.getElementById('playBtn').textContent),
    };
  });
  check('宿主报 adsAvailable 时才出现广告按钮', seam.ads === true && seam.hasAd === true);
  check('有广告时主按钮改成「看广告」', seam.play.indexOf('看 广 告') >= 0, seam.play);

  const ad = await page.evaluate(function () {
    UI.showPaywall('quota');
    return new Promise(function (resolve) {
      Monetize.watchAd(function (ok, why) {
        resolve({ ok: ok, why: why, credits: Monetize.info().credits });
      });
    });
  });
  check('看完激励视频 +1 大局', ad.ok === true && ad.credits === 1, JSON.stringify(ad));

  const afterAd = await page.evaluate(function () {
    var ran = false;
    Monetize.requestMatch(function () { ran = true; });
    return { ran: ran, credits: Monetize.info().credits };
  });
  check('广告额度换成一局', afterAd.ran === true && afterAd.credits === 0, JSON.stringify(afterAd));

  const failOpen = await page.evaluate(function () {
    Monetize.quota.used = 3;
    Monetize.quota.credits = 0;
    window.__host.adOk = false;
    UI.showPaywall('quota');
    document.getElementById('adBtn').click();
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ overlay: UI.overlayMode, state: Game.state, paid: Monetize.unlocked });
      }, 400);
    });
  });
  check('广告失败放行，不出现死局',
    failOpen.overlay !== 'paywall' && failOpen.state === 'build' && failOpen.paid === false, JSON.stringify(failOpen));

  /* ---------- 三、国内店面：没有内购，整体放行 ---------- */
  const cn = await page.evaluate(function () {
    window.__host.adsAvailable = false;
    window.__host.adOk = true;
    Monetize.unlocked = false;
    Monetize.quota.used = 3;
    Monetize.quota.credits = 0;
    Monetize._recv({
      type: 'state', unlocked: false, region: 'CHN', iapAvailable: true,
      adsAvailable: false, product: window.__host.product,
    });
    var ran = false;
    var ok = Monetize.requestMatch(function () { ran = true; });
    var overlayAfter = UI.overlayMode;      // 放行之后不该有浮层
    UI.showPaywall('quota');
    return {
      iap: Monetize.iapAvailable,
      ok: ok,
      ran: ran,
      overlay: overlayAfter,
      hasBuy: !!document.getElementById('buyBtn'),
      note: (document.querySelector('.payNote') || {}).textContent || '',
    };
  });
  check('国内店面隐藏内购入口', cn.iap === false && cn.hasBuy === false, JSON.stringify(cn));
  check('国内店面整体放行，免费不限局', cn.ok === true && cn.ran === true && cn.overlay !== 'paywall', JSON.stringify(cn));
  check('国内文案说明「可以免费继续玩」', cn.note.indexOf('免费继续玩') >= 0, cn.note);
  await context.close();

  /* ---------- 四、没有桥：网页版 / H5 仍然不限局 ---------- */
  const plain = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page2 = await plain.newPage();
  page2.on('pageerror', function (e) { errors.push('[no-bridge] ' + String(e)); });
  await page2.goto(URL);
  await page2.waitForFunction(function () { return window.Monetize && window.Game; });
  const noBridge = await page2.evaluate(function () {
    var n = 0;
    for (var i = 0; i < 50; i++) Monetize.requestMatch(function () { n++; });
    return { active: Monetize.active, n: n, line: Monetize.line(), needs: Monetize.needsUnlock() };
  });
  check('没有桥就不限局（H5 / 桌面照旧）',
    noBridge.active === false && noBridge.n === 50 && noBridge.line === '' && !noBridge.needs, JSON.stringify(noBridge));
  const menuHtml = await page2.evaluate(function () { UI.showMenu(); return document.querySelector('#overlay').innerHTML; });
  check('无桥时主菜单不出现额度行', menuHtml.indexOf('class="quota"') < 0);
  check('无桥时主菜单不出现解锁入口', menuHtml.indexOf('unlockBtn') < 0);
  await plain.close();

  await browser.close();

  check('全程无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));
  const bad = results.filter(function (r) { return !r.ok; });
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' 通过');
  if (bad.length) process.exitCode = 1;
}

main().catch(function (e) { console.error(e); process.exit(1); });
