'use strict';

/* ---------------------------------------------------------------
 * 纯逻辑战斗模拟：不碰 DOM / canvas，Node 可直接跑。
 * 两侧（玩家 p / 镜像 g）共用同一套规则、同一股尸潮 —— 所以
 * 裂隙狂潮持续升级，家园先倒下的一方输——比的是构筑，不是运气。
 * 性能：按 阵营×通道 分桶，避免每帧 O(单位×丧尸) 全扫描。
 * ------------------------------------------------------------- */

function defaultMods() {
  return {
    hpMul: 1, dmgMul: 1, rateMul: 1, slowAdd: 0, spikeMul: 1, chainAdd: 0,
    homeHp: 0, zombieSpeedMul: 1, income: 0, startRepair: 0,
    turretShots: 0, lampRange: 0, extraCell: 0,
  };
}
function combineMods(relics) {
  var m = defaultMods();
  (relics || []).forEach(function (r) {
    for (var k in r.props) {
      if (k === 'hpMul' || k === 'dmgMul' || k === 'rateMul' || k === 'spikeMul' || k === 'zombieSpeedMul') m[k] *= r.props[k];
      else m[k] += r.props[k];
    }
  });
  return m;
}

/* --------------------- 小局难度曲线 --------------------- */
function roundWave(i, total, pressure) {
  var t = total > 1 ? i / (total - 1) : 0;
  pressure = clamp(pressure === undefined ? 1 : pressure, 1, 1.35);
  var density = 1 + (pressure - 1) * 0.75;
  var offense = 1 + (pressure - 1) * 0.70;
  var mobility = 1 + (pressure - 1) * 0.25;
  var weights = zombieWeights(t);
  weights.runner *= 1 + (pressure - 1) * 0.50;
  weights.brute *= 1 + (pressure - 1);
  weights.tank *= 1 + (pressure - 1);
  return {
    t: t,
    pressure: pressure,
    maxTime: 46 + t * 40,
    hpMul: (1 + t * 3.7) * pressure,
    speedMul: (1 + t * 0.30) * mobility,
    dmgMul: (1 + t * 1.05) * offense,
    interval0: (1.55 - t * 0.64) / density,
    interval1: (0.78 - t * 0.30) / density,
    pulseEvery: (14 - t * 5) / (1 + (pressure - 1) * 0.50),
    pulseSize: (5 + t * 13) * (1 + (pressure - 1) * 0.35),
    weights: weights,
  };
}

/* --------------------- 60 秒后裂隙狂潮 --------------------- */
var RIFT_RAMP_START = 60;
var RIFT_RAMP_STEP = 15;

function escalationLevel(t) {
  if (t < RIFT_RAMP_START) return 0;
  return Math.floor((t - RIFT_RAMP_START) / RIFT_RAMP_STEP) + 1;
}

function spawnIntervalMultiplier(t) {
  if (t < RIFT_RAMP_START) return 1;
  return 1 + (t - RIFT_RAMP_START) * 0.10;
}

function zombieCapAt(t) {
  if (t < RIFT_RAMP_START) return CONFIG.ZOMBIE_CAP;
  return Math.min(
    800,
    Math.round(CONFIG.ZOMBIE_CAP * (1 + (t - RIFT_RAMP_START) * 0.035))
  );
}

function escalatedWeights(baseT, ramp, pressureWeights) {
  var weights = zombieWeights(clamp(baseT + ramp * 0.012, 0, 1));
  var original = zombieWeights(baseT), key;
  for (key in weights) {
    if (key !== 'walker' && original[key] > 0) {
      weights[key] *= pressureWeights[key] / original[key];
    }
  }
  var advanced = 0;
  for (key in weights) if (key !== 'walker') advanced += weights[key];
  if (advanced > 0) {
    var advancedTarget = clamp(ramp * 0.004, 0, 0.72);
    var boost = advanced * advancedTarget;
    weights.walker = Math.max(0.05, weights.walker - boost);
    for (key in weights) {
      if (key !== 'walker') weights[key] += boost * weights[key] / advanced;
    }
  }
  return weights;
}

function escalatedWave(wave, t) {
  if (t < RIFT_RAMP_START) return wave;
  var ramp = t - RIFT_RAMP_START;
  var intervalMul = spawnIntervalMultiplier(t);
  return {
    t: wave.t,
    pressure: wave.pressure,
    maxTime: wave.maxTime,
    hpMul: wave.hpMul * (1 + ramp * 0.32),
    speedMul: wave.speedMul * (1 + ramp * 0.045),
    dmgMul: wave.dmgMul * (1 + ramp * 0.18),
    interval0: wave.interval0 / intervalMul,
    interval1: wave.interval1 / intervalMul,
    pulseEvery: wave.pulseEvery / (1 + ramp * 0.14),
    pulseSize: Math.ceil(wave.pulseSize * (1 + ramp * 0.13)),
    weights: escalatedWeights(wave.t, ramp, wave.weights),
  };
}
function zombieWeights(t) {
  return {
    bug: 2.4,
    walker: 0.35,
    runner: clamp((t - 0.06) * 2.8, 0, 0.9),
    screamer: clamp((t - 0.20) * 1.7, 0, 0.5),
    brute: clamp((t - 0.34) * 1.6, 0, 0.65),
    tank: clamp((t - 0.58) * 1.7, 0, 0.45),
  };
}

/* --------------------- 实体工厂 --------------------- */
var _uid = 1;

