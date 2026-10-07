'use strict';

/* 由“母带”帧序列合成 15s 竖版宣传片。
 * 竖版画面 = 在 2560x1440 设计坐标里选一块 9:16 区域放大，逐镜推近/摇移/震动，
 * 再叠加恐怖调色、闪白/闪红、大字幕与合成音效。
 *
 * 用法：
 *   node tools/build_promos.js --scale low                      # 代理预览（540x960，快）
 *   node tools/build_promos.js --scale high                     # 终版（1080x1920，母带 2560x1440）
 *   node tools/build_promos.js --scale high --master 1280       # 用 720p 母带出片（画质差，仅验证用）
 *   node tools/build_promos.js --scale low --only 1
 *   node tools/build_promos.js --sheet --only 1                 # 只出锁定用的 contact sheet
 *
 * 分辨率与档位解耦：母带尺寸由 --master 决定，出片尺寸由 --scale 决定，两者互不影响。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { render: renderAudio } = require('./promo_audio.js');

const ROOT = path.resolve(__dirname, '..');
const FFMPEG = '/Users/zhaochen/.local/bin/ffmpeg';
const FONT = '/System/Library/Fonts/STHeiti Medium.ttc';
const OUTDIR = path.join(ROOT, 'output', 'promo');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const SCALE = arg('scale', 'low');
const ONLY = arg('only', null);
const SHEET = process.argv.includes('--sheet');
const HIGH = SCALE === 'high';

const MASTER_W = Number(arg('master', 2560));   // 母带宽度，独立于 --scale
const MASTER_H = MASTER_W * 9 / 16;
const K = MASTER_W / 2560;              // 设计坐标 -> 母带像素
const OUT_W = HIGH ? 1080 : 540;
const OUT_H = HIGH ? 1920 : 960;
const S = OUT_W / 1080;                 // 字号缩放
const SHEET_DIR = path.join(OUTDIR, 'sheets');

/* 母带来源：优先用固定 dt 录屏的 mp4，回退到旧的 JPEG 序列 */
function masterInput(sc) {
  const mp4 = path.join(OUTDIR, 'raw-fixed', sc, sc + '.mp4');
  if (fs.existsSync(mp4)) return { args: ['-i', mp4], src: 'mp4', fps: null };
  const seq = path.join(OUTDIR, 'master', sc, 'f%04d.jpg');
  return { args: ['-framerate', String(FPS), '-i', seq], src: 'jpg', fps: FPS };
}

function requireMaster(scenes) {
  for (const sc of scenes) {
    const m = masterInput(sc);
    const p = m.args[1];
    if (!fs.existsSync(p) && m.src === 'mp4') continue;
    if (m.src === 'mp4') continue;
    if (!fs.existsSync(path.join(OUTDIR, 'master', sc, 'f0000.jpg'))) {
      throw new Error(`场景 ${sc} 没有母带：${p}\n请先跑 node tools/record_fixed.js ${sc} --w 2560 --h 1440`);
    }
  }
}
const FPS = 25;
const DUR = 15;

const SHOT_STYLE = {
  eq: 'eq=contrast=1.20:brightness=-0.055:saturation=0.70',
  chill: 'colorbalance=rs=-0.06:gs=-0.02:bs=0.07',
  mix: 'colorchannelmixer=rr=1.07:gg=0.95:bb=0.93',
  sharp: 'unsharp=5:5:0.6:5:5:0.0',
  vig: 'vignette=PI/4.0',
  grain: 'noise=alls=9:allf=t+u',
};

/* ---------- 镜头 ---------- */
/* h: 设计空间裁切高度(1440=满高)  cx,cy: 起始中心  cx2,cy2: 结束中心
   zoom: [起,止] 额外推近  punch: 切镜瞬间的爆发推近  shake: 震动强度(设计像素) */
