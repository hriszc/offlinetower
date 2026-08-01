/* ============================================================
 * 存档（localStorage）+ 军衔 + 每日重置留存
 * 方案 §2.3.8：地图每日轮换 / 胜率每日重置 / 积分保留
 * ============================================================ */
window.Save = (function () {
  'use strict';
  const CFG = window.CFG;
  const KEY = 'adou-zhaoyun-save-v1';

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function defaultSave() {
    return {
      score: 0,                 // 军衔积分（累计保留）
      coins: 0,                 // 蜜獾币（局外,保留）
      generals: {},             // { 武将名: { star, level } }
      firstGameDone: false,     // 首局引导
      totalGames: 0,
      totalWins: 0,
      today: { date: todayStr(), wins: 0, loses: 0, ads: 0 }
    };
  }

  let data = null;
  function load() {
    if (data) return data;
    try {
      const raw = localStorage.getItem(KEY);
      data = raw ? Object.assign(defaultSave(), JSON.parse(raw)) : defaultSave();
    } catch (e) {
      data = defaultSave();
    }
    rollDay();
    return data;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式等 */ }
  }
  // 每日重置：胜率清零、广告次数清零、地图轮换
  function rollDay() {
    const t = todayStr();
    if (data.today.date !== t) {
      data.today = { date: t, wins: 0, loses: 0, ads: 0 };
      save();
    }
  }
  function dayIndex() {
    const t0 = new Date(2026, 0, 1);
    const now = new Date();
    return Math.floor((now - t0) / 86400000);
  }
  function mapOfToday() { return CFG.mapOfDay(dayIndex()); }

  /* ---------- 军衔 ---------- */
  function rankIndex() {
    let idx = 0;
    for (let i = 0; i < CFG.RANKS.length; i++) {
      if (data.score >= CFG.RANKS[i].need) idx = i;
    }
    return idx;
  }
  function rank() { return CFG.RANKS[rankIndex()]; }
  function rankProgress() {
    const idx = rankIndex();
    const cur = CFG.RANKS[idx].need;
    const next = idx + 1 < CFG.RANKS.length ? CFG.RANKS[idx + 1].need : cur;
    return { idx, cur, next, pct: next > cur ? Math.min(100, Math.round((data.score - cur) / (next - cur) * 100)) : 100 };
  }
  function addScore(v) {
    data.score += v;
    save();
  }

  /* ---------- 武将收集 ---------- */
  function getGeneral(name) {
    const g = data.generals[name];
    if (!g) { data.generals[name] = { star: 1, level: 1 }; save(); return data.generals[name]; }
    return g;
  }
  function addStar(name, n) {
    const g = getGeneral(name);
    g.star = Math.min(5, (g.star || 1) + (n || 1));
    save();
  }

  /* ---------- 对局记录 ---------- */
  function recordGame(win) {
    data.totalGames++;
    if (win) { data.totalWins++; data.today.wins++; } else { data.today.loses++; }
    save();
  }
  function winRate() {
    const t = data.today;
    const n = t.wins + t.loses;
    return n ? Math.round(t.wins / n * 100) : 0;
  }

  /* ---------- 体力与广告（纯 IAA 唯一广告点） ---------- */
  const STAMINA_MAX = 30, ADS_PER_DAY = 5, STAMINA_PER_AD = 10;
  function stamina() {
    // 体力随时间恢复：每 5 分钟 1 点
    const last = data.lastStaminaAt || Date.now();
    const gained = Math.floor((Date.now() - last) / (5 * 60 * 1000));
    if (gained > 0) {
      data.stamina = Math.min(STAMINA_MAX, (data.stamina || STAMINA_MAX) + gained);
      data.lastStaminaAt = Date.now();
      save();
    }
    return data.stamina === undefined ? STAMINA_MAX : data.stamina;
  }
  function spendStamina() {
    data.stamina = stamina() - 1;
    data.lastStaminaAt = Date.now();
    save();
  }
  function adsLeft() { return ADS_PER_DAY - data.today.ads; }
  function watchAd() {
    if (data.today.ads >= ADS_PER_DAY) return false;
    data.today.ads++;
    data.stamina = Math.min(STAMINA_MAX, stamina() + STAMINA_PER_AD);
    data.lastStaminaAt = Date.now();
    save();
    return true;
  }

  return {
    load, save, rollDay, dayIndex, mapOfToday,
    rankIndex, rank, rankProgress, addScore,
    getGeneral, addStar,
    recordGame, winRate,
    stamina, spendStamina, adsLeft, watchAd,
    STAMINA_MAX, ADS_PER_DAY
  };
})();
