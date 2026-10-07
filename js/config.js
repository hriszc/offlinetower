'use strict';

/* ---------------------------------------------------------------
 * 僵尸在敲门  —  平衡数据 / 全局常量
 * 本文件是纯数据 + 纯函数，可被 Node 直接加载做无头平衡测试。
 * ------------------------------------------------------------- */

var CONFIG = {
  W: 1280,
  H: 720,

  TOP_H: 64,          // 顶部 HUD 高度
  BOTTOM_Y: 720,      // 战场下沿：商店搬到右侧后，主画面吃满整个屏幕高度

  LANES: [96, 160, 224, 288, 352, 416, 480, 544, 608], // 9 条横向通路
  COOP_MAX_PLAYERS: 6,
  COOP_PLAYERS_PER_SIDE: 3,
  COOP_LANES_PER_PLAYER: 3,
  P_COLS: [190, 232, 274, 316, 358, 400, 442, 484, 526], // 玩家 9 列，索引越大越靠近裂隙
  G_COLS: [1090, 1048, 1006, 964, 922, 880, 838, 796, 754], // 镜像 9 列

  GRID_COL_PITCH: 42,
  GRID_LANE_PITCH: 64,
  GRID_TOP: 64,
  GRID_BOTTOM: 640,
  GRID_CELL_W: 38,
  GRID_CELL_H: 58,
  LEGACY_RANGE_CELL: 86,
  LEGACY_LANE_PITCH: 115,
  COMBAT_REACH_MULTIPLIER: 2, // 直线攻击距离与圆形范围半径的试调倍率
  UNIT_DRAW_SCALE: 0.53,
  ZOMBIE_DRAW_SCALE: 0.74,
  ZOMBIE_LANE_JITTER: 26,
  CELL_HW: 43,        // 动物绘制的原始设计尺寸；碰撞和网格使用 GRID_CELL_*
  RIFT_X: 640,
  RIFT_HW: 62,
  RIFT_TOP: 74,
  RIFT_BOTTOM: 640,

  HOME_P_X: 152,      // 玩家家门口的 x（丧尸走到这里开始砸家）
  HOME_G_X: 1128,
  HOME_HP: 100,

  TOTAL_ROUNDS: 12,
  SELL_RATE: 0.6,

  START_COINS: 95,
  FLARE_CHARGES: 3,
  REPAIR_CHARGES: 2,

  RANK_BUDGET_STEP: 1000,
  RANK_BUDGET_GROWTH: 1.10,
  RANK_BUDGET_CAP: 2.50,
  RANK_ETERNAL_STEP: 5000,
  RANK_POWER_PER_TIER: 0.06,
  RANK_DECISION_PER_TIER: 0.03,

  ZOMBIE_CAP: 190,    // 场上丧尸上限，保护性能
};

/* ------------------------- 变现 ------------------------- */
/* 每日免费额度 → 一次性买断解锁无限局。
   门禁只在宿主注入 monetize 消息桥时才生效（见 js/monetize.js）：
   iOS 壳有桥，网页版 / H5 没有，所以三端仍是同一份代码，没有桥的那端不限局。
   目前 iOS 壳只做内购、不接广告；哪天小工具那边接了自己的广告 SDK，
   在状态里报一个 adsAvailable: true，付费墙会自动多出「看广告续玩」那条路。 */
var MONETIZE = {
  DAILY_FREE: 3,                        // 每天免费三大局
  AD_REWARD: 1,                         // 接广告时：看完一条激励视频 +1 大局
  PRODUCT_ID: 'com.zequnhuang.zombieknock.unlimited', // App Store Connect 里的非消耗型项目 ID
  FAIL_OPEN: true,                      // 买不了（国内店面 / 商店连不上）时放行，避免出现死局
  IAP_BLOCKED_REGIONS: ['CN', 'CHN'],   // 国内店面不出现内购入口（版号原因）
};

/* ------------------------- 文案表（zh 原文 / en 译文并排） -------------------------
   本表是全部玩家可见字串的唯一真源：上面的 UNITS / FORMS / ZOMBIES / RELICS / RANKS
   只保留“结构”，字串一律用 L('点分路径', null, 兜底) 从这里取。

   形状必须是 TEXT.zh.* / TEXT.en.*；查表由 js/i18n.js 的 L() 负责，
   语言在加载期由 navigator.language 定好，所以下面的 L() 取到的就是常量字符串，
   Node 无头加载（tools/balance.js）也照样能跑。

   新增字段必须同时补 zh 与 en 两份，否则英文端会回落到 zh 原文。 */
