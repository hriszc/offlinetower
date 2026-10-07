'use strict';

/* 30 秒竖屏合作模式宣传片。战斗画面取自实际合作模拟固定 dt 母带；
 * 合作房间与备战截图由 capture_coop_promo.js 本地模拟房间响应取得。 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { render: renderAudio } = require('./promo_audio');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/promo');
const ASSETS = path.join(OUT, 'coop-30-assets');
const FFMPEG = '/Users/zhaochen/.local/bin/ffmpeg';
const FONT = '/System/Library/Fonts/STHeiti Medium.ttc';
const HIGH = process.argv.includes('--high');
const W = HIGH ? 1080 : 540;
const H = HIGH ? 1920 : 960;
const S = W / 1080;
const FPS = 25;
const ART = path.join(ASSETS, 'cover-background.png');
const RAW = {
  duo: path.join(ASSETS, 'battle-2-fixed.mp4'),
  trio: path.join(ASSETS, 'battle-3-fixed.mp4'),
};
const TMP = path.join(ASSETS, HIGH ? 'tmp-high' : 'tmp-low');
const FINAL = path.join(OUT, HIGH ? '老皮打僵尸_合作守夜_30s_1080x1920.mp4'
  : 'preview-老皮打僵尸_合作守夜_30s.mp4');

const shots = [
  { kind: 'art', dur: 2, big: '只来了两个人', sub: '门外，已经挤满了僵尸' },
  { kind: 'room', dur: 2, big: '房主：开局！', sub: '两人就能合作守夜' },
  { kind: 'build', size: 2, dur: 2, big: '你守 1–3 路', sub: '队友守 4–6 路' },
  { kind: 'game', scene: 'duo', start: 0, x: 800, dur: 4, big: '双人，共守六路', sub: '裂隙一开，谁都别掉线' },
  { kind: 'game', scene: 'duo', start: 4, x: 380, dur: 3, big: '挡住这一波', sub: '弩炮、火焰、电弧同时开火' },
  { kind: 'art', dur: 2, big: '第三个人来了', sub: '尸潮也更凶了' },
  { kind: 'build', size: 3, dur: 2, big: '九路全部点亮', sub: '每人三路，全队准备' },
  { kind: 'game', scene: 'trio', start: 0, x: 780, dur: 4, big: '三人同场', sub: '九路同时开战' },
  { kind: 'game', scene: 'trio', start: 4, x: 310, dur: 4, big: '把后背交给队友', sub: '守住自己的三路，也守住彼此' },
  { kind: 'art', dur: 5, big: '第 7–9 路交给谁？', sub: '评论区点名你的守夜搭子', end: true },
];

function run(args) {
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args],
    { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
}

function textFile(name, value) {
  const file = path.join(TMP, name + '.txt');
  fs.writeFileSync(file, value, 'utf8');
  return file;
}

function draw(file, size, y, color) {
  return `drawtext=fontfile='${FONT}':textfile='${file}':fontsize=${Math.round(size * S)}` +
    `:fontcolor=${color}:x=(w-text_w)/2:y=${Math.round(y * S)}` +
    `:borderw=${Math.max(1, Math.round(3 * S))}:bordercolor=0x07090B@0.95` +
    `:shadowx=${Math.round(3 * S)}:shadowy=${Math.round(5 * S)}:shadowcolor=black@0.9`;
}

function caps(s, i) {
  const big = textFile(`title-${i}`, s.big);
  const sub = textFile(`sub-${i}`, s.sub);
  const brand = textFile('brand', '老皮打僵尸');
  const chain = [
    `drawbox=x=0:y=0:w=iw:h=${Math.round(460 * S)}:color=0x05070B@0.42:t=fill`,
    `drawbox=x=0:y=${Math.round(1510 * S)}:w=iw:h=${Math.round(410 * S)}:color=0x05070B@0.45:t=fill`,
    draw(brand, 38, 90, '0xE7C587'),
    draw(big, s.end ? 79 : 94, 245, '0xFFF0D8'),
    `drawbox=x=${Math.round(255 * S)}:y=${Math.round(385 * S)}:w=${Math.round(570 * S)}:h=${Math.max(2, Math.round(5 * S))}:color=0xD12C24@0.9:t=fill`,
    draw(sub, 55, 1640, '0xF8D78D'),
  ];
  if (s.end) {
    const tag = textFile('end-tag', '《老皮打僵尸》 · 2–6 人合作守夜');
    chain.push(draw(tag, 46, 1760, '0xEDE5D8'));
  }
  return chain.join(',');
}

function encode(i, s) {
  const dest = path.join(TMP, `s${String(i).padStart(2, '0')}.mp4`);
  const common = ['-frames:v', String(s.dur * FPS), '-r', String(FPS),
    '-an', '-c:v', 'libx264', '-preset', HIGH ? 'veryfast' : 'ultrafast',
    '-crf', HIGH ? '20' : '29', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', dest];
  const cap = caps(s, i);
  if (s.kind === 'game') {
    const vf = `fps=${FPS},crop=810:1440:${s.x}:0,scale=${W}:${H}:flags=lanczos,` +
      'eq=contrast=1.13:brightness=-0.035:saturation=0.9,' + cap +
      ',fade=t=in:st=0:d=0.08,setsar=1';
    run(['-ss', String(s.start), '-i', RAW[s.scene], '-vf', vf, ...common]);
  } else if (s.kind === 'art') {
    const vf = `scale=${W}:${H}:flags=lanczos,` + cap +
      `,zoompan=z='min(zoom+0.0008,1.08)':d=1:s=${W}x${H}:fps=${FPS},setsar=1`;
    run(['-loop', '1', '-framerate', String(FPS), '-i', ART, '-vf', vf, ...common]);
  } else {
    const bg = `[0:v]scale=${W}:${H}:flags=lanczos,boxblur=12:2,` +
      'eq=brightness=-0.11:saturation=0.65[bg]';
    let inputs, fg;
    if (s.kind === 'room') {
      inputs = [path.join(ASSETS, 'room-2.png')];
      fg = `[1:v]scale=${Math.round(990 * S)}:-2:flags=lanczos,` +
        `pad=${Math.round(1014 * S)}:ih+${Math.round(24 * S)}:${Math.round(12 * S)}:${Math.round(12 * S)}:0xD0A34B@0.85[panel];` +
        `[bg][panel]overlay=(W-w)/2:${Math.round(600 * S)}[base]`;
    } else {
      inputs = [path.join(ASSETS, `build-${s.size}.png`), path.join(ASSETS, `hud-${s.size}.png`)];
      fg = `[1:v]scale=${Math.round(1000 * S)}:-2:flags=lanczos[game];` +
        `[2:v]scale=${Math.round(880 * S)}:-2:flags=lanczos[hud];` +
        `[bg][game]overlay=(W-w)/2:${Math.round(590 * S)}[layer];` +
        `[layer][hud]overlay=(W-w)/2:${Math.round(1260 * S)}[base]`;
    }
    const graph = bg + ';' + fg + ';[base]' + cap +
      `,zoompan=z='min(zoom+0.0007,1.07)':d=1:s=${W}x${H}:fps=${FPS},setsar=1[v]`;
    const imageInputs = ['-loop', '1', '-framerate', String(FPS), '-i', ART];
    for (const file of inputs) imageInputs.push('-loop', '1', '-framerate', String(FPS), '-i', file);
    run([...imageInputs, '-filter_complex', graph, '-map', '[v]', ...common]);
  }
  console.log(`SHOT ${i + 1}/${shots.length} ${s.kind} ${s.dur}s`);
  return dest;
}

function cover() {
  const line1 = textFile('cover-line-1', '只来了两个人');
  const line2 = textFile('cover-line-2', '敢开局吗？');
  const tag = textFile('cover-tag', '2–6 人合作守夜');
  const brand = textFile('cover-brand', '《老皮打僵尸》');
  const vf = [
    'scale=1080:1920:flags=lanczos',
    'drawbox=x=0:y=0:w=iw:h=600:color=0x030408@0.35:t=fill',
    draw(line1, 107, 145, '0xFFF1D6').replace(/fontsize=\d+/, 'fontsize=107').replace(/y=\d+/, 'y=145'),
    draw(line2, 148, 287, '0xF7C66C').replace(/fontsize=\d+/, 'fontsize=148').replace(/y=\d+/, 'y=287'),
    'drawbox=x=210:y=500:w=660:h=7:color=0xD52B22@0.95:t=fill',
    draw(tag, 58, 530, '0xF2D6A0').replace(/fontsize=\d+/, 'fontsize=58').replace(/y=\d+/, 'y=530'),
    'drawbox=x=0:y=1730:w=iw:h=190:color=0x040608@0.72:t=fill',
    draw(brand, 69, 1780, '0xF5E6CD').replace(/fontsize=\d+/, 'fontsize=69').replace(/y=\d+/, 'y=1780'),
  ].join(',');
  const dest = path.join(OUT, '老皮打僵尸_合作守夜_竖屏封面_1080x1920.jpg');
  run(['-i', ART, '-vf', vf, '-frames:v', '1', '-q:v', '2', dest]);
  console.log(`COVER ${dest}`);
}

function audio() {
  const dest = path.join(TMP, 'soundtrack.wav');
  renderAudio({
    dur: 30, droneAmp: 0.32, droneBase: 42,
    heartbeat: { t0: 0.2, t1: 26, bpm0: 62, bpm1: 130, amp: 0.44 },
    events: [
      { type: 'impact', t: 0, amp: 1 },
      { type: 'impact', t: 2, amp: 0.72 },
      { type: 'impact', t: 4, amp: 0.78 },
      { type: 'riser', t: 5, t1: 6, amp: 0.44 },
      { type: 'impact', t: 6, amp: 1.05 },
      { type: 'impact', t: 10, amp: 1.1 },
      { type: 'stinger', t: 12.4, amp: 0.5 },
      { type: 'swell', t: 12, t1: 13, amp: 0.45 },
      { type: 'impact', t: 13, amp: 0.9 },
      { type: 'impact', t: 15, amp: 0.95 },
      { type: 'riser', t: 16, t1: 17, amp: 0.52 },
      { type: 'impact', t: 17, amp: 1.15 },
      { type: 'impact', t: 21, amp: 1.1 },
      { type: 'stinger', t: 24.8, amp: 0.6 },
      { type: 'impact', t: 25, amp: 1.2 },
      { type: 'thump', t: 28, f0: 100, f1: 32, tau: 0.8, amp: 0.5 },
    ],
  }, dest);
  return dest;
}

function main() {
  fs.mkdirSync(TMP, { recursive: true });
  for (const file of [ART, RAW.duo, RAW.trio, path.join(ASSETS, 'room-2.png'),
    path.join(ASSETS, 'build-2.png'), path.join(ASSETS, 'build-3.png'),
    path.join(ASSETS, 'hud-2.png'), path.join(ASSETS, 'hud-3.png')]) {
    if (!fs.existsSync(file)) throw new Error('缺少素材: ' + file);
  }
  if (shots.reduce((sum, s) => sum + s.dur, 0) !== 30) throw new Error('镜头必须恰好 30 秒');
  if (HIGH) cover();
  const clips = shots.map((s, i) => encode(i, s));
  const list = path.join(TMP, 'concat.txt');
  fs.writeFileSync(list, clips.map((file) => `file '${file}'`).join('\n') + '\n');
  const silent = path.join(TMP, 'silent.mp4');
  run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
  run(['-i', silent, '-i', audio(), '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', HIGH ? '160k' : '96k',
    '-ar', '48000', '-ac', '2', '-t', '30', '-movflags', '+faststart', FINAL]);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`VIDEO ${FINAL}`);
}

main();
