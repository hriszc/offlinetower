#!/usr/bin/env node
/**
 * 把网页版游戏收口进 iOS 壳工程（零构建：只拷贝 + 图标转码）。
 *
 *   node tools/build_ios.js
 *
 * 做两件事，都不改游戏源码：
 *   1. index.html + css + js + 图标 → ios/Resources/web/（原样拷贝，结构不变）
 *   2. assets/icon-1024.png → AppIcon，并剥掉 alpha 通道
 *      App Store Connect 会拒收「含 alpha 通道」的图标，哪怕像素全不透明。
 *
 * 之后在 ios/ 下用 xcodegen 生成工程（本脚本会顺手跑一次）：
 *   cd ios && xcodegen generate && open ZombieKnock.xcodeproj
 */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var WEB = path.join(ROOT, 'ios/Resources/web');
var APPICON = path.join(ROOT, 'ios/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png');

// 合作脚本只进 iOS/H5；小工具仍取离线目标清单。
var manifest = require('./pack_manifest');
var FILES = manifest.forTarget('ios');

function copy(srcRel, destRel) {
  var from = path.join(ROOT, srcRel);
  var to = path.join(WEB, destRel);
  if (!fs.existsSync(from)) throw new Error('缺少源文件: ' + srcRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (destRel === 'index.html') {
    fs.writeFileSync(to, manifest.decorateHtml('ios', fs.readFileSync(from, 'utf8')));
  } else {
    fs.copyFileSync(from, to);
  }
  return fs.statSync(to).size;
}

/** PNG 的 IHDR 里，位深之后那一个字节就是 color type：2=RGB，6=RGBA。 */
function pngColorType(file) {
  var buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return -1;
  return buf[25];
}

/** 剥掉 alpha 通道。母版像素本身全不透明，这里只是把「通道」去掉。 */
function makeAppIcon() {
  var src = path.join(ROOT, 'assets/icon-1024.png');
  fs.mkdirSync(path.dirname(APPICON), { recursive: true });
  try {
    cp.execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-pix_fmt', 'rgb24', APPICON]);
  } catch (e) {
    throw new Error('转 AppIcon 需要 ffmpeg（仓库宣传片流程已依赖它），请确认 ffmpeg 在 PATH 上');
  }
  return fs.statSync(APPICON).size;
}

/** 自检：入口在根、脚本外置、无外部资源、引用齐全、顺序正确、图标无 alpha。 */
function selfCheck() {
  var html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  var problems = [];

  var refs = [];
  html.replace(/(?:src|href)="([^"]+)"/g, function (m, u) { refs.push(u); return m; });
  refs.forEach(function (u) {
    if (/^(?:https?:)?\/\//.test(u) || /^data:/.test(u)) { problems.push('外部资源: ' + u); return; }
    if (!fs.existsSync(path.join(WEB, u.replace(/^\.\//, '')))) problems.push('引用缺失: ' + u);
  });

  var scripts = [];
  html.replace(/<script src="([^"]+)"><\/script>/g, function (m, u) {
    scripts.push(u.replace(/^\.\//, ''));
    return m;
  });
  var expect = FILES.map(function (p) { return p[1]; }).filter(function (p) { return /^js\//.test(p); });
  if (scripts.join(',') !== expect.join(',')) problems.push('脚本顺序不符: ' + scripts.join(','));

  if (/<script(?![^>]*\ssrc=)/.test(html)) problems.push('存在内联脚本');
  if (/type="module"/.test(html)) problems.push('存在 module 脚本');

  var ct = pngColorType(APPICON);
  if (ct !== 2) problems.push('AppIcon 仍带 alpha 通道（color type=' + ct + '，应为 2）');

  return problems;
}

function main() {
  // web/ 是生成目录：先清空，避免上一轮的残留文件被打进 bundle
  fs.rmSync(WEB, { recursive: true, force: true });

  var total = 0;
  FILES.forEach(function (pair) { total += copy(pair[0], pair[1]); });
  var icon = makeAppIcon();

  console.log('网页资源: ios/Resources/web/  ' + FILES.length + ' 个文件, ' + (total / 1024).toFixed(1) + 'KiB');
  console.log('App 图标: ' + path.relative(ROOT, APPICON) + '  ' + (icon / 1024).toFixed(1) + 'KiB (RGB, 无 alpha)');

  var problems = selfCheck();
  if (problems.length) {
    problems.forEach(function (p) { console.error('  ✗ ' + p); });
    process.exitCode = 1;
    return;
  }
  console.log('自检通过: 入口在根 / 脚本外置 / 无外部资源 / 引用齐全 / 顺序正确 / 图标无 alpha');

  try {
    cp.execFileSync('xcodegen', ['generate'], { cwd: path.join(ROOT, 'ios'), stdio: 'inherit' });
    console.log('已生成 ios/ZombieKnock.xcodeproj');
  } catch (e) {
    console.log('未生成 Xcode 工程（PATH 上找不到 xcodegen）。手动执行: cd ios && xcodegen generate');
  }
}

main();