function makeUnit(side, col, lane, typeId, lv, mods, formId) {
  var d = UNITS[typeId];
  var behavior = d.behavior;
  var f = getForm(typeId, formId);
  var fs = lv >= 3 ? f.lv3 : lv === 2 ? f.lv2 : {};
  var hp = Math.round(d.hp * Math.pow(1.35, lv - 1) * mods.hpMul * (fs.hpMul || 1));
  var dm = d.dmg ? d.dmg * Math.pow(1.42, lv - 1) * mods.dmgMul * (fs.dmgMul || 1) : 0;
  var isP = side === 'p';
  var rate = d.rate ? d.rate * mods.rateMul / (fs.attackSpeedMul || 1) : 0;
  var slow = d.slow !== undefined
    ? clamp(
      (d.slow + (d.slowMod ? (mods[d.slowMod] || 0) : 0)) *
      (fs.slowMul === undefined ? 1 : fs.slowMul) +
      (fs.slowAdd || 0), 0, 0.75
    )
    : 0;
  var retal = behavior === 'contact'
    ? d.dmg * Math.pow(1.42, lv - 1) * mods.dmgMul * mods.spikeMul
    : 0;
  retal = retal * (fs.retalMul === undefined ? 1 : fs.retalMul) + (fs.retalAdd || 0);
  return {
    id: _uid++, side: side, col: col, lane: lane, type: typeId, lv: lv,
    form: formId || null,
    x: isP ? CONFIG.P_COLS[col] : CONFIG.G_COLS[col],
    y: CONFIG.LANES[lane],
    hp: hp, maxHp: hp, dmg: dm,
    rate: rate,
    range: d.rangeType === 'radius' ? 0 : combatReachX(
      (d.range || 0) + (d.rangeMod ? (mods[d.rangeMod] || 0) : 0) + (fs.rangeAdd || 0)),
    radius: combatReachX(
      (d.rangeType === 'radius' ? (d.range || 0) + (fs.rangeAdd || 0) : (d.radius || 0) + (fs.radiusAdd || 0)) +
      (d.rangeMod ? (mods[d.rangeMod] || 0) : 0)),
    slow: slow,
    chain: d.chain ? Math.max(1, d.chain + mods.chainAdd + (fs.chainAdd || 0)) : 0,
    retal: retal,
    spray: rangeScaleY(d.spray || 0) * (fs.sprayMul === undefined ? 1 : fs.sprayMul),
    splash: rangeScaleX(d.splash || 0) * (fs.splashMul === undefined ? 1 : fs.splashMul),
    heal: (d.heal || 0) * (fs.healMul === undefined ? 1 : fs.healMul),
    critChance: clamp((d.critChance || 0) + (fs.critChance || 0), 0, 1),
    critMul: Math.max(d.critMul || 1, fs.critMul || 1),
    stunChance: fs.stunChance || 0,
    stunDur: fs.stunDur || 0,
    strobeChance: clamp((d.strobeChance || 0) + (fs.strobeChance || 0), 0, 1),
    strobeDur: (d.strobeDur || 0) + (fs.strobeDur || 0),
    burnDps: (d.burnDps || 0) + (fs.burnDps || 0),
    burnT: Math.max(d.burnT || 0, fs.burnT || 0),
    deathSlowAmt: fs.deathSlowAmt || 0,
    deathSlowT: fs.deathSlowT || 0,
    cd: rate,
    flash: 0, hurtT: 0, dead: false, pulse: 0,
    // 作战状态：engaged = 射程内有目标；actT = 最近真的打中过（渲染层用它点灯）
    engaged: 0, engT: 0, actT: 0,
  };
}

function makeZombie(side, lane, typeId, x, wave, rnd) {
  var d = ZOMBIES[typeId];
  var hp = Math.round(d.hp * wave.hpMul);
  return {
    id: _uid++, side: side, lane: lane, type: typeId,
    x: x, y: CONFIG.LANES[lane] + (rnd() - 0.5) * CONFIG.ZOMBIE_LANE_JITTER,
    hp: hp, maxHp: hp,
    speed: d.speed * wave.speedMul,
    dmg: d.dmg * wave.dmgMul,
    rate: d.rate, r: d.r, tint: d.tint,
    atkCd: 0.25, slowT: 0, slowAmt: 0, stunT: 0, strobeLock: 0,
    attackT: 0, attackTotal: 0, attackHitT: 0, attackHitTotal: 0,
    attackKind: '', attackTarget: null,
    burnDps: 0, burnT: 0, flash: 0,
    phase: rnd() * 6.283, scale: 0.92 + rnd() * 0.16, dead: false,
  };
}