var TEXT = {
  /* --- 中文原文 --- */
  zh: {
    /* 防御单位 */
    unit: {
      barricade: { name: '守门熊', short: '熊', desc: '皮糙肉厚，能同时堵住三条路。不会主动攻击。' },
      spike: { name: '棘背豪猪', short: '猪', desc: '丧尸啃咬时会被尖刺反伤。放在队伍前方最合适。' },
      turret: { name: '坚果浣熊', short: '浣', desc: '用弹弹果核攻击射程内最近的丧尸，可跨路支援。' },
      lamp: { name: '提灯萤火虫', short: '萤', desc: '光圈内的丧尸会减速 35% 并持续受伤。' },
      flame: { name: '赤焰狐', short: '狐', desc: '向前喷吐火焰，灼烧喷幅内的丧尸。' },
      tesla: { name: '雷纹鳗', short: '鳗', desc: '释放电弧，在附近丧尸之间连锁弹跳。' },
      sniper: { name: '掠影鹰', short: '鹰', desc: '远距离精准重击，慢但能提前解决威胁。' },
      venom: { name: '毒牙蛇', short: '蛇', desc: '喷出毒雾，命中后持续腐蚀丧尸。' },
      frost: { name: '雪耳兔', short: '兔', desc: '释放寒气，持续减速并冻伤附近丧尸。' },
      quake: { name: '震地猩猩', short: '猩', desc: '重击地面，周期性震晕范围内的丧尸。' },
      railgun: { name: '冲锋犀', short: '犀', desc: '以高速冲击远处目标，并震出范围伤害。' },
      totem: { name: '血吻蝙蝠', short: '蝠', desc: '吸取附近丧尸的生命，为受伤最重的伙伴疗伤。' },
      wolf: { name: '追痕狼', short: '狼', desc: '追踪远处目标连续扑击，暴击时伤害更高。' },
      owl: { name: '夜巡猫头鹰', short: '鸮', desc: '视野极远，擅长远距离精准暴击。' },
      boar: { name: '獠牙野猪', short: '獠', desc: '猛撞地面震退并短暂震晕周围丧尸。' },
      chameleon: { name: '雾行变色龙', short: '蜥', desc: '喷出宽幅毒雾，持续腐蚀一整片丧尸。' },
      elephant: { name: '踏地巨象', short: '象', desc: '血量极高，能挡住三条路，并震晕身边丧尸。' },
      frog: { name: '沼泽树蛙', short: '蛙', desc: '舌弹射中目标后，会在落点造成范围伤害。' },
      bee: { name: '雷针蜂群', short: '蜂', desc: '蜂群在多个目标间高速连锁蜇击。' },
      turtle: { name: '磐甲海龟', short: '龟', desc: '厚甲耐打，周围寒气会持续减慢丧尸。' },
      tiger: { name: '裂夜虎', short: '虎', desc: '扑击凶狠，长距离攻击常能一击暴击。' },
      phoenix: { name: '余烬凤凰', short: '凰', desc: '灼烧附近丧尸，同时为受伤伙伴恢复生命。' },
    },

    /* 改造形态：name / role / desc / effect2 / effect3 */
    form: {
      neutral: { name: '标准型', role: '标准', desc: '没有额外改造的基础形态。', effect2: '', effect3: '' },
      animal: {
        fierce: { name: '凶猛', role: '攻击', desc: '练出更强的扑击、蜇刺或吐息。', effect2: '伤害 ×1.25', effect3: '伤害 ×1.50' },
        swift: { name: '迅捷', role: '攻速', desc: '动作更轻快，可以更频繁地出手。', effect2: '攻速 ×1.25', effect3: '攻速 ×1.45' },
        sturdy: { name: '坚韧', role: '耐久', desc: '体魄更结实，能承受更多伤害。', effect2: '生命上限 ×1.25', effect3: '生命上限 ×1.45' },
      },
      barricade: {
        ironwall: { name: '磐石熊皮', role: '耐久', desc: '厚实的熊皮与肌肉更耐打。', effect2: '生命上限 ×1.28', effect3: '生命上限 ×1.45' },
        thornwall: { name: '荆背反击', role: '反伤', desc: '背毛竖成尖刺，啃咬它的丧尸也会流血。', effect2: '生命 ×1.08 · 受击反伤 8/s', effect3: '生命 ×1.18 · 受击反伤 14/s' },
        gatewall: { name: '护巢怒吼', role: '控制', desc: '倒下时发出最后一声怒吼，拖慢身后的尸群。', effect2: '生命 ×1.16 · 倒下减速 35%/1.2s', effect3: '生命 ×1.30 · 倒下减速 55%/1.6s' },
      },
      spike: {
        bleedteeth: { name: '裂齿反咬', role: '爆发', desc: '豪猪绷紧肌肉，让尖刺更狠地扎入啃咬者。', effect2: '生命 ×0.90 · 反伤 ×1.45', effect3: '生命 ×0.95 · 反伤 ×1.70' },
        hookspikes: { name: '倒钩棘刺', role: '控制', desc: '倒钩棘刺扎进腐肉，让丧尸短暂僵直。', effect2: '反伤 ×0.90 · 18% 眩晕 0.5s', effect3: '反伤 ×1.00 · 28% 眩晕 0.7s' },
        phosphorspikes: { name: '磷焰棘刺', role: '持续', desc: '发光分泌物附着在尖刺上，伤口持续灼痛。', effect2: '附加灼烧 3/s，持续 1.5s', effect3: '反伤 ×1.10 · 灼烧 5/s，持续 2.0s' },
      },
      turret: {
        armorpiercing: { name: '裂果重弹', role: '爆发', desc: '更重的坚果弹稍慢一些，却能砸穿厚甲。', effect2: '伤害 ×1.45 · 攻速 ×0.85', effect3: '伤害 ×1.65 · 攻速 ×0.82' },
        rapidbow: { name: '连珠果核', role: '持续', desc: '浣熊双爪交替弹射，果核更密但单发更轻。', effect2: '伤害 ×0.82 · 攻速 ×1.32', effect3: '伤害 ×0.88 · 攻速 ×1.45' },
        trackerbow: { name: '追踪果核', role: '远程', desc: '瞄准后弹出的果核会从远处命中要害。', effect2: '射程 +2.0格 · 18% 暴击 ×1.8', effect3: '射程 +3.0格 · 28% 暴击 ×1.8' },
      },
      lamp: {
        widebeam: { name: '萤火群舞', role: '范围', desc: '更多萤火虫围绕伙伴飞舞，照亮更广但伤害稍弱。', effect2: '半径 +1.6格 · 减速 +10% · 伤害 ×0.80', effect3: '半径 +2.6格 · 减速 +16% · 伤害 ×0.85' },
        sodiumflare: { name: '金焰萤火', role: '灼烧', desc: '更炽热的光焰烤痛腐肉，但照亮的范围变窄。', effect2: '伤害 ×1.55 · 减速 ×0.70 · 半径 -0.8格', effect3: '伤害 ×1.80 · 减速 ×0.75 · 半径 -1.0格' },
        stroboscope: { name: '闪烁脉冲', role: '控制', desc: '萤火忽明忽暗，丧尸会在强光闪过时停住。', effect2: '18% 眩晕 0.35s · 伤害 ×1.05', effect3: '28% 眩晕 0.50s · 伤害 ×1.15' },
      },
      flame: {
        fanfire: { name: '扇焰吐息', role: '清场', desc: '张口喷出扇形火焰，以单点威力换来更宽覆盖。', effect2: '喷幅 ×1.50 · 射程 +0.4格 · 伤害 ×0.78', effect3: '喷幅 ×1.80 · 射程 +0.6格 · 伤害 ×0.82' },
        needlefire: { name: '炽焰尖啸', role: '爆发', desc: '压缩火焰后向正前方吐出灼热火柱。', effect2: '伤害 ×1.50 · 喷幅 ×0.70 · 射程 +0.2格', effect3: '伤害 ×1.75 · 喷幅 ×0.65 · 射程 +0.4格' },
        emberfire: { name: '不灭余火', role: '持续', desc: '黏着腐肉的长焰久久不熄，持续灼烧目标。', effect2: '攻速 ×1.30 · 灼烧 3/s，持续 1.2s', effect3: '攻速 ×1.45 · 灼烧 5/s，持续 1.6s' },
      },
      tesla: {
        topology: { name: '群游雷弧', role: '群攻', desc: '鳗群引出交错电流，电弧会跳向更远的目标。', effect2: '连锁 +2 · 伤害 ×0.78', effect3: '连锁 +3 · 伤害 ×0.82' },
        lightningspear: { name: '雷牙贯击', role: '单体', desc: '把电荷压进一记雷击，重创最前方的目标。', effect2: '伤害 ×1.50 · 连锁 -1', effect3: '伤害 ×1.75 · 连锁 -1' },
        pulsecoil: { name: '震鳞脉冲', role: '范围', desc: '鳗背鳞片同步放电，以较轻电击罩住整群丧尸。', effect2: '攻速 ×1.30 · 半径 +0.8格 · 伤害 ×0.85', effect3: '攻速 ×1.45 · 半径 +1.2格 · 伤害 ×0.90' },
      },
      sniper: {
        hollowpoint: { name: '裂甲喙击', role: '爆发', desc: '鹰喙精准啄中甲缝，造成更重的伤害。', effect2: '伤害 ×1.35 · 攻速 ×1.15', effect3: '伤害 ×1.60 · 攻速 ×1.30' },
        longscope: { name: '夜视鹰眼', role: '射程', desc: '敏锐视线穿过黑暗，在更远处锁定目标。', effect2: '半径 +1.8格 · 伤害 ×0.90', effect3: '半径 +3.0格 · 伤害 ×1.00' },
        execution: { name: '俯冲处决', role: '暴击', desc: '鹰从高处俯冲，偶尔以利爪打出致命一击。', effect2: '暴击 18% · 暴击 ×1.80', effect3: '暴击 28% · 暴击 ×1.80' },
      },
      venom: {
        corrosive: { name: '浓毒蛇息', role: '持续', desc: '蛇毒变得更浓，伤口会持续冒出腐蚀烟。', effect2: '腐蚀 +2/s · 持续 +0.5s', effect3: '腐蚀 +3.5/s · 持续 +1.0s' },
        widemist: { name: '盘雾吐息', role: '清场', desc: '蛇身盘绕喷吐毒雾，宽幅覆盖一整条通道。', effect2: '喷幅 ×1.50 · 伤害 ×0.80', effect3: '喷幅 ×1.80 · 伤害 ×0.85' },
        virulent: { name: '猛毒撕咬', role: '爆发', desc: '蛇毒集中在短促撕咬中，第一口就足够致命。', effect2: '伤害 ×1.30 · 攻速 ×1.10', effect3: '伤害 ×1.50 · 攻速 ×1.20' },
      },
      frost: {
        deepchill: { name: '雪域天性', role: '控制', desc: '兔子释放更刺骨的寒气，拖慢丧尸脚步。', effect2: '减速 +10%', effect3: '减速 +15%' },
        widefrost: { name: '霜环', role: '范围', desc: '冷气向四周铺开，牺牲单点威力换更大控制面。', effect2: '寒域 +1.0格 · 伤害 ×0.80', effect3: '寒域 +1.6格 · 伤害 ×0.85' },
        icebind: { name: '冰缚', role: '单体', desc: '霜气聚成一根尖刺，持续咬住最靠近的目标。', effect2: '伤害 ×1.45 · 减速 +4%', effect3: '伤害 ×1.70 · 减速 +7%' },
      },
      quake: {
        thunderclap: { name: '怒猿长啸', role: '控制', desc: '猩猩发出震耳怒吼，震波让丧尸短暂停步。', effect2: '击晕 +0.20s · 伤害 ×1.10', effect3: '击晕 +0.35s · 伤害 ×1.25' },
        seismic: { name: '重踏裂地', role: '范围', desc: '全力踩踏地面，冲击波传得更远。', effect2: '震域 +1.0格 · 伤害 ×0.80', effect3: '震域 +1.8格 · 伤害 ×0.85' },
        quickdrum: { name: '狂猿连踏', role: '攻速', desc: '猩猩连续踏地，震击频率明显变快。', effect2: '攻速 ×1.35 · 伤害 ×0.82', effect3: '攻速 ×1.55 · 伤害 ×0.88' },
      },
      railgun: {
        capacitor: { name: '雷角蓄力', role: '爆发', desc: '犀牛角聚集电光后猛然冲撞，爆发更强。', effect2: '伤害 ×1.40 · 攻速 ×1.15', effect3: '伤害 ×1.70 · 攻速 ×1.30' },
        widecoil: { name: '裂地冲击', role: '范围', desc: '冲撞扬起的震荡波会从落点向两侧扩散。', effect2: '溅射 ×1.45 · 伤害 ×0.75', effect3: '溅射 ×1.80 · 伤害 ×0.80' },
        penetrator: { name: '破阵长角', role: '射程', desc: '蓄力后猛冲更远距离，击穿尸群防线。', effect2: '半径 +2.4格 · 伤害 ×1.10', effect3: '半径 +3.8格 · 伤害 ×1.20' },
      },
      totem: {
        marrow: { name: '吸血反哺', role: '治疗', desc: '蝙蝠吸取丧尸生命，再把力量反哺给伙伴。', effect2: '治疗 ×1.35 · 伤害 ×0.80', effect3: '治疗 ×1.60 · 伤害 ×0.85' },
        broadpact: { name: '群翼庇护', role: '范围', desc: '蝙蝠张翼环护更多伙伴，让疗愈覆盖更广。', effect2: '光环 +1.0格 · 治疗 ×0.90', effect3: '光环 +1.6格 · 治疗 ×0.95' },
        quickpact: { name: '疾翼回声', role: '节奏', desc: '蝙蝠振翼加快，吸血与治疗都更加频繁。', effect2: '攻速 ×1.35 · 治疗 ×1.10', effect3: '攻速 ×1.55 · 治疗 ×1.20' },
      },
    },

    /* 丧尸 */
    zombie: {
      bug: { name: '小虫子' },
      walker: { name: '蹒跚者' },
      runner: { name: '奔逃者' },
      screamer: { name: '尖啸者' },
      brute: { name: '肿汉' },
      tank: { name: '铁皮尸' },
    },

    /* 遗物 */
    relic: {
      foundation: { name: '家园加固', text: '家园血量上限 +35' },
      gears: { name: '黄铜齿轮', text: '所有动物伙伴攻击速度 +18%' },
      steel: { name: '淬火钢', text: '所有动物伙伴血量 +28%' },
      powder: { name: '黑火药', text: '所有动物伙伴伤害 +22%' },
      satchel: { name: '拾荒背囊', text: '每小局额外收入 +30' },
      lore: { name: '尸学笔记', text: '丧尸移动速度 -12%' },
      spares: { name: '备用零件', text: '家园血量上限 +25，每小局满血开局' },
      doublebow: { name: '双管弹弹果核', text: '浣熊每次额外射出一枚果核' },
      coldlight: { name: '冷光萤火', text: '萤火虫减速效果 +15%，半径 +0.7格' },
      fuse: { name: '感应引信', text: '豪猪反伤 +65%' },
      overload: { name: '电弧过载', text: '雷纹鳗可多连锁 1 个目标' },
      ration: { name: '荧光口粮', text: '每小局额外收入 +15' },
    },

    /* 段位 */
    rank: {
      r0: { name: '拾荒者' },
      r1: { name: '木屋守夜人' },
      r2: { name: '铁闸守卫' },
      r3: { name: '加固工头' },
      r4: { name: '堡垒指挥官' },
      r5: { name: '永夜要塞' },
    },

    /* 单位范围名（原来散在 UNITS[*].rangeName 上） */
    rangeName: {
      frost: '寒域',
      quake: '震域',
      totem: '光环',
      lamp: '范围',
      fallback: '半径',
    },

    /* 画布上的零散标签（render.js 用） */
    canvas: {
      placeHere: '放置区',
      allLanesRound3: '第3回合开放7–9路',
      lanesEarlier: '第{n}回合开放4–6路',
    },

    /* 静态页面元素（index.html 里 data-i18n 标记的那些）。
       这些字串直接写在 HTML 里，启动时由 I18N.applyStatic() 替换。 */
    /* 单位详情面板的数值后缀（unitCombatText / unitRangeLabel / cellsLabel） */
    combat: {
      cellUnit: '格',
      range: '射程',
      radius: '半径',
      radiusRange: '范围',
      spray: '喷幅',
      splash: '溅射',
      chain: '连锁',
      rate: '攻速',
      slow: '减速',
      burn: '腐蚀',
      heal: '治疗',
      stun: '击晕',
      crit: '暴击',
      contact: '接触反伤',
    },

    /* 卡片上的极短数值词（中文与全称相同，占位保持两张表结构一致）。 */
    combatShort: {
      rate: '攻速',
      burn: '腐蚀',
      contact: '接触反伤',
    },

    static: {
      title: '僵尸在敲门',
      yourHome: '你的家园',
      mirrorName: '对方家园',
      roundLabel: '第 1 / 12 小局',
      coins: '金币',
      buildHint: '点伙伴，再点空格 · 也可以拖动放置',
      startDefense: '开始防守',
      flareName: '照明弹',
      flareHint: '点按钮再点战场',
      battleTip: '和动物伙伴一起守住家园',
      repairName: '修家',
      repairHint: '立刻回 16 点',
      skipTutorial: '跳过教学',
    },

    ui: {
      menuTitle: '僵尸在敲门',
      menuSub: '和动物伙伴一起，守住今晚的家园',
      soloMode: '开始守夜', coopMode: '合作守夜',
      menuStats: '已结识动物 {unlocked}/{total} · 共 {matches} 大局 · 最好成绩 {wins}/{rounds}',
      howToPlay: '怎么玩',
      rule1: '小怪会从中间的裂隙出现，<b>两边面对的数量完全一样</b>。',
      rule2: '动物伙伴各有所长：熊和大象挡路，豪猪反伤，狐喷火，鳗与蜂群连锁攻击。',
      rule3: '右边是同阶段玩家的防守阵容。小怪会逐渐变强，家园先失守的一方输掉这小局。',
      rule4: '每大局开始前从已结识动物中选择 <b>6 只出战</b>；100、500、1000 分及 1500–3500 分每 500 分各解锁 2 种。',
      rule5: '一大局有 12 小局，每局结束后选一件道具，帮助伙伴继续守家。',
      rule6: '战场分三阶段开放：<b>首局 3×3、第二局 6×6、第三局起 9×9</b>，最后三路在第三局开放。',
      replayTutorial: '重玩实战教学',
      soundToggle: '音效：{state}',
      on: '开',
      off: '关',
      loadoutTitle: '选择伙伴',
      loadoutSub: '选 <b>6 只伙伴</b>一起守夜；这一大局都使用这套阵容。',
      loadoutCount: '已选 {n} / 6',
      loadoutConfirm: '确认出战',
      loadoutFull: '最多只能带 6 种',
      unlockAtRank: '排位{n}解锁',
      unlockAtRankToast: '排位 {n} 分解锁',
      rankPoints: '{n} 分',
      rankToNext: ' · 距 {name} 还差 {n}',
      rankTop: ' · 已至顶',
      firstUpgrade: '首次升级 · 三选一',
      formTitle: '选一个升级',
      formSub: '让 {name} 更强一点 · 升到 2 级需要 {cost} 金币',
      formCost: '选择 · {n} 金币',
      formNote: '选择后不可在本小局更改',
      formCancel: '暂不升级',
      maxLevel: '已满级',
      pickOneCost: '三选一 ◍{n}',
      upgradeCost: '升级 ◍{n}',
      sellCost: '回收 ◍{n}',
      rewardTitle: '选一件守家道具',
      rewardSub: '选一个帮助伙伴的道具，效果持续到这一大局结束。',
      rewardSkip: '都不要，换 ◍{n}',
      newUnlocks: '结识新伙伴 · {names}',
      listSep: '、',
      resultWin: '守住了！',
      resultLose: '下次再加把劲',
      resultNote: '小怪会逐渐变强，试试不同的伙伴搭配。',
      you: '你',
      mirror: '镜像',
      homeLeft: '家园剩余 {n}%',
      kills: '击杀 {n}',
      income: '收入 +{n}',
      continue: '继续守夜',
      matchEndTitle: '今晚的守夜记录',
      winsOfTotal: '/ {total} 胜',
      rankDelta: '排位分 {n}',
      promoted: '晋升 · {name}',
      backToMenu: '返回首页',
    },
    friendly: {
      settings: '设置', largeText: '大字模式', largeTextHint: '放大界面文字',
      reducedMotion: '减少动态效果', reducedMotionHint: '减少闪烁与画面震动',
      systemMotion: '系统已开启减少动态效果', volume: '音效音量', soundEnabled: '音效', settingsBack: '返回',
      settingsNote: '调整立即保存', coinsReward: '本局奖励 +{n} 金币',
      progress: '我的守夜记录', details: '查看详细数值',
      team: '我的出战伙伴', emptySlot: '待选择',
      roles: { block: '挡路', retaliate: '反伤', ranged: '远程', slow: '减速',
        fire: '喷火', chain: '连锁', heal: '治疗', area: '范围' },
    },
    hud: {
      preparing: '准备中',
      round: '第 {n} / {total} 小局',
      pressureSuffix: ' · 压力+{n}%',
      fundsSuffix: ' · 资金+{n}%',
      eternalSuffix: ' · 永续{n}',
      mirrorTag: '镜像 · {tag} · 战力 ',
      startDefense: '开始防守',
      startRound: '开始第 {n} 小局',
      surge: '狂潮 ×{n}',
      lanes3: '已开放 3 路 · 第 2 小局开放 4–6 路',
      lanes6: '已开放 6 路 · 第 3 小局开放 7–9 路',
      lanesAll: '9 路全部开放',
      hintPlaced: '点空格放置 · 再点伙伴取消',
      hintDrag: '点伙伴，再点空格 · 也可以拖动放置',
      even: '势均力敌',
      lead: '你领先 {n}%',
      behind: '你落后 {n}%',
      matchKicker: '守夜人匹配 · 1V1',
      matchFound: '匹配成功 · 对手已锁定',
      matchSearching: '正在寻找其他玩家…',
      matchStatusFound: '实力与小局进度匹配完成',
      matchStatusSearching: '正在比对排位、进度与防守强度',
      avatarYou: '夜',
      avatarRival: '影',
      you: '你',
      yourHome: '你的家园',
      scanning: '扫描中…',
      otherPlayer: '其他玩家 · {tag}',
      watcherChannel: '守夜人频道',
      hpStat: '血量 {n}',
      dmgStat: ' · 伤害 {n}',
      whisper1: '别回头。',
      whisper2: '墙后面有人在呼吸。',
      whisper3: '脚步声只落下过一只脚。',
      whisper4: '灯在抖。它已经看见你了。',
      whisper5: '裂隙另一侧，有人在数你的名字。',
      whisper6: '刚才那里站着一个。现在没有了。',
    },
    tutorial: {
      step1: '点一下这张卡',
      step2: '点这块发光的空地',
      step3: '点“开始防守”',
      cardPicked: '选好了 · 把动物伙伴放到发光的空地',
      placed: '动物伙伴就位 · 点“开始防守”',
      skipped: '已跳过教学 · 现在可以自由操作',
    },
    experience: {
      pause: '暂停', paused: '已暂停', resume: '继续守夜',
      saveMenu: '保存并返回菜单', continueRun: '继续上次守夜',
      resumeNote: '战斗中离开，下次从本小局备战继续。',
      checkpointNote: '布防、金币与遗物会保留。',
      fullHealth: '家园已满血，无需急修',
      flareEmpty: '这里没有敌人，换个落点或再点按钮取消',
      undo: '撤销', undoFailed: '位置被占用或金币不足，无法撤销',
      repairRole: '急修', guardRole: '守住', fallenRole: '失守',
      firstBreach: '第{lane}路在{time}秒首次被突破，优先补阻挡和输出覆盖。',
      roundDuration: '本局战斗 {time} 秒 · 血量对比',
      noBreach: '家园未被突破，继续补齐新开放的通道。',
      tutorialBear: '先放守门熊，挡住三条路',
      tutorialSpike: '再放豪猪，让啃咬的敌人受反伤',
      tutorialTurret: '最后放浣熊，跨路输出保护阻挡',
      tutorialStart: '阵型齐了，点开始防守',
      tutorialPick: '请先选择手指指向的动物',
      tutorialRequired: '教学需要守门熊、豪猪和浣熊，请保留这三位伙伴',
      tutorialPlace: '请放在发光地块，错误位置不会扣金币',
      battleFocus: '战场：方向键移动，回车放置或选中，Esc取消',
      cellStatus: '第{lane}路，第{col}列：{name}',
      emptyCell: '空地', lockedCell: '未开放',
      formInstruction: '选中动物可查看作用，再点空地放置',
    },
    meta: {
      defaultName: '{prefix}的手艺人',
      plotLocked: '这块地还没清理出来',
      laneLocked: '这条路还没打通 · 第 {n} 小局开启',
      cellOccupied: '这格已经有东西了',
      notInLoadout: '这只动物伙伴不在本局队伍里',
      notEnoughCoins: '金币不够',
      notEnoughCoinsUpgrade: '金币不够升级',
      alreadyMaxed: '已经是满级了',
      formMissing: '这个形态不存在',
      tutorialWrongCell: '把动物伙伴放到发光的那格地面',
      sold: '回收 +{n}',
      flareMiss: '炸了个空',
    },
    bot: {
      name: '{prefix}的{role} · {n}',
      unknown: '未知守夜人',
      defaultTag: '夜巡',
      tag: {
        turtle: '龟缩流',
        firepower: '火力流',
        flame: '火焰流',
        electric: '电场流',
        generalist: '杂货铺',
      },
    },
    monetize: {
      lineUnlocked: '已解锁 · 永久不限局',
      lineFreeLeft: '今日剩余 {n} / {total} 局免费',
      lineCredits: '今日免费已用完 · 广告额度 {n} 局',
      lineAds: '今日免费已用完 · 看广告可继续',
      lineUnlock: '今日免费已用完 · 解锁后不限局',
      start: '开 始 一 局',
      startAd: '看 广 告 · 开 一 局',
      startUnlock: '解 锁 · 开 一 局',
      again: '再 来 一 局',
      againAd: '看 广 告 · 再 来 一 局',
      againUnlock: '解 锁 · 再 来 一 局',
      defaultTitle: '永久不限局',
      unlimited: '无限畅玩',
      restore: '恢复购买',
      paywallTitleMenu: '无 限 畅 玩',
      paywallTitleQuota: '今天的三大局玩完了',
      paywallSubAds: '看一条短视频，立刻再开一大局；买断之后永久不限局。',
      paywallSubBuy: '一次买断，永久不限局 —— 天亮前修好家园，想开几局开几局。',
      freePerDay: '每天免费 {n} 大局',
      adReward: '看完一条激励视频 {n} 大局，可以一直看',
      oneTimeBuy: '一次性买断 {name}，不限局数',
      priceLoading: ' · 正在获取价格…',
      watchAdAgain: '看 广 告 · 再 来 一 局',
      adPlaying: '广 告 播 放 中 …',
      connecting: '连 接 App Store …',
      back: '返 回',
      later: '稍后再说',
      noIapAds: '当前地区不支持内购，观看广告即可继续。',
      noIapFree: '当前地区不支持内购，可以免费继续玩。',
      unlockedToast: '已解锁 · {name}',
      restoredToast: '已恢复 · {name}',
      pending: '等待批准 · 批准后自动解锁',
      cancelled: '已取消',
      buyFailed: '没买成，稍后再试',
      restoreEmpty: '这个 Apple ID 没有购买记录',
      restoreFailed: '恢复失败，稍后再试',
      adNotReady: '广告没准备好，这局算你的',
      adUnavailable: '广告暂时不可用，稍后再试',
      forgiveAd: '广告暂时没准备好，这局先算你的',
      forgiveRegion: '当前地区不支持内购，这局先算你的',
    },
    coop: {
      nickname0: '夜巡员', nickname1: '守门人', nickname2: '灯塔客', nickname3: '墙匠',
      nickname4: '拾荒者', nickname5: '巡夜犬', nickname6: '旧城客', nickname7: '守夜人',
      nickname8: '望火人', nickname9: '纸灯客', nickname10: '旧钟匠', nickname11: '夜行者',
      nickname12: '巷口哨兵', nickname13: '乌鸦使', nickname14: '窗边人', nickname15: '红围巾',
      nickname16: '雨夜客', nickname17: '灯油匠', nickname18: '修门匠', nickname19: '巡街客',
      nickname20: '影哨', nickname21: '风帽人', nickname22: '破晓者', nickname23: '守灯人',
      menuOpen: '创建或加入房间', menuResume: '继续合作 · {code}',
      lanes: '你负责{side}第 {a}–{b} 路 · 共守 {total} 路', readyLocked: '已准备 · 等待队友', submitReady: '布防完成 · 准备',
      ownLanesOnly: '只能在自己负责的三路布防',
      placementPrompt: '{name} · 第 {lane} 路 / 第 {col} 列 · {cost} 金币',
      confirmPlacement: '确认放置', cancelPlacement: '取消',
      teamName: '队友', teamTag: '{n} 人共守 · 尸潮 ×{n}',
      title: '合作守夜', intro: '邀请一到五位好友，最多六人；每侧三名玩家，每人负责三路。',
      ownerLeftTitle: '房主离开了', ownerLeftDesc: '本局合作守卫已结束。',
      connecting: '连接中', readingState: '正在读取房间状态…', recovering: '正在恢复房间请求…',
      requestTimeout: '请求超时', networkUnavailable: '网络不可用',
      retryConnection: '重试连接',
      reconnecting: '网络中断，正在重连 · 布防已保存在本机',
      deleteConfirm: '解散后所有队友都会结束合作，房间无法恢复。',
      deleteRecordConfirm: '删除后无法继续查看这个房间的记录。已获得的段位与成绩会保留。',
      confirmDelete: '确认解散', cancelDelete: '取消',
      nicknameLabel: '预设昵称', createTitle: '创建房间', createDesc: '创建后把八位房间码发给最多五位好友。',
      createButton: '创建房间', joinTitle: '加入房间', joinDesc: '输入房主分享的房间码。',
      roomCodePlaceholder: '八位房间码', joinButton: '加入房间', resumeButton: '继续房间 {code}',
      backMenu: '返回主菜单', invalidCode: '请输入有效的八位房间码。', requestSetup: '正在准备房间…',
      notFound: '房间不存在或已过期', full: '房间已满或已经开局', unauthorized: '房间凭证失效，请重新加入',
      phaseLocked: '本阶段已锁定，请刷新房间状态', rateLimited: '请求太频繁，请稍后再试',
      invalidBuild: '布防数据无效，请检查动物位置', invalidRank: '段位数据无效',
      invalidEconomy: '布防和金币超出可用预算', invalidReward: '遗物选择无效',
      invalidLoadout: '动物伙伴阵容无效', createFailed: '创建房间失败，请重试',
      notEnoughPlayers: '至少两人才能开局', hostOnly: '只有房主能开局',
      genericError: '联机请求失败，请检查网络后重试', roomDeleted: '房间已删除',
      waitingTitle: '等待守夜伙伴', waitingDesc: '分享房间码。房主可在 2–5 人时开局，6 人满员自动备战。',
      waitingHost: '房主可现在开局，也可以继续等好友加入。', startButton: '以 {n} 人开局',
      waitingForPlayers: '至少两人才能开局。房主可在 2–5 人时开局，6 人满员自动备战。',
      leftSide: '左侧', rightSide: '右侧',
      copyCode: '复制入房链接', copied: '入房链接已复制', copyFailed: '自动复制失败，请检查剪贴板权限后重试', codeLabel: '房间码：{code}',
      emptySeat: '等待好友加入', empty: '空位', ready: '已准备', selected: '已选择', online: '在线',
      owner: '房主', seatNumber: '第 {n} 位守夜人', averageRank: '段位压力按入房玩家平均值计算',
      deleteRoom: '解散房间', leaveRoom: '返回主菜单', deleteRecord: '删除房间记录',
      hudRound: '房间 {code} · 第 {n} / 12 局', waitingAll: '等待队友到齐', prepTimer: '备战 {time}',
      seatLanes: '你负责{side}第 {a}–{b} 路 · 全队已准备 {ready} / {total}', hudLeave: '离开本局',
      replayTitle: '第 {n} 小局 · 合作战斗',
      seconds: '秒', fallen: '倒下',
      resultWin: '至少一座家园守住了', resultLose: '全队家园失守', survivors: '全队存活 {n} / {total}',
      youHeld: '你守住了', youFell: '你的家园失守了', revived: '下一小局会复活。',
      heldStatus: '守住', fallenStatus: '失守',
      rewardPrompt: '选择一件遗物，或跳过领取 45 金币。120 秒内未选择会自动跳过。',
      skipReward: '跳过 · +45 金币', waitContinueTitle: '遗物已锁定',
      waitContinueDesc: '等其他守夜人选择，或等 120 秒到期自动跳过。之后会进入下一局备战。',
      chosen: '已选择', choosing: '选择中', localRoomProgress: '本机可离开，房间进度会保留。',
      finishTitle: '合作守夜结束', finishRounds: '12 局守住 {n} 局 · 段位 {before} → {after}（{delta}）',
      currentRank: '当前段位 {n}', finishButton: '返回主菜单',
    },
  },

  /* --- English --- */
  en: {
    unit: {
      barricade: { name: 'Gatekeeper Bear', short: 'Bear', desc: 'A tough bear that blocks three lanes at once. It does not attack.' },
      spike: { name: 'Bristleback Porcupine', short: 'Porcupine', desc: 'Zombies are hurt by its quills when they bite. Put it up front.' },
      turret: { name: 'Nutshot Raccoon', short: 'Raccoon', desc: 'Fires seeds at the nearest zombie in range, even across lanes.' },
      lamp: { name: 'Lantern Firefly', short: 'Firefly', desc: 'Zombies in its glow move 35% slower and take steady damage.' },
      flame: { name: 'Ember Fox', short: 'Fox', desc: 'Breathes fire forward and burns every zombie in its path.' },
      tesla: { name: 'Storm Eel', short: 'Eel', desc: 'Its electric arcs jump between nearby zombies.' },
      sniper: { name: 'Shadow Hawk', short: 'Hawk', desc: 'A precise long-range strike, slow but deadly to distant threats.' },
      venom: { name: 'Venom Snake', short: 'Snake', desc: 'Spits a toxic cloud that keeps corroding zombies after a hit.' },
      frost: { name: 'Snowshoe Hare', short: 'Hare', desc: 'Chills nearby zombies, slowing and steadily freezing them.' },
      quake: { name: 'Groundshaker Gorilla', short: 'Gorilla', desc: 'Slams the ground to briefly stun every zombie in range.' },
      railgun: { name: 'Charge Rhino', short: 'Rhino', desc: 'Rams a distant target at speed and bursts with area damage.' },
      totem: { name: 'Bloodkiss Bat', short: 'Bat', desc: 'Drains nearby zombies to heal the most wounded companion.' },
      wolf: { name: 'Trailrunner Wolf', short: 'Wolf', desc: 'Tracks distant targets and pounces repeatedly, with critical hits.' },
      owl: { name: 'Nightwatch Owl', short: 'Owl', desc: 'Sees far into the dark and lands powerful long-range critical hits.' },
      boar: { name: 'Tuskbreaker Boar', short: 'Boar', desc: 'Charges the ground, damaging and briefly stunning nearby zombies.' },
      chameleon: { name: 'Mistwalker Chameleon', short: 'Chameleon', desc: 'Spits a wide toxic cloud that corrodes a group over time.' },
      elephant: { name: 'Stomping Elephant', short: 'Elephant', desc: 'Its massive body blocks three lanes and stuns nearby zombies.' },
      frog: { name: 'Marsh Tree Frog', short: 'Frog', desc: 'Its tongue lands a strong hit and bursts with area damage.' },
      bee: { name: 'Stormneedle Bees', short: 'Bees', desc: 'A swarm rapidly chains stings across several targets.' },
      turtle: { name: 'Stoneback Turtle', short: 'Turtle', desc: 'Thick armor endures hits while its chill slows nearby zombies.' },
      tiger: { name: 'Nightcleave Tiger', short: 'Tiger', desc: 'A fierce pounce with long reach and frequent critical strikes.' },
      phoenix: { name: 'Cinder Phoenix', short: 'Phoenix', desc: 'Burns nearby zombies and restores health to wounded companions.' },
    },

    form: {
      neutral: { name: 'Standard', role: 'Standard', desc: 'The base form, with no extra upgrade.', effect2: '', effect3: '' },
      animal: {
        fierce: { name: 'Fierce', role: 'Attack', desc: 'A stronger pounce, sting, or breath attack.', effect2: 'Damage ×1.25', effect3: 'Damage ×1.50' },
        swift: { name: 'Swift', role: 'Fire Rate', desc: 'Lighter movement lets the animal strike more often.', effect2: 'Fire Rate ×1.25', effect3: 'Fire Rate ×1.45' },
        sturdy: { name: 'Sturdy', role: 'Durability', desc: 'A tougher body can endure much more damage.', effect2: 'Max Health ×1.25', effect3: 'Max Health ×1.45' },
      },
      barricade: {
        ironwall: { name: 'Stonehide', role: 'Durability', desc: 'Thick hide and muscle let the bear endure far more damage.', effect2: 'Max Health ×1.28', effect3: 'Max Health ×1.45' },
        thornwall: { name: 'Bristleback', role: 'Thorns', desc: 'Raised bristles make zombies bleed when they bite.', effect2: 'Health ×1.08 · Thorns 8/s', effect3: 'Health ×1.18 · Thorns 14/s' },
        gatewall: { name: 'Den Guardian', role: 'Control', desc: 'A final roar slows the horde behind the bear when it falls.', effect2: 'Health ×1.16 · Slow 35%/1.2s on death', effect3: 'Health ×1.30 · Slow 55%/1.6s on death' },
      },
      spike: {
        bleedteeth: { name: 'Razor Quills', role: 'Burst', desc: 'The porcupine tenses its muscles and drives its quills deeper into biters.', effect2: 'Health ×0.90 · Thorns ×1.45', effect3: 'Health ×0.95 · Thorns ×1.70' },
        hookspikes: { name: 'Barbed Quills', role: 'Control', desc: 'Barbed quills catch in rotting flesh and briefly stun the zombie.', effect2: 'Thorns ×0.90 · 18% Stun 0.5s', effect3: 'Thorns ×1.00 · 28% Stun 0.7s' },
        phosphorspikes: { name: 'Ember Quills', role: 'Burn', desc: 'A glowing secretion coats the quills and leaves wounds burning.', effect2: 'Burn 3/s for 1.5s', effect3: 'Thorns ×1.10 · Burn 5/s for 2.0s' },
      },
      turret: {
        armorpiercing: { name: 'Cracknut', role: 'Burst', desc: 'A heavier seed flies slower but can crack thick armor.', effect2: 'Damage ×1.45 · Fire Rate ×0.85', effect3: 'Damage ×1.65 · Fire Rate ×0.82' },
        rapidbow: { name: 'Twin Seedshot', role: 'Sustained', desc: 'The raccoon alternates both paws for denser, lighter volleys.', effect2: 'Damage ×0.82 · Fire Rate ×1.32', effect3: 'Damage ×0.88 · Fire Rate ×1.45' },
        trackerbow: { name: 'Tracker Seeds', role: 'Ranged', desc: 'Carefully aimed seeds find weak spots from farther away.', effect2: 'Radius +2.0 tiles · 18% Crit ×1.8', effect3: 'Radius +3.0 tiles · 28% Crit ×1.8' },
      },
      lamp: {
        widebeam: { name: 'Firefly Dance', role: 'Area', desc: 'A cloud of fireflies circles wider, slowing more zombies with less damage.', effect2: 'Radius +1.6 tiles · Slow +10% · Damage ×0.80', effect3: 'Radius +2.6 tiles · Slow +16% · Damage ×0.85' },
        sodiumflare: { name: 'Golden Glow', role: 'Burn', desc: 'A hotter glow scorches flesh but reaches a smaller area.', effect2: 'Damage ×1.55 · Slow ×0.70 · Radius -0.8 tiles', effect3: 'Damage ×1.80 · Slow ×0.75 · Radius -1.0 tiles' },
        stroboscope: { name: 'Flash Pulse', role: 'Control', desc: 'A pulsing glow makes zombies freeze when the light flares.', effect2: '18% Stun 0.35s · Damage ×1.05', effect3: '28% Stun 0.50s · Damage ×1.15' },
      },
      flame: {
        fanfire: { name: 'Fan Breath', role: 'Clear', desc: 'The fox breathes in a wide fan, trading single-target damage for coverage.', effect2: 'Spray ×1.50 · Range +0.4 tiles · Damage ×0.78', effect3: 'Spray ×1.80 · Range +0.6 tiles · Damage ×0.82' },
        needlefire: { name: 'Blazing Cry', role: 'Burst', desc: 'A focused breath sends a hotter column straight ahead.', effect2: 'Damage ×1.50 · Spray ×0.70 · Range +0.2 tiles', effect3: 'Damage ×1.75 · Spray ×0.65 · Range +0.4 tiles' },
        emberfire: { name: 'Everember', role: 'Burn', desc: 'Lingering embers cling to flesh and keep the target burning.', effect2: 'Fire Rate ×1.30 · Burn 3/s for 1.2s', effect3: 'Fire Rate ×1.45 · Burn 5/s for 1.6s' },
      },
      tesla: {
        topology: { name: 'Schooling Arc', role: 'Multi', desc: 'A school of eels guides lightning between more distant targets.', effect2: 'Chain +2 · Damage ×0.78', effect3: 'Chain +3 · Damage ×0.82' },
        lightningspear: { name: 'Thunder Fang', role: 'Single', desc: 'The eel packs its charge into one strike against the front rank.', effect2: 'Damage ×1.50 · Chain -1', effect3: 'Damage ×1.75 · Chain -1' },
        pulsecoil: { name: 'Shocking Scales', role: 'Area', desc: 'Its scales pulse together, stunning a wider group with lighter shocks.', effect2: 'Fire Rate ×1.30 · Radius +0.8 tiles · Damage ×0.85', effect3: 'Fire Rate ×1.45 · Radius +1.2 tiles · Damage ×0.90' },
      },
      sniper: {
        hollowpoint: { name: 'Armor-Piercing Peck', role: 'Burst', desc: 'The hawk strikes precisely between armor plates with its beak.', effect2: 'Damage ×1.35 · Fire Rate ×1.15', effect3: 'Damage ×1.60 · Fire Rate ×1.30' },
        longscope: { name: 'Night Eyes', role: 'Range', desc: 'Keen vision pierces the dark and spots targets much farther away.', effect2: 'Radius +1.8 tiles · Damage ×0.90', effect3: 'Radius +3.0 tiles · Damage ×1.00' },
        execution: { name: 'Diving Talons', role: 'Crit', desc: 'The hawk dives from above and sometimes lands a lethal strike.', effect2: 'Crit 18% · Crit ×1.80', effect3: 'Crit 28% · Crit ×1.80' },
      },
      venom: {
        corrosive: { name: 'Concentrated Venom', role: 'Burn', desc: "The snake's stronger venom keeps eating away at each wound.", effect2: 'Corrosion +2/s · Duration +0.5s', effect3: 'Corrosion +3.5/s · Duration +1.0s' },
        widemist: { name: 'Coiling Breath', role: 'Clear', desc: 'The snake coils and spreads venom across a much wider lane.', effect2: 'Spray ×1.50 · Damage ×0.80', effect3: 'Spray ×1.80 · Damage ×0.85' },
        virulent: { name: 'Venomous Bite', role: 'Burst', desc: 'A quick, concentrated bite delivers a much stronger dose of venom.', effect2: 'Damage ×1.30 · Fire Rate ×1.10', effect3: 'Damage ×1.50 · Fire Rate ×1.20' },
      },
      frost: {
        deepchill: { name: 'Winter Instinct', role: 'Control', desc: 'The hare releases a deeper chill that slows zombie steps.', effect2: 'Slow +10%', effect3: 'Slow +15%' },
        widefrost: { name: 'Frost Ring', role: 'Area', desc: 'Cold spreads outward, trading single-target bite for a wider hold.', effect2: 'Frost Field +1.0 tiles · Damage ×0.80', effect3: 'Frost Field +1.6 tiles · Damage ×0.85' },
        icebind: { name: 'Ice Bind', role: 'Single', desc: 'Frost gathers to a point and keeps biting the nearest target.', effect2: 'Damage ×1.45 · Slow +4%', effect3: 'Damage ×1.70 · Slow +7%' },
      },
      quake: {
        thunderclap: { name: 'Gorilla Roar', role: 'Control', desc: 'A thunderous roar sends a shockwave that freezes zombies briefly.', effect2: 'Stun +0.20s · Damage ×1.10', effect3: 'Stun +0.35s · Damage ×1.25' },
        seismic: { name: 'Cracking Stomp', role: 'Area', desc: 'A mighty stomp sends shockwaves farther across the ground.', effect2: 'Quake Field +1.0 tiles · Damage ×0.80', effect3: 'Quake Field +1.8 tiles · Damage ×0.85' },
        quickdrum: { name: 'Rapid Stomp', role: 'Fire Rate', desc: 'The gorilla pounds the ground in a much faster rhythm.', effect2: 'Fire Rate ×1.35 · Damage ×0.82', effect3: 'Fire Rate ×1.55 · Damage ×0.88' },
      },
      railgun: {
        capacitor: { name: 'Charged Horn', role: 'Burst', desc: 'Lightning gathers around the rhino’s horn before a heavy ram.', effect2: 'Damage ×1.40 · Fire Rate ×1.15', effect3: 'Damage ×1.70 · Fire Rate ×1.30' },
        widecoil: { name: 'Riftquake', role: 'Area', desc: 'A rushing impact sends a shockwave tearing across the ground.', effect2: 'Splash ×1.45 · Damage ×0.75', effect3: 'Splash ×1.80 · Damage ×0.80' },
        penetrator: { name: 'Longhorn Charge', role: 'Range', desc: 'A longer charge carries the rhino through a much greater distance.', effect2: 'Radius +2.4 tiles · Damage ×1.10', effect3: 'Radius +3.8 tiles · Damage ×1.20' },
      },
      totem: {
        marrow: { name: 'Sanguine Return', role: 'Heal', desc: 'The bat drains a zombie and channels that stolen life to its allies.', effect2: 'Heal ×1.35 · Damage ×0.80', effect3: 'Heal ×1.60 · Damage ×0.85' },
        broadpact: { name: 'Sheltering Wings', role: 'Area', desc: 'The bat spreads its wings to protect more companions at once.', effect2: 'Aura +1.0 tiles · Heal ×0.90', effect3: 'Aura +1.6 tiles · Heal ×0.95' },
        quickpact: { name: 'Rapid Wingbeat', role: 'Tempo', desc: 'Faster wingbeats make both draining and healing more frequent.', effect2: 'Fire Rate ×1.35 · Heal ×1.10', effect3: 'Fire Rate ×1.55 · Heal ×1.20' },
      },
    },

    zombie: {
      bug: { name: 'Swarm Bug' },
      walker: { name: 'Shambler' },
      runner: { name: 'Runner' },
      screamer: { name: 'Screamer' },
      brute: { name: 'Bloater' },
      tank: { name: 'Tinplate' },
    },

    relic: {
      foundation: { name: 'Home Reinforcement', text: 'Home Max Health +35' },
      gears: { name: 'Brass Gears', text: 'All animal companions Fire Rate +18%' },
      steel: { name: 'Tempered Steel', text: 'All animal companions Health +28%' },
      powder: { name: 'Black Powder', text: 'All animal companions Damage +22%' },
      satchel: { name: 'Scavenger Pack', text: '+30 extra income each round' },
      lore: { name: 'Cadaver Notes', text: 'Zombie Move Speed -12%' },
      spares: { name: 'Spare Parts', text: 'Home Max Health +25; start each round at full health' },
      doublebow: { name: 'Twin Seedshot', text: 'Raccoons fire one extra seed each volley' },
      coldlight: { name: 'Cold Firefly', text: 'Fireflies slow 15% more and reach 0.7 tiles farther' },
      fuse: { name: 'Proximity Fuse', text: 'Porcupine retaliation +65%' },
      overload: { name: 'Arc Overload', text: 'Storm Eels chain 1 extra target' },
      ration: { name: 'Glow Ration', text: '+15 extra income each round' },
    },

    rank: {
      r0: { name: 'Scavenger' },
      r1: { name: 'Cabin Watcher' },
      r2: { name: 'Iron Gate Guard' },
      r3: { name: 'Foreman' },
      r4: { name: 'Bastion Commander' },
      r5: { name: 'Fortress of Endless Night' },
    },

    rangeName: {
      frost: 'Frost Field',
      quake: 'Quake Field',
      totem: 'Aura',
      lamp: 'Range',
      fallback: 'Radius',
    },

    canvas: {
      /* 通道角上只有约 84 逻辑像素可用，这两个标签必须短。 */
      placeHere: 'Place here',
      allLanesRound3: 'Lanes 7–9 open in round 3',
      lanesEarlier: 'Lanes 4–6 open in round {n}',
    },

    combat: {
      cellUnit: ' tiles',
      range: 'Range',
      radius: 'Radius',
      radiusRange: 'Range',
      spray: 'Spread',
      splash: 'Splash',
      chain: 'Chain',
      rate: 'Fire Rate',
      slow: 'Slow',
      burn: 'Corrosion',
      heal: 'Heal',
      stun: 'Stun',
      crit: 'Crit',
      contact: 'Contact Dmg',
    },

    /* 卡片上的极短数值词。卡片宽度只有 132 逻辑像素，英文全称放不下
       （"Fire Rate" + "Corrosion" 两个词就能吃掉一整行），所以这里另给一套。
      中文本来就短，直接沿用上面那套。 */
    combatShort: {
      rate: 'RoF',
      burn: 'Burns',
      contact: 'Thorns',
    },

    static: {
      title: 'Zombies at the Door',
      yourHome: 'Your Home',
      mirrorName: 'Rival Home',
      roundLabel: 'Round 1 / 12',
      coins: 'Coins',
      buildHint: 'Tap a friend, then a tile · Or drag to place',
      startDefense: 'Start Defense',
      flareName: 'Flare',
      flareHint: 'Tap button, then the field',
      battleTip: 'Defend Home with your animal friends',
      repairName: 'Repair',
      repairHint: 'Heals 16 instantly',
      skipTutorial: 'Skip tutorial',
    },

    ui: {
      menuTitle: 'Zombies at the Door',
      menuSub: 'Keep Home safe tonight with your animal friends',
      soloMode: 'Start Night Watch', coopMode: 'Co-op Watch',
      menuStats: '{unlocked}/{total} animals befriended · {matches} matches · Best {wins}/{rounds}',
      howToPlay: 'How to play',
      rule1: 'The Rift in the middle keeps spitting out zombies — <b>both sides get exactly the same count</b>.',
      rule2: 'Each animal has a role: bears and elephants block, porcupines retaliate, foxes breathe fire, eels and bees chain attacks.',
      rule3: 'The right side replays another player’s defense at your stage. Enemies get stronger; the first Home to fall loses the round.',
      rule4: 'Choose <b>6 animal companions</b> before each match. Unlock 2 at 100, 500, 1000, then every 500 points from 1500 to 3500.',
      rule5: 'A match is 12 rounds. Choose a Relic between rounds and defend Home with your animal companions.',
      rule6: 'The battlefield opens in three stages: <b>3×3 in round 1, 6×6 in round 2, and 9×9 from round 3</b>. The final three lanes open in round 3.',
      replayTutorial: 'Replay tutorial',
      soundToggle: 'Sound: {state}',
      on: 'On',
      off: 'Off',
      loadoutTitle: 'Choose Your Friends',
      loadoutSub: 'Pick <b>6</b> animals you have befriended. This team plays every round of the match.',
      loadoutCount: '{n} / 6 selected',
      loadoutConfirm: 'Confirm',
      loadoutFull: 'You can only bring 6',
      unlockAtRank: 'Unlocks at Rank {n}',
      unlockAtRankToast: 'Unlocks at rank {n}',
      rankPoints: '{n} pts',
      rankToNext: ' · {n} to {name}',
      rankTop: ' · Top rank',
      firstUpgrade: 'First upgrade · Pick 1 of 3',
      formTitle: 'Choose an Upgrade',
      formSub: 'Help {name} grow stronger · Level 2 costs {cost} coins',
      formCost: 'Choose · {n} coins',
      formNote: 'Cannot be changed this round',
      formCancel: 'Not now',
      maxLevel: 'Max level',
      pickOneCost: 'Pick 1 of 3 ◍{n}',
      upgradeCost: 'Upgrade ◍{n}',
      sellCost: 'Salvage ◍{n}',
      rewardTitle: 'Choose a Helpful Item',
      rewardSub: 'Pick a boost for your friends. It lasts until this match ends.',
      rewardSkip: 'Skip all, take ◍{n}',
      newUnlocks: 'New companions · {names}',
      listSep: ', ',
      resultWin: 'Home is safe!',
      resultLose: 'Let’s try again',
      resultNote: 'Enemies get stronger. Try a different team next round.',
      you: 'You',
      mirror: 'Mirror',
      homeLeft: 'Home {n}%',
      kills: 'Kills {n}',
      income: 'Income +{n}',
      continue: 'Continue Watch',
      matchEndTitle: 'Tonight’s Watch',
      winsOfTotal: '/ {total} wins',
      rankDelta: 'Rank {n}',
      promoted: 'Promoted · {name}',
      backToMenu: 'Back Home',
    },
    friendly: {
      settings: 'Settings', largeText: 'Larger text', largeTextHint: 'Make interface text larger',
      reducedMotion: 'Reduce motion', reducedMotionHint: 'Reduce flashes and screen shake',
      systemMotion: 'Your system has Reduce Motion enabled', volume: 'Sound volume', soundEnabled: 'Sound', settingsBack: 'Back',
      settingsNote: 'Changes are saved automatically', coinsReward: 'Round reward +{n} coins',
      progress: 'My Night Watch', details: 'See detailed stats',
      team: 'My Team', emptySlot: 'Choose',
      roles: { block: 'Block', retaliate: 'Thorns', ranged: 'Ranged', slow: 'Slow',
        fire: 'Fire', chain: 'Chain', heal: 'Heal', area: 'Area' },
    },
    hud: {
      preparing: 'Preparing',
      round: 'Round {n} / {total}',
      pressureSuffix: ' · Pressure+{n}%',
      fundsSuffix: ' · Funds+{n}%',
      eternalSuffix: ' · Eternal {n}',
      mirrorTag: 'Mirror · {tag} · Power ',
      startDefense: 'Start Defense',
      startRound: 'Start Round {n}',
      surge: 'Rift Surge ×{n}',
      lanes3: '3 lanes open · Round 2 opens 4–6',
      lanes6: '6 lanes open · Round 3 opens 7–9',
      lanesAll: 'All 9 lanes open',
      hintPlaced: 'Tap a tile to place · Tap the friend again to cancel',
      hintDrag: 'Tap a friend, then a tile · Or drag to place',
      even: 'Even',
      lead: 'You lead {n}%',
      behind: 'You trail {n}%',
      matchKicker: 'Watcher matchmaking · 1V1',
      matchFound: 'Matched · Rival locked in',
      matchSearching: 'Looking for another player…',
      matchStatusFound: 'Matched on power and round progress',
      matchStatusSearching: 'Comparing rank, progress and defense strength',
      avatarYou: 'N',
      avatarRival: 'S',
      you: 'You',
      yourHome: 'Your Home',
      scanning: 'Scanning…',
      otherPlayer: 'Another player · {tag}',
      watcherChannel: 'Watcher channel',
      hpStat: 'Health {n}',
      dmgStat: ' · Damage {n}',
      whisper1: 'Don’t look back.',
      whisper2: 'Something is breathing behind the wall.',
      whisper3: 'The footsteps only ever land on one foot.',
      whisper4: 'The light is shaking. It has seen you.',
      whisper5: 'On the other side of the Rift, someone is counting your name.',
      whisper6: 'One was standing there just now. Not anymore.',
    },
    tutorial: {
      step1: 'Tap this card',
      step2: 'Tap the glowing plot',
      step3: 'Tap Start Defense',
      cardPicked: 'Picked · Drop it on the glowing plot',
      placed: 'In place · Tap Start Defense',
      skipped: 'Tutorial skipped · You can play freely now',
    },
    experience: {
      pause: 'Pause', paused: 'Paused', resume: 'Resume watch',
      saveMenu: 'Save and return to menu', continueRun: 'Continue your watch',
      resumeNote: 'Leaving a battle resumes from this round’s preparation.',
      checkpointNote: 'Your defense, coins and relics are kept.',
      fullHealth: 'Home is at full health',
      flareEmpty: 'No enemies here. Pick another spot or tap the button to cancel',
      undo: 'Undo', undoFailed: 'Spot occupied or not enough coins to undo',
      repairRole: 'Repair', guardRole: 'Held', fallenRole: 'Fell',
      firstBreach: 'Lane {lane} was breached first at {time}s. Add blockers and damage coverage.',
      roundDuration: 'Battle lasted {time}s · Home health',
      noBreach: 'Your home held. Cover the newly opened lanes next.',
      tutorialBear: 'Place a bear to block three lanes',
      tutorialSpike: 'Add a porcupine to retaliate',
      tutorialTurret: 'Add a raccoon for cross-lane damage',
      tutorialStart: 'Defense ready. Start the watch',
      tutorialPick: 'Select the animal under the pointer',
      tutorialRequired: 'Keep the bear, porcupine and raccoon for this tutorial',
      tutorialPlace: 'Use the glowing spot. Wrong spots cost no coins',
      battleFocus: 'Battlefield: arrows move, Enter places or selects, Escape cancels',
      cellStatus: 'Lane {lane}, column {col}: {name}',
      emptyCell: 'Empty', lockedCell: 'Locked',
      formInstruction: 'Select an animal to inspect it, then choose a spot',
    },
    meta: {
      defaultName: '{prefix} the {role}',
      plotLocked: 'This plot is not cleared yet',
      laneLocked: 'This lane is not cleared yet · Opens in round {n}',
      cellOccupied: 'Something is already here',
      notInLoadout: 'That animal is not on this team',
      notEnoughCoins: 'Not enough funds',
      notEnoughCoinsUpgrade: 'Not enough funds to upgrade',
      alreadyMaxed: 'Already at max level',
      formMissing: 'That upgrade does not exist',
      tutorialWrongCell: 'Place the animal on the glowing spot',
      sold: 'Salvaged +{n}',
      flareMiss: 'Nothing in range',
    },
    bot: {
      name: '{prefix} the {role} · {n}',
      unknown: 'Unknown Watcher',
      defaultTag: 'Night Watch',
      tag: {
        turtle: 'Turtle',
        firepower: 'Firepower',
        flame: 'Flame',
        electric: 'Electric',
        generalist: 'Generalist',
      },
    },
    monetize: {
      lineUnlocked: 'Unlocked · Unlimited matches',
      lineFreeLeft: '{n} / {total} free matches today',
      lineCredits: 'Free matches used up · {n} ad matches banked',
      lineAds: 'Free matches used up · Watch an ad to keep playing',
      lineUnlock: 'Free matches used up · Unlock for unlimited',
      start: 'S T A R T   A   M A T C H',
      startAd: 'W A T C H   A D · S T A R T',
      startUnlock: 'U N L O C K · S T A R T',
      again: 'O N E   M O R E',
      againAd: 'W A T C H   A D · O N E   M O R E',
      againUnlock: 'U N L O C K · O N E   M O R E',
      defaultTitle: 'Unlimited Play',
      unlimited: 'Unlimited Play',
      restore: 'Restore Purchase',
      paywallTitleMenu: 'U N L I M I T E D   P L A Y',
      paywallTitleQuota: 'Free matches used up for today',
      paywallSubAds: 'Watch a short video for one more match. Unlock once for unlimited.',
      paywallSubBuy: 'One-time unlock, unlimited matches — rebuild Home before dawn, as many times as you like.',
      freePerDay: '{n} free matches per day',
      adReward: 'Watch a rewarded video for {n} matches, repeatable',
      oneTimeBuy: 'One-time purchase {name}, unlimited matches',
      priceLoading: ' · Loading price…',
      watchAdAgain: 'W A T C H   A D · O N E   M O R E',
      adPlaying: 'A D   P L A Y I N G …',
      connecting: 'C O N N E C T I N G   T O   A P P   S T O R E …',
      back: 'B A C K',
      later: 'Later',
      noIapAds: 'In-app purchases aren’t available in your region. Watch an ad to continue.',
      noIapFree: 'In-app purchases aren’t available in your region. Keep playing for free.',
      unlockedToast: 'Unlocked · {name}',
      restoredToast: 'Restored · {name}',
      pending: 'Pending approval · Unlocks automatically once approved',
      cancelled: 'Cancelled',
      buyFailed: 'Purchase failed, try again later',
      restoreEmpty: 'No purchases found for this Apple ID',
      restoreFailed: 'Restore failed, try again later',
      adNotReady: 'Ad not ready — this match is on us',
      adUnavailable: 'Ads temporarily unavailable, try again later',
      forgiveAd: 'Ad not ready yet — this match is on us',
      forgiveRegion: 'In-app purchases aren’t available in your region — this match is on us',
    },
    coop: {
      nickname0: 'Night Watch', nickname1: 'Gatekeeper', nickname2: 'Lighthouse', nickname3: 'Wallwright',
      nickname4: 'Scavenger', nickname5: 'Night Hound', nickname6: 'Old Town', nickname7: 'Keeper',
      nickname8: 'Watchfire', nickname9: 'Paper Lantern', nickname10: 'Clockmaker', nickname11: 'Nightwalker',
      nickname12: 'Alley Scout', nickname13: 'Raven Courier', nickname14: 'Window Watch', nickname15: 'Red Scarf',
      nickname16: 'Rainwalker', nickname17: 'Lamplighter', nickname18: 'Door Mender', nickname19: 'Street Scout',
      nickname20: 'Shadow Sentry', nickname21: 'Hooded One', nickname22: 'Dawnkeeper', nickname23: 'Wick Keeper',
      menuOpen: 'Create or Join Room', menuResume: 'Continue Co-op · {code}',
      lanes: 'Your {side} lanes: {a}–{b} · {total} lanes together', readyLocked: 'Ready · Waiting for team', submitReady: 'Defenses Set · Ready',
      ownLanesOnly: 'Build only on your three lanes',
      placementPrompt: '{name} · Lane {lane} / Column {col} · {cost} coins',
      confirmPlacement: 'Place Here', cancelPlacement: 'Cancel',
      teamName: 'Team', teamTag: '{n} players · Zombie horde ×{n}',
      title: 'Co-op Watch', intro: 'Invite one to five friends. Up to six players defend together, three per side with three lanes each.',
      ownerLeftTitle: 'The host has left', ownerLeftDesc: 'This co-op run has ended.',
      connecting: 'Connecting', readingState: 'Loading room…', recovering: 'Recovering room request…',
      requestTimeout: 'Request timed out', networkUnavailable: 'Network unavailable',
      retryConnection: 'Retry connection',
      reconnecting: 'Connection lost. Reconnecting · Your defense is saved on this device',
      deleteConfirm: 'Disbanding ends co-op for every teammate. This room cannot be restored.',
      deleteRecordConfirm: 'Deleting removes this room record. Your earned rank and results are kept.',
      confirmDelete: 'Confirm deletion', cancelDelete: 'Cancel',
      nicknameLabel: 'Preset nickname', createTitle: 'Create Room', createDesc: 'Share the eight-character room code with up to five friends.',
      createButton: 'Create Room', joinTitle: 'Join Room', joinDesc: 'Enter the room code shared by the host.',
      roomCodePlaceholder: '8-character room code', joinButton: 'Join Room', resumeButton: 'Resume room {code}',
      backMenu: 'Back to Menu', invalidCode: 'Enter a valid eight-character room code.', requestSetup: 'Preparing room…',
      notFound: 'Room not found or expired', full: 'Room is full or already started', unauthorized: 'Room credential expired; rejoin the room',
      phaseLocked: 'This phase is locked. Refresh the room state.', rateLimited: 'Too many requests. Try again shortly.',
      invalidBuild: 'Invalid animal defense layout. Check unit positions.', invalidRank: 'Invalid rank data',
      invalidEconomy: 'Defense and funds exceed the available budget', invalidReward: 'Invalid Relic choice',
      invalidLoadout: 'Invalid animal team', createFailed: 'Could not create the room. Try again.',
      notEnoughPlayers: 'At least two players are needed', hostOnly: 'Only the host can start',
      genericError: 'Co-op request failed. Check your connection and try again.', roomDeleted: 'Room deleted',
      waitingTitle: 'Waiting for Watchkeepers', waitingDesc: 'The host can start with 2–5 players. Prep starts automatically when all six seats are filled.',
      waitingHost: 'The host can start now or wait for more friends to join.', startButton: 'Start with {n}',
      waitingForPlayers: 'At least two players are needed. The host can start with 2–5; all six start automatically.',
      leftSide: 'left-side', rightSide: 'right-side',
      copyCode: 'Copy Room Link', copied: 'Room link copied', copyFailed: 'Could not copy automatically. Check clipboard permissions and try again.', codeLabel: 'Room code: {code}',
      emptySeat: 'Waiting for a friend', empty: 'Open seat', ready: 'Ready', selected: 'Chosen', online: 'Online',
      owner: 'Host', seatNumber: 'Player {n}', averageRank: 'Difficulty uses the current team average rank',
      deleteRoom: 'Disband Room', leaveRoom: 'Back to Menu', deleteRecord: 'Delete Room Record',
      hudRound: 'Room {code} · Round {n} / 12', waitingAll: 'Waiting for teammates', prepTimer: 'Prep {time}',
      seatLanes: 'Your {side} lanes: {a}–{b} · Ready: {ready} / {total}', hudLeave: 'Leave Run',
      replayTitle: 'Round {n} · Co-op Battle',
      seconds: 'sec', fallen: 'Fallen',
      resultWin: 'At least one Home held', resultLose: 'Every Home fell', survivors: 'Team survivors: {n} / {total}',
      youHeld: 'You held', youFell: 'Your Home fell', revived: 'You revive next round.',
      heldStatus: 'Held', fallenStatus: 'Fell',
      rewardPrompt: 'Choose a Relic or skip for 45 funds. Unclaimed choices are skipped after 120 seconds.',
      skipReward: 'Skip · +45 Funds', waitContinueTitle: 'Relic locked',
      waitContinueDesc: 'Waiting for the other players, or the 120-second auto-skip. Then the next prep phase begins.',
      chosen: 'Chosen', choosing: 'Choosing', localRoomProgress: 'You can leave; room progress is saved.',
      finishTitle: 'Co-op Run Complete', finishRounds: 'Held {n} of 12 rounds · Rank {before} → {after} ({delta})',
      currentRank: 'Rank {n}', finishButton: 'Back to Menu',
    },
  },
};

