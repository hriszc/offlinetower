'use strict';
/* 双语界面验证：同一份产物分别用 en-US / zh-CN 打开，抓主菜单上的实际文本，
   确认英文真的上屏、中文没被改动、且切语言时画布字体栈跟着切。
   截图降到 1/2 分辨率再存，避免把 1MB+ 的 PNG 反复塞进上下文。 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PW_ROOT || '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'output/playwright');

async function probe(browser, locale) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
    };
    return {
      lang: document.documentElement.getAttribute('lang'),
      i18nLang: typeof I18N !== 'undefined' ? I18N.lang : null,
      bodyFont: getComputedStyle(document.body).fontFamily,
      menuTitle: pick('#menuTitle') || pick('.menuTitle') || pick('h1'),
      buttons: Array.from(document.querySelectorAll('button'))
        .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean).slice(0, 12),
      canvasFont: (() => {
        try { return Render.fontStack(); } catch (e) { return 'ERR:' + e.message; }
      })(),
      /* 单位详情面板的数值后缀（unitCombatText）—— 曾经漏译过一整片 */
      combat: (() => {
        try {
          return { turret: unitCombatText('turret', 1), frost: unitCombatText('frost', 1) };
        } catch (e) { return 'ERR:' + e.message; }
      })(),
    };
  });
  await page.screenshot({ path: path.join(OUT, 'i18n-' + locale + '.png') });
  await ctx.close();
  return { info, errors };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const en = await probe(browser, 'en-US');
  const zh = await probe(browser, 'zh-CN');
  await browser.close();

  const show = (tag, r) => {
    console.log('== ' + tag + ' ==');
    console.log('  html lang : ' + r.info.lang);
    console.log('  I18N.lang : ' + r.info.i18nLang);
    console.log('  画布字体  : ' + r.info.canvasFont);
    console.log('  body 字体 : ' + r.info.bodyFont);
    console.log('  标题      : ' + r.info.menuTitle);
    console.log('  按钮      : ' + JSON.stringify(r.info.buttons, null, 0));
    console.log('  单位面板  : ' + JSON.stringify(r.info.combat, null, 0));
    console.log('  JS 报错   : ' + (r.errors.length ? r.errors.join(' | ') : '无'));
    console.log();
  };
  show('en-US', en);
  show('zh-CN', zh);

  const checks = [];
  const ok = (name, cond) => checks.push([name, !!cond]);

  ok('英文：I18N.lang = en', en.info.i18nLang === 'en');
  ok('英文：html lang = en', en.info.lang === 'en');
  ok('英文：画布走拉丁字体栈', /Helvetica|Arial/.test(en.info.canvasFont));
  ok('英文：body 走拉丁字体栈', /Helvetica|Arial/.test(en.info.bodyFont));
  ok('英文：界面出现英文（无汉字）',
    !/[\u4e00-\u9fa5]/.test((en.info.menuTitle || '') + en.info.buttons.join('')));

  ok('中文：I18N.lang = zh', zh.info.i18nLang === 'zh');
  ok('中文：html lang = zh-Hans', zh.info.lang === 'zh-Hans');
  ok('中文：画布保持中文字体栈', /PingFang|Heiti/.test(zh.info.canvasFont));
  ok('中文：界面仍有汉字', /[\u4e00-\u9fa5]/.test((zh.info.menuTitle || '') + zh.info.buttons.join('')));

  ok('两种语言都无 JS 报错', en.errors.length === 0 && zh.errors.length === 0);

  ok('英文：单位面板无汉字',
    !/[\u4e00-\u9fa5]/.test(JSON.stringify(en.info.combat)));
  ok('中文：单位面板保留中文与「格」',
    /半径|射程/.test(zh.info.combat.turret) && /格/.test(zh.info.combat.turret));

  console.log('===== 结果 =====');
  let bad = 0;
  checks.forEach(([n, c]) => { if (!c) bad++; console.log((c ? '  ✓ ' : '  ✗ ') + n); });
  console.log('\n' + (checks.length - bad) + '/' + checks.length + ' 通过');
  process.exit(bad ? 1 : 0);
})();
