'use strict';

/* 宣传片恐怖音效合成：不依赖外部素材，全部用 DSP 生成。
 * 输出 48kHz 立体声 WAV。 */

const fs = require('fs');
const SR = 48000;

function buf(dur) {
  const n = Math.ceil(dur * SR);
  return { L: new Float32Array(n), R: new Float32Array(n), n };
}

function add(b, t, i, v, pan) {
  const idx = Math.round(t * SR) + i;
  if (idx < 0 || idx >= b.n) return;
  const l = pan > 0 ? 1 - pan : 1;
  const r = pan < 0 ? 1 + pan : 1;
  b.L[idx] += v * l;
  b.R[idx] += v * r;
}

/* 低频冲击：pitch 快速下滑 + 指数衰减 */
function thump(b, t0, o) {
  const f0 = o.f0 || 120, f1 = o.f1 || 42, tau = o.tau || 0.35;
  const amp = o.amp == null ? 1 : o.amp, pan = o.pan || 0;
  const dur = tau * 6;
  let ph = 0;
  for (let i = 0; i < dur * SR; i++) {
    const x = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-x / (tau * 0.25));
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-x / tau) * (1 - Math.exp(-x / 0.004));
    add(b, t0, i, Math.sin(ph) * env * amp, pan);
  }
}

/* 噪声瞬态：一击即散 */
function noiseHit(b, t0, o) {
  const tau = o.tau || 0.16, amp = o.amp == null ? 0.6 : o.amp, pan = o.pan || 0;
  const lp = o.lp || 6000, hp = o.hp || 120;
  const dur = tau * 6;
  let l1 = 0, l2 = 0, h1 = 0;
  const aLp = Math.exp(-2 * Math.PI * lp / SR), aHp = Math.exp(-2 * Math.PI * hp / SR);
  for (let i = 0; i < dur * SR; i++) {
    const x = i / SR;
    const w = Math.random() * 2 - 1;
    l1 = w * (1 - aLp) + l1 * aLp; l2 = l1 * (1 - aLp) + l2 * aLp;
    h1 = l2 - h1 * aHp;
    const env = Math.exp(-x / tau);
    add(b, t0, i, h1 * env * amp, pan);
  }
}

/* 金属余响：非谐分音，营造“撞击后回响” */
function ring(b, t0, o) {
  const parts = o.parts || [379, 613, 947, 1423];
  const tau = o.tau || 0.7, amp = o.amp == null ? 0.25 : o.amp, pan = o.pan || 0;
  const dur = tau * 5;
  for (let i = 0; i < dur * SR; i++) {
    const x = i / SR;
    let v = 0;
    for (let k = 0; k < parts.length; k++) {
      v += Math.sin(2 * Math.PI * parts[k] * x + k * 1.7) / (k + 1.6);
    }
    add(b, t0, i, v * Math.exp(-x / tau) * amp, pan);
  }
}

/* 上升音：噪声带通中心频率上扫 + 正弦上扫，制造“逼近感” */
function riser(b, t0, t1, o) {
  const amp = o.amp == null ? 0.5 : o.amp, pan = o.pan || 0;
  const dur = t1 - t0;
  const n = Math.floor(dur * SR);
  const f0 = o.f0 || 220, f1 = o.f1 || 4200;
  let lo = 0, band = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const fc = f0 * Math.pow(f1 / f0, u);
    const w = Math.random() * 2 - 1;
    const g = 2 * Math.sin(Math.PI * fc / SR);
    lo += g * (w - lo - band * 0.6);
    band += g * lo;
    const env = Math.pow(u, 2.2);
    ph += (2 * Math.PI * (110 * Math.pow(6, u))) / SR;
    add(b, t0, i, (band * 0.5 + Math.sin(ph) * 0.35) * env * amp, pan);
  }
}

