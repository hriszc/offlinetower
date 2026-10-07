'use strict';

/* ---------------------------------------------------------------
 * 文案与本地化运行时
 *
 * 唯一真源：js/config.js 的 TEXT 表（zh 原文 / en 译文同表并排）。
 * 本文件只负责「选哪张表 + 查表 + 取字串」，不含任何具体文案。
 *
 * 三端同源：本文件走 tools/pack_manifest.js 的 CORE 清单，三端产物仍逐字节相同。
 * 语言靠 navigator.language 自动判定，不写死平台常量 —— 壳里不注入任何东西。
 * ------------------------------------------------------------- */

var I18N = {
  /* 'zh' | 'en'，由 detect() 填充。 */
  lang: 'zh',

  /* 判定依据：浏览器/宿主给的系统语言。zh 开头（含 zh-Hans / zh-Hant / zh-CN）
     走中文，其它一律走英文 —— 英文是发行主语言，兜底给它。 */
  detect: function (rawLang) {
    var l = String(rawLang || '').toLowerCase();
    if (l.indexOf('zh') === 0) return 'zh';
    return 'en';
  },

  init: function () {
    var raw = '';
    try {
      if (typeof navigator !== 'undefined' && navigator.language) raw = navigator.language;
      else if (typeof navigator !== 'undefined' && navigator.languages && navigator.languages[0]) {
        raw = navigator.languages[0];
      }
    } catch (e) { /* 无 navigator（Node 无头测试）时走兜底 */ }
    this.lang = this.detect(raw);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('lang', this.lang === 'zh' ? 'zh-Hans' : 'en');
    }
    return this.lang;
  },

  /* index.html 里静态写着的中文（按钮标题、HUD 标签）在启动时统一替换。
     这些字串没法走 L()，因为它们是直接写在标签里的；用 data-i18n 标出来，
     由这里按 TEXT[lang] 覆写。找不到键就保留原文，不会出现空白。 */
  applyStatic: function (root) {
    if (typeof document === 'undefined') return;
    var host = root || document;
    var nodes = host.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n');
      var val = L(key, null, null);
      if (val != null && val !== key) el.textContent = val;
    }
    /* <title> 要单独处理：它不在 document.body 下，querySelectorAll 也能选到，
       但 textContent 赋值在部分内核上不刷新标签，所以显式再写一次。 */
    var t = host.querySelector('title[data-i18n]');
    if (t) {
      var tv = L(t.getAttribute('data-i18n'), null, null);
      if (tv != null && tv !== t.getAttribute('data-i18n')) {
        t.textContent = tv;
        if (typeof document !== 'undefined') document.title = tv;
      }
    }
  },
};

/* 查表。key 是 TEXT 里的点分路径（如 'unit.barricade.name'）。
   找不到就返回 fallback，再找不到返回 key 本身 —— 宁可露出键名也不要静默空白。
   vars 用来做 {n} 这种占位替换，避免中文语序写死在拼接里。 */
function L(key, vars, fallback) {
  var table = (typeof TEXT !== 'undefined' && TEXT[I18N.lang]) || null;
  var cur = table;
  if (cur) {
    var parts = String(key).split('.');
    for (var i = 0; i < parts.length && cur != null; i++) cur = cur[parts[i]];
  }
  if (cur == null) cur = fallback;
  if (cur == null) return key;
  cur = String(cur);
  if (vars) {
    cur = cur.replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] != null ? String(vars[k]) : m;
    });
  }
  return cur;
}

I18N.init();

/* 静态文案不在这里替换：本文件排在 config.js 之前，此刻 TEXT 还没定义，
   调用 applyStatic() 会静默取不到任何键（L() 返回 null）。
   改由最后加载的 ui.js 在启动时调用 —— 见 js/ui.js 末尾。 */
