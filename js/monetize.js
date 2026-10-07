'use strict';

/* ---------------------------------------------------------------
 * 变现门禁：每日免费额度 → 一次性买断解锁无限局
 *
 * 三端仍是同一份代码，门禁默认「不生效」：只有宿主注入 monetize 消息桥时才打开。
 *   - iOS 壳：StoreKit 2（购买 / 恢复 / 权益），只做内购、不接广告，见 ios/Sources/Monetize.swift
 *   - 小工具 / H5：接了自己的广告 SDK 后，在状态里报 adsAvailable: true，
 *     付费墙就会自动多出「看广告续玩」那条路，额度逻辑是共用的
 *   - 没有任何桥（桌面调试、H5 演示、Node 无头测试）：不限局，与从前完全一致
 *
 * 两件事分开存：
 *   - 「是否已买断」以原生 StoreKit 的 currentEntitlements 为准，本地只缓存镜像
 *   - 「今天玩了几局」记在本地存档，跨天自动清零
 *
 * 消息协议（JS → 宿主）
 *   { id, cmd: 'sync' }      取权益 / 地区 / 商品 / 广告是否可用
 *   { id, cmd: 'buy' }       购买「无限畅玩」（一次性解锁，永久不限局）
 *   { id, cmd: 'restore' }   恢复购买
 *   { id, cmd: 'ad' }        播放一条激励视频
 * 消息协议（宿主 → JS）
 *   { id?, type: 'state', unlocked, region, iapAvailable, adsAvailable, product }
 *   { id,  type: 'ad',    ok, reason }
 * ------------------------------------------------------------- */

var MONETIZE_KEY = 'yeshou.monetize.v1';

function pad2(n) { return (n < 10 ? '0' : '') + n; }