/* --------------------- 战斗 --------------------- */
function Battle(opts) {
  var lanes = CONFIG.LANES.length;
  this.pressure = clamp(opts.pressure === undefined ? 1 : opts.pressure, 1, 1.35);
  this.baseWave = roundWave(
    opts.roundIndex,
    opts.totalRounds || CONFIG.TOTAL_ROUNDS,
    this.pressure
  );
  this.wave = this.baseWave;
  this.roundIndex = opts.roundIndex;
  this.activeLanes = unlockedLanes(this.roundIndex);
  this.rnd = mulberry32(opts.seed || 12345);
  this.mods = { p: opts.playerMods || defaultMods(), g: opts.ghostMods || defaultMods() };

  this.units = [];
  this.zombies = [];
  this.shots = [];
  this.fx = [];
  this.zBuckets = { p: [], g: [] };
  this.uBuckets = { p: [], g: [] };
  for (var i = 0; i < lanes; i++) {
    this.zBuckets.p.push([]); this.zBuckets.g.push([]);
    this.uBuckets.p.push([]); this.uBuckets.g.push([]);
  }

  this.maxHp = { p: CONFIG.HOME_HP + this.mods.p.homeHp, g: CONFIG.HOME_HP + this.mods.g.homeHp };
  this.hp = { p: this.maxHp.p, g: this.maxHp.g };
  this.dead = { p: null, g: null };
  this.firstHomeHit = { p: null, g: null };
  this.over = false; this.timeout = false; this.t = 0;

  var self = this;
  (opts.playerBuild || []).forEach(function (b) { self.addUnit('p', b); });
  (opts.ghostBuild || []).forEach(function (b) { self.addUnit('g', b); });

  this.sideDelta = 0;
  this.spawnTimer = 1.0;
  this.pulseTimer = this.wave.pulseEvery * 0.75;
  this.pulseQueue = 0; this.pulseGap = 0;
  this.spawned = { p: 0, g: 0 };
  this.killed = { p: 0, g: 0 };
  this.dirtyZ = false;
  this.overtime = null;   // 加时：只剩一边时，只给这一边刷怪，用来算出它到底能撑多久
  this.decided = false;
  this.hpAtEnd = null;
  this.deadAt = null;
  this.killedAtEnd = null;
  this.timeAtEnd = null;
  this.rebuildBuckets();
}

Battle.prototype.addUnit = function (side, b, ownerMods, ownerSeat) {
  var rows = unitFootprintLanes(b.type, b.lane);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] < 0 || rows[i] >= CONFIG.LANES.length || this.activeLanes.indexOf(rows[i]) < 0) return;
  }
  if (b.col < 0 || b.col >= CONFIG.P_COLS.length) return;
  var mods = ownerMods || this.mods[side];
  var unit = makeUnit(side, b.col, b.lane, b.type, b.lv || 1, mods, b.form);
  unit.mods = mods;
  if (Number.isInteger(ownerSeat)) {
    unit.coopOwnerSeat = ownerSeat;
    unit.coopIndex = Number.isInteger(b.coopIndex) ? b.coopIndex : null;
  }
  this.units.push(unit);
};

Battle.prototype.emit = function (e) { if (this.fx.length < 240) this.fx.push(e); };
Battle.prototype.drainFx = function () { var f = this.fx; this.fx = []; return f; };

Battle.prototype.beginZombieAttack = function (z, kind, target) {
  var heavy = z.type === 'brute' || z.type === 'tank';
  z.attackTotal = heavy ? 0.34 : (z.type === 'runner' ? 0.16 : 0.24);
  z.attackT = z.attackTotal;
  z.attackKind = kind;
  z.attackTarget = target || null;
  this.emit({
    t: 'zattack',
    x: z.x, y: z.y, type: z.type, kind: kind,
    targetX: kind === 'home'
      ? (z.side === 'p' ? CONFIG.HOME_P_X : CONFIG.HOME_G_X)
      : (target ? target.x : z.x),
    targetY: kind === 'home' ? z.y : (target ? target.y : z.y),
  });
};

Battle.prototype.resolveZombieAttack = function (z) {
  var kind = z.attackKind, target = z.attackTarget;
  var dir = z.side === 'p' ? -1 : 1;
  z.attackT = 0;
  z.attackTotal = 0;
  z.attackHitT = 0.16;
  z.attackHitTotal = 0.16;
  z.atkCd = z.rate;

  if (kind === 'unit') {
    if (target && !target.dead) {
      var ahead = (target.x - z.x) * dir;
      if (ahead >= -14 && ahead <= z.r + CONFIG.GRID_CELL_W / 2 - 4) {
        target.hp -= z.dmg;
        target.flash = 1;
        target.hurtT = 0.28;
        if (target.stunChance && this.rnd() < target.stunChance) {
          z.stunT = Math.max(z.stunT, target.stunDur);
          this.emit({ t: 'hitZombie', x: z.x, y: z.y, form: 'hookspikes' });
        }
        if (target.burnDps) this.applyBurn(z, target.burnDps, target.burnT);
        this.emit({
          t: 'hitUnit', x: target.x, y: target.y, side: z.side,
          type: target.type, zombie: z.type,
        });
        if (target.hp <= 0) this.destroyUnit(target);
      }
    }
  } else if (kind === 'home') {
    var homeX = z.side === 'p' ? CONFIG.HOME_P_X : CONFIG.HOME_G_X;
    if (Math.abs(z.x - homeX) <= z.r + 24) {
      if (this.coopMode && typeof this.coopHomeHit === 'function') {
        this.coopHomeHit(z);
        return;
      }
      this.hp[z.side] = Math.max(0, this.hp[z.side] - z.dmg);
      if (!this.firstHomeHit[z.side]) {
        this.firstHomeHit[z.side] = { lane: z.lane, time: this.t, zombie: z.type };
      }
      this.emit({ t: 'homeHit', side: z.side, dmg: z.dmg, zombie: z.type });
      if (this.hp[z.side] <= 0 && this.dead[z.side] === null) {
        this.dead[z.side] = this.t;
        this.emit({ t: 'homeDown', side: z.side });
      }
    }
  }
};