const VIDEOS = [
  {
    id: '01',
    name: '别回头看身后',
    shots: [
      { scene: 'c', start: 0.60, dur: 2.10, h: 980, cx: 470, cy: 700, cx2: 520, cy2: 690, zoom: [1.02, 1.10], punch: 0.20, shake: 20, shakes: [0, 1.2] },
      { scene: 'b', start: 3.20, dur: 1.80, h: 1120, cx: 1280, cy: 640, cx2: 1240, cy2: 610, zoom: [1.04, 1.14], punch: 0.16, shake: 16, shakes: [0] },
      { scene: 'd', start: 4.55, dur: 1.60, h: 900, cx: 700, cy: 760, cx2: 780, cy2: 700, zoom: [1.02, 1.12], punch: 0.14, shake: 26, shakes: [0.45] },
      { scene: 'c', start: 7.60, dur: 1.70, h: 820, cx: 430, cy: 690, cx2: 400, cy2: 660, zoom: [1.06, 1.18], punch: 0.22, shake: 22, shakes: [0, 1.0] },
      { scene: 'b', start: 8.60, dur: 1.60, h: 1240, cx: 1290, cy: 660, cx2: 1330, cy2: 640, zoom: [1.02, 1.10], punch: 0.14, shake: 18, shakes: [0] },
      { scene: 'd', start: 8.65, dur: 1.55, h: 880, cx: 620, cy: 740, cx2: 700, cy2: 690, zoom: [1.02, 1.14], punch: 0.18, shake: 30, shakes: [0.35, 0.95] },
      { scene: 'b', start: 12.10, dur: 1.85, h: 1040, cx: 1260, cy: 620, cx2: 1180, cy2: 600, zoom: [1.06, 1.20], punch: 0.20, shake: 26, shakes: [0, 0.9] },
      { scene: 'b', start: 2.20, dur: 2.80, h: 1440, cx: 1280, cy: 700, cx2: 1290, cy2: 700, zoom: [1.02, 1.06], punch: 0.08, shake: 0, end: true },
    ],
    caps: [
      { t: [0.00, 2.10], big: '家里只剩 1 点血', sub: '它已经站在门口' },
      { t: [2.10, 3.90], big: '它们从来不敲门', sub: '第 2 回合 · 裂隙开了' },
      { t: [3.90, 5.50], big: '直接砸进来', sub: '别让脚步声先到' },
      { t: [5.50, 7.20], big: '墙在塌', sub: '你退无可退' },
      { t: [7.20, 8.80], big: '一波比一波多', sub: '狂潮 ×1' },
      { t: [8.80, 10.35], big: '炸开一条路', sub: '照明弹 · 最后一发' },
      { t: [10.35, 12.20], big: '守住这一夜', sub: '天亮之前别闭眼' },
      { t: [12.20, 15.00], big: '《僵尸在敲门》', sub: '点击左下角 · 现在开一局', end: true },
    ],
    audio: {
      droneAmp: 0.36, droneBase: 41.2,
      heartbeat: { t0: 0.2, t1: 12.2, bpm0: 56, bpm1: 122, amp: 0.52 },
      events: [
        { type: 'impact', t: 0.0, amp: 1.05 },
        { type: 'riser', t: 1.2, t1: 2.1, amp: 0.34 },
        { type: 'impact', t: 2.1, amp: 0.9 },
        { type: 'riser', t: 3.2, t1: 3.9, amp: 0.4 },
        { type: 'impact', t: 3.9, amp: 1.0 },
        { type: 'swell', t: 4.4, t1: 5.0, amp: 0.5 },
        { type: 'stinger', t: 5.0, amp: 0.62 },
        { type: 'impact', t: 5.5, amp: 0.75 },
        { type: 'riser', t: 6.4, t1: 7.2, amp: 0.42 },
        { type: 'impact', t: 7.2, amp: 0.95 },
        { type: 'impact', t: 8.8, amp: 0.8 },
        { type: 'swell', t: 9.4, t1: 10.1, amp: 0.55 },
        { type: 'stinger', t: 10.1, amp: 0.7 },
        { type: 'riser', t: 10.8, t1: 12.2, amp: 0.5 },
        { type: 'impact', t: 12.2, amp: 1.15 },
        { type: 'thump', t: 13.4, f0: 120, f1: 34, tau: 0.9, amp: 0.5 },
      ],
    },
  },
  {
    id: '02',
    name: '狂潮来了',
    shots: [
      { scene: 'b', start: 0.20, dur: 1.70, h: 1240, cx: 1290, cy: 660, cx2: 1240, cy2: 620, zoom: [1.02, 1.12], punch: 0.22, shake: 24, shakes: [0, 1.0] },
      { scene: 'd', start: 4.60, dur: 1.50, h: 900, cx: 640, cy: 750, cx2: 730, cy2: 690, zoom: [1.02, 1.14], punch: 0.18, shake: 30, shakes: [0.4] },
      { scene: 'b', start: 3.60, dur: 1.60, h: 1040, cx: 1250, cy: 620, cx2: 1310, cy2: 650, zoom: [1.04, 1.16], punch: 0.16, shake: 20, shakes: [0] },
      { scene: 'c', start: 4.40, dur: 1.55, h: 860, cx: 450, cy: 700, cx2: 500, cy2: 670, zoom: [1.04, 1.16], punch: 0.18, shake: 24, shakes: [0, 0.9] },
      { scene: 'd', start: 8.60, dur: 1.50, h: 880, cx: 600, cy: 730, cx2: 690, cy2: 690, zoom: [1.02, 1.14], punch: 0.18, shake: 30, shakes: [0.35, 0.95] },
      { scene: 'b', start: 7.60, dur: 1.60, h: 1160, cx: 1290, cy: 650, cx2: 1230, cy2: 620, zoom: [1.04, 1.16], punch: 0.16, shake: 22, shakes: [0] },
      { scene: 'b', start: 11.40, dur: 1.90, h: 980, cx: 1270, cy: 620, cx2: 1190, cy2: 600, zoom: [1.06, 1.22], punch: 0.22, shake: 30, shakes: [0, 0.95] },
      { scene: 'b', start: 5.00, dur: 3.65, h: 1440, cx: 1280, cy: 700, cx2: 1286, cy2: 700, zoom: [1.02, 1.06], punch: 0.08, shake: 0, end: true },
    ],
    caps: [
      { t: [0.00, 1.70], big: '裂隙开了', sub: '两侧各吐出一半怪物' },
      { t: [1.70, 3.20], big: '它们在排队', sub: '而你的墙只有一层' },
      { t: [3.20, 4.80], big: '狂潮 ×1', sub: '这一波不会停' },
      { t: [4.80, 6.35], big: '家只剩 1 点血', sub: '再挨一下就没了' },
      { t: [6.35, 7.85], big: '炸开一条路', sub: '照明弹 · 最后一发' },
      { t: [7.85, 9.45], big: '它们在往前压', sub: '每一秒都在敲门' },
      { t: [9.45, 11.35], big: '守住天亮', sub: '别让最后一盏灯熄灭' },
      { t: [11.35, 15.00], big: '《僵尸在敲门》', sub: '点击左下角 · 现在开一局', end: true },
    ],
    audio: {
      droneAmp: 0.4, droneBase: 44.5,
      heartbeat: { t0: 0.0, t1: 12.0, bpm0: 74, bpm1: 132, amp: 0.46 },
      events: [
        { type: 'impact', t: 0.0, amp: 1.1 },
        { type: 'riser', t: 0.9, t1: 1.7, amp: 0.4 },
        { type: 'impact', t: 1.7, amp: 0.95 },
        { type: 'impact', t: 3.2, amp: 1.0 },
        { type: 'riser', t: 3.9, t1: 4.8, amp: 0.45 },
        { type: 'impact', t: 4.8, amp: 1.0 },
        { type: 'swell', t: 5.4, t1: 6.2, amp: 0.5 },
        { type: 'stinger', t: 6.2, amp: 0.6 },
        { type: 'impact', t: 6.35, amp: 0.85 },
        { type: 'impact', t: 7.85, amp: 0.95 },
        { type: 'riser', t: 8.6, t1: 9.45, amp: 0.45 },
        { type: 'impact', t: 9.45, amp: 1.05 },
        { type: 'swell', t: 10.3, t1: 11.35, amp: 0.6 },
        { type: 'stinger', t: 11.35, amp: 0.75 },
        { type: 'thump', t: 13.0, f0: 110, f1: 32, tau: 1.0, amp: 0.5 },
      ],
    },
  },
  {
    id: '03',
    name: '开门那一刻',
    shots: [
      { scene: 'a', start: 6.00, dur: 2.20, h: 1320, cx: 1120, cy: 680, cx2: 1180, cy2: 660, zoom: [1.02, 1.10], punch: 0.16, shake: 8, shakes: [0] },
      { scene: 'a', start: 10.20, dur: 1.60, h: 900, cx: 1000, cy: 700, cx2: 940, cy2: 670, zoom: [1.04, 1.16], punch: 0.18, shake: 14, shakes: [0.5] },
      { scene: 'b', start: 1.60, dur: 1.55, h: 1120, cx: 1270, cy: 640, cx2: 1320, cy2: 660, zoom: [1.04, 1.16], punch: 0.18, shake: 20, shakes: [0] },
      { scene: 'd', start: 4.55, dur: 1.55, h: 880, cx: 660, cy: 750, cx2: 760, cy2: 690, zoom: [1.02, 1.14], punch: 0.18, shake: 28, shakes: [0.4] },
      { scene: 'c', start: 2.40, dur: 1.70, h: 860, cx: 440, cy: 700, cx2: 480, cy2: 670, zoom: [1.04, 1.16], punch: 0.18, shake: 20, shakes: [0, 0.85] },
      { scene: 'd', start: 8.60, dur: 1.50, h: 900, cx: 610, cy: 740, cx2: 700, cy2: 690, zoom: [1.02, 1.14], punch: 0.2, shake: 30, shakes: [0.35, 0.95] },
      { scene: 'b', start: 12.40, dur: 1.90, h: 1020, cx: 1265, cy: 620, cx2: 1185, cy2: 600, zoom: [1.06, 1.22], punch: 0.22, shake: 28, shakes: [0, 0.95] },
      { scene: 'a', start: 2.00, dur: 3.00, h: 1440, cx: 1150, cy: 700, cx2: 1160, cy2: 700, zoom: [1.02, 1.06], punch: 0.08, shake: 0, end: true },
    ],
    caps: [
      { t: [0.00, 2.20], big: '它们不走正门', sub: '它们从裂隙里爬出来' },
      { t: [2.20, 3.80], big: '你只有 6 个格子', sub: '和一次犯错的机会' },
      { t: [3.80, 5.35], big: '第 2 回合', sub: '狂潮 ×1 · 压力 +11%' },
      { t: [5.35, 6.90], big: '炸开一条路', sub: '照明弹 · 最后一发' },
      { t: [6.90, 8.60], big: '家只剩 1 点血', sub: '再挨一下就没了' },
      { t: [8.60, 10.10], big: '最后一发照明弹', sub: '赌它能撑过这一波' },
      { t: [10.10, 12.00], big: '守住天亮', sub: '别让最后一盏灯熄灭' },
      { t: [12.00, 15.00], big: '《僵尸在敲门》', sub: '点击左下角 · 现在开一局', end: true },
    ],
    audio: {
      droneAmp: 0.33, droneBase: 38.6,
      heartbeat: { t0: 0.0, t1: 12.0, bpm0: 52, bpm1: 116, amp: 0.48 },
      events: [
        { type: 'impact', t: 0.0, amp: 0.95 },
        { type: 'riser', t: 1.3, t1: 2.2, amp: 0.32 },
        { type: 'impact', t: 2.2, amp: 0.9 },
        { type: 'riser', t: 3.0, t1: 3.8, amp: 0.4 },
        { type: 'impact', t: 3.8, amp: 1.0 },
        { type: 'swell', t: 4.6, t1: 5.35, amp: 0.5 },
        { type: 'stinger', t: 5.35, amp: 0.62 },
        { type: 'impact', t: 6.9, amp: 1.0 },
        { type: 'riser', t: 7.6, t1: 8.6, amp: 0.45 },
        { type: 'impact', t: 8.6, amp: 1.05 },
        { type: 'riser', t: 9.4, t1: 10.1, amp: 0.5 },
        { type: 'stinger', t: 10.1, amp: 0.7 },
        { type: 'swell', t: 10.8, t1: 12.0, amp: 0.6 },
        { type: 'impact', t: 12.0, amp: 1.15 },
        { type: 'thump', t: 13.2, f0: 115, f1: 33, tau: 0.95, amp: 0.5 },
      ],
    },
  },
];