/* 惊吓刺音：高频不谐和簇 + 快速起音 */
function stinger(b, t0, o) {
  const amp = o.amp == null ? 0.55 : o.amp, pan = o.pan || 0;
  const parts = o.parts || [1750, 2330, 3110, 4230];
  const tau = o.tau || 0.9;
  const dur = tau * 4;
  for (let i = 0; i < dur * SR; i++) {
    const x = i / SR;
    let v = 0;
    for (let k = 0; k < parts.length; k++) v += Math.sin(2 * Math.PI * parts[k] * x * (1 + 0.004 * Math.sin(x * 11 + k)));
    v /= parts.length;
    const env = (1 - Math.exp(-x / 0.002)) * Math.exp(-x / tau);
    add(b, t0, i, v * env * amp, pan);
  }
  thump(b, t0, { f0: 200, f1: 38, tau: 0.5, amp: amp * 1.5 });
  noiseHit(b, t0, { tau: 0.3, amp: amp * 0.8, lp: 9000, hp: 400 });
}

/* 持续低频嗡鸣：整片的地板噪声 */
function drone(b, t0, t1, o) {
  const amp = o.amp == null ? 0.3 : o.amp;
  const base = o.base || 41.2;
  const n = Math.floor((t1 - t0) * SR);
  const parts = [base, base * 1.5, base * 2.0, base * 3.02, base * 4.51];
  const ph = parts.map((_, k) => k * 2.1);
  let l1 = 0, l2 = 0;
  const aLp = Math.exp(-2 * Math.PI * 420 / SR);
  for (let i = 0; i < n; i++) {
    const x = i / SR;
    let v = 0;
    for (let k = 0; k < parts.length; k++) {
      ph[k] += (2 * Math.PI * parts[k] * (1 + 0.0015 * Math.sin(2 * Math.PI * 0.07 * x + k))) / SR;
      v += Math.sin(ph[k]) / (k + 1.5);
    }
    const w = Math.random() * 2 - 1;
    l1 = w * (1 - aLp) + l1 * aLp; l2 = l1 * (1 - aLp) + l2 * aLp;
    const am = 0.72 + 0.28 * Math.sin(2 * Math.PI * 0.083 * x);
    const env = Math.min(1, x / 1.2) * Math.min(1, (t1 - t0 - x) / 0.6);
    add(b, t0, i, (v * 0.8 + l2 * 1.4) * am * env * amp, 0);
  }
}

/* 心跳：lub-dub */
function heartbeat(b, t0, t1, o) {
  const amp = o.amp == null ? 0.5 : o.amp;
  const bpm0 = o.bpm0 || 58, bpm1 = o.bpm1 || 118;
  let t = t0;
  while (t < t1) {
    const u = (t - t0) / Math.max(0.001, t1 - t0);
    const bpm = bpm0 + (bpm1 - bpm0) * u;
    const spb = 60 / bpm;
    thump(b, t, { f0: 96, f1: 40, tau: 0.13, amp: amp * (0.8 + 0.4 * u) });
    thump(b, t + spb * 0.31, { f0: 78, f1: 34, tau: 0.1, amp: amp * 0.55 * (0.8 + 0.4 * u) });
    t += spb;
  }
}

/* 低频涌起：给“重击”前铺一层压力 */
function swell(b, t0, t1, o) {
  const amp = o.amp == null ? 0.4 : o.amp;
  const n = Math.floor((t1 - t0) * SR);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    ph += (2 * Math.PI * (28 + 22 * u)) / SR;
    const env = Math.pow(u, 1.6);
    add(b, t0, i, Math.sin(ph) * env * amp, 0);
  }
}