/* ------------------------- 防御单位 ------------------------- */
/* lv 加成：hp * (1 + 0.35*(lv-1))，dmg * (1 + 0.42*(lv-1)) */
var UNITS = {
  barricade: {
    id: 'barricade',
    animal: 'bear', behavior: 'block',
    name: L('unit.barricade.name', null, '守门熊'),
    short: L('unit.barricade.short', null, '熊'), cost: 20, maxLv: 3,
    hp: 175, footprintRows: 3, color: '#a3783f', glow: '#d9a95e',
    desc: L('unit.barricade.desc', null, '厚实的熊能同时守住三条路，不会主动攻击。'),
  },
  spike: {
    id: 'spike',
    animal: 'porcupine', behavior: 'contact',
    name: L('unit.spike.name', null, '棘背豪猪'),
    short: L('unit.spike.short', null, '猪'), cost: 30, maxLv: 3,
    hp: 62, dmg: 24, footprintRows: 3, color: '#b4623a', glow: '#ff8a4a',
    desc: L('unit.spike.desc', null, '豪猪的尖刺会反伤啃咬它的丧尸，适合放在队伍前方。'),
  },
  turret: {
    id: 'turret',
    animal: 'raccoon', behavior: 'shot',
    name: L('unit.turret.name', null, '坚果浣熊'),
    short: L('unit.turret.short', null, '浣'), cost: 45, maxLv: 3,
    hp: 82, dmg: 9, rate: 0.7, range: 250, rangeType: 'radius', color: '#c8c3ae', glow: '#ffe9b0',
    desc: L('unit.turret.desc', null, '浣熊弹射坚果果核攻击最近的丧尸，可跨路支援。'),
  },
  lamp: {
    id: 'lamp',
    animal: 'firefly', behavior: 'aura', rangeMod: 'lampRange', slowMod: 'slowAdd',
    name: L('unit.lamp.name', null, '提灯萤火虫'),
    short: L('unit.lamp.short', null, '萤'), cost: 55, maxLv: 3,
    hp: 74, dmg: 4, radius: 168, slow: 0.35, color: '#ffd98a', glow: '#ffe9a8',
    desc: L('unit.lamp.desc', null, '萤火虫发出冷光，减慢周围丧尸并持续灼伤它们。'),
  },
  flame: {
    id: 'flame',
    animal: 'fox', behavior: 'spray',
    name: L('unit.flame.name', null, '赤焰狐'),
    short: L('unit.flame.short', null, '狐'), cost: 65, maxLv: 3,
    hp: 74, dmg: 13, rate: 0.5, range: 152, spray: 56, color: '#ff7a3c', glow: '#ffb066',
    desc: L('unit.flame.desc', null, '赤焰狐朝前方喷出火焰，灼烧覆盖范围内的丧尸。'),
  },
  tesla: {
    id: 'tesla',
    animal: 'eel', behavior: 'chain',
    name: L('unit.tesla.name', null, '雷纹鳗'),
    short: L('unit.tesla.short', null, '鳗'), cost: 85, maxLv: 3,
    hp: 68, dmg: 16, rate: 1.3, radius: 178, chain: 3, color: '#7fe3ff', glow: '#c6f4ff',
    desc: L('unit.tesla.desc', null, '雷纹鳗放出电弧，在多个丧尸之间连锁攻击。'),
  },
  sniper: {
    id: 'sniper',
    animal: 'hawk', behavior: 'shot',
    name: L('unit.sniper.name', null, '掠影鹰'),
    short: L('unit.sniper.short', null, '鹰'), cost: 70, maxLv: 3,
    hp: 65, dmg: 34, rate: 1.55, range: 430, rangeType: 'radius', color: '#b9e0d0', glow: '#d9fff0',
    desc: L('unit.sniper.desc', null, '掠影鹰从远处精准重击目标，出手较慢但威力强。'),
  },
  venom: {
    id: 'venom',
    animal: 'snake', behavior: 'spray',
    name: L('unit.venom.name', null, '毒牙蛇'),
    short: L('unit.venom.short', null, '蛇'), cost: 60, maxLv: 3,
    hp: 78, dmg: 7, rate: 0.85, range: 185, spray: 65,
    burnDps: 3.2, burnT: 1.8, color: '#8ccf6b', glow: '#baff8e',
    desc: L('unit.venom.desc', null, '毒牙蛇喷出腐蚀毒雾，命中后持续侵蚀丧尸。'),
  },
  frost: {
    id: 'frost',
    animal: 'hare', behavior: 'aura',
    name: L('unit.frost.name', null, '雪耳兔'),
    short: L('unit.frost.short', null, '兔'), cost: 70, maxLv: 3,
    hp: 72, dmg: 2.5, radius: 175, slow: 0.42, rangeName: L('rangeName.frost', null, '寒域'),
    color: '#8fd8ff', glow: '#d8f6ff',
    desc: L('unit.frost.desc', null, '雪耳兔释放寒气，持续减速并冻伤周围丧尸。'),
  },
  quake: {
    id: 'quake',
    animal: 'gorilla', behavior: 'quake',
    name: L('unit.quake.name', null, '震地猩猩'),
    short: L('unit.quake.short', null, '猩'), cost: 75, maxLv: 3,
    hp: 85, dmg: 8, rate: 3.0, radius: 155,
    strobeChance: 0.82, strobeDur: 0.65, rangeName: L('rangeName.quake', null, '震域'),
    color: '#d3a45f', glow: '#ffd991',
    desc: L('unit.quake.desc', null, '震地猩猩周期性重踏，短暂击晕周围丧尸。'),
  },
  railgun: {
    id: 'railgun',
    animal: 'rhino', behavior: 'shot',
    name: L('unit.railgun.name', null, '冲锋犀'),
    short: L('unit.railgun.short', null, '犀'), cost: 105, maxLv: 3,
    hp: 60, dmg: 48, rate: 2.3, range: 520, rangeType: 'radius', splash: 115,
    color: '#72b7ff', glow: '#c6e4ff',
    desc: L('unit.railgun.desc', null, '冲锋犀远距离猛撞目标，并震伤落点附近的丧尸。'),
  },
  totem: {
    id: 'totem',
    animal: 'bat', behavior: 'healer',
    name: L('unit.totem.name', null, '血吻蝙蝠'),
    short: L('unit.totem.short', null, '蝠'), cost: 95, maxLv: 3,
    hp: 90, dmg: 3, rate: 1.4, radius: 165, heal: 6, rangeName: L('rangeName.totem', null, '光环'),
    color: '#df6f88', glow: '#ffb0c0',
    desc: L('unit.totem.desc', null, '血吻蝙蝠吸取附近丧尸的生命，疗愈受伤最重的伙伴。'),
  },
  wolf: {
    id: 'wolf', animal: 'wolf', behavior: 'shot',
    name: L('unit.wolf.name', null, '追痕狼'), short: L('unit.wolf.short', null, '狼'),
    cost: 110, maxLv: 3, hp: 92, dmg: 13, rate: 0.62, range: 310, rangeType: 'radius',
    critChance: 0.14, critMul: 1.8, color: '#8992a0', glow: '#c4d1e2',
    desc: L('unit.wolf.desc', null, '追踪远处目标连续扑击，暴击时伤害更高。'),
  },
  owl: {
    id: 'owl', animal: 'owl', behavior: 'shot',
    name: L('unit.owl.name', null, '夜巡猫头鹰'), short: L('unit.owl.short', null, '鸮'),
    cost: 115, maxLv: 3, hp: 70, dmg: 46, rate: 1.85, range: 460, rangeType: 'radius',
    critChance: 0.20, critMul: 2.0, color: '#b28e69', glow: '#f5d69b',
    desc: L('unit.owl.desc', null, '视野极远，擅长远距离精准暴击。'),
  },
  boar: {
    id: 'boar', animal: 'boar', behavior: 'quake',
    name: L('unit.boar.name', null, '獠牙野猪'), short: L('unit.boar.short', null, '獠'),
    cost: 130, maxLv: 3, hp: 168, dmg: 13, rate: 2.25, radius: 158,
    strobeChance: 0.38, strobeDur: 0.42, color: '#9b6547', glow: '#f0a665',
    desc: L('unit.boar.desc', null, '猛撞地面震退并短暂震晕周围丧尸。'),
  },
  chameleon: {
    id: 'chameleon', animal: 'chameleon', behavior: 'spray',
    name: L('unit.chameleon.name', null, '雾行变色龙'), short: L('unit.chameleon.short', null, '蜥'),
    cost: 125, maxLv: 3, hp: 88, dmg: 6, rate: 0.82, range: 192, spray: 82,
    burnDps: 4.8, burnT: 2.4, color: '#82b56c', glow: '#c5f28f',
    desc: L('unit.chameleon.desc', null, '喷出宽幅毒雾，持续腐蚀一整片丧尸。'),
  },
  elephant: {
    id: 'elephant', animal: 'elephant', behavior: 'quake',
    name: L('unit.elephant.name', null, '踏地巨象'), short: L('unit.elephant.short', null, '象'),
    cost: 160, maxLv: 3, hp: 315, dmg: 12, rate: 3.0, radius: 132, footprintRows: 3,
    strobeChance: 0.18, strobeDur: 0.45, color: '#8795a0', glow: '#bfd8df',
    desc: L('unit.elephant.desc', null, '血量极高，能挡住三条路，并震晕身边丧尸。'),
  },
  frog: {
    id: 'frog', animal: 'frog', behavior: 'shot',
    name: L('unit.frog.name', null, '沼泽树蛙'), short: L('unit.frog.short', null, '蛙'),
    cost: 150, maxLv: 3, hp: 94, dmg: 15, rate: 1.22, range: 235, rangeType: 'radius', splash: 72,
    color: '#75ac62', glow: '#a8ea85',
    desc: L('unit.frog.desc', null, '舌弹射中目标后，会在落点造成范围伤害。'),
  },
  bee: {
    id: 'bee', animal: 'bee', behavior: 'chain',
    name: L('unit.bee.name', null, '雷针蜂群'), short: L('unit.bee.short', null, '蜂'),
    cost: 170, maxLv: 3, hp: 108, dmg: 14, rate: 1.0, radius: 202, chain: 4,
    color: '#d5b94c', glow: '#fff08b',
    desc: L('unit.bee.desc', null, '蜂群在多个目标间高速连锁蜇击。'),
  },
  turtle: {
    id: 'turtle', animal: 'turtle', behavior: 'aura',
    name: L('unit.turtle.name', null, '磐甲海龟'), short: L('unit.turtle.short', null, '龟'),
    cost: 165, maxLv: 3, hp: 235, dmg: 2.2, radius: 168, slow: 0.25,
    color: '#557e68', glow: '#a3d6a0',
    desc: L('unit.turtle.desc', null, '厚甲耐打，周围寒气会持续减慢丧尸。'),
  },
  tiger: {
    id: 'tiger', animal: 'tiger', behavior: 'shot',
    name: L('unit.tiger.name', null, '裂夜虎'), short: L('unit.tiger.short', null, '虎'),
    cost: 190, maxLv: 3, hp: 124, dmg: 58, rate: 1.95, range: 430, rangeType: 'radius',
    critChance: 0.30, critMul: 2.0, color: '#c56d34', glow: '#ffba67',
    desc: L('unit.tiger.desc', null, '扑击凶狠，长距离攻击常能一击暴击。'),
  },
  phoenix: {
    id: 'phoenix', animal: 'phoenix', behavior: 'healer',
    name: L('unit.phoenix.name', null, '余烬凤凰'), short: L('unit.phoenix.short', null, '凰'),
    cost: 200, maxLv: 3, hp: 138, dmg: 9, rate: 1.1, radius: 195, heal: 11, burnDps: 3.5, burnT: 1.8,
    color: '#d45437', glow: '#ffbd67',
    desc: L('unit.phoenix.desc', null, '灼烧附近丧尸，同时为受伤伙伴恢复生命。'),
  },
};

