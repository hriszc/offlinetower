'use strict';

/* ---------------------------------------------------------------
 * 渲染层：Canvas + 离线正式绘本插画，加载失败时保留程序化后备美术。
 * 性能策略：背景与动物图集裁切都缓存为 offscreen canvas，
 * 每帧只做 drawImage + 少量反馈图形，手机端也能稳帧。
 * ------------------------------------------------------------- */
/* 有攻击行为的动物会显示作战指示灯。 */
var ATTACKERS = {};
Object.keys(UNITS).forEach(function (id) {
  if (UNITS[id].behavior !== 'block') ATTACKERS[id] = 1;
});
var Render = {
  canvas: null, ctx: null,
  W: CONFIG.W, H: CONFIG.H, dpr: 1,
  fieldView: { top: 64, scale: 1, left: 0, xScale: 1, bottom: 640, worldBottom: 640, trayH: 0 },
  /* 画质档位：手机发热主要来自填充率，所以第一根杠杆是渲染分辨率。
     high 给桌面/录屏，balanced 是触屏默认，low 由自适应降级触发。 */
  quality: 'high',
  autoQuality: true,
  cfg: { dprCap: 2, grain: false, shadow: true, parts: 420, lod: 2, motes: true },
  lod: 2,
  _gradCache: {},
  _gradN: 0,
  _spriteCache: {},
  _menuArt: null,
  _lightenCache: {},
  bgPad: 280,            // 背景底板左右各多画这么多，宽屏手机才不会出现黑边
  bg: null, vignette: null, noise: null, fog: null,
  battleScene: null,
  animalAtlas: null,
  animalAtlasReadable: null,
  _animalAtlasBounds: {},
  animalAtlasOrder: ['bear', 'porcupine', 'raccoon', 'firefly', 'fox', 'eel', 'hawk', 'snake',
    'hare', 'gorilla', 'rhino', 'bat', 'wolf', 'owl', 'boar', 'chameleon',
    'elephant', 'frog', 'bee', 'turtle', 'tiger', 'phoenix'],
  glowCache: {},
  parts: [],
  shake: 0, sx: 0, sy: 0,
  t: 0, flash: 0, flashColor: '255,60,40',
  damageFlash: { p: 0, g: 0 },
  embers: [],
  dust: [],
  riftPulse: 0,
  glitch: 0,
  watcher: { next: 8, life: 0, x: 0, y: 0, scale: 1, side: 0 },
  lastFxCull: 0,

  init: function (canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.autoQuality = !window.__forceQuality;
    this.setQuality(window.__forceQuality || this.defaultQuality(), true);
    this.buildStatics();
    // 正式绘本场景只解码一次；任何加载失败仍使用程序背景。
    var self = this;
    var sceneImage = new Image();
    sceneImage.decoding = 'async';
    sceneImage.onload = function () { self.battleScene = sceneImage; self.buildStatics(); };
    sceneImage.onerror = function () { self.battleScene = null; };
    sceneImage.src = window.GAME_ART && window.GAME_ART.battle
      ? window.GAME_ART.battle : 'assets/ui-battle-scene-v1.png';
    var atlasImage = new Image();
    atlasImage.decoding = 'async';
    atlasImage.onload = function () {
      self.animalAtlas = atlasImage;
      self.animalAtlasReadable = null;
      self._animalAtlasBounds = {}; self._spriteCache = {}; self._menuArt = null;
      if (typeof UI !== 'undefined' && typeof UI.refreshAnimalArt === 'function') UI.refreshAnimalArt();
    };
    atlasImage.onerror = function () { self.animalAtlas = null; };
    atlasImage.src = window.GAME_ART && window.GAME_ART.animals
      ? window.GAME_ART.animals : 'assets/ui-animal-atlas-v1.png';
    for (var i = 0; i < 34; i++) {
      this.embers.push({
        x: CONFIG.RIFT_X + (Math.random() - 0.5) * 90,
        y: Math.random() * CONFIG.H,
        v: 12 + Math.random() * 40,
        r: 0.8 + Math.random() * 2.0,
        a: Math.random(),
      });
    }
    for (var d = 0; d < 42; d++) {
      this.dust.push({
        x: Math.random() * (CONFIG.W + this.bgPad * 2) - this.bgPad,
        y: CONFIG.TOP_H + Math.random() * (CONFIG.BOTTOM_Y - CONFIG.TOP_H),
        vx: 5 + Math.random() * 15,
        vy: -2 - Math.random() * 6,
        r: 0.5 + Math.random() * 1.7,
        a: 0.04 + Math.random() * 0.13,
        phase: Math.random() * 6.283,
      });
    }
  },

  /* ------------------- 画质 ------------------- */
  QUALITY: {
    high:     { dprCap: 2,    grain: false, shadow: true,  parts: 420, lod: 2, motes: true },
    balanced: { dprCap: 1.5,  grain: false, shadow: false, parts: 260, lod: 1, motes: false },
    low:      { dprCap: 1.15, grain: false, shadow: false, parts: 150, lod: 0, motes: false },
  },
  defaultQuality: function () {
    var touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    var dpr = window.devicePixelRatio || 1;
    if (!touch && dpr <= 1.5) return 'high';
    return 'balanced';
  },
  setQuality: function (q, silent) {
    if (!this.QUALITY[q]) q = 'balanced';
    var changed = this.quality !== q;
    this.quality = q;
    this.cfg = this.QUALITY[q];
    this.lod = this.cfg.lod;
    if (changed && !silent && typeof UI !== 'undefined' && UI.fit) UI.fit();
    return changed;
  },
  /* 由主循环喂进实测帧时长：持续低于 ~50fps 就降一档，只降不升，避免抖动。 */
  adaptQuality: function (avgMs) {
    if (!this.autoQuality) return;
    if (avgMs < 20) return;
    if (this.quality === 'high') this.setQuality('balanced');
    else if (this.quality === 'balanced') this.setQuality('low');
  },

  /* 画布铺满整个视口；战场保持 16:9 逻辑尺寸居中，两侧用底色无缝延伸，
     这样 2.2:1 的手机横屏也不会出现黑边。 */
  resize: function (vw, vh, scale, offX, offY, rails) {
    var dpr = Math.min(window.devicePixelRatio || 1, this.cfg.dprCap);
    this.dpr = dpr;
    this.vw = vw; this.vh = vh;
    this.scale = scale; this.offX = offX; this.offY = offY;
    // 房屋侧栏占左右；通道使用HUD以下的完整高度，备战和战斗共用投影。
    var trayH = 0;
    var hudH = vh <= 340 ? 36 : vh <= 430 ? 44 : 64;
    var fieldTop = Math.max(CONFIG.TOP_H, Math.ceil((hudH - offY) / Math.max(.01, scale)) + 8);
    var viewBottom = Math.floor((vh - trayH - offY) / Math.max(.01, scale) - 12);
    var fieldScale = Math.max(.35, (viewBottom - fieldTop) / (CONFIG.GRID_BOTTOM - CONFIG.TOP_H));
    rails = rails || { left: 0, right: 0 };
    var railGap = Math.max(18, 32 * scale);
    var firstX = Math.max(offX + CONFIG.P_COLS[0] * scale, rails.left + railGap);
    var lastX = Math.min(offX + CONFIG.G_COLS[0] * scale, vw - rails.right - railGap);
    var xScale = Math.min(1, Math.max(.35, (lastX - firstX) /
      ((CONFIG.G_COLS[0] - CONFIG.P_COLS[0]) * Math.max(.01, scale))));
    var xLeft = (firstX - offX) / Math.max(.01, scale) - CONFIG.P_COLS[0] * xScale;
    this.fieldView = { top: fieldTop, scale: fieldScale,
      left: xLeft, xScale: xScale,
      bottom: fieldTop + (CONFIG.GRID_BOTTOM - CONFIG.TOP_H) * fieldScale,
      worldBottom: CONFIG.GRID_BOTTOM, trayH: trayH, hudH: hudH };
    this._spriteCache = {};
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);
    this.canvas.style.width = vw + 'px';
    this.canvas.style.height = vh + 'px';
  },

  worldToViewY: function (y) {
    return this.fieldView.top + (y - CONFIG.TOP_H) * this.fieldView.scale;
  },

  resizeEdgeScene: function (w, h, x, y, portrait, physicalW, physicalH) {
    var layer = document.getElementById('viewportScene');
    if (!layer) return;
    this.edgeLayer = layer;
    this.edgeCanvas = document.getElementById('edgeScene');
    this.edgeViewport = { w: w, h: h, x: x, y: y };
    layer.style.width = w + 'px'; layer.style.height = h + 'px';
    layer.style.left = (physicalW - w) / 2 + 'px';
    layer.style.top = (physicalH - h) / 2 + 'px';
    layer.style.transformOrigin = 'center center';
    layer.style.transform = portrait ? 'rotate(90deg)' : 'none';
    this.edgeCanvas.width = Math.round(w * this.dpr);
    this.edgeCanvas.height = Math.round(h * this.dpr);
    this.drawEdgeScene();
  },

  drawEdgeScene: function () {
    if (!this.edgeCanvas || !this.edgeViewport || !this.bg) return;
    var v = this.edgeViewport, g = this.edgeCanvas.getContext('2d', { alpha: false });
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#23384c'; g.fillRect(0, 0, v.w, v.h);
    // 补足远离舞台的极端宽屏区域；主体区域随后用同一场地投影覆盖。
    var img = this.battleScene || this.bg;
    var cover = Math.max(v.w / img.width, v.h / img.height);
    g.drawImage(img, (v.w - img.width * cover) / 2, (v.h - img.height * cover) / 2,
      img.width * cover, img.height * cover);
    g.save(); g.translate(v.x + this.offX, v.y + this.offY);
    g.scale(this.scale, this.scale);
    g.translate(this.fieldView.left || 0, this.fieldView.top);
    g.scale(this.fieldView.xScale || 1, this.fieldView.scale);
    g.translate(0, -CONFIG.TOP_H);
    g.drawImage(this.bg, -this.bgPad, 0, CONFIG.W + this.bgPad * 2, CONFIG.H);
    g.restore();
  },
  worldToViewX: function (x) {
    return (this.fieldView.left || 0) + x * (this.fieldView.xScale || 1);
  },
  viewToWorldX: function (x) {
    return (x - (this.fieldView.left || 0)) / (this.fieldView.xScale || 1);
  },
  viewToWorldY: function (y) {
    return CONFIG.TOP_H + (y - this.fieldView.top) / this.fieldView.scale;
  },

  /* ------------------- 预渲染 ------------------- */
  glow: function (color, size) {
    var key = color + '|' + size;
    if (this.glowCache[key]) return this.glowCache[key];
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, color);
    grd.addColorStop(0.35, this.rgba(color, 0.42));
    grd.addColorStop(1, this.rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    this.glowCache[key] = c;
    return c;
  },
  rgba: function (hex, a) {
    if (hex.charAt(0) !== '#') return hex;
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  },

  buildStatics: function () {
    var W = CONFIG.W, H = CONFIG.H, PAD = this.bgPad, BW = W + PAD * 2;
    var c = document.createElement('canvas'); c.width = BW; c.height = H;
    var g = c.getContext('2d'); g.translate(PAD, 0);
    if (this.battleScene) {
      // 只延展原画最外侧的树林，边界像素连续，避免复制靠内的小屋。
      var art = this.battleScene, strip = 64 * art.naturalWidth / W;
      g.save(); g.scale(-1, 1);
      g.drawImage(art, 0, 0, strip, art.naturalHeight, 0, 0, PAD, H);
      g.restore(); g.save(); g.translate(W, 0); g.scale(-1, 1);
      g.drawImage(art, art.naturalWidth - strip, 0, strip, art.naturalHeight, -PAD, 0, PAD, H);
      g.restore(); g.drawImage(art, 0, 0, W, H);
      // 九条通道都在草地上：原画的天空/树冠不能成为上排伙伴的脚下背景。
      // 只铺中央可玩区域，保留两侧原画小屋，用软边接回树林和门前小径。
      var clearing = document.createElement('canvas');
      clearing.width = 960; clearing.height = CONFIG.GRID_BOTTOM - CONFIG.TOP_H;
      var cg = clearing.getContext('2d');
      var artScaleX = this.battleScene.naturalWidth / W;
      var artScaleY = this.battleScene.naturalHeight / H;
      cg.drawImage(this.battleScene, 220 * artScaleX, 200 * artScaleY,
        840 * artScaleX, 360 * artScaleY, 0, 0, clearing.width, clearing.height);
      cg.globalCompositeOperation = 'destination-in';
      var edge = cg.createLinearGradient(0, 0, clearing.width, 0);
      edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(32 / clearing.width, '#000');
      edge.addColorStop(1 - 32 / clearing.width, '#000'); edge.addColorStop(1, 'rgba(0,0,0,0)');
      cg.fillStyle = edge; cg.fillRect(0, 0, clearing.width, clearing.height);
      var horizon = cg.createLinearGradient(0, 0, 0, 24);
      horizon.addColorStop(0, 'rgba(0,0,0,0)'); horizon.addColorStop(1, '#000');
      cg.fillStyle = horizon; cg.fillRect(0, 0, clearing.width, clearing.height);
      g.drawImage(clearing, 160, CONFIG.TOP_H);
      this.bg = c; this.fog = null; this.noise = null; this.vignette = null;
      this.drawEdgeScene();
      return;
    }
    var rnd = mulberry32(20261007);
    var sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#102c4e'); sky.addColorStop(.45, '#173f59');
    sky.addColorStop(1, '#123743'); g.fillStyle = sky; g.fillRect(-PAD, 0, BW, H);
    g.fillStyle = 'rgba(247,237,197,.52)';
    for (var star = 0; star < 44; star++) {
      g.beginPath(); g.arc(-PAD + rnd() * BW, 6 + rnd() * 110, .7 + rnd() * .7, 0, 6.283); g.fill();
    }
    g.fillStyle = '#f6e8c0'; g.beginPath(); g.arc(W * .83, 24, 18, 0, 6.283); g.fill();
    g.fillStyle = '#e3dab6'; g.beginPath(); g.arc(W * .83 - 5, 20, 4, 0, 6.283); g.fill();
    var ground = g.createLinearGradient(0, CONFIG.TOP_H, 0, H);
    ground.addColorStop(0, '#234b5a'); ground.addColorStop(.6, '#284e56'); ground.addColorStop(1, '#183e4c');
    g.fillStyle = ground; g.fillRect(-PAD, CONFIG.TOP_H, BW, H - CONFIG.TOP_H);
    // 林缘分三层，尖松和圆叶都有完整剪影；全部只烘焙一次。
    for (var layer = 0; layer < 3; layer++) {
      var forestY = CONFIG.TOP_H + 4 + layer * 9;
      g.fillStyle = ['#1b405c', '#163b51', '#184450'][layer];
      for (var tr = 0; tr < 33; tr++) {
        var treeX = -PAD + tr * BW / 32 + (rnd() - .5) * 14;
        var treeH = 32 + rnd() * (65 - layer * 12);
        g.beginPath(); g.moveTo(treeX, forestY - treeH);
        g.lineTo(treeX - 13, forestY - treeH * .48); g.lineTo(treeX - 7, forestY - treeH * .48);
        g.lineTo(treeX - 25, forestY - treeH * .1); g.lineTo(treeX - 13, forestY - treeH * .1);
        g.lineTo(treeX - 32, forestY + 10); g.lineTo(treeX + 32, forestY + 10);
        g.lineTo(treeX + 13, forestY - treeH * .1); g.lineTo(treeX + 25, forestY - treeH * .1);
        g.lineTo(treeX + 7, forestY - treeH * .48); g.lineTo(treeX + 13, forestY - treeH * .48);
        g.closePath(); g.fill();
      }
    }
    // 九条浅石路嵌在草地中，去掉贯穿屏幕的工程直线与密网格。
    for (var li = 0; li < CONFIG.LANES.length; li++) {
      var top = CONFIG.LANES[li] - CONFIG.GRID_LANE_PITCH / 2;
      var laneH = CONFIG.GRID_LANE_PITCH;
      g.fillStyle = li % 2 ? '#345962' : '#325762';
      this.roundRectPath(g, 145, top + 5, W - 290, laneH - 10, 12); g.fill();
      for (var stone = 0; stone < 8; stone++) {
        var stoneX = 192 + stone * (W - 384) / 7 + (li % 2 ? 9 : -9);
        if (Math.abs(stoneX - CONFIG.RIFT_X) < CONFIG.RIFT_HW + 15) continue;
        var stoneY = top + laneH - 11, stoneW = 44 + rnd() * 25;
        g.fillStyle = 'rgba(125,157,151,.17)';
        g.beginPath(); g.moveTo(stoneX - stoneW / 2, stoneY - 2);
        g.lineTo(stoneX - stoneW / 2 + 5, stoneY - 8); g.lineTo(stoneX + stoneW / 2 - 7, stoneY - 7);
        g.lineTo(stoneX + stoneW / 2, stoneY - 1); g.lineTo(stoneX + stoneW / 2 - 5, stoneY + 3);
        g.lineTo(stoneX - stoneW / 2 + 7, stoneY + 4); g.closePath(); g.fill();
        if (stone % 2 === 0) {
          g.strokeStyle = '#527566'; g.lineWidth = 2; g.lineCap = 'round';
          g.beginPath(); g.moveTo(stoneX + stoneW / 2 + 9, stoneY + 5);
          g.lineTo(stoneX + stoneW / 2 + 6, stoneY - 1);
          g.moveTo(stoneX + stoneW / 2 + 9, stoneY + 5);
          g.lineTo(stoneX + stoneW / 2 + 12, stoneY - 3); g.stroke();
        }
      }
    }
    // 两侧树丛向小屋延伸，中央角色区保留低对比的留白。
    for (var side = 0; side < 2; side++) {
      for (var shrub = 0; shrub < 12; shrub++) {
        var sx = side ? W - 17 - rnd() * 38 : 17 + rnd() * 38;
        var sy = 96 + shrub * (H - 104) / 12;
        g.fillStyle = shrub % 2 ? '#1a4552' : '#225562';
        g.beginPath(); g.ellipse(sx, sy, 52 + rnd() * 23, 35, -.12, 0, 6.283); g.fill();
        g.beginPath(); g.ellipse(sx + (side ? -31 : 31), sy + 15, 36, 24, .15, 0, 6.283); g.fill();
        g.fillStyle = 'rgba(79,123,122,.30)'; g.beginPath(); g.ellipse(sx, sy - 10, 22, 12, -.3, 0, 6.283); g.fill();
      }
      var lampX = side ? W - 131 : 131;
      for (var lamp = 0; lamp < 2; lamp++) {
        var lampY = 158 + lamp * 416;
        g.strokeStyle = '#56756d'; g.lineWidth = 5; g.beginPath(); g.moveTo(lampX, lampY + 3); g.lineTo(lampX, lampY + 51); g.stroke();
        g.globalAlpha = .23; g.drawImage(this.glow('#edbd73', 128), lampX - 51, lampY - 44, 102, 102); g.globalAlpha = 1;
        g.fillStyle = '#354d59'; this.roundRectPath(g, lampX - 7, lampY - 5, 14, 22, 4); g.fill();
        g.fillStyle = '#f2d391'; this.roundRectPath(g, lampX - 3, lampY - 1, 6, 13, 2); g.fill();
      }
    }
    // 前景大石块、低矮叶丛压住道路下缘，形成绘本庭院。
    for (var fg = 0; fg < 24; fg++) {
      var fx = -PAD + fg * BW / 23, fy = 663 + rnd() * 24;
      g.fillStyle = fg % 2 ? '#28525e' : '#214650';
      g.beginPath(); g.ellipse(fx, fy, 38 + rnd() * 20, 22, 0, 0, 6.283); g.fill();
      g.beginPath(); g.ellipse(fx + 18, fy - 11, 24, 21, -.2, 0, 6.283); g.fill();
      if (fg % 3 === 1) {
        g.fillStyle = '#456270'; g.beginPath(); g.moveTo(fx - 24, fy + 13);
        g.lineTo(fx - 12, fy - 4); g.lineTo(fx + 16, fy - 2); g.lineTo(fx + 28, fy + 18);
        g.lineTo(fx - 24, fy + 13); g.fill();
      }
    }
    this.bg = c;
    this.fog = null; this.noise = null; this.vignette = null;
    this.drawEdgeScene();
  },

  /* ------------------- 事件 -> 粒子 ------------------- */
  handleFx: function (e) {
    var P = this.parts;
    if (P.length > this.cfg.parts) return;
    var i, a;
    if (e.t === 'zdeath') {
      var n = e.r > 24 ? 14 : 8;
      for (i = 0; i < n; i++) {
        a = Math.random() * 6.283;
        P.push({ k: 'spark', c: '188,226,151', x: e.x, y: e.y, vx: Math.cos(a) * (40 + Math.random() * 90),
          vy: Math.sin(a) * (30 + Math.random() * 70) - 20, r: 1.5 + Math.random() * 3,
          life: 0.5 + Math.random() * 0.6, max: 1.1 });
      }
    } else if (e.t === 'boom') {
      P.push({ k: 'ring', x: e.x, y: e.y, r: 8, tr: e.r, life: 0.35, max: 0.35 });
      for (i = 0; i < 12; i++) {
        a = Math.random() * 6.283;
        P.push({ k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170,
          r: 2, life: 0.35, max: 0.35, c: '255,140,60' });
      }
      this.glitch = Math.max(this.glitch, 0.18);
    } else if (e.t === 'quake') {
      P.push({ k: 'ring', x: e.x, y: e.y, r: 10, tr: e.r, life: 0.42, max: 0.42, c: '255,205,110' });
      for (i = 0; i < 10; i++) {
        a = Math.random() * 6.283;
        P.push({ k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 120, vy: Math.sin(a) * 70,
          r: 2, life: 0.3, max: 0.3, c: '255,210,120' });
      }
    } else if (e.t === 'splash') {
      P.push({ k: 'ring', x: e.x, y: e.y, r: 8, tr: e.r, life: 0.3, max: 0.3, c: '125,215,255' });
      for (i = 0; i < 8; i++) {
        a = Math.random() * 6.283;
        P.push({ k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150,
          r: 1.8, life: 0.25, max: 0.25, c: '175,235,255' });
      }
    } else if (e.t === 'heal') {
      P.push({ k: 'ring', x: e.x, y: e.y, r: 5, tr: 24, life: 0.34, max: 0.34, c: '255,155,180' });
      for (i = 0; i < 5; i++) {
        a = -1.57 + (i - 2) * .38;
        P.push({ k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 45, vy: Math.sin(a) * 45,
          r: 1.6, life: 0.38, max: 0.38, c: '255,190,205' });
      }
    } else if (e.t === 'hitZombie') {
      for (i = 0; i < 3; i++) {
        a = Math.random() * 6.283;
        P.push({ k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90,
          r: 1.6, life: 0.18, max: 0.18, c: '255,220,150' });
      }
    } else if (e.t === 'crit') {
      P.push({ k: 'ring', x: e.x, y: e.y, r: 5, tr: 30, life: 0.24, max: 0.24, c: '255,210,120' });
      for (i = 0; i < 7; i++) {
        a = Math.random() * 6.283;
        P.push({ k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150,
          r: 2.2, life: 0.28, max: 0.28, c: '255,224,150' });
      }
    } else if (e.t === 'gateBreak') {
      P.push({ k: 'ring', x: e.x, y: e.y, r: 12, tr: 74, life: 0.42, max: 0.42, c: '145,215,220' });
    } else if (e.t === 'unitDead') {
      for (i = 0; i < 14; i++) {
        a = Math.random() * 6.283;
        P.push({ k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130,
          r: 2 + Math.random() * 2, life: 0.45, max: 0.45, c: '190,170,140' });
      }
      P.push({ k: 'ring', x: e.x, y: e.y, r: 10, tr: 46, life: 0.3, max: 0.3, c: '200,180,150' });
    } else if (e.t === 'hitUnit') {
      P.push({ k: 'ring', x: e.x, y: e.y, r: 7, tr: 26, life: 0.22, max: 0.22, c: '175,184,176' });
      for (i = 0; i < 5; i++) {
        a = -0.9 + i * 0.45;
        P.push({
          k: 'spark', x: e.x, y: e.y,
          vx: Math.cos(a) * (45 + Math.random() * 55),
          vy: Math.sin(a) * (35 + Math.random() * 45),
          r: 1.5 + Math.random(), life: 0.24, max: 0.24, c: '185,176,154',
        });
      }
    } else if (e.t === 'homeHit') {
      this.damageFlash[e.side] = 1;
      this.shake = Math.min(16, this.shake + 7);
      this.glitch = Math.max(this.glitch, e.side === 'p' ? 0.24 : 0.1);
      for (i = 0; i < 8; i++) {
        P.push({ k: 'spark', x: e.side === 'p' ? CONFIG.HOME_P_X + 16 : CONFIG.HOME_G_X - 16,
          y: 200 + Math.random() * 260, vx: (e.side === 'p' ? 1 : -1) * (60 + Math.random() * 90),
          vy: -60 + Math.random() * 120, r: 2, life: 0.5, max: 0.5, c: '255,120,70' });
      }
    } else if (e.t === 'pulse') {
      this.riftPulse = 1.6;
      this.shake = Math.min(14, this.shake + 5);
      this.flash = Math.max(this.flash, 0.22);
      this.flashColor = '180,30,30';
      this.glitch = Math.max(this.glitch, 0.13);
    }
  },

  /* ------------------- 主绘制 ------------------- */
  draw: function (scene, dt) {
    var ctx = this.ctx, W = CONFIG.W, H = CONFIG.H;
    this.t += dt;
    if (this.edgeLayer && typeof Game !== 'undefined') {
      var backdrop = Game.state === 'menu' || (typeof UI !== 'undefined' && UI.overlayMode === 'menu') ? 'home' : 'field';
      if (this.edgeLayer.dataset.scene !== backdrop) this.edgeLayer.dataset.scene = backdrop;
    }
    this.reduceAnimalMotion = typeof UI !== 'undefined' && UI.motionReduced ? UI.motionReduced() : false;
    this.sx = 0; this.sy = 0;
    var t = this.t;

    // 震屏
    this.shake *= Math.pow(0.0016, dt);
    if (this.shake < 0.2) this.shake = 0;
    this.sx = (Math.random() - 0.5) * this.shake;
    this.sy = (Math.random() - 0.5) * this.shake;
    this.damageFlash.p = Math.max(0, this.damageFlash.p - dt * 2.4);
    this.damageFlash.g = Math.max(0, this.damageFlash.g - dt * 2.4);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.riftPulse = Math.max(0, this.riftPulse - dt);
    this.glitch = Math.max(0, this.glitch - dt);

    var vw = this.vw, vh = this.vh, sc = this.scale;
    var gw = CONFIG.W * sc, gh = CONFIG.H * sc;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#12324c';
    ctx.fillRect(0, 0, vw, vh);
    if (this.edgeCanvas && this.edgeViewport) {
      var edge = this.edgeViewport;
      ctx.drawImage(this.edgeCanvas, edge.x * this.dpr, edge.y * this.dpr,
        vw * this.dpr, vh * this.dpr, 0, 0, vw, vh);
    }

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.offX + this.sx, this.offY + this.sy);
    ctx.scale(sc, sc);
    ctx.translate(this.fieldView.left || 0, this.fieldView.top);
    ctx.scale(this.fieldView.xScale || 1, this.fieldView.scale);
    ctx.translate(0, -CONFIG.TOP_H);
    ctx.drawImage(this.bg, -this.bgPad, 0, CONFIG.W + this.bgPad * 2, CONFIG.H);

    this.drawRift(scene, t);
    // 未开放通道的压暗先画，家园压在它上面，避免房子被「未开通」色块切断
    this.drawLockedLanes(scene, t);
    if (scene.coopMode) this.drawCoopHomes(scene, t);
    else {
      this.drawHome(scene, 'p', t);
      this.drawHome(scene, 'g', t);
    }
    if (scene.buildPhase) this.drawGridOverlay(scene, t);
    this.drawUnits(scene, t);
    this.drawZombies(scene, t);
    this.drawShots(scene);
    this.drawDust(t, dt);
    this.updateParts(dt);
    this.drawParts();
    if (!scene.buildPhase) this.drawSideDanger(scene, t);
    if (scene.flareTarget && !scene.buildPhase) {
      ctx.save(); ctx.fillStyle = 'rgba(250,202,121,.13)'; ctx.strokeStyle = '#faca79';
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(scene.flareTarget.x, scene.flareTarget.y, 118, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    // 保留受击反馈，取消全屏压黑、颗粒与故障闪屏。
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.flash > 0.01) {
      ctx.fillStyle = 'rgba(' + this.flashColor + ',' + (this.flash * 0.12) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }
  },

  updateWatcher: function (dt, scene) {
    var w = this.watcher;
    w.life = Math.max(0, w.life - dt);
    w.next -= dt;
    if (w.life > 0 || w.next > 0) return;
    w.next = 9 + Math.random() * 14;
    if (Math.random() > 0.62) return;
    w.life = 0.32 + Math.random() * 0.28;
    w.side = Math.random() < 0.5 ? -1 : 1;
    w.x = w.side < 0 ? -18 - Math.random() * 45 : CONFIG.W + 18 + Math.random() * 45;
    w.y = 250 + Math.random() * ((CONFIG.BOTTOM_Y - CONFIG.TOP_H) * 0.46);
    w.scale = 0.72 + Math.random() * 0.48;
  },

  drawWatcher: function (t) {
    var w = this.watcher;
    if (w.life <= 0) return;
    var ctx = this.ctx;
    var edge = Math.min(1, w.life * 7);
    var flicker = Math.sin(t * 43) > 0.72 ? 0.35 : 1;
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.scale(w.scale * (w.side < 0 ? 1 : -1), w.scale);
    ctx.globalAlpha = edge * flicker * 0.26;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, -48, 17, 22, -0.08, 0, 6.283);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-13, -32);
    ctx.quadraticCurveTo(-48, -3, -42, 104);
    ctx.lineTo(35, 104);
    ctx.quadraticCurveTo(38, 2, 13, -32);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = edge * 0.2;
    ctx.fillStyle = '#8f1812';
    ctx.beginPath(); ctx.arc(-6, -51, 1.8, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(7, -50, 1.4, 0, 6.283); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  drawDust: function (t, dt) {
    var ctx = this.ctx, P = this.bgPad;
    for (var i = 0; i < this.dust.length; i++) {
      var p = this.dust[i];
      if (p.k === 'stain') continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x > CONFIG.W + P || p.y < CONFIG.TOP_H) {
        p.x = -P - Math.random() * 80;
        p.y = CONFIG.TOP_H + Math.random() * (CONFIG.BOTTOM_Y - CONFIG.TOP_H);
      }
      var drift = Math.sin(t * 0.7 + p.phase) * 0.04;
      ctx.globalAlpha = p.a * (0.75 + Math.sin(t + p.phase) * 0.25);
      ctx.fillStyle = '#d5cbb9';
      ctx.beginPath(); ctx.arc(p.x, p.y + drift * 30, p.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  drawGlitch: function (vw, vh) {
    if (this.glitch <= 0.01) return;
    var ctx = this.ctx, a = Math.min(0.34, this.glitch * 1.4);
    ctx.globalAlpha = a;
    for (var i = 0; i < 4; i++) {
      var y = Math.random() * vh;
      var h = 1 + Math.random() * 5;
      ctx.fillStyle = i % 2 ? 'rgba(120,12,15,.6)' : 'rgba(130,190,190,.22)';
      ctx.fillRect((Math.random() - 0.5) * 24, y, vw, h);
    }
    ctx.globalAlpha = 1;
  },

  drawSkyGlow: function (t) {
    var ctx = this.ctx;
    var g = this.glow('#5a1616', 512);
    ctx.globalAlpha = 0.55 + Math.sin(t * 0.9) * 0.06 + this.riftPulse * 0.3;
    ctx.drawImage(g, CONFIG.RIFT_X - 300, -120, 600, 600);
    ctx.globalAlpha = 1;
  },

  riftSprite: function () {
    var height = CONFIG.RIFT_BOTTOM - CONFIG.RIFT_TOP;
    var k = Math.max(1, Math.min(2, (this.dpr || 1) * (this.scale || 1)));
    var key = 'rift-courtyard|' + height + '|' + k;
    if (this._spriteCache[key]) return this._spriteCache[key];
    var c = document.createElement('canvas'); c.width = Math.ceil(160 * k); c.height = Math.ceil(height * k);
    var ctx = c.getContext('2d'); ctx.scale(k, k);
    ctx.globalAlpha = .18; ctx.drawImage(this.glow('#ef9954', 256), -10, 0, 180, height); ctx.globalAlpha = 1;
    var left = [], right = [], rnd = mulberry32(60610);
    for (var y = 0; y <= height; y += 12) {
      var taper = Math.min(1, y / 38, (height - y) / 38);
      var offset = Math.sin(y * .025) * 4 + (rnd() - .5) * 3;
      var width = (5 + rnd() * 3) * Math.max(0, taper);
      left.push([80 + offset - width, y]); right.push([80 + offset + width, y]);
    }
    left.push([80, height]); right.push([80, height]);
    ctx.beginPath(); ctx.moveTo(left[0][0], 0);
    for (var l = 1; l < left.length; l++) ctx.lineTo(left[l][0], left[l][1]);
    for (var r = right.length - 1; r >= 0; r--) ctx.lineTo(right[r][0], right[r][1]);
    ctx.closePath();
    var color = ctx.createLinearGradient(68, 0, 92, 0);
    color.addColorStop(0, '#d37c49'); color.addColorStop(.3, '#ed9950');
    color.addColorStop(.52, '#ffc47c'); color.addColorStop(.75, '#ef9b55'); color.addColorStop(1, '#d6814b');
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(251,179,105,.32)'; ctx.lineWidth = 2; ctx.stroke();
    // 静态柔光点，没有快速变形和雷电闪烁。
    ctx.fillStyle = 'rgba(255,214,147,.55)';
    for (var p = 0; p < 10; p++) {
      ctx.beginPath(); ctx.arc(80 + (rnd() - .5) * 56, 28 + rnd() * (height - 56), 1 + rnd() * 1.8, 0, 6.283); ctx.fill();
    }
    var rec = { img: c, height: height };
    this._spriteCache[key] = rec;
    return rec;
  },

  drawRift: function (scene, t) {
    var ctx = this.ctx, cx = CONFIG.RIFT_X, top = CONFIG.RIFT_TOP, bot = CONFIG.RIFT_BOTTOM;
    var rift = this.riftSprite();
    ctx.drawImage(rift.img, cx - 80, top, 160, rift.height);
    // 保留脉冲状态的柔和提示，裂口轮廓本身保持不变。
    var pulse = Math.min(1, this.riftPulse + (scene.battle ? scene.battle.pulseQueue * .05 : 0));
    if (pulse > .01) {
      ctx.globalAlpha = pulse * .08;
      ctx.drawImage(this.glow('#e6a268', 256), cx - 80, top, 160, bot - top);
      ctx.globalAlpha = 1;
    }
    for (var i = 0; i < this.embers.length; i++) {
      var e = this.embers[i];
      e.y -= e.v * .016;
      if (e.y < top) { e.y = bot; e.x = cx + (Math.random() - .5) * 54; }
      ctx.globalAlpha = .08 + e.a * .11;
      ctx.fillStyle = '#efbc78';
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  homeGeom: function (side) {
    var isP = side === 'p';
    var x0 = isP ? 6 : CONFIG.W - 158;
    return { x0: x0, x1: x0 + 152, cx: x0 + 76, front: isP ? x0 + 152 : x0 };
  },

  drawCoopHomes: function (scene, t) {
    var homes = scene.coopHomes || [];
    var ctx = this.ctx;
    for (var i = 0; i < homes.length; i++) {
      var home = homes[i];
      var side = home.side || coopSideForSeat(home.seat);
      var sideSeat = home.sideSeat === undefined ? coopLocalSeat(home.seat) : home.sideSeat;
      var center = CONFIG.LANES[sideSeat * CONFIG.COOP_LANES_PER_PLAYER + 1];
      var geom = this.homeGeom(side);
      var scale = 0.55;
      var targetX = side === 'p' ? 27 : CONFIG.W - 27 - 152 * scale;
      var offsetX = targetX - geom.x0 * scale;
      ctx.save();
      ctx.translate(offsetX, center - 368 * scale);
      ctx.scale(scale, scale);
      this.drawHome({ renderLocalHome: true, battle: {
        hp: { p: side === 'p' ? home.hp : home.maxHp, g: side === 'g' ? home.hp : home.maxHp },
        maxHp: { p: side === 'p' ? home.maxHp : CONFIG.HOME_HP, g: side === 'g' ? home.maxHp : CONFIG.HOME_HP },
      } }, side, t);
      ctx.restore();
      ctx.fillStyle = home.seat === scene.coopSeat ? '#f5d18a' : '#a9bdc2';
      ctx.font = this.fx('700', 12, 12);
      ctx.textAlign = 'center';
      ctx.fillText(home.name || '', side === 'p' ? 106 : CONFIG.W - 106,
        CONFIG.LANES[sideSeat * CONFIG.COOP_LANES_PER_PLAYER] - CONFIG.GRID_LANE_PITCH / 2 + 19, 180);
    }
    ctx.textAlign = 'left';
  },

  /* 小屋静态美术烘为精灵，只有血量、受损痕迹与提示留在每帧。 */
  homeSprite: function (side, lit) {
    var k = Math.max(1, Math.min(2, (this.dpr || 1) * (this.scale || 1)));
    var key = 'courtyard-home|' + side + '|' + (lit ? 1 : 0) + '|' + k;
    if (this._spriteCache[key]) return this._spriteCache[key];
    var c = document.createElement('canvas'); c.width = Math.ceil(196 * k); c.height = Math.ceil(294 * k);
    var ctx = c.getContext('2d'); ctx.scale(k, k); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    var isP = side === 'p', x0 = 18, x1 = 170, cx = 94, wallTop = 106, wallBot = 268;
    var outline = '#274454', timber = isP ? '#a67b4d' : '#6594b4';
    var wall = isP ? '#dabb88' : '#aecddd', roof = isP ? '#3e5873' : '#4e80a9';
    ctx.fillStyle = isP ? '#a68b71' : '#799cb4';
    this.roundRectPath(ctx, x0 + 22, wallTop - 98, 23, 46, 3); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = isP ? '#bfa184' : '#a2bfd1';
    this.roundRectPath(ctx, x0 + 17, wallTop - 102, 33, 9, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(40,68,81,.28)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0 + 23, wallTop - 82); ctx.lineTo(x0 + 44, wallTop - 82);
    ctx.moveTo(x0 + 31, wallTop - 81); ctx.lineTo(x0 + 31, wallTop - 92); ctx.stroke();
    // 外檐、瓦片和山墙形成童话小屋的轮廓。
    ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(x0 - 12, wallTop + 5);
    ctx.lineTo(cx - 3, wallTop - 86); ctx.quadraticCurveTo(cx, wallTop - 91, cx + 3, wallTop - 86);
    ctx.lineTo(x1 + 12, wallTop + 5); ctx.quadraticCurveTo(x1 + 8, wallTop + 11, x1 - 2, wallTop + 8);
    ctx.lineTo(x0 + 2, wallTop + 8); ctx.quadraticCurveTo(x0 - 8, wallTop + 11, x0 - 12, wallTop + 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = isP ? '#63809a' : '#7caccc'; ctx.lineWidth = 2;
    for (var row = 0; row < 3; row++) {
      var roofY = wallTop - 63 + row * 21, half = 22 + row * 21;
      ctx.beginPath(); ctx.moveTo(cx - half, roofY); ctx.lineTo(cx + half, roofY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + (row % 2 ? -11 : 12), roofY);
      ctx.lineTo(cx + (row % 2 ? -13 : 14), roofY + 15); ctx.stroke();
    }
    ctx.fillStyle = wall; this.roundRectPath(ctx, x0, wallTop, 152, 162, 11); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + 12, wallTop + 4); ctx.lineTo(cx, wallTop - 66);
    ctx.lineTo(x1 - 12, wallTop + 4); ctx.closePath(); ctx.fill(); ctx.strokeStyle = timber; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = isP ? '#efd5a6' : '#cee5ed'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0 + 20, wallTop + 1); ctx.lineTo(cx, wallTop - 58); ctx.lineTo(x1 - 20, wallTop + 1); ctx.stroke();
    // 暖色阁楼窗：右侧蓝屋也亮起同样的暖灯。
    ctx.fillStyle = lit ? '#ffda88' : '#6f8a92';
    this.roundRectPath(ctx, cx - 13, wallTop - 37, 26, 34, 12); ctx.fill();
    ctx.strokeStyle = timber; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, wallTop - 34); ctx.lineTo(cx, wallTop - 5); ctx.stroke();
    ctx.strokeStyle = isP ? 'rgba(131,105,69,.24)' : 'rgba(65,117,144,.24)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0 + 7, wallTop + 85); ctx.lineTo(x0 + 39, wallTop + 85);
    ctx.moveTo(x1 - 41, wallTop + 111); ctx.lineTo(x1 - 8, wallTop + 111);
    ctx.moveTo(x0 + 15, wallTop + 86); ctx.lineTo(x0 + 15, wallTop + 97); ctx.stroke();
    for (var w = 0; w < 2; w++) {
      var wx = x0 + 21 + w * 78, wy = wallTop + 25;
      ctx.fillStyle = lit ? '#ffe19b' : '#708a92'; this.roundRectPath(ctx, wx, wy, 32, 36, 6); ctx.fill();
      ctx.strokeStyle = timber; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx + 16, wy + 2); ctx.lineTo(wx + 16, wy + 34);
      ctx.moveTo(wx + 1, wy + 18); ctx.lineTo(wx + 31, wy + 18); ctx.stroke();
      ctx.fillStyle = isP ? '#b48955' : '#80aac3'; this.roundRectPath(ctx, wx - 3, wy + 37, 38, 5, 2); ctx.fill();
    }
    // 门廊是低矮的小雨棚与木柱，不再是一根贯穿屋身的长柱。
    ctx.fillStyle = isP ? '#ae7c4c' : '#5d8eb0'; this.roundRectPath(ctx, cx - 23, wallBot - 69, 46, 69, 9); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(47,69,77,.22)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 8, wallBot - 57); ctx.lineTo(cx - 8, wallBot - 5);
    ctx.moveTo(cx + 8, wallBot - 57); ctx.lineTo(cx + 8, wallBot - 5); ctx.stroke();
    ctx.fillStyle = '#f9d783'; ctx.beginPath(); ctx.arc(cx + 13, wallBot - 30, 3, 0, 6.283); ctx.fill();
    ctx.fillStyle = timber; this.roundRectPath(ctx, cx - 31, wallBot - 75, 5, 76, 2); ctx.fill();
    this.roundRectPath(ctx, cx + 26, wallBot - 75, 5, 76, 2); ctx.fill();
    ctx.fillStyle = roof; ctx.beginPath(); ctx.moveTo(cx - 38, wallBot - 70); ctx.lineTo(cx - 28, wallBot - 88);
    ctx.lineTo(cx + 28, wallBot - 88); ctx.lineTo(cx + 38, wallBot - 70); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = isP ? '#c1a474' : '#91b8cb'; this.roundRectPath(ctx, cx - 38, wallBot, 76, 8, 3); ctx.fill();
    // 小门灯、门口矮栏和草叶一同烘焙。
    var lampX = cx - 49, lampY = wallBot - 62;
    if (lit) { ctx.globalAlpha = .27; ctx.drawImage(this.glow('#f7c979', 64), lampX - 24, lampY - 17, 64, 64); ctx.globalAlpha = 1; }
    ctx.fillStyle = '#3b5664'; this.roundRectPath(ctx, lampX, lampY, 13, 22, 3); ctx.fill();
    ctx.fillStyle = lit ? '#ffe19b' : '#708a92'; this.roundRectPath(ctx, lampX + 3, lampY + 3, 7, 15, 2); ctx.fill();
    ctx.strokeStyle = '#3b5664'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lampX + 6, lampY); ctx.lineTo(lampX + 6, lampY - 7); ctx.stroke();
    var fenceX = isP ? x1 + 5 : x0 - 5;
    ctx.strokeStyle = timber; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(fenceX, wallBot - 40); ctx.lineTo(fenceX, wallBot + 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fenceX - 7, wallBot - 25); ctx.lineTo(fenceX + 7, wallBot - 25); ctx.stroke();
    ctx.strokeStyle = '#638b71'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0 + 8, wallBot + 3); ctx.lineTo(x0 + 5, wallBot - 9);
    ctx.moveTo(x0 + 8, wallBot + 3); ctx.lineTo(x0 + 14, wallBot - 5);
    ctx.moveTo(x1 - 8, wallBot + 3); ctx.lineTo(x1 - 11, wallBot - 8); ctx.stroke();
    var rec = { img: c };
    this._spriteCache[key] = rec;
    return rec;
  },

  drawHome: function (scene, side, t) {
    var ctx = this.ctx;
    var b = scene.battle;
    var hpFrac = b ? b.hp[side] / b.maxHp[side] : 1;
    var isP = side === 'p';
    var G = this.homeGeom(side);
    // 房子跟着战场高度走：主画面变高时自动往下挪，保持视觉居中
    var wallTop = Math.round(CONFIG.TOP_H + (CONFIG.BOTTOM_Y - CONFIG.TOP_H) * 0.39);
    var wallBot = wallTop + 162;
    var warm = isP ? '#f2bc66' : '#94ccef';
    var warmRGB = isP ? '255,205,120' : '150,230,255';

    // 地灯
    if (!this.battleScene || scene.renderLocalHome || scene.menuArt) {
      var gl = this.glow(warm, 256);
      ctx.globalAlpha = 0.18 + hpFrac * 0.12;
      ctx.drawImage(gl, G.cx - 150, wallTop - 12, 300, 300);
      ctx.globalAlpha = 1;
      var cottage = this.homeSprite(side, hpFrac > .35);
      ctx.drawImage(cottage.img, G.x0 - 18, wallTop - 106, 196, 294);
    }

    // 破损
    var dmg = 1 - hpFrac;
    if (dmg > 0.02) {
      ctx.strokeStyle = 'rgba(0,0,0,' + (0.35 + dmg * 0.5) + ')';
      ctx.lineWidth = 1 + dmg * 2.5;
      var rr = mulberry32(99 + (isP ? 0 : 5));
      for (var c = 0; c < Math.floor(dmg * 4) + 1; c++) {
        var sx = G.x0 + rr() * 152, sy = wallTop + rr() * (wallBot - wallTop);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        for (var k = 0; k < 3; k++) { sx += (rr() - 0.5) * 34; sy += (rr() - 0.5) * 30; ctx.lineTo(sx, sy); }
        ctx.stroke();
      }
    }

    // 首页插画只展示小屋，战场才展示状态。
    if (scene.menuArt) return;
    // 正式场景的主屋血量由HUD显示；合作局部小屋仍各自显示状态。
    if (!this.battleScene || scene.renderLocalHome) {
      var bw = 152, bx = G.x0, by = wallBot + 12;
      ctx.fillStyle = '#244354';
      this.roundRectPath(ctx, bx - 2, by - 2, bw + 4, 14, 6); ctx.fill();
      var hpCol = hpFrac > 0.55 ? '#91c888' : hpFrac > 0.25 ? '#efc26e' : '#e88c76';
      ctx.fillStyle = hpCol;
      ctx.fillRect(bx, by, bw * hpFrac, 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx - 2, by - 2, bw + 4, 14);
    }

    // 受击红光
    var df = this.damageFlash[side];
    if (df > 0.01) {
      ctx.globalAlpha = df * 0.35;
      ctx.fillStyle = '#ffd18a';
      ctx.fillRect(G.x0 - 10, wallTop - 90, 172, wallBot - wallTop + 110);
      ctx.globalAlpha = 1;
    }
  },

  drawFog: function (t) {
    var ctx = this.ctx, P = this.bgPad;
    if (!this.fog) return;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.translate(-t * 9 % 512, -t * 3 % 512);
    ctx.fillStyle = this.fog;
    ctx.fillRect(-P, 0, CONFIG.W + P * 2 + 512, CONFIG.BOTTOM_Y + 512);
    ctx.restore();
  },
  drawFogFront: function (t) {
    var ctx = this.ctx, P = this.bgPad;
    if (!this.fog) return;
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.translate(-(t * 21) % 512, -(t * 7) % 512);
    ctx.fillStyle = this.fog;
    ctx.fillRect(-P, CONFIG.TOP_H, CONFIG.W + P * 2 + 512, CONFIG.BOTTOM_Y - CONFIG.TOP_H + 400);
    ctx.restore();
  },
  /* 顶部/底部的压暗，铺满整个屏幕（在屏幕坐标系里画） */
  drawMidVignette: function (vw, vh) {
    var ctx = this.ctx, sc = this.scale;
    var y0 = this.offY + CONFIG.TOP_H * sc;
    var y1 = this.offY + CONFIG.BOTTOM_Y * sc;
    var g = ctx.createLinearGradient(0, y0, 0, y0 + 70 * sc);
    g.addColorStop(0, 'rgba(4,5,8,0.95)');
    g.addColorStop(1, 'rgba(4,5,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, vw, 72 * sc);
    var g2 = ctx.createLinearGradient(0, y1 - 70 * sc, 0, y1);
    g2.addColorStop(0, 'rgba(4,5,8,0)');
    g2.addColorStop(1, 'rgba(4,5,8,0.95)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, y1 - 72 * sc, vw, 72 * sc);
  },

  drawSideDanger: function (scene, t) {
    var b = scene.battle;
    if (!b) return;
    var ctx = this.ctx;
    ['p', 'g'].forEach(function (side) {
      var list = b.zBuckets[side], near = 0;
      for (var i = 0; i < list.length; i++) for (var j = 0; j < list[i].length; j++) {
        var z = list[i][j];
        var d = Math.abs(z.x - (side === 'p' ? CONFIG.HOME_P_X : CONFIG.HOME_G_X));
        if (d < 230) near++;
      }
      if (near === 0) return;
      var a = Math.min(0.5, near * 0.045) * (0.7 + Math.sin(t * 6) * 0.3);
      var x = side === 'p' ? 0 : CONFIG.W - 120;
      var g = ctx.createLinearGradient(x, 0, x + 120, 0);
      var col = side === 'p' ? '255,40,30' : '120,220,255';
      g.addColorStop(side === 'p' ? 0 : 1, 'rgba(' + col + ',' + a + ')');
      g.addColorStop(side === 'p' ? 1 : 0, 'rgba(' + col + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, CONFIG.TOP_H, 120, CONFIG.BOTTOM_Y - CONFIG.TOP_H);
    });
  },

  /* ------------------- 建造网格 ------------------- */
  drawLaneLock: function (ctx, x, y) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = '#adc5cd'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(0, -3, 4.5, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#abc3ca'; this.roundRectPath(ctx, -7, -3, 14, 11, 3); ctx.fill();
    ctx.fillStyle = '#526f7c'; ctx.beginPath(); ctx.arc(0, 1, 1.7, 0, 6.283); ctx.fill();
    ctx.fillRect(-.7, 1, 1.4, 3); ctx.restore();
  },

  drawLockedLanes: function (scene, t) {
    if (scene.coopMode) {
      var ownSide = scene.coopSide || coopSideForSeat(scene.coopSeat || 0);
      var ownSeat = coopLocalSeat(scene.coopSeat || 0);
      var homes = scene.coopHomes || [];
      var coopCtx = this.ctx;
      var sides = ['p', 'g'];
      for (var si = 0; si < sides.length; si++) {
        var side = sides[si];
        var x = side === 'p' ? 0 : CONFIG.RIFT_X + CONFIG.RIFT_HW;
        var w = side === 'p' ? CONFIG.RIFT_X - CONFIG.RIFT_HW : CONFIG.W - x;
        for (var sideSeat = 0; sideSeat < CONFIG.COOP_PLAYERS_PER_SIDE; sideSeat++) {
          var shown = scene.buildPhase
            ? side === ownSide && sideSeat === ownSeat
            : homes.some(function (home) {
              return (home.side || coopSideForSeat(home.seat)) === side &&
                (home.sideSeat === undefined ? coopLocalSeat(home.seat) : home.sideSeat) === sideSeat;
            });
          if (shown) continue;
          for (var localLane = 0; localLane < CONFIG.COOP_LANES_PER_PLAYER; localLane++) {
            var lane = sideSeat * CONFIG.COOP_LANES_PER_PLAYER + localLane;
            coopCtx.fillStyle = 'rgba(25,56,72,0.22)';
            coopCtx.fillRect(x, CONFIG.LANES[lane] - CONFIG.GRID_LANE_PITCH / 2,
              w, CONFIG.GRID_LANE_PITCH);
            this.drawLaneLock(coopCtx, x + w / 2, CONFIG.LANES[lane]);
          }
        }
      }
      return;
    }
    if (!scene.battle || scene.roundIndex >= 2) return;
    var ctx = this.ctx;
    var active = {};
    unlockedLanes(scene.roundIndex).forEach(function (l) { active[l] = true; });
    var nextRound = scene.roundIndex + 2;
    /* 英文比中文长，标签又被挤在通道角上（可用宽度约 84 逻辑像素），
       所以英文走更短的措辞并降一档字号。 */
    var isEn = typeof I18N !== 'undefined' && I18N.lang === 'en';
    var nextLabel = nextRound >= 3
      ? L('canvas.allLanesRound3', null, '第3回合开放7–9路')
      : L('canvas.lanesEarlier', { n: nextRound }, '第' + nextRound + '回合开放4–6路');
    var areas = [
      [0, CONFIG.RIFT_X - CONFIG.RIFT_HW],
      [CONFIG.RIFT_X + CONFIG.RIFT_HW, CONFIG.W],
    ];

    for (var lane = 0; lane < CONFIG.LANES.length; lane++) {
      if (active[lane]) continue;
      var top = CONFIG.LANES[lane] - CONFIG.GRID_LANE_PITCH / 2;
      var bottom = CONFIG.LANES[lane] + CONFIG.GRID_LANE_PITCH / 2;
      var h = bottom - top;

      for (var ai = 0; ai < areas.length; ai++) {
        var x = areas[ai][0], w = areas[ai][1] - areas[ai][0];
        ctx.fillStyle = 'rgba(25,56,72,0.25)';
        ctx.fillRect(x, top, w, h);
        this.drawLaneLock(ctx, x + w / 2, top + h / 2 - 2);

        ctx.strokeStyle = 'rgba(122,155,167,0.06)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, top + 1, w - 2, h - 2);

        if (lane === unlockedLaneCount(scene.roundIndex)) {
          var labelX = ai === 0 ? x + w - 84 : x + 84;
          var labelY = top + h / 2;
          ctx.fillStyle = '#d9e5e5';
          ctx.font = this.fx('600', isEn ? 10 : 11, 12);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(nextLabel, labelX, labelY);
        }
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  },

  gridCellRect: function (col, lane, typeId, side) {
    var cols = side === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS;
    var rows = unitFootprintLanes(typeId, lane);
    return {
      x: cols[col] - CONFIG.GRID_CELL_W / 2,
      y: CONFIG.LANES[rows[0]] - CONFIG.GRID_LANE_PITCH / 2 + 3,
      w: CONFIG.GRID_CELL_W,
      h: rows.length * CONFIG.GRID_LANE_PITCH - 6,
    };
  },

  drawRangePreview: function (typeId, side, col, lane, stats, alpha) {
    var d = UNITS[typeId], ctx = this.ctx;
    if (!d || col < 0 || lane < 0) return;
    var x = (side === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS)[col];
    var y = CONFIG.LANES[lane];
    var radial = d.rangeType === 'radius' || (!!d.radius && typeId !== 'flame' && typeId !== 'venom');
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.glow || d.color;
    ctx.strokeStyle = d.glow || d.color;
    ctx.lineWidth = 1.6;
    if (radial && stats.radius > 0) {
      ctx.beginPath(); ctx.arc(x, y, stats.radius, 0, Math.PI * 2);
      ctx.fillStyle = this.rgba(d.glow || d.color, 0.10);
      ctx.fill();
      ctx.setLineDash([7, 6]);
      ctx.stroke();
    } else if ((typeId === 'flame' || typeId === 'venom') && stats.range > 0) {
      var dir = attackForwardSign(side);
      var endX = x + dir * stats.range;
      var spread = Math.max(4, stats.spray);
      ctx.beginPath();
      ctx.moveTo(x, y - spread);
      ctx.lineTo(endX, y - spread);
      ctx.lineTo(endX, y + spread);
      ctx.lineTo(x, y + spread);
      ctx.closePath();
      ctx.fillStyle = this.rgba(d.glow || d.color, 0.13);
      ctx.fill();
      ctx.setLineDash([7, 6]);
      ctx.beginPath(); ctx.moveTo(x, y - spread); ctx.lineTo(endX, y - spread);
      ctx.moveTo(x, y + spread); ctx.lineTo(endX, y + spread); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(endX, y - spread); ctx.lineTo(endX, y + spread); ctx.stroke();
    }
    ctx.restore();
  },

  drawGridOverlay: function (scene, t) {
    var ctx = this.ctx;
    var isEn = typeof I18N !== 'undefined' && I18N.lang === 'en';
    var unlocked = {};
    unlockedCols(scene.roundIndex).forEach(function (c) { unlocked[c] = true; });
    var laneUnlocked = {};
    unlockedLanes(scene.roundIndex).forEach(function (l) { laneUnlocked[l] = true; });
    var battle = scene.battle;
    var armed = scene.armedType;
    var side = scene.coopMode ? (scene.coopSide || 'p') : 'p';
    var cols = side === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS;
    var coopLaneStart = scene.coopMode ? coopLaneOffset(scene.coopSeat || 0) : 0;
    if (armed && scene.coins !== undefined && UNITS[armed] && scene.coins < UNITS[armed].cost) armed = null;

    for (var c = 0; c < cols.length; c++) {
      if (!unlocked[c]) continue;
      for (var l = 0; l < CONFIG.LANES.length; l++) {
        if (scene.coopMode
            ? (l < coopLaneStart || l >= coopLaneStart + CONFIG.COOP_LANES_PER_PLAYER)
            : !laneUnlocked[l]) continue;
        var rect = this.gridCellRect(c, l, null, side);
        var occ = battle && battle.occupied(side, c, l);
        if (armed && !occ) {
          var pulse = 0.5 + Math.sin(t * 3.2 + (c * 5 + l) * 0.7) * 0.5;
          ctx.fillStyle = 'rgba(240,196,99,' + (0.045 + pulse * 0.045) + ')';
          this.roundRectPath(ctx, rect.x + 3, rect.y + 3, rect.w - 6, rect.h - 6, 10); ctx.fill();
          ctx.strokeStyle = 'rgba(255,214,126,' + (0.26 + pulse * 0.18) + ')';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
          ctx.fillStyle = occ ? 'rgba(69,103,113,.08)' : 'rgba(95,131,139,.18)';
          this.roundRectPath(ctx, rect.x + 3, rect.y + 3, rect.w - 6, rect.h - 6, 10); ctx.fill();
          ctx.strokeStyle = occ ? 'rgba(134,165,169,0.08)' : 'rgba(166,190,190,0.34)';
          ctx.lineWidth = occ ? 1 : 1.2;
          ctx.stroke();
        }
      }
    }

    // 未开放列交由真实解锁规则控制，不铺满屏幕的虚线工程网格。

    if (scene.tutorialActive && scene.tutorialStep < 7 && scene.tutorialStep % 2 === 0 && scene.tutorialTarget) {
      var tt = scene.tutorialTarget;
      var tutorialRect = this.gridCellRect(tt.col, tt.lane, null, 'p');
      var tx = CONFIG.P_COLS[tt.col], ty = CONFIG.LANES[tt.lane];
      var tutorialPulse = 0.48 + Math.sin(t * 4) * 0.22;
      ctx.fillStyle = 'rgba(240,196,99,' + (0.13 + tutorialPulse * 0.10) + ')';
      ctx.fillRect(tutorialRect.x, tutorialRect.y, tutorialRect.w, tutorialRect.h);
      ctx.strokeStyle = 'rgba(255,214,126,' + (0.55 + tutorialPulse * 0.35) + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(tutorialRect.x, tutorialRect.y, tutorialRect.w, tutorialRect.h);
      ctx.fillStyle = 'rgba(255,225,164,' + (0.72 + tutorialPulse * 0.25) + ')';
      ctx.font = this.fx('700', isEn ? 12 : 13, 14);
      ctx.textAlign = 'center';
      ctx.fillText(L('canvas.placeHere', null, '放置区'), tx, tutorialRect.y - 9);
      ctx.textAlign = 'left';
    }

    var hc = scene.hoverCell;
    if (hc && hc.side === side) {
      var hoverUnit = null;
      if (!armed && battle) {
        for (var hui = 0; hui < battle.units.length; hui++) {
          var hoverCandidate = battle.units[hui];
          if (!hoverCandidate.dead && hoverCandidate.side === side && hoverCandidate.col === hc.col &&
              unitFootprintLanes(hoverCandidate.type, hoverCandidate.lane).indexOf(hc.lane) >= 0) {
            hoverUnit = hoverCandidate; break;
          }
        }
      }
      var hoverRect = this.gridCellRect(hc.col, hoverUnit ? hoverUnit.lane : hc.lane,
        armed || (hoverUnit && hoverUnit.type), side);
      ctx.fillStyle = hc.valid ? 'rgba(120,230,160,0.18)' : 'rgba(230,90,70,0.18)';
      ctx.fillRect(hoverRect.x, hoverRect.y, hoverRect.w, hoverRect.h);
      ctx.strokeStyle = hc.valid ? 'rgba(140,255,180,0.8)' : 'rgba(255,110,90,0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(hoverRect.x, hoverRect.y, hoverRect.w, hoverRect.h);
      if (armed && UNITS[armed]) {
        var placedStats = unitCombatStats(armed, 1, null, scene.playerMods || {});
        this.drawRangePreview(armed, side, hc.col, hc.lane, placedStats, hc.valid ? 0.78 : 0.38);
      }
    }

    var pending = scene.pendingPlacement;
    if (pending && pending.preview) {
      var pendingSide = pending.side || side;
      var pendingRect = this.gridCellRect(pending.col, pending.lane, pending.type, pendingSide);
      var glow = 0.55 + Math.sin(t * 5) * 0.16;
      ctx.fillStyle = 'rgba(96,203,218,0.18)';
      ctx.fillRect(pendingRect.x, pendingRect.y, pendingRect.w, pendingRect.h);
      ctx.strokeStyle = 'rgba(144,238,246,' + glow + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(pendingRect.x, pendingRect.y, pendingRect.w, pendingRect.h);
      ctx.save();
      ctx.globalAlpha = 0.62;
      this.drawUnit(pending.preview, t, scene);
      ctx.restore();
    }

    var selected = scene.selectedCell, selectedUnit = null;
    if (selected && battle) {
      for (var ui = 0; ui < battle.units.length; ui++) {
        var candidate = battle.units[ui];
        if (!candidate.dead && candidate.side === side && candidate.col === selected.col && candidate.lane === selected.lane) {
          selectedUnit = candidate; break;
        }
      }
    }
    if (selectedUnit && !armed) {
      var selectedRect = this.gridCellRect(selectedUnit.col, selectedUnit.lane, selectedUnit.type, side);
      ctx.strokeStyle = 'rgba(220,245,255,0.82)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(selectedRect.x, selectedRect.y, selectedRect.w, selectedRect.h);
      ctx.setLineDash([]);
      this.drawRangePreview(selectedUnit.type, side, selectedUnit.col, selectedUnit.lane, {
        range: selectedUnit.range, radius: selectedUnit.radius, spray: selectedUnit.spray,
      }, 0.64);
    }
  },

  readableFont: function (logicalSize, minimumCssSize) {
    var scale = this.scale || 1;
    return Math.max(logicalSize, minimumCssSize / scale);
  },

  /* 中英文各用一套字体栈。画布 ctx.font 只认系统字体名，用不了 CSS 变量，
     所以这里自带一份；选哪一份只看 I18N.lang，与平台无关。 */
  fontStack: function () {
    return (typeof I18N !== 'undefined' && I18N.lang === 'en')
      ? '"Helvetica Neue", Helvetica, Arial, sans-serif'
      : '"PingFang SC", "Heiti SC", sans-serif';
  },

  /* 组装 ctx.font 字符串：粗细 + 实测字号 + 当前语言的字体栈。 */
  fx: function (weight, logicalSize, minimumCssSize) {
    return weight + ' ' + this.readableFont(logicalSize, minimumCssSize) + 'px ' + this.fontStack();
  },

  /* 建筑头顶的作战指示灯：暗 = 空转，亮 = 射程内有目标，闪白 = 正在造成伤害。 */
  drawActivityMark: function (ctx, u, size, color) {
    var firing = u.actT > 0 ? Math.min(1, u.actT / 0.24) : 0;
    var y = size + 11;
    ctx.globalAlpha = firing > 0 ? 0.95 : (u.engaged ? 0.52 : 0.14);
    ctx.fillStyle = firing > 0 ? '#ffffff' : color;
    ctx.beginPath();
    ctx.moveTo(0, y + 5);
    ctx.lineTo(4.4, y - 1);
    ctx.lineTo(-4.4, y - 1);
    ctx.closePath();
    ctx.fill();
    if (firing > 0) {
      ctx.globalAlpha = 0.45 * firing;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, y + 1, 8 + (1 - firing) * 7, 0, 6.283);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  /* ------------------- 单位 ------------------- */
  drawUnits: function (scene, t) {
    var b = scene.battle;
    if (!b) return;
    var ctx = this.ctx;
    for (var i = 0; i < b.units.length; i++) {
      var u = b.units[i];
      if (u.dead) continue;
      this.drawUnit(u, t, scene);
    }
  },

  /* 首页插画复用真实伙伴与小屋。固定种子静态绘制并缓存，不进入动画循环。 */
  menuArt: function () {
    if (this._menuArt) return this._menuArt;
    var c = document.createElement('canvas');
    c.width = 720; c.height = 540;
    var ctx = c.getContext('2d'), keep = this.ctx;
    var rnd = mulberry32(10506);
    this.ctx = ctx;
    try {
      var sky = ctx.createLinearGradient(0, 0, 0, 540);
      sky.addColorStop(0, '#173d62'); sky.addColorStop(0.64, '#34617a'); sky.addColorStop(1, '#204852');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 720, 540);
      ctx.fillStyle = 'rgba(249,238,202,.64)';
      for (var s = 0; s < 42; s++) {
        ctx.beginPath(); ctx.arc(24 + rnd() * 675, 15 + rnd() * 235, .9 + rnd() * 1.2, 0, 6.283); ctx.fill();
      }
      ctx.drawImage(this.glow('#f6e6b5', 128), 576, 1, 128, 128);
      ctx.fillStyle = '#f6ebc8'; ctx.beginPath(); ctx.arc(640, 64, 24, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#dedcba'; ctx.beginPath(); ctx.arc(633, 58, 5, 0, 6.283); ctx.fill();
      // 两层简化远树。
      for (var layer = 0; layer < 2; layer++) {
        ctx.fillStyle = layer ? '#234d60' : '#2c5772';
        for (var tr = 0; tr < 15; tr++) {
          var tx = tr * 55 - 15 + rnd() * 20, ty = 232 + layer * 60, th = 40 + rnd() * 100;
          ctx.beginPath(); ctx.moveTo(tx, ty - th); ctx.lineTo(tx - 34, ty);
          ctx.lineTo(tx + 34, ty); ctx.closePath(); ctx.fill();
        }
      }
      ctx.fillStyle = '#3d6670';
      ctx.beginPath(); ctx.moveTo(0, 343); ctx.quadraticCurveTo(370, 256, 720, 331);
      ctx.lineTo(720, 540); ctx.lineTo(0, 540); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#70918d';
      ctx.beginPath(); ctx.moveTo(310, 540); ctx.quadraticCurveTo(517, 359, 566, 301);
      ctx.lineTo(620, 301); ctx.quadraticCurveTo(633, 436, 495, 540); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(193,204,173,.3)';
      for (var stone = 0; stone < 12; stone++) {
        var stoneY = 346 + stone * 16;
        ctx.beginPath(); ctx.ellipse(576 - stone * 9 + (stone % 2 ? 18 : -12), stoneY,
          8 + stone * .8, 3 + stone * .3, -.18, 0, 6.283); ctx.fill();
      }
      // 庭院圆叶与小花只放在房屋外侧、路边，近景伙伴前留白。
      var shrubs = [{ x: 26, y: 190, r: 38 }, { x: 49, y: 242, r: 31 },
        { x: 425, y: 323, r: 28 }, { x: 708, y: 395, r: 42 }, { x: 40, y: 417, r: 28 }];
      for (var sh = 0; sh < shrubs.length; sh++) {
        var shrub = shrubs[sh];
        ctx.fillStyle = sh % 2 ? '#2f6472' : '#285768';
        ctx.beginPath(); ctx.ellipse(shrub.x, shrub.y, shrub.r, shrub.r * .8, 0, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.ellipse(shrub.x + shrub.r * .45, shrub.y - shrub.r * .38,
          shrub.r * .7, shrub.r * .65, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#447a7d'; ctx.beginPath(); ctx.ellipse(shrub.x - shrub.r * .24,
          shrub.y - shrub.r * .35, shrub.r * .44, shrub.r * .28, -.2, 0, 6.283); ctx.fill();
      }
      // 远处的对手小屋与来访小怪，不遮住首页近景伙伴。
      ctx.save(); ctx.translate(600 - this.homeGeom('g').x0 * .42, 180 - 320 * .42);
      ctx.scale(.42, .42); this.drawHome({ battle: null, menuArt: true }, 'g', 0); ctx.restore();
      ctx.save(); ctx.translate(48, -178); ctx.scale(1.2, 1.2);
      this.drawHome({ battle: null, menuArt: true }, 'p', 0); ctx.restore();
      // 围栏与屋旁的暖灯。
      ctx.strokeStyle = '#9e835f'; ctx.lineWidth = 11; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(30, 426); ctx.lineTo(155, 426); ctx.stroke();
      for (var f = 0; f < 5; f++) {
        ctx.beginPath(); ctx.moveTo(27 + f * 32, 398); ctx.lineTo(27 + f * 32, 451); ctx.stroke();
      }
      ctx.fillStyle = '#405264'; this.roundRectPath(ctx, 201, 267, 19, 32, 4); ctx.fill();
      ctx.fillStyle = '#ffdc85'; this.roundRectPath(ctx, 205, 271, 11, 23, 2); ctx.fill();
      ctx.drawImage(this.glow('#ffcf73', 128), 158, 222, 106, 106);
      for (var z = 0; z < 4; z++) {
        this.drawZombie({ type: z === 3 ? 'tank' : 'walker', side: 'p', x: 512 + z * 45,
          y: 319 + (z % 2) * 32, r: 18, scale: .8, phase: z * 1.8, hp: 1, maxHp: 1,
          tint: '#9cba77', flash: 0, slowT: 0 }, 0);
      }
      var animals = [{ animal: 'bear', x: 162, y: 409, sc: 1.73 },
        { animal: 'hare', x: 282, y: 421, sc: 1.4 }, { animal: 'fox', x: 428, y: 435, sc: 1.62 }];
      for (var a = 0; a < animals.length; a++) {
        var pose = animals[a];
        var type = Object.keys(UNITS).filter(function (id) { return UNITS[id].animal === pose.animal; })[0];
        if (!type) continue;
        ctx.save(); ctx.translate(pose.x, pose.y); ctx.scale(pose.sc, pose.sc);
        ctx.fillStyle = 'rgba(15,42,49,.27)'; ctx.beginPath(); ctx.ellipse(0, 31, 40, 10, 0, 0, 6.283); ctx.fill();
        this.drawAnimal(ctx, { pulse: 0, thumbnail: true }, 0, 48, UNITS[type], null);
        ctx.restore();
      }
      // 草丛只放在插画边缘，保持动物脸和小屋清晰。
      for (var b = 0; b < 22; b++) {
        ctx.fillStyle = b % 2 ? '#2e6672' : '#285561';
        ctx.beginPath(); ctx.ellipse(b * 36 - 20, 514 + (b % 3) * 9, 43, 30, 0, 0, 6.283); ctx.fill();
      }
      for (var flower = 0; flower < 5; flower++) {
        var flowerX = 52 + flower * 151, flowerY = 505 + (flower % 2) * 13;
        ctx.fillStyle = '#d9b870';
        for (var petal = 0; petal < 4; petal++) {
          ctx.beginPath(); ctx.arc(flowerX + Math.cos(petal * 1.57) * 3,
            flowerY + Math.sin(petal * 1.57) * 3, 2.5, 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = '#f7d991'; ctx.beginPath(); ctx.arc(flowerX, flowerY, 1.7, 0, 6.283); ctx.fill();
      }
      for (var firefly = 0; firefly < 7; firefly++) {
        var fx = 220 + rnd() * 230, fy = 180 + rnd() * 200;
        ctx.fillStyle = '#ffe6a2'; ctx.beginPath(); ctx.arc(fx, fy, 2.2, 0, 6.283); ctx.fill();
      }
      this._menuArt = c.toDataURL('image/png');
    } finally { this.ctx = keep; }
    return this._menuArt;
  },

  /* 动物缩略图：给 DOM 卡片（备战选人 / 战斗底栏）当图标用。
     复用 drawUnit 的真实绘制 —— drawUnit 只读 this.ctx 和 u 的字段，
     那个 scene 参数根本没用，所以喂一个最小的假 u 就能离屏画出来，
     不需要新美术资源，改游戏美术时卡片会自动跟着变。
     结果按 (类型, 尺寸, 倍率) 缓存，不每帧重建。 */
  unitThumb: function (typeId, cssSize, lv) {
    lv = lv || 1;
    var k = Math.max(1, Math.min(3, (this.dpr || 1) * (this.scale || 1)));
    var key = 'thumb|' + typeId + '|' + cssSize + '|' + lv + '|' + k;
    var hit = this._spriteCache[key];
    if (hit) return hit;

    /* cssSize 是缩略图显示的 CSS 边长。画布按设备像素出图，动物本体留出
       辉光与投影的余量（pad）。早先这里把 cssSize 当成「格子直径」，动物
       只占了画布的一小角，21 CSS 像素的卡位上就是一团看不清的暗斑。 */
    var px = Math.max(1, Math.round(cssSize * k));
    // 先以足够清晰的离屏尺寸画一次，再裁主体；小卡片也不会放大低分辨率像素。
    var sourcePx = Math.max(160, px);
    var c = document.createElement('canvas');
    c.width = c.height = sourcePx;
    var sc = c.getContext('2d');
    /* 动物耳朵、尾巴超出 CELL_HW；完整轮廓按 140 设计像素留边。
       中心平移必须先按设备像素做，不能再被 unit 与 UNIT_DRAW_SCALE 缩放。 */
    var unit = sourcePx / (140 * CONFIG.UNIT_DRAW_SCALE);
    sc.translate(sourcePx / 2, sourcePx / 2);
    sc.scale(unit, unit);

    var d = UNITS[typeId];
    var fake = {
      /* lane 必须给：弩炮 / 狙击台会按 side+lane 在战场里找目标。 */
      type: typeId, side: 'p', lane: 0, lv: lv, form: null,
      x: 0, y: 12 * CONFIG.UNIT_DRAW_SCALE,
      hp: 1, maxHp: 1,          // 满血，不画血条
      pulse: 0, flash: 0, actT: 0, engaged: false,
      range: combatReachX(d.range || 0), radius: combatReachX(d.rangeType === 'radius' ? d.range : (d.radius || 0)),
      spray: rangeScaleY(d.spray || 0), thumbnail: true,
    };
    var keep = this.ctx;
    this.ctx = sc;
    /* 离屏比例由sourcePx控制，内部精灵按一倍逻辑坐标绘制。 */
    var keepDpr = this.dpr, keepScale = this.scale;
    this.dpr = 1; this.scale = 1;
    /* 弩炮 / 狙击台会调 aimTarget() 找目标画瞄准线，那里要读 scene.battle。
       给一个空战场：结果是没有目标、不画瞄准线 —— 正是缩略图要的样子。 */
    /* 按九条通道铺满空数组，aimTarget 才不会越界。 */
    var emptyLanes = [];
    for (var li = 0; li < CONFIG.LANES.length; li++) emptyLanes.push([]);
    var emptyBattle = { units: [], zombies: [], zBuckets: { p: emptyLanes, g: emptyLanes } };
    var fakeScene = { battle: emptyBattle };
    try {
      this.drawUnit(fake, 0, fakeScene);
    } finally {
      this.ctx = keep;
      this.dpr = keepDpr; this.scale = keepScale;
    }

    // 只用主体的不透明像素找边界，阴影与低透明辉光不计入留白。
    // 耳、尾、翅与等级点都会纳入；四周各留12%，再居中缩回原CSS尺寸。
    var pixels = sc.getImageData(0, 0, sourcePx, sourcePx).data;
    var left = sourcePx, top = sourcePx, right = -1, bottom = -1;
    for (var py = 0; py < sourcePx; py++) {
      for (var pxi = 0; pxi < sourcePx; pxi++) {
        // 只量实心主体，柔光与抗锯齿边缘由外围余量保留。
        if (pixels[(py * sourcePx + pxi) * 4 + 3] <= 150) continue;
        left = Math.min(left, pxi); right = Math.max(right, pxi);
        top = Math.min(top, py); bottom = Math.max(bottom, py);
      }
    }
    var cropped = document.createElement('canvas');
    cropped.width = cropped.height = px;
    var cc = cropped.getContext('2d');
    cc.imageSmoothingEnabled = true; cc.imageSmoothingQuality = 'high';
    if (right >= left && bottom >= top) {
      var edge = Math.max(right - left + 1, bottom - top + 1) * 1.24;
      var cropX = (left + right + 1 - edge) / 2, cropY = (top + bottom + 1 - edge) / 2;
      cc.scale(px / edge, px / edge);
      cc.drawImage(c, -cropX, -cropY);
    } else { cc.drawImage(c, 0, 0, px, px); }
    var rec = { img: cropped, cssSize: cssSize };
    this._spriteCache[key] = rec;
    return rec;
  },

  roundRectPath: function (ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  },

  unitGradient: function (ctx, x, y, w, h, colors, vertical) {
    var key = 'u' + x + ',' + y + ',' + w + ',' + h + ',' + (vertical === false ? 'h' : 'v');
    for (var c = 0; c < colors.length; c++) key += '|' + colors[c][0] + colors[c][1];
    var cached = this._gradCache[key];
    if (cached) return cached;
    var g = this.buildUnitGradient(ctx, x, y, w, h, colors, vertical);
    if (this._gradN < 900) { this._gradCache[key] = g; this._gradN++; }
    return g;
  },
  buildUnitGradient: function (ctx, x, y, w, h, colors, vertical) {
    var c = this.ctx || ctx;   // 渐变统一由主画布创建，跨 offscreen 复用更安全
    var g = vertical === false
      ? c.createLinearGradient(x, y, x + w, y)
      : c.createLinearGradient(x, y, x, y + h);
    for (var i = 0; i < colors.length; i++) {
      g.addColorStop(colors[i][0], colors[i][1]);
    }
    return g;
  },

  bevelRect: function (ctx, x, y, w, h, r, top, bottom, edge) {
    this.roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = this.unitGradient(ctx, x, y, w, h, [
      [0, top], [0.46, top], [0.52, bottom], [1, bottom],
    ]);
    ctx.fill();
    ctx.strokeStyle = edge || 'rgba(4,7,9,.82)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.save();
    this.roundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(1, r - 1));
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.17)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + r, y + 1.5);
    ctx.lineTo(x + w - r, y + 1.5);
    ctx.stroke();
    ctx.restore();
  },

  unitBolt: function (ctx, x, y, r, light, dark) {
    ctx.fillStyle = dark || '#171b1e';
    ctx.beginPath(); ctx.arc(x, y + 0.7, r, 0, 6.283); ctx.fill();
    ctx.fillStyle = light || '#aab4bc';
    ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.25, 0, 6.283); ctx.fill();
  },

  unitPlatform: function (ctx, size, accent) {
    this.bevelRect(ctx, -size + 3, -size + 18, size * 2 - 6, size * 2 - 28, 9, '#303740', '#151a20');
    ctx.strokeStyle = 'rgba(255,255,255,.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-size + 12, -size + 24);
    ctx.lineTo(size - 12, -size + 24);
    ctx.stroke();
    ctx.fillStyle = accent || '#59636c';
    ctx.fillRect(-size + 9, size - 15, size * 2 - 18, 3);
    this.unitBolt(ctx, -size + 9, size - 13, 2.5);
    this.unitBolt(ctx, size - 9, size - 13, 2.5);
  },

  drawSniper: function (u, t, scene, form) {
    var ctx = this.ctx, size = CONFIG.CELL_HW - 6;
    var d = UNITS[u.type], accent = form ? form.color : d.glow;
    var dir = attackForwardSign(u.side);
    this.unitPlatform(ctx, size, accent);
    var ang = dir > 0 ? 0 : Math.PI;
    var target = this.aimTarget(u, scene);
    if (target) ang = Math.atan2(target.y - u.y, target.x - u.x);
    ctx.save();
    ctx.translate(0, size - 35);
    ctx.rotate(ang);
    this.bevelRect(ctx, -19, -13, 38, 26, 7, '#67737b', '#20272c');
    this.bevelRect(ctx, 9, -6, 44, 12, 4, '#a8b5b8', '#3b474b');
    ctx.fillStyle = '#11181b';
    ctx.fillRect(47, -4, 8, 8);
    this.bevelRect(ctx, -4, -24, 22, 9, 4, '#252f35', '#11171b', accent);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.72 + Math.sin(t * 5) * 0.18;
    ctx.fillRect(13, -21, 5, 3);
    ctx.globalAlpha = 1;
    this.unitBolt(ctx, -11, -8, 2.3, '#d1dce0', '#263137');
    this.unitBolt(ctx, 9, 8, 2.3, '#d1dce0', '#263137');
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-12, 14); ctx.lineTo(-19, 25);
    ctx.moveTo(4, 14); ctx.lineTo(11, 25);
    ctx.stroke();
    if (form && form.id === 'longscope') {
      this.bevelRect(ctx, 17, -27, 28, 7, 3, '#1e2a31', '#0c1215', accent);
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(45, -23.5, 4, 0, 6.283); ctx.fill();
    } else if (form && form.id === 'execution') {
      ctx.strokeStyle = form.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(4, -15); ctx.lineTo(17, -24); ctx.moveTo(4, 15); ctx.lineTo(17, 24); ctx.stroke();
    }
    ctx.restore();
  },

  drawVenom: function (u, t, scene, form) {
    var ctx = this.ctx, size = CONFIG.CELL_HW - 6;
    var d = UNITS[u.type], accent = form ? form.color : d.glow;
    var dir = attackForwardSign(u.side);
    this.unitPlatform(ctx, size, accent);
    ctx.save();
    ctx.translate(-dir * 5, size - 35);
    ctx.scale(dir, 1);
    this.bevelRect(ctx, -25, -28, 31, 48, 10, '#4f694c', '#1a281b');
    ctx.fillStyle = 'rgba(140,255,110,.78)';
    ctx.globalAlpha = 0.55 + Math.sin(t * 4) * 0.18;
    this.roundRectPath(ctx, -18, -17, 17, 28, 5); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#152117'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-7, -30); ctx.lineTo(-7, -39); ctx.stroke();
    this.bevelRect(ctx, -2, -12, 31, 15, 6, '#788d70', '#263329');
    ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(24, -4); ctx.quadraticCurveTo(34, 5, 40, -7); ctx.stroke();
    this.bevelRect(ctx, 37, -14, 13, 14, 4, '#b6c99b', '#42533d');
    for (var bubble = 0; bubble < 3; bubble++) {
      var by = -10 + ((t * 13 + bubble * 15) % 30);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.35 + bubble * 0.16;
      ctx.beginPath(); ctx.arc(-10 + bubble * 7, by, 2.1 + bubble * .4, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (form && form.id === 'widemist') {
      ctx.strokeStyle = form.color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(48, -17); ctx.lineTo(54, -17); ctx.moveTo(48, 9); ctx.lineTo(54, 9); ctx.stroke();
    } else if (form && form.id === 'virulent') {
      ctx.fillStyle = form.color;
      ctx.beginPath(); ctx.arc(45, -7, 6 + Math.sin(t * 8) * 2, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  },

  drawFrost: function (u, t, scene, form) {
    var ctx = this.ctx, size = CONFIG.CELL_HW - 6;
    var d = UNITS[u.type], accent = form ? form.color : d.glow;
    var litUp = u.engaged ? 1 : 0;
    var firing = u.actT > 0 ? 1 : 0;
    this.unitPlatform(ctx, size, accent);
    ctx.save();
    ctx.translate(0, size - 31);
    ctx.fillStyle = 'rgba(120,225,255,.17)';
    ctx.globalAlpha = (0.42 + Math.sin(t * (3.6 + litUp * 2.2)) * 0.2) * (0.7 + litUp * 0.5 + firing * 0.3);
    ctx.beginPath(); ctx.ellipse(0, 4, 27, 12, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
    // 寒域在起作用时，井口会转出一圈符文环
    if (litUp) {
      ctx.save();
      ctx.rotate(t * 0.9);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.30 + firing * 0.35;
      ctx.lineWidth = 2;
      for (var rune = 0; rune < 4; rune++) {
        var ra = rune * 1.5708;
        ctx.beginPath();
        ctx.arc(0, 4, 30, ra, ra + 0.62);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = '#5d9eb6'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(0, 4, 23, 9, 0, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 4, 17, 6, 0, 0, 6.283); ctx.stroke();
    ctx.fillStyle = this.unitGradient(ctx, -13, -34, 26, 38, [[0, '#f1fdff'], [.45, accent], [1, '#3d84a5']]);
    ctx.beginPath();
    ctx.moveTo(0, -48); ctx.lineTo(13, -24); ctx.lineTo(7, -4);
    ctx.lineTo(-7, -4); ctx.lineTo(-13, -24); ctx.closePath();
    ctx.fill(); ctx.strokeStyle = '#20485b'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(0, -9); ctx.stroke();
    for (var prong = 0; prong < 4; prong++) {
      var pa = prong * 1.57 + .4;
      ctx.strokeStyle = accent; ctx.globalAlpha = .62;
      ctx.beginPath(); ctx.moveTo(Math.cos(pa) * 19, 4 + Math.sin(pa) * 7);
      ctx.lineTo(Math.cos(pa) * 32, 4 + Math.sin(pa) * 13); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (form && form.id === 'icebind') {
      ctx.fillStyle = form.color;
      ctx.globalAlpha = .72 + Math.sin(t * 8) * .2;
      ctx.beginPath(); ctx.arc(0, -22, 7, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (form && form.id === 'widefrost') {
      ctx.strokeStyle = form.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 4, 35, 0, 6.283); ctx.stroke();
    }
    ctx.restore();
  },

  drawQuake: function (u, t, scene, form) {
    var ctx = this.ctx, size = CONFIG.CELL_HW - 6;
    var d = UNITS[u.type], accent = form ? form.color : d.glow;
    this.unitPlatform(ctx, size, accent);
    ctx.save();
    ctx.translate(0, size - 32);
    var ringPulse = u.pulse > 0 ? 1 : 0;
    if (ringPulse) {
      ctx.strokeStyle = accent; ctx.globalAlpha = .55;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 7, 34 + (1 - u.pulse / .24) * 18, 13 + (1 - u.pulse / .24) * 6, 0, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.bevelRect(ctx, -25, -7, 50, 22, 7, '#5d4a31', '#1d1711');
    ctx.fillStyle = this.unitGradient(ctx, -22, -39, 44, 42, [[0, '#e2b765'], [.48, '#8e6731'], [1, '#3b2a19']]);
    ctx.beginPath(); ctx.moveTo(-22, -30); ctx.quadraticCurveTo(-25, -55, 0, -57); ctx.quadraticCurveTo(25, -55, 22, -30); ctx.lineTo(19, -5); ctx.lineTo(-19, -5); ctx.closePath();
    ctx.fill(); ctx.strokeStyle = '#21170f'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,236,177,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-14, -40); ctx.quadraticCurveTo(0, -47, 14, -40); ctx.stroke();
    ctx.fillStyle = '#21170f';
    ctx.beginPath(); ctx.arc(0, -19, 7, 0, 6.283); ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(0, -19, 3.2 + Math.sin(t * 7) * .7, 0, 6.283); ctx.fill();
    if (form && form.id === 'seismic') {
      ctx.strokeStyle = form.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-31, 7); ctx.lineTo(-42, 14); ctx.moveTo(31, 7); ctx.lineTo(42, 14); ctx.stroke();
    } else if (form && form.id === 'quickdrum') {
      ctx.strokeStyle = form.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -29, 27, 0, 6.283); ctx.stroke();
    }
    ctx.restore();
  },

  drawRailgun: function (u, t, scene, form) {
    var ctx = this.ctx, size = CONFIG.CELL_HW - 6;
    var d = UNITS[u.type], accent = form ? form.color : d.glow;
    var dir = attackForwardSign(u.side);
    this.unitPlatform(ctx, size, accent);
    ctx.save();
    ctx.translate(0, size - 34);
    ctx.scale(dir, 1);
    this.bevelRect(ctx, -27, -20, 43, 35, 7, '#4d6475', '#18232d');
    this.bevelRect(ctx, -14, -32, 17, 22, 5, '#8096a5', '#2b3a45');
    this.bevelRect(ctx, -7, -16, 54, 10, 4, '#b8d2df', '#405866', accent);
    this.bevelRect(ctx, -7, 3, 54, 10, 4, '#b8d2df', '#405866', accent);
    ctx.strokeStyle = accent; ctx.lineWidth = 3;
    ctx.globalAlpha = .55 + Math.sin(t * 8) * .24 + u.pulse * .4;
    ctx.beginPath(); ctx.moveTo(43, -11); ctx.lineTo(58, -11); ctx.moveTo(43, 8); ctx.lineTo(58, 8); ctx.stroke();
    ctx.globalAlpha = 1;
    for (var coil = 0; coil < 3; coil++) {
      ctx.fillStyle = coil === 1 ? accent : '#607987';
      ctx.beginPath(); ctx.arc(-4 + coil * 15, -4, 5.5, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#17222a'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    this.unitBolt(ctx, -23, -13, 2.3, '#d8edf5', '#20303a');
    this.unitBolt(ctx, -23, 10, 2.3, '#d8edf5', '#20303a');
    if (form && form.id === 'capacitor') {
      ctx.fillStyle = form.color;
      ctx.globalAlpha = .65 + Math.sin(t * 10) * .3;
      ctx.fillRect(11, -27, 24, 5); ctx.globalAlpha = 1;
    } else if (form && form.id === 'penetrator') {
      ctx.strokeStyle = form.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(45, -16); ctx.lineTo(75, -16); ctx.moveTo(45, 13); ctx.lineTo(75, 13); ctx.stroke();
    }
    ctx.restore();
  },

  drawTotem: function (u, t, scene, form) {
    var ctx = this.ctx, size = CONFIG.CELL_HW - 6;
    var d = UNITS[u.type], accent = form ? form.color : d.glow;
    this.unitPlatform(ctx, size, accent);
    ctx.save();
    ctx.translate(0, size - 31);
    var glow = u.pulse > 0 ? .9 : .55;
    ctx.globalAlpha = glow * (.75 + Math.sin(t * 4) * .2);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.ellipse(0, 4, 31, 12, 0, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, 4, 27, 9, 0, 0, 6.283); ctx.stroke();
    this.bevelRect(ctx, -12, -47, 24, 50, 6, '#6b3b47', '#24151b');
    ctx.fillStyle = this.unitGradient(ctx, -8, -41, 16, 36, [[0, '#e6a5a7'], [.45, '#8f4556'], [1, '#341b25']]);
    this.roundRectPath(ctx, -8, -41, 16, 36, 5); ctx.fill();
    ctx.fillStyle = '#f7d6c8';
    ctx.beginPath(); ctx.arc(0, -46, 9, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#351a25';
    ctx.beginPath(); ctx.arc(-3.4, -47, 2, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(3.4, -47, 2, 0, 6.283); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-7, -34); ctx.lineTo(7, -25); ctx.moveTo(-7, -25); ctx.lineTo(7, -34); ctx.stroke();
    ctx.strokeStyle = '#321b24'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-7, -4); ctx.lineTo(-22, -17); ctx.moveTo(7, -4); ctx.lineTo(22, -17); ctx.stroke();
    if (form && form.id === 'broadpact') {
      ctx.strokeStyle = form.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-20, -17); ctx.lineTo(-34, -27); ctx.moveTo(20, -17); ctx.lineTo(34, -27); ctx.stroke();
    } else if (form && form.id === 'quickpact') {
      ctx.strokeStyle = form.color; ctx.globalAlpha = .6 + Math.sin(t * 9) * .3;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -27, 24, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },

  drawUnit: function (u, t, scene) {
    var ctx = this.ctx;
    var x = u.x, y = u.y;
    var d = UNITS[u.type];
    var pulse = u.pulse > 0 ? 1 : 0;
    var dmgFrac = u.hp / u.maxHp;
    var size = CONFIG.CELL_HW - 6;
    var form = u.form ? getForm(u.type, u.form) : null;
    var formId = form && form.id !== 'neutral' ? form.id : null;
    var face = attackForwardSign(u.side);

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(CONFIG.UNIT_DRAW_SCALE, CONFIG.UNIT_DRAW_SCALE);

    // 卡片只保留透明底的主体，战场才画底座投影与作战辉光。
    if (!u.thumbnail && !d.animal) {
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.beginPath();
      ctx.ellipse(2, CONFIG.CELL_HW - 6, size * 0.96, 12, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      ctx.beginPath();
      ctx.ellipse(0, CONFIG.CELL_HW - 9, size * 0.84, 8, 0, 0, 6.283);
      ctx.fill();

      var lvGlow = 0.25 + (u.lv - 1) * 0.22;
      var glowColor = formId ? form.color : d.glow;
      var gsp = this.glow(glowColor, 128);
      // 底座辉光跟着作战状态走：有目标更亮，开火再亮一档
      ctx.globalAlpha = lvGlow * 0.65 * (pulse ? 1.5 : u.actT > 0 ? 1.35 : (u.engaged ? 1.15 : 1));
      ctx.drawImage(gsp, -size - 10, -size - 10, (size + 10) * 2, (size + 10) * 2);
      ctx.globalAlpha = 1;
    }

    if (d.animal) {
      this.drawAnimalUnit(ctx, u, t, size, d, form, face);
    } else if (u.type === 'barricade') {
      var bc = this.barricadeSprite(u.lv, formId, form);
      ctx.drawImage(bc.img, -bc.o, -bc.o, bc.size, bc.size);
      if (!u.thumbnail) {
        var wallRowOffset = CONFIG.GRID_LANE_PITCH / CONFIG.UNIT_DRAW_SCALE;
        ctx.drawImage(bc.img, -bc.o, -bc.o - wallRowOffset, bc.size, bc.size);
        ctx.drawImage(bc.img, -bc.o, -bc.o + wallRowOffset, bc.size, bc.size);
      }
      if (u.flash > 0.01) {
        ctx.globalAlpha = Math.min(0.6, u.flash * 0.6);
        var wallOffset = u.thumbnail ? 0 : CONFIG.GRID_LANE_PITCH / CONFIG.UNIT_DRAW_SCALE;
        this.roundRectPath(ctx, -size + 2, -size + 4 - wallOffset,
          size * 2 - 4, size * 2 - 8 + wallOffset * 2, 5);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (u.type === 'spike') {
      var spikeRowCount = u.thumbnail ? 1 : 3;
      for (var spikeRow = 0; spikeRow < spikeRowCount; spikeRow++) {
      ctx.save();
      if (!u.thumbnail) ctx.translate(0, (spikeRow - 1) * CONFIG.GRID_LANE_PITCH / CONFIG.UNIT_DRAW_SCALE);
      this.bevelRect(ctx, -size, 3, size * 2, 24, 4, '#6a4a34', '#241a15');
      this.bevelRect(ctx, -size + 5, 7, size * 2 - 10, 7, 2, '#59636b', '#272e34');
      var spikeColor = formId === 'bleedteeth' ? '#e26f4d'
        : formId === 'hookspikes' ? '#8fd4d8'
          : formId === 'phosphorspikes' ? '#78d9ad' : d.color;
      var spikeStep = formId === 'bleedteeth' ? 11 : 17;
      var spikeTop = this.lighten(spikeColor, 0.24);
      var spikeBottom = this.lighten(spikeColor, -0.34);
      var toothGrad = this.cacheGrad('tooth|' + spikeColor, function () {
        var g = ctx.createLinearGradient(0, -size + 3, 0, 8);
        g.addColorStop(0, spikeTop);
        g.addColorStop(0.42, spikeColor);
        g.addColorStop(1, spikeBottom);
        return g;
      });
      for (var s = -size + 8; s <= size - 8; s += spikeStep) {
        var tipX = s + spikeStep * 0.42;
        var tipY = formId === 'bleedteeth' ? -size + 1 : -size + 6;
        ctx.beginPath();
        ctx.moveTo(s, 6);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(s + spikeStep, 6);
        ctx.closePath();
        ctx.fillStyle = toothGrad; ctx.fill();
        ctx.strokeStyle = '#171b1d'; ctx.lineWidth = 1.35; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s + 2, 4);
        ctx.lineTo(tipX - 1, tipY + 3);
        ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.stroke();
      }
      if (formId === 'bleedteeth') {
        ctx.strokeStyle = '#7e1f1a'; ctx.lineWidth = 2;
        for (var bt = -size + 8; bt <= size - 8; bt += spikeStep) {
          ctx.beginPath();
          ctx.moveTo(bt + 2, 4);
          ctx.lineTo(bt + spikeStep * 0.42, -size + 2);
          ctx.stroke();
          ctx.fillStyle = '#a72e25';
          ctx.beginPath(); ctx.arc(bt + spikeStep * 0.42, -size + 4, 1.7, 0, 6.283); ctx.fill();
        }
      } else if (formId === 'hookspikes') {
        ctx.lineCap = 'round';
        for (var hk = -size + 7; hk <= size - 7; hk += 18) {
          ctx.beginPath();
          ctx.moveTo(hk + 3, 1);
          ctx.quadraticCurveTo(hk + 10, -size * 0.62, hk + 2, -size + 8);
          ctx.quadraticCurveTo(hk - 4, -size + 13, hk + 7, -size + 11);
          ctx.strokeStyle = '#18383c'; ctx.lineWidth = 5; ctx.stroke();
          ctx.strokeStyle = form.color; ctx.lineWidth = 2.4; ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 0.8; ctx.stroke();
        }
      } else if (formId === 'phosphorspikes') {
        for (var ph2 = -size + spikeStep * 0.42; ph2 <= size - 5; ph2 += spikeStep) {
          ctx.globalAlpha = 0.45 + Math.sin(t * 7 + ph2) * 0.25;
          ctx.drawImage(this.glow(form.color, 28), ph2 - 14, -size - 11, 28, 28);
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#e7fff5';
          ctx.beginPath(); ctx.arc(ph2, -size + 5, 1.8, 0, 6.283); ctx.fill();
        }
      }
      for (var sb = -size + 9; sb <= size - 9; sb += 24) this.unitBolt(ctx, sb, 21, 2.2);
      ctx.fillStyle = 'rgba(255,120,60,' + (0.32 + pulse * 0.5) + ')';
      ctx.fillRect(-size + 7, 14, size * 2 - 14, 3);
      // 正在割伤丧尸：齿尖泛白，一眼能看出它在工作
      if (u.actT > 0) {
        var bite = Math.min(1, u.actT / 0.2);
        ctx.globalAlpha = 0.5 * bite;
        ctx.strokeStyle = '#ffd9c0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-size + 6, -size + 4);
        ctx.lineTo(size - 6, -size + 4);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      }
    } else if (u.type === 'turret') {
      this.unitPlatform(ctx, size, formId ? form.color : d.glow);
      var ang = face > 0 ? 0 : Math.PI;
      var tg = this.aimTarget(u, scene);
      if (tg) ang = Math.atan2(tg.y - u.y, tg.x - u.x);
      ctx.save();
      ctx.translate(0, size - 36);
      ctx.scale(1.12, 1.12);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath(); ctx.ellipse(1, 3, 18, 14, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = this.unitGradient(ctx, -17, -17, 34, 34, [
        [0, '#747b7f'], [0.44, '#4b5257'], [1, '#24292d'],
      ]);
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#111518'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 13.5, 3.55, 5.95); ctx.stroke();
      ctx.fillStyle = '#20252a';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.283); ctx.fill();
      this.unitBolt(ctx, -10, -8, 2.4, '#aeb6bb', '#20252a');
      this.unitBolt(ctx, 10, 8, 2.4, '#aeb6bb', '#20252a');
      if (formId === 'armorpiercing') {
        this.bevelRect(ctx, 8, -9, 29, 18, 4, '#89939b', '#333a40');
        this.bevelRect(ctx, 34, -13, 9, 26, 3, form.color, '#4a3328');
        ctx.fillStyle = '#171b1e';
        for (var apHole = -7; apHole <= 7; apHole += 7) {
          ctx.beginPath(); ctx.arc(38.5, apHole, 1.7, 0, 6.283); ctx.fill();
        }
        this.bevelRect(ctx, -22, -12, 10, 24, 3, '#525b62', '#242a2f');
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(12, -6); ctx.lineTo(34, -6); ctx.stroke();
      } else if (formId === 'rapidbow') {
        this.bevelRect(ctx, 7, -11, 34, 7, 3, '#7d878e', '#30373c');
        this.bevelRect(ctx, 7, 4, 34, 7, 3, '#7d878e', '#30373c');
        ctx.strokeStyle = form.color; ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(13, -7.5); ctx.lineTo(39, -7.5);
        ctx.moveTo(13, 7.5); ctx.lineTo(39, 7.5);
        ctx.stroke();
        ctx.fillStyle = '#252b30';
        ctx.beginPath(); ctx.arc(39, -7.5, 5.5, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(39, 7.5, 5.5, 0, 6.283); ctx.fill();
        ctx.strokeStyle = form.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(39, -7.5, 3.2, 0, 6.283); ctx.stroke();
        ctx.beginPath(); ctx.arc(39, 7.5, 3.2, 0, 6.283); ctx.stroke();
        this.bevelRect(ctx, 17, -5, 7, 10, 2, '#b0b7ba', '#4a5155');
      } else if (formId === 'trackerbow') {
        this.bevelRect(ctx, 7, -4, 39, 8, 3, '#59646b', '#1f2529');
        ctx.strokeStyle = form.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(11, -2.5); ctx.lineTo(44, -2.5); ctx.stroke();
        ctx.fillStyle = '#252d32';
        ctx.beginPath(); ctx.arc(-2, -17, 7, 0, 6.283); ctx.fill();
        ctx.strokeStyle = form.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(-2, -17, 5, 0, 6.283); ctx.stroke();
        ctx.strokeStyle = 'rgba(236,250,252,.8)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-2, -25); ctx.lineTo(-2, -9);
        ctx.moveTo(-10, -17); ctx.lineTo(6, -17);
        ctx.stroke();
        this.bevelRect(ctx, -6, -13, 8, 10, 2, '#6c767d', '#2a3136');
        ctx.beginPath();
        ctx.moveTo(38, -9); ctx.lineTo(51, 0); ctx.lineTo(38, 9);
        ctx.closePath();
        ctx.fillStyle = form.color; ctx.fill();
        ctx.strokeStyle = '#172126'; ctx.lineWidth = 1.4; ctx.stroke();
      } else {
        this.bevelRect(ctx, 8, -7, 31, 14, 4, '#747b7f', '#343a3e');
        this.bevelRect(ctx, 35, -9, 7, 18, 2, '#9a8457', '#3f3524');
      }
      ctx.fillStyle = pulse ? '#ffffff' : (formId ? form.color : d.glow);
      ctx.beginPath(); ctx.arc(0, 0, pulse ? 5 : 3.5, 0, 6.283); ctx.fill();
      ctx.restore();
    } else if (u.type === 'lamp') {
      var lampSpread = 0.62;
      var coneColor = '255,225,150';
      if (formId === 'widebeam') {
        lampSpread = 0.86;
        coneColor = '185,216,239';
      } else if (formId === 'sodiumflare') {
        lampSpread = 0.36;
        coneColor = '255,183,67';
      } else if (formId === 'stroboscope') {
        lampSpread = 0.54;
        coneColor = '232,246,255';
      }

      // 分层光锥：弱外雾、柔化边缘和少量悬浮尘埃。
      ctx.save();
      ctx.rotate(face > 0 ? 0 : Math.PI);
      /* 输出状态：真的照到丧尸时整束光变亮、灯芯起晕；空转时明显压暗。
         这样一眼就能分辨「这盏灯在不在干活」。 */
      var litUp = u.engaged ? 1 : 0;
      var firing = u.actT > 0 ? 1 : 0;
      var beamK = 0.40 + litUp * 0.46 + firing * 0.30;
      ctx.globalAlpha = beamK;
      var coneOuter = this.cacheGrad('lampO|' + coneColor + '|' + u.radius, function () {
        var g = ctx.createLinearGradient(5, 0, u.radius, 0);
        g.addColorStop(0, 'rgba(' + coneColor + ',0.20)');
        g.addColorStop(0.42, 'rgba(' + coneColor + ',0.10)');
        g.addColorStop(1, 'rgba(' + coneColor + ',0)');
        return g;
      });
      ctx.fillStyle = coneOuter;
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(u.radius, -u.radius * lampSpread);
      ctx.lineTo(u.radius, u.radius * lampSpread);
      ctx.closePath();
      ctx.fill();

      var coneInner = this.cacheGrad('lampI|' + coneColor + '|' + u.radius, function () {
        var g = ctx.createLinearGradient(5, 0, u.radius * 0.88, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.22)');
        g.addColorStop(0.35, 'rgba(' + coneColor + ',0.12)');
        g.addColorStop(1, 'rgba(' + coneColor + ',0)');
        return g;
      });
      ctx.fillStyle = coneInner;
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(u.radius * 0.94, -u.radius * lampSpread * 0.54);
      ctx.lineTo(u.radius * 0.94, u.radius * lampSpread * 0.54);
      ctx.closePath();
      ctx.fill();

      var coneEdge = this.cacheGrad('lampE|' + coneColor + '|' + u.radius, function () {
        var g = ctx.createLinearGradient(4, 0, u.radius, 0);
        g.addColorStop(0, 'rgba(' + coneColor + ',0.34)');
        g.addColorStop(1, 'rgba(' + coneColor + ',0)');
        return g;
      });
      ctx.strokeStyle = coneEdge;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      if (this.cfg.shadow) {
        ctx.shadowColor = 'rgba(' + coneColor + ',0.55)';
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(u.radius, -u.radius * lampSpread);
      ctx.moveTo(5, 0);
      ctx.lineTo(u.radius, u.radius * lampSpread);
      ctx.stroke();
      if (this.cfg.shadow) ctx.shadowBlur = 0;

      ctx.save();
      ctx.setLineDash([16, 18]);
      ctx.lineDashOffset = -t * 16;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.06 + litUp * 0.10 + firing * 0.08) + ')';
      ctx.lineWidth = 1;
      for (var beamLine = -1; beamLine <= 1; beamLine++) {
        ctx.beginPath();
        ctx.moveTo(12, beamLine * 3);
        ctx.lineTo(u.radius * 0.9, beamLine * u.radius * lampSpread * 0.42);
        ctx.stroke();
      }
      ctx.restore();

      // 扫描光带：让灯「活」起来，照射中扫得更快更亮
      var sweepA = Math.sin(t * (1.4 + litUp * 1.2)) * lampSpread * 0.82;
      ctx.strokeStyle = 'rgba(255,250,220,' + (0.07 + litUp * 0.16 + firing * 0.12) + ')';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(u.radius * 0.97, u.radius * sweepA);
      ctx.stroke();

      for (var mote = 0; mote < 9; mote++) {
        if (mote > 3 && this.lod < 1) continue;
        var moteX = 18 + ((mote * 37 + 13) % Math.max(40, u.radius - 24));
        var moteLane = ((mote * 19) % 9 - 4) / 4;
        var moteY = moteX * lampSpread * moteLane + Math.sin(t * 1.7 + mote) * 2;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.12 + (mote % 3) * 0.04 + litUp * 0.14) + ')';
        ctx.beginPath();
        ctx.arc(moteX, moteY, mote % 3 === 0 ? 1.4 : 0.9, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();

      // 灯芯起晕：照射到目标时才有，空闲时几乎看不见
      if (litUp || firing) {
        ctx.globalAlpha = 0.30 + firing * 0.34;
        ctx.drawImage(this.glow('#fff3cf', 96), face * 16 - 48, -60, 96, 96);
        ctx.globalAlpha = 1;
      }

      // 灯座和承重结构。
      this.bevelRect(ctx, -21, 7, 42, 21, 6, '#424a52', '#171c21');
      this.bevelRect(ctx, -15, 4, 30, 8, 3, '#68727b', '#2a3137');
      this.bevelRect(ctx, -5, -10, 10, 21, 3, '#59636b', '#242b31');
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-16, 8);
      ctx.lineTo(16, 8);
      ctx.stroke();
      this.unitBolt(ctx, -15, 23, 2.7, '#c4ccd2', '#22282d');
      this.unitBolt(ctx, 15, 23, 2.7, '#c4ccd2', '#22282d');
      if (u.lv === 3) {
        ctx.strokeStyle = 'rgba(255,255,255,.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-19, 12);
        ctx.lineTo(-9, 12);
        ctx.moveTo(9, 12);
        ctx.lineTo(19, 12);
        ctx.stroke();
      }

      ctx.save();
      ctx.scale(face, 1);
      if (formId === 'widebeam') {
        ctx.fillStyle = 'rgba(0,0,0,.42)';
        ctx.beginPath(); ctx.ellipse(-3, -8, 24, 18, 0, 0, 6.283); ctx.fill();
        this.bevelRect(ctx, -20, -25, 34, 29, 6, '#697680', '#283139');
        ctx.fillStyle = this.unitGradient(ctx, -22, -30, 40, 9, [
          [0, '#9aa7b0'], [0.5, '#59656e'], [1, '#222a30'],
        ]);
        ctx.beginPath();
        ctx.moveTo(-22, -25);
        ctx.lineTo(17, -27);
        ctx.lineTo(20, -21);
        ctx.lineTo(-19, -19);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#12171b'; ctx.lineWidth = 1.5; ctx.stroke();
        this.bevelRect(ctx, 12, -21, 8, 21, 3, '#e7f7ff', '#5b7b8d');
        var wideLens = ctx.createLinearGradient(12, -21, 20, 0);
        wideLens.addColorStop(0, '#ffffff');
        wideLens.addColorStop(0.45, form.color);
        wideLens.addColorStop(1, '#4b7187');
        ctx.fillStyle = wideLens;
        this.roundRectPath(ctx, 14, -19, 5, 17, 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.75)';
        ctx.lineWidth = 1;
        for (var wg = -15; wg <= -5; wg += 5) {
          ctx.beginPath(); ctx.moveTo(14, wg); ctx.lineTo(19, wg); ctx.stroke();
        }
        this.unitBolt(ctx, -14, -19, 2.2, '#d9e1e6', '#2a3238');
        this.unitBolt(ctx, -14, -2, 2.2, '#d9e1e6', '#2a3238');
      } else if (formId === 'sodiumflare') {
        ctx.strokeStyle = '#74603b'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(-4, -11, 20, 2.2, 4.1); ctx.stroke();
        ctx.fillStyle = this.unitGradient(ctx, -20, -28, 34, 34, [
          [0, '#a48753'], [0.45, '#6d5735'], [1, '#302719'],
        ]);
        ctx.beginPath(); ctx.arc(-4, -12, 16, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#17140f'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,231,170,.45)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(-4, -12, 13, 3.6, 5.7); ctx.stroke();
        ctx.fillStyle = this.unitGradient(ctx, 8, -19, 13, 15, [
          [0, '#fffbe4'], [0.5, form.color], [1, '#b66a20'],
        ]);
        ctx.beginPath(); ctx.arc(12, -12, 8, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#3c2a14'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = '#fff1b0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(12, -12, 4.5, 0, 6.283); ctx.stroke();
        ctx.strokeStyle = 'rgba(108,77,34,.9)'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-17, -24); ctx.lineTo(-3, -28); ctx.lineTo(14, -23);
        ctx.stroke();
        this.unitBolt(ctx, -10, -25, 2.1, '#d4bd87', '#33291b');
      } else if (formId === 'stroboscope') {
        this.bevelRect(ctx, -21, -27, 36, 31, 5, '#4b555e', '#1b2228');
        ctx.fillStyle = this.unitGradient(ctx, -23, -32, 40, 8, [
          [0, '#87939c'], [0.5, '#49535b'], [1, '#1e252a'],
        ]);
        ctx.beginPath();
        ctx.moveTo(-23, -26);
        ctx.lineTo(17, -30);
        ctx.lineTo(18, -25);
        ctx.lineTo(-20, -21);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#11161a'; ctx.lineWidth = 1.5; ctx.stroke();
        for (var sl = 0; sl < 3; sl++) {
          var sy = -20 + sl * 8;
          var strobeLit = Math.sin(t * 17 + sl * 1.7) > 0.2;
          ctx.fillStyle = strobeLit ? '#ffffff' : '#607481';
          ctx.beginPath(); ctx.arc(10, sy, 4.5, 0, 6.283); ctx.fill();
          ctx.strokeStyle = strobeLit ? form.color : '#1d252a';
          ctx.lineWidth = 2; ctx.stroke();
          if (strobeLit) {
            ctx.globalAlpha = 0.42;
            ctx.drawImage(this.glow(form.color, 18), 1, sy - 9, 18, 18);
            ctx.globalAlpha = 1;
          }
          this.unitBolt(ctx, -15, sy, 1.8, '#aeb8be', '#242a2e');
        }
        ctx.fillStyle = '#252d33';
        ctx.fillRect(-7, -18, 5, 20);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,.4)';
        ctx.beginPath(); ctx.ellipse(-3, -8, 20, 17, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = this.unitGradient(ctx, -20, -27, 34, 34, [
          [0, '#78838b'], [0.46, '#414a51'], [1, '#1b2126'],
        ]);
        ctx.beginPath(); ctx.arc(-4, -11, 16, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#101418'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(-4, -11, 13, 3.4, 5.6); ctx.stroke();
        ctx.fillStyle = this.unitGradient(ctx, 7, -19, 14, 16, [
          [0, '#fff8d5'], [0.5, d.glow], [1, '#8b7440'],
        ]);
        ctx.beginPath(); ctx.arc(11, -11, 8.5, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#1b2024'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(11, -11, 5, 3.5, 5.5); ctx.stroke();
        this.unitBolt(ctx, -12, -23, 2.1, '#c8d0d5', '#242a2e');
      }
      ctx.restore();
    } else if (u.type === 'flame') {
      this.bevelRect(ctx, -size, 4, size * 2, 25, 6, '#443a31', '#171411');
      this.bevelRect(ctx, -18, -6, 34, 29, 5, '#5b5147', '#211d19');
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-size + 7, 9);
      ctx.lineTo(size - 7, 9);
      ctx.stroke();
      for (var fb = -size + 9; fb <= size - 9; fb += 24) {
        this.unitBolt(ctx, fb, 23, 2.2, '#b8b0a5', '#27221e');
      }

      // 压力表与供油总管。
      ctx.strokeStyle = '#171a1c'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-27, 12);
      ctx.bezierCurveTo(-24, -7, -19, -22, -7, -24);
      ctx.stroke();
      ctx.strokeStyle = '#788087'; ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#252b2f';
      ctx.beginPath(); ctx.arc(-17, -23, 7, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#c4c9c8';
      ctx.beginPath(); ctx.arc(-17, -23, 5, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#4d2a23'; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-17, -23);
      ctx.lineTo(-14.5, -26.5 + Math.sin(t * 2.3) * 1.2);
      ctx.stroke();
      ctx.strokeStyle = '#596168'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(-17, -23, 5.8, 0, 6.283); ctx.stroke();
      ctx.fillStyle = pulse ? '#fff2c0' : (formId ? form.color : d.glow);
      ctx.beginPath(); ctx.arc(-4, 8, 4.2, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 0.34;
      ctx.drawImage(this.glow(formId ? form.color : d.glow, 16), -12, 0, 16, 16);
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.scale(face, 1);
      if (formId === 'fanfire') {
        this.bevelRect(ctx, -7, -12, 25, 24, 5, '#6d6257', '#29241f');
        ctx.fillStyle = this.unitGradient(ctx, 11, -24, 27, 48, [
          [0, '#8d8173'], [0.42, '#514941'], [1, '#24211e'],
        ]);
        ctx.beginPath();
        ctx.moveTo(12, -10);
        ctx.lineTo(31, -23);
        ctx.lineTo(37, 23);
        ctx.lineTo(12, 10);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#141311'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = form.color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(32, -20); ctx.lineTo(36, 20);
        ctx.stroke();
        for (var fn = -12; fn <= 12; fn += 8) {
          ctx.strokeStyle = 'rgba(255,235,210,.42)';
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(16, fn * 0.45); ctx.lineTo(34, fn); ctx.stroke();
        }
        this.bevelRect(ctx, 13, -24, 17, 6, 2, '#7d746a', '#302c28');
        this.unitBolt(ctx, 20, -21, 1.8, '#d7d0c5', '#2b2723');
      } else if (formId === 'needlefire') {
        this.bevelRect(ctx, -9, -12, 25, 24, 5, '#72685e', '#29241f');
        this.bevelRect(ctx, 11, -9, 33, 18, 5, '#8a8176', '#302c28');
        for (var heatRing = 18; heatRing <= 37; heatRing += 9) {
          this.bevelRect(ctx, heatRing, -12, 5, 24, 2, '#b0a395', '#3a332d');
        }
        this.bevelRect(ctx, 41, -12, 8, 24, 3, form.color, '#5c3a20');
        ctx.strokeStyle = 'rgba(255,255,255,.78)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(13, -4); ctx.lineTo(46, -4); ctx.stroke();
        ctx.fillStyle = '#fff0bb';
        ctx.fillRect(45, -3, 4, 6);
        ctx.strokeStyle = '#262b2e'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-3, -14); ctx.lineTo(-3, -23); ctx.lineTo(18, -23); ctx.stroke();
        this.unitBolt(ctx, 0, -18, 2, '#c6c0b6', '#2a2723');
      } else if (formId === 'emberfire') {
        ctx.fillStyle = this.unitGradient(ctx, -43, -27, 28, 45, [
          [0, '#8b5544'], [0.4, '#5a372c'], [1, '#271b17'],
        ]);
        ctx.beginPath(); ctx.ellipse(-30, -5, 14, 21, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#1b1513'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = form.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(-30, -5, 10, 17, 0, 0, 6.283); ctx.stroke();
        ctx.strokeStyle = '#6b5144'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-36, -20); ctx.lineTo(-24, -20); ctx.stroke();
        ctx.strokeStyle = '#171a1c'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(-18, -5); ctx.bezierCurveTo(-8, -23, 5, -24, 13, -8); ctx.stroke();
        ctx.strokeStyle = '#777b79'; ctx.lineWidth = 3; ctx.stroke();
        this.bevelRect(ctx, 9, -10, 27, 20, 5, '#5d554d', '#24211e');
        this.bevelRect(ctx, 34, -8, 8, 16, 3, form.color, '#5b3826');
        for (var emberCoil = 0; emberCoil < 4; emberCoil++) {
          ctx.strokeStyle = emberCoil % 2 ? '#7b5a46' : form.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(16 + emberCoil * 6, 0, 8, -1.3, 1.3);
          ctx.stroke();
        }
        for (var em = 0; em < 3; em++) {
          ctx.globalAlpha = 0.38 + Math.sin(t * 6 + em) * 0.24;
          ctx.drawImage(this.glow(form.color, 20), 27 + em * 6, -13 - em * 2, 20, 20);
          ctx.globalAlpha = 1;
        }
      } else {
        this.bevelRect(ctx, -10, -13, 26, 26, 6, '#6e655b', '#28241f');
        ctx.fillStyle = this.unitGradient(ctx, -13, -17, 26, 26, [
          [0, '#9b9185'], [0.46, '#565049'], [1, '#24211e'],
        ]);
        ctx.beginPath(); ctx.arc(-1, -4, 12, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#151412'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(-1, -4, 9.5, 3.5, 5.5); ctx.stroke();
        this.bevelRect(ctx, 10, -8, 25, 16, 4, '#7b7167', '#2b2723');
        this.bevelRect(ctx, 33, -11, 8, 22, 3, d.color, '#6a3824');
        ctx.strokeStyle = d.glow; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(14, -4); ctx.lineTo(38, -4); ctx.stroke();
        this.unitBolt(ctx, -1, -4, 3, '#c9c1b6', '#2b2723');
      }
      ctx.restore();

      if (u.pulse > 0) {
        ctx.save();
        ctx.rotate(face < 0 ? Math.PI : 0);
        var flameTail = Math.sin(t * 24) * 0.12;
        var flameStart = formId === 'needlefire' ? 4 : 7;
        var flameWidth = formId === 'needlefire' ? 0.42 : (formId === 'fanfire' ? 1.35 : 1);
        var fg = ctx.createLinearGradient(flameStart, 0, u.range, 0);
        fg.addColorStop(0, formId === 'emberfire' ? 'rgba(255,158,76,0.95)' : 'rgba(255,244,205,0.98)');
        fg.addColorStop(0.3, formId === 'needlefire' ? 'rgba(255,226,140,0.9)' : 'rgba(255,146,48,0.78)');
        fg.addColorStop(0.72, formId === 'emberfire' ? 'rgba(224,74,28,0.44)' : 'rgba(214,56,16,0.48)');
        fg.addColorStop(1, 'rgba(120,20,5,0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(flameStart, -flameWidth * 5);
        ctx.lineTo(u.range, -u.spray * flameWidth * (0.78 + flameTail));
        ctx.lineTo(u.range * 0.9, 0);
        ctx.lineTo(u.range, u.spray * flameWidth * (0.78 - flameTail));
        ctx.lineTo(flameStart, flameWidth * 5);
        ctx.closePath();
        ctx.fill();

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        var core = ctx.createLinearGradient(flameStart, 0, u.range * 0.78, 0);
        core.addColorStop(0, 'rgba(255,255,236,0.9)');
        core.addColorStop(0.45, formId === 'emberfire' ? 'rgba(255,137,60,0.62)' : 'rgba(255,214,116,0.72)');
        core.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.moveTo(flameStart, -3 * flameWidth);
        ctx.lineTo(u.range * 0.76, -u.spray * 0.18 * flameWidth);
        ctx.lineTo(u.range * 0.76, u.spray * 0.18 * flameWidth);
        ctx.lineTo(flameStart, 3 * flameWidth);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.restore();
      }
    } else if (u.type === 'tesla') {
      this.unitPlatform(ctx, size, formId ? form.color : d.glow);
      this.bevelRect(ctx, -18, -1, 36, 27, 5, '#48515a', '#1b2228');
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      for (var vent = -10; vent <= 10; vent += 5) {
        this.roundRectPath(ctx, vent - 1.5, 5, 3, 13, 1.5);
        ctx.fill();
      }
      this.unitBolt(ctx, -13, 21, 2.4, '#c2cad0', '#20262a');
      this.unitBolt(ctx, 13, 21, 2.4, '#c2cad0', '#20262a');
      this.bevelRect(ctx, -8, -30, 16, 34, 5, '#626d75', '#242c32');
      for (var ins = 0; ins < 4; ins++) {
        var iy = -25 + ins * 7;
        ctx.fillStyle = this.unitGradient(ctx, -13, iy - 3, 26, 7, [
          [0, '#e4e7e4'], [0.44, '#9ba6a8'], [1, '#4e5b60'],
        ]);
        ctx.beginPath(); ctx.ellipse(0, iy, 12 - ins * 0.5, 3.6, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = '#293238'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      for (var coil = 0; coil < 5; coil++) {
        var cy = -16 + coil * 5;
        ctx.strokeStyle = coil % 2 ? 'rgba(206,238,246,.7)' : 'rgba(74,132,151,.85)';
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.ellipse(0, cy, 9, 3, 0, 0, 6.283); ctx.stroke();
      }
      var terminalPulse = 0.55 + Math.sin(t * 11) * 0.25 + pulse * 0.35;
      ctx.fillStyle = pulse ? '#ffffff' : d.glow;
      ctx.beginPath(); ctx.arc(0, -34, pulse ? 7.5 : 5.5, 0, 6.283); ctx.fill();
      ctx.globalAlpha = terminalPulse;
      ctx.drawImage(this.glow(formId ? form.color : d.glow, 24), -12, -46, 24, 24);
      ctx.globalAlpha = 1;

      if (formId === 'topology') {
        var nodes = [[-27, -12], [-20, -36], [20, -36], [27, -12], [17, 5], [-17, 5]];
        ctx.strokeStyle = '#27343d'; ctx.lineWidth = 5;
        ctx.beginPath();
        for (var hn = 0; hn < nodes.length; hn++) {
          if (hn === 0) ctx.moveTo(nodes[hn][0], nodes[hn][1]);
          else ctx.lineTo(nodes[hn][0], nodes[hn][1]);
        }
        ctx.closePath(); ctx.stroke();
        ctx.strokeStyle = form.color; ctx.lineWidth = 1.8;
        ctx.globalAlpha = 0.78;
        ctx.stroke();
        for (var link = 0; link < nodes.length; link += 2) {
          ctx.beginPath();
          ctx.moveTo(nodes[link][0], nodes[link][1]);
          ctx.lineTo(0, -34);
          ctx.stroke();
        }
        for (var ni = 0; ni < nodes.length; ni++) {
          ctx.fillStyle = '#26343c';
          ctx.beginPath(); ctx.arc(nodes[ni][0], nodes[ni][1], 5.5, 0, 6.283); ctx.fill();
          ctx.fillStyle = ni % 2 ? '#e7fbff' : form.color;
          ctx.beginPath(); ctx.arc(nodes[ni][0], nodes[ni][1], 3.1, 0, 6.283); ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (formId === 'lightningspear') {
        this.bevelRect(ctx, -5, -58, 10, 34, 4, '#69757d', '#252e34');
        ctx.fillStyle = this.unitGradient(ctx, -9, -52, 18, 25, [
          [0, '#eefcff'], [0.46, form.color], [1, '#4b7485'],
        ]);
        ctx.beginPath();
        ctx.moveTo(0, -64); ctx.lineTo(8, -51); ctx.lineTo(4, -39);
        ctx.lineTo(-4, -39); ctx.lineTo(-8, -51);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#17242b'; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -61); ctx.lineTo(0, -42); ctx.stroke();
        ctx.strokeStyle = '#53616a'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(-4, -28); ctx.lineTo(-19, -39); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(4, -28); ctx.lineTo(19, -39); ctx.stroke();
        ctx.strokeStyle = form.color; ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#dff9ff';
        ctx.beginPath(); ctx.arc(-20, -40, 3, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(20, -40, 3, 0, 6.283); ctx.fill();
      } else if (formId === 'pulsecoil') {
        this.bevelRect(ctx, -37, -14, 11, 27, 3, '#69737a', '#242b30');
        this.bevelRect(ctx, 26, -14, 11, 27, 3, '#69737a', '#242b30');
        ctx.fillStyle = form.color;
        ctx.fillRect(-34, -8, 5, 14);
        ctx.fillRect(29, -8, 5, 14);
        this.unitBolt(ctx, -31.5, -10, 1.7, '#d8eef0', '#233036');
        this.unitBolt(ctx, 31.5, -10, 1.7, '#d8eef0', '#233036');
        var ringPulse = 0.48 + Math.sin(t * 9) * 0.28;
        ctx.strokeStyle = form.color;
        ctx.globalAlpha = ringPulse;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, -12, 27, 0, 6.283); ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, -12, 35, -2.7, -0.45); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -12, 35, 0.45, 2.7); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 小幅程序电弧，脉冲时明显增强。
      var arcTargets = formId === 'topology'
        ? [[-27, -12], [27, -12], [-20, -36], [20, -36]]
        : (formId === 'lightningspear' ? [[0, -60], [-20, -40], [20, -40]] : [[-31, -4], [31, -4]]);
      var arcAlpha = 0.36 + pulse * 0.52 + Math.sin(t * 13) * 0.12;
      ctx.strokeStyle = pulse ? '#ffffff' : (formId ? form.color : d.glow);
      ctx.lineWidth = pulse ? 2 : 1.3;
      ctx.globalAlpha = Math.max(0.16, arcAlpha);
      if (this.cfg.shadow) {
        ctx.shadowColor = formId ? form.color : d.glow;
        ctx.shadowBlur = pulse ? 9 : 4;
      }
      for (var at = 0; at < arcTargets.length; at++) {
        var sx = 0, sy = -34;
        var ex = arcTargets[at][0], ey = arcTargets[at][1];
        var dx = ex - sx, dy = ey - sy;
        var arcLen = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        var px = -dy / arcLen, py = dx / arcLen;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        for (var seg = 1; seg < 6; seg++) {
          var segFrac = seg / 6;
          var jitter = Math.sin(seg * 8.7 + at * 4.1 + Math.floor(t * 17)) * 3.2;
          ctx.lineTo(sx + dx * segFrac + px * jitter, sy + dy * segFrac + py * jitter);
        }
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      if (this.cfg.shadow) ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    } else if (u.type === 'sniper') {
      this.drawSniper(u, t, scene, form);
    } else if (u.type === 'venom') {
      this.drawVenom(u, t, scene, form);
    } else if (u.type === 'frost') {
      this.drawFrost(u, t, scene, form);
    } else if (u.type === 'quake') {
      this.drawQuake(u, t, scene, form);
    } else if (u.type === 'railgun') {
      this.drawRailgun(u, t, scene, form);
    } else if (u.type === 'totem') {
      this.drawTotem(u, t, scene, form);
    }

    // 等级点
    for (var lv = 0; lv < u.lv - 1; lv++) {
      ctx.fillStyle = '#ffd25e';
      ctx.beginPath();
      ctx.arc(-6 + lv * 7, size + 2, 3, 0, 6.283);
      ctx.fill();
    }

    // 作战指示灯：射程内有目标就亮，真正造成伤害时闪白
    if (ATTACKERS[u.type] && !u.thumbnail) this.drawActivityMark(ctx, u, size, formId ? form.color : d.glow);

    // 血条
    if (dmgFrac < 0.999) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(-size, -size - 12, size * 2, 5);
      ctx.fillStyle = dmgFrac > 0.4 ? '#8fd07a' : '#e0603c';
      ctx.fillRect(-size, -size - 12, size * 2 * dmgFrac, 5);
    }
    // 受击闪白
    if (u.flash > 0.01 && !d.animal) {
      ctx.globalAlpha = Math.min(0.71, u.flash * 0.7);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, size, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },

  /* 动物伙伴：明亮的简单卡通，通过耳、尾、翅、甲壳等轮廓区分物种。 */
  drawAnimalUnit: function (ctx, u, t, size, d, form, face) {
    var rows = u.thumbnail ? [u.lane] : unitFootprintLanes(u.type, u.lane);
    for (var i = 0; i < rows.length; i++) {
      ctx.save();
      ctx.translate(0, (rows[i] - u.lane) * CONFIG.GRID_LANE_PITCH / CONFIG.UNIT_DRAW_SCALE);
      if (!u.thumbnail) {
        // 每个足迹都有接触阴影；不在身体中心画辉光，避免漂浮的光球感。
        ctx.fillStyle = 'rgba(14,29,25,.26)';
        ctx.beginPath(); ctx.ellipse(0, 33, 30, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(9,23,20,.32)';
        ctx.beginPath(); ctx.ellipse(0, 33, 20, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.scale(face, 1);
      this.drawAnimal(ctx, u, t, size, d, form);
      ctx.restore();
    }
  },

  /* 静态动物美术按物种和清晰度缓存；菜单、卡片和战场共用同一入口。 */
  animalAtlasBounds: function (animal) {
    if (this._animalAtlasBounds[animal]) return this._animalAtlasBounds[animal];
    var index = this.animalAtlasOrder.indexOf(animal);
    if (!this.animalAtlas || this.animalAtlasReadable === false || index < 0) return null;
    var tileX = (index % 4) * 256, tileY = Math.floor(index / 4) * 256;
    var tile = document.createElement('canvas'); tile.width = tile.height = 256;
    var tc = tile.getContext('2d');
    tc.drawImage(this.animalAtlas, tileX, tileY, 256, 256, 0, 0, 256, 256);
    var pixels;
    try { pixels = tc.getImageData(0, 0, 256, 256).data; this.animalAtlasReadable = true; }
    catch (error) {
      // 某些file://浏览器禁止读取本地图片像素，保留干净的程序精灵。
      this.animalAtlasReadable = false; return null;
    }
    var left = 256, top = 256, right = -1, bottom = -1;
    for (var y = 0; y < 256; y++) {
      for (var x = 0; x < 256; x++) {
        if (pixels[(y * 256 + x) * 4 + 3] <= 150) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return null;
    var width = right - left + 1, height = bottom - top + 1;
    var cropLeft = Math.max(0, Math.floor(left - width * .04));
    var cropTop = Math.max(0, Math.floor(top - height * .04));
    var cropRight = Math.min(256, Math.ceil(right + 1 + width * .04));
    var cropBottom = Math.min(256, Math.ceil(bottom + 1 + height * .04));
    var rec = { tileX: tileX, tileY: tileY, left: cropLeft, top: cropTop,
      width: cropRight - cropLeft, height: cropBottom - cropTop,
      centerX: (left + right + 1) / 2, feetY: bottom + 1 };
    this._animalAtlasBounds[animal] = rec;
    return rec;
  },

  animalArtSprite: function (animal) {
    var k = Math.max(2, Math.min(3, (this.dpr || 1) * (this.scale || 1)));
    var key = 'reference-animal|' + animal + '|' + k + '|' + (this.animalAtlas && this.animalAtlasReadable !== false ? 'atlas' : 'vector');
    if (this._spriteCache[key]) return this._spriteCache[key];
    var c = document.createElement('canvas'); c.width = Math.ceil(128 * k); c.height = Math.ceil(112 * k);
    var ctx = c.getContext('2d'); ctx.scale(k, k); ctx.translate(64, 70);
    var bounds = this.animalAtlasBounds(animal);
    if (bounds) {
      var fit = Math.min(100 / bounds.width, 98 / bounds.height);
      // 主体居中、真实脚底锚定y33；4%透明边缘完整保留耳尾。
      var x = (bounds.left - bounds.centerX) * fit;
      var y = 33 - (bounds.feetY - bounds.top) * fit;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.animalAtlas, bounds.tileX + bounds.left, bounds.tileY + bounds.top,
        bounds.width, bounds.height, x, y, bounds.width * fit, bounds.height * fit);
    } else { this.drawAnimalArt(ctx, animal); }
    var rec = { img: c };
    this._spriteCache[key] = rec;
    return rec;
  },

  // 动作只读取模拟的攻击/受伤计时，不改伤害、目标或位置。脚底y33始终固定。
  animalPose: function (u, t, d) {
    var attack = u.thumbnail ? 0 : Math.min(1, Math.max(0, (u.actT || 0) / .3, (u.pulse || 0) / .2));
    var hit = u.thumbnail ? 0 : Math.min(1, Math.max(0, (u.hurtT || 0) / .28));
    var sx = 1, sy = 1, lean = 0;
    if (!this.reduceAnimalMotion) {
      if (d.behavior === 'block' || d.behavior === 'quake') {
        sx += .15 * attack; sy -= .12 * attack; lean -= .035 * attack;
      } else if (d.behavior === 'contact') {
        sx += .13 * attack; sy += .04 * attack;
      } else if (d.behavior === 'chain') {
        sx += .08 * attack; sy -= .09 * attack;
        lean -= (.06 + Math.sin(t * 18) * .05) * attack;
      } else if (d.behavior === 'aura' || d.behavior === 'healer') {
        sx += .035 * attack; sy -= .025 * attack;
        lean = Math.sin(t * 12 + (u.id || 0)) * .045 * attack;
      } else {
        // 浣熊/狐狸等前倾发力；完整插画的耳、尾随着身体动作。
        sx += .07 * attack; sy -= .06 * attack; lean -= .15 * attack;
      }
      // 受击收身、后仰；只响应真实扣血，治疗flash不会误触发。
      sx += .12 * hit; sy -= .15 * hit; lean += .15 * hit;
    }
    return { attack: attack, hit: hit, sx: sx, sy: sy, lean: lean };
  },

  drawAnimal: function (ctx, u, t, size, d, form) {
    var pose = this.animalPose(u, t, d);
    ctx.save();
    // 用剪切前倾而非旋转/跳动：所有脚掌留在同一地平线上。
    ctx.translate(0, 33); ctx.transform(pose.sx, 0, pose.lean, pose.sy, 0, 0); ctx.translate(0, -33);
    var art = this.animalArtSprite(d.animal);
    ctx.drawImage(art.img, -64, -70, 128, 112);
    if (form && form.id !== 'neutral') {
      var badgeX = 10, badgeY = -3;
      if (d.animal === 'eel' || d.animal === 'snake') { badgeX = 26; badgeY = -14; }
      else if (d.animal === 'hawk' || d.animal === 'owl' || d.animal === 'phoenix') { badgeX = 19; badgeY = -5; }
      else if (d.animal === 'firefly' || d.animal === 'bee') { badgeX = 1; badgeY = 7; }
      ctx.strokeStyle = '#514940'; ctx.lineWidth = 1.3;
      ctx.fillStyle = form.color;
      this.roundRectPath(ctx, badgeX - 4, badgeY - 3, 8, 6, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff1cf'; ctx.beginPath(); ctx.arc(badgeX - 1, badgeY - 1, 1, 0, 6.283); ctx.fill();
    }
    if (d.animal === 'frog' && u.pulse > 0 && !u.thumbnail) {
      ctx.strokeStyle = '#bf7a79'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(39, -2); ctx.quadraticCurveTo(49, 1, 55, -7); ctx.stroke();
    }
    ctx.restore();
    if (pose.hit > 0) {
      ctx.save(); ctx.globalAlpha *= pose.hit * .85;
      ctx.strokeStyle = '#ffe3a1'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      var headY = d.animal === 'eel' || d.animal === 'snake' ? 0 : -38;
      ctx.beginPath(); ctx.moveTo(-36, headY - 9); ctx.lineTo(-42, headY - 14);
      ctx.moveTo(-39, headY + 1); ctx.lineTo(-47, headY);
      ctx.moveTo(-35, headY + 10); ctx.lineTo(-40, headY + 15); ctx.stroke();
      ctx.restore();
    }
  },

  /* 每个物种独立的坐姿、侧站、蹲姿或飞姿。柔和分区色块配小点眼，
     不使用通用横卧身体，也不把眼白和光效当作动物五官。 */
  drawAnimalArt: function (ctx, animal) {
    var ink = '#514940', cream = '#f2dfb8';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    function path(commands) {
      ctx.beginPath();
      for (var i = 0; i < commands.length; i++) {
        var p = commands[i];
        if (p[0] === 'M') ctx.moveTo(p[1], p[2]);
        else if (p[0] === 'L') ctx.lineTo(p[1], p[2]);
        else if (p[0] === 'Q') ctx.quadraticCurveTo(p[1], p[2], p[3], p[4]);
        else if (p[0] === 'C') ctx.bezierCurveTo(p[1], p[2], p[3], p[4], p[5], p[6]);
        else if (p[0] === 'Z') ctx.closePath();
      }
    }
    function shape(commands, color, edge, width) {
      path(commands); ctx.fillStyle = color; ctx.fill();
      if (edge !== false) { ctx.strokeStyle = edge || ink; ctx.lineWidth = width || 2.2; ctx.stroke(); }
    }
    function line(commands, color, width) {
      path(commands); ctx.strokeStyle = color || ink; ctx.lineWidth = width || 1.7; ctx.stroke();
    }
    function ellipse(x, y, rx, ry, color, edge, rot) {
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      if (edge !== false) { ctx.strokeStyle = edge || ink; ctx.lineWidth = 2.1; ctx.stroke(); }
    }
    function eye(x, y, r) { ellipse(x, y, r || 1.7, (r || 1.7) * 1.2, '#352f2a', false); }
    function nose(x, y, rx) { ellipse(x, y, rx || 3, 2.4, '#3d342c', false); }
    function toes(x, y, color) {
      line([['M', x - 4, y], ['L', x - 4, y + 3], ['M', x + 1, y], ['L', x + 1, y + 3]], color || ink, 1.2);
    }
    switch (animal) {
      case 'bear': {
        // 高竖坐姿、下宽上窄的背和分开的短前掌。
        shape([['M',-14,-37],['C',-30,-29,-38,2,-35,29],['Q',-34,33,-24,33],
          ['L',25,33],['Q',31,28,26,12],['C',24,-5,25,-25,12,-35],['Z']], '#a97649');
        shape([['M',-25,-7],['C',-29,8,-27,26,-18,29],['L',19,29],
          ['C',24,12,18,-3,11,-7],['C',0,-11,-18,-13,-25,-7],['Z']], '#b98655', false);
        ellipse(-14,29,14,5,'#a16f44'); ellipse(23,29,9,4,'#a16f44');
        ellipse(-4,-48,7,7,'#a97649'); ellipse(25,-49,6,6,'#a97649');
        ellipse(-4,-48,3,3,'#d4a575',false); ellipse(25,-49,2.7,2.7,'#d4a575',false);
        shape([['M',-11,-36],['C',-11,-48,7,-54,23,-44],['C',33,-39,38,-30,32,-21],
          ['C',28,-13,8,-11,-3,-21],['Q',-12,-25,-11,-36],['Z']], '#b58252');
        ellipse(27,-26,11,9,'#dca875',false);
        eye(13,-36); eye(27,-36,1.5); nose(33,-28,3.8);
        line([['M',33,-26],['Q',34,-21,29,-21]],ink,1.4);
        line([['M',-13,-7],['C',-15,3,-11,18,-7,28],['M',10,-7],['C',8,5,10,22,13,30]],'#765538',2);
        toes(-8,27,'#765538'); toes(14,28,'#765538');
        break;
      }
      case 'porcupine': {
        // 豪猪是低矮的拱背，圆束长刺沿背部排开。
        shape([['M',-35,23],['Q',-47,8,-49,-1],['L',-40,2],['Q',-43,-16,-41,-23],
          ['L',-32,-14],['Q',-34,-31,-28,-38],['L',-22,-23],['Q',-14,-40,-8,-43],
          ['L',-5,-25],['Q',6,-38,11,-36],['L',14,-19],['L',25,-19],
          ['Q',29,-3,21,16],['L',8,28],['Z']], '#b49b75');
        shape([['M',-34,23],['C',-39,6,-35,-16,-15,-22],['C',0,-29,19,-17,24,-1],
          ['C',28,14,18,28,-3,29],['L',-28,30],['Z']], '#96714e');
        line([['M',-28,-3],['L',-24,-13],['M',-15,-8],['L',-10,-19],['M',-1,-6],['L',3,-17]],'#cfb991',2);
        ellipse(-14,29,8,4,'#8e6846'); ellipse(20,29,7,4,'#8e6846');
        ellipse(23,-7,5,5,'#ac835c');
        shape([['M',16,-10],['C',31,-16,34,-4,45,1],['Q',49,4,45,10],
          ['C',33,17,15,10,13,1],['Z']], '#bf9466');
        shape([['M',29,2],['Q',43,-1,45,3],['Q',46,9,33,12],['Z']], '#dfc092',false);
        eye(31,-3,1.6); nose(46,4,2.5);
        line([['M',36,10],['Q',40,12,43,9]],ink,1.2);
        break;
      }
      case 'raccoon': {
        var tail = [['M',-16,24],['C',-49,36,-53,3,-44,-16],
          ['C',-35,-34,-23,-23,-29,-8],['C',-37,12,-22,5,-13,11],['Z']];
        shape(tail,'#9b9b8b');
        ctx.save(); path(tail); ctx.clip();
        line([['M',-48,-10],['L',-28,-5],['M',-49,6],['L',-30,11],['M',-41,23],['L',-23,19]],'#5c625d',7);
        ctx.restore();
        shape([['M',-10,-25],['C',-26,-16,-28,17,-21,30],['Q',-4,34,22,30],
          ['C',27,18,25,-14,10,-25],['Z']], '#8c9c99');
        shape([['M',-8,-4],['C',-17,10,-12,26,1,29],['L',15,29],
          ['C',19,14,11,-5,-8,-4],['Z']], '#bac1ac',false);
        ellipse(-8,29,10,4,'#7b8b87'); ellipse(20,29,7,4,'#7b8b87');
        ellipse(-2,-34,6,7,'#8c9c99'); ellipse(23,-36,6,7,'#8c9c99');
        shape([['M',-6,-25],['C',-8,-43,23,-45,33,-30],['L',43,-21],
          ['Q',35,-11,19,-11],['C',4,-9,-5,-15,-6,-25],['Z']], '#acb7a6');
        shape([['M',-1,-28],['Q',15,-39,30,-29],['L',36,-23],
          ['Q',22,-15,5,-18],['Z']], '#65736b',false);
        ellipse(34,-20,9,6,'#d4d1b7',false);
        eye(16,-27,1.8); eye(28,-27,1.6); nose(41,-21,2.8);
        line([['M',-8,0],['Q',-11,14,-3,27],['M',14,-1],['Q',13,12,18,27]],'#62716b',1.8);
        toes(-2,27); toes(19,27);
        break;
      }
      case 'firefly': {
        // 深头黄腹，小点眼；翅膀连在胸部，黄腹本身就是发光色块。
        shape([['M',-8,-9],['C',-39,-45,-49,-24,-29,-9],['Q',-18,1,-8,-9],['Z']], '#d9dac6');
        shape([['M',0,-14],['C',-13,-42,15,-39,15,-19],['Q',14,-10,0,-14],['Z']], '#e4e1c8');
        ellipse(-21,15,20,15,'#ebc94f',ink,-.46);
        ellipse(-28,18,10,10,'#fff1ad',false,-.46);
        shape([['M',-7,0],['Q',-17,5,-12,16],['Q',-5,24,4,11],['L',14,-6],['Z']], '#716e43');
        line([['M',-4,13],['L',0,23],['L',4,21],['M',6,9],['L',12,19],['L',15,16]],ink,2);
        line([['M',12,-24],['Q',15,-36,10,-43],['M',24,-24],['Q',32,-37,40,-37]],'#444b47',2);
        ellipse(10,-43,2.8,2.8,'#444b47',false); ellipse(40,-37,2.8,2.8,'#444b47',false);
        ellipse(19,-12,16,17,'#596567');
        ellipse(25,-10,9,11,'#e2d16c',false);
        eye(29,-11,2.1);
        line([['M',28,-4],['Q',32,-3,33,-6]],ink,1.3);
        break;
      }
      case 'fox': {
        // 竖卷蓬松大尾、尖脸和连续的奶油胸；细前腿是坐姿的一部分。
        var foxTail = [['M',-8,29],['C',-39,38,-52,21,-50,-1],
          ['Q',-53,-20,-51,-37],['C',-25,-38,-15,-18,-23,2],['Q',-25,17,-8,22],['Z']];
        shape(foxTail,'#c47c43');
        ctx.save(); path(foxTail); ctx.clip();
        shape([['M',-56,-41],['L',-26,-35],['Q',-25,-22,-32,-16],
          ['L',-34,-23],['L',-40,-16],['L',-43,-23],['L',-52,-18],['Z']], '#f1dfbd',false); ctx.restore();
        shape([['M',0,-27],['C',-13,-13,-18,15,-13,29],['Q',0,35,27,30],
          ['C',25,12,22,-10,17,-27],['Z']], '#d88e48');
        shape([['M',8,-20],['L',23,-19],['Q',18,-3,19,25],['L',9,28],
          ['Q',-1,16,0,-2],['Z']], '#f3dfbb',false);
        ellipse(-6,28,11,5,'#c47d41');
        shape([['M',3,-36],['L',4,-60],['Q',9,-58,15,-43],['L',26,-56],
          ['Q',29,-51,31,-39],['Q',39,-33,49,-27],['L',53,-26],
          ['Q',41,-17,28,-16],['L',7,-20],['Q',-4,-26,3,-36],['Z']], '#dc944d');
        shape([['M',6,-28],['Q',20,-24,47,-27],['Q',42,-17,28,-16],
          ['L',18,-5],['L',7,-18],['Z']], '#f6e7c8',false);
        shape([['M',7,-51],['L',10,-40],['L',15,-40],['Z']], '#8e623e',false);
        shape([['M',25,-49],['L',21,-39],['L',28,-37],['Z']], '#8e623e',false);
        line([['M',26,-34],['Q',29,-37,31,-34]],ink,1.8); nose(51,-27,2.6);
        line([['M',41,-22],['Q',44,-20,47,-22]],ink,1.3);
        shape([['M',8,14],['L',8,29],['Q',12,33,16,30],['L',15,14],['Z']], '#704f3a');
        shape([['M',22,12],['L',21,28],['Q',25,33,29,30],['L',27,12],['Z']], '#704f3a');
        break;
      }
      case 'eel': {
        shape([['M',-49,24],['C',-32,40,-15,32,-17,9],['C',-20,-9,-1,-5,5,6],
          ['C',13,19,26,8,23,-10],['C',19,-27,27,-43,42,-35],
          ['Q',51,-30,45,-22],['C',30,-21,35,-4,28,15],
          ['C',19,36,0,22,-5,12],['Q',-10,2,-9,19],['C',-7,41,-34,41,-49,24],['Z']], '#668f95');
        shape([['M',-22,24],['C',-25,7,-14,-3,-5,4],['C',7,18,17,20,23,8],
          ['Q',30,-7,30,-20],['L',35,-23],['C',34,-2,31,17,17,25],
          ['C',6,30,-4,15,-11,10],['Q',-16,8,-16,24],['Z']], '#b1c6b3',false);
        line([['M',-26,0],['L',-31,-7],['L',-15,-1],['M',23,-18],['L',17,-27],['L',24,-31]],'#416d78',2);
        eye(40,-30,1.6);
        line([['M',42,-24],['L',46,-26]],ink,1.2);
        line([['M',0,-6],['L',5,-11],['L',3,-4],['L',9,-8]],'#ddc57a',2);
        break;
      }
      case 'hawk': {
        // 自然侧站：尾羽、胸、颈和头连成完整鸟形。
        shape([['M',-23,14],['L',-49,11],['Q',-47,20,-25,24],['L',-5,18],['Z']], '#816e5c');
        shape([['M',-26,13],['C',-18,-5,1,-10,8,-30],['C',9,-44,20,-48,30,-43],
          ['Q',43,-40,39,-24],['Q',35,-16,32,-1],['C',32,15,19,26,-1,25],
          ['Q',-21,25,-26,13],['Z']], '#a78c6c');
        shape([['M',9,-22],['C',5,-4,-5,-1,-10,13],['Q',3,27,21,17],
          ['Q',34,6,30,-16],['Z']], '#deceb1',false);
        shape([['M',-18,5],['C',-9,-6,6,-10,12,1],['Q',15,15,-13,19],
          ['L',-27,16],['Q',-19,12,-18,5],['Z']], '#8d775e');
        line([['M',-13,10],['Q',-2,16,7,8],['M',-20,15],['Q',-8,20,3,15]],'#b49d7f',1.6);
        shape([['M',36,-32],['Q',52,-29,44,-20],['L',42,-25],['L',35,-25],['Z']], '#d5a45e');
        eye(29,-34,1.7);
        line([['M',24,-39],['L',32,-37]],ink,1.2);
        line([['M',6,24],['L',5,31],['L',-2,32],['M',5,31],['L',11,33],
          ['M',20,22],['L',20,31],['L',26,32]],'#a9804f',2.5);
        break;
      }
      case 'snake': {
        shape([['M',-38,26],['C',-47,5,-16,1,-1,15],['C',9,23,27,21,23,10],
          ['C',17,-1,5,9,3,-4],['C',2,-16,9,-35,26,-36],
          ['Q',46,-38,48,-26],['Q',42,-17,27,-20],['C',21,-9,29,-4,33,8],
          ['C',44,32,14,40,-5,29],['C',-18,20,-24,16,-30,23],['Q',-35,30,-38,26],['Z']], '#829664');
        line([['M',-32,27],['C',-27,15,-13,17,-2,26],['C',16,39,39,28,31,10],
          ['Q',17,-4,23,-18]],'#c8cd91',4);
        line([['M',-21,9],['Q',-16,14,-14,17],['M',-2,11],['L',2,16],['M',13,-6],['L',20,-4]],'#62784c',2.8);
        eye(38,-30,1.5);
        line([['M',39,-24],['Q',43,-23,46,-25]],ink,1.3);
        line([['M',47,-24],['L',54,-21],['M',51,-22],['L',53,-26]],'#b77b73',1.4);
        break;
      }
      case 'hare': {
        ellipse(-30,20,8,8,'#e7dfc9');
        shape([['M',-28,25],['C',-34,1,-10,-13,4,0],['Q',18,5,23,27],
          ['Q',13,34,-9,32],['L',-24,32],['Z']], '#efe7d3');
        shape([['M',-15,5],['C',-25,6,-27,24,-18,29],['L',0,29],['Q',3,18,-6,12],['Z']], '#ddd3b9',false);
        ellipse(-13,29,12,4,'#efe7d3');
        shape([['M',6,-28],['C',-4,-40,-5,-57,1,-60],['C',9,-61,14,-39,15,-28],['Z']], '#f5edd9');
        shape([['M',22,-28],['C',16,-46,20,-63,26,-62],['C',33,-61,32,-43,29,-28],['Z']], '#f5edd9');
        line([['M',2,-54],['Q',4,-44,10,-35],['M',25,-56],['Q',24,-43,26,-35]],'#d8a293',3.4);
        shape([['M',0,-18],['C',-1,-33,26,-40,35,-26],['Q',42,-16,32,-9],
          ['C',20,0,4,-4,0,-18],['Z']], '#f8f0dc');
        eye(19,-23,1.6); eye(30,-23,1.4); nose(35,-16,2.2);
        ellipse(14,-14,3,2.2,'#e6b7a1',false);
        line([['M',32,-11],['Q',35,-9,37,-12]],ink,1.1);
        shape([['M',1,-7],['Q',17,1,29,-9],['L',31,-2],['Q',18,10,0,0],['Z']], '#ba7766');
        shape([['M',17,3],['L',14,19],['Q',17,23,22,19],['L',23,1],['Z']], '#ca8771');
        line([['M',9,11],['L',9,27],['Q',14,31,17,28],['M',24,13],['L',25,27]],'#a59b87',1.8);
        ellipse(12,29,5,3,'#f6edd8'); ellipse(26,29,5,3,'#f6edd8');
        break;
      }
      case 'gorilla': {
        shape([['M',-13,-31],['C',-34,-23,-34,10,-25,25],['Q',-2,36,27,25],
          ['C',33,6,28,-24,12,-31],['Z']], '#7d756b');
        shape([['M',-7,-5],['C',-19,4,-16,21,-6,27],['L',15,26],['C',24,14,15,-5,-7,-5],['Z']], '#b2a492',false);
        shape([['M',-23,-16],['C',-40,-15,-42,7,-37,28],['Q',-28,36,-17,29],
          ['L',-14,15],['Q',-20,1,-16,-12],['Z']], '#716c65');
        shape([['M',18,-14],['Q',37,-11,37,28],['Q',27,36,19,29],['L',18,8],['Z']], '#80766b');
        toes(-29,27,'#514a43'); toes(28,28,'#514a43');
        shape([['M',-6,-31],['C',-5,-50,27,-48,34,-32],['Q',39,-17,30,-13],
          ['C',15,-10,-8,-16,-6,-31],['Z']], '#83796b');
        shape([['M',7,-36],['Q',20,-43,31,-33],['L',37,-20],['Q',18,-8,5,-20],['Z']], '#b4a18c',false);
        eye(21,-31,1.8); eye(31,-30,1.4);
        ellipse(31,-21,9,6,'#8c8173',false); nose(35,-23,3);
        line([['M',28,-17],['Q',34,-16,38,-19]],ink,1.5);
        break;
      }
      case 'rhino': {
        line([['M',-34,0],['Q',-45,-2,-46,-12]],'#647981',3);
        shape([['M',-33,3],['C',-43,-17,-19,-27,6,-22],['Q',20,-20,27,-7],
          ['L',32,17],['Q',4,24,-29,18],['Z']], '#9baeb4');
        shape([['M',-24,10],['L',-24,28],['Q',-19,34,-11,30],['L',-10,12],['Z']], '#a7b7bc');
        shape([['M',10,8],['L',12,30],['Q',22,34,26,28],['L',24,11],['Z']], '#a7b7bc');
        line([['M',-11,-17],['Q',-5,-1,-9,14]],'#829aa4',2);
        shape([['M',12,-14],['Q',21,-28,31,-15],['L',46,-3],['Q',52,5,42,14],
          ['L',17,13],['Q',13,0,12,-14],['Z']], '#a8b8ba');
        shape([['M',34,-5],['Q',35,-20,43,-30],['Q',45,-8,41,0],['Z']], '#ded7be');
        shape([['M',16,-21],['Q',10,-39,5,-32],['Q',4,-21,16,-21],['Z']], '#9baeb4');
        eye(27,-9,1.8); nose(47,4,2);
        line([['M',39,9],['Q',44,10,47,7]],ink,1.3); toes(-17,28); toes(19,28);
        break;
      }
      case 'bat': {
        // 翼膜和肩连接成一体，耳朵高竖，身体悬空。
        shape([['M',2,-6],['C',-16,-35,-39,-34,-53,-38],['Q',-48,-17,-40,-10],
          ['Q',-37,-24,-28,-7],['Q',-25,-20,-14,0],['Q',-6,-11,2,5],['Z']], '#9c8ca9');
        shape([['M',14,-10],['Q',31,-31,49,-25],['Q',51,-13,44,-5],
          ['Q',37,-13,31,3],['Q',23,-6,14,8],['Z']], '#ad9bb5');
        line([['M',1,-7],['L',-40,-26],['M',4,-5],['L',-24,-11],['M',17,-8],['L',43,-18]],'#75677f',1.5);
        shape([['M',0,-11],['C',-9,4,-5,18,5,21],['Q',21,20,22,6],['L',19,-14],['Z']], '#84738f');
        shape([['M',0,-26],['L',-3,-49],['Q',5,-49,11,-33],['L',22,-47],
          ['Q',30,-41,27,-24],['Q',32,-9,18,-9],['Q',2,-8,0,-26],['Z']], '#9c8ba8');
        ellipse(20,-21,8,6,'#cdb8bb',false); eye(17,-27,1.7); eye(25,-26,1.4); nose(28,-22,2);
        shape([['M',21,-15],['L',23,-10],['L',25,-16],['Z']], '#f2e4c8',false);
        line([['M',3,19],['L',1,27],['L',-3,25],['M',15,18],['L',16,27],['L',20,25]],ink,1.7);
        break;
      }
      case 'wolf': {
        shape([['M',-11,22],['C',-46,36,-52,13,-45,-1],['Q',-28,0,-21,15],['Z']], '#8c9a9a');
        shape([['M',1,-30],['L',-7,-18],['L',-4,-12],['L',-14,-9],
          ['C',-23,7,-21,28,-13,31],['L',26,31],['C',29,12,18,-18,14,-30],['Z']], '#a1b0ad');
        shape([['M',8,-17],['L',22,-20],['Q',16,-4,18,28],['L',3,27],
          ['L',-2,5],['L',-6,3],['L',0,-3],['Z']], '#d9dfca',false);
        shape([['M',3,-40],['L',1,-60],['Q',10,-58,15,-44],['L',28,-55],
          ['L',29,-36],['L',44,-29],['Q',51,-27,49,-23],['L',32,-17],
          ['L',12,-20],['Q',-5,-27,3,-40],['Z']], '#a8b5ad');
        shape([['M',14,-29],['L',47,-25],['L',31,-17],['L',17,-9],['L',5,-24],['Z']], '#dfe3cf',false);
        eye(29,-32,1.8); nose(49,-25,2.6);
        line([['M',22,-38],['L',31,-36]],'#6e7e79',1.4);
        shape([['M',7,8],['L',6,30],['L',16,30],['L',17,7],['Z']], '#96a7a2');
        shape([['M',22,10],['L',23,30],['L',32,30],['L',29,8],['Z']], '#96a7a2');
        toes(11,27); toes(27,27);
        break;
      }
      case 'owl': {
        shape([['M',-24,18],['L',-29,32],['L',-13,33],['L',4,23],['Z']], '#8d755d');
        shape([['M',-17,-29],['L',-15,-48],['L',-3,-40],['Q',12,-48,24,-37],
          ['L',28,-49],['Q',40,-18,33,4],['C',33,24,11,34,-10,27],
          ['C',-29,19,-27,-10,-17,-29],['Z']], '#a38a68');
        shape([['M',-6,-37],['Q',8,-41,13,-29],['Q',20,-42,30,-32],
          ['C',40,-17,22,-6,12,-13],['C',-2,-5,-15,-20,-6,-37],['Z']], '#e0d3ae',false);
        eye(6,-25,2); eye(23,-25,2);
        shape([['M',13,-19],['L',20,-16],['L',14,-11],['Z']], '#bd9455',false);
        shape([['M',-20,-7],['C',-29,2,-24,20,-13,25],['Q',-3,11,-3,-2],['Z']], '#8a735b');
        line([['M',1,5],['L',4,8],['L',7,5],['M',14,9],['L',17,12],['L',20,9],
          ['M',4,17],['L',7,20],['L',10,17]],'#d5c6a1',2);
        line([['M',2,28],['L',1,33],['L',-4,33],['M',18,27],['L',18,33],['L',24,33]],'#aa8756',2.5);
        break;
      }
      case 'boar': {
        line([['M',-34,3],['C',-46,5,-49,-6,-42,-8]],ink,2.6);
        shape([['M',-32,12],['C',-44,-10,-23,-25,4,-22],['Q',22,-19,26,-1],
          ['L',31,18],['Q',4,26,-30,19],['Z']], '#977452');
        shape([['M',-32,-7],['L',-27,-21],['L',-21,-16],['L',-14,-26],
          ['L',-8,-20],['L',1,-26],['L',13,-17],['Q',-14,-16,-32,-7],['Z']], '#77604a',false);
        shape([['M',-25,16],['L',-24,30],['L',-13,30],['L',-12,17],['Z']], '#79634c');
        shape([['M',12,15],['L',14,30],['L',25,30],['L',26,15],['Z']], '#79634c');
        shape([['M',15,-13],['L',16,-28],['L',26,-18],['Q',35,-13,36,-4],
          ['L',46,3],['Q',48,15,37,17],['L',20,11],['Z']], '#ac8056');
        ellipse(44,6,9,8,'#c3956e'); eye(28,-7,1.7);
        ellipse(48,3,1.5,1.5,ink,false); ellipse(48,8,1.5,1.5,ink,false);
        shape([['M',31,8],['Q',37,19,42,7],['Q',44,24,32,16],['Z']], '#e9d8b5');
        break;
      }
      case 'chameleon': {
        // 长趾和螺旋尾，不借用青蛙或哺乳动物的坐姿。
        line([['M',-20,14],['C',-45,32,-57,7,-45,-4],['C',-32,-14,-21,6,-36,10]],ink,9);
        line([['M',-20,14],['C',-45,32,-57,7,-45,-4],['C',-32,-14,-21,6,-36,10]],'#8ba77a',5.4);
        shape([['M',-24,9],['C',-19,-8,2,-13,22,-3],['L',29,15],
          ['Q',-1,23,-24,15],['Z']], '#8ba77a');
        line([['M',-16,13],['L',-19,28],['L',-25,31],['M',-19,28],['L',-13,31],
          ['M',15,13],['L',21,27],['L',29,31],['M',21,27],['L',17,31]],'#698363',3.5);
        shape([['M',16,-3],['L',18,-20],['Q',27,-37,31,-27],['L',38,-10],
          ['L',50,-2],['Q',43,9,22,6],['Z']], '#9ab886');
        ellipse(31,-11,5.5,5.5,'#b7c995'); eye(33,-12,1.7);
        line([['M',34,3],['Q',43,4,47,0]],ink,1.3);
        line([['M',-9,-5],['L',-12,-10],['M',1,-7],['L',1,-13],['M',10,-6],['L',13,-11]],'#647f5c',2);
        break;
      }
      case 'elephant': {
        line([['M',-32,-4],['Q',-43,-4,-44,12]],'#7e9296',2.6);
        shape([['M',-31,10],['C',-43,-11,-24,-28,2,-24],['Q',27,-27,29,-4],
          ['L',29,22],['L',-29,22],['Z']], '#a5b7b8');
        shape([['M',-27,11],['L',-27,30],['Q',-21,34,-15,30],['L',-14,14],['Z']], '#aebdbb');
        shape([['M',-6,13],['L',-4,30],['L',7,30],['L',8,14],['Z']], '#97aaad');
        shape([['M',15,8],['L',15,30],['Q',23,34,27,29],['L',29,11],['Z']], '#aebdbb');
        shape([['M',13,-18],['C',15,-34,43,-33,46,-12],['C',48,3,48,15,43,18],
          ['Q',35,21,37,12],['Q',35,14,35,19],['C',39,30,53,21,51,7],
          ['L',47,-11],['Q',47,-24,31,-28],['L',15,-23],['Z']], '#aebdbc');
        ellipse(12,-10,13,19,'#c0ccc5'); line([['M',10,-24],['Q',23,-11,11,7]],'#99afad',1.5);
        eye(35,-15,1.7);
        shape([['M',32,-1],['Q',40,8,45,0],['Q',44,11,35,6],['Z']], '#eee0c4');
        toes(-21,28,'#7a9093'); toes(21,28,'#7a9093');
        break;
      }
      case 'frog': {
        // 蹲伏的宽后腿、小前掌和低头部：脚趾与眼丘都属于蛙的轮廓。
        shape([['M',-18,2],['C',-35,-1,-40,17,-29,26],['L',-38,31],
          ['L',-14,31],['Q',0,25,5,9],['Z']], '#87a274');
        shape([['M',-13,-3],['C',-4,-16,17,-15,27,-5],['Q',34,15,17,27],
          ['Q',0,34,-15,22],['Z']], '#9cb67d');
        ellipse(18,10,15,12,'#d0d3a0',false);
        shape([['M',4,-13],['Q',2,-26,13,-26],['Q',22,-26,24,-17],
          ['Q',33,-29,39,-23],['Q',45,-19,43,-8],['Q',38,3,20,1],
          ['Q',3,1,4,-13],['Z']], '#a7bf84');
        eye(15,-19,1.9); eye(35,-18,1.7);
        line([['M',22,-4],['Q',33,0,40,-6]],ink,1.6);
        line([['M',9,11],['L',14,28],['L',8,31],['M',14,28],['L',19,31],
          ['M',28,8],['L',31,26],['L',26,31],['M',31,26],['L',37,30]],'#789464',3.2);
        line([['M',-29,16],['Q',-17,7,-14,20]],'#6f8c60',1.6);
        break;
      }
      case 'bee': {
        shape([['M',-7,-9],['C',-28,-38,-38,-28,-26,-15],['Q',-19,-3,-7,-9],['Z']], '#dddcca');
        shape([['M',1,-12],['C',-2,-35,20,-36,16,-15],['Q',12,-7,1,-12],['Z']], '#e4e2cd');
        shape([['M',-34,7],['L',-44,12],['L',-33,17],['Z']], '#6b5b40');
        ellipse(-14,9,23,16,'#ddbc58',ink,-.25);
        ctx.save(); ctx.beginPath(); ctx.ellipse(-14,9,22,15,-.25,0,Math.PI*2); ctx.clip();
        line([['M',-26,-8],['L',-22,28],['M',-10,-10],['L',-5,28]],'#6c6045',7); ctx.restore();
        ellipse(10,-5,11,13,'#ac944e');
        ellipse(25,-13,12,12,'#dfbd63');
        line([['M',20,-24],['Q',17,-32,13,-34],['M',28,-24],['Q',35,-32,37,-31]],ink,1.8);
        ellipse(13,-34,2,2,ink,false); ellipse(37,-31,2,2,ink,false);
        eye(31,-16,1.8); line([['M',28,-8],['Q',32,-6,35,-9]],ink,1.3);
        line([['M',1,7],['L',6,22],['L',10,19],['M',12,5],['L',18,18],['L',21,15]],ink,1.7);
        break;
      }
      case 'turtle': {
        shape([['M',-34,14],['L',-48,11],['L',-38,22],['Z']], '#89956a');
        ellipse(-23,26,9,5,'#a7b583'); ellipse(9,26,8,5,'#a7b583');
        shape([['M',19,2],['Q',31,-6,39,-2],['Q',52,6,42,15],
          ['L',24,18],['Z']], '#b7c28d');
        shape([['M',-38,17],['C',-49,-13,-24,-34,1,-28],['C',25,-24,30,-7,25,17],
          ['Q',-6,28,-38,17],['Z']], '#85956c');
        shape([['M',-37,17],['Q',-5,25,24,15],['L',23,21],['Q',-6,31,-36,23],['Z']], '#c2c49b');
        line([['M',-24,-7],['L',-17,-20],['L',-1,-22],['L',11,-9],['L',4,7],['L',-14,9],['L',-24,-7],
          ['M',-17,-20],['L',-25,-27],['M',11,-9],['L',23,-11],['M',4,7],['L',14,20],
          ['M',-14,9],['L',-22,22],['M',-24,-7],['L',-41,-8]],'#bdc399',2);
        eye(42,3,1.6); line([['M',39,10],['Q',43,12,46,9]],ink,1.2);
        break;
      }
      case 'tiger': {
        line([['M',-31,-2],['C',-53,0,-45,-24,-52,-23]],ink,7.4);
        line([['M',-31,-2],['C',-53,0,-45,-24,-52,-23]],'#c18b4a',4.6);
        shape([['M',-29,11],['C',-44,-12,-17,-27,12,-19],['Q',26,-15,27,2],
          ['L',27,17],['Q',2,23,-28,19],['Z']], '#d4a05a');
        shape([['M',-24,10],['L',-26,29],['L',-13,30],['L',-11,12],['Z']], '#d4a05a');
        shape([['M',14,7],['L',14,30],['L',27,30],['L',28,7],['Z']], '#d4a05a');
        shape([['M',-27,25],['L',-14,25],['L',-13,30],['L',-26,30],['Z']], '#eee0bd',false);
        shape([['M',14,25],['L',27,25],['L',27,30],['L',14,30],['Z']], '#eee0bd',false);
        ellipse(22,-35,5,6,'#d4a05a'); ellipse(39,-35,5,6,'#d4a05a');
        shape([['M',16,-24],['C',14,-39,39,-42,46,-26],['Q',55,-16,45,-8],
          ['Q',27,1,17,-10],['Z']], '#dbab68');
        ellipse(42,-14,11,7,'#f0dfbd',false); eye(35,-25,1.8); nose(49,-17,2.7);
        line([['M',-25,-11],['L',-18,0],['M',-12,-18],['L',-7,-3],['M',1,-18],['L',6,-5],
          ['M',22,-28],['L',28,-24],['M',25,-15],['L',30,-14],['M',36,-35],['L',35,-30]],'#716049',3.2);
        break;
      }
      case 'phoenix': {
        shape([['M',-11,9],['C',-32,-6,-44,-8,-54,0],['Q',-34,5,-25,15],
          ['C',-42,24,-43,37,-53,36],['Q',-24,38,-10,24],['Q',-19,31,-31,33],
          ['Q',-8,36,3,20],['Z']], '#ca8c59');
        shape([['M',-14,18],['C',-25,-4,3,-6,11,-25],['C',13,-41,24,-46,34,-35],
          ['Q',42,-27,33,-15],['C',32,4,31,18,11,24],['Q',-3,28,-14,18],['Z']], '#bc7756');
        shape([['M',13,-21],['C',9,-3,2,0,1,13],['Q',9,24,24,17],
          ['Q',35,5,29,-11],['Z']], '#e5b66d',false);
        shape([['M',-13,1],['C',-32,-14,-45,-16,-43,-3],['C',-37,11,-26,22,-4,17],
          ['Q',13,13,15,0],['Q',0,6,-13,1],['Z']], '#d39859');
        line([['M',-32,-1],['Q',-17,12,-5,8],['M',-24,10],['Q',-9,19,3,12]],'#e9c27a',2);
        shape([['M',12,-32],['Q',8,-52,13,-57],['Q',20,-49,22,-37],
          ['Q',26,-55,31,-53],['L',32,-35],['Z']], '#dca666');
        shape([['M',34,-29],['L',49,-23],['L',34,-20],['Z']], '#dbb16a');
        eye(29,-29,1.6);
        line([['M',7,24],['L',8,31],['L',2,32],['M',8,31],['L',13,33],
          ['M',22,22],['L',24,31],['L',29,32]],'#a8824d',2.5);
        break;
      }
      default:
        // 未知类型只作防御性回退；配置中的22个物种均有独立分支。
        this.drawAnimalArt(ctx, 'bear');
    }
  },

  /* 拒马完全静态：烘成精灵，每帧只 blit 一次（原来要 70 条绘制指令）。 */
  barricadeSprite: function (lv, formId, form) {
    var size = CONFIG.CELL_HW - 6;
    var k = Math.max(1, Math.min(3, (this.dpr || 1) * (this.scale || 1)));
    var key = 'bc|' + lv + '|' + (formId || '-') + '|' + (form ? form.color : '-') + '|' + k;
    var hit = this._spriteCache[key];
    if (hit) return hit;
    var o = size + 16;
    var S = o * 2;
    var c = document.createElement('canvas');
    c.width = c.height = Math.max(1, Math.round(S * k));
    var sc = c.getContext('2d');
    sc.scale(k, k);
    sc.translate(o, o);
    this.drawBarricadeBody(sc, size, lv, formId, form);
    var rec = { img: c, o: o, size: S };
    this._spriteCache[key] = rec;
    return rec;
  },

  drawBarricadeBody: function (ctx, size, lv, formId, form) {
    var planks = 3 + lv;
    var wallMetal = formId === 'ironwall';
    this.bevelRect(ctx, -size + 2, -size + 4, size * 2 - 4, size * 2 - 8, 5,
      wallMetal ? '#59636d' : '#4c331d', '#17130f');
    for (var p = 0; p < planks; p++) {
      var py = -size + 6 + p * (size * 2 - 8) / planks;
      var ph = (size * 2 - 8) / planks - 3;
      var plankTop = wallMetal ? '#aeb7c0' : '#b1844b';
      var plankBottom = wallMetal ? '#59636d' : '#765126';
      this.roundRectPath(ctx, -size + 5, py, size * 2 - 10, ph, 2);
      ctx.fillStyle = this.unitGradient(ctx, 0, py, 0, ph, [
        [0, plankTop], [0.2, wallMetal ? '#929da7' : '#9a703d'],
        [0.76, plankBottom], [1, wallMetal ? '#434c55' : '#563817'],
      ]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(9,11,13,.8)'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-size + 8, py + 1.5); ctx.lineTo(size - 8, py + 1.5); ctx.stroke();
      if (wallMetal) {
        ctx.strokeStyle = 'rgba(42,49,55,.65)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-size * 0.45, py + ph * 0.65);
        ctx.lineTo(-size * 0.12, py + ph * 0.35);
        ctx.lineTo(size * 0.3, py + ph * 0.58);
        ctx.stroke();
        this.unitBolt(ctx, -size + 10, py + ph * 0.5, 2.1, '#d1d8de', '#343b42');
        this.unitBolt(ctx, size - 10, py + ph * 0.5, 2.1, '#d1d8de', '#343b42');
      } else {
        ctx.strokeStyle = 'rgba(74,46,22,.55)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-size + 10, py + ph * 0.55);
        ctx.bezierCurveTo(-size * 0.3, py + ph * 0.2, size * 0.2, py + ph * 0.8, size - 10, py + ph * 0.42);
        ctx.stroke();
        this.unitBolt(ctx, -size + 10, py + ph * 0.5, 2, '#a7a29a', '#2b241c');
        this.unitBolt(ctx, size - 10, py + ph * 0.5, 2, '#a7a29a', '#2b241c');
      }
    }
    this.bevelRect(ctx, -size + 1, -size + 2, 7, size * 2 - 4, 2, '#59616a', '#242a30');
    this.bevelRect(ctx, size - 8, -size + 2, 7, size * 2 - 4, 2, '#59616a', '#242a30');
    if (formId === 'thornwall') {
      var thornGrad = this.unitGradient(ctx, -size - 9, 0, 9, 0, [
        [0, '#4d241d'], [0.55, form.color], [1, '#f09a72'],
      ], false);
      for (var th = -size + 7; th <= size - 7; th += 15) {
        for (var sideTh = 0; sideTh < 2; sideTh++) {
          var sx = sideTh ? size - 3 : -size + 3;
          var outX = sideTh ? size + 10 : -size - 10;
          ctx.beginPath();
          ctx.moveTo(sx, th - 4.5); ctx.lineTo(outX, th); ctx.lineTo(sx, th + 4.5);
          ctx.closePath();
          ctx.fillStyle = thornGrad; ctx.fill();
          ctx.strokeStyle = '#2a1512'; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.strokeStyle = 'rgba(255,205,176,.55)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(sx, th - 2.5); ctx.lineTo(outX - (sideTh ? 2 : -2), th); ctx.stroke();
        }
      }
      ctx.fillStyle = '#6d3025';
      ctx.fillRect(-size - 4, -size + 4, 4, size * 2 - 8);
      ctx.fillRect(size, -size + 4, 4, size * 2 - 8);
    } else if (formId === 'gatewall') {
      this.bevelRect(ctx, -8, -size + 4, 16, size * 2 - 8, 3, '#71808a', '#303940', form.color);
      this.bevelRect(ctx, -size * 0.7, -5, size * 1.4, 9, 3, '#aab5bc', '#4c565d');
      this.unitBolt(ctx, -size * 0.54, -0.5, 2.8, '#d7dde1', '#30363b');
      this.unitBolt(ctx, size * 0.54, -0.5, 2.8, '#d7dde1', '#30363b');
      ctx.strokeStyle = form.color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 6.5, 0.4, 5.9);
      ctx.stroke();
      ctx.fillStyle = '#1e252a';
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, 6.283); ctx.fill();
    }
  },

  aimTarget: function (u, scene) {
    var b = scene.battle;
    if (!b) return null;
    if (b.nearestZombieInRadius) return b.nearestZombieInRadius(u);
    var best = null, bestD2 = u.radius * u.radius;
    for (var lane = 0; lane < CONFIG.LANES.length; lane++) {
      var list = b.zBuckets[u.side][lane];
      for (var i = 0; i < list.length; i++) {
        var z = list[i];
        var dx = z.x - u.x, dy = z.y - u.y, d2 = dx * dx + dy * dy;
        if (!z.dead && d2 <= bestD2) { bestD2 = d2; best = z; }
      }
    }
    return best;
  },

  /* ------------------- 丧尸 ------------------- */
  drawZombies: function (scene, t) {
    var b = scene.battle;
    if (!b) return;
    var ctx = this.ctx;
    for (var i = 0; i < b.zombies.length; i++) {
      var z = b.zombies[i];
      if (z.dead) continue;
      this.drawZombie(z, t);
    }
  },

  drawZombie: function (z, t) {
    if (z.type === 'bug') { this.drawBug(z, t); return; }
    var ctx = this.ctx, dir = z.side === 'p' ? -1 : 1, R = z.r * 1.32;
    var walk = Math.sin(z.phase), walk2 = Math.sin(z.phase + 1.9);
    var wind = z.attackT > 0 && z.attackTotal > 0
      ? Math.sin(clamp(1 - z.attackT / z.attackTotal, 0, 1) * Math.PI * .5) : 0;
    var strike = z.attackHitT > 0 && z.attackHitTotal > 0
      ? Math.sin(clamp(1 - z.attackHitT / z.attackHitTotal, 0, 1) * Math.PI) : 0;
    var skin = z.type === 'screamer' ? '#c8b47d' : z.type === 'brute' ? '#9aaf74' : '#acc985';
    var coat = z.type === 'runner' ? '#c89d64' : z.type === 'screamer' ? '#a58cb8'
      : z.type === 'tank' ? '#7995a2' : '#5c9a9c';
    var outline = '#304958';
    ctx.save();
    ctx.translate(z.x + dir * strike * R * .28, z.y - Math.abs(walk) * 1.6);
    ctx.scale(z.scale * CONFIG.ZOMBIE_DRAW_SCALE * dir, z.scale * CONFIG.ZOMBIE_DRAW_SCALE);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.fillStyle = 'rgba(17,44,52,.25)';
    ctx.beginPath(); ctx.ellipse(0, R * .98, R * .9, R * .22, 0, 0, 6.283); ctx.fill();
    // 圆鞋与短腿，保留行走和攻击的朝向。
    ctx.strokeStyle = '#56727a'; ctx.lineWidth = R * .22;
    ctx.beginPath(); ctx.moveTo(-R * .19, R * .42); ctx.lineTo(-R * .18 + walk * R * .22, R * .87); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(R * .19, R * .42); ctx.lineTo(R * .18 + walk2 * R * .22, R * .87); ctx.stroke();
    ctx.fillStyle = '#385664';
    ctx.beginPath(); ctx.ellipse(-R * .13 + walk * R * .22, R * .91, R * .24, R * .13, 0, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.ellipse(R * .24 + walk2 * R * .22, R * .91, R * .24, R * .13, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = coat;
    ctx.beginPath(); ctx.ellipse(0, R * .04, R * .55, R * .66, -.12 + wind * .09 - strike * .1, 0, 6.283); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = R * .065; ctx.stroke();
    ctx.fillStyle = this.lighten(coat, .2);
    ctx.beginPath(); ctx.ellipse(-R * .1, -R * .1, R * .3, R * .32, 0, 0, 6.283); ctx.fill();
    // 小纽扣和衣领代替破布伤口。
    ctx.fillStyle = '#f1d58b';
    ctx.beginPath(); ctx.arc(R * .04, R * .06, R * .055, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(R * .03, R * .29, R * .045, 0, 6.283); ctx.fill();
    // 圆手起手后拉、命中前伸，仍能清楚读出攻击节奏。
    ctx.strokeStyle = skin; ctx.lineWidth = R * .18;
    ctx.beginPath(); ctx.moveTo(-R * .18, -R * .31);
    ctx.quadraticCurveTo(R * .43 - wind * R * .4, R * .22 - wind * R * .4,
      R * (.72 - wind * .35 + strike * .48), R * (.08 - wind * .3)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(R * .3, -R * .23);
    ctx.quadraticCurveTo(R * .66 - wind * R * .3, R * .2,
      R * (.92 - wind * .4 + strike * .48), R * (.22 - wind * .18)); ctx.stroke();
    var hx = R * (.2 - wind * .07 + strike * .09), hy = -R * .76;
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(hx, hy, R * .55, R * .48, .08, 0, 6.283); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = R * .065; ctx.stroke();
    // 两只无红光的圆眼，亮点和脸颊让小怪更亲切。
    for (var e = 0; e < 2; e++) {
      var ex = hx + (e ? .24 : -.15) * R;
      ctx.fillStyle = '#faf1d4'; ctx.beginPath(); ctx.ellipse(ex, hy - R * .06, R * .12, R * .14, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#2a4350'; ctx.beginPath(); ctx.arc(ex + R * .025, hy - R * .03, R * .065, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + R * .015, hy - R * .055, R * .023, 0, 6.283); ctx.fill();
    }
    ctx.fillStyle = '#d6b18b'; ctx.beginPath(); ctx.ellipse(hx - R * .3, hy + R * .13, R * .095, R * .055, 0, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#3b5660'; ctx.lineWidth = R * .055;
    ctx.beginPath(); ctx.arc(hx + R * .12, hy + R * .16, R * (.11 + strike * .055), .12, 2.8); ctx.stroke();
    ctx.fillStyle = '#fff3cf'; this.roundRectPath(ctx, hx + R * .05, hy + R * .22, R * .08, R * .10, R * .02); ctx.fill();
    if (z.type === 'runner') {
      ctx.strokeStyle = '#edba60'; ctx.lineWidth = R * .16;
      ctx.beginPath(); ctx.moveTo(-R * .25, -R * .4); ctx.lineTo(R * .4, -R * .4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-R * .18, -R * .39); ctx.lineTo(-R * .63, -R * .19 + walk * R * .07); ctx.stroke();
    } else if (z.type === 'tank') {
      ctx.fillStyle = '#bac8cd'; this.roundRectPath(ctx, hx - R * .57, hy - R * .62, R * 1.14, R * .4, R * .1); ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = R * .055; ctx.stroke();
      ctx.fillStyle = '#dce4dc'; this.roundRectPath(ctx, hx - R * .7, hy - R * .29, R * 1.4, R * .1, R * .03); ctx.fill();
      ctx.strokeStyle = '#9fb4be'; ctx.lineWidth = R * .09;
      ctx.beginPath(); ctx.arc(-R * .06, R * .05, R * .38, -.9, 1); ctx.stroke();
    } else if (z.type === 'brute') {
      ctx.strokeStyle = '#71815c'; ctx.lineWidth = R * .07;
      ctx.beginPath(); ctx.moveTo(hx - R * .27, hy - R * .27); ctx.lineTo(hx - R * .06, hy - R * .3);
      ctx.moveTo(hx + R * .14, hy - R * .3); ctx.lineTo(hx + R * .35, hy - R * .25); ctx.stroke();
    } else if (z.type === 'screamer') {
      ctx.strokeStyle = '#ead495'; ctx.lineWidth = R * .05;
      ctx.beginPath(); ctx.arc(hx + R * .2, hy + R * .12, R * .73, -.65, .65); ctx.stroke();
      ctx.beginPath(); ctx.arc(hx + R * .2, hy + R * .12, R * .91, -.52, .52); ctx.stroke();
    } else {
      ctx.strokeStyle = '#779566'; ctx.lineWidth = R * .09;
      ctx.beginPath(); ctx.moveTo(hx - R * .12, hy - R * .43); ctx.lineTo(hx - R * .18, hy - R * .58);
      ctx.moveTo(hx + R * .04, hy - R * .44); ctx.lineTo(hx + R * .08, hy - R * .56); ctx.stroke();
    }
    if (z.hp < z.maxHp * .999) {
      ctx.fillStyle = '#284958'; this.roundRectPath(ctx, -R * .75, -R * 1.53, R * 1.5, 5, 2); ctx.fill();
      ctx.fillStyle = '#eab47b'; ctx.fillRect(-R * .75 + 1, -R * 1.53 + 1, (R * 1.5 - 2) * (z.hp / z.maxHp), 3);
    }
    if (z.slowT > 0) {
      ctx.strokeStyle = 'rgba(169,228,251,.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, R * .98, 0, 6.283); ctx.stroke();
    }
    if (z.flash > .01) {
      ctx.globalAlpha = Math.min(.35, z.flash * .45); ctx.fillStyle = '#fff4d7';
      ctx.beginPath(); ctx.ellipse(hx, hy, R * .55, R * .48, .08, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  },

  drawBug: function (z, t) {
    var ctx = this.ctx, R = z.r * 1.32, dir = z.side === 'p' ? -1 : 1;
    var bite = z.attackHitT > 0 ? Math.sin(z.attackHitT / z.attackHitTotal * Math.PI) : 0;
    ctx.save();
    ctx.translate(z.x + dir * bite * R * 0.3, z.y);
    ctx.scale(z.scale * CONFIG.ZOMBIE_DRAW_SCALE, z.scale * CONFIG.ZOMBIE_DRAW_SCALE);
    ctx.fillStyle = 'rgba(17,44,52,0.25)';
    ctx.beginPath(); ctx.ellipse(0, R * 0.6, R * 1.2, R * 0.35, 0, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#527581'; ctx.lineWidth = R * 0.13; ctx.lineCap = 'round';
    for (var i = -1; i <= 1; i++) {
      for (var side = -1; side <= 1; side += 2) {
        var step = Math.sin(z.phase * 2 + i * 1.8 + side) * R * 0.22;
        ctx.beginPath(); ctx.moveTo(i * R * 0.45, side * R * 0.25);
        ctx.lineTo(i * R * 0.65 + step, side * R * 0.7);
        ctx.lineTo(i * R * 0.85 - step, side * R); ctx.stroke();
      }
    }
    ctx.fillStyle = z.flash > 0.01 ? '#fff0c2' : '#d3bd72';
    ctx.beginPath(); ctx.ellipse(-dir * R * 0.12, 0, R * 0.85, R * 0.52, 0, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#60796e'; ctx.lineWidth = R * 0.08;
    ctx.beginPath(); ctx.moveTo(-dir * R * 0.85, 0); ctx.lineTo(dir * R * 0.45, 0); ctx.stroke();
    ctx.fillStyle = '#94b48b';
    ctx.beginPath(); ctx.ellipse(dir * R * 0.65, 0, R * 0.35, R * 0.4, 0, 0, 6.283); ctx.fill();
    ctx.strokeStyle = '#c6aa68';
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath(); ctx.moveTo(dir * R * 0.8, s * R * 0.2);
      ctx.lineTo(dir * R * (1.2 + bite * 0.2), s * R * 0.4);
      ctx.lineTo(dir * R * 1.3, s * R * 0.18); ctx.stroke();
      ctx.fillStyle = '#f9eed2'; ctx.beginPath();
      ctx.arc(dir * R * 0.78, s * R * 0.22, R * 0.14, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#294653'; ctx.beginPath();
      ctx.arc(dir * R * 0.80, s * R * 0.22, R * 0.07, 0, 6.283); ctx.fill();
    }
    if (z.hp < z.maxHp) {
      ctx.fillStyle = '#28201b'; ctx.fillRect(-R, -R * 1.3, R * 2, 3);
      ctx.fillStyle = '#c04a2e'; ctx.fillRect(-R, -R * 1.3, R * 2 * z.hp / z.maxHp, 3);
    }
    if (z.slowT > 0 || z.stunT > 0) {
      ctx.strokeStyle = 'rgba(150,220,255,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, 0, R * 1.2, R, 0, 0, 6.283); ctx.stroke();
    }
    ctx.restore();
  },

  /* 缓存的渐变：CanvasGradient 的坐标在「填充时」的用户空间解释，
     所以同一个对象在不同 translate/scale 下复用是安全的，省掉每帧重建着色器。 */
  cacheGrad: function (key, build) {
    var g = this._gradCache[key];
    if (g) return g;
    g = build();
    if (this._gradN < 900) { this._gradCache[key] = g; this._gradN++; }
    return g;
  },

  lighten: function (hex, amt) {
    var key = hex + (amt > 0 ? '+' : '') + Math.round(amt * 100);
    var hit = this._lightenCache[key];
    if (hit !== undefined) return hit;
    var out = this.lightenRaw(hex, amt);
    this._lightenCache[key] = out;
    return out;
  },
  lightenRaw: function (hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = clamp(((n >> 16) & 255) + 255 * amt, 0, 255) | 0;
    var g = clamp(((n >> 8) & 255) + 255 * amt, 0, 255) | 0;
    var b = clamp((n & 255) + 255 * amt, 0, 255) | 0;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  },

  drawShots: function (scene) {
    var b = scene.battle;
    if (!b) return;
    var ctx = this.ctx;
    for (var i = 0; i < b.shots.length; i++) {
      var s = b.shots[i];
      var g = this.glow(s.color, 64);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(g, s.x - 16, s.y - 16, 32, 32);
      ctx.fillStyle = '#fff8e0';
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.6, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  /* ------------------- 粒子 ------------------- */
  updateParts: function (dt) {
    var P = this.parts;
    for (var i = P.length - 1; i >= 0; i--) {
      var p = P[i];
      p.life -= dt;
      if (p.life <= 0) { P.splice(i, 1); continue; }
      if (p.k === 'ring') { p.r += (p.tr - p.r) * Math.min(1, dt * 12); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.k === 'blood') { p.vy += 220 * dt; p.vx *= 0.97; }
      else if (p.k === 'spark') { p.vy += 90 * dt; p.vx *= 0.94; p.vy *= 0.94; }
    }
  },
  drawParts: function () {
    var ctx = this.ctx, P = this.parts;
    for (var i = 0; i < P.length; i++) {
      var p = P[i];
      var a = p.life / p.max;
      if (p.k === 'ring') {
        ctx.strokeStyle = 'rgba(' + (p.c || '255,140,60') + ',' + (a * 0.8) + ')';
        ctx.lineWidth = 3 * a + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.stroke();
      } else if (p.k === 'stain') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(0.28, a * 0.24);
        ctx.fillStyle = '#4b0808';
        ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.8, p.r * 0.55, 0, 0, 6.283); ctx.fill();
        ctx.restore();
      } else if (p.k === 'blood') {
        ctx.fillStyle = 'rgba(96,22,18,' + (a * 0.85) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.6), 0, 6.283); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(' + (p.c || '255,220,150') + ',' + (a * 0.9) + ')';
        ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
      }
    }
  },
};
