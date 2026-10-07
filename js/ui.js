'use strict';

// 金币用CSS形状，避免iOS系统字体缺少◍而显示问号框。
function coinTextHtml(text) {
  return String(text).replace(/◍/g, '<span class="coinIcon" aria-hidden="true"></span>');
}

/* ---------------------------------------------------------------
 * DOM UI + 输入。横屏，移动端优先：
 *  - 拖拽动物卡片到空地放置
 *  - 也可以「先点卡片，再点空地」
 *  - 战斗期点技能按钮后点战场施放
 * ------------------------------------------------------------- */

/* 新手引导：手指图形（指尖落在图形底边正中）+ 每步提示语 */
var TUT_HAND_SVG =
  '<svg class="tutHand" viewBox="0 0 120 130" aria-hidden="true">' +
  '<defs><linearGradient id="tutHandGrad" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#faca79"/><stop offset="1" stop-color="#e2a04a"/>' +
  '</linearGradient></defs>' +
  '<g fill="url(#tutHandGrad)">' +
  '<rect x="44" y="-14" width="32" height="54" rx="16"/>' +
  '<rect x="54" y="22" width="62" height="52" rx="20"/>' +
  '<rect x="26" y="44" width="34" height="40" rx="17" transform="rotate(-30 43 64)"/>' +
  '<rect x="45.5" y="30" width="29" height="100" rx="14.5"/>' +
  '</g>' +
  '<g fill="none" stroke="rgba(58,32,6,.34)" stroke-width="2.6" stroke-linecap="round">' +
  '<path d="M78 38v42"/><path d="M97 42v34"/><path d="M111 48v24"/>' +
  '</g></svg>';

var TUT_STEP_TEXT = {
  1: function () { return L('experience.tutorialBear'); },
  2: function () { return L('experience.tutorialPlace'); },
  3: function () { return L('experience.tutorialSpike'); },
  4: function () { return L('experience.tutorialPlace'); },
  5: function () { return L('experience.tutorialTurret'); },
  6: function () { return L('experience.tutorialPlace'); },
  7: function () { return L('experience.tutorialStart'); },
};

/* 把动物伙伴渲染成缩略图，返回可直接塞进 innerHTML 的 <img> 标签。
   用 data URL 而不是 <canvas> 元素：卡片会被反复重建（选人面板每点一次就重画），
   放 canvas 等于每次点击都重绘 12 张图；data URL 命中 Render.unitThumb 的缓存，
   同一尺寸只画一次。装饰性图片，所以 aria-hidden 让读屏跳过它、只读名称。 */
function unitThumbHtml(typeId, size) {
  try {
    /* 传 CSS 边长即可：Render.unitThumb 内部按 dpr*scale 出设备像素的图，
       并把动物本体缩放到画布内（见那里的 pad）。 */
    var rec = Render.unitThumb(typeId, size, 1);
    var url = rec.img.toDataURL('image/png');
    return '<img class="uArt" data-unit="' + typeId + '" data-art-size="' + size + '" src="' + url + '" width="' + size + '" height="' + size +
      '" alt="" aria-hidden="true" draggable="false">';
  } catch (e) {
    return '';
  }
}

function unitRoleText(typeId) {
  var roles = {
    barricade: 'block', spike: 'retaliate', turret: 'ranged', lamp: 'slow',
    flame: 'fire', tesla: 'chain', sniper: 'ranged', venom: 'area', frost: 'slow',
    quake: 'area', railgun: 'area', totem: 'heal', wolf: 'ranged', owl: 'ranged',
    boar: 'area', chameleon: 'area', elephant: 'block', frog: 'area', bee: 'chain',
    turtle: 'slow', tiger: 'ranged', phoenix: 'heal',
  };
  var labels = { block: '挡路', retaliate: '反伤', ranged: '远程', slow: '减速',
    fire: '喷火', chain: '连锁', heal: '治疗', area: '范围' };
  var role = roles[typeId] || 'ranged';
  return L('friendly.roles.' + role, null, labels[role]);
}

function menuArtHtml() {
  return '<img class="menuScene" src="./assets/ui-home-scene-v1.jpg" alt="" aria-hidden="true" draggable="false">';
}

function sceneHeroHtml(title, content) {
  return '<div class="sceneHero"><img class="sceneHeroBackdrop" src="./assets/ui-home-scene-v1.jpg" alt="" aria-hidden="true" draggable="false">' +
    '<div class="sceneCompanions" aria-hidden="true">' + unitThumbHtml('barricade', 128) +
    unitThumbHtml('frost', 128) + unitThumbHtml('flame', 128) + '</div>' +
    '<div class="sceneHeroCopy"><h2>' + title + '</h2>' + (content || '') + '</div></div>';
}

function relicArtHtml(id) {
  var drawings = {
    foundation: '<path d="M10 30 32 12l22 18M16 27v25h32V27" fill="#f8d38a"/><path d="M27 52V36h10v16" fill="#b8d9c8"/>',
    gears: '<path d="M28 10h8l2 9 8-4 6 6-4 8 9 2v8l-9 2 4 8-6 6-8-4-2 9h-8l-2-9-8 4-6-6 4-8-9-2v-8l9-2-4-8 6-6 8 4z" fill="#efbd67"/><circle cx="32" cy="35" r="10" fill="#fff8e7"/>',
    steel: '<path d="m32 10 21 8v17c0 11-10 17-21 23C21 52 11 46 11 35V18z" fill="#b8d9e7"/><path d="m22 32 7 7 14-16" fill="none"/>',
    powder: '<path d="m32 9 6 16 17 1-13 11 4 18-14-10-14 10 4-18L9 26l17-1z" fill="#f3bb67"/>',
    satchel: '<rect x="14" y="21" width="36" height="35" rx="10" fill="#c6dcbc"/><path d="M23 21v-5a9 9 0 0 1 18 0v5M14 32h36" fill="none"/><rect x="25" y="28" width="14" height="16" rx="4" fill="#f7d68c"/>',
    lore: '<path d="M10 15c9-3 16-2 22 3 6-5 13-6 22-3v36c-9-3-16-2-22 3-6-5-13-6-22-3z" fill="#c5dfe2"/><path d="M32 18v36M17 27h9m-9 9h9m12-9h9m-9 9h9" fill="none"/>',
    spares: '<rect x="10" y="20" width="44" height="34" rx="8" fill="#f0c7a1"/><path d="M22 20v-9h20v9" fill="none"/><path d="M32 28v18m-9-9h18" fill="none"/>',
    doublebow: '<circle cx="23" cy="32" r="13" fill="#edc18a"/><circle cx="44" cy="32" r="13" fill="#edc18a"/><path d="M19 22h8m13 0h8M19 41h8m13 0h8" fill="none"/>',
    coldlight: '<path d="M41 11a23 23 0 1 0 12 38A22 22 0 0 1 41 11" fill="#c3e1ec"/><path d="m46 23 2-6 2 6 6 2-6 2-2 6-2-6-6-2z" fill="#f5d589"/>',
    fuse: '<path d="m32 10 7 14 15 2-11 11 3 17-14-8-14 8 3-17-11-11 15-2z" fill="#f2cca0"/><circle cx="32" cy="33" r="8" fill="#eab269"/>',
    overload: '<path d="m36 8-22 29h16l-3 20 23-30H34z" fill="#f4d074"/>',
    ration: '<path d="M19 13h26v9l5 8v25H14V30l5-8z" fill="#bddbae"/><path d="M19 22h26" fill="none"/><circle cx="32" cy="39" r="10" fill="#f5d882"/>',
  };
  return '<svg class="relicArt" viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="#3a5264" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    (drawings[id] || drawings.satchel) + '</svg>';
}