Battle.prototype.cancelZombieAttack = function (z) {
  z.attackT = 0;
  z.attackTotal = 0;
  z.attackKind = '';
  z.attackTarget = null;
};

Battle.prototype.rebuildBuckets = function () {
  var zb = this.zBuckets, ub = this.uBuckets, i, L = CONFIG.LANES.length;
  for (i = 0; i < L; i++) {
    zb.p[i].length = 0; zb.g[i].length = 0; ub.p[i].length = 0; ub.g[i].length = 0;
  }
  for (i = 0; i < this.zombies.length; i++) {
    var z = this.zombies[i];
    if (!z.dead) zb[z.side][z.lane].push(z);
  }
  for (i = 0; i < this.units.length; i++) {
    var u = this.units[i];
    if (!u.dead) {
      var occupiedLanes = unitFootprintLanes(u.type, u.lane);
      for (var ui = 0; ui < occupiedLanes.length; ui++) ub[u.side][occupiedLanes[ui]].push(u);
    }
  }
};

/* 备战期用：整体替换某一侧的构筑（放置 / 升级 / 拆除后调用） */
Battle.prototype.setBuild = function (side, list) {
  var kept = [];
  for (var i = 0; i < this.units.length; i++) if (this.units[i].side !== side) kept.push(this.units[i]);
  this.units = kept;
  for (var j = 0; j < list.length; j++) this.addUnit(side, list[j]);
  this.rebuildBuckets();
};

/* 玩家技能：照明弹 —— 范围伤害 + 眩晕 */
Battle.prototype.flare = function (x, y) {
  var R = 118, DMG = 58, hit = 0;
  for (var i = 0; i < this.zombies.length; i++) {
    var z = this.zombies[i];
    if (z.dead) continue;
    var dx = z.x - x, dy = z.y - y;
    if (dx * dx + dy * dy < R * R) { z.stunT = 1.9; this.damageZombie(z, DMG); hit++; }
  }
  this.emit({ t: 'boom', x: x, y: y, r: R });
  return hit;
};

/* 玩家技能：急修 */
Battle.prototype.repair = function (side, amount) {
  this.hp[side] = Math.min(this.maxHp[side], this.hp[side] + amount);
  this.emit({ t: 'repair', side: side });
  return this.hp[side];
};

Battle.prototype.occupied = function (side, col, lane) {
  var list = this.uBuckets[side][lane];
  for (var i = 0; i < list.length; i++) if (list[i].col === col) return true;
  for (var j = 0; j < this.units.length; j++) {
    var u = this.units[j];
    if (!u.dead && u.side === side && u.col === col && u.lane === lane) return true;
  }
  return false;
};

/* --------------------- 尸潮 --------------------- */
Battle.prototype.spawnOne = function (typeId) {
  var type = typeId || this.pickType();
  var count = type === 'bug' ? 3 + ((this.rnd() * 3) | 0) : 1;
  for (var i = 0; i < count; i++) this.spawnEntity(type);
};

Battle.prototype.spawnEntity = function (type) {
  if (this.zombies.length >= zombieCapAt(this.t)) return;
  // 两侧僵尸数量差锁在 [-1,1]：同样的尸潮，比的是构筑
  var side, r = this.rnd();
  if (this.overtime) side = this.overtime;
  else if (this.sideDelta > 0) side = 'g';
  else if (this.sideDelta < 0) side = 'p';
  else side = r < 0.5 ? 'p' : 'g';
  this.sideDelta += side === 'p' ? 1 : -1;

  var lane = this.activeLanes[(this.rnd() * this.activeLanes.length) | 0];
  var z = makeZombie(side, lane, type, CONFIG.RIFT_X + (this.rnd() - 0.5) * 60, this.wave, this.rnd);
  this.zombies.push(z);
  this.zBuckets[side][lane].push(z);
  this.spawned[side]++;
  this.emit({ t: 'spawn', x: z.x, y: z.y, side: side });
};

Battle.prototype.pickType = function () {
  var w = this.wave.weights, total = 0, ids = [], k;
  for (k in w) { total += w[k]; ids.push(k); }
  var r = this.rnd() * total;
  for (var i = 0; i < ids.length; i++) { r -= w[ids[i]]; if (r <= 0) return ids[i]; }
  return 'walker';
};

Battle.prototype.updateSpawns = function (dt) {
  if (this.pulseQueue > 0) {
    this.pulseGap -= dt;
    if (this.pulseGap <= 0) { this.pulseQueue--; this.pulseGap = 0.16; this.spawnOne(); }
  }
  this.pulseTimer -= dt;
  if (this.pulseTimer <= 0) {
    this.pulseTimer = this.wave.pulseEvery;
    this.pulseQueue = Math.round(this.wave.pulseSize);
    this.pulseGap = 0;
    this.emit({ t: 'pulse' });
  }
  this.spawnTimer -= dt;
  if (this.spawnTimer <= 0) {
    var f = clamp(this.t / this.wave.maxTime, 0, 1);
    this.spawnTimer = lerp(this.wave.interval0, this.wave.interval1, f) *
      (0.75 + this.rnd() * 0.5);
    this.spawnOne();
  }
};