/* ---------- 表达式工具 ---------- */
function shakeExpr(triggers, amp, axis) {
  if (!amp) return '0';
  const parts = (triggers && triggers.length ? triggers : [0]).map((tk, i) => {
    const f = axis === 'x' ? 68 + i * 9 : 61 + i * 7;
    return `if(gte(t,${tk.toFixed(3)}),${(amp * (axis === 'x' ? 1 : 0.75)).toFixed(2)}*exp(-(t-${tk.toFixed(3)})*5.5)*sin((t-${tk.toFixed(3)})*${f}),0)`;
  });
  return '(' + parts.join('+') + ')';
}

function shotChain(shot, inLabel, outIdx) {
  const h = shot.h * K;
  const w = (shot.h * 9 / 16) * K;
  const x0 = shot.cx * K - w / 2;
  const y0 = shot.cy * K - h / 2;
  const x1 = (shot.cx2 == null ? shot.cx : shot.cx2) * K - w / 2;
  const y1 = (shot.cy2 == null ? shot.cy : shot.cy2) * K - h / 2;
  const d = shot.dur;
  const sx = shakeExpr(shot.shakes, shot.shake * K, 'x');
  const sy = shakeExpr(shot.shakes, shot.shake * K, 'y');
  const xEx = `max(0,min(iw-ow,${x0.toFixed(2)}+(${(x1 - x0).toFixed(2)})*min(t/${d},1)+${sx}))`;
  const yEx = `max(0,min(ih-oh,${y0.toFixed(2)}+(${(y1 - y0).toFixed(2)})*min(t/${d},1)+${sy}))`;
  const z0 = shot.zoom ? shot.zoom[0] : 1;
  const z1 = shot.zoom ? shot.zoom[1] : 1;
  const punch = shot.punch == null ? 0.12 : shot.punch;
  const kEx = `${z0.toFixed(3)}+${(z1 - z0).toFixed(3)}*min(t/${d},1)+${punch.toFixed(3)}*max(0,1-t/0.30)`;
  const trim = `trim=start=${shot.start}:end=${(shot.start + d).toFixed(3)},setpts=PTS-STARTPTS`;
  return `${inLabel}${trim},crop=${w.toFixed(0)}:${h.toFixed(0)}:'${xEx}':'${yEx}',` +
    `scale=eval=frame:w='${OUT_W}*(${kEx})':h='${OUT_H}*(${kEx})':flags=lanczos,` +
    `crop=${OUT_W}:${OUT_H},setsar=1[s${outIdx}]`;
}

