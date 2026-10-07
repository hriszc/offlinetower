#!/usr/bin/env node
/**
 * 产出联网版 H5 与保持离线的小工具包。
 *
 *   node tools/build_h5.js --tool h5         → output/h5/ + output/h5/isang-h5.zip
 *   node tools/build_h5.js --tool minitool  → output/xhs-minitool/night-watch-xhs-minitool.zip
 *   不带 --tool 时两个都出。
 *
 * 合作网络脚本只进入 H5；小工具按独立清单打包，不包含网络 API。
 * 纯静态、零构建、脚本外置。
 * 规范见《minitool-zip-builder》：index.html 必须在 zip 根目录，脚本为经典外链，
 * 不用 type="module"、不用内联脚本、不引用任何外部资源。
 */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.join(ROOT, 'output/h5');
var TOOLS = { h5: 'h5', minitool: 'minitool' };
var manifest = require('./pack_manifest');
var FILES_H5 = manifest.forTarget('h5');
var FILES_TOOL = manifest.forTarget('minitool');

var argv = process.argv.slice(2);
var which = [];
for (var i = 0; i < argv.length; i++) {
  if (argv[i] === '--out' && argv[i + 1]) OUT = path.resolve(argv[i + 1]);
  else if (argv[i] === '--tool' && argv[i + 1]) which = [argv[++i]];
}
if (!which.length) which = ['h5', 'minitool'];
which.forEach(function (w) { if (!TOOLS[w]) throw new Error('未知 --tool: ' + w); });

/** 打 zip：压缩目录内容（index.html 落 zip 根），排除上一轮的产物与校验文件。 */
function zipDir(dir, zipPath, exclude, files) {
  // Versioned artwork can leave older files in the preview directory.
  // Publish only the current manifest so obsolete assets never enter the ZIP.
  var args = ['-rq', zipPath].concat(files || ['.']);
  args.push('-x', '*.DS_Store');
  (exclude || []).forEach(function (n) { args.push('-x', n); });
  args.push('-x', path.basename(zipPath));
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  cp.execFileSync('zip', args, { cwd: dir });
  return fs.statSync(zipPath).size;
}

function audit(target) {
  var script = '/Users/zhaochen/Downloads/2609/mypets/.skill/minitool-zip-builder/scripts/audit_artifact.mjs';
  if (!fs.existsSync(script)) return null;
  return cp.execFileSync('node', [script, target], { encoding: 'utf8' }).trim();
}