/* --------------------- 主循环 --------------------- */
Battle.prototype.update = function (dtRaw) {
  if (this.over) return;
  var dt = Math.min(dtRaw, 0.05);
  this.t += dt;
  this.wave = escalatedWave(this.baseWave, this.t);
  this.rebuildBuckets();
  this.updateSpawns(dt);
  this.updateUnits(dt);
  this.updateZombies(dt);
  this.updateShots(dt);
  if (this.dirtyZ) { this.zombies = this.zombies.filter(aliveZ); this.dirtyZ = false; }
  if (this.over) return;
  if (this.overtime && this.dead[this.overtime] !== null) this.finish(false);
};
function aliveZ(z) { return !z.dead; }

Battle.prototype.nearestZombieInRadius = function (u) {
  var best = null, bestActual = u.radius * u.radius;
  for (var lane = 0; lane < CONFIG.LANES.length; lane++) {
    var list = this.zBuckets[u.side][lane];
    for (var i = 0; i < list.length; i++) {
      var z = list[i];
      if (z.dead) continue;
      var dx = z.x - u.x, dy = z.y - u.y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= bestActual) { best = z; bestActual = d2; }
    }
  }
  return best;
};

Battle.prototype.updateUnits = function (dt) {
  var i, j, u, list, z, d, lanes = CONFIG.LANES.length;
  for (i = 0; i < this.units.length; i++) {
    u = this.units[i];
    if (u.dead) continue;
    if (u.flash > 0) u.flash -= dt * 4;
    if (u.hurtT > 0) u.hurtT = Math.max(0, u.hurtT - dt);
    if (u.pulse > 0) u.pulse -= dt;
    if (u.actT > 0) u.actT -= dt;
    if (UNITS[u.type].behavior !== 'aura') {
      u.engT -= dt;
      if (u.engT <= 0) { u.engT = 0.2; u.engaged = this.unitEngaged(u) ? 1 : 0; }
    }

    var behavior = UNITS[u.type].behavior;
    if (behavior === 'shot') {
      u.cd -= dt;
      if (u.cd <= 0) {
        var tg = this.nearestZombieInRadius(u);
        if (tg) {
          u.cd = u.rate; u.pulse = 0.12; u.actT = 0.24; u.engaged = 1;
          var unitMods = u.mods || this.mods[u.side];
          var n = 1 + (u.type === 'turret' ? unitMods.turretShots : 0);
          for (var k = 0; k < n; k++) {
            this.shots.push({
              x: u.x, y: u.y + (k ? (k % 2 ? 10 : -10) : 0), target: tg, lx: tg.x, ly: tg.y,
              dmg: u.dmg, side: u.side, speed: UNITS[u.type].projectileSpeed ||
                (u.type === 'railgun' ? 940 : (u.type === 'sniper' ? 820 : 640)),
              life: 1.7, splash: u.splash || 0, color: UNITS[u.type].glow,
              critChance: u.critChance, critMul: u.critMul, form: u.form,
              coopOwnerSeat: u.coopOwnerSeat, coopIndex: u.coopIndex,
            });
          }
          this.emit({
            t: 'shot', x: u.x, y: u.y, side: u.side,
            seat: u.coopOwnerSeat, unitIndex: u.coopIndex,
            targetSeat: tg.coopHomeSeat, targetLane: tg.lane,
          });
        }
      }
    } else if (behavior === 'spray') {
      u.cd -= dt;
      if (u.cd <= 0) {
        var hit = false, sign = attackForwardSign(u.side);
        for (var FL = 0; FL < lanes; FL++) {
          list = this.zBuckets[u.side][FL];
          for (j = 0; j < list.length; j++) {
            z = list[j];
            var ahead = (z.x - u.x) * sign;
            if (ahead > 0 && ahead < u.range && Math.abs(z.y - u.y) <= u.spray + z.r) {
              this.damageZombie(z, u.dmg);
              if (!z.dead && u.burnDps) this.applyBurn(z, u.burnDps, u.burnT);
              hit = true;
            }
          }
        }
        if (hit) {
          u.cd = u.rate; u.pulse = 0.2; u.actT = 0.3;
          this.emit({ t: 'flame', x: u.x, y: u.y, side: u.side, range: u.range });
        }
      }
    } else if (behavior === 'aura') {
      var r2 = u.radius * u.radius;
      var lit = 0;
      for (var L = 0; L < lanes; L++) {
        list = this.zBuckets[u.side][L];
        for (j = 0; j < list.length; j++) {
          z = list[j];
          var dx = z.x - u.x, dy = z.y - u.y;
          if (dx * dx + dy * dy < r2) {
            z.slowT = 0.25;
            if (u.slow > z.slowAmt) z.slowAmt = u.slow;
            this.damageZombie(z, u.dmg * dt);
            lit++;
            if (!z.dead && u.strobeChance && z.strobeLock <= 0 && this.rnd() < u.strobeChance * dt) {
              z.stunT = Math.max(z.stunT, u.strobeDur);
              z.strobeLock = 0.35;
              this.emit({ t: 'hitZombie', x: z.x, y: z.y, form: 'stroboscope' });
            }
          }
        }
      }
      u.engaged = lit > 0 ? 1 : 0;
      if (lit > 0) u.actT = 0.22;
    } else if (behavior === 'quake') {
      u.cd -= dt;
      if (u.cd <= 0) {
        var quakeHit = false, qr = u.radius * u.radius;
        for (var QL = 0; QL < lanes; QL++) {
          list = this.zBuckets[u.side][QL];
          for (j = 0; j < list.length; j++) {
            z = list[j];
            var qdx = z.x - u.x, qdy = z.y - u.y;
            if (qdx * qdx + qdy * qdy >= qr) continue;
            this.damageZombie(z, u.dmg);
            if (!z.dead && this.rnd() < u.strobeChance) {
              z.stunT = Math.max(z.stunT, u.strobeDur);
              this.emit({ t: 'hitZombie', x: z.x, y: z.y, form: 'quake' });
            }
            quakeHit = true;
          }
        }
        if (quakeHit) {
          u.cd = u.rate; u.pulse = 0.24; u.actT = 0.36;
          this.emit({ t: 'quake', x: u.x, y: u.y, side: u.side, r: u.radius });
        }
      }
    } else if (behavior === 'healer') {
      u.cd -= dt;
      if (u.cd <= 0) {
        var totemHit = false, tr = u.radius * u.radius;
        for (var TL = 0; TL < lanes; TL++) {
          list = this.zBuckets[u.side][TL];
          for (j = 0; j < list.length; j++) {
            z = list[j];
            var tdx = z.x - u.x, tdy = z.y - u.y;
            if (tdx * tdx + tdy * tdy < tr) {
              this.damageZombie(z, u.dmg);
              if (!z.dead && u.burnDps) this.applyBurn(z, u.burnDps, u.burnT);
              totemHit = true;
            }
          }
        }
        var wounded = null, woundedFrac = 1;
        for (var UL = 0; UL < lanes; UL++) {
          list = this.uBuckets[u.side][UL];
          for (j = 0; j < list.length; j++) {
            var ally = list[j];
            if (ally.dead || ally.hp >= ally.maxHp) continue;
            var adx = ally.x - u.x, ady = ally.y - u.y;
            if (adx * adx + ady * ady >= tr) continue;
            var frac = ally.hp / ally.maxHp;
            if (frac < woundedFrac) { wounded = ally; woundedFrac = frac; }
          }
        }
        if (wounded && u.heal > 0) {
          wounded.hp = Math.min(wounded.maxHp, wounded.hp + u.heal);
          wounded.flash = Math.max(wounded.flash, 0.35);
          totemHit = true;
          this.emit({ t: 'heal', x: wounded.x, y: wounded.y, side: u.side });
        }
        if (totemHit) { u.cd = u.rate; u.pulse = 0.2; u.actT = 0.3; }
      }
    } else if (behavior === 'chain') {
      u.cd -= dt;
      if (u.cd <= 0) {
        var cands = [], rr = u.radius * u.radius;
        for (var L2 = 0; L2 < lanes; L2++) {
          list = this.zBuckets[u.side][L2];
          for (j = 0; j < list.length; j++) {
            z = list[j];
            var ddx = z.x - u.x, ddy = z.y - u.y, dd = ddx * ddx + ddy * ddy;
            if (dd < rr) cands.push({ z: z, d: dd });
          }
        }
        if (cands.length) {
          cands.sort(byDist);
          var pts = [{ x: u.x, y: u.y }], lim = Math.min(u.chain, cands.length);
          for (var c = 0; c < lim; c++) {
            this.damageZombie(cands[c].z, u.dmg);
            pts.push({ x: cands[c].z.x, y: cands[c].z.y });
          }
          u.cd = u.rate; u.pulse = 0.2; u.actT = 0.3;
          this.emit({ t: 'arc', pts: pts, side: u.side });
        }
      }
    }
  }
};
function byDist(a, b) { return a.d - b.d; }

