'use strict';

/* 从正式插画母图导出多尺寸应用图标 PNG。
 * 用法：node tools/make_icon.js
 * 母图 assets/icon-source-v2.png；ffmpeg Lanczos缩放，全尺寸RGB无alpha。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'assets', 'icon-source-v2.png');
const OUT = path.join(ROOT, 'assets');
const SIZES = [1024, 512, 192, 180, 32];

(() => {
  if (!fs.existsSync(SOURCE)) throw new Error('Missing icon source: ' + SOURCE);
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SIZES) {
    const file = path.join(OUT, 'icon-' + s + '.png');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', SOURCE,
      '-vf', 'scale=' + s + ':' + s + ':flags=lanczos', '-pix_fmt', 'rgb24',
      '-frames:v', '1', '-update', '1', file]);
    console.log('wrote', path.relative(ROOT, file));
  }

})();
