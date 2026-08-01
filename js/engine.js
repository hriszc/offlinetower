/* ============================================================
 * 战斗引擎（纯逻辑,不依赖 DOM）
 * 武将 = 塔（POW武将 = ATK×FRQ×RGE×目标数）；怪物从左侧行进至阿斗
 * ============================================================ */
window.Engine = (function () {
  'use strict';
  const Rand = window.Rand;
  const CFG = window.CFG;

  class Monster {
    constructor(type, waveN, elite, boss, map) {
      const t = CFG.MONSTER_TYPES[type];
      this.type = type; this.elite = elite; this.boss = boss;
      this.spd = 0.55 * t.spd * map.spdMul;
      if (boss) this.spd *= 0.7;            // BOSS 血厚行缓（与 POW 校验口径一致）
      this.col = -0.3;                      // 出生在棋盘左侧外
      this.row = Rand.pick(map.rows);
      this.dead = false;
      this.stunUntil = 0;
      this.dot = null;                      // {dps, until}
      this.slow = 0;                        // 0..1 减速比例
      this.dmgTaken = 0;                    // 受伤加成
      this.debuffUntil = 0;
      this.atkTimer = 0;
      this.arrived = false;
      // 血量/攻击在 battle 里按波次配置再设（需精英/BOSS 系数）
      this.waveN = waveN;
    }
    resetStats(cfg) {
      this.hp = cfg.hp; this.maxHp = cfg.hp;
      this.atkGap = cfg.atkGap;
    }
    update(dt, battle) {
      if (this.dead) return;
      if (this.stunUntil > battle.time) return;      // 眩晕
      // 司马懿减速/增伤到期恢复
      if (this.debuffUntil && this.debuffUntil < battle.time) {
        this.slow = 0;
        this.dmgTaken = Math.max(0, this.dmgTaken - 0.25);
        this.debuffUntil = 0;
      }
      if (this.dot && this.dot.until > battle.time) {
        this.damage(this.dot.dps * dt, null, battle, true);
      }
      if (!this.arrived) {
        this.col += this.spd * (1 - this.slow) * dt;
        if (this.col >= 6) { this.arrived = true; this.col = 6; this.atkTimer = 0.6; battle.onArrive(this); }
      } else {
        this.atkTimer -= dt;
        if (this.atkTimer <= 0) {
          this.atkTimer = this.atkGap;
          battle.hitAdou(this);
        }
      }
    }
    damage(v, attacker, battle, noHitFx) {
      if (this.dead) return 0;
      v = Math.max(0, v * (1 + this.dmgTaken));
      this.hp -= v;
      if (this.hp <= 0) { this.dead = true; battle.onMonsterKilled(this, attacker); }
      return v;
    }
  }

  class Unit {
    constructor(gen, level) {
      const g = CFG.GENERALS.find(x => x.name === gen);
      this.gen = g; this.level = level || 1;
      this.attackCount = 0; this.kills = 0;   // 攻击次数 = 局内成长曲线（无升星）
      this.deployed = false; this.col = -1; this.row = -1;
      this.cd = 0; this.fury = 0;
      this.skillCd = 3;
      this.buffAtk = 0; this.buffFrq = 0;   // 自身临时 buff（占位,团队 buff 在 battle）
    }
    baseAtk() { return this.gen.atk * (1 + (this.level - 1) * CFG.LV_GROW); }
    baseFrq() { return this.gen.frq; }
    baseRge() { return this.gen.rge; }
    baseTargets() { return this.gen.targets; }
  }

  class Battle {
    constructor(map, opts) {
      this.map = map;
      this.opts = opts || {};
      this.time = 0;
      this.wave = 0;                    // 当前进行中的波数（0=准备中）
      this.waveState = 'idle';          // idle | spawning | clearing
      this.queue = [];                  // 待生成怪物配置
      this.spawnTimer = 0;
      this.monsters = [];
      this.units = [];                  // 已部署武将
      this.adou = { hp: 3, maxHp: 3 };
      this.teamBuffs = { atkAdd: 0, frqAdd: 0, until: 0 };
      // 局间道具常驻加成（由 game 开局按存档 items 设置）
      this.permaAtk = 0; this.permaFrq = 0; this.permaCrit = 0;
      this.permaCd = 1; this.permaFury = 0; this.eliteDmg = 0;
      this.over = false; this.result = null;
      this.popUsed = 0; this.popMax = 6;
      this.callbacks = {};
      // 首波准备时间
      this.prepTimer = 8;
      this.clearingTimer = 0;
    }
    on(ev, fn) { this.callbacks[ev] = fn; }
    emit(ev, ...args) { if (this.callbacks[ev]) this.callbacks[ev](...args); }

    /* ---------- 布阵 ---------- */
    deploy(unit, col, row) {
      if (this.popUsed >= this.popMax) return false;
      if (col < 0 || col > 5 || row < 0 || row > 4) return false;
      if (this.units.some(u => u.col === col && u.row === row)) return false;
      unit.deployed = true; unit.col = col; unit.row = row;
      unit.cd = 0.3;                     // 部署后短暂准备
      this.units.push(unit);
      this.popUsed++;
      return true;
    }
    recall(unit) {
      const i = this.units.indexOf(unit);
      if (i < 0) return false;
      this.units.splice(i, 1);
      unit.deployed = false; unit.col = -1; unit.row = -1;
      this.popUsed--;
      return true;
    }
    // 检查某个格子能否部署
    canPlace(col, row) {
      if (this.popUsed >= this.popMax) return false;
      if (col < 0 || col > 5 || row < 0 || row > 4) return false;
      if (col === 6) return false;
      return !this.units.some(u => u.col === col && u.row === row);
    }

    /* ---------- 战力（无羁绊/无克制/无被动；局间道具常驻加成） ---------- */
    baseCrit() { return { rate: 0.12 + this.permaCrit, dmg: 0.5 }; }
    skillCdMult() { return this.permaCd; }

    /* ---------- 波次 ---------- */
    // 单怪血量：与 spawnMonster 生成完全一致（精英加成已含在 wc.hpMul，BOSS 额外 ×12）
    monsterHp(type, wc, isBoss) {
      let hp = CFG.BASE_MON_HP * wc.hpMul * CFG.MONSTER_TYPES[type].hp;
      if (isBoss) hp *= 12;
      return hp;
    }
    startNextWave() {
      this.wave++;
      const wc = CFG.waveConfig(this.wave);
      // POW 约束：怪物总 POW ≤ 玩家 POW × 1.5（方案 §5.4），超出则削减数量。
      // 校验与生成共用同一份类型抽样与血量/速度口径（含地图系数与 BOSS 减速），避免低估。
      const playerPOW = this.units.reduce((s, u) => s + this.effAtk(u) * this.effFrq(u) * this.effRge(u) * u.baseTargets(), 0);
      // 地图数量系数（云梦泽 ×1.25 多怪 / 虎牢关 ×0.9 少怪）,校验与生成共用
      let count = Math.round(wc.count * this.map.countMul);
      const types = [];
      for (let i = 0; i < count; i++) types.push(Rand.pick(CFG.MONSTER_TYPES_KEYS));
      let wavePow = 0;
      for (const t of types) {
        const mt = CFG.MONSTER_TYPES[t];
        wavePow += this.monsterHp(t, wc, false) * (0.55 * mt.spd * this.map.spdMul);
      }
      let bossType = null;
      if (wc.bossCount) {   // BOSS 也计入校验（hp×12, spd×0.7, 地图系数）
        bossType = Rand.pick(CFG.MONSTER_TYPES_KEYS);
        const mt = CFG.MONSTER_TYPES[bossType];
        wavePow += this.monsterHp(bossType, wc, true) * (0.55 * mt.spd * this.map.spdMul * 0.7);
      }
      if (playerPOW > 0 && wavePow > playerPOW * 1.5) {
        const k = (playerPOW * 1.5) / wavePow;
        count = Math.max(1, Math.floor(count * k));
        types.length = count;               // 削减后与队列生成保持一致
        this.powCut = true;
      } else this.powCut = false;
      // 组装队列（复用校验时的抽样）
      this.queue = types.map(t => ({ type: t, elite: wc.elite, boss: false }));
      if (wc.bossCount && bossType) {
        this.queue.splice(Math.floor(this.queue.length * 0.6), 0,
          { type: bossType, elite: false, boss: true });
      }
      this.waveState = 'spawning';
      this.spawnTimer = 0.5;
      this.emit('waveStart', wc, count, this.powCut);
    }
    spawnMonster(cfg) {
      const m = new Monster(cfg.type, this.wave, cfg.elite, cfg.boss, this.map);
      const mt = CFG.MONSTER_TYPES[cfg.type];
      const wc = CFG.waveConfig(this.wave);
      // 血量与 POW 校验完全一致（wc.hpMul 已含精英 ×2；BOSS 在此 ×12）
      const hp = this.monsterHp(cfg.type, wc, cfg.boss);
      // 阿斗为滴制（1 滴/次），怪物攻击成长体现在攻击间隔缩短：gap = 1.2 / 1.05^(n-1)
      const atkGap = (mt.atkSpd || 1.2) / Math.pow(CFG.WAVE_ATK_GROW, this.wave - 1);
      m.resetStats({ hp: hp, atkGap: Math.max(0.35, atkGap) });
      this.monsters.push(m);
      this.emit('monsterSpawn', m);
      return m;
    }

    /* ---------- 主循环 ---------- */
    update(dt) {
      if (this.over) return;
      this.time += dt;
      // 准备期
      if (this.wave === 0) {
        this.prepTimer -= dt;
        if (this.prepTimer <= 0) this.startNextWave();
        return;
      }
      // 生成
      if (this.waveState === 'spawning' && this.queue.length) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnMonster(this.queue.shift());
          this.spawnTimer = 0.55;
        }
      }
      // 怪物
      for (const m of this.monsters.slice()) m.update(dt, this);
      // 武将
      for (const u of this.units.slice()) this.updateUnit(u, dt);
      // 团队 buff 计时
      if (this.teamBuffs.until > 0 && this.time > this.teamBuffs.until) {
        this.teamBuffs.atkAdd = 0; this.teamBuffs.frqAdd = 0; this.teamBuffs.until = 0;
      }
      // 清理死亡怪
      this.monsters = this.monsters.filter(m => !m.dead);
      // 波次清空判定
      if (this.waveState === 'spawning' && !this.queue.length && this.monsters.length === 0) {
        this.waveState = 'clearing';
        this.clearingTimer = 0;
      }
      if (this.waveState === 'clearing') {
        this.clearingTimer += dt;
        this.emit('waveClearTick', this.clearingTimer);
        if (this.clearingTimer >= 2.2) {
          this.emit('waveClear', this.wave);
          if (this.wave >= CFG.MAX_WAVE) {
            this.finish('victory');
            return;
          }
          this.startNextWave();
        }
      }
    }

    updateUnit(u, dt) {
      u.cd -= dt;
      u.skillCd -= dt;
      if (u.cd <= 0) {
        const targets = this.pickTargets(u);
        if (targets.length) {
          u.cd = 1 / this.effFrq(u);
          u.fury = Math.min(100, u.fury + (4 + this.permaFury) * targets.length);
          u.attacking = this.time + 0.18;
          for (const t of targets) {
            const r = this.calcDmg(u, t);
            t.damage(r.dmg, u, this);
            this.emit('dmg', t, r.dmg, r.crit);
          }
          // 局内成长：按攻击次数升级（无升星）
          u.attackCount += targets.length;
          const need = CFG.attackNeed(u.level);
          if (u.attackCount >= need) {
            u.attackCount -= need;
            u.level++;
            this.emit('levelUp', u);
          }
        }
      }
      // 主动技能自动释放：满怒且冷却就绪
      if (u.fury >= 100 && u.skillCd <= 0 && !this.over) {
        this.castSkill(u);
      }
    }

    effAtk(u) {
      return u.baseAtk() * (1 + this.teamBuffs.atkAdd + this.permaAtk + u.buffAtk);
    }
    effFrq(u) {
      return u.baseFrq() * (1 + this.teamBuffs.frqAdd + this.permaFrq + u.buffFrq);
    }
    effRge(u) {
      return u.baseRge();
    }

    calcDmg(u, m) {
      const c = this.baseCrit();
      const crit = Math.random() < c.rate ? (1 + c.dmg) : 1;
      // 无职业克制；局间道具「破军印」对精英/BOSS 增伤
      const mult = 1 + (this.eliteDmg && (m.elite || m.boss) ? this.eliteDmg : 0);
      return { dmg: Math.max(1, Math.round(this.effAtk(u) * mult * crit)), crit: crit > 1 };
    }

    pickTargets(u) {
      const rge = this.effRge(u);
      const inRange = this.monsters.filter(m => !m.dead &&
        Math.abs(m.col - u.col) + Math.abs(m.row - u.row) <= rge);
      // 优先攻击最接近阿斗的（col 最大）
      inRange.sort((a, b) => b.col - a.col || b.maxHp - a.maxHp);
      return inRange.slice(0, u.baseTargets());
    }

    /* ---------- 阿斗（主君单位,卖血经济载体；英雄不承伤无回血） ---------- */
    hitAdou(m) {
      if (this.over) return;
      this.adou.hp -= 1;
      this.emit('adouHit', m);
      if (this.adou.hp <= 0) {
        this.adou.hp = 0;
        this.finish('fail');
      }
    }

    /* ---------- 事件（由 game 注入） ---------- */
    onArrive(m) { this.emit('arrive', m); }
    onMonsterKilled(m, attacker) {
      this.emit('kill', m, attacker);
      if (m.boss) this.emit('bossKill', m);
    }

    /* ---------- 技能 ---------- */
    castSkill(u) {
      if (u.fury < 100 || u.skillCd > 0 || !u.deployed || this.over) return false;
      const s = u.gen.skill;
      const atk = this.effAtk(u);
      u.fury = 0;
      u.skillCd = 15 * this.skillCdMult();
      const alive = () => this.monsters.filter(m => !m.dead);
      switch (s.type) {
        case 'bolt': {  // 诸葛亮
          const list = alive();
          for (let i = 0; i < 6 && list.length; i++) {
            const t = Rand.pick(list);
            const d = t.damage(atk * 1.5, u, this);
            this.emit('boltFx', t, d);
          }
          break;
        }
        case 'buff': {  // 曹操 / 刘备（无回血,英雄不承伤）
          if (u.gen.name === '刘备') {
            this.teamBuffs.atkAdd += 0.20; this.teamBuffs.until = Math.max(this.teamBuffs.until, this.time + 5);
          } else {
            this.teamBuffs.atkAdd += 0.30; this.teamBuffs.frqAdd += 0.20; this.teamBuffs.until = this.time + 5;
          }
          this.emit('skillFx', u, 'buff');
          break;
        }
        case 'single': { // 关羽
          const list = alive();
          if (list.length) {
            list.sort((a, b) => b.maxHp - a.maxHp);
            const t = list[0];
            const d = t.damage(atk * 4, u, this);
            this.emit('skillFx', u, 'single', t, d);
          }
          break;
        }
        case 'dash': {   // 赵云
          const line = alive().filter(m => Math.abs(m.row - u.row) <= 0.5 && m.col > u.col - 0.5);
          for (const t of line) {
            const d = t.damage(atk * 3, u, this);
            t.col = Math.max(0.3, t.col - 1.0);   // 击退
            this.emit('skillFx', u, 'dash', t, d);
          }
          break;
        }
        case 'aoe': {    // 吕布
          const list = alive().filter(m => Math.abs(m.col - u.col) + Math.abs(m.row - u.row) <= 2.5);
          for (const t of list) {
            const d = t.damage(atk * 3.5, u, this);
            this.emit('skillFx', u, 'aoe', t, d);
          }
          break;
        }
        case 'stun': {   // 张飞
          const list = alive().filter(m => Math.abs(m.col - u.col) + Math.abs(m.row - u.row) <= 1.5);
          for (const t of list) {
            t.damage(atk * 1.8, u, this);
            t.stunUntil = this.time + 2;
            this.emit('skillFx', u, 'stun', t);
          }
          break;
        }
        case 'dot': {    // 周瑜
          for (const t of alive()) {
            t.dot = { dps: atk * 0.8, until: this.time + 4 };
          }
          this.emit('skillFx', u, 'dot');
          break;
        }
        case 'debuff': { // 司马懿
          for (const t of alive()) {
            t.slow = Math.max(t.slow, 0.4);
            t.dmgTaken += 0.25;
            t.debuffUntil = this.time + 4;
          }
          this.emit('skillFx', u, 'debuff');
          break;
        }
        case 'economy': { // 孙权
          this.emit('economy', u);
          this.teamBuffs.atkAdd += 0.10; this.teamBuffs.until = Math.max(this.teamBuffs.until, this.time + 6);
          this.emit('skillFx', u, 'economy');
          break;
        }
      }
      return true;
    }

    /* ---------- 终结 ---------- */
    finish(result) {
      this.over = true;
      this.result = result;
      this.emit('finish', result);
    }
    // 我方坚持波数 = 当前已开始的波数（失败时正在第 N 波 → 坚持 N）
    wavesSurvived() { return this.wave; }
  }

  return { Monster, Unit, Battle };
})();