/* 射程内是否有目标：给渲染层做「作战中」指示灯用。
   有冷却的塔每 0.2s 才问一次，探照灯/寒霜井在各自分支里逐帧给出结果。 */
Battle.prototype.unitEngaged = function (u) {
  var lanes = CONFIG.LANES.length, i, j, list, z, L;
  var behavior = UNITS[u.type].behavior;
  var isRanged = behavior === 'shot';
  if (behavior === 'block' || behavior === 'contact' || behavior === 'aura') return false;
  if (isRanged) return this.nearestZombieInRadius(u) !== null;
  var sign = attackForwardSign(u.side);
  var spray = behavior === 'spray';
  var rr = u.radius || u.range || 0;
  rr = rr * rr;
  for (L = 0; L < lanes; L++) {
    list = this.zBuckets[u.side][L];
    for (j = 0; j < list.length; j++) {
      z = list[j];
      if (spray) {
        var ahead = (z.x - u.x) * sign;
        if (ahead > 0 && ahead < u.range && Math.abs(z.y - u.y) <= u.spray + z.r) return true;
      } else {
        var dx = z.x - u.x, dy = z.y - u.y;
        if (dx * dx + dy * dy < rr) return true;
      }
    }
  }
  return false;
};

Battle.prototype.updateZombies = function (dt) {
  var i, j, z, u, ub, dir, homeX, block, bd, ahead, contact, homeContact;
  for (i = 0; i < this.zombies.length; i++) {
    z = this.zombies[i];
    if (z.dead) continue;
    if (this.coopMode && typeof this.retargetCoopZombie === 'function') this.retargetCoopZombie(z);
    if (z.flash > 0) z.flash -= dt * 4;
    if (z.strobeLock > 0) z.strobeLock -= dt;
    if (z.attackHitT > 0) {
      z.attackHitT -= dt;
      if (z.attackHitT <= 0) {
        z.attackHitT = 0;
        z.attackKind = '';
        z.attackTarget = null;
      }
    }
    if (z.burnT > 0) {
      z.burnT -= dt;
      this.damageZombie(z, z.burnDps * dt);
      if (z.dead) continue;
    }
    if (z.stunT > 0) {
      if (z.attackT > 0) this.cancelZombieAttack(z);
      z.stunT -= dt;
      continue;
    }
    if (z.slowT > 0) z.slowT -= dt; else z.slowAmt = 0;

    dir = z.side === 'p' ? -1 : 1;
    homeX = z.side === 'p' ? CONFIG.HOME_P_X : CONFIG.HOME_G_X;

    ub = this.uBuckets[z.side][z.lane];
    block = null; bd = 1e9;
    for (j = 0; j < ub.length; j++) {
      u = ub[j];
      ahead = (u.x - z.x) * dir;
      if (ahead > -12 && ahead < bd) { bd = ahead; block = u; }
    }

    contact = block && bd <= z.r + CONFIG.GRID_CELL_W / 2 - 4;
    if (z.attackT > 0 && z.attackKind === 'unit' && !contact) this.cancelZombieAttack(z);
    if (contact) {
      if (block.retal) {
        this.damageZombie(z, block.retal * dt);
        block.engaged = 1;
        block.actT = 0.2;
      }
      if (z.dead) continue;
      if (z.attackT > 0) {
        z.attackT -= dt;
        if (z.attackT <= 0) this.resolveZombieAttack(z);
      } else {
        z.atkCd -= dt;
        if (z.atkCd <= 0) this.beginZombieAttack(z, 'unit', block);
      }
      continue;
    }

    homeContact = Math.abs(z.x - homeX) <= z.r + 24;
    if (z.attackT > 0 && z.attackKind === 'home' && !homeContact) this.cancelZombieAttack(z);
    if (homeContact) {
      if (z.attackT > 0) {
        z.attackT -= dt;
        if (z.attackT <= 0) this.resolveZombieAttack(z);
      } else {
        z.atkCd -= dt;
        if (z.atkCd <= 0) this.beginZombieAttack(z, 'home', null);
      }
      continue;
    }

    var targetMods = z.targetMods || this.mods[z.side];
    var spd = z.speed * (z.slowT > 0 ? (1 - z.slowAmt) : 1) * targetMods.zombieSpeedMul;
    z.x += dir * spd * dt;
    z.y += (CONFIG.LANES[z.lane] - z.y) * Math.min(1, dt * 3);
    z.phase += dt * (4 + spd * 0.05);
  }
  if (!this.coopMode && !this.overtime && (this.dead.p !== null || this.dead.g !== null)) this.finish(false);
};