var UNIT_ORDER = [
  'barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla',
  'sniper', 'venom', 'frost', 'quake', 'railgun', 'totem',
  'wolf', 'owl', 'boar', 'chameleon', 'elephant', 'frog', 'bee', 'turtle', 'tiger', 'phoenix',
];

var UNIT_UNLOCK_GROUPS = [
  { rank: 0, units: ['barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla'] },
  { rank: 100, units: ['sniper', 'venom'] },
  { rank: 500, units: ['frost', 'quake'] },
  { rank: 1000, units: ['railgun', 'totem'] },
  { rank: 1500, units: ['wolf', 'owl'] },
  { rank: 2000, units: ['boar', 'chameleon'] },
  { rank: 2500, units: ['elephant', 'frog'] },
  { rank: 3000, units: ['bee', 'turtle'] },
  { rank: 3500, units: ['tiger', 'phoenix'] },
];

function unlockedUnitIds(score) {
  var s = Math.max(0, Number(score) || 0);
  var out = [];
  for (var i = 0; i < UNIT_UNLOCK_GROUPS.length; i++) {
    var group = UNIT_UNLOCK_GROUPS[i];
    if (s >= group.rank) out = out.concat(group.units);
  }
  return out;
}

function unitUnlockRank(typeId) {
  for (var i = 0; i < UNIT_UNLOCK_GROUPS.length; i++) {
    if (UNIT_UNLOCK_GROUPS[i].units.indexOf(typeId) >= 0) return UNIT_UNLOCK_GROUPS[i].rank;
  }
  return 0;
}

