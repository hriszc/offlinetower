/* ============================================================
 * 阿斗与赵云 · 武将版 —— 数据配置
 * 依据《对标小游戏-阿斗与赵云-设计方案.md》v1.2 的数值框架
 * 用户 2026-08 设计变更：无职业克制 / 无升星(改局内按攻击次数升级) /
 * 无回血(英雄不承伤) / 主动技能自动释放 / 无被动(改局间道具) / 武器 8 合 1 精炼(P1)
 * ============================================================ */
window.CFG = (function () {
  'use strict';

  /* ---------- 10 武将池 ---------- */
  // cls: 枪/骑/刀/弓/谋    quality: SSR / SR
  // POW武将 = ATK × FRQ × RGE × 目标数（方案 §5.4）
  // 英雄是进攻单位不承伤（无 HP）；无职业克制、无被动；主动技能满怒自动释放
  const GENERALS = [
    { id: 'zhugeliang', name: '诸葛亮', chars: ['诸', '葛', '亮'], cls: '谋', quality: 'SSR',
      atk: 14, frq: 1.0, rge: 5, targets: 3,
      skill: { name: '卧龙雷', desc: '全屏随机落雷6道,每道150%攻击伤害', type: 'bolt' } },
    { id: 'caocao', name: '曹操', chars: ['曹', '操'], cls: '谋', quality: 'SSR',
      atk: 12, frq: 0.9, rge: 4, targets: 1,
      skill: { name: '魏武挥鞭', desc: '全体+30%攻击与+20%攻速,持续5秒', type: 'buff' } },
    { id: 'guanyu', name: '关羽', chars: ['关', '羽'], cls: '骑', quality: 'SSR',
      atk: 16, frq: 1.1, rge: 2, targets: 2,
      skill: { name: '青龙斩', desc: '冲向全场最高血量敌人,400%单体伤害', type: 'single' } },
    { id: 'zhaoyun', name: '赵云', chars: ['赵', '云'], cls: '枪', quality: 'SSR',
      atk: 13, frq: 1.3, rge: 3, targets: 3,
      skill: { name: '七进七出', desc: '直线突进贯穿,对沿途敌人300%伤害并击退', type: 'dash' } },
    { id: 'lubu', name: '吕布', chars: ['吕', '布'], cls: '骑', quality: 'SSR',
      atk: 18, frq: 1.0, rge: 2, targets: 3,
      skill: { name: '天下无双', desc: '横扫大范围敌人,350%伤害', type: 'aoe' } },
    { id: 'liubei', name: '刘备', chars: ['刘', '备'], cls: '谋', quality: 'SR',
      atk: 9, frq: 0.8, rge: 4, targets: 1,
      skill: { name: '仁德', desc: '全体+20%攻击,持续5秒', type: 'buff' } },
    { id: 'zhangfei', name: '张飞', chars: ['张', '飞'], cls: '刀', quality: 'SR',
      atk: 15, frq: 1.0, rge: 1, targets: 1,
      skill: { name: '大喝', desc: '眩晕周围敌人2秒并造成180%伤害', type: 'stun' } },
    { id: 'zhouyu', name: '周瑜', chars: ['周', '瑜'], cls: '弓', quality: 'SR',
      atk: 12, frq: 1.2, rge: 5, targets: 2,
      skill: { name: '火烧赤壁', desc: '全屏持续火焰4秒,每秒80%伤害', type: 'dot' } },
    { id: 'simayi', name: '司马懿', chars: ['司', '马', '懿'], cls: '谋', quality: 'SR',
      atk: 11, frq: 0.9, rge: 4, targets: 1,
      skill: { name: '冢虎', desc: '全场敌人减速40%并受伤+25%,持续4秒', type: 'debuff' } },
    { id: 'sunquan', name: '孙权', chars: ['孙', '权'], cls: '谋', quality: 'SR',
      atk: 8, frq: 0.8, rge: 4, targets: 1,
      skill: { name: '坐断东南', desc: '立即获得150馒头并全队+10%攻击,持续6秒', type: 'economy' } }
  ];

  const CLS_NAMES = { 枪: '枪将', 骑: '骑将', 刀: '刀将', 弓: '弓将', 谋: '谋将' };

  /* ---------- 字牌（由武将姓名派生） ---------- */
  // 抽字牌：只从「未集齐字牌」的武将池中抽取，保证拼字可及性（方案 §5.4 掉率框架）
  function tilePool(owned) {
    // owned: { 武将名: [已拥有的字] }
    const pool = [];
    for (const g of GENERALS) {
      const have = (owned[g.name] || []).slice();
      const missing = g.chars.filter(c => have.indexOf(c) < 0);
      if (missing.length === 0) continue;
      let w = (g.quality === 'SSR') ? 1 : 1.5;
      if (g.chars.length === 3) w *= 0.55;          // 三字武将掉落加权更低
      if (have.length > 0) w *= 5;                 // 已有部分字 → 缺字权重显著提高,让第 2 将单局内可达（核心循环）
      for (const c of missing) pool.push({ char: c, general: g, weight: w });
    }
    return pool;
  }

  /* ---------- 怪物 ---------- */
  const MONSTER_TYPES = {
    骑: { label: '骑', hp: 1.0,  spd: 1.35, atk: 1 },   // 血少速快
    刀: { label: '刀', hp: 1.15, spd: 1.0,  atk: 1 },
    枪: { label: '枪', hp: 1.4,  spd: 0.8,  atk: 1 },   // 血多速慢
    弓: { label: '弓', hp: 0.8,  spd: 0.75, atk: 1, atkSpd: 0.8 } // 到达后攻速快
  };
  const MONSTER_TYPES_KEYS = ['骑', '刀', '枪', '弓'];
  const BASE_MON_HP = 19;      // 第 1 波基础血量（去羁绊后微调 -14% 以维持难度曲线）
  const WAVE_HP_GROW = 1.08;   // 怪物血量成长
  const WAVE_ATK_GROW = 1.05;  // 怪物攻击频率成长（到达阿斗后的攻击间隔缩短）

  /* ---------- 波次 ---------- */
  const MAX_WAVE = 30;
  function waveConfig(n) {
    const count = Math.min(2 + n, 28);
    const hpMul = Math.pow(WAVE_HP_GROW, n - 1);
    const atkMul = Math.pow(WAVE_ATK_GROW, n - 1);
    const elite = (n % 5 === 0) && (n % 10 !== 0);
    const boss = (n % 10 === 0);
    let countMul = 1, hpMul2 = 1, bossCount = 0;
    if (elite) { countMul = 1.5; hpMul2 = 2; }
    if (boss) { bossCount = 1; countMul = 0.6; hpMul2 = 1; }
    return { n, count: Math.round(count * countMul), hpMul: hpMul * hpMul2, atkMul, elite, boss, bossCount };
  }

  /* ---------- 经济（方案 §5.4） ---------- */
  const ECONOMY = {
    startMantou: 20,        // 开局馒头
    firstGameMantou: 20,    // 首局额外馒头（开局 20 + 20 = 40）
    killMantou: 1,          // 杀怪 1 馒头/只
    adouHitMantou: 10,      // 阿斗掉血 10 馒头/滴（卖血经济）
    bossMantou: 10,         // 击杀 BOSS
    waveClearMantou: 8,     // 波次奖励
    recruitBase: 10,        // 抽卡成本 10/12/14…递增
    recruitStep: 2,
    summonCost: 20,         // 拼字召唤消耗
    fragExchange: 10        // 10 碎片兑换一张字牌
  };
  const TILE_RATE = 0.6;    // 抽卡出字牌 60% / 碎片 40%

  /* ---------- 武将局内成长（按攻击次数升级） ---------- */
  // 每次普攻命中 +1 攻击次数；达到阈值升级，每级 +8% 攻击/攻速
  const LV_GROW = 0.08;
  function attackNeed(level) { return 15 * level; }   // L1→15 次,L2→30 次…

  /* ---------- 军衔（11 级） ---------- */
  const RANKS = [
    { name: '军士', need: 0 },
    { name: '校尉', need: 100 },
    { name: '少将', need: 250 },
    { name: '中将', need: 450 },
    { name: '上将', need: 700 },
    { name: '大将', need: 1000 },
    { name: '元帅', need: 1400 },
    { name: '诸侯', need: 1900 },
    { name: '霸主', need: 2500 },
    { name: '君主', need: 3300 },
    { name: '皇帝', need: 4300 }
  ];
  const SCORE_WIN = 30, SCORE_LOSE = 5;

  /* ---------- 地图（每日轮换,3 张） ---------- */
  const MAPS = [
    { id: 'plain', name: '巨鹿平原', desc: '敌分五路来犯,布防均匀', rows: [0, 1, 2, 3, 4], countMul: 1, spdMul: 1 },
    { id: 'narrow', name: '云梦泽狭道', desc: '敌集中中路,数量更多', rows: [1, 2, 3], countMul: 1.25, spdMul: 1 },
    { id: 'many', name: '虎牢关多路', desc: '敌散五路,但行动迟缓', rows: [0, 1, 2, 3, 4], countMul: 0.9, spdMul: 0.82 }
  ];
  function mapOfDay(days) { return MAPS[days % MAPS.length]; }

  /* ---------- 机器人（方案 §5.4 军衔分层战绩分布） ---------- */
  const BOT_LAYERS = [
    { ranks: [0, 1],            mean: 6,  sigma: 1.5, label: '初出茅庐' },
    { ranks: [2, 3, 4],         mean: 12, sigma: 2,   label: '小有所成' },
    { ranks: [5, 6, 7],         mean: 19, sigma: 2.5, label: '沙场老将' },
    { ranks: [8, 9, 10],        mean: 26, sigma: 2,   label: '一代枭雄' }
  ];
  const NICKNAMES = [
    '长坂坡的萤火虫', '隔壁老王', '馒头管够', '熬夜守塔人', '武陵人', '桃园三结义', '喂饱阿斗',
    '虎牢关站神', '江左萌新', '丞相别急', '一袋米抗几波', '划水大师', '赤壁烤鱼', '神机妙算',
    '带刀护卫', '躺赢选手', '无中生有', '三分天下归晋', '关公面前耍刀', '草船借箭中'
  ];
  const BOT_AVATARS = ['赵', '云', '张', '飞', '关', '羽', '吕', '布', '诸', '葛', '曹', '操', '周', '瑜', '孙', '权', '刘', '备', '司', '马', '懿', '典', '许', '黄', '魏'];

  /* ---------- 开局军备（三选一） ---------- */
  const ITEMS = [
    { id: 'shield', name: '铁壁', desc: '阿斗血量上限 +2(升至5滴),开局馒头 -5' },
    { id: 'food', name: '粮草', desc: '开局额外 +40 馒头' },
    { id: 'levy', name: '强征', desc: '本局前 3 次抽卡成本减半' }
  ];

  /* ---------- 局间道具（每局结束 3 选 1,最多 6 个、可替换；原武将被动能力挪入） ---------- */
  const ITEM_BOOSTS = [
    { id: 'atk',    name: '苍狼印', desc: '全队攻击 +15%' },
    { id: 'frq',    name: '疾风印', desc: '全队攻速 +12%' },
    { id: 'cd',     name: '玄龟印', desc: '技能冷却 -15%（原卧龙被动）' },
    { id: 'crit',   name: '赤兔印', desc: '暴击率 +10%' },
    { id: 'elite',  name: '破军印', desc: '对精英/BOSS 伤害 +20%（原谋将被动）' },
    { id: 'fury',   name: '龙胆印', desc: '怒气获取 +25%（原赵云被动）' },
    { id: 'mantou', name: '粮草袋', desc: '开局馒头 +50' },
    { id: 'adou',   name: '虎符',   desc: '阿斗血量上限 +1' }
  ];
  const ITEM_BOOST_MAX = 6;

  /* ---------- 三选一强化（每 3 波） ---------- */
  const BOOSTS = [
    { id: 'atk', title: '全军鼓舞', desc: '所有上阵武将攻击 +15%' },
    { id: 'frq', title: '疾风骤雨', desc: '所有上阵武将攻速 +12%' },
    { id: 'adou', title: '加固营帐', desc: '阿斗血量上限 +1' },
    { id: 'mantou', title: '运粮队', desc: '立即获得 80 馒头' },
    { id: 'level', title: '论功行赏', desc: '随机 1 名上阵武将直接升 1 级' }
  ];

  return {
    GENERALS, CLS_NAMES,
    tilePool, MONSTER_TYPES, MONSTER_TYPES_KEYS,
    BASE_MON_HP, WAVE_HP_GROW, WAVE_ATK_GROW,
    MAX_WAVE, waveConfig,
    ECONOMY, TILE_RATE,
    LV_GROW, attackNeed,
    RANKS, SCORE_WIN, SCORE_LOSE,
    MAPS, mapOfDay,
    BOT_LAYERS, NICKNAMES, BOT_AVATARS,
    ITEMS, ITEM_BOOSTS, ITEM_BOOST_MAX,
    BOOSTS
  };
})();