Battle.prototype.updateShots = function (dt) {
  var alive = 0;
  for (var i = 0; i < this.shots.length; i++) {
    var s = this.shots[i];
    s.life -= dt;
    var tg = s.target;
    if (tg && !tg.dead) { s.lx = tg.x; s.ly = tg.y; }
    var dx = s.lx - s.x, dy = s.ly - s.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    var step = s.speed * dt;
    if (d <= step + 8) {
      if (tg && !tg.dead) {
        var dmg = s.dmg;
        var crit = s.critChance && this.rnd() < s.critChance;
        if (crit) dmg *= s.critMul || 1;
        var hitX = s.lx, hitY = s.ly;
        this.damageZombie(tg, dmg);
        this.emit({ t: 'hitZombie', x: hitX, y: hitY });
        if (crit) this.emit({ t: 'crit', x: s.lx, y: s.ly });
        if (s.splash > 0) {
          var sr2 = s.splash * s.splash;
          var splashHit = false;
          for (var SL = 0; SL < CONFIG.LANES.length; SL++) {
            var nearby = this.zBuckets[s.side][SL];
            for (var si = 0; si < nearby.length; si++) {
              var sz = nearby[si];
              if (sz === tg || sz.dead) continue;
              var sdx = sz.x - hitX, sdy = sz.y - hitY;
              if (sdx * sdx + sdy * sdy < sr2) {
                this.damageZombie(sz, s.dmg * 0.52);
                splashHit = true;
              }
            }
          }
          if (splashHit) this.emit({ t: 'splash', x: hitX, y: hitY, r: s.splash, side: s.side });
        }
      }
      continue;
    }
    s.x += (dx / d) * step; s.y += (dy / d) * step;
    if (s.life > 0) this.shots[alive++] = s;
  }
  this.shots.length = alive;
};

Battle.prototype.damageZombie = function (z, dmg) {
  if (z.dead) return;
  z.hp -= dmg;
  if (z.hp > 0) return;
  z.dead = true;
  this.dirtyZ = true;
  this.killed[z.side]++;
  this.emit({ t: 'zdeath', x: z.x, y: z.y, r: z.r, type: z.type });
  var d = ZOMBIES[z.type];
  if (d.boom) {
    this.emit({ t: 'boom', x: z.x, y: z.y, r: d.boomR });
    var seenUnits = {};
    for (var L = 0; L < CONFIG.LANES.length; L++) {
      var list = this.uBuckets[z.side][L];
      for (var i = 0; i < list.length; i++) {
        var u = list[i];
        if (u.dead || seenUnits[u.id]) continue;
        seenUnits[u.id] = true;
        var dx = u.x - z.x, dy = u.y - z.y;
        if (dx * dx + dy * dy < d.boomR * d.boomR) {
          u.hp -= d.boom; u.flash = 1; u.hurtT = 0.28;
          if (u.hp <= 0) this.destroyUnit(u);
        }
      }
    }
  }
};

