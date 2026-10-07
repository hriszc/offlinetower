'use strict';
/**
 * 三端共用的网页资源清单 —— 唯一真源。
 *
 * iOS / H5 / 小工具发的是同一份代码（index.html + css + js + 图标），
 * 差别只在「怎么打包、装进什么壳」，所以清单只在这里写一次：
 * 新增或删除一个 js 文件时只改这一处，三端同时生效，不会漏。
 */

/** 三端共用的纯前端游戏与离线资源。 */
var CORE = [
  ['index.html', 'index.html'],
  ['css/style.css', 'css/style.css'],
  // i18n 必须排在 config.js 之前：它负责选语言、暴露 L()，
  // 后面的文件在加载期就要用 L() 取文案。
  ['js/i18n.js', 'js/i18n.js'],
  ['js/config.js', 'js/config.js'],
  ['js/sim.js', 'js/sim.js'],
  ['js/bots.js', 'js/bots.js'],
  ['js/audio.js', 'js/audio.js'],
  ['js/art_assets.js', 'js/art_assets.js'],
  ['js/render.js', 'js/render.js'],
  ['js/meta.js', 'js/meta.js'],
  ['js/monetize.js', 'js/monetize.js'],
  ['js/ui.js', 'js/ui.js'],
  ['js/main.js', 'js/main.js'],
  ['assets/ui-home-scene-v1.jpg', 'assets/ui-home-scene-v1.jpg'],
  // index.html 引用了这三个：favicon(32/192) + apple-touch-icon(180)。
  // 三个都要打包，少一个就是一次静默 404。
  ['assets/icon-32.png', 'assets/icon-32.png'],
  ['assets/icon-192.png', 'assets/icon-192.png'],
  ['assets/icon-180.png', 'assets/icon-180.png']
];

/** 合作联网能力只进入 H5 和 iOS；小工具保持无联网代码。 */
var COOP = [
  ['js/coop-sim.js', 'js/coop-sim.js'],
  ['js/coop.js', 'js/coop.js']
];

var EXTRA = {
  h5: COOP,
  minitool: [],
  ios: COOP
};

function forTarget(target) {
  if (!(target in EXTRA)) throw new Error('未知打包目标: ' + target);
  var extras = EXTRA[target], out = [];
  CORE.forEach(function (pair) {
    if (pair[1] === 'js/main.js') out = out.concat(extras);
    out.push(pair);
  });
  return out;
}

function decorateHtml(target, html) {
  var extras = EXTRA[target].filter(function (pair) { return /^js\//.test(pair[1]); });
  if (!extras.length) return html;
  var anchor = '<script src="./js/main.js"></script>';
  if (html.indexOf(anchor) < 0) throw new Error('index.html 缺少 main.js 脚本插入点');
  var scripts = extras.map(function (pair) {
    return '<script src="./' + pair[1] + '"></script>';
  }).join('\n');
  return html.replace(anchor, scripts + '\n' + anchor);
}

/** 清单里的 js 文件，按 index.html 应出现的顺序排列（自检用）。 */
function scriptOrder(target) {
  return forTarget(target)
    .map(function (pair) { return pair[1]; })
    .filter(function (p) { return /^js\//.test(p); });
}

module.exports = {
  CORE: CORE, COOP: COOP, EXTRA: EXTRA, forTarget: forTarget,
  scriptOrder: scriptOrder, decorateHtml: decorateHtml,
};