function normalizeLoadout(ids, score) {
  var unlocked = unlockedUnitIds(score);
  var out = [];
  var seen = {};
  ids = Array.isArray(ids) ? ids : [];
  for (var i = 0; i < ids.length && out.length < 6; i++) {
    var id = ids[i];
    if (unlocked.indexOf(id) >= 0 && !seen[id]) { seen[id] = true; out.push(id); }
  }
  for (var j = 0; j < unlocked.length && out.length < 6; j++) {
    if (!seen[unlocked[j]]) { seen[unlocked[j]] = true; out.push(unlocked[j]); }
  }
  return out;
}

/* ------------------------- 首次升级形态 ------------------------- */
/* lv2/lv3 是形态自身的局部修正，最后叠加到等级成长和全局遗物之后。 */
var ANIMAL_COMMON_FORMS = [
  {
    id: 'fierce', name: L('form.animal.fierce.name', null, '凶猛'), icon: '✦',
    role: L('form.animal.fierce.role', null, '攻击'), color: '#f39a66',
    desc: L('form.animal.fierce.desc', null, '练出更强的扑击、蜇刺或吐息。'),
    effect2: L('form.animal.fierce.effect2', null, '伤害 ×1.25'), effect3: L('form.animal.fierce.effect3', null, '伤害 ×1.50'),
    lv2: { dmgMul: 1.25 }, lv3: { dmgMul: 1.50 },
  },
  {
    id: 'swift', name: L('form.animal.swift.name', null, '迅捷'), icon: '➤',
    role: L('form.animal.swift.role', null, '攻速'), color: '#8fe3dc',
    desc: L('form.animal.swift.desc', null, '动作更轻快，可以更频繁地出手。'),
    effect2: L('form.animal.swift.effect2', null, '攻速 ×1.25'), effect3: L('form.animal.swift.effect3', null, '攻速 ×1.45'),
    lv2: { attackSpeedMul: 1.25 }, lv3: { attackSpeedMul: 1.45 },
  },
  {
    id: 'sturdy', name: L('form.animal.sturdy.name', null, '坚韧'), icon: '⬟',
    role: L('form.animal.sturdy.role', null, '耐久'), color: '#a9c780',
    desc: L('form.animal.sturdy.desc', null, '体魄更结实，能承受更多伤害。'),
    effect2: L('form.animal.sturdy.effect2', null, '生命上限 ×1.25'), effect3: L('form.animal.sturdy.effect3', null, '生命上限 ×1.45'),
    lv2: { hpMul: 1.25 }, lv3: { hpMul: 1.45 },
  },
];