/* 混响：4 comb + 2 allpass，只作用于 wet 总线 */
function reverb(L, R, mix) {
  const combs = [1557, 1617, 1491, 1422];
  const fb = [0.805, 0.827, 0.783, 0.764];
  const outL = new Float32Array(L.length), outR = new Float32Array(R.length);
  for (let c = 0; c < combs.length; c++) {
    const d = combs[c], g = fb[c];
    const bl = new Float32Array(d), br = new Float32Array(d);
    let p = 0;
    for (let i = 0; i < L.length; i++) {
      const yl = bl[p], yr = br[p];
      bl[p] = L[i] + yl * g;
      br[p] = R[i] + yr * g;
      outL[i] += yl * 0.25; outR[i] += yr * 0.25;
      p = (p + 1) % d;
    }
  }
  const ap = [225, 556];
  for (let a = 0; a < ap.length; a++) {
    const d = ap[a], g = 0.5;
    const bl = new Float32Array(d), br = new Float32Array(d);
    let p = 0;
    for (let i = 0; i < outL.length; i++) {
      const yl = bl[p], yr = br[p];
      bl[p] = outL[i] + yl * g; br[p] = outR[i] + yr * g;
      outL[i] = yl - outL[i] * g; outR[i] = yr - outR[i] * g;
      p = (p + 1) % d;
    }
  }
  for (let i = 0; i < L.length; i++) { L[i] += outL[i] * mix; R[i] += outR[i] * mix; }
}

function writeWav(file, L, R) {
  const n = L.length;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
    data.writeInt16LE(Math.round(l * 32767), i * 4);
    data.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22); head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28);
  head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

/* 依据时间轴生成整条音轨 */
function render(spec, outFile) {
  const dur = spec.dur || 15;
  const b = buf(dur + 1.2);
  const wet = buf(dur + 1.2);
  const T = (ev, fn, target) => fn(target || b, ev.t, ev);

  drone(b, 0, dur, { amp: spec.droneAmp == null ? 0.34 : spec.droneAmp, base: spec.droneBase || 41.2 });
  if (spec.heartbeat) heartbeat(b, spec.heartbeat.t0, spec.heartbeat.t1, spec.heartbeat);

  for (const ev of spec.events || []) {
    switch (ev.type) {
      case 'impact':
        thump(b, ev.t, { f0: 170, f1: 36, tau: ev.tau || 0.42, amp: ev.amp == null ? 0.95 : ev.amp });
        noiseHit(b, ev.t, { tau: 0.13, amp: 0.5 * (ev.amp == null ? 1 : ev.amp), lp: 7000, hp: 200 });
        noiseHit(wet, ev.t, { tau: 0.22, amp: 0.35, lp: 4000, hp: 500 });
        ring(wet, ev.t, { amp: 0.22, tau: 0.85 });
        break;
      case 'riser':
        riser(b, ev.t, ev.t1, { amp: ev.amp == null ? 0.5 : ev.amp, f0: ev.f0, f1: ev.f1 });
        break;
      case 'stinger':
        stinger(b, ev.t, { amp: ev.amp == null ? 0.6 : ev.amp });
        stinger(wet, ev.t, { amp: (ev.amp == null ? 0.6 : ev.amp) * 0.7 });
        break;
      case 'swell':
        swell(b, ev.t, ev.t1, { amp: ev.amp == null ? 0.4 : ev.amp });
        break;
      case 'noise':
        noiseHit(b, ev.t, ev);
        break;
      case 'ring':
        ring(wet, ev.t, ev);
        break;
      case 'thump':
        thump(b, ev.t, ev);
        break;
      default: break;
    }
  }

  reverb(wet.L, wet.R, 1.0);
  let peak = 0;
  for (let i = 0; i < b.n; i++) {
    b.L[i] += wet.L[i] * 0.55;
    b.R[i] += wet.R[i] * 0.55;
    b.L[i] = Math.tanh(b.L[i] * 1.05);
    b.R[i] = Math.tanh(b.R[i] * 1.05);
    peak = Math.max(peak, Math.abs(b.L[i]), Math.abs(b.R[i]));
  }
  const g = peak > 0 ? 0.94 / peak : 1;
  const fadeIn = 0.04 * SR, fadeOut = 0.35 * SR;
  const N = Math.floor(dur * SR);
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let e = 1;
    if (i < fadeIn) e = i / fadeIn;
    if (i > N - fadeOut) e = Math.min(e, (N - i) / fadeOut);
    L[i] = b.L[i] * g * e;
    R[i] = b.R[i] * g * e;
  }
  writeWav(outFile, L, R);
  return { peak: (peak * g).toFixed(3) };
}

module.exports = { render };

if (require.main === module) {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(render(spec, process.argv[3])));
}
