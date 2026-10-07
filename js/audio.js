'use strict';

/* ---------------------------------------------------------------
 * 极简 WebAudio 合成音效：不加载任何外部音频文件。
 * 首次用户手势后才初始化（iOS 要求）。
 * ------------------------------------------------------------- */
var Sfx = {
  ac: null, master: null, noiseBuf: null,
  enabled: true, ready: false, ambient: null, volume: 1,
  intensity: 0, activeAmbient: false,

  init: function () {
    if (this.ready) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ac = new AC(); } catch (e) { return; }
    this.master = this.ac.createGain();
    this.master.gain.value = this.enabled ? 0.5 * this.volume : 0;
    this.master.connect(this.ac.destination);

    var len = this.ac.sampleRate * 1.2;
    var buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.ready = true;
  },
  resume: function () {
    this.init();
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  },
  setEnabled: function (v) {
    this.enabled = v;
    if (this.master) this.master.gain.value = v ? 0.5 * this.volume : 0;
  },
  setVolume: function (value) {
    this.volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    if (this.master) this.master.gain.value = this.enabled ? 0.5 * this.volume : 0;
  },

  _noise: function (dur, gain, freq, q, type, delay) {
    if (!this.ready || !this.enabled) return;
    var t = this.ac.currentTime + (delay || 0);
    var s = this.ac.createBufferSource(); s.buffer = this.noiseBuf;
    var f = this.ac.createBiquadFilter(); f.type = type || 'bandpass';
    f.frequency.value = freq; f.Q.value = q || 1;
    var g = this.ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  },
  _tone: function (type, f0, f1, dur, gain, delay) {
    if (!this.ready || !this.enabled) return;
    var t = this.ac.currentTime + (delay || 0);
    var o = this.ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  shot: function () { this._noise(0.07, 0.16, 2400, 1.6); this._tone('square', 420, 180, 0.05, 0.05); },
  hit: function () { this._noise(0.05, 0.10, 900, 1.2); },
  growl: function (type) {
    var heavy = type === 'brute' || type === 'tank';
    var screamer = type === 'screamer';
    var runner = type === 'runner';
    var base = heavy ? 54 : (runner ? 92 : 72);
    var dur = heavy ? 0.52 : (runner ? 0.28 : 0.38);
    var wobble = Math.random() * 7;
    this._tone('sawtooth', base * 1.45 + wobble, base * 0.72, dur, heavy ? 0.070 : 0.052);
    this._tone('triangle', base * 2.16, base * 1.08, dur * 0.76, 0.026, 0.025);
    this._noise(dur * 0.92, heavy ? 0.060 : 0.042, heavy ? 175 : 310, 1.7, 'lowpass', 0.01);
    this._noise(dur * 0.56, 0.030, heavy ? 460 : 760, 3.2, 'bandpass', 0.10);
    if (screamer) {
      this._tone('sawtooth', 460, 155, 0.34, 0.038, 0.04);
      this._noise(0.30, 0.034, 1700, 4.5, 'bandpass', 0.05);
    }
  },
  bite: function () {
    this._noise(0.065, 0.105, 460, 1.5, 'lowpass');
    this._noise(0.11, 0.045, 1350, 4.2, 'bandpass', 0.025);
    this._tone('triangle', 155, 58, 0.09, 0.050);
  },
  flame: function () { this._noise(0.20, 0.07, 620, 0.7, 'lowpass'); },
  zap: function () { this._noise(0.11, 0.12, 3600, 2.4); this._tone('sawtooth', 1500, 380, 0.11, 0.05); },
  zdie: function () { this._tone('sawtooth', 190, 62, 0.20, 0.07); this._noise(0.14, 0.07, 320, 1.0, 'lowpass'); },
  bigdie: function () { this._tone('sawtooth', 120, 40, 0.38, 0.11); this._noise(0.3, 0.11, 220, 0.8, 'lowpass'); },
  boom: function () { this._noise(0.42, 0.20, 180, 0.6, 'lowpass'); this._tone('sine', 110, 34, 0.42, 0.14); },
  homeHit: function () { this._tone('sine', 96, 42, 0.34, 0.16); this._noise(0.2, 0.1, 240, 0.8, 'lowpass'); },
  unitDie: function () { this._noise(0.22, 0.11, 520, 0.9, 'lowpass'); },
  spawn: function () { this._tone('sine', 300, 90, 0.18, 0.03); },
  pulse: function () { this._tone('sine', 70, 44, 1.1, 0.10); this._noise(0.9, 0.06, 140, 0.5, 'lowpass'); },
  flare: function () { this._noise(0.5, 0.22, 1900, 0.8); this._tone('sine', 900, 200, 0.45, 0.10); },
  repair: function () { this._tone('sine', 420, 880, 0.3, 0.09); },
  ui: function () { this._tone('square', 700, 700, 0.05, 0.035); },
  place: function () { this._tone('square', 340, 520, 0.09, 0.06); },
  error: function () { this._tone('square', 200, 130, 0.14, 0.06); },
  coin: function () { this._tone('triangle', 900, 1400, 0.1, 0.06); },
  warning: function () {
    this._tone('sine', 74, 58, 0.34, 0.12);
    this._tone('sine', 55, 43, 0.46, 0.11, 0.20);
  },
  heartbeat: function (danger) {
    if (!this.enabled) return;
    var g = 0.055 + Math.min(0.11, danger * 0.11);
    this._tone('sine', 68, 46, 0.17, g);
    this._tone('sine', 58, 39, 0.23, g * 0.72, 0.16);
  },
  creak: function () {
    var drift = 90 + Math.random() * 90;
    this._tone('sawtooth', drift, drift * 0.72, 0.65, 0.018);
    this._noise(0.42, 0.026, 340 + Math.random() * 420, 5.5, 'bandpass', 0.04);
  },
  distantBreath: function () {
    this._noise(1.0, 0.026, 620, 0.45, 'lowpass');
    this._noise(0.72, 0.015, 980, 1.2, 'bandpass', 0.86);
  },
  win: function () {
    var n = [523, 659, 784, 1046];
    for (var i = 0; i < 4; i++) this._tone('triangle', n[i], n[i], 0.28, 0.09, i * 0.10);
  },
  lose: function () {
    var n = [392, 330, 262, 196];
    for (var i = 0; i < 4; i++) this._tone('sawtooth', n[i], n[i] * 0.98, 0.40, 0.07, i * 0.14);
  },

  startAmbient: function () {
    if (!this.ready || this.ambient) return;
    var self = this, ac = this.ac;
    var g = ac.createGain(); g.gain.value = 0.028;
    var o1 = ac.createOscillator(); o1.type = 'sine'; o1.frequency.value = 42;
    var o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 63.5;
    var lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
    var lg = ac.createGain(); lg.gain.value = 0.018;
    lfo.connect(lg); lg.connect(g.gain);
    o1.connect(g); o2.connect(g); g.connect(this.master);
    o1.start(); o2.start(); lfo.start();

    var wind = ac.createBufferSource();
    wind.buffer = this.noiseBuf; wind.loop = true;
    var windFilter = ac.createBiquadFilter();
    windFilter.type = 'lowpass'; windFilter.frequency.value = 360; windFilter.Q.value = 0.7;
    var windGain = ac.createGain(); windGain.gain.value = 0.018;
    wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(this.master);
    wind.start();

    this.ambient = { g: g, windGain: windGain, windFilter: windFilter, nodes: [o1, o2, lfo, wind] };
    this.ambientTimer = setInterval(function () { self.ambientTick(); }, 1000);
  },
  setIntensity: function (level, active) {
    this.activeAmbient = !!active;
    this.intensity = Math.max(0, Math.min(1, level || 0));
    if (!this.ambient) return;
    var now = this.ac.currentTime;
    this.ambient.windGain.gain.setTargetAtTime(0.015 + this.intensity * 0.025, now, 0.35);
    this.ambient.windFilter.frequency.setTargetAtTime(330 + this.intensity * 340, now, 0.5);
  },
  ambientTick: function () {
    if (!this.ready || !this.enabled || !this.activeAmbient) return;
    if (this.intensity > 0.32 && Math.random() < 0.12 + this.intensity * 0.18) this.heartbeat(this.intensity);
    if (Math.random() < 0.10) Math.random() < 0.58 ? this.creak() : this.distantBreath();
  },
};