var FORMS = {
  barricade: [
    {
      id: 'ironwall',
      name: L('form.barricade.ironwall.name', null, '铁壁'),
      icon: '▣',
      role: L('form.barricade.ironwall.role', null, '耐久'), color: '#b9c2cc',
      desc: L('form.barricade.ironwall.desc', null, '整面铁皮替下临时木板，单纯活得更久。'),
      effect2: L('form.barricade.ironwall.effect2', null, '生命上限 ×1.28'), effect3: L('form.barricade.ironwall.effect3', null, '生命上限 ×1.45'),
      lv2: { hpMul: 1.28 }, lv3: { hpMul: 1.45 },
    },
    {
      id: 'thornwall',
      name: L('form.barricade.thornwall.name', null, '尖刺反甲'),
      icon: '✹',
      role: L('form.barricade.thornwall.role', null, '反伤'), color: '#c46a52',
      desc: L('form.barricade.thornwall.desc', null, '铁皮外钉满锈刺，啃墙的丧尸会一起流血。'),
      effect2: L('form.barricade.thornwall.effect2', null, '生命 ×1.08 · 受击反伤 8/s'), effect3: L('form.barricade.thornwall.effect3', null, '生命 ×1.18 · 受击反伤 14/s'),
      lv2: { hpMul: 1.08, retalAdd: 8 }, lv3: { hpMul: 1.18, retalAdd: 14 },
    },
    {
      id: 'gatewall',
      name: L('form.barricade.gatewall.name', null, '门闩'),
      icon: '⊣',
      role: L('form.barricade.gatewall.role', null, '控制'), color: '#9ed6d8',
      desc: L('form.barricade.gatewall.desc', null, '墙倒时扯断门闩，把身后那条路也封住。'),
      effect2: L('form.barricade.gatewall.effect2', null, '生命 ×1.16 · 倒下减速 35%/1.2s'), effect3: L('form.barricade.gatewall.effect3', null, '生命 ×1.30 · 倒下减速 55%/1.6s'),
      lv2: { hpMul: 1.16, deathSlowAmt: 0.35, deathSlowT: 1.2 },
      lv3: { hpMul: 1.30, deathSlowAmt: 0.55, deathSlowT: 1.6 },
    },
  ],
  spike: [
    {
      id: 'bleedteeth',
      name: L('form.spike.bleedteeth.name', null, '放血齿'),
      icon: '⋕',
      role: L('form.spike.bleedteeth.role', null, '爆发'), color: '#e48a62',
      desc: L('form.spike.bleedteeth.desc', null, '齿刃磨得极薄，用脆弱换来更狠的穿刺。'),
      effect2: L('form.spike.bleedteeth.effect2', null, '生命 ×0.90 · 反伤 ×1.45'), effect3: L('form.spike.bleedteeth.effect3', null, '生命 ×0.95 · 反伤 ×1.70'),
      lv2: { hpMul: 0.90, retalMul: 1.45 }, lv3: { hpMul: 0.95, retalMul: 1.70 },
    },
    {
      id: 'hookspikes',
      name: L('form.spike.hookspikes.name', null, '钩镰刺'),
      icon: '⌓',
      role: L('form.spike.hookspikes.role', null, '控制'), color: '#9ed6d8',
      desc: L('form.spike.hookspikes.desc', null, '倒钩咬进腐肉，被扯住的丧尸短暂僵直。'),
      effect2: L('form.spike.hookspikes.effect2', null, '反伤 ×0.90 · 18% 眩晕 0.5s'), effect3: L('form.spike.hookspikes.effect3', null, '反伤 ×1.00 · 28% 眩晕 0.7s'),
      lv2: { retalMul: 0.90, stunChance: 0.18, stunDur: 0.5 },
      lv3: { retalMul: 1.00, stunChance: 0.28, stunDur: 0.7 },
    },
    {
      id: 'phosphorspikes',
      name: L('form.spike.phosphorspikes.name', null, '磷火刺'),
      icon: '♨',
      role: L('form.spike.phosphorspikes.role', null, '持续'), color: '#8fd8b7',
      desc: L('form.spike.phosphorspikes.desc', null, '刺尖涂着冷磷，伤口会一路烧进躯体。'),
      effect2: L('form.spike.phosphorspikes.effect2', null, '附加灼烧 3/s，持续 1.5s'), effect3: L('form.spike.phosphorspikes.effect3', null, '反伤 ×1.10 · 灼烧 5/s，持续 2.0s'),
      lv2: { retalMul: 1.00, burnDps: 3, burnT: 1.5 },
      lv3: { retalMul: 1.10, burnDps: 5, burnT: 2.0 },
    },
  ],
  turret: [
    {
      id: 'armorpiercing',
      name: L('form.turret.armorpiercing.name', null, '破甲弩'),
      icon: '➤',
      role: L('form.turret.armorpiercing.role', null, '爆发'), color: '#f0bd72',
      desc: L('form.turret.armorpiercing.desc', null, '重型弩箭慢半拍，但能直接撕开厚甲。'),
      effect2: L('form.turret.armorpiercing.effect2', null, '伤害 ×1.45 · 攻速 ×0.85'), effect3: L('form.turret.armorpiercing.effect3', null, '伤害 ×1.65 · 攻速 ×0.82'),
      lv2: { dmgMul: 1.45, attackSpeedMul: 0.85 }, lv3: { dmgMul: 1.65, attackSpeedMul: 0.82 },
    },
    {
      id: 'rapidbow',
      name: L('form.turret.rapidbow.name', null, '连发弩'),
      icon: '⇉',
      role: L('form.turret.rapidbow.role', null, '持续'), color: '#d8d1c2',
      desc: L('form.turret.rapidbow.desc', null, '双组弦轮轮替上弦，箭雨更密但单发更轻。'),
      effect2: L('form.turret.rapidbow.effect2', null, '伤害 ×0.82 · 攻速 ×1.32'), effect3: L('form.turret.rapidbow.effect3', null, '伤害 ×0.88 · 攻速 ×1.45'),
      lv2: { dmgMul: 0.82, attackSpeedMul: 1.32 }, lv3: { dmgMul: 0.88, attackSpeedMul: 1.45 },
    },
    {
      id: 'trackerbow',
      name: L('form.turret.trackerbow.name', null, '追迹弩'),
      icon: '⌖',
      role: L('form.turret.trackerbow.role', null, '远程'), color: '#9ed6d8',
      desc: L('form.turret.trackerbow.desc', null, '刻着旧猎人记号的箭，会从远处咬住要害。'),
      effect2: L('form.turret.trackerbow.effect2', null, '半径 +2.0格 · 18% 暴击 ×1.8'), effect3: L('form.turret.trackerbow.effect3', null, '半径 +3.0格 · 28% 暴击 ×1.8'),
      lv2: { rangeAdd: 90, dmgMul: 0.95, critChance: 0.18, critMul: 1.8 },
      lv3: { rangeAdd: 130, dmgMul: 1.00, critChance: 0.28, critMul: 1.8 },
    },
  ],
  lamp: [
    {
      id: 'widebeam',
      name: L('form.lamp.widebeam.name', null, '广域冷光'),
      icon: '◉',
      role: L('form.lamp.widebeam.role', null, '范围'), color: '#b9d8ef',
      desc: L('form.lamp.widebeam.desc', null, '散光罩把灯压得更宽，控制更强、照伤更弱。'),
      effect2: L('form.lamp.widebeam.effect2', null, '半径 +1.6格 · 减速 +10% · 伤害 ×0.80'), effect3: L('form.lamp.widebeam.effect3', null, '半径 +2.6格 · 减速 +16% · 伤害 ×0.85'),
      lv2: { radiusAdd: 70, slowAdd: 0.10, dmgMul: 0.80 },
      lv3: { radiusAdd: 110, slowAdd: 0.16, dmgMul: 0.85 },
    },
    {
      id: 'sodiumflare',
      name: L('form.lamp.sodiumflare.name', null, '钠焰灯'),
      icon: '☀',
      role: L('form.lamp.sodiumflare.role', null, '灼烧'), color: '#ffc56b',
      desc: L('form.lamp.sodiumflare.desc', null, '刺鼻黄光把腐肉烤得发响，范围因此收窄。'),
      effect2: L('form.lamp.sodiumflare.effect2', null, '伤害 ×1.55 · 减速 ×0.70 · 半径 -0.8格'), effect3: L('form.lamp.sodiumflare.effect3', null, '伤害 ×1.80 · 减速 ×0.75 · 半径 -1.0格'),
      lv2: { dmgMul: 1.55, slowMul: 0.70, radiusAdd: -35 },
      lv3: { dmgMul: 1.80, slowMul: 0.75, radiusAdd: -45 },
    },
    {
      id: 'stroboscope',
      name: L('form.lamp.stroboscope.name', null, '频闪灯'),
      icon: '✦',
      role: L('form.lamp.stroboscope.role', null, '控制'), color: '#e9f6ff',
      desc: L('form.lamp.stroboscope.desc', null, '灯丝间歇爆闪，影子会在最亮的一瞬停住。'),
      effect2: L('form.lamp.stroboscope.effect2', null, '18% 眩晕 0.35s · 伤害 ×1.05'), effect3: L('form.lamp.stroboscope.effect3', null, '28% 眩晕 0.50s · 伤害 ×1.15'),
      lv2: { dmgMul: 1.05, slowMul: 0.90, strobeChance: 0.18, strobeDur: 0.35 },
      lv3: { dmgMul: 1.15, slowMul: 0.90, strobeChance: 0.28, strobeDur: 0.50 },
    },
  ],
  flame: [
    {
      id: 'fanfire',
      name: L('form.flame.fanfire.name', null, '扇面火'),
      icon: '♨',
      role: L('form.flame.fanfire.role', null, '清场'), color: '#ff9b62',
      desc: L('form.flame.fanfire.desc', null, '喷嘴改成扁扇口，用单点威力换横向覆盖。'),
      effect2: L('form.flame.fanfire.effect2', null, '喷幅 ×1.50 · 射程 +0.4格 · 伤害 ×0.78'), effect3: L('form.flame.fanfire.effect3', null, '喷幅 ×1.80 · 射程 +0.6格 · 伤害 ×0.82'),
      lv2: { sprayMul: 1.50, rangeAdd: 15, dmgMul: 0.78 },
      lv3: { sprayMul: 1.80, rangeAdd: 25, dmgMul: 0.82 },
    },
    {
      id: 'needlefire',
      name: L('form.flame.needlefire.name', null, '聚焰火'),
      icon: '⇧',
      role: L('form.flame.needlefire.role', null, '爆发'), color: '#ffd08a',
      desc: L('form.flame.needlefire.desc', null, '收束喷口把火焰压成一根刺，正前方最痛。'),
      effect2: L('form.flame.needlefire.effect2', null, '伤害 ×1.50 · 喷幅 ×0.70 · 射程 +0.2格'), effect3: L('form.flame.needlefire.effect3', null, '伤害 ×1.75 · 喷幅 ×0.65 · 射程 +0.4格'),
      lv2: { dmgMul: 1.50, sprayMul: 0.70, rangeAdd: 10 },
      lv3: { dmgMul: 1.75, sprayMul: 0.65, rangeAdd: 15 },
    },
    {
      id: 'emberfire',
      name: L('form.flame.emberfire.name', null, '余烬火'),
      icon: '◌',
      role: L('form.flame.emberfire.role', null, '持续'), color: '#e68a58',
      desc: L('form.flame.emberfire.desc', null, '低温长焰黏在腐肉上，熄灭前一直在烧。'),
      effect2: L('form.flame.emberfire.effect2', null, '攻速 ×1.30 · 灼烧 3/s，持续 1.2s'), effect3: L('form.flame.emberfire.effect3', null, '攻速 ×1.45 · 灼烧 5/s，持续 1.6s'),
      lv2: { attackSpeedMul: 1.30, dmgMul: 0.90, burnDps: 3, burnT: 1.2 },
      lv3: { attackSpeedMul: 1.45, dmgMul: 0.95, burnDps: 5, burnT: 1.6 },
    },
  ],
  tesla: [
    {
      id: 'topology',
      name: L('form.tesla.topology.name', null, '拓扑弧'),
      icon: '⌘',
      role: L('form.tesla.topology.role', null, '群攻'), color: '#9ed8ff',
      desc: L('form.tesla.topology.desc', null, '线圈绕成网状，电弧会继续跳向更远的目标。'),
      effect2: L('form.tesla.topology.effect2', null, '连锁 +2 · 伤害 ×0.78'), effect3: L('form.tesla.topology.effect3', null, '连锁 +3 · 伤害 ×0.82'),
      lv2: { chainAdd: 2, dmgMul: 0.78 }, lv3: { chainAdd: 3, dmgMul: 0.82 },
    },
    {
      id: 'lightningspear',
      name: L('form.tesla.lightningspear.name', null, '雷矛弧'),
      icon: 'ϟ',
      role: L('form.tesla.lightningspear.role', null, '单体'), color: '#dff7ff',
      desc: L('form.tesla.lightningspear.desc', null, '所有电荷压进一击，只够贯穿最前面的目标。'),
      effect2: L('form.tesla.lightningspear.effect2', null, '伤害 ×1.50 · 连锁 -1'), effect3: L('form.tesla.lightningspear.effect3', null, '伤害 ×1.75 · 连锁 -1'),
      lv2: { dmgMul: 1.50, chainAdd: -1 }, lv3: { dmgMul: 1.75, chainAdd: -1 },
    },
    {
      id: 'pulsecoil',
      name: L('form.tesla.pulsecoil.name', null, '震荡弧'),
      icon: '◎',
      role: L('form.tesla.pulsecoil.role', null, '范围'), color: '#8fe6e8',
      desc: L('form.tesla.pulsecoil.desc', null, '高频线圈向外鼓出，以更轻的电击罩住整片。'),
      effect2: L('form.tesla.pulsecoil.effect2', null, '攻速 ×1.30 · 半径 +0.8格 · 伤害 ×0.85'), effect3: L('form.tesla.pulsecoil.effect3', null, '攻速 ×1.45 · 半径 +1.2格 · 伤害 ×0.90'),
      lv2: { attackSpeedMul: 1.30, radiusAdd: 35, dmgMul: 0.85 },
      lv3: { attackSpeedMul: 1.45, radiusAdd: 55, dmgMul: 0.90 },
    },
  ],
  sniper: [
    {
      id: 'hollowpoint',
      name: L('form.sniper.hollowpoint.name', null, '裂甲弹'),
      icon: '✧',
      role: L('form.sniper.hollowpoint.role', null, '爆发'), color: '#ffbd82',
      desc: L('form.sniper.hollowpoint.desc', null, '弹头被刻意削开，命中后把腐肉撕得更深。'),
      effect2: L('form.sniper.hollowpoint.effect2', null, '伤害 ×1.35 · 攻速 ×1.15'), effect3: L('form.sniper.hollowpoint.effect3', null, '伤害 ×1.60 · 攻速 ×1.30'),
      lv2: { dmgMul: 1.35, attackSpeedMul: 1.15 }, lv3: { dmgMul: 1.60, attackSpeedMul: 1.30 },
    },
    {
      id: 'longscope',
      name: L('form.sniper.longscope.name', null, '远视镜'),
      icon: '◉',
      role: L('form.sniper.longscope.role', null, '射程'), color: '#9ed8ff',
      desc: L('form.sniper.longscope.desc', null, '镜片一路延伸到黑暗里，能在更远处锁定目标。'),
      effect2: L('form.sniper.longscope.effect2', null, '半径 +1.8格 · 伤害 ×0.90'), effect3: L('form.sniper.longscope.effect3', null, '半径 +3.0格 · 伤害 ×1.00'),
      lv2: { rangeAdd: 80, dmgMul: 0.90 }, lv3: { rangeAdd: 130, dmgMul: 1.00 },
    },
    {
      id: 'execution',
      name: L('form.sniper.execution.name', null, '处刑者'),
      icon: '✜',
      role: L('form.sniper.execution.role', null, '暴击'), color: '#ff8d9c',
      desc: L('form.sniper.execution.desc', null, '扳机被磨得极轻，偶尔会打出致命一击。'),
      effect2: L('form.sniper.execution.effect2', null, '暴击 18% · 暴击 ×1.80'), effect3: L('form.sniper.execution.effect3', null, '暴击 28% · 暴击 ×1.80'),
      lv2: { critChance: 0.18, critMul: 1.80 }, lv3: { critChance: 0.28, critMul: 1.80 },
    },
  ],
  venom: [
    {
      id: 'corrosive',
      name: L('form.venom.corrosive.name', null, '浓酸雾'),
      icon: '♨',
      role: L('form.venom.corrosive.role', null, '持续'), color: '#a8ff70',
      desc: L('form.venom.corrosive.desc', null, '雾滴变得更黏，伤口会持续冒出腐蚀烟。'),
      effect2: L('form.venom.corrosive.effect2', null, '腐蚀 +2/s · 持续 +0.5s'), effect3: L('form.venom.corrosive.effect3', null, '腐蚀 +3.5/s · 持续 +1.0s'),
      lv2: { burnDps: 2, burnT: 0.5 }, lv3: { burnDps: 3.5, burnT: 1.0 },
    },
    {
      id: 'widemist',
      name: L('form.venom.widemist.name', null, '广角雾'),
      icon: '◌',
      role: L('form.venom.widemist.role', null, '清场'), color: '#8fe6a8',
      desc: L('form.venom.widemist.desc', null, '喷口变宽，毒雾像帘子一样罩住整条通道。'),
      effect2: L('form.venom.widemist.effect2', null, '喷幅 ×1.50 · 伤害 ×0.80'), effect3: L('form.venom.widemist.effect3', null, '喷幅 ×1.80 · 伤害 ×0.85'),
      lv2: { sprayMul: 1.50, dmgMul: 0.80 }, lv3: { sprayMul: 1.80, dmgMul: 0.85 },
    },
    {
      id: 'virulent',
      name: L('form.venom.virulent.name', null, '狂病毒'),
      icon: '☣',
      role: L('form.venom.virulent.role', null, '爆发'), color: '#d5ff65',
      desc: L('form.venom.virulent.desc', null, '毒性被压缩进短促喷发，第一口就足够痛。'),
      effect2: L('form.venom.virulent.effect2', null, '伤害 ×1.30 · 攻速 ×1.10'), effect3: L('form.venom.virulent.effect3', null, '伤害 ×1.50 · 攻速 ×1.20'),
      lv2: { dmgMul: 1.30, attackSpeedMul: 1.10 }, lv3: { dmgMul: 1.50, attackSpeedMul: 1.20 },
    },
  ],
  frost: [
    {
      id: 'deepchill',
      name: L('form.frost.deepchill.name', null, '深寒'),
      icon: '❄',
      role: L('form.frost.deepchill.role', null, '控制'), color: '#a7e7ff',
      desc: L('form.frost.deepchill.desc', null, '井底的寒气更沉，丧尸的脚步会被拖住。'),
      effect2: L('form.frost.deepchill.effect2', null, '减速 +10%'), effect3: L('form.frost.deepchill.effect3', null, '减速 +15%'),
      lv2: { slowAdd: 0.10 }, lv3: { slowAdd: 0.15 },
    },
    {
      id: 'widefrost',
      name: L('form.frost.widefrost.name', null, '霜环'),
      icon: '◎',
      role: L('form.frost.widefrost.role', null, '范围'), color: '#c6f4ff',
      desc: L('form.frost.widefrost.desc', null, '冷气向四周铺开，牺牲单点威力换更大控制面。'),
      effect2: L('form.frost.widefrost.effect2', null, '寒域 +1.0格 · 伤害 ×0.80'), effect3: L('form.frost.widefrost.effect3', null, '寒域 +1.6格 · 伤害 ×0.85'),
      lv2: { radiusAdd: 40, dmgMul: 0.80 }, lv3: { radiusAdd: 70, dmgMul: 0.85 },
    },
    {
      id: 'icebind',
      name: L('form.frost.icebind.name', null, '冰缚'),
      icon: '◈',
      role: L('form.frost.icebind.role', null, '单体'), color: '#8fbaff',
      desc: L('form.frost.icebind.desc', null, '霜气聚成一根尖刺，持续咬住最靠近的目标。'),
      effect2: L('form.frost.icebind.effect2', null, '伤害 ×1.45 · 减速 +4%'), effect3: L('form.frost.icebind.effect3', null, '伤害 ×1.70 · 减速 +7%'),
      lv2: { dmgMul: 1.45, slowAdd: 0.04 }, lv3: { dmgMul: 1.70, slowAdd: 0.07 },
    },
  ],
  quake: [
    {
      id: 'thunderclap',
      name: L('form.quake.thunderclap.name', null, '雷鸣震'),
      icon: '✹',
      role: L('form.quake.thunderclap.role', null, '控制'), color: '#ffd37e',
      desc: L('form.quake.thunderclap.desc', null, '钟舌包上铁片，震波会把丧尸钉在原地。'),
      effect2: L('form.quake.thunderclap.effect2', null, '击晕 +0.20s · 伤害 ×1.10'), effect3: L('form.quake.thunderclap.effect3', null, '击晕 +0.35s · 伤害 ×1.25'),
      lv2: { strobeDur: 0.20, dmgMul: 1.10 }, lv3: { strobeDur: 0.35, dmgMul: 1.25 },
    },
    {
      id: 'seismic',
      name: L('form.quake.seismic.name', null, '地脉震'),
      icon: '⌁',
      role: L('form.quake.seismic.role', null, '范围'), color: '#e4b56e',
      desc: L('form.quake.seismic.desc', null, '底座嵌进地面，冲击波扩散得更远。'),
      effect2: L('form.quake.seismic.effect2', null, '震域 +1.0格 · 伤害 ×0.80'), effect3: L('form.quake.seismic.effect3', null, '震域 +1.8格 · 伤害 ×0.85'),
      lv2: { radiusAdd: 45, dmgMul: 0.80 }, lv3: { radiusAdd: 75, dmgMul: 0.85 },
    },
    {
      id: 'quickdrum',
      name: L('form.quake.quickdrum.name', null, '急鼓'),
      icon: '◌',
      role: L('form.quake.quickdrum.role', null, '攻速'), color: '#ffe2a3',
      desc: L('form.quake.quickdrum.desc', null, '钟槌换成轻木，敲击频率明显变快。'),
      effect2: L('form.quake.quickdrum.effect2', null, '攻速 ×1.35 · 伤害 ×0.82'), effect3: L('form.quake.quickdrum.effect3', null, '攻速 ×1.55 · 伤害 ×0.88'),
      lv2: { attackSpeedMul: 1.35, dmgMul: 0.82 }, lv3: { attackSpeedMul: 1.55, dmgMul: 0.88 },
    },
  ],
  railgun: [
    {
      id: 'capacitor',
      name: L('form.railgun.capacitor.name', null, '过载电容'),
      icon: '⚡',
      role: L('form.railgun.capacitor.role', null, '爆发'), color: '#a7d7ff',
      desc: L('form.railgun.capacitor.desc', null, '电容一次性放电，炮口的蓝光几乎不熄。'),
      effect2: L('form.railgun.capacitor.effect2', null, '伤害 ×1.40 · 攻速 ×1.15'), effect3: L('form.railgun.capacitor.effect3', null, '伤害 ×1.70 · 攻速 ×1.30'),
      lv2: { dmgMul: 1.40, attackSpeedMul: 1.15 }, lv3: { dmgMul: 1.70, attackSpeedMul: 1.30 },
    },
    {
      id: 'widecoil',
      name: L('form.railgun.widecoil.name', null, '扩散线圈'),
      icon: '◎',
      role: L('form.railgun.widecoil.role', null, '范围'), color: '#8fe6ff',
      desc: L('form.railgun.widecoil.desc', null, '弹丸带着一圈磁场，落点会向两侧撕开。'),
      effect2: L('form.railgun.widecoil.effect2', null, '溅射 ×1.45 · 伤害 ×0.75'), effect3: L('form.railgun.widecoil.effect3', null, '溅射 ×1.80 · 伤害 ×0.80'),
      lv2: { splashMul: 1.45, dmgMul: 0.75 }, lv3: { splashMul: 1.80, dmgMul: 0.80 },
    },
    {
      id: 'penetrator',
      name: L('form.railgun.penetrator.name', null, '贯穿体'),
      icon: '➟',
      role: L('form.railgun.penetrator.role', null, '射程'), color: '#d6f2ff',
      desc: L('form.railgun.penetrator.desc', null, '炮管被拉长，弹丸从更远的地方抵达。'),
      effect2: L('form.railgun.penetrator.effect2', null, '半径 +2.4格 · 伤害 ×1.10'), effect3: L('form.railgun.penetrator.effect3', null, '半径 +3.8格 · 伤害 ×1.20'),
      lv2: { rangeAdd: 100, dmgMul: 1.10 }, lv3: { rangeAdd: 160, dmgMul: 1.20 },
    },
  ],
  totem: [
    {
      id: 'marrow',
      name: L('form.totem.marrow.name', null, '骨髓契'),
      icon: '✚',
      role: L('form.totem.marrow.role', null, '治疗'), color: '#ff9fb3',
      desc: L('form.totem.marrow.desc', null, '图腾从骨髓里榨出暖意，治疗量更高。'),
      effect2: L('form.totem.marrow.effect2', null, '治疗 ×1.35 · 伤害 ×0.80'), effect3: L('form.totem.marrow.effect3', null, '治疗 ×1.60 · 伤害 ×0.85'),
      lv2: { healMul: 1.35, dmgMul: 0.80 }, lv3: { healMul: 1.60, dmgMul: 0.85 },
    },
    {
      id: 'broadpact',
      name: L('form.totem.broadpact.name', null, '广域契'),
      icon: '⌁',
      role: L('form.totem.broadpact.role', null, '范围'), color: '#ffb7c6',
      desc: L('form.totem.broadpact.desc', null, '血线向两侧伸展，更多友军能分到一口回复。'),
      effect2: L('form.totem.broadpact.effect2', null, '光环 +1.0格 · 治疗 ×0.90'), effect3: L('form.totem.broadpact.effect3', null, '光环 +1.6格 · 治疗 ×0.95'),
      lv2: { radiusAdd: 40, healMul: 0.90 }, lv3: { radiusAdd: 70, healMul: 0.95 },
    },
    {
      id: 'quickpact',
      name: L('form.totem.quickpact.name', null, '急律契'),
      icon: '◌',
      role: L('form.totem.quickpact.role', null, '节奏'), color: '#ff8ea6',
      desc: L('form.totem.quickpact.desc', null, '契约节拍变快，抽血和治疗都更频繁。'),
      effect2: L('form.totem.quickpact.effect2', null, '攻速 ×1.35 · 治疗 ×1.10'), effect3: L('form.totem.quickpact.effect3', null, '攻速 ×1.55 · 治疗 ×1.20'),
      lv2: { attackSpeedMul: 1.35, healMul: 1.10 }, lv3: { attackSpeedMul: 1.55, healMul: 1.20 },
    },
  ],
  wolf: ANIMAL_COMMON_FORMS,
  owl: ANIMAL_COMMON_FORMS,
  boar: ANIMAL_COMMON_FORMS,
  chameleon: ANIMAL_COMMON_FORMS,
  elephant: ANIMAL_COMMON_FORMS,
  frog: ANIMAL_COMMON_FORMS,
  bee: ANIMAL_COMMON_FORMS,
  turtle: ANIMAL_COMMON_FORMS,
  tiger: ANIMAL_COMMON_FORMS,
  phoenix: ANIMAL_COMMON_FORMS,
};

