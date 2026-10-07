#!/usr/bin/env node
/**
 * 一条命令出全部三端：iOS 壳资源 + H5 包 + 小工具包。
 *
 *   node tools/build_all.js
 *
 * 单人核心资源三端逐字节相同；合作网络脚本只在 H5/iOS，离线小工具必须没有。
 */
'use strict';
var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var manifest = require('./pack_manifest');

function run(script) {
  cp.execFileSync('node', [path.join(__dirname, script)], { cwd: ROOT, stdio: 'inherit' });
}

function shas(file) {
  return cp.execFileSync('shasum', ['-a', '256', file], { encoding: 'utf8' }).split(/\s+/)[0];
}

/** 核心资源三端相同，合作资源只在允许的目标中出现。 */
function verify() {
  var dirs = {
    h5: path.join(ROOT, 'output/h5'),
    minitool: path.join(ROOT, 'output/xhs-minitool/unpacked'),
    ios: path.join(ROOT, 'ios/Resources/web')
  };
  var bad = 0;
  manifest.CORE.forEach(function (pair) {
    var rel = pair[1];
    if (rel === 'index.html') {
      var original = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      var h5Html = fs.readFileSync(path.join(dirs.h5, rel), 'utf8');
      var iosHtml = fs.readFileSync(path.join(dirs.ios, rel), 'utf8');
      var miniHtml = fs.readFileSync(path.join(dirs.minitool, rel), 'utf8');
      var cleanH5 = h5Html;
      manifest.COOP.forEach(function (coopPair) {
        cleanH5 = cleanH5.replace('<script src="./' + coopPair[1] + '"></script>\n', '');
      });
      if (h5Html !== iosHtml || miniHtml !== original || cleanH5 !== original) {
        bad++;
        console.error('  ✗ index.html 入口 HTML 与合作脚本注入边界不符');
      }
      return;
    }
    var sums = Object.keys(dirs).map(function (k) {
      var file = path.join(dirs[k], rel);
      return fs.existsSync(file) ? shas(file) : 'MISSING';
    });
    if (!sums.every(function (s) { return s === sums[0]; })) {
      bad++;
      console.error('  ✗ ' + rel + ' 三端不一致: ' + sums.join(' / '));
    }
  });
  if (bad) {
    console.error('三端一致性校验失败：' + bad + ' 个文件不同');
    process.exitCode = 1;
    return;
  }
  var coopBad = 0;
  manifest.COOP.forEach(function (pair) {
    var h5 = path.join(dirs.h5, pair[1]);
    var ios = path.join(dirs.ios, pair[1]);
    var mini = path.join(dirs.minitool, pair[1]);
    if (!fs.existsSync(h5) || !fs.existsSync(ios) || fs.existsSync(mini)) {
      coopBad++;
      console.error('  ✗ ' + pair[1] + ' 应只存在于 H5/iOS');
    } else if (shas(h5) !== shas(ios)) {
      coopBad++;
      console.error('  ✗ ' + pair[1] + ' H5 与 iOS 不一致');
    }
  });
  ['h5', 'ios'].forEach(function (target) {
    var html = fs.readFileSync(path.join(dirs[target], 'index.html'), 'utf8');
    if (manifest.COOP.some(function (pair) { return html.indexOf('./' + pair[1]) < 0; })) {
      coopBad++;
      console.error('  ✗ ' + target + ' 入口缺少合作脚本');
    }
  });
  var miniHtml = fs.readFileSync(path.join(dirs.minitool, 'index.html'), 'utf8');
  if (manifest.COOP.some(function (pair) { return miniHtml.indexOf('./' + pair[1]) >= 0; })) {
    coopBad++;
    console.error('  ✗ 小工具入口引用了合作脚本');
  }
  manifest.forTarget('minitool').filter(function (pair) { return /^js\//.test(pair[1]); })
    .forEach(function (pair) {
      var src = fs.readFileSync(path.join(dirs.minitool, pair[1]), 'utf8');
      if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//.test(src)) {
        coopBad++;
        console.error('  ✗ 小工具含联网代码: ' + pair[1]);
      }
    });
  if (coopBad) {
    console.error('合作模式打包边界校验失败：' + coopBad + ' 项');
    process.exitCode = 1;
    return;
  }
  console.log('三端核心一致: ' + manifest.CORE.length + ' 个文件逐字节相同');
  console.log('合作模式边界: H5/iOS 包含合作脚本，小工具不含联网代码');
}

console.log('== iOS ==');
run('build_ios.js');
console.log();
console.log('== H5 / 小工具 ==');
run('build_h5.js');
console.log();
console.log('== 一致性校验 ==');
verify();