Battle.prototype.applyBurn = function (z, dps, duration) {
  if (!dps || !duration || z.dead) return;
  z.burnDps = Math.max(z.burnDps, dps);
  z.burnT = Math.max(z.burnT, duration);
};

Battle.prototype.destroyUnit = function (u) {
  if (u.dead) return;
  u.dead = true;
  if (u.type === 'barricade' && u.deathSlowT > 0) {
    var footprint = unitFootprintLanes(u.type, u.lane);
    for (var laneIndex = 0; laneIndex < footprint.length; laneIndex++) {
      var list = this.zBuckets[u.side][footprint[laneIndex]];
      for (var i = 0; i < list.length; i++) {
        var z = list[i];
        if (z.dead) continue;
        z.slowT = Math.max(z.slowT, u.deathSlowT);
        z.slowAmt = Math.max(z.slowAmt, u.deathSlowAmt);
      }
    }
    this.emit({ t: 'gateBreak', x: u.x, y: u.y, side: u.side });
  }
  this.emit({ t: 'unitDead', x: u.x, y: u.y, side: u.side, type: u.type, lv: u.lv, form: u.form });
};

Battle.prototype.finish = function (timeout) {
  if (!this.overtime) {
    if (this.decided) return;
    // 结算只展示实际播放的战斗，所有统计在结束瞬间保存。
    this.decided = true;
    this.timeout = !!timeout;
    this.hpAtEnd = { p: this.hp.p, g: this.hp.g };
    this.deadAt = { p: this.dead.p, g: this.dead.g };
    this.killedAtEnd = { p: this.killed.p, g: this.killed.g };
    this.timeAtEnd = this.t;
  }
  this.over = true;
  this.emit({ t: 'over' });
};

Battle.prototype.survived = function (side) { return this.dead[side] === null ? this.t : this.dead[side]; };

Battle.prototype.defenseStrength = function (side) {
  var hp = 0;
  for (var i = 0; i < this.units.length; i++) {
    var u = this.units[i];
    if (u.side === side && !u.dead) hp += Math.max(0, u.hp);
  }
  return hp;
};

Battle.prototype.result = function () {
  var dAt = this.deadAt || this.dead;
  var hpEnd = this.hpAtEnd || this.hp;
  var endedAt = this.timeAtEnd === null ? this.t : this.timeAtEnd;
  var kills = this.killedAtEnd || this.killed;
  var p = dAt.p, g = dAt.g, winner;
  if (p !== null && g !== null) {
    if (p !== g) winner = p > g ? 'p' : 'g';
    else {
      var kpBoth = this.killedAtEnd ? this.killedAtEnd.p : this.killed.p;
      var kgBoth = this.killedAtEnd ? this.killedAtEnd.g : this.killed.g;
      winner = kpBoth !== kgBoth
        ? (kpBoth > kgBoth ? 'p' : 'g')
        : (this.defenseStrength('p') >= this.defenseStrength('g') ? 'p' : 'g');
    }
  }
  else if (p !== null) winner = 'g';
  else if (g !== null) winner = 'p';
  else {
    var fp = hpEnd.p / this.maxHp.p, fg = hpEnd.g / this.maxHp.g;
    if (Math.abs(fp - fg) > 0.002) winner = fp > fg ? 'p' : 'g';
    else {
      // 血量打平比击杀（守得住还杀得多，才算赢）
      var kp = this.killedAtEnd ? this.killedAtEnd.p : this.killed.p;
      var kg = this.killedAtEnd ? this.killedAtEnd.g : this.killed.g;
      if (kp !== kg) winner = kp > kg ? 'p' : 'g';
      else winner = this.defenseStrength('p') >= this.defenseStrength('g') ? 'p' : 'g';
    }
  }
  return {
    winner: winner, playerTime: p === null ? endedAt : p, ghostTime: g === null ? endedAt : g,
    playerHpFrac: hpEnd.p / this.maxHp.p, ghostHpFrac: hpEnd.g / this.maxHp.g,
    timeout: this.timeout, playerKills: kills.p, ghostKills: kills.g,
    playerFirstHit: this.firstHomeHit.p, ghostFirstHit: this.firstHomeHit.g,
  };
};

/* 保留原调用入口；胜负和统计均以可见战斗的结束快照为准。 */
Battle.prototype.decide = function (dt) {
  return this.result();
};

Battle.prototype.runToEnd = function (dt, cap) {
  dt = dt || 1 / 30; cap = cap || 20000;
  var n = 0;
  while (!this.over && n++ < cap) { this.update(dt); this.fx.length = 0; }
  return n;
};

/* The Worker imports this file through CommonJS and supplies its combat data
   through config.js. Browser builds keep the existing classic-script globals. */
if (typeof module !== 'undefined' && module.exports) {
  if (typeof globalThis.L !== 'function') {
    globalThis.L = function (_path, _args, fallback) { return fallback || ''; };
  }
  var combatConfig = require('./config.js');
  Object.keys(combatConfig).forEach(function (key) { globalThis[key] = combatConfig[key]; });
  module.exports = {
    Battle: Battle, defaultMods: defaultMods, combineMods: combineMods,
    makeUnit: makeUnit, makeZombie: makeZombie, zombieCapAt: zombieCapAt,
    config: combatConfig,
  };
}