function copyInto(dir, srcRel, destRel, target) {
  var from = path.join(ROOT, srcRel);
  var to = path.join(dir, destRel);
  if (!fs.existsSync(from)) throw new Error('缺少源文件: ' + srcRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (destRel === 'index.html') {
    fs.writeFileSync(to, manifest.decorateHtml(target, fs.readFileSync(from, 'utf8')));
  } else {
    fs.copyFileSync(from, to);
  }
  return fs.statSync(to).size;
}

function checkDir(dir, files, target) {
  var html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  var problems = [];
  if (/<script(?![^>]*\ssrc=)/.test(html)) problems.push('存在内联 <script>');
  if (/type=["']module["']/.test(html)) problems.push('存在 type="module"');
  if (/(src|href)=["']https?:/.test(html)) problems.push('存在外部资源引用');
  if (/(src|href)=["']\//.test(html)) problems.push('存在绝对路径引用');
  var srcs = html.match(/src=["']\.\/([^"']+)["']/g) || [];
  srcs.forEach(function (m) {
    var rel = m.replace(/^src=["']\.\//, '').replace(/["']$/, '');
    if (!fs.existsSync(path.join(dir, rel))) problems.push('引用了未打包的文件: ' + rel);
  });
  var hrefs = html.match(/href=["']\.\/([^"']+)["']/g) || [];
  hrefs.forEach(function (m) {
    var rel = m.replace(/^href=["']\.\//, '').replace(/["']$/, '');
    if (!fs.existsSync(path.join(dir, rel))) problems.push('引用了未打包的文件: ' + rel);
  });
  var order = srcs.map(function (m) { return m.replace(/^src=["']\.\//, '').replace(/["']$/, ''); })
    .filter(function (p) { return /\.js$/.test(p); });
  var expect = files.map(function (p) { return p[1]; }).filter(function (p) { return /^js\//.test(p); });
  if (String(order) !== String(expect)) problems.push('脚本顺序与清单不符');
  if (target === 'minitool') {
    var scripts = files.filter(function (p) { return /^js\//.test(p[1]); });
    scripts.forEach(function (pair) {
      var body = fs.readFileSync(path.join(dir, pair[1]), 'utf8');
      if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//.test(body)) {
        problems.push('小工具联网代码检查失败: ' + pair[1]);
      }
    });
  }
  if (problems.length) {
    problems.forEach(function (p) { console.error('✗ ' + p); });
    throw new Error(target + ' 自检失败');
  }
  console.log('✓ ' + target + ' 自检通过：脚本顺序、资源引用' +
    (target === 'minitool' ? '、无联网 API' : ''));
}

function buildH5Files() {
  var total = 0;
  FILES_H5.forEach(function (pair) { total += copyInto(OUT, pair[0], pair[1], 'h5'); });
  console.log('输出目录: ' + path.relative(ROOT, OUT));
  console.log('文件数: ' + FILES_H5.length + '  合计: ' + (total / 1024).toFixed(1) + 'KiB');
  var stale = path.join(OUT, 'isang-h5.sha256');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
  checkDir(OUT, FILES_H5, 'h5');
}

/* ---------------- 两种交付：同一份代码，只是打包方式不同 ---------------- */

/** H5：目录常驻 + 校验文件，便于本地起服务预览与分发。 */
function emitH5() {
  var dir = OUT;
  var zipPath = path.join(dir, 'isang-h5.zip');
  var bytes = zipDir(dir, zipPath, ['isang-h5.sha256'], FILES_H5.map(function (pair) { return pair[1]; }));
  var sum = cp.execFileSync('shasum', ['-a', '256', zipPath], { encoding: 'utf8' })
    .trim().split(/\s+/)[0];
  fs.writeFileSync(path.join(dir, 'isang-h5.sha256'), sum + '  isang-h5.zip\n');
  console.log('H5      : ' + path.relative(ROOT, zipPath) + '  ' + (bytes / 1024).toFixed(1) + 'KiB');
  var a = audit(zipPath);
  if (a) console.log('          审计 ' + a);
}

/** 小工具：只有 zip（目录严格按容器规范，index.html 在根）。 */
function emitMinitool() {
  var zipPath = path.join(ROOT, 'output/xhs-minitool/night-watch-xhs-minitool.zip');
  var stage = path.join(ROOT, 'output/xhs-minitool/staging');
  fs.rmSync(stage, { recursive: true, force: true });
  var total = 0;
  FILES_TOOL.forEach(function (pair) { total += copyInto(stage, pair[0], pair[1], 'minitool'); });
  console.log('小工具暂存: ' + FILES_TOOL.length + ' 个文件  ' + (total / 1024).toFixed(1) + 'KiB');
  checkDir(stage, FILES_TOOL, 'minitool');
  var bytes = zipDir(stage, zipPath, [], FILES_TOOL.map(function (pair) { return pair[1]; }));
  var sum = cp.execFileSync('shasum', ['-a', '256', zipPath], { encoding: 'utf8' })
    .trim().split(/\s+/)[0];
  fs.writeFileSync(zipPath.replace(/\.zip$/, '.sha256'),
    sum + '  night-watch-xhs-minitool.zip\n');
  console.log('小工具  : ' + path.relative(ROOT, zipPath) + '  ' + (bytes / 1024).toFixed(1) + 'KiB');
  // 解包目录只作审计用：先清空，避免上一轮的 h5 产物残留进来（会让审计数出多余文件）
  var unpacked = path.join(ROOT, 'output/xhs-minitool/unpacked');
  fs.rmSync(unpacked, { recursive: true, force: true });
  cp.execFileSync('unzip', ['-q', '-o', zipPath, '-d', unpacked], { stdio: 'ignore' });
  checkDir(unpacked, FILES_TOOL, 'minitool');
  var a = audit(unpacked);
  if (a) console.log('          审计 ' + a);
}

if (which.indexOf('h5') >= 0) {
  buildH5Files();
  emitH5();
}
if (which.indexOf('minitool') >= 0) emitMinitool();