var Monetize = {
  active: false,        // 桥在 = 门禁在
  ready: false,         // 是否已收到过宿主状态
  unlocked: false,      // 已买断「无限畅玩」
  region: '',           // 店面地区（三字母）
  iapAvailable: false,
  adsAvailable: false,
  product: null,        // { id, title, price }，价格一律用商店给的，不写死
  quota: { day: '', used: 0, credits: 0, unlocked: false },
  onChange: null,       // 界面刷新钩子

  _seq: 0,
  _waiting: {},
  _adBusy: false,
  _forgave: false,      // fail-open 只提示一次

  /* ---------------- 启动 ---------------- */
  init: function () {
    this.quota = this._read();
    this.unlocked = this.quota.unlocked;
    this.active = !!this._bridge();
    if (!this.active) return;
    this._send('sync');
  },

  _bridge: function () {
    var w = window.webkit;
    if (w && w.messageHandlers && w.messageHandlers.monetize) {
      return function (msg) { w.messageHandlers.monetize.postMessage(msg); };
    }
    if (window.ZKMonetize && typeof window.ZKMonetize.postMessage === 'function') {
      return function (msg) { window.ZKMonetize.postMessage(msg); };
    }
    return null;
  },

  /* ---------------- 每日额度 ---------------- */
  _today: function () {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  },

  _read: function () {
    var q = { day: this._today(), used: 0, credits: 0, unlocked: false };
    try {
      var raw = localStorage.getItem(MONETIZE_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        q.unlocked = !!(o && o.unlocked);
        if (o && o.day === q.day) {
          q.used = Math.max(0, o.used | 0);
          q.credits = Math.max(0, o.credits | 0);
        }
      }
    } catch (e) { /* 隐私模式等，忽略 */ }
    return q;
  },

  _write: function () {
    try {
      localStorage.setItem(MONETIZE_KEY, JSON.stringify({
        day: this.quota.day, used: this.quota.used,
        credits: this.quota.credits, unlocked: this.unlocked,
      }));
    } catch (e) { }
  },

  /** 跨天把免费额度还回去；广告攒的额度不清，那是看完视频换来的。 */
  _roll: function () {
    var t = this._today();
    if (this.quota.day === t) return;
    this.quota.day = t;
    this.quota.used = 0;
    this._write();
  },

  info: function () {
    this._roll();
    var q = this.quota;
    var freeLeft = Math.max(0, MONETIZE.DAILY_FREE - q.used);
    return {
      active: this.active,
      unlocked: this.unlocked,
      limit: MONETIZE.DAILY_FREE,
      freeUsed: Math.min(q.used, MONETIZE.DAILY_FREE),
      freeLeft: freeLeft,
      credits: q.credits,
      left: this.unlocked ? -1 : freeLeft + q.credits,   // -1 = 不限
    };
  },

  /** 扣一局：先吃免费额度，再吃广告额度。 */
  spend: function () {
    var q = this.quota;
    if (q.used < MONETIZE.DAILY_FREE) q.used++;
    else if (q.credits > 0) q.credits--;
    else return false;
    this._write();
    this._notify();
    return true;
  },

  /** 死局兜底：既买不了也没有广告可看（国内无内购 / 商店连不上）时放行。 */
  _deadEnd: function () {
    return !this.adsAvailable && !this.iapAvailable;
  },

  _forgive: function (message) {
    if (this._forgave) return;
    this._forgave = true;
    if (message && window.UI) UI.toast(message);
  },

  /**
   * 门禁入口：允许就 go()，不允许就弹付费墙。
   * 额度是本地的、同步可判；权益有本地镜像兜底，所以这里不需要等宿主回话。
   */
  requestMatch: function (go) {
    if (!this.active || this.unlocked) { go(); return true; }
    if (this.info().left > 0) { this.spend(); go(); return true; }
    if (MONETIZE.FAIL_OPEN && this._deadEnd()) {
      this._forgive(this.adsAvailable
        ? L('monetize.forgiveAd', null, '广告暂时没准备好，这局先算你的')
        : L('monetize.forgiveRegion', null, '当前地区不支持内购，这局先算你的'));
      go();
      return true;
    }
    UI.showPaywall('quota');
    return false;
  },

  /* ---------------- 内购 ---------------- */
  buy: function (cb) {
    var self = this;
    if (!this.active || !this.iapAvailable) { cb(false, 'unavailable'); return; }
    this._send('buy', null, function (msg) {
      if (msg && msg.unlocked) { self._apply(msg); cb(true, 'ok'); }
      else cb(false, (msg && msg.reason) || 'error');
    });
  },

  restore: function (cb) {
    var self = this;
    if (!this.active) { cb(false, 'unavailable'); return; }
    this._send('restore', null, function (msg) {
      self._apply(msg || {});
      cb(!!self.unlocked, self.unlocked ? 'ok' : 'empty');
    }, 120000);
  },

  /* ---------------- 激励视频 ---------------- */
  watchAd: function (cb) {
    var self = this;
    if (!this.active || !this.adsAvailable) { cb(false, 'unavailable'); return; }
    if (this._adBusy) return;
    this._adBusy = true;
    Sfx.setEnabled(false);
    this._send('ad', null, function (msg) {
      self._adBusy = false;
      Sfx.setEnabled(!Game.save.muted);
      if (msg && msg.ok) {
        self.quota.credits += MONETIZE.AD_REWARD;
        self._write();
        self._notify();
        cb(true, 'ok');
      } else {
        cb(false, (msg && msg.reason) || 'error');
      }
    }, 300000);
  },

  /* ---------------- 宿主消息 ---------------- */
  _send: function (cmd, payload, cb, timeout) {
    var bridge = this._bridge();
    if (!bridge) { if (cb) cb(null); return; }
    var self = this;
    var id = ++this._seq;
    var msg = { id: id, cmd: cmd };
    if (payload) for (var k in payload) msg[k] = payload[k];
    if (cb) {
      this._waiting[id] = cb;
      if (timeout) setTimeout(function () {
        var pending = self._waiting[id];
        if (pending) { delete self._waiting[id]; pending(null); }
      }, timeout);
    }
    try {
      bridge(msg);
    } catch (e) {
      if (cb) { delete this._waiting[id]; cb(null); }
    }
  },

  /** 宿主回话入口：`window.Monetize._recv({...})`。 */
  _recv: function (msg) {
    if (!msg) return;
    if (msg.type === 'state') this._apply(msg);
    var id = msg.id;
    if (id && this._waiting[id]) {
      var cb = this._waiting[id];
      delete this._waiting[id];
      cb(msg);
    }
  },

  _apply: function (s) {
    if (s.unlocked !== undefined) this.unlocked = !!s.unlocked;
    if (s.region !== undefined) this.region = s.region || '';
    if (s.adsAvailable !== undefined) this.adsAvailable = !!s.adsAvailable;
    if (s.product !== undefined) this.product = s.product || null;
    this.iapAvailable = s.iapAvailable !== undefined ? !!s.iapAvailable : true;
    // 国内店面即使商店说能买也不放内购入口：版号原因，那边只走广告
    if (this.region && MONETIZE.IAP_BLOCKED_REGIONS.indexOf(this.region) >= 0) this.iapAvailable = false;
    this.ready = true;
    this._write();
    this._notify();
  },

  _notify: function () { if (this.onChange) this.onChange(); },

  /* ---------------- 文案 ---------------- */
  /** 主菜单 / 结算页那一行额度提示；门禁没生效时返回空串。 */
  line: function () {
    if (!this.active) return '';
    if (this.unlocked) return L('monetize.lineUnlocked', null, '已解锁 · 永久不限局');
    var i = this.info();
    if (i.freeLeft > 0) {
      return L('monetize.lineFreeLeft',
        { n: i.freeLeft, total: i.limit }, '今日剩余 {n} / {total} 局免费');
    }
    if (i.credits > 0) {
      return L('monetize.lineCredits', { n: i.credits }, '今日免费已用完 · 广告额度 {n} 局');
    }
    return this.adsAvailable
      ? L('monetize.lineAds', null, '今日免费已用完 · 看广告可继续')
      : L('monetize.lineUnlock', null, '今日免费已用完 · 解锁后不限局');
  },

  /** 额度用完时，按钮上的动词要从「开始」换成「看广告」或「去解锁」。 */
  needsUnlock: function () {
    return this.active && !this.unlocked && this.info().left <= 0;
  },

  startLabel: function () {
    if (!this.needsUnlock()) return L('monetize.start', null, '开 始 一 局');
    return this.adsAvailable
      ? L('monetize.startAd', null, '看 广 告 · 开 一 局')
      : L('monetize.startUnlock', null, '解 锁 · 开 一 局');
  },

  againLabel: function () {
    if (!this.needsUnlock()) return L('monetize.again', null, '再 来 一 局');
    return this.adsAvailable
      ? L('monetize.againAd', null, '看 广 告 · 再 来 一 局')
      : L('monetize.againUnlock', null, '解 锁 · 再 来 一 局');
  },

  /** 商品名也用商店给的，本地只兜底 —— 改名字不用动代码。 */
  title: function () {
    return this.product && this.product.title
      ? this.product.title
      : L('monetize.defaultTitle', null, '永久不限局');
  },

  price: function () { return this.product ? this.product.price : ''; },
};
