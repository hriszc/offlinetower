/* ============================================================
 * 拟真人机器人：按军衔分层生成战绩 + 真人风格昵称/头像（本地生成）
 * 方案 §4.2 / §5.4：军士 5-9 波 → 皇帝 23-29 波,叠加失误/超常发挥
 * ============================================================ */
window.Bot = (function () {
  'use strict';
  const Rand = window.Rand;
  const CFG = window.CFG;

  // 玩家军衔 index → 对手军衔 index（同段为主,偶有高/低一段,制造"差一点就赢"）
  function oppRankIndex(playerRank) {
    const r = Math.random();
    if (r < 0.45) return playerRank;                       // 同段
    if (r < 0.80) return Math.min(10, playerRank + 1);     // 高一段（挑战）
    if (playerRank > 0) return playerRank - 1;             // 低一段（稳赢局）
    return playerRank;
  }

  function layerFor(rankIdx) {
    return CFG.BOT_LAYERS.find(l => l.ranks.includes(rankIdx)) || CFG.BOT_LAYERS[0];
  }

  // 生成对手战绩：坚持波数（含 8% 失误 -2 波 / 5% 超常 +2 波）
  function genWaves(rankIdx) {
    const layer = layerFor(rankIdx);
    let w = Rand.normal(layer.mean, layer.sigma, 3, CFG.MAX_WAVE);
    const r = Math.random();
    if (r < 0.08) w = Math.max(3, w - 2);        // 明显失误
    else if (r < 0.13) w = Math.min(CFG.MAX_WAVE, w + 2); // 超常发挥
    return w;
  }

  // 用时模拟：校准到真实局节奏（headless 实测约 10-13 秒/波），每波 10-16 秒
  function genTime(waves) {
    return Math.round(waves * (10 + Math.random() * 6));
  }

  function genLineup() {
    const pool = CFG.GENERALS.map(g => g.name);
    const n = 3 + Math.floor(Math.random() * 3);   // 3-5 名
    return Rand.shuffle(pool).slice(0, n);
  }

  function makeOpponent(playerRankIdx) {
    const rankIdx = oppRankIndex(playerRankIdx);
    const rank = CFG.RANKS[rankIdx];
    const waves = genWaves(rankIdx);
    const timeSec = genTime(waves);
    const lineup = genLineup();
    return {
      nick: Rand.pick(CFG.NICKNAMES),
      avatar: Rand.pick(CFG.BOT_AVATARS),
      rankIdx, rankName: rank.name,
      waves, timeSec,                        // 坚持波数与用时
      adouLeft: 1 + Math.floor(Math.random() * 3), // 剩余阿斗血量 1-3
      lineup,
      tag: layerFor(rankIdx).label
    };
  }

  return { makeOpponent, oppRankIndex, genWaves };
})();
