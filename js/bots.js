'use strict';

/* ---------------------------------------------------------------
 * 异步镜像：为每个小局生成一个「同阶段」的机器人对手构筑。
 * 纯数据，Node 可加载。
 * ------------------------------------------------------------- */

/* 镜像名字 = 前缀 + 的 + 职业 · 编号，英文是 Prefix the Role · 编号。
   两套词表都按语言给，拼装句走 meta.defaultName / bot.name 的 L() 占位符。 */
var BOT_PREFIX = {
  zh: ['北巷', '铁砧', '寒鸦', '碎灯', '老陈', '锈钉', '夜巡', '雨夜', '黑麦',
    '哑铃', '灰猫', '大雾', '十三号', '钟摆', '铅盒', '阿岚', '朽木', '孤灯', '白桦', '冷杉'],
  en: ['North Lane', 'Anvil', 'Jackdaw', 'Broken Lamp', 'Old Chen', 'Rust Nail',
    'Night Watch', 'Rain Night', 'Rye', 'Dumbbell', 'Grey Cat', 'Heavy Fog',
    'No. Thirteen', 'Pendulum', 'Lead Box', 'A Lan', 'Deadwood', 'Lone Lamp',
    'Birch', 'Fir'],
};
var BOT_ROLE = {
  zh: ['电工', '木匠', '保安', '房主', '猎人', '拾荒队', '拆迁办', '物管',
    '夜班员', '护士', '司机', '厨子', '门卫', '测绘员'],
  en: ['Electrician', 'Carpenter', 'Guard', 'Homeowner', 'Hunter', 'Scavenger',
    'Wrecker', 'Janitor', 'Night Shift', 'Nurse', 'Driver', 'Cook', 'Doorman',
    'Surveyor'],
};
function botPrefix() { return BOT_PREFIX[I18N.lang] || BOT_PREFIX.zh; }
function botRole() { return BOT_ROLE[I18N.lang] || BOT_ROLE.zh; }

var BOT_TAG = [
  { id: 'turtle', name: '龟缩流', w: { barricade: 3.2, spike: 1.6, turret: 1.0, lamp: 0.6 } },
  { id: 'firepower', name: '火力流', w: { turret: 3.0, flame: 1.3, barricade: 0.8, tesla: 0.7 } },
  { id: 'flame', name: '火焰流', w: { flame: 2.6, barricade: 1.4, lamp: 1.0, turret: 0.8 } },
  { id: 'electric', name: '电场流', w: { tesla: 2.2, lamp: 1.6, barricade: 1.2, turret: 0.7 } },
  { id: 'generalist', name: '杂货铺', w: { barricade: 1.4, spike: 1.4, turret: 1.2, lamp: 1.0, flame: 1.0, tesla: 1.0 } },
];

/* 到第 i 小局时，玩家大致累计能花的钱：
   95 起步，之后每小局收入约 74+16i(+胜场奖励)，所以累计 ≈ 95 + 95i + 8i²。
   镜像拿这条曲线的 62%~102%，前期弱、后期追平 —— 难度随小局平滑抬升。 */
function expectedBudget(roundIndex) {
  var spent = 95 + 95 * roundIndex + 8 * roundIndex * roundIndex;
  var share = Math.min(1.06, 0.78 + 0.34 * (roundIndex / (CONFIG.TOTAL_ROUNDS - 1)));
  return Math.round(spent * share);
}

var BOT_FORM_PREFERENCE = {
  '龟缩流': { default: 0, spike: 1 },
  '火力流': { default: 2, barricade: 1, spike: 0, turret: 0, lamp: 1, flame: 1, tesla: 1 },
  '火焰流': { default: 1, barricade: 2, spike: 2, turret: 2, lamp: 1, flame: 2, tesla: 0 },
  '电场流': { default: 2, barricade: 0, spike: 1, turret: 2, lamp: 2, flame: 0, tesla: 2 },
  '杂货铺': { default: 0 },
};

var RELIC_QUALITY = {
  foundation: 1.00, gears: 1.85, steel: 1.75, powder: 1.85,
  satchel: 1.05, lore: 1.45, spares: 1.05, doublebow: 2.00,
  coldlight: 1.65, fuse: 1.55, overload: 1.75, ration: 1.10,
};