function getForm(typeId, formId) {
  var list = FORMS[typeId] || [];
  for (var i = 0; i < list.length; i++) if (list[i].id === formId) return list[i];
  return {
    id: 'neutral', icon: '◇', color: '#b9c2cc',
    name: L('form.neutral.name', null, '标准型'),
    role: L('form.neutral.role', null, '标准'),
    desc: L('form.neutral.desc', null, '没有额外改造的基础形态。'), effect2: '', effect3: '',
    lv2: {}, lv3: {},
  };
}

/* ------------------------- 丧尸 ------------------------- */
var ZOMBIES = {
  bug:      { id: 'bug', name: L('zombie.bug.name', null, '小虫子'), hp: 8, speed: 42, dmg: 1, rate: 0.9, r: 9, tint: '#a68b46', aggro: 28 },
  walker:   { id: 'walker',   name: L('zombie.walker.name', null, '蹒跚者'), hp: 34,  speed: 26, dmg: 3,  rate: 1.1, r: 17, tint: '#7c8a70', aggro: 34 },
  runner:   { id: 'runner',   name: L('zombie.runner.name', null, '奔逃者'), hp: 22,  speed: 64, dmg: 2,  rate: 0.7, r: 14, tint: '#8fa07a', aggro: 34 },
  screamer: { id: 'screamer', name: L('zombie.screamer.name', null, '尖啸者'), hp: 30,  speed: 40, dmg: 2,  rate: 0.9, r: 16, tint: '#b3945f', aggro: 34,
              boom: 30, boomR: 92 },
  brute:    { id: 'brute',    name: L('zombie.brute.name', null, '肿汉'),   hp: 155, speed: 19, dmg: 9,  rate: 1.6, r: 27, tint: '#69765f', aggro: 38 },
  tank:     { id: 'tank',     name: L('zombie.tank.name', null, '铁皮尸'), hp: 330, speed: 13, dmg: 15, rate: 2.0, r: 33, tint: '#585f56', aggro: 42 },
};