/* ---------- 字幕 ---------- */
function boldText(text, x, y, size, color, extra) {
  const o = Math.max(1, Math.round(size * 0.028));
  const offs = [[-o, 0], [o, 0], [0, -o], [0, o]];
  return offs.map(([dx, dy]) =>
    `drawtext=fontfile='${FONT}':text='${text}':fontcolor=${color}:fontsize=${Math.round(size)}` +
    `:x=(${x})+(${dx}):y=(${y})+(${dy}):${extra}`).join(',');
}

function capFilters(caps, outW) {
  const out = [];
  for (const c of caps) {
    const t0 = c.t[0].toFixed(2), t1 = c.t[1].toFixed(2);
    const en = `enable='between(t,${t0},${t1})'`;
    if (c.end) {
      out.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0x05060A@0.62:t=fill:${en}`);
      out.push(boldText(c.big, '(w-text_w)/2', Math.round(690 * S), 118 * S, '0xF6E7CE',
        `box=1:boxcolor=0x140508@0.86:boxborderw=${Math.round(30 * S)}:${en}`));
      out.push(`drawbox=x=${Math.round(300 * S)}:y=${Math.round(852 * S)}:w=${Math.round(480 * S)}:h=${Math.max(2, Math.round(5 * S))}:color=0xA51218@0.95:t=fill:${en}`);
      out.push(boldText(c.sub, '(w-text_w)/2', Math.round(900 * S), 50 * S, '0xF4C66A', `box=1:boxcolor=0x0A0B10@0.78:boxborderw=${Math.round(18 * S)}:${en}`));
      continue;
    }
    out.push(boldText(c.big, '(w-text_w)/2', Math.round(400 * S), 104 * S, '0xF7ECD9',
      `box=1:boxcolor=0x160609@0.72:boxborderw=${Math.round(26 * S)}:${en}`));
    out.push(`drawbox=x=${Math.round(250 * S)}:y=${Math.round(540 * S)}:w=${Math.round(580 * S)}:h=${Math.max(2, Math.round(4 * S))}:color=0xA51218@0.85:t=fill:${en}`);
    if (c.sub) {
      out.push(boldText(c.sub, '(w-text_w)/2', Math.round(1310 * S), 56 * S, '0xE2D3C0',
        `box=1:boxcolor=0x08090C@0.74:boxborderw=${Math.round(18 * S)}:${en}`));
    }
  }
  return out;
}

/* 顶部角标 + 每镜切换的红色/白色闪帧 + 危机红脉冲 */
function fxFilters(shots) {
  const out = [];
  const cuts = [];
  let acc = 0;
  for (const s of shots) { cuts.push(acc); acc += s.dur; }
  out.push(boldText('僵尸在敲门', '(w-text_w)/2', Math.round(196 * S), 44 * S, '0xD9C9B6',
    `box=1:boxcolor=0x08090C@0.55:boxborderw=${Math.round(14 * S)}`));
  cuts.forEach((t, i) => {
    const col = i === 0 ? '0xFFFFFF' : (i % 2 === 0 ? '0xB01015' : '0xFFFFFF');
    out.push(`drawbox=x=0:y=0:w=iw:h=ih:color=${col}@0.42:t=fill:enable='between(t,${t.toFixed(2)},${(t + 0.08).toFixed(2)})'`);
  });
  out.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0x8C0A10@0.30:t=fill:enable='between(t,5.30,5.62)+between(t,9.95,10.30)'`);
  out.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0xFFFFFF@0.55:t=fill:enable='between(t,5.00,5.06)+between(t,9.00,9.06)'`);
  return out;
}

function build(video, index) {
  const scenes = [];
  for (const s of video.shots) if (!scenes.includes(s.scene)) scenes.push(s.scene);

  const inputs = [];
  scenes.forEach((sc) => {
    inputs.push(...masterInput(sc).args);
  });
  const audioFile = path.join(OUTDIR, 'audio', `promo-${video.id}.wav`);
  fs.mkdirSync(path.dirname(audioFile), { recursive: true });
  renderAudio({ dur: DUR, ...video.audio }, audioFile);
  inputs.push('-i', audioFile);

  const chains = video.shots.map((s, i) => ({ globalIdx: scenes.indexOf(s.scene), i, shot: s }));

  // 同一输入被多次使用 -> 需要 split
  const uses = {};
  chains.forEach((c) => { uses[c.globalIdx] = (uses[c.globalIdx] || 0) + 1; });
  const parts = [];
  const splitLabels = {};
  Object.keys(uses).forEach((g) => {
    const n = uses[g];
    if (n > 1) {
      const labels = [];
      for (let j = 0; j < n; j++) labels.push(`[g${g}_${j}]`);
      parts.push(`[${g}:v]split=${n}${labels.join('')}`);
      splitLabels[g] = labels.slice();
    } else {
      splitLabels[g] = [`[${g}:v]`];
    }
  });

  const shotParts = chains.map((c) => {
    const label = splitLabels[c.globalIdx].shift();
    return shotChain(c.shot, label, c.i);
  });

  const catLabels = video.shots.map((_, i) => `[s${i}]`).join('');
  const grade = [SHOT_STYLE.eq, SHOT_STYLE.chill, SHOT_STYLE.mix, SHOT_STYLE.sharp, SHOT_STYLE.vig, SHOT_STYLE.grain];
  const text = [...capFilters(video.caps, OUT_W), ...fxFilters(video.shots)];

  const graph = [
    ...parts,
    ...shotParts,
    `${catLabels}concat=n=${video.shots.length}:v=1:a=0[cat]`,
    `[cat]${grade.join(',')},${text.join(',')},format=yuv420p[v]`,
    `[${scenes.length}:a]volume=1.0,alimiter=level_in=1:level_out=1:limit=0.95[a]`,
  ].join(';');

  const outFile = path.join(OUTDIR, `${HIGH ? '' : 'preview-'}僵尸在敲门_${video.id}_${video.name}.mp4`);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', graph,
    '-map', '[v]', '-map', '[a]',
    '-t', String(DUR), '-r', String(FPS),
    '-c:v', 'libx264', '-preset', HIGH ? 'medium' : 'veryfast', '-crf', HIGH ? '19' : '28',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-c:a', 'aac', '-b:a', HIGH ? '160k' : '96k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', outFile,
  ];
  return { args, outFile, graph };
}

/* ---------- 锁画：逐镜 contact sheet ---------- */
/* 每个镜头取中段一帧，拼成横排缩略图，用于锁定构图后再进调色/出片 */
function buildSheet(video) {
  fs.mkdirSync(SHEET_DIR, { recursive: true });
  const scenes = [];
  for (const s of video.shots) if (!scenes.includes(s.scene)) scenes.push(s.scene);

  const inputs = [];
  scenes.forEach((sc) => {
    inputs.push(...masterInput(sc).args);
  });

  const picks = video.shots.map((s) => {
    const globalIdx = scenes.indexOf(s.scene);
    const t = s.start + s.dur / 2;                 // 镜头中段
    const n = Math.min(FPS * DUR - 1, Math.max(0, Math.round(t * FPS)));
    return { globalIdx, n, shot: s };
  });

  const uses = {};
  picks.forEach((p) => { uses[p.globalIdx] = (uses[p.globalIdx] || 0) + 1; });
  const parts = [];
  const labels = {};
  Object.keys(uses).forEach((g) => {
    const cnt = uses[g];
    if (cnt > 1) {
      const ls = Array.from({ length: cnt }, (_, j) => `[q${g}_${j}]`);
      parts.push(`[${g}:v]split=${cnt}${ls.join('')}`);
      labels[g] = ls.slice();
    } else {
      labels[g] = [`[${g}:v]`];
    }
  });

  const cols = [];
  picks.forEach((p, i) => {
    const label = labels[p.globalIdx].shift();
    const th = 480;                                 // 缩略图高
    const tw = Math.round(th * 9 / 16);
    cols.push(`${label}trim=start=${(p.n / FPS).toFixed(3)},select='eq(n\\,0)',setpts=PTS-STARTPTS,` +
      `scale=${tw}:${th}:flags=lanczos,setsar=1[b${i}]`);
  });

  const rowLabels = picks.map((_, i) => `[b${i}]`).join('');
  const graph = [
    ...parts,
    ...cols,
    `${rowLabels}hstack=inputs=${picks.length}[sheet]`,
  ].join(';');

  const outFile = path.join(SHEET_DIR, `${video.id}-sheet.png`);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', graph,
    '-map', '[sheet]', '-frames:v', '1', outFile,
  ];
  execFileSync(FFMPEG, args, { stdio: ['ignore', 'inherit', 'pipe'] });
  return { outFile, shots: picks.length };
}

function main() {
  fs.mkdirSync(path.join(OUTDIR, 'audio'), { recursive: true });
  const list = ONLY ? VIDEOS.filter((v) => v.id === ONLY) : VIDEOS;

  if (SHEET) {
    for (const v of list) {
      const t0 = Date.now();
      const { outFile, shots } = buildSheet(v);
      console.log(`SHEET ${path.basename(outFile)} ${shots} shots ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    return;
  }

  for (const v of list) {
    const total = v.shots.reduce((a, s) => a + s.dur, 0);
    if (Math.abs(total - DUR) > 0.02) {
      throw new Error(`video ${v.id} 镜头总时长 ${total.toFixed(2)}s，应为 ${DUR}s`);
    }
    const { args, outFile, graph } = build(v, 0);
    fs.writeFileSync(path.join(OUTDIR, 'tmp', `graph-${v.id}.txt`), graph);
    const t0 = Date.now();
    try {
      execFileSync(FFMPEG, args, { stdio: ['ignore', 'inherit', 'pipe'] });
    } catch (e) {
      const msg = e.stderr ? e.stderr.toString() : String(e);
      console.error(`FFMPEG FAILED (${v.id}):\n` + msg.split('\n').slice(-12).join('\n'));
      process.exit(1);
    }
    console.log(`OK ${path.basename(outFile)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}
main();