function pickBotRelics(rnd, eternalTier, count) {
  var pool = RELICS.slice();
  if (eternalTier <= 0) {
    for (var i = pool.length - 1; i > 0; i--) {
      var j = (rnd() * (i + 1)) | 0;
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
  } else {
    var noise = Math.max(0.18, 1 - eternalTier * 0.12);
    pool.sort(function (a, b) {
      var sa = RELIC_QUALITY[a.id] + rnd() * noise;
      var sb = RELIC_QUALITY[b.id] + rnd() * noise;
      return sb - sa;
    });
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function chooseBotForm(typeId, seed, tagName, decisionMultiplier) {
  var forms = FORMS[typeId] || [];
  if (!forms.length) return null;
  var pref = BOT_FORM_PREFERENCE[tagName] || BOT_FORM_PREFERENCE['杂货铺'];
  var preferred = pref[typeId] === undefined ? pref.default : pref[typeId];
  var hash = String(tagName).length * 31;
  for (var i = 0; i < typeId.length; i++) hash += typeId.charCodeAt(i) * (i + 3);
  var rnd = mulberry32((seed ^ hash) >>> 0);
  var roll = rnd();
  var preferredChance = clamp(
    0.62 * (decisionMultiplier === undefined ? 1 : decisionMultiplier),
    0.62, 0.90
  );
  var sideChance = (1 - preferredChance) / 2;
  var index = roll < preferredChance ? preferred
    : roll < preferredChance + sideChance ? (preferred + 1) % forms.length
      : (preferred + forms.length - 1) % forms.length;
  return forms[index].id;
}

function makeBot(roundIndex, seed, pressure, threat, unlockedUnits) {
  pressure = clamp(pressure === undefined ? 1 : pressure, 1, 1.35);
  threat = threat || rankThreat(0);
  unlockedUnits = unlockedUnits && unlockedUnits.length
    ? unlockedUnits
    : unlockedUnitIds(0);
  var decision = clamp(threat.decisionMultiplier, 1, 4);
  var rnd = mulberry32(seed * 7919 + roundIndex * 104729 + 13);
  var relicRnd = mulberry32((seed ^ (0x5f3759df + roundIndex * 65537)) >>> 0);
  var ratingRnd = mulberry32((seed ^ (0x9e3779b9 + roundIndex * 13)) >>> 0);
  var t = roundIndex / (CONFIG.TOTAL_ROUNDS - 1);
  var tag = BOT_TAG[(rnd() * BOT_TAG.length) | 0];
  var budget = Math.round(
    expectedBudget(roundIndex) * (0.9 + rnd() * 0.22) *
    threat.budgetMultiplier
  );
  var prefix = botPrefix();
  var role = botRole();
  var name = L('bot.name', {
    prefix: prefix[(rnd() * prefix.length) | 0],
    role: role[(rnd() * role.length) | 0],
    n: 1000 + ((rnd() * 8999) | 0),
  }, '{prefix}的{role} · {n}');

  var w = {};
  for (var k in tag.w) w[k] = tag.w[k];
  var unlocked = {};
  for (var uk = 0; uk < unlockedUnits.length; uk++) unlocked[unlockedUnits[uk]] = true;
  var advancedBias = {
    sniper: 1.65, venom: 1.45, frost: 1.35, quake: 1.25,
    railgun: 1.55, totem: 1.30,
    wolf: 1.20, owl: 1.35, boar: 1.05, chameleon: 1.15,
    elephant: 1.25, frog: 1.25, bee: 1.30, turtle: 1.05,
    tiger: 1.45, phoenix: 1.20,
  };
  function unitWeight(id) {
    return w[id] === undefined ? (advancedBias[id] || 0.7) : w[id];
  }
  function buildFrontWall() {
    // 先在裂隙前沿铺连续墙线：每块跨 3 路，按开放路数补到顶和底都无缺口。
    if (!unlocked.barricade) return;
    var col = unlockedCols(roundIndex)[0];
    var laneCount = unlockedLaneCount(roundIndex);
    var cost = UNITS.barricade.cost;
    for (var first = 0; first < laneCount; first += 3) {
      if (budget < cost) break;
      var center = unitAnchorLane('barricade', first + 1, laneCount);
      var rows = unitFootprintLanes('barricade', center);
      var blocked = center < 0;
      for (var ri = 0; ri < rows.length; ri++) {
        if (!isLaneUnlocked(roundIndex, rows[ri]) || grid[col + ',' + rows[ri]]) {
          blocked = true; break;
        }
      }
      if (blocked) continue;
      budget -= cost;
      var wall = { type: 'barricade', col: col, lane: center, lv: 1, form: null };
      for (var ri2 = 0; ri2 < rows.length; ri2++) grid[col + ',' + rows[ri2]] = wall;
      build.push(wall);
    }
  }
  // 前期只解锁便宜货，中后期逐渐解锁高级单位
  if (roundIndex < 2) { w.flame = 0; w.tesla = 0; w.lamp = 0.2; }
  if (roundIndex < 4) { w.tesla = 0; }
  if (roundIndex < 1) { w.spike = Math.min(w.spike || 0, 1.2); }

  var build = [];
  var grid = {};        // "col,lane" -> unit
  var maxLv = roundIndex < 1 ? 1 : roundIndex < 3 ? 2 : 3;

  // 阵型：真实玩家不会乱摆。前排扛、中排输出、后排辅助。
  var COL_ROLE = {};
  for (var roleCol = 0; roleCol < CONFIG.P_COLS.length; roleCol++) {
    COL_ROLE[roleCol] = roleCol >= 8
      ? ['barricade', 'spike', 'elephant', 'turtle', 'boar']
      : roleCol >= 6
        ? ['turret', 'flame', 'barricade', 'sniper', 'venom', 'railgun', 'wolf', 'owl', 'frog', 'tiger']
        : roleCol >= 3
          ? ['turret', 'lamp', 'tesla', 'frost', 'quake', 'totem', 'boar', 'chameleon', 'frog', 'bee', 'phoenix']
          : ['lamp', 'tesla', 'turret', 'frost', 'quake', 'railgun', 'totem', 'wolf', 'owl', 'bee', 'tiger', 'phoenix'];
  }

  function laneOrder() {
    var a = unlockedLanes(roundIndex).slice();
    for (var i = a.length - 1; i > 0; i--) { var j = (rnd() * (i + 1)) | 0; var tm = a[i]; a[i] = a[j]; a[j] = tm; }
    return a;
  }
  function pickTypeForCol(col) {
    var opts = COL_ROLE[col], total = 0, ids = [];
    for (var i = 0; i < opts.length; i++) {
      var id = opts[i];
      if (!unlocked[id]) continue;
      if (UNITS[id].cost > budget) continue;
      var prior = unitWeight(id);
      if (prior <= 0) continue;
      total += prior; ids.push(id);
    }
    if (!total) return null;
    var r = rnd() * total;
    for (var j = 0; j < ids.length; j++) { r -= unitWeight(ids[j]); if (r <= 0) return ids[j]; }
    return ids[ids.length - 1];
  }
  function placeOne() {
    var cols = unlockedCols(roundIndex);
    for (var ci = 0; ci < cols.length; ci++) {
      var col = cols[ci], lanes = laneOrder();
      for (var li = 0; li < lanes.length; li++) {
        var lane = lanes[li];
        var type = pickTypeForCol(col);
        if (!type) continue;
        var center = unitAnchorLane(type, lane, unlockedLaneCount(roundIndex));
        if (center < 0) continue;
        var rows = unitFootprintLanes(type, center), blocked = false;
        for (var ri = 0; ri < rows.length; ri++) {
          if (grid[col + ',' + rows[ri]]) { blocked = true; break; }
        }
        if (blocked) continue;
        budget -= UNITS[type].cost;
        var u = { type: type, col: col, lane: center, lv: 1, form: null };
        for (var ri2 = 0; ri2 < rows.length; ri2++) grid[col + ',' + rows[ri2]] = u;
        build.push(u);
        return true;
      }
    }
    return false;
  }
  function buyUpgrade() {
    var order = build.slice().sort(function (a, b) {
      var wa = unitWeight(a.type) + rnd() * 0.6 / decision;
      var wb = unitWeight(b.type) + rnd() * 0.6 / decision;
      return wb - wa;
    });
    for (var i = 0; i < order.length; i++) {
      var b = order[i];
      if (b.lv >= maxLv) continue;
      var c = upgradeCost(b.type, b.lv);
      if (c <= budget) {
        budget -= c;
        if (b.lv === 1 && !b.form) b.form = chooseBotForm(b.type, seed, tag.name, decision);
        b.lv++;
        return true;
      }
    }
    return false;
  }

  // 先铺阵型，再精装修；单位太少时不升级（否则会被一波推平）
  buildFrontWall();
  var guard = 0;
  while (guard++ < 400) {
    var full = build.length >= 20;
    var baseUpgradeBias = build.length < 7 ? 0.04 : (0.16 + 0.42 * t);
    var upgradeBias = clamp(baseUpgradeBias * decision, baseUpgradeBias, 0.94);
    if (!full && rnd() > upgradeBias) {
      if (!placeOne()) break;
    } else {
      if (buyUpgrade()) continue;
      if (full || !placeOne()) break;
    }
  }
  var dump = 0;
  while (build.length && dump++ < 400) { if (!buyUpgrade()) break; }

  // 镜像的遗物：跟随小局推进，模拟同阶段玩家的构筑
  var relics = [];
  var relicCount = Math.min(
    RELICS.length,
    roundIndex + Math.min(threat.eternalTier, 3)
  );
  if (relicCount > 0) {
    relics = pickBotRelics(relicRnd, threat.eternalTier, relicCount);
  }

  var mods = combineMods(relics);
  // 段位/熟练度：后期镜像略强，营造「同阶段但更肝」的感觉
  var skill = 1 + t * (typeof BOT_SKILL_SLOPE === 'number' ? BOT_SKILL_SLOPE : 0.16);
  skill *= 1 + (pressure - 1) * 0.80;
  skill *= threat.powerMultiplier;
  mods.dmgMul *= skill;
  mods.hpMul *= skill;

  var rating = Math.round(
    80 + t * 92 + ratingRnd() * 8 + (pressure - 1) * 80 +
    (threat.powerMultiplier - 1) * 120 +
    (threat.decisionMultiplier - 1) * 40
  );
  return {
    name: name, tag: L('bot.tag.' + tag.id, null, tag.name), build: build, relics: relics, mods: mods,
    roundIndex: roundIndex,
    pressure: pressure,
    threat: threat,
    rating: rating,
    medal: rating > 155 ? 'Ⅱ' : rating > 115 ? 'Ⅰ' : '·',
  };
}
