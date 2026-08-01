/* ============================================================
 * 随机工具：加权抽选、正态分布（拟真人机器人战绩用）
 * ============================================================ */
window.Rand = (function () {
  'use strict';

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // 加权抽取：items = [{weight, ...}]
  function weighted(items) {
    const total = items.reduce((s, it) => s + it.weight, 0);
    let r = Math.random() * total;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  // 近似正态（Box-Muller），clamp 到 [min,max]，round
  function normal(mean, sigma, min, max) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    let val = mean + z * sigma;
    val = Math.max(min, Math.min(max, val));
    return Math.round(val);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pad(n, len) {
    let s = String(n);
    while (s.length < (len || 2)) s = '0' + s;
    return s;
  }

  return { pick, weighted, normal, shuffle, pad };
})();