/* ------------------------- 遗物（背包装 build） ------------------------- */
var RELICS = [
  { id: 'foundation', name: L('relic.foundation.name', null, '加固地基'), icon: '⌂', text: L('relic.foundation.text', null, '家园血量上限 +35'), props: { homeHp: 35 } },
  { id: 'gears',      name: L('relic.gears.name', null, '黄铜齿轮'), icon: '⚙', text: L('relic.gears.text', null, '所有单位攻击速度 +18%'), props: { rateMul: 0.82 } },
  { id: 'steel',      name: L('relic.steel.name', null, '淬火钢'),   icon: '▤', text: L('relic.steel.text', null, '所有单位血量 +28%'), props: { hpMul: 1.28 } },
  { id: 'powder',     name: L('relic.powder.name', null, '黑火药'),   icon: '✦', text: L('relic.powder.text', null, '所有单位伤害 +22%'), props: { dmgMul: 1.22 } },
  { id: 'satchel',    name: L('relic.satchel.name', null, '拾荒背囊'), icon: '◍', text: L('relic.satchel.text', null, '每小局额外收入 +30'), props: { income: 30 } },
  { id: 'lore',       name: L('relic.lore.name', null, '尸学笔记'), icon: '❖', text: L('relic.lore.text', null, '丧尸移动速度 -12%'), props: { zombieSpeedMul: 0.88 } },
  { id: 'spares',     name: L('relic.spares.name', null, '备用零件'), icon: '✚', text: L('relic.spares.text', null, '家园血量上限 +25，每小局满血开局'), props: { homeHp: 25 } },
  { id: 'doublebow',  name: L('relic.doublebow.name', null, '双管弹弹果核'), icon: '⇉', text: L('relic.doublebow.text', null, '浣熊每次额外射出一枚果核'), props: { turretShots: 1 } },
  { id: 'coldlight',  name: L('relic.coldlight.name', null, '冷光萤火'), icon: '☾', text: L('relic.coldlight.text', null, '萤火虫减速效果 +15%，半径 +0.7格'), props: { slowAdd: 0.15, lampRange: 30 } },
  { id: 'fuse',       name: L('relic.fuse.name', null, '感应引信'), icon: '✷', text: L('relic.fuse.text', null, '钉刺伤害 +65%'), props: { spikeMul: 1.65 } },
  { id: 'overload',   name: L('relic.overload.name', null, '电弧过载'), icon: '⚡', text: L('relic.overload.text', null, '雷纹鳗可多连锁 1 个目标'), props: { chainAdd: 1 } },
  { id: 'ration',     name: L('relic.ration.name', null, '荧光口粮'), icon: '◉', text: L('relic.ration.text', null, '每小局额外收入 +15'), props: { income: 15 } },
];

/* ------------------------- 段位 ------------------------- */
var RANKS = [
  { min: 0,    name: L('rank.r0.name', null, '拾荒者'),     color: '#8a8f98', pressure: 1.00 },
  { min: 350,  name: L('rank.r1.name', null, '木屋守夜人'), color: '#a98b5a', pressure: 1.04 },
  { min: 800,  name: L('rank.r2.name', null, '铁闸守卫'),   color: '#7fb7c9', pressure: 1.09 },
  { min: 1350, name: L('rank.r3.name', null, '加固工头'),   color: '#8fd08a', pressure: 1.14 },
  { min: 2000, name: L('rank.r4.name', null, '堡垒指挥官'), color: '#c79ada', pressure: 1.20 },
  { min: 2800, name: L('rank.r5.name', null, '永夜要塞'),   color: '#ff9a6a', pressure: 1.27 },
];

function rankFor(score) {
  var r = RANKS[0];
  for (var i = 0; i < RANKS.length; i++) if (score >= RANKS[i].min) r = RANKS[i];
  return r;
}
function nextRank(score) {
  for (var i = 0; i < RANKS.length; i++) if (score < RANKS[i].min) return RANKS[i];
  return null;
}

/* 排位压力在段位区间内连续增长；升段时数值连续，不会突然跳变。 */
function rankPressure(score) {
  var s = Math.max(0, Number(score) || 0);
  for (var i = RANKS.length - 1; i >= 0; i--) {
    var cur = RANKS[i];
    if (s < cur.min) continue;
    var next = RANKS[i + 1];
    if (!next) return cur.pressure;
    var p = clamp((s - cur.min) / (next.min - cur.min), 0, 1);
    return lerp(cur.pressure, next.pressure, p);
  }
  return RANKS[0].pressure;
}

/* 高分段成长拆成两段：
   1. 对手资金每 1000 分复利 +10%，封顶 2.5 倍，避免地图格子花不完；
   2. 每 5000 分进入一层“永续层”，攻击、血量、遗物质量与决策持续成长。 */
function rankThreat(score) {
  var s = Math.max(0, Number(score) || 0);
  var budgetSteps = Math.floor(s / CONFIG.RANK_BUDGET_STEP);
  var budgetMultiplier = Math.min(
    Math.pow(CONFIG.RANK_BUDGET_GROWTH, budgetSteps),
    CONFIG.RANK_BUDGET_CAP
  );
  var eternalTier = Math.floor(s / CONFIG.RANK_ETERNAL_STEP);
  return {
    budgetMultiplier: budgetMultiplier,
    budgetBonus: budgetMultiplier - 1,
    eternalTier: eternalTier,
    powerMultiplier: 1 + eternalTier * CONFIG.RANK_POWER_PER_TIER,
    decisionMultiplier: 1 + eternalTier * CONFIG.RANK_DECISION_PER_TIER,
  };
}

/* ------------------------- 小工具 ------------------------- */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function pick(arr, rnd) { return arr[(rnd() * arr.length) | 0]; }

/* ------------------------- 经济 / 数值助手 ------------------------- */
function upgradeCost(typeId, lv) {
  return Math.round(UNITS[typeId].cost * (0.75 + 0.55 * lv));
}
function unitHpAt(typeId, lv) {
  return Math.round(UNITS[typeId].hp * Math.pow(1.35, lv - 1));
}
function unitDmgAt(typeId, lv) {
  var d = UNITS[typeId];
  return d.dmg ? +(d.dmg * Math.pow(1.42, lv - 1)).toFixed(1) : 0;
}

function cellsLabel(value, step) {
  var cells = Math.max(0, value) / (step || CONFIG.GRID_COL_PITCH);
  return (cells >= 10 ? cells.toFixed(0) : cells.toFixed(1)) + L('combat.cellUnit', null, '格');
}

function unitCombatStats(typeId, lv, formId, mods) {
  var d = UNITS[typeId];
  var f = getForm(typeId, formId);
  var fs = lv >= 3 ? f.lv3 : (lv === 2 ? f.lv2 : {});
  mods = mods || {};
  var rangeMod = d.rangeMod ? (mods[d.rangeMod] || 0) : 0;
  var slowMod = d.slowMod ? (mods[d.slowMod] || 0) : 0;
  var radialTower = d.rangeType === 'radius';
  var rangeAdd = fs.rangeAdd || 0;
  var radiusAdd = fs.radiusAdd || 0;
  return {
    range: radialTower ? 0 : Math.max(0, combatReachX((d.range || 0) + rangeMod + rangeAdd)),
    radius: Math.max(0, combatReachX((radialTower ? (d.range || 0) : (d.radius || 0)) +
      rangeMod +
      (radialTower ? rangeAdd : radiusAdd))),
    spray: Math.max(0, rangeScaleY(d.spray || 0) *
      (fs.sprayMul === undefined ? 1 : fs.sprayMul)),
    chain: d.chain ? Math.max(1, d.chain +
      (mods.chainAdd || 0) + (fs.chainAdd || 0)) : 0,
    rate: d.rate ? d.rate * (mods.rateMul || 1) /
      (fs.attackSpeedMul === undefined ? 1 : fs.attackSpeedMul) : 0,
    slow: d.slow !== undefined
      ? clamp(((d.slow || 0) + slowMod) *
        (fs.slowMul === undefined ? 1 : fs.slowMul) +
        (fs.slowAdd || 0), 0, 0.75)
      : 0,
    splash: Math.max(0, rangeScaleX(d.splash || 0) *
      (fs.splashMul === undefined ? 1 : fs.splashMul)),
    heal: Math.max(0, (d.heal || 0) *
      (fs.healMul === undefined ? 1 : fs.healMul)),
    burnDps: Math.max(0, (d.burnDps || 0) + (fs.burnDps || 0)),
    burnT: Math.max(0, Math.max(d.burnT || 0, fs.burnT || 0)),
    strobeChance: clamp((d.strobeChance || 0) + (fs.strobeChance || 0), 0, 1),
    strobeDur: Math.max(0, (d.strobeDur || 0) + (fs.strobeDur || 0)),
    critChance: clamp((d.critChance || 0) + (fs.critChance || 0), 0, 1),
    critMul: Math.max(d.critMul || 1, fs.critMul || 1),
  };
}

function unitRangeLabel(typeId, lv, formId, mods, compact) {
  var d = UNITS[typeId];
  var stats = unitCombatStats(typeId, lv, formId, mods);
  /* 卡片只有 132px 宽，英文最长的组合（Venom Tank 的射程+喷幅+攻速+腐蚀）
     一定要换行。射程在备战期本来就是「放下之后再调」的东西，详情面板里
     仍然完整给，卡片上让给它，整行统计就能一行放下、12 张卡一样高。 */
  if (compact) return '';
  var rangeWord = L('combat.range', null, '射程');
  if (d.rangeType === 'radius') return L('combat.radius', null, '半径') + ' ' + cellsLabel(stats.radius);
  if (d.range) return rangeWord + ' ' + cellsLabel(stats.range);
  if (d.radius) {
    /* rangeName 在 UNITS 上就已经是 L('rangeName.*') 的结果（寒域/震域/光环）。
       没带的单位只有探照灯，单独给个通用词。 */
    var rn = d.rangeName ||
      (typeId === 'lamp' ? L('combat.radiusRange', null, '范围') : L('combat.radius', null, '半径'));
    return rn + ' ' + cellsLabel(stats.radius);
  }
  return '';
}

/* compact = true 时用 combatShort 里的极短词，给 DOM 卡片用（宽度只有 132px）。
   游戏内的单位详情面板不传，走完整表述。 */
function unitCombatText(typeId, lv, formId, mods, compact) {
  var W = function (key, fallback) {
    return compact
      ? L('combatShort.' + key, null, L('combat.' + key, null, fallback))
      : L('combat.' + key, null, fallback);
  };
  var d = UNITS[typeId];
  var stats = unitCombatStats(typeId, lv, formId, mods);
  var parts = [];
  var rangeLabel = unitRangeLabel(typeId, lv, formId, mods, compact);
  if (rangeLabel) parts.push(rangeLabel);
  /* 喷幅只在详情面板里给。卡片上它是第三条统计，会把 Venom Tank 那行顶到
     第二行（英文要 204u，卡片内宽只有 ~228u，两行就翻出卡片下边框）。 */
  if (d.spray && !compact) parts.push(W('spray', '喷幅') + ' ' + cellsLabel(stats.spray, CONFIG.GRID_LANE_PITCH));
  if (d.splash) parts.push(W('splash', '溅射') + ' ' + cellsLabel(stats.splash));
  if (d.chain) parts.push(W('chain', '连锁') + ' ' + stats.chain);
  if (d.rate && stats.rate > 0) {
    parts.push(W('rate', '攻速') + ' ' + (1 / stats.rate).toFixed(2) + (compact ? '×' : '/s'));
  }
  if (d.slow !== undefined) {
    parts.push(W('slow', '减速') + ' ' + Math.round(stats.slow * 100) + '%');
  }
  if (stats.burnDps) {
    parts.push(W('burn', '腐蚀') + ' ' + stats.burnDps.toFixed(1) + '/s');
  }
  if (d.heal && stats.rate > 0) {
    parts.push(W('heal', '治疗') + ' ' + (stats.heal / stats.rate).toFixed(1) + '/s');
  }
  if (d.strobeChance) {
    parts.push(W('stun', '击晕') + ' ' + Math.round(stats.strobeChance * 100) + '%');
  }
  if (d.critChance || stats.critChance) {
    parts.push(W('crit', '暴击') + ' ' + Math.round(stats.critChance * 100) + '%');
  }
  if (!parts.length && d.dmg) parts.push(W('contact', '接触反伤'));
  return parts.join(' · ');
}
function sellValue(typeId, lv) {
  var total = UNITS[typeId].cost;
  for (var i = 1; i < lv; i++) total += upgradeCost(typeId, i);
  return Math.round(total * CONFIG.SELL_RATE);
}
function incomeFor(roundIndex, won, relics) {
  var base = 74 + roundIndex * 16 + (won ? 30 : 12);
  var bonus = 0;
  (relics || []).forEach(function (r) { if (r.props.income) bonus += r.props.income; });
  return base + bonus;
}

/* ------------------- 家园扩张：僵尸在敲门 -------------------
 * 通道与地基同步按 3×3、6×6、9×9 扩张，列从裂隙侧向外开放。
 * 玩家和镜像用同一张解锁表 —— 这才叫「同阶段的镜像」。 */
function unlockedCols(roundIndex) {
  if (typeof Game !== 'undefined' && Game.coopMode) {
    var all = [];
    for (var c = CONFIG.P_COLS.length - 1; c >= 0; c--) all.push(c);
    return all;
  }
  var n = roundIndex < 1 ? 3 : roundIndex < 2 ? 6 : CONFIG.P_COLS.length;
  var cols = [];
  for (var i = CONFIG.P_COLS.length - 1; i >= CONFIG.P_COLS.length - n; i--) cols.push(i);
  return cols;
}
function isColUnlocked(roundIndex, col) {
  return unlockedCols(roundIndex).indexOf(col) >= 0;
}
function unlockedLaneCount(roundIndex) {
  if (typeof Game !== 'undefined' && Game.coopMode) return 3;
  var r = Math.max(0, Number(roundIndex) || 0);
  return r < 1 ? 3 : r < 2 ? 6 : CONFIG.LANES.length;
}
function unlockedLanes(roundIndex) {
  if (typeof Game !== 'undefined' && Game.coopMode) {
    var first = coopLaneOffset(Game.coopSeat || 0);
    return [first, first + 1, first + 2];
  }
  var lanes = [];
  for (var i = 0; i < unlockedLaneCount(roundIndex); i++) lanes.push(i);
  return lanes;
}
function isLaneUnlocked(roundIndex, lane) {
  return unlockedLanes(roundIndex).indexOf(lane) >= 0;
}

function unitFootprintRows(typeId) {
  return Math.max(1, (UNITS[typeId] && UNITS[typeId].footprintRows) || 1);
}
function unitFootprintLanes(typeId, centerLane) {
  var rows = unitFootprintRows(typeId);
  var first = centerLane - Math.floor((rows - 1) / 2);
  var lanes = [];
  for (var i = 0; i < rows; i++) lanes.push(first + i);
  return lanes;
}
function unitAnchorLane(typeId, lane, availableRows) {
  var rows = unitFootprintRows(typeId);
  var count = availableRows === undefined ? CONFIG.LANES.length : availableRows;
  var before = Math.floor((rows - 1) / 2);
  var after = rows - 1 - before;
  if (count < rows) return -1;
  return clamp(lane, before, count - 1 - after);
}
function gridUnitAt(grid, col, lane) {
  var direct = grid[col + '|' + lane];
  if (direct) return direct;
  for (var candidateLane = Math.max(0, lane - 1);
       candidateLane <= Math.min(CONFIG.LANES.length - 1, lane + 1); candidateLane++) {
    var unit = grid[col + '|' + candidateLane];
    if (unit && unitFootprintLanes(unit.type, unit.lane).indexOf(lane) >= 0) return unit;
  }
  return null;
}
function rangeScaleX(value) {
  return value * CONFIG.GRID_COL_PITCH / CONFIG.LEGACY_RANGE_CELL;
}
function rangeScaleY(value) {
  return value * CONFIG.GRID_LANE_PITCH / CONFIG.LEGACY_LANE_PITCH;
}
function combatReachX(value) {
  return rangeScaleX(value) * CONFIG.COMBAT_REACH_MULTIPLIER;
}
function attackForwardSign(side) {
  return side === 'p' ? 1 : -1;
}
function coopSideForSeat(seat) {
  return Math.floor(Math.max(0, seat || 0) / CONFIG.COOP_PLAYERS_PER_SIDE) === 0 ? 'p' : 'g';
}
function coopLocalSeat(seat) {
  return Math.max(0, seat || 0) % CONFIG.COOP_PLAYERS_PER_SIDE;
}
function coopLaneOffset(seat) {
  return coopLocalSeat(seat) * CONFIG.COOP_LANES_PER_PLAYER;
}

/* The Cloudflare Worker loads the same combat data used by the browser battle
   core. The classic-script game path ignores this CommonJS export. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG: CONFIG, UNITS: UNITS, FORMS: FORMS, ZOMBIES: ZOMBIES, RELICS: RELICS,
    clamp: clamp, lerp: lerp, mulberry32: mulberry32, getForm: getForm,
    unlockedLanes: unlockedLanes, unitFootprintLanes: unitFootprintLanes,
    rangeScaleX: rangeScaleX, rangeScaleY: rangeScaleY,
    combatReachX: combatReachX, attackForwardSign: attackForwardSign,
    coopSideForSeat: coopSideForSeat, coopLocalSeat: coopLocalSeat,
    coopLaneOffset: coopLaneOffset,
  };
}