var UI = {
  el: {},
  dragType: null, dragging: false, moved: false,
  tapToggleOff: false,
  pressX: 0, pressY: 0,
  dragEl: null,
  flareArmed: false,
  overlayMode: null,

  init: function () {
    /* 先把 index.html 里静态写着的中文替换掉（按钮、HUD 标签）。
       必须放在这里而不是 i18n.js::init 里：i18n.js 排在 config.js 之前加载，
       那一刻 TEXT 还不存在，替换会静默失败。这里 DOM 与 TEXT 都已就绪。 */
    I18N.applyStatic();
    var ids = ['stage', 'game', 'hud', 'pHpBar', 'pHpTxt', 'gHpBar', 'gHpTxt', 'gName', 'gTag',
      'timer', 'roundLbl', 'coins', 'cards', 'startBtn', 'buildBar', 'battleBar', 'flareBtn',
      'repairBtn', 'flareN', 'repairN', 'overlay', 'toast', 'unitPanel', 'lead', 'incomeLbl',
      'rankLbl', 'muteBtn', 'buildHint', 'veil', 'relicBar', 'pips', 'dangerVeil', 'whisper',
      'matchmaking', 'tutorialHand', 'tutorialSkip', 'coopHud', 'placementConfirm', 'pauseBtn', 'fieldStatus'];
    for (var i = 0; i < ids.length; i++) this.el[ids[i]] = document.getElementById(ids[i]);
    this.bind();
    this.buildCards();
    this.bindPointer();
    window.addEventListener('resize', function () { UI.fit(); });
    window.addEventListener('gamehostviewportchange', function () { UI.fit(); });
    window.addEventListener('orientationchange', function () { setTimeout(function () { UI.fit(); }, 220); });
    this.fit();
    this.el.game.setAttribute('aria-label', L('experience.battleFocus'));
    this.el.pauseBtn.setAttribute('aria-label', L('experience.pause'));
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && !Game.coopMode) { Game.checkpoint(); Game.pause(); }
    });
    window.addEventListener('pagehide', function () { if (!Game.coopMode) Game.checkpoint(); });
    /* 权益 / 商品 / 广告可用性都是异步从宿主回来的，回来后把当前浮层重画一遍 */
    Monetize.onChange = function () {
      if (UI.overlayMode === 'menu') UI.showMenu();
      else if (UI.overlayMode === 'paywall') UI.showPaywall(UI._paywallReason);
    };
  },

  /* ---------------- 尺寸 ---------------- */
  viewportInsets: function () {
    if (!this._safeProbe) {
      var probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;' +
        'padding-top:var(--device-safe-top,env(safe-area-inset-top,0px));' +
        'padding-right:var(--device-safe-right,env(safe-area-inset-right,0px));' +
        'padding-bottom:var(--device-safe-bottom,env(safe-area-inset-bottom,0px));' +
        'padding-left:var(--device-safe-left,env(safe-area-inset-left,0px));';
      document.body.appendChild(probe);
      this._safeProbe = probe;
    }
    var css = getComputedStyle(this._safeProbe);
    var host = window.__gameHostViewport && window.__gameHostViewport.safeArea;
    var result = {};
    ['top', 'right', 'bottom', 'left'].forEach(function (edge) {
      var raw = host ? host[edge] : parseFloat(css.getPropertyValue('padding-' + edge));
      var cap = /top|bottom/.test(edge) ? window.innerHeight / 3 : window.innerWidth / 3;
      result[edge] = typeof raw === 'number' && isFinite(raw) ? Math.max(0, Math.min(cap, raw)) : 0;
    });
    return result;
  },

  fit: function () {
    var vw = window.innerWidth, vh = window.innerHeight;
    var insets = this.viewportInsets();
    this.safeArea = insets;
    var usableW = Math.max(1, vw - insets.left - insets.right);
    var usableH = Math.max(1, vh - insets.top - insets.bottom);
    this.portrait = vh > vw;
    var logicalW = this.portrait ? usableH : usableW;
    var logicalH = this.portrait ? usableW : usableH;
    var s = Math.min(logicalW / CONFIG.W, logicalH / CONFIG.H);
    this.scale = s;
    this.offX = Math.round((logicalW - CONFIG.W * s) / 2);
    this.offY = Math.round((logicalH - CONFIG.H * s) / 2);
    var st = this.el.stage;
    st.style.width = logicalW + 'px';
    st.style.height = logicalH + 'px';
    st.style.left = (insets.left + (usableW - logicalW) / 2) + 'px';
    st.style.top = (insets.top + (usableH - logicalH) / 2) + 'px';
    st.style.transformOrigin = 'center center';
    st.style.transform = this.portrait ? 'rotate(90deg)' : 'none';
    st.setAttribute('data-orientation', this.portrait ? 'portrait' : 'landscape');
    /* 用旋转后的可用高度分档：手机型号和原始竖屏媒体查询都不能代表商店高度。 */
    st.setAttribute('data-shop-size', logicalH <= 340 ? 'short' : logicalH <= 430 ? 'compact' : 'normal');
    st.setAttribute('data-menu-size', logicalH <= 430 ? 'compact' : 'normal');
    st.style.setProperty('--stage-w', logicalW + 'px');
    st.style.setProperty('--stage-h', logicalH + 'px');
    // 舞台已收在安全区内，内部浮层不再重复扣除物理屏幕底边。
    st.style.setProperty('--safe-area-inset-bottom', '0px');
    st.style.setProperty('--loadout-cols', '3');
    st.style.setProperty('--u', s + 'px');
    document.documentElement.style.setProperty('--u', s + 'px');
    var compactFont = Math.min(logicalW, logicalH) <= 500;
    document.documentElement.style.setProperty(
      '--font-extra',
      (compactFont ? Math.max(0, 14 - s * 11) : 0) + 'px'
    );
    var stageStyle = getComputedStyle(st);
    Render.resize(logicalW, logicalH, s, this.offX, this.offY, {
      left: parseFloat(stageStyle.getPropertyValue('--house-left')) || 0,
      right: parseFloat(stageStyle.getPropertyValue('--house-right')) || 0,
    });
    // 背景用全视口，交互舞台仍在安全区。90°旋转时将物理安全区转为逻辑方向。
    var fullW = this.portrait ? vh : vw, fullH = this.portrait ? vw : vh;
    var edgeX = this.portrait ? insets.top : insets.left;
    var edgeY = this.portrait ? insets.right : insets.top;
    st.style.setProperty('--scene-w', fullW + 'px');
    st.style.setProperty('--scene-h', fullH + 'px');
    st.style.setProperty('--scene-left', -edgeX + 'px');
    st.style.setProperty('--scene-top', -edgeY + 'px');
    Render.resizeEdgeScene(fullW, fullH, edgeX, edgeY, this.portrait, vw, vh);
    if (Game.pendingPlacement) this.positionPlacementConfirm(Game.pendingPlacement);
  },

  /* ---------------- 卡片 ---------------- */
  fieldPoint: function (x, y) {
    var viewX = Render.worldToViewX ? Render.worldToViewX(x) : x;
    var viewY = Render.worldToViewY ? Render.worldToViewY(y) : y;
    return { x: this.offX + viewX * this.scale, y: this.offY + viewY * this.scale };
  },

  fieldBottom: function () {
    return this.fieldPoint(0, CONFIG.GRID_BOTTOM || 640).y;
  },

  refreshAnimalArt: function () {
    var images = document.querySelectorAll('img.uArt[data-unit]');
    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      var size = Number(img.getAttribute('data-art-size'));
      if (!size || !UNITS[img.getAttribute('data-unit')]) continue;
      var rec = Render.unitThumb(img.getAttribute('data-unit'), size, 1);
      img.src = rec.img.toDataURL('image/png');
    }
  },

  buildCards: function (types) {
    var wrap = this.el.cards;
    wrap.innerHTML = '';
    var ids = types || (typeof Game !== 'undefined' && Game.loadout
      ? Game.loadout
      : UNIT_ORDER.slice(0, 6));
    ids.forEach(function (id) {
      var d = UNITS[id];
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'card';
      b.dataset.type = id;
      b.innerHTML =
        '<div class="art">' + unitThumbHtml(id, 96) + '</div>' +
        '<div class="cn">' + d.name + '</div>' +
        '<div class="cc">' + coinTextHtml('◍ ' + d.cost) + '</div>' +
        '<div class="cr"></div>';
      wrap.appendChild(b);
    });
  },

  bind: function () {
    var self = this;
    this.el.cards.addEventListener('pointerdown', function (e) {
      var card = e.target.closest ? e.target.closest('.card') : null;
      if (!card) return;
      if (Game.state !== 'build' || Game.paused || Game.coopLocked) return;
      Sfx.resume(); Sfx.ui();
      var type = card.dataset.type;
      if (Game.tutorialActive && Game.tutorialStep < 7 && type !== Game.tutorialType()) {
        self.toast(L('experience.tutorialPick')); return;
      }
      // 点同一张卡再点一次 = 取消选中（松手时判定，不影响拖动）
      self.tapToggleOff = Game.armedType === type;
      self._armedBeforePress = Game.armedType;
      self.dragType = type; self.dragging = true; self.moved = false;
      self.pressX = e.clientX; self.pressY = e.clientY;
      Game.armedType = type;
      Game.pendingPlacement = null;
      Game.selectedCell = null;
      Game.tutorialPickCard(type);
      self.showDragChip(type, e.clientX, e.clientY);
      self.syncAll();
      e.preventDefault();
    });
    this.el.cards.addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card || e.detail !== 0 || Game.state !== 'build' || Game.paused || Game.coopLocked) return;
      var type = card.dataset.type;
      if (Game.tutorialActive && Game.tutorialStep < 7 && type !== Game.tutorialType()) { self.toast(L('experience.tutorialPick')); return; }
      Game.armedType = Game.armedType === type ? null : type;
      Game.selectedCell = null; Game.tutorialPickCard(type); self.syncAll();
      self.focusCell = Game.tutorialTarget ? Object.assign({}, Game.tutorialTarget)
        : { col: unlockedCols(Game.roundIndex)[0], lane: unlockedLanes(Game.roundIndex)[0] };
      self.el.game.focus(); self.announceCell();
    });
    this.el.pauseBtn.addEventListener('click', function () { Game.pause(); });
    this.el.game.addEventListener('keydown', function (e) {
      if (UI.overlayMode || Game.paused) return;
      if (e.key === 'Escape') { Game.armedType = null; Game.selectedCell = null; self.flareArmed = false; self.syncAll(); e.preventDefault(); return; }
      if (!/^Arrow|^Enter$|^ $/.test(e.key)) return;
      e.preventDefault();
      var c = self.focusCell || { col: 8, lane: 1 };
      if (e.key === 'ArrowLeft') c.col = Math.max(0, c.col - 1);
      if (e.key === 'ArrowRight') c.col = Math.min(8, c.col + 1);
      if (e.key === 'ArrowUp') c.lane = Math.max(0, c.lane - 1);
      if (e.key === 'ArrowDown') c.lane = Math.min(8, c.lane + 1);
      self.focusCell = c; Game.hoverCell = c;
      var cols = Game.coopMode && Game.coopSide === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS;
      if (e.key === 'Enter' || e.key === ' ') self.onFieldPress(cols[c.col], CONFIG.LANES[c.lane]);
      self.announceCell(); self.syncAll();
    });
    document.addEventListener('keydown', function (e) {
      if ((self.overlayMode === 'pause' || self.overlayMode === 'settings') && e.key === 'Tab') {
        var buttons = self.el.overlay.querySelectorAll('button:not([disabled]), input:not([disabled])');
        var first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && (document.activeElement === first || !self.el.overlay.contains(document.activeElement))) {
          last.focus(); e.preventDefault();
        } else if (!e.shiftKey && (document.activeElement === last || !self.el.overlay.contains(document.activeElement))) {
          first.focus(); e.preventDefault();
        }
        return;
      }
      if (self.overlayMode === 'settings') {
        if (e.key === 'Escape') { document.getElementById('settingsBackBtn').click(); e.preventDefault(); }
        return;
      }
      if (e.key.toLowerCase() !== 'p' || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (Game.paused) Game.resume(); else Game.pause();
    });
    this.el.startBtn.addEventListener('click', function () {
      Sfx.resume(); Sfx.ui();
      Game.startBattle();
    });
    this.el.placementConfirm.addEventListener('click', function (e) {
      var button = e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!button) return;
      if (button.dataset.action === 'confirm') self.confirmPlacement();
      else if (button.dataset.action === 'cancel') self.cancelPlacement();
    });
    this.el.flareBtn.addEventListener('click', function () {
      if (Game.state !== 'battle' || Game.paused || Game.flare <= 0) { Sfx.error(); return; }
      self.flareArmed = !self.flareArmed;
      Sfx.ui(); self.syncAll();
    });
    this.el.repairBtn.addEventListener('click', function () {
      if (Game.state !== 'battle') return;
      if (Game.useRepair()) self.syncAll();
    });
    var mb = this.el.muteBtn;
    if (mb) mb.addEventListener('click', function () {
      Game.save.muted = !Game.save.muted;
      Sfx.setEnabled(!Game.save.muted);
      Game.persist();
      self.syncAll();
    });
    if (this.el.tutorialSkip) this.el.tutorialSkip.addEventListener('click', function (event) {
      event.stopPropagation();
      Sfx.ui();
      Game.finishTutorial(L('tutorial.skipped', null, '已跳过教学 · 现在可以自由操作'));
    });
    this.el.unitPanel.addEventListener('click', function (e) {
      if (!e.target || !e.target.id || Game.state !== 'build' || Game.coopLocked) return;
      var c = Game.selectedCell;
      if (!c) return;
      if (e.target.id === 'upBtn') {
        Game.upgradeAt(c.col, c.lane);
        self.syncAll();
      } else if (e.target.id === 'sellBtn') {
        Game.sellAt(c.col, c.lane);
        Game.selectedCell = null;
        self.syncAll();
      }
    });
    this.el.unitPanel.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
    });
  },

  bindPointer: function () {
    var self = this, st = this.el.stage;

    function toVirtual(clientX, clientY) {
      var left = parseFloat(st.style.left) || 0;
      var top = parseFloat(st.style.top) || 0;
      var width = parseFloat(st.style.width) || CONFIG.W;
      var height = parseFloat(st.style.height) || CONFIG.H;
      var localX = clientX - left;
      var localY = clientY - top;
      if (UI.portrait) {
        var centerX = left + width / 2;
        var centerY = top + height / 2;
        var dx = clientX - centerX;
        var dy = clientY - centerY;
        localX = width / 2 + dy;
        localY = height / 2 - dx;
      }
      return {
        x: Render.viewToWorldX ? Render.viewToWorldX((localX - UI.offX) / UI.scale)
          : (localX - UI.offX) / UI.scale,
        y: Render.viewToWorldY ? Render.viewToWorldY((localY - UI.offY) / UI.scale)
          : (localY - UI.offY) / UI.scale,
      };
    }
    this.toVirtual = toVirtual;

    st.addEventListener('pointerdown', function (e) {
      Sfx.resume();
      if (e.target.closest && e.target.closest(
        '#bottom, #buildBar, #unitPanel, #overlay, #matchmaking, #placementConfirm, #tutorialHand, #tutorialSkip, ' +
        '#toast, #hud, #relicBar, #pips, #lead'
      )) return;
      var p = toVirtual(e.clientX, e.clientY);
      self.onFieldPress(p.x, p.y);
    }, { passive: true });

    window.addEventListener('pointermove', function (e) {
      var p = toVirtual(e.clientX, e.clientY);
      if (self.dragging) {
        if (!self.moved) {
          var dx = e.clientX - self.pressX, dy = e.clientY - self.pressY;
          // 6px 死区：触屏点按时的轻微抖动不算拖拽
          if (dx * dx + dy * dy > 36) self.moved = true;
        }
        if (self.moved) self.moveDragChip(e.clientX, e.clientY);
      }
      if (Game.state === 'build') {
        var c = self.cellAt(p.x, p.y);
        if (c) {
          var ok = Game.canPlace(c.col, c.lane, Game.armedType);
          Game.hoverCell = {
            col: c.col, lane: ok.lane === undefined ? c.lane : ok.lane,
            side: c.side, valid: ok.ok,
          };
        } else {
          Game.hoverCell = null;
        }
      } else if (self.flareArmed) {
        Game.hoverCell = null;
        self.flareTarget = p;
      }
    }, { passive: true });

    window.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'touch') Game.hoverCell = null;
      if (!self.dragging) return;
      self.dragging = false;
      self.hideDragChip();
      var p = toVirtual(e.clientX, e.clientY);
      if (self.moved) {
        var c = self.cellAt(p.x, p.y);
        if (c) {
          if (Game.coopMode) self.requestPlacement(self.dragType, c.col, c.lane, true);
          else if (Game.place(self.dragType, c.col, c.lane)) { Game.armedType = null; self.dragType = null; }
        }
      } else if (self.tapToggleOff) {
        Game.armedType = null; self.dragType = null;
      }
      self.tapToggleOff = false;
      self.syncAll();
    });
    window.addEventListener('pointercancel', function () {
      if (!self.dragging) return;
      self.dragging = false;
      self.dragType = null;
      self.moved = false;
      self.tapToggleOff = false;
      Game.armedType = self._armedBeforePress || null;
      self.hideDragChip();
      self.syncAll();
    });
  },

  showDragChip: function (type, x, y) {
    if (!this.dragEl) {
      var d = document.createElement('div');
      d.id = 'dragChip';
      document.body.appendChild(d);
      this.dragEl = d;
    }
    var u = UNITS[type];
    this.dragEl.innerHTML = '<span style="--c:' + u.color + '">' + u.short + '</span>' + u.name;
    this.dragEl.style.display = 'flex';
    this.moveDragChip(x, y);
  },
  moveDragChip: function (x, y) {
    if (!this.dragEl) return;
    this.dragEl.style.left = x + 'px';
    this.dragEl.style.top = (y - 46) + 'px';
  },
  hideDragChip: function () { if (this.dragEl) this.dragEl.style.display = 'none'; },

  /* 屏幕坐标 -> 格子 */
  cellAt: function (x, y) {
    var side = Game.coopMode ? Game.coopSide : 'p';
    var cols = side === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS;
    if ((side === 'p' && x > CONFIG.RIFT_X - 30) || (side === 'g' && x < CONFIG.RIFT_X + 30) ||
        x < Math.min.apply(null, cols) - CONFIG.GRID_COL_PITCH / 2 ||
        x > Math.max.apply(null, cols) + CONFIG.GRID_COL_PITCH / 2 ||
        y < CONFIG.LANES[0] - CONFIG.GRID_LANE_PITCH / 2 ||
        y > CONFIG.LANES[CONFIG.LANES.length - 1] + CONFIG.GRID_LANE_PITCH / 2) return null;
    var lane = -1, bd = 1e9;
    for (var l = 0; l < CONFIG.LANES.length; l++) {
      var d = Math.abs(y - CONFIG.LANES[l]);
      if (d < bd) { bd = d; lane = l; }
    }
    if (bd > CONFIG.GRID_LANE_PITCH / 2) return null;
    var col = -1, bc = 1e9;
    for (var c = 0; c < cols.length; c++) {
      var dc = Math.abs(x - cols[c]);
      if (dc < bc) { bc = dc; col = c; }
    }
    if (bc > CONFIG.GRID_COL_PITCH / 2) return null;
    return { col: col, lane: lane, side: side };
  },

  positionPlacementConfirm: function (pending) {
    var el = this.el.placementConfirm;
    if (!el || !pending) return;
    var rows = unitFootprintLanes(pending.type, pending.lane);
    var scale = this.scale || 1;
    var leftEdge = this.offX + 4 * scale;
    var rightEdge = this.offX + CONFIG.W * scale - el.offsetWidth - 4 * scale;
    var cols = pending.side === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS;
    var x = this.fieldPoint(cols[pending.col], CONFIG.LANES[pending.lane]).x - el.offsetWidth / 2;
    x = Math.max(leftEdge, Math.min(rightEdge, x));
    var laneTop = CONFIG.LANES[rows[0]] - CONFIG.GRID_LANE_PITCH / 2;
    var laneBottom = CONFIG.LANES[rows[rows.length - 1]] + CONFIG.GRID_LANE_PITCH / 2;
    var top = this.fieldPoint(0, laneTop).y - el.offsetHeight - 8 * scale;
    if (top < this.offY + 4 * scale) {
      top = this.fieldPoint(0, laneBottom).y + 8 * scale;
    }
    var bottomEdge = this.fieldBottom() - el.offsetHeight - 4 * scale;
    top = Math.max(this.offY + 4 * scale, Math.min(bottomEdge, top));
    this.setStyle(el, 'left', Math.round(x) + 'px');
    this.setStyle(el, 'top', Math.round(top) + 'px');
  },

  requestPlacement: function (type, col, lane, fromDrag) {
    if (!Game.coopMode || Game.state !== 'build' || Game.coopLocked || !UNITS[type]) return false;
    var place = Game.canPlace(col, lane, type);
    if (!place.ok) { Sfx.error(); this.toast(place.why); return false; }
    if (!Game.loadout || Game.loadout.indexOf(type) < 0) {
      Sfx.error(); this.toast(L('meta.notInLoadout', null, '这只动物伙伴不在本局队伍里')); return false;
    }
    if (UNITS[type].cost > Game.coins) {
      Sfx.error(); this.toast(L('meta.notEnoughCoins', null, '金币不够')); return false;
    }
    Game.pendingPlacement = {
      type: type, col: col, lane: place.lane, fromDrag: !!fromDrag,
      side: Game.coopSide,
      preview: makeUnit(Game.coopSide, col, place.lane, type, 1, Game.playerMods(), null),
    };
    Game.selectedCell = null;
    Game.hoverCell = null;
    Sfx.ui();
    this.syncAll();
    return true;
  },

  confirmPlacement: function () {
    var pending = Game.pendingPlacement;
    if (!pending || !Game.coopMode || Game.state !== 'build' || Game.coopLocked) return;
    var placed = Game.place(pending.type, pending.col, pending.lane);
    Game.pendingPlacement = null;
    if (placed && pending.fromDrag) Game.armedType = null;
    this.syncAll();
  },

  cancelPlacement: function () {
    Game.pendingPlacement = null;
    Sfx.ui();
    this.syncAll();
  },

  onFieldPress: function (x, y) {
    if (Game.paused) return;
    if (Game.state === 'build') {
      var c = this.cellAt(x, y);
      if (!c) {
        Game.selectedCell = null; Game.armedType = null; Game.pendingPlacement = null;
        this.syncAll(); return;
      }
      var occ = Game.unitAt(c.col, c.lane);
      if (Game.armedType) {
        if (occ) {
          Game.selectedCell = { col: occ.col, lane: occ.lane };
          Game.armedType = null;
          Game.pendingPlacement = null;
          Sfx.ui();
          this.syncAll();
          return;
        }
        if (Game.coopMode) this.requestPlacement(Game.armedType, c.col, c.lane, false);
        else if (Game.place(Game.armedType, c.col, c.lane)) {
          Game.armedType = Game.armedType;   // 连续放置：保留选中
        }
        this.syncAll();
        return;
      }
      Game.pendingPlacement = null;
      if (occ) { Game.selectedCell = { col: occ.col, lane: occ.lane }; Sfx.ui(); }
      else { Game.selectedCell = null; }
      this.syncAll();
    } else if (Game.state === 'battle') {
      if (this.flareArmed) {
        if (Game.useFlare(x, y)) this.flareArmed = false;
        this.syncAll();
      }
    }
  },

  /* ---------------- 同步 HUD ---------------- */
  /* 只在真的变了才写 DOM：手机上一部分发热来自无谓的文本 / 样式重写。 */
  setText: function (el, v) {
    if (el && el._txt !== v) { el._txt = v; el.textContent = v; }
  },
  setHTML: function (el, sig, html) {
    if (el && el._sig !== sig) { el._sig = sig; el.innerHTML = html; }
  },
  setStyle: function (el, prop, v) {
    if (el && el['_st' + prop] !== v) { el['_st' + prop] = v; el.style[prop] = v; }
  },
  syncAll: function () {
    var b = Game.battle, el = this.el;
    el.pauseBtn.style.display = !Game.coopMode && ['build', 'battle'].indexOf(Game.state) >= 0 &&
      !Game.matchmaking && !this.overlayMode ? 'block' : 'none';
    var coopSize = Game.coopMode && window.Coop && Coop.state && Coop.state.room
      ? Coop.state.room.players.length : CONFIG.COOP_MAX_PLAYERS;
    if (el.stage.dataset.phase !== Game.state) el.stage.dataset.phase = Game.state;
    var coopSide = Game.coopMode ? Game.coopSide : 'p';
    if (el.stage.dataset.coopSide !== coopSide) el.stage.dataset.coopSide = coopSide;
    var maxP = b ? b.maxHp.p : CONFIG.HOME_HP, maxG = b ? b.maxHp.g : CONFIG.HOME_HP;
    var hpP = b ? b.hp.p : maxP, hpG = b ? b.hp.g : maxG;

    this.setStyle(el.pHpBar, 'width', Math.max(0, hpP / maxP * 100) + '%');
    this.setStyle(el.gHpBar, 'width', Math.max(0, hpG / maxG * 100) + '%');
    this.setText(el.pHpTxt, Math.ceil(hpP) + ' / ' + maxP);
    this.setText(el.gHpTxt, Math.ceil(hpG) + ' / ' + maxG);

    if (Game.bot) {
      el.gName.textContent = Game.coopMode ? L('coop.teamName', null, '队友') : Game.bot.name;
      el.gTag.textContent = Game.coopMode ? L('coop.teamTag', { n: coopSize }, '{n} 人共守 · 尸潮 ×{n}') :
        L('hud.mirrorTag', { tag: Game.bot.tag }, '镜像 · {tag} · 战力 ') +
        '★'.repeat(Math.round(Game.bot.rating / 34));
    }
    var ghostSide = el.gName.parentNode && el.gName.parentNode.parentNode;
    if (ghostSide) ghostSide.style.display = Game.coopMode ? 'none' : '';
    var pressureRank = Game.coopMode && window.Coop ? Coop.averageRank() : Game.save.rank;
    var pressure = rankPressure(pressureRank);
    var threat = Game.threat || rankThreat(pressureRank);
    var pressureLabel = pressure > 1.005
      ? L('hud.pressureSuffix', { n: Math.round((pressure - 1) * 100) }, ' · 压力+{n}%')
      : '';
    var budgetLabel = threat.budgetBonus > 0.005
      ? L('hud.fundsSuffix', { n: Math.round(threat.budgetBonus * 100) }, ' · 资金+{n}%')
      : '';
    var tierLabel = threat.eternalTier > 0
      ? L('hud.eternalSuffix', { n: threat.eternalTier }, ' · 永续{n}')
      : '';
    this.setText(el.roundLbl,
      L('hud.round', { n: Game.roundIndex + 1, total: CONFIG.TOTAL_ROUNDS }, '第 {n} / {total} 小局') +
      pressureLabel + budgetLabel + tierLabel);
    this.setText(el.coins, Math.floor(Game.coins));
    var watchedHp = Game.coopMode && b ? b.hp[Game.coopSide] / b.maxHp[Game.coopSide] : hpP / maxP;
    this.syncAtmosphere(b, watchedHp);

    if (Game.state === 'build') {
      this.setText(el.timer, L('hud.preparing', null, '准备中'));
      el.timer.className = 'buildTimer';
      el.buildBar.style.display = 'grid';
      el.battleBar.style.display = 'none';
      var laneCount = unlockedLanes(Game.roundIndex).length;
      var localSeat = coopLocalSeat(Game.coopSeat || 0);
      var coopSideName = Game.coopSide === 'p'
        ? L('coop.leftSide', null, '左侧') : L('coop.rightSide', null, '右侧');
      var laneText = Game.coopMode
        ? L('coop.lanes', {
          side: coopSideName,
          a: localSeat * CONFIG.COOP_LANES_PER_PLAYER + 1,
          b: (localSeat + 1) * CONFIG.COOP_LANES_PER_PLAYER,
          total: coopSize * 3,
        }, '你负责{side}第 {a}–{b} 路 · 共守 {total} 路')
        : laneCount === 3
        ? L('hud.lanes3', null, '已开放 3 路 · 第 2 小局开放 4–6 路')
        : laneCount === 6
          ? L('hud.lanes6', null, '已开放 6 路 · 第 3 小局开放 7–9 路')
          : L('hud.lanesAll', null, '9 路全部开放');
      if (Game.armedType) {
        var ud = UNITS[Game.armedType];
        var armedRange = unitRangeLabel(
          Game.armedType, 1, null, combineMods(Game.relics)
        );
        var hintSig = 'armed|' + Game.armedType + '|' + armedRange;
        this.setHTML(el.buildHint, hintSig,
          '<span class="hintLine"><span class="hintMain"><b style="color:' + ud.color + '">' +
          ud.name + '</b> ' + ud.desc + '</span>' +
          (armedRange ? '<span class="hintRange">⌖ ' + armedRange + '</span>' : '') + '</span>' +
          '<span class="hintLane">' + L('hud.hintPlaced', null, '点空地安排伙伴 · 再点卡片取消') + '</span>');
      } else {
        this.setHTML(el.buildHint, 'idle|' + laneText,
          '<span class="hintLine"><span class="hintMain">' +
          L('hud.hintDrag', null, '拖动动物卡片到空地放置 · 也可以先点卡片再点空地') + '</span></span>' +
          '<span class="hintLane">' + laneText + '</span>');
      }
      this.setText(el.startBtn, Game.coopMode
        ? (Game.coopLocked ? L('coop.readyLocked', null, '已准备 · 等待队友') : L('coop.submitReady', null, '布防完成 · 准备'))
        : Game.roundIndex === 0
          ? L('hud.startDefense', null, '开始防守')
          : L('hud.startRound', { n: Game.roundIndex + 1 }, '开始第 {n} 小局'));
      el.startBtn.disabled = !!(Game.coopMode && Game.coopLocked);
      el.startBtn.classList.toggle('off', !!(Game.coopMode && Game.coopLocked));
    } else if (Game.state === 'coopReplay' || (Game.coopMode && Game.state !== 'battle')) {
      el.buildBar.style.display = 'none';
      el.battleBar.style.display = 'none';
      this.setText(el.timer, b ? b.t.toFixed(1) + 's' : '0.0s');
      el.timer.className = 'battleTimer';
    } else {
      el.buildBar.style.display = 'none';
      el.battleBar.style.display = 'flex';
      var surgeLevel = b ? escalationLevel(b.t) : 0;
      this.setText(el.timer, surgeLevel > 0
        ? L('hud.surge', { n: surgeLevel }, '狂潮 ×{n}')
        : (b ? b.t.toFixed(1) + 's' : '0.0s'));
      el.timer.className = 'battleTimer';
      this.setText(el.flareN, Game.flare);
      this.setText(el.repairN, Game.repair);
      el.repairBtn.disabled = Game.repair <= 0 || !!(b && b.hp.p >= b.maxHp.p);
      el.repairBtn.title = b && b.hp.p >= b.maxHp.p ? L('experience.fullHealth') : '';
      el.flareBtn.classList.toggle('armed', this.flareArmed);
      el.flareBtn.classList.toggle('dead', Game.flare <= 0);
      el.repairBtn.classList.toggle('dead', Game.repair <= 0);
    }

    var pending = Game.pendingPlacement;
    if (pending && Game.coopMode && Game.state === 'build' && !Game.coopLocked) {
      el.placementConfirm.style.display = 'block';
      this.setHTML(el.placementConfirm,
        pending.type + '|' + pending.col + '|' + pending.lane,
        '<div class="placePrompt">' + L('coop.placementPrompt', {
          name: UNITS[pending.type].name, lane: pending.lane + 1,
          col: pending.col + 1, cost: UNITS[pending.type].cost,
        }, '{name} · 第 {lane} 路 / 第 {col} 列 · {cost} 金币') + '</div>' +
        '<div class="placeActions"><button class="ghost" data-action="cancel">' +
        L('coop.cancelPlacement', null, '取消') + '</button>' +
        '<button class="ghost confirm" data-action="confirm">' +
        L('coop.confirmPlacement', null, '确认放置') + '</button></div>');
      this.positionPlacementConfirm(pending);
    } else {
      el.placementConfirm.style.display = 'none';
    }

    // 卡片可负担状态
    var cards = el.cards.children;
    // 射程文案只跟遗物有关，按遗物签名缓存，别每 60ms 重算一遍
    var relicSig = '';
    for (var ri2 = 0; ri2 < Game.relics.length; ri2++) relicSig += Game.relics[ri2].id + ',';
    if (this._rangeSig !== relicSig) {
      this._rangeSig = relicSig;
      this._rangeMods = combineMods(Game.relics);
      this._rangeCache = {};
    }
    for (var i = 0; i < cards.length; i++) {
      var t = cards[i].dataset.type;
      var afford = Game.coins >= UNITS[t].cost;
      var cardRange = cards[i].querySelector('.cr');
      if (cardRange) {
        if (this._rangeCache[t] === undefined) {
          this._rangeCache[t] = unitRangeLabel(t, 1, null, this._rangeMods);
        }
        this.setText(cardRange, this._rangeCache[t]);
      }
      cards[i].classList.toggle('off', !afford);
      cards[i].classList.toggle('sel', Game.armedType === t);
    }
    if (window.Coop && Game.coopMode) Coop.syncGameUI();

    // 已拥有的遗物
    var rb = el.relicBar;
    if (Game.relics.length !== (this._rCount || -1)) {
      this._rCount = Game.relics.length;
      var rh = '';
      for (var ri = 0; ri < Game.relics.length; ri++) {
        var rr = Game.relics[ri];
        rh += '<span class="rel" style="--c:' + (ri % 2 ? '#7fe3ff' : '#ffd46a') + '" title="' + rr.name + '：' + rr.text + '" aria-label="' + rr.name + '：' + rr.text + '">' + rr.icon + '</span>';
      }
      rb.innerHTML = rh;
    }
    rb.style.display = Game.relics.length ? 'flex' : 'none';

    // 本match胜负打点
    var pp = el.pips;
    var ph = '';
    for (var pi = 0; pi < CONFIG.TOTAL_ROUNDS; pi++) {
      var h = Game.history[pi];
      var cls = h ? (h.won ? 'w' : 'l') : (pi === Game.roundIndex && Game.state !== 'matchEnd' ? 'now' : '');
      ph += '<i class="' + cls + '"></i>';
    }
    if (pp.innerHTML !== ph) pp.innerHTML = ph;

    // 领先/落后
    if (b && Game.state === 'battle') {
      var fp = b.hp.p / b.maxHp.p, fg = b.hp.g / b.maxHp.g;
      var d = fp - fg;
      el.lead.textContent = Math.abs(d) < 0.02
        ? L('hud.even', null, '势均力敌')
        : (d > 0
          ? L('hud.lead', { n: Math.round(d * 100) }, '你领先 {n}%')
          : L('hud.behind', { n: Math.round(-d * 100) }, '你落后 {n}%'));
      el.lead.className = Math.abs(d) < 0.02 ? 'lead even' : (d > 0 ? 'lead up' : 'lead down');
      el.lead.style.display = 'block';
    } else {
      el.lead.style.display = 'none';
    }
    this.syncMatchmaking();
    this.syncTutorial();
    this.syncUnitPanel();
  },

  syncMatchmaking: function () {
    var el = this.el.matchmaking;
    if (!el) return;
    var mm = Game.matchmaking;
    if (!mm) {
      el.classList.remove('show');
      el.innerHTML = '';
      return;
    }
    var found = mm.phase === 'found';
    var bot = Game.bot || {
      name: L('bot.unknown', null, '未知守夜人'),
      tag: L('bot.defaultTag', null, '夜巡'),
      rating: 100,
    };
    var sig = mm.phase + '|' + bot.name + '|' + bot.tag + '|' + bot.rating;
    if (el._sig === sig) return;
    el._sig = sig;
    el.classList.add('show');
    el.innerHTML =
      '<div class="matchPanel ' + (found ? 'found' : '') + '">' +
      '<div class="matchKicker">' + L('hud.matchKicker', null, '守夜人匹配 · 1V1') + '</div>' +
      '<div class="matchTitle">' +
      (found ? L('hud.matchFound', null, '匹配成功 · 对手已锁定')
        : L('hud.matchSearching', null, '正在寻找其他玩家…')) +
      '</div>' +
      '<div class="matchArena">' +
      '<div class="matchPlayer self">' +
      '<span class="matchAvatar">' + L('hud.avatarYou', null, '夜') + '</span>' +
      '<b>' + (Game.save.name || L('hud.you', null, '你')) + '</b>' +
      '<em>' + L('hud.yourHome', null, '你的家园') + '</em>' +
      '</div>' +
      '<div class="matchRadar"><i></i><b></b></div>' +
      '<div class="matchPlayer rival">' +
      '<span class="matchAvatar">' + L('hud.avatarRival', null, '影') + '</span>' +
      '<b>' + (found ? bot.name : L('hud.scanning', null, '扫描中…')) + '</b>' +
      '<em>' + (found
        ? L('hud.otherPlayer', { tag: bot.tag }, '其他玩家 · {tag}')
        : L('hud.watcherChannel', null, '守夜人频道')) + '</em>' +
      '</div>' +
      '</div>' +
      '<div class="matchStatus">' +
      (found ? L('hud.matchStatusFound', null, '实力与小局进度匹配完成')
        : L('hud.matchStatusSearching', null, '正在比对排位、进度与防守强度')) +
      '</div>' +
      '<div class="matchProgress"><i></i></div>' +
      '</div>';
  },

  /* 元素在 #stage 坐标系里的位置：offsetLeft 累加，竖屏旋转也不受影响 */
  stageOffset: function (el) {
    var x = 0, y = 0, n = el, stage = this.el.stage;
    while (n && n !== stage) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  },

  tutorialAnchor: function (step) {
    if (step < 7 && step % 2 === 0) {
      var t = Game.tutorialTarget;
      if (!t) return null;
      return this.fieldPoint(CONFIG.P_COLS[t.col], CONFIG.LANES[t.lane]);
    }
    var el = null;
    if (step < 7 && step % 2 === 1) {
      var type = Game.tutorialType();
      el = type ? this.el.cards.querySelector('.card[data-type="' + type + '"]') : null;
    } else if (step === 7) {
      el = this.el.startBtn;
    }
    if (!el) return null;
    var r = this.stageOffset(el);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  },

  syncTutorial: function () {
    var wrap = this.el.tutorialHand, skip = this.el.tutorialSkip;
    if (!wrap) return;
    var show = Game.tutorialActive && !Game.matchmaking && this.tutorialAnchor(Game.tutorialStep);
    if (skip) {
      var skipOn = show ? 'block' : 'none';
      if (skip.style.display !== skipOn) skip.style.display = skipOn;
    }
    if (!show) {
      if (wrap._sig) { wrap._sig = 0; wrap.style.display = 'none'; wrap.innerHTML = ''; }
      return;
    }
    if (wrap._sig !== Game.tutorialStep) {
      wrap._sig = Game.tutorialStep;
      wrap.innerHTML = TUT_HAND_SVG +
        '<i class="tutRing"></i><i class="tutRing b"></i><i class="tutDot"></i>' +
        '<b class="tutLbl">' + TUT_STEP_TEXT[Game.tutorialStep]() + '</b>';
    }
    wrap.style.display = 'block';
    wrap.style.transform = 'translate(' + Math.round(show.x) + 'px,' + Math.round(show.y) + 'px)';
    // 手指指向真实目标，文字单独夹在舞台内，左右侧栏也不会把气泡裁掉。
    var label = wrap.querySelector('.tutLbl');
    if (label) {
      var w = label.offsetWidth, h = label.offsetHeight;
      var labelX = Math.max(8 + w / 2, Math.min(this.el.stage.clientWidth - 8 - w / 2, show.x));
      var naturalTop = show.y - 124 * this.scale - h;
      var labelTop = Math.max(8, Math.min(this.el.stage.clientHeight - h - 8, naturalTop));
      label.style.left = Math.round(labelX - show.x) + 'px';
      label.style.top = Math.round(labelTop - naturalTop) + 'px';
    }
  },

  syncAtmosphere: function (b, hpFrac) {
    if (!this.el.dangerVeil) return;
    var fighting = Game.state === 'battle' || Game.state === 'coopReplay';
    if (Game.state === 'coopReplay' && Game.coopHomes && Game.coopHomes.length) {
      hpFrac = Math.max.apply(null, Game.coopHomes.map(function (home) {
        return home.maxHp > 0 ? home.hp / home.maxHp : 0;
      }));
    }
    var near = 0;
    if (b && fighting) {
      for (var i = 0; i < b.zombies.length; i++) {
        var z = b.zombies[i];
        if (!z.dead && z.side === 'p' && Math.abs(z.x - CONFIG.HOME_P_X) < 285) near++;
      }
    }
    var hpRisk = fighting ? Math.max(0, 1 - hpFrac) : 0;
    var nearRisk = fighting ? Math.min(0.78, near * 0.16) : 0;
    var danger = Math.max(0, Math.min(1, hpRisk * 1.18 + nearRisk));
    var veil = this.el.dangerVeil;
    veil.classList.toggle('near', danger >= 0.34 && danger < 0.7);
    veil.classList.toggle('critical', danger >= 0.7);
    this.el.stage.classList.toggle('lowHp', danger >= 0.55);
    Sfx.setIntensity(danger, Game.state !== 'menu');

  },

  syncUnitPanel: function () {
    var el = this.el.unitPanel, c = Game.selectedCell;
    if (!c || Game.state !== 'build' || Game.formChoice || this.overlayMode === 'form') {
      el.style.display = 'none'; el._sig = ''; return;
    }
    var u = Game.unitAt(c.col, c.lane);
    if (!u) { el.style.display = 'none'; el._sig = ''; return; }
    var d = UNITS[u.type];
    var maxed = u.lv >= d.maxLv;
    var ucost = maxed ? 0 : upgradeCost(u.type, u.lv);
    var form = u.form ? getForm(u.type, u.form) : null;
    var mods = combineMods(Game.relics);
    var combat = unitCombatText(u.type, u.lv, u.form, mods);
    var sig = c.col + '|' + c.lane + '|' + u.type + '|' + u.lv + '|' +
      (u.form || '') + '|' + combat;
    if (el._sig !== sig) {
      el.innerHTML =
        '<div class="up-title">' + d.name +
        ' <em>Lv.' + u.lv + (form && u.lv > 1 ? ' · ' + form.name : '') + '</em></div>' +
        '<div class="up-desc">' + d.desc + '</div>' +
        (u.lv === 1 && !u.form
          ? '<div class="firstUp">' + L('ui.firstUpgrade', null, '首次升级 · 三选一') + '</div>' : '') +
        (form && u.lv > 1 ? '<div class="formLine" style="--fc:' + form.color + '">' +
          form.icon + ' ' + (u.lv === 2 ? form.effect2 : form.effect3) + '</div>' : '') +
        '<div class="up-stats">' + L('hud.hpStat', { n: unitHpAt(u.type, u.lv) }, '血量 {n}') +
        (d.dmg ? L('hud.dmgStat', { n: unitDmgAt(u.type, u.lv) }, ' · 伤害 {n}') : '') + '</div>' +
        (combat ? '<div class="up-range">⌖ ' + combat + '</div>' : '') +
        '<div class="up-row">' +
        (maxed ? '<button class="mini off">' + L('ui.maxLevel', null, '已满级') + '</button>'
          : u.lv === 1 && !u.form
            ? '<button class="mini first" id="upBtn">' +
              coinTextHtml(L('ui.pickOneCost', { n: ucost }, '三选一 ◍{n}')) + '</button>'
            : '<button class="mini" id="upBtn">' +
              coinTextHtml(L('ui.upgradeCost', { n: ucost }, '升级 ◍{n}')) + '</button>') +
        '<button class="mini danger" id="sellBtn">' +
        coinTextHtml(L('ui.sellCost', { n: sellValue(u.type, u.lv) }, '回收 ◍{n}')) + '</button>' +
        '</div>';
      el._sig = sig;
    }
    el.style.display = 'block';
    // 跟随格子位置，并把整块面板夹在舞台内（否则最下面几排的升级 / 回收按钮会被 #stage 裁掉）
    // 夹取后再量一次：offsetHeight 始终是内容自然高，裁掉描述行后面板会真的变矮
    // 量 offset* 会强制回流，所以只在选中格 / 视口真的变了时才重排
    var posKey = c.col + '|' + c.lane + '|' + el._sig + '|' + this.offX + '|' + this.offY + '|' + this.scale + '|' + this.fieldBottom();
    if (this._panelPos !== posKey) {
      this._panelPos = posKey;
      el.classList.toggle('tight', el.offsetHeight > this.fieldBottom() - 8);
      var pw = el.offsetWidth, ph = el.offsetHeight;
      var panelCols = Game.coopMode && Game.coopSide === 'g' ? CONFIG.G_COLS : CONFIG.P_COLS;
      var field = this.fieldPoint(panelCols[c.col], CONFIG.LANES[c.lane]);
      var px = field.x;
      var py = field.y - 104 * this.scale;
      var maxLeft = this.offX + CONFIG.W * this.scale - pw - 4;
      var maxTop = this.fieldBottom() - ph - 4;
      el.style.left = Math.max(this.offX + 4, Math.min(maxLeft, px - pw / 2)) + 'px';
      el.style.top = Math.max(4, Math.min(maxTop, py)) + 'px';
    }

  },

  announceCell: function () {
    var c = this.focusCell; if (!c) return;
    var u = Game.unitAt(c.col, c.lane);
    this.el.fieldStatus.textContent = L('experience.cellStatus', { lane: c.lane + 1, col: c.col + 1,
      name: u ? UNITS[u.type].name : (unlockedCols(Game.roundIndex).indexOf(c.col) < 0 ||
        unlockedLanes(Game.roundIndex).indexOf(c.lane) < 0 ? L('experience.lockedCell') : L('experience.emptyCell')) });
  },
  toast: function (msg, undo) {
    var t = this.el.toast;
    t.textContent = msg;
    if (undo) {
      var button = document.createElement('button'); button.type = 'button'; button.id = 'undoSellBtn';
      button.textContent = L('experience.undo'); button.onclick = undo; t.appendChild(button);
    }
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(function () { t.classList.remove('show'); }, undo ? 5000 : 2400);
  },

  /* ---------------- 浮层 ---------------- */
  hideToast: function () { this.el.toast.classList.remove('show'); },
  closeOverlay: function () {
    this.el.overlay.style.display = 'none';
    this.el.overlay.innerHTML = '';
    this.overlayMode = null;
  },

  showFormChoice: function () {
    var choice = Game.formChoice;
    if (!choice) return;
    var u = Game.grid[choice.col + '|' + choice.lane];
    if (!u) return;
    var d = UNITS[u.type];
    var forms = FORMS[u.type] || [];
    var cost = upgradeCost(u.type, u.lv);
    this.overlayMode = 'form';
    this.el.unitPanel.style.display = 'none';
    this.el.unitPanel._sig = '';
    this.el.overlay.style.display = 'flex';
    var html = '<div class="overlayBox formChoice">' +
      '<div class="rewardHeadline"><span class="rewardAnimal">' + unitThumbHtml(u.type, 80) + '</span>' +
      '<h2>' + L('ui.formTitle', null, '选一个升级') + '</h2></div>' +
      '<p class="sub">' +
      L('ui.formSub', { name: '<b>' + d.name + '</b>', cost: cost },
        '让 {name} 更强一点 · 升到 2 级需要 {cost} 金币') + '</p>' +
      '<div class="formRow">';
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      html += '<div class="formOption" style="--fc:' + f.color + '"><button type="button" class="formCard" data-form="' + f.id + '">' +
        '<span class="formArt">' + unitThumbHtml(u.type, 64) + '</span>' +
        '<span class="formIcon">' + f.icon + '</span>' +
        '<span class="formName">' + f.name + '</span>' +
        '<span class="formRole">' + f.role + '</span>' +
        '<span class="formDesc">' + f.desc + '</span>' +
        '<span class="formCost">' +
        L('ui.formCost', { n: cost }, '选择 · {n} 金币') + '</span>' +
        '</button><details class="friendlyDetails formDetails"><summary>' +
        L('friendly.details', null, '查看详细数值') + '</summary>' +
        '<span class="formEffect"><b>LV.2</b>' + f.effect2 + '</span>' +
        '<span class="formEffect preview"><b>LV.3</b>' + f.effect3 + '</span></details></div>';
    }
    html += '</div><div class="formNote">' +
      L('ui.formNote', null, '选择后不可在本小局更改') + '</div>' +
      '<button class="ghost" id="cancelFormBtn">' +
      L('ui.formCancel', null, '暂不升级') + '</button></div>';
    this.el.overlay.innerHTML = html;
    var self = this;
    var cards = this.el.overlay.querySelectorAll('.formCard');
    for (var j = 0; j < cards.length; j++) {
      cards[j].onclick = function () {
        Sfx.ui();
        Game.confirmForm(this.dataset.form);
      };
    }
    document.getElementById('cancelFormBtn').onclick = function () {
      Game.cancelFormChoice();
    };
  },

  showPause: function () {
    this.overlayMode = 'pause'; this.el.overlay.style.display = 'flex';
    this.el.overlay.innerHTML = '<div class="overlayBox" role="dialog" aria-modal="true" aria-labelledby="pauseTitle"><h2 id="pauseTitle">' + L('experience.paused') + '</h2>' +
      '<p class="sub">' + L(Game.state === 'battle' ? 'experience.resumeNote' : 'experience.checkpointNote') + '</p>' +
      '<button class="big" id="resumeBtn">' + L('experience.resume') + '</button>' +
      '<button class="ghost" id="pauseSettingsBtn">' + L('friendly.settings', null, '设置') + '</button>' +
      '<button class="ghost" id="saveMenuBtn">' + L('experience.saveMenu') + '</button></div>';
    document.getElementById('resumeBtn').onclick = function () { Game.resume(); };
    document.getElementById('pauseSettingsBtn').onclick = function () { UI.showSettings('pause'); };
    document.getElementById('saveMenuBtn').onclick = function () { Game.returnToMenu(); };
    document.getElementById('resumeBtn').focus(); this.syncAll();
  },

  motionReduced: function () {
    return !!(Game.save && Game.save.reducedMotion) ||
      !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  },

  applyPreferences: function () {
    var save = Game.save || {};
    var textSize = save.largeText ? 'large' : 'normal';
    var motion = this.motionReduced() ? 'true' : 'false';
    document.documentElement.setAttribute('data-text-size', textSize);
    document.documentElement.setAttribute('data-reduced-motion', motion);
    var stage = this.el.stage || document.getElementById('stage');
    if (stage) {
      stage.setAttribute('data-text-size', textSize);
      stage.setAttribute('data-reduced-motion', motion);
    }
    if (Sfx.setVolume) Sfx.setVolume(typeof save.soundVolume === 'number' ? save.soundVolume : 1);
  },

  showSettings: function (origin) {
    var self = this, save = Game.save;
    var systemMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var volume = Math.round(Math.max(0, Math.min(1, typeof save.soundVolume === 'number' ? save.soundVolume : 1)) * 100);
    this.overlayMode = 'settings'; this.el.overlay.style.display = 'flex';
    this.el.overlay.innerHTML = '<div class="overlayBox settings hasFoot" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">' +
      '<div class="overlayBody settingsScroll"><h2 id="settingsTitle">' + L('friendly.settings', null, '设置') + '</h2>' +
      '<p class="sub">' + L('friendly.settingsNote', null, '调整立即保存') + '</p>' +
      '<label class="settingRow"><span class="settingCopy"><strong>' + L('friendly.largeText', null, '大字模式') + '</strong><small>' +
      L('friendly.largeTextHint', null, '放大界面文字') + '</small></span><input type="checkbox" id="largeTextSetting"' + (save.largeText ? ' checked' : '') + '></label>' +
      '<label class="settingRow"><span class="settingCopy"><strong>' + L('friendly.reducedMotion', null, '减少动态效果') + '</strong><small>' +
      L(systemMotion ? 'friendly.systemMotion' : 'friendly.reducedMotionHint', null,
        systemMotion ? '系统已开启减少动态效果' : '减少闪烁与画面震动') + '</small></span><input type="checkbox" id="reducedMotionSetting"' +
      (this.motionReduced() ? ' checked' : '') + (systemMotion ? ' disabled' : '') + '></label>' +
      '<label class="settingRow settingsToggle"><span class="settingCopy"><strong>' + L('friendly.soundEnabled', null, '音效') + '</strong></span>' +
      '<input type="checkbox" id="soundEnabledSetting"' + (!save.muted ? ' checked' : '') + '></label>' +
      '<div class="settingVolume"><label for="soundVolumeSetting">' + L('friendly.volume', null, '音效音量') + '</label>' +
      '<output id="soundVolumeValue" for="soundVolumeSetting">' + volume + '%</output>' +
      '<input type="range" id="soundVolumeSetting" min="0" max="100" step="1" value="' + volume + '"></div></div>' +
      '<div class="overlayFoot"><button type="button" class="big" id="settingsBackBtn">' + L('friendly.settingsBack', null, '返回') + '</button></div></div>';
    function persist() { Game.persist(); self.applyPreferences(); }
    document.getElementById('largeTextSetting').onchange = function () { save.largeText = this.checked; persist(); };
    document.getElementById('reducedMotionSetting').onchange = function () { save.reducedMotion = this.checked; persist(); };
    document.getElementById('soundEnabledSetting').onchange = function () {
      save.muted = !this.checked;
      Sfx.setEnabled(this.checked);
      persist();
    };
    document.getElementById('soundVolumeSetting').oninput = function () {
      save.soundVolume = Number(this.value) / 100;
      document.getElementById('soundVolumeValue').textContent = this.value + '%';
      persist();
    };
    document.getElementById('settingsBackBtn').onclick = function () {
      if (origin === 'pause') { self.showPause(); document.getElementById('pauseSettingsBtn').focus(); }
      else { self.showMenu(); document.getElementById('settingsBtn').focus(); }
    };
    document.getElementById('largeTextSetting').focus();
  },
  showLoadout: function () {
    var rank = Game.save.rank;
    var unlocked = unlockedUnitIds(rank);
    var draft = normalizeLoadout(Game.loadout, rank).slice();
    var teaching = Game.shouldTeach();
    var required = ['barricade', 'spike', 'turret'];
    if (teaching) draft = required.concat(draft.filter(function (id) { return required.indexOf(id) < 0; })).slice(0, 6);
    this._loadoutDraft = draft;
    this.overlayMode = 'loadout';
    this.el.overlay.style.display = 'flex';

    var html = '<div class="overlayBox loadout hasFoot">' +
      '<div class="overlayBody">' +
      '<h2>' + L('ui.loadoutTitle', null, '选择动物伙伴') + '</h2>' +
      '<p class="sub">' +
      L('ui.loadoutSub', null, '从已结识动物中选择 <b>6 只</b>，本大局所有小局都使用这套阵容。') +
      '</p>' +
      '<div class="loadoutGrid">';
    for (var i = 0; i < UNIT_ORDER.length; i++) {
      var id = UNIT_ORDER[i];
      var d = UNITS[id];
      var unlockRank = unitUnlockRank(id);
      var isOpen = unlocked.indexOf(id) >= 0;
      var selected = draft.indexOf(id) >= 0;
      html += '<button type="button" class="loadoutCard' +
        (selected ? ' selected' : '') + (isOpen ? '' : ' locked') +
        '" data-id="' + id + '" style="--lc:' + d.color + '">' +
        '<span class="loArt">' + unitThumbHtml(id, 128) + '</span><span class="loInfo">' +
        '<span class="loName">' + d.name + '</span>' +
        '<span class="loCost">' + coinTextHtml('◍ ' + d.cost) + '</span>' +
        '<span class="loRole">' + unitRoleText(id) + '</span></span>' +
        (isOpen ? '<span class="loCheck">✓</span>'
          : '<span class="loLock">' +
            L('ui.unlockAtRank', { n: unlockRank }, '排位{n}解锁') + '</span>') +
        '</button>';
    }
    html += '</div><details class="friendlyDetails loadoutDetails"><summary>' +
      L('friendly.details', null, '查看详细数值') + '</summary>';
    for (var k = 0; k < UNIT_ORDER.length; k++) {
      var detailId = UNIT_ORDER[k], detailUnit = UNITS[detailId];
      var detailStats = L('hud.hpStat', { n: unitHpAt(detailId, 1) }, '血量 {n}') +
        (detailUnit.dmg ? L('hud.dmgStat', { n: unitDmgAt(detailId, 1) }, ' · 伤害 {n}') : '');
      var detailCombat = unitCombatText(detailId, 1, null, combineMods(Game.relics), false);
      html += '<div class="unitDetail"><b>' + detailUnit.name + '</b><span>' + detailUnit.desc + '</span>' +
        '<small>' + detailStats + (detailCombat ? ' · ' + detailCombat : '') + '</small></div>';
    }
    html += '</details></div>' +
      '<div class="overlayFoot"><div class="loadoutSlots" id="loadoutSlots" role="group" aria-label="' +
      L('friendly.team', null, '我的出战伙伴') + '"></div><div class="loadoutFoot">' +
      '<span id="loadoutCount">' +
      L('ui.loadoutCount', { n: draft.length }, '已选 {n} / 6') + '</span>' +
      '<button type="button" class="big" id="loadoutConfirm">' +
      L('ui.loadoutConfirm', null, '确认出战') + '</button>' +
      '</div></div></div>';
    this.el.overlay.innerHTML = html;

    var self = this;
    var cards = this.el.overlay.querySelectorAll('.loadoutCard');
    var countEl = document.getElementById('loadoutCount');
    var confirmEl = document.getElementById('loadoutConfirm');
    var slotsEl = document.getElementById('loadoutSlots');
    function refresh() {
      countEl.textContent = L('ui.loadoutCount', { n: draft.length }, '已选 {n} / 6');
      confirmEl.disabled = draft.length !== 6;
      confirmEl.classList.toggle('off', draft.length !== 6);
      var slots = '';
      for (var slot = 0; slot < 6; slot++) {
        var selectedId = draft[slot];
        var slotName = selectedId ? UNITS[selectedId].name : L('friendly.emptySlot', null, '待选择');
        slots += '<span class="loadoutSlot' + (selectedId ? '' : ' empty') + '" role="img" aria-label="' + slotName + '">' +
          (selectedId ? unitThumbHtml(selectedId, 48) + '<span class="loSlotName">' + slotName + '</span>'
            : '<span aria-hidden="true">+</span><span class="loSlotName">' + slotName + '</span>') + '</span>';
      }
      slotsEl.innerHTML = slots;
      for (var j = 0; j < cards.length; j++) {
        cards[j].classList.toggle('selected', draft.indexOf(cards[j].dataset.id) >= 0);
        cards[j].setAttribute('aria-pressed', draft.indexOf(cards[j].dataset.id) >= 0 ? 'true' : 'false');
        cards[j].setAttribute('aria-disabled', unlocked.indexOf(cards[j].dataset.id) < 0 ? 'true' : 'false');
      }
    }
    for (var j = 0; j < cards.length; j++) {
      cards[j].onclick = function () {
        var cardId = this.dataset.id;
        if (unlocked.indexOf(cardId) < 0) {
          Sfx.error();
          self.toast(L('ui.unlockAtRankToast', { n: unitUnlockRank(cardId) }, '排位 {n} 分解锁'));
          return;
        }
        var at = draft.indexOf(cardId);
        if (teaching && at >= 0 && required.indexOf(cardId) >= 0) {
          self.toast(L('experience.tutorialRequired')); return;
        }
        if (at >= 0) draft.splice(at, 1);
        else if (draft.length >= 6) {
          Sfx.error();
          self.toast(L('ui.loadoutFull', null, '最多只能带 6 种'));
          return;
        } else draft.push(cardId);
        Sfx.ui();
        refresh();
      };
    }
    confirmEl.onclick = function () {
      if (draft.length !== 6) return;
      Sfx.ui();
      Game.loadout = normalizeLoadout(draft, rank);
      Game.save.loadout = Game.loadout.slice();
      Game.persist();
      self.closeOverlay();
      self.buildCards(Game.loadout);
      self.syncAll();
      Game.beginFirstRunTutorial();
    };
    refresh();
  },

  /* ---------------- 变现：额度与付费墙 ---------------- */
  quotaHtml: function () {
    var line = Monetize.line();
    return line ? '<div class="quota">' + line + '</div>' : '';
  },

  /** 门禁入口：额度够就直接开局，不够就弹付费墙。 */
  startMatch: function () {
    var self = this;
    Monetize.requestMatch(function () { self._enterRun(); });
  },

  requestCoopMatch: function (go) {
    this._quotaIntent = 'coop';
    this._quotaCallback = go;
    Monetize.requestMatch(function () { UI._resumeQuotaIntent(); });
  },

  _resumeQuotaIntent: function () {
    var callback = this._quotaCallback;
    this._quotaIntent = null;
    this._quotaCallback = null;
    if (callback) callback();
    else this._enterRun();
  },

  /** 真正开局，不再过门禁（广告失败放行、买断之后继续玩都走这条）。 */
  _enterRun: function () {
    this.closeOverlay();
    Sfx.resume(); Sfx.ui(); Sfx.startAmbient();
    Game.startRun();
  },

  showPaywall: function (reason) {
    this.hideToast();
    var self = this;
    var info = Monetize.info();
    var canBuy = Monetize.iapAvailable && !Monetize.unlocked;
    var adsReady = Monetize.adsAvailable;
    var price = Monetize.price();
    this._paywallReason = reason || 'quota';
    this.overlayMode = 'paywall';
    this.el.overlay.style.display = 'flex';
    this.el.overlay.innerHTML =
      '<div class="overlayBox paywall hasFoot">' +
      '<div class="overlayBody">' +
      '<h2>' + (reason === 'menu'
        ? L('monetize.paywallTitleMenu', null, '无 限 畅 玩')
        : L('monetize.paywallTitleQuota', null, '今天的三大局玩完了')) + '</h2>' +
      '<p class="sub">' + (adsReady
        ? L('monetize.paywallSubAds', null, '看一条短视频，立刻再开一大局；买断之后永久不限局。')
        : L('monetize.paywallSubBuy', null,
            '一次买断，永久不限局 —— 天亮前修好家园，想开几局开几局。')) + '</p>' +
      this.quotaHtml() +
      '<ul class="payList">' +
      '<li>' + L('monetize.freePerDay',
        { n: '<b>' + info.limit + '</b>' }, '每天免费 {n} 大局') + '</li>' +
      (adsReady ? '<li>' + L('monetize.adReward',
        { n: '<b>+' + MONETIZE.AD_REWARD + '</b>' }, '看完一条激励视频 {n} 大局，可以一直看') + '</li>' : '') +
      '<li>' + L('monetize.oneTimeBuy',
        { name: '<b>' + Monetize.title() + '</b>' }, '一次性买断 {name}，不限局数') + '</li>' +
      '</ul>' +
      '</div>' +
      '<div class="overlayFoot">' +
      (adsReady ? '<button class="big" id="adBtn">' +
        L('monetize.watchAdAgain', null, '看 广 告 · 再 来 一 局') + '</button>' : '') +
      (canBuy
        ? '<button class="big buy" id="buyBtn"' + (price ? '' : ' disabled') + '>' +
          Monetize.title() + (price
            ? ' · ' + price
            : L('monetize.priceLoading', null, ' · 正在获取价格…')) + '</button>'
        : '') +
      '<div class="menuAux">' +
      (canBuy ? '<button class="ghost" id="restoreBtn">' +
        L('monetize.restore', null, '恢复购买') + '</button>' : '') +
      '<button class="ghost" id="laterBtn">' + (reason === 'menu'
        ? L('monetize.back', null, '返 回')
        : L('monetize.later', null, '稍后再说')) + '</button>' +
      '</div>' +
      (canBuy ? '' : '<div class="payNote">' + (adsReady
        ? L('monetize.noIapAds', null, '当前地区不支持内购，观看广告即可继续。')
        : L('monetize.noIapFree', null, '当前地区不支持内购，可以免费继续玩。')) + '</div>') +
      '</div></div>';

    var adBtn = document.getElementById('adBtn');
    if (adBtn && adsReady) {
      adBtn.onclick = function () {
        Sfx.ui();
        this.disabled = true;
        this.textContent = L('monetize.adPlaying', null, '广 告 播 放 中 …');
        Monetize.watchAd(function (ok) {
          if (ok) {
            if (self._quotaIntent === 'coop') self._resumeQuotaIntent();
            else self.startMatch();
            return;
          }
          // 拉不到广告：fail-open 放行，别把人卡在付费墙里
          if (MONETIZE.FAIL_OPEN) {
            UI.toast(L('monetize.adNotReady', null, '广告没准备好，这局算你的'));
            if (self._quotaIntent === 'coop') self._resumeQuotaIntent();
            else self._enterRun();
          } else {
            UI.toast(L('monetize.adUnavailable', null, '广告暂时不可用，稍后再试'));
            self.showPaywall(reason);
          }
        });
      };
    }

    var buyBtn = document.getElementById('buyBtn');
    if (buyBtn) {
      buyBtn.onclick = function () {
        Sfx.ui();
        var b = this;
        b.disabled = true;
        b.textContent = L('monetize.connecting', null, '连 接 App Store …');
        Monetize.buy(function (ok, why) {
          if (ok) {
            UI.toast(L('monetize.unlockedToast',
              { name: Monetize.title() }, '已解锁 · {name}'));
            if (self._quotaIntent === 'coop') self._resumeQuotaIntent();
            else self.startMatch();
            return;
          }
          b.disabled = false;
          b.textContent = Monetize.title() + (Monetize.price() ? ' · ' + Monetize.price() : '');
          if (why === 'pending') {
            UI.toast(L('monetize.pending', null, '等待批准 · 批准后自动解锁'));
          } else if (why === 'cancelled') {
            UI.toast(L('monetize.cancelled', null, '已取消'));
          } else UI.toast(L('monetize.buyFailed', null, '没买成，稍后再试'));
        });
      };
    }

    var restoreBtn = document.getElementById('restoreBtn');
    if (restoreBtn) {
      restoreBtn.onclick = function () {
        Sfx.ui();
        var b = this;
        b.disabled = true;
        Monetize.restore(function (ok, why) {
          b.disabled = false;
          if (ok) {
            UI.toast(L('monetize.restoredToast',
              { name: Monetize.title() }, '已恢复 · {name}'));
            if (self._quotaIntent === 'coop') self._resumeQuotaIntent();
            else self.startMatch();
          } else {
            UI.toast(why === 'empty'
              ? L('monetize.restoreEmpty', null, '这个 Apple ID 没有购买记录')
              : L('monetize.restoreFailed', null, '恢复失败，稍后再试'));
          }
        });
      };
    }

    document.getElementById('laterBtn').onclick = function () {
      Sfx.ui();
      if (self._quotaIntent === 'coop') {
        self._quotaIntent = null;
        self._quotaCallback = null;
      }
      self.showMenu();
    };
  },

  showMenu: function () {
    if (window.Coop) Coop.hideHud();
    var s = Game.save;
    var r = rankFor(s.rank), nr = nextRank(s.rank);
    var pct = nr ? Math.round((s.rank - r.min) / (nr.min - r.min) * 100) : 100;
    var rankHtml =
      '<details class="friendlyDetails menuDetails"><summary>' +
      L('friendly.progress', null, '我的守夜记录') + '</summary>' +
      '<div class="rankCard" style="--rc:' + r.color + '">' +
      '<div class="rn">' + r.name + '</div>' +
      '<div class="rp"><i style="width:' + pct + '%"></i></div>' +
      '<div class="rs">' + L('ui.rankPoints', { n: s.rank }, '{n} 分') +
      (nr
        ? L('ui.rankToNext', { name: nr.name, n: nr.min - s.rank }, ' · 距 {name} 还差 {n}')
        : L('ui.rankTop', null, ' · 已至顶')) + '</div>' +
      '<div class="rst">' +
      L('ui.menuStats', {
        unlocked: unlockedUnitIds(s.rank).length,
        total: UNIT_ORDER.length,
        matches: s.matches,
        wins: s.bestWins,
        rounds: CONFIG.TOTAL_ROUNDS,
      }, '已结识动物 {unlocked}/{total} · 共 {matches} 大局 · 最好成绩 {wins}/{rounds}') +
      '</div>' +
      '</div></details>';
    this.overlayMode = 'menu';
    this.el.overlay.style.display = 'flex';
    this.el.overlay.innerHTML =
      '<div class="overlayBox menu">' +
      menuArtHtml() + '<div class="menuHero"><div class="menuIntro">' +
      '<h1>' + L('ui.menuTitle', null, '僵尸在敲门') + '</h1>' +
      '<p class="sub">' +
      L('ui.menuSub', null, '和动物伙伴一起，守住温暖的小屋。') + '</p>' +
      this.quotaHtml() +
      (Monetize.active && !Monetize.unlocked && (Monetize.adsAvailable || Monetize.iapAvailable)
        ? '<div class="menuPurchase"><button class="ghost" id="unlockBtn">∞ ' +
          L('monetize.unlimited', null, '无限畅玩') + '</button></div>' : '') +
      '<div class="menuModes">' +
      (Game.canResume() ? '<button class="big" id="continueRunBtn">' + L('experience.continueRun') + '</button>' : '') +
      '<button class="big modeChoice" id="playBtn"><strong>' +
      L('ui.soloMode', null, '单人守夜') + '</strong><span>' + Monetize.startLabel() + '</span></button>' +
      (window.Coop ? '<button class="big modeChoice coopChoice" id="coopBtn"><strong>' +
        L('ui.coopMode', null, '2–6 人合作') + '</strong><span>' + Coop.menuLabel() + '</span></button>' : '') +
      '</div></div></div>' +
      '<div class="menuAux">' +
      '<button type="button" class="ghost" id="helpBtn" aria-expanded="false" aria-controls="menuHelp">' +
      '<span class="menuIcon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.2"/></svg></span>' +
      L('ui.howToPlay', null, '怎么玩') + '</button>' +
      '<button type="button" class="ghost" id="settingsBtn"><span class="menuIcon">' + relicArtHtml('gears') + '</span>' + L('friendly.settings', null, '设置') + '</button>' +
      '<button class="ghost" id="muteBtn2">' +
      L('ui.soundToggle', {
        state: s.muted ? L('ui.off', null, '关') : L('ui.on', null, '开'),
      }, '音效：{state}') + '</button>' +
      '</div><div class="menuFold">' + rankHtml +
      '<details class="friendlyDetails rules" id="menuHelp">' +
      '<summary>' + L('ui.howToPlay', null, '怎么玩') + '</summary>' +
      '<ul>' +
      '<li>' + L('ui.rule1', null,
        '中间那道裂隙会不停吐丧尸，<b>两边分到的数量完全一样</b>。') + '</li>' +
      '<li>' + L('ui.rule2', null,
        '动物伙伴各有所长：熊和大象挡路，豪猪反伤，狐喷火，鳗与蜂群连锁攻击。') + '</li>' +
      '<li>' + L('ui.rule3', null,
        '右边是和你同阶段的异步镜像；裂隙狂潮会持续升级，家园先倒下的一方输掉。') + '</li>' +
      '<li>' + L('ui.rule4', null,
        '每大局开始前从已结识动物中选择 <b>6 只出战</b>；100、500、1000 分及 1500–3500 分每 500 分各解锁 2 种。') + '</li>' +
      '<li>' + L('ui.rule5', null,
        '一大局 12 小局，每局之间三选一拿遗物，和动物伙伴一起守住家园。') + '</li>' +
      '<li>' + L('ui.rule6', null,
        '战场分阶段开放：<b>首局 3×3、第二局 6×6、第三局起 9×9</b>，列从裂隙向外开放。') + '</li>' +
      '</ul>' +
      '<button class="ghost" id="tutorialBtn">' +
      L('ui.replayTutorial', null, '重玩实战教学') + '</button>' +
      '</details></div>' +
      '</div>';
    var self = this;
    document.getElementById('settingsBtn').onclick = function () { self.showSettings('menu'); };
    var helpEl = document.getElementById('menuHelp');
    var helpBtn = document.getElementById('helpBtn');
    helpBtn.onclick = function () {
      helpEl.open = !helpEl.open;
      if (helpEl.open) helpEl.scrollIntoView({ block: 'nearest' });
    };
    helpEl.addEventListener('toggle', function () {
      helpBtn.setAttribute('aria-expanded', helpEl.open ? 'true' : 'false');
    });
    if (document.getElementById('continueRunBtn')) document.getElementById('continueRunBtn').onclick = function () { Sfx.resume(); Game.resumeRun(); };
    document.getElementById('playBtn').onclick = function () {
      Sfx.ui();
      self.startMatch();
    };
    if (document.getElementById('unlockBtn')) {
      document.getElementById('unlockBtn').onclick = function () {
        Sfx.ui();
        self.showPaywall('menu');
      };
    }
    if (document.getElementById('coopBtn')) {
      document.getElementById('coopBtn').onclick = function () { Sfx.ui(); Coop.open(); };
    }
    document.getElementById('muteBtn2').onclick = function () {
      Game.save.muted = !Game.save.muted;
      Sfx.setEnabled(!Game.save.muted);
      Game.persist();
      this.textContent = L('ui.soundToggle', {
        state: Game.save.muted ? L('ui.off', null, '关') : L('ui.on', null, '开'),
      }, '音效：{state}');
    };
    document.getElementById('tutorialBtn').onclick = function () {
      Sfx.ui();
      Game.save.tutorialDone = false;
      Game.tutorialRequested = true;
      Game.persist();
      self.startMatch();
    };
  },

  showResult: function () {
    this.hideToast();
    var res = Game.result, b = Game.battle;
    var won = res.winner === 'p';
    var title = won
      ? L('ui.resultWin', null, '守住了！')
      : L('ui.resultLose', null, '下次再加把劲');
    var cls = won ? 'win' : 'lose';
    this.overlayMode = 'result';
    this.el.overlay.style.display = 'flex';
    this.el.overlay.innerHTML =
      '<div class="overlayBox result friendlyResult ' + cls + '">' +
      sceneHeroHtml(title, '<div class="roundReward">' + L('friendly.coinsReward', { n: res.income }, '本局奖励 +{n} 金币') + '</div>') +
      '<div class="tlWrap">' +
      '<div class="tlRow"><span>' + L('ui.you', null, '你') + ' · ' + L(won ? 'experience.guardRole' : 'experience.fallenRole') +
      '</span><div class="tl"><i style="width:' + Math.round(res.playerHpFrac * 100) +
      '%;--c:#e8b45e"></i></div><b>' + Math.round(res.playerHpFrac * 100) + '%</b></div>' +
      '<div class="tlRow g"><span>' + L('ui.mirror', null, '镜像') + ' · ' + L(won ? 'experience.fallenRole' : 'experience.guardRole') +
      '</span><div class="tl"><i style="width:' + Math.round(res.ghostHpFrac * 100) +
      '%;--c:#5fc4d8"></i></div><b>' + Math.round(res.ghostHpFrac * 100) + '%</b></div>' +
      '</div>' +
      '<div class="tlNote">' +
      L('experience.roundDuration', { time: Math.max(res.playerTime, res.ghostTime).toFixed(1) }) + ' · ' +
      L('ui.resultNote', null, '小怪会逐渐变强，试试不同的伙伴搭配。') + '</div>' +
      '<div class="resStat"><span>' +
      L('ui.homeLeft', { n: Math.round(res.playerHpFrac * 100) }, '家园剩余 {n}%') + '</span>' +
      '<span>' + L('ui.kills', { n: res.playerKills }, '击杀 {n}') + '</span>' +
      '<span class="inc">' +
      L('ui.income', { n: Game.result.income }, '收入 +{n}') + '</span></div>' +
      '<p class="resultAdvice">' + (res.playerFirstHit
        ? L('experience.firstBreach', { lane: res.playerFirstHit.lane + 1, time: res.playerFirstHit.time.toFixed(1) })
        : L('experience.noBreach')) + '</p>' +
      '<button class="big" id="nextBtn">' + L('ui.continue', null, '继续守夜') + '</button>' +
      '</div>';
    var self = this;
    document.getElementById('nextBtn').onclick = function () {
      Sfx.ui();
      self.showReward();
    };
  },

  showReward: function () {
    Game.state = 'reward'; Game.checkpoint();
    this.hideToast();
    var picks = Game.reward || [];
    this.overlayMode = 'reward';
    this.el.overlay.style.display = 'flex';
    var html = '<div class="overlayBox reward friendlyReward">' +
      sceneHeroHtml(L('ui.rewardTitle', null, '选一件守家道具'), '<p class="sub">' +
        L('ui.rewardSub', null, '选一个帮助伙伴的道具，效果持续到这一大局结束。') + '</p>') +
      '<div class="relicRow">';
    for (var i = 0; i < picks.length; i++) {
      var r = picks[i];
      html += '<button class="relic" data-id="' + r.id + '">' +
        '<div class="ri">' + relicArtHtml(r.id) + '</div>' +
        '<div class="rn2">' + r.name + '</div>' +
        '<div class="rt">' + r.text + '</div></button>';
    }
    html += '</div><button class="ghost" id="skipBtn">' +
      coinTextHtml(L('ui.rewardSkip', { n: 45 }, '都不要，换 ◍{n}')) + '</button></div>';
    this.el.overlay.innerHTML = html;
    var self = this;
    var btns = this.el.overlay.querySelectorAll('.relic');
    for (var j = 0; j < btns.length; j++) {
      btns[j].onclick = function () {
        Sfx.ui(); self.closeOverlay();
        Game.takeRelic(this.dataset.id);
      };
    }
    document.getElementById('skipBtn').onclick = function () {
      Sfx.ui(); self.closeOverlay();
      Game.skipRelic();
    };
  },

  showMatchEnd: function (wins, delta, before, after) {
    this.hideToast();
    var r0 = rankFor(before), r1 = rankFor(after);
    var promoted = r1.name !== r0.name && after > before;
    var nr = nextRank(after);
    var pct = nr ? Math.round((after - r1.min) / (nr.min - r1.min) * 100) : 100;
    var beforeUnits = unlockedUnitIds(before);
    var afterUnits = unlockedUnitIds(after);
    var newUnits = afterUnits.filter(function (id) { return beforeUnits.indexOf(id) < 0; });
    var unlockLine = newUnits.length
      ? '<div class="newUnlocks">' +
        L('ui.newUnlocks', {
          names: newUnits.map(function (id) { return UNITS[id].name; })
            .join(L('ui.listSep', null, '、')),
        }, '结识新伙伴 · {names}') + '</div>'
      : '';
    this.overlayMode = 'matchEnd';
    this.el.overlay.style.display = 'flex';
    this.el.overlay.innerHTML =
      '<div class="overlayBox matchEnd friendlyResult">' +
      sceneHeroHtml(L('ui.matchEndTitle', null, '今晚的守夜记录')) +
      '<div class="winCount"><b>' + wins + '</b><span>' +
      L('ui.winsOfTotal', { total: CONFIG.TOTAL_ROUNDS }, '/ {total} 胜') + '</span></div>' +
      '<div class="delta ' + (delta >= 0 ? 'up' : 'down') + '">' +
      L('ui.rankDelta', { n: (delta >= 0 ? '+' : '') + delta }, '排位分 {n}') + '</div>' +
      (promoted ? '<div class="promoted">' +
        L('ui.promoted', { name: r1.name }, '晋升 · {name}') + '</div>' : '') +
      unlockLine +
      '<div class="rankCard" style="--rc:' + r1.color + '">' +
      '<div class="rn">' + r1.name + '</div>' +
      '<div class="rp"><i style="width:' + pct + '%"></i></div>' +
      '<div class="rs">' + L('ui.rankPoints', { n: after }, '{n} 分') +
      (nr
        ? L('ui.rankToNext', { name: nr.name, n: nr.min - after }, ' · 距 {name} 还差 {n}')
        : L('ui.rankTop', null, ' · 已至顶')) + '</div>' +
      '</div>' +
      '<button class="big" id="againBtn">' + Monetize.againLabel() + '</button>' +
      this.quotaHtml() +
      '<button class="ghost" id="menuBtn">' +
      L('ui.backToMenu', null, '返回首页') + '</button>' +
      '</div>';
    var self = this;
    document.getElementById('againBtn').onclick = function () {
      Sfx.ui(); self.startMatch();
    };
    document.getElementById('menuBtn').onclick = function () {
      Sfx.ui(); self.closeOverlay(); self.showMenu();
    };
    if (delta > 0) Sfx.win();
  },
};
