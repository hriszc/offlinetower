'use strict';

/* ---------------------------------------------------------------
 * 元游戏状态机：备战 -> 战斗 -> 结算 -> 三选一 -> 下一小局 -> 大局排位
 * ------------------------------------------------------------- */

var SAVE_KEY = 'yeshou.save.v1';

var Game = {
  state: 'menu',            // menu | build | battle | result | reward | matchEnd
  roundIndex: 0,
  coins: 0,
  relics: [],
  grid: {},                 // "col|lane" -> {type, lv, form}
  battle: null,
  bot: null,
  threat: null,
  loadout: null,
  unlockedUnits: null,
  seed: 1,
  formChoice: null,
  result: null,
  reward: null,
  flare: 0, repair: 0,
  hoverCell: null,
  armedType: null,
  selectedCell: null,
  lastRankDelta: 0,
  history: [],
  tutorialActive: false,
  tutorialStep: 0,
  tutorialTarget: null,
  tutorialRequested: false,
  matchmaking: null,
  coopMode: false,
  coopLocked: false,
  coopSeat: 0,
  coopSide: 'p',
  coopRoom: null,
  coopHomes: null,
  pendingPlacement: null,
  paused: false,
  undoSale: null,

  save: {
    rank: 0, matches: 0, totalWins: 0, bestWins: 0,
    muted: false, name: '', loadout: [], tutorialDone: false, run: null,
    largeText: false, reducedMotion: false, soundVolume: 1,
  },

  /* ---------------- 存档 ---------------- */
  load: function () {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        for (var k in this.save) if (o[k] !== undefined) this.save[k] = o[k];
      }
    } catch (e) { /* 隐私模式等，忽略 */ }
    if (!this.save.name) {
      this.save.name = L('meta.defaultName', {
        prefix: BOT_PREFIX[(Math.random() * BOT_PREFIX.length) | 0],
        role: BOT_ROLE[(Math.random() * BOT_ROLE.length) | 0],
      }, '{prefix}的手艺人');
    }
    if (typeof this.save.largeText !== 'boolean') this.save.largeText = false;
    if (typeof this.save.reducedMotion !== 'boolean') this.save.reducedMotion = false;
    this.save.soundVolume = Number.isFinite(this.save.soundVolume)
      ? Math.max(0, Math.min(1, this.save.soundVolume)) : 1;
    Sfx.setVolume(this.save.soundVolume);
    Sfx.setEnabled(!this.save.muted);
  },
  persist: function () {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { }
  },

  checkpoint: function () {
    if (this.coopMode || !this.loadout || ['build', 'battle', 'result', 'reward'].indexOf(this.state) < 0) return;
    this.save.run = {
      version: 1, phase: this.state === 'battle' ? 'build' : this.state,
      roundIndex: this.roundIndex, coins: this.coins, seed: this.seed,
      grid: this.playerBuild().map(function (u) { return Object.assign({}, u); }),
      relics: this.relics.map(function (r) { return r.id; }),
      loadout: this.loadout.slice(), history: this.history.slice(),
      result: this.result, reward: (this.reward || []).map(function (r) { return r.id; }),
      tutorialStep: this.tutorialActive ? this.tutorialStep : 0,
    };
    this.persist();
  },
  canResume: function () {
    var run = this.save.run;
    return !!(run && run.version === 1 && ['build', 'result', 'reward'].indexOf(run.phase) >= 0 &&
      Number.isInteger(run.roundIndex) && run.roundIndex >= 0 && run.roundIndex < CONFIG.TOTAL_ROUNDS &&
      Number.isFinite(run.coins) && run.coins >= 0 && Array.isArray(run.grid) &&
      Array.isArray(run.relics) && Array.isArray(run.loadout) && Array.isArray(run.history) && Array.isArray(run.reward) &&
      (run.phase === 'build' || run.result));
  },
  resumeRun: function () {
    if (!this.canResume()) return false;
    var run = this.save.run;
    this.coopMode = false; this.paused = false; this.undoSale = null;
    this.roundIndex = run.roundIndex; this.coins = run.coins; this.seed = run.seed;
    this.relics = run.relics.map(function (id) { return RELICS.find(function (r) { return r.id === id; }); }).filter(Boolean);
    this.loadout = normalizeLoadout(run.loadout, this.save.rank);
    this.history = run.history.slice(); this.result = run.result;
    this.reward = run.reward.map(function (id) { return RELICS.find(function (r) { return r.id === id; }); }).filter(Boolean);
    this.grid = {};
    run.grid.forEach(function (u) { if (UNITS[u.type]) this.grid[u.col + '|' + u.lane] = Object.assign({}, u); }, this);
    this.matchmaking = null;
    this.beginBuild(); UI.closeOverlay(); UI.buildCards(this.loadout);
    this.tutorialActive = run.tutorialStep > 0; this.tutorialStep = run.tutorialStep || 0;
    this.setTutorialTarget();
    this.state = run.phase;
    if (run.phase === 'result') UI.showResult();
    else if (run.phase === 'reward') UI.showReward();
    UI.syncAll();
    return true;
  },
  pause: function () {
    if (this.coopMode || this.paused || this.matchmaking || ['build', 'battle'].indexOf(this.state) < 0 || UI.overlayMode) return;
    this.paused = true; this.checkpoint(); UI.showPause();
  },
  resume: function () { this.paused = false; UI.closeOverlay(); UI.syncAll(); },
  returnToMenu: function () {
    this.checkpoint(); this.paused = false; this.matchmaking = null;
    this.state = 'menu'; this.battle = null; this.armedType = null; this.selectedCell = null;
    UI.flareArmed = false; UI.closeOverlay(); UI.showMenu(); UI.syncAll();
  },

  rankInfo: function () { return rankFor(this.save.rank); },
  nextRankInfo: function () { return nextRank(this.save.rank); },

  /* ---------------- 开局 ---------------- */
  startRun: function () {
    this.paused = false; this.undoSale = null; this.save.run = null;
    this.result = null; this.reward = null;
    this.coopMode = false;
    this.coopLocked = false;
    this.coopSeat = 0;
    this.coopSide = 'p';
    this.coopRoom = null;
    this.coopHomes = null;
    this.pendingPlacement = null;
    this.roundIndex = 0;
    this.coins = CONFIG.START_COINS;
    this.relics = [];
    this.grid = {};
    this.history = [];
    this.tutorialActive = false;
    this.tutorialStep = 0;
    this.tutorialTarget = null;
    this.matchmaking = null;
    this.persist();
    this.seed = (Math.random() * 1e9) | 0;
    this.loadout = normalizeLoadout(this.save.loadout, this.save.rank);
    UI.buildCards(this.loadout);
    this.beginBuild();
    UI.showLoadout();
  },

  startCoopRound: function (member, roundIndex) {
    this.paused = false;
    this.coopMode = true;
    this.coopLocked = false;
    this.coopSeat = member.seat || 0;
    this.coopSide = coopSideForSeat(this.coopSeat);
    this.coopRoom = Coop.state && Coop.state.room ? Coop.state.room : null;
    this.coopHomes = this.coopRoom ? this.coopRoom.players.map(function (player) {
      return {
        seat: player.seat, side: coopSideForSeat(player.seat), sideSeat: coopLocalSeat(player.seat),
        name: player.nickname, hp: CONFIG.HOME_HP, maxHp: CONFIG.HOME_HP,
      };
    }) : null;
    this.roundIndex = roundIndex;
    this.coins = member.coins;
    this.relics = (member.relics || []).map(function (id) {
      return RELICS.find(function (r) { return r.id === id; });
    }).filter(Boolean);
    this.grid = {};
    var laneOffset = coopLaneOffset(this.coopSeat);
    (member.draft && member.draft.build || []).forEach(function (unit) {
      var lane = unit.lane + laneOffset;
      this.grid[unit.col + '|' + lane] = {
        type: unit.type, col: unit.col, lane: lane, lv: unit.lv || 1, form: unit.form || null,
      };
    }, this);
    this.history = ((Coop.state && Coop.state.room && Coop.state.room.teamHistory) || []).map(function (won, i) {
      return { round: i, won: !!won };
    });
    this.tutorialActive = false;
    this.tutorialStep = 0;
    this.tutorialTarget = null;
    this.matchmaking = null;
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.loadout = normalizeLoadout(member.loadout || this.save.loadout, this.save.rank);
    UI.buildCards(this.loadout);
    this.beginBuild();
  },

  endCoop: function () {
    this.coopMode = false;
    this.coopLocked = false;
    this.coopSeat = 0;
    this.coopSide = 'p';
    this.coopRoom = null;
    this.coopHomes = null;
    this.pendingPlacement = null;
    this.state = 'menu';
    this.battle = null;
    this.grid = {};
    this.matchmaking = null;
  },

  playerBuild: function () {
    var out = [];
    for (var k in this.grid) out.push(this.grid[k]);
    return out;
  },
  playerMods: function () { return combineMods(this.relics); },

  beginFirstRunTutorial: function () {
    var shouldStart = this.shouldTeach();
    this.tutorialRequested = false;
    this.tutorialActive = shouldStart;
    this.tutorialStep = shouldStart ? 1 : 0;
    this.setTutorialTarget();
    this.checkpoint();
    UI.syncAll();
  },

  shouldTeach: function () {
    return !this.save.tutorialDone && (this.tutorialRequested ||
      (this.save.matches === 0 && this.save.totalWins === 0 && this.save.bestWins === 0));
  },

  tutorialType: function () {
    return ['barricade', 'spike', 'turret'][Math.floor((this.tutorialStep - 1) / 2)] || null;
  },
  setTutorialTarget: function () {
    this.tutorialTarget = this.tutorialActive && this.tutorialStep < 7
      ? { col: this.tutorialType() === 'turret' ? 6 : this.tutorialType() === 'spike' ? 8 : 7, lane: 1 } : null;
  },
  /* 三种动物各选卡、放置一次，最后开始防守。 */
  tutorialAdvance: function (from, to, message) {
    if (!this.tutorialActive || this.tutorialStep !== from) return false;
    this.tutorialStep = to;
    this.setTutorialTarget();
    if (message) UI.toast(L(message, null, message));
    UI.syncAll();
    return true;
  },

  tutorialPickCard: function (type) {
    if (this.tutorialActive && this.tutorialStep < 7 && this.tutorialStep % 2 === 1 && type === this.tutorialType()) {
      this.tutorialAdvance(this.tutorialStep, this.tutorialStep + 1);
    }
  },

  finishTutorial: function (message) {
    if (!this.tutorialActive) return;
    this.tutorialActive = false;
    this.tutorialStep = 0;
    this.tutorialTarget = null;
    this.save.tutorialDone = true;
    this.tutorialRequested = false;
    this.checkpoint();
    this.persist();
    if (message) UI.toast(L(message, null, message));
    UI.syncAll();
  },

  beginBuild: function () {
    this.state = 'build';
    this.pendingPlacement = null;
    if (this.formChoice) this.cancelFormChoice(true);
    this.flare = CONFIG.FLARE_CHARGES;
    this.repair = CONFIG.REPAIR_CHARGES;
    this.armedType = null;
    this.selectedCell = null;
    this.hoverCell = null;
    this.unlockedUnits = unlockedUnitIds(this.save.rank);
    this.loadout = normalizeLoadout(this.loadout || this.save.loadout, this.save.rank);
    var pressureRank = this.coopMode && window.Coop ? Coop.averageRank() : this.save.rank;
    this.pressure = rankPressure(pressureRank);
    this.threat = rankThreat(pressureRank);
    this.bot = this.coopMode
      ? { name: '协防伙伴', tag: '合作守夜', rating: Math.round(pressureRank / 12), build: [], mods: defaultMods() }
      : makeBot(
        this.roundIndex,
        this.seed + this.roundIndex * 977,
        this.pressure,
        this.threat,
        this.unlockedUnits
      );
    var coopSide = this.coopMode ? this.coopSide : 'p';
    var coopBuild = this.playerBuild();
    var mods = this.playerMods();
    this.battle = new Battle({
      roundIndex: this.roundIndex,
      pressure: this.pressure,
      playerBuild: coopSide === 'p' ? coopBuild : this.bot.build,
      ghostBuild: coopSide === 'g' ? coopBuild : this.bot.build,
      playerMods: coopSide === 'p' ? mods : defaultMods(),
      ghostMods: coopSide === 'g' ? mods : this.bot.mods,
      seed: this.seed + this.roundIndex * 7717 + 3,
    });
    if (this.playerMods().startRepair) { /* 在 Battle 构造里已处理 */ }
    UI.syncAll();
  },

  startBattle: function () {
    if (this.state !== 'build' || this.paused) return;
    if (this.coopMode) {
      if (!this.coopLocked && window.Coop) Coop.readyUp();
      return;
    }
    if (this.matchmaking) return;
    if (this.tutorialActive && this.tutorialStep < 7) { UI.toast(L('experience.tutorialPlace')); return; }
    this.checkpoint(); this.undoSale = null;
    if (this.formChoice) this.cancelFormChoice(true);
    if (this.tutorialActive) this.finishTutorial();
    this.matchmaking = { time: 0, phase: 'searching' };
    Sfx.resume();
    Sfx.ui();
    UI.syncAll();
  },

  enterBattle: function () {
    if (!this.matchmaking || this.state !== 'build') return;
    this.matchmaking = null;
    this.state = 'battle';
    this.armedType = null;
    this.selectedCell = null;
    this.hoverCell = null;
    Sfx.resume();
    Sfx.warning();
    Render.flash = 0.12;
    Render.flashColor = '130,20,18';
    UI.syncAll();
  },

  updateMatchmaking: function (dt) {
    if (!this.matchmaking) return;
    this.matchmaking.time += dt;
    if (this.matchmaking.time >= 0.72 && this.matchmaking.phase === 'searching') {
      this.matchmaking.phase = 'found';
      Sfx.coin();
      UI.syncAll();
    }
    if (this.matchmaking.time >= 1.55) {
      this.enterBattle();
    }
  },

  /* ---------------- 备战期操作 ---------------- */
  unitAt: function (col, lane) {
    return gridUnitAt(this.grid, col, lane);
  },
  canPlace: function (col, lane, type) {
    if (!isColUnlocked(this.roundIndex, col)) {
      return { ok: false, why: L('meta.plotLocked', null, '这块地还没清理出来') };
    }
    var laneOffset = this.coopMode ? coopLaneOffset(this.coopSeat) : 0;
    var laneCount = this.coopMode ? CONFIG.COOP_LANES_PER_PLAYER : unlockedLaneCount(this.roundIndex);
    var localLane = lane - laneOffset;
    if (this.coopMode
        ? (localLane < 0 || localLane >= laneCount)
        : !isLaneUnlocked(this.roundIndex, lane)) {
      return { ok: false, why: this.coopMode
        ? L('coop.ownLanesOnly', null, '只能在自己负责的三路布防')
        : L('meta.laneLocked', { n: this.roundIndex + 2 }, '这条路还没打通 · 第 {n} 小局开启'), lane: lane };
    }
    var unitType = type || this.armedType;
    var anchor = unitAnchorLane(unitType, localLane, laneCount);
    if (anchor >= 0) anchor += laneOffset;
    if (anchor < 0) {
      return { ok: false, why: this.coopMode
        ? L('coop.ownLanesOnly', null, '只能在自己负责的三路布防')
        : L('meta.laneLocked', { n: this.roundIndex + 2 }, '这条路还没打通 · 第 {n} 小局开启'), lane: lane };
    }
    var rows = unitFootprintLanes(unitType, anchor);
    for (var i = 0; i < rows.length; i++) {
      if (this.coopMode
          ? (rows[i] < laneOffset || rows[i] >= laneOffset + laneCount)
          : !isLaneUnlocked(this.roundIndex, rows[i])) {
        return { ok: false, why: L('coop.ownLanesOnly', null, '只能在自己负责的三路布防'), lane: anchor, rows: rows };
      }
      if (this.unitAt(col, rows[i])) {
        return { ok: false, why: L('meta.cellOccupied', null, '这格已经有东西了'), lane: anchor, rows: rows };
      }
    }
    return { ok: true, col: col, lane: anchor, rows: rows };
  },
  place: function (type, col, lane) {
    if (this.paused || this.state !== 'build') return false;
    if (this.coopMode && this.coopLocked) return false;
    var c = this.canPlace(col, lane, type);
    if (!c.ok) { Sfx.error(); UI.toast(c.why); return false; }
    if (this.loadout && this.loadout.indexOf(type) < 0) {
      Sfx.error(); UI.toast(L('meta.notInLoadout', null, '这只动物伙伴不在本局队伍里')); return false;
    }
    var cost = UNITS[type].cost;
    if (cost > this.coins) {
      Sfx.error(); UI.toast(L('meta.notEnoughCoins', null, '金币不够')); return false;
    }
    if (this.tutorialActive) {
      var target = this.tutorialTarget;
      if (this.tutorialStep % 2 !== 0 || !target || type !== this.tutorialType() || col !== target.col || c.lane !== target.lane) {
        UI.toast(L('experience.tutorialPlace')); return false;
      }
      this.tutorialAdvance(this.tutorialStep, this.tutorialStep + 1);
    }
    this.coins -= cost;
    this.grid[col + '|' + c.lane] = { type: type, col: col, lane: c.lane, lv: 1, form: null };
    this.refreshBuild();
    Sfx.place();
    return true;
  },
  upgradeAt: function (col, lane) {
    if (this.paused || this.state !== 'build') return;
    if (this.coopMode && this.coopLocked) return;
    var u = this.unitAt(col, lane);
    if (!u) return;
    col = u.col; lane = u.lane;
    var d = UNITS[u.type];
    if (u.lv >= d.maxLv) {
      Sfx.error(); UI.toast(L('meta.alreadyMaxed', null, '已经是满级了')); return;
    }
    var cost = upgradeCost(u.type, u.lv);
    if (cost > this.coins) {
      Sfx.error(); UI.toast(L('meta.notEnoughCoinsUpgrade', null, '金币不够升级')); return;
    }
    if (u.lv === 1 && !u.form) {
      this.beginFormChoice(col, lane);
      return;
    }
    this.coins -= cost;
    u.lv++;
    this.refreshBuild();
    Sfx.place();
  },
  beginFormChoice: function (col, lane) {
    if (this.paused || this.state !== 'build' || (this.coopMode && this.coopLocked)) return false;
    var u = this.unitAt(col, lane);
    if (!u || u.lv !== 1 || u.form) return false;
    col = u.col; lane = u.lane;
    var cost = upgradeCost(u.type, u.lv);
    if (cost > this.coins) {
      Sfx.error(); UI.toast(L('meta.notEnoughCoinsUpgrade', null, '金币不够升级')); return false;
    }
    this.formChoice = { col: col, lane: lane };
    UI.showFormChoice();
    return true;
  },
  confirmForm: function (formId) {
    if (this.paused || this.state !== 'build' || !this.formChoice || (this.coopMode && this.coopLocked)) return false;
    var key = this.formChoice.col + '|' + this.formChoice.lane;
    var u = this.grid[key];
    if (!u || u.lv !== 1 || u.form) { this.cancelFormChoice(); return false; }
    var valid = (FORMS[u.type] || []).some(function (f) { return f.id === formId; });
    if (!valid) {
      Sfx.error(); UI.toast(L('meta.formMissing', null, '这个形态不存在')); return false;
    }
    var cost = upgradeCost(u.type, u.lv);
    if (cost > this.coins) {
      Sfx.error(); UI.toast(L('meta.notEnoughCoinsUpgrade', null, '金币不够升级')); return false;
    }
    this.coins -= cost;
    u.lv = 2;
    u.form = formId;
    this.formChoice = null;
    UI.closeOverlay();
    this.refreshBuild();
    Sfx.place();
    return true;
  },
  cancelFormChoice: function (silent) {
    if (!this.formChoice) return false;
    this.formChoice = null;
    UI.closeOverlay();
    if (!silent) Sfx.ui();
    UI.syncAll();
    return true;
  },
  sellAt: function (col, lane) {
    if (this.paused || this.state !== 'build') return;
    if (this.coopMode && this.coopLocked) return;
    var u = this.unitAt(col, lane);
    if (!u) return;
    col = u.col; lane = u.lane;
    var back = sellValue(u.type, u.lv);
    delete this.grid[col + '|' + lane];
    this.coins += back;
    this.undoSale = { unit: Object.assign({}, u), back: back, roundIndex: this.roundIndex, expires: Date.now() + 5000 };
    this.refreshBuild();
    Sfx.coin();
    UI.toast(L('meta.sold', { n: back }, '回收 +{n}'), function () { Game.undoSell(); });
  },
  undoSell: function () {
    if (this.paused) return false;
    var sale = this.undoSale;
    if (!sale || sale.expires < Date.now() || sale.roundIndex !== this.roundIndex || this.state !== 'build' ||
        this.coopLocked || this.coins < sale.back || !this.canPlace(sale.unit.col, sale.unit.lane, sale.unit.type).ok) {
      UI.toast(L('experience.undoFailed')); return false;
    }
    this.grid[sale.unit.col + '|' + sale.unit.lane] = sale.unit;
    this.coins -= sale.back; this.undoSale = null; this.refreshBuild(); UI.hideToast();
    return true;
  },
  refreshBuild: function () {
    if (this.battle) this.battle.setBuild(this.coopMode ? this.coopSide : 'p', this.playerBuild());
    UI.syncAll();
    if (this.coopMode && window.Coop) Coop.queueDraftSave();
    else this.checkpoint();
  },

  /* ---------------- 战斗期技能 ---------------- */
  useFlare: function (x, y) {
    if (this.state !== 'battle' || this.paused || this.flare <= 0 || !this.battle) return false;
    var hit = this.battle.flare(x, y);
    if (hit === 0) { UI.toast(L('experience.flareEmpty')); return false; }
    this.flare--;
    Sfx.flare();
    Render.flash = 0.4; Render.flashColor = '255,240,200';
    UI.syncAll();
    return true;
  },
  useRepair: function () {
    if (this.state !== 'battle' || this.paused || this.repair <= 0 || !this.battle) return false;
    if (this.battle.hp.p >= this.battle.maxHp.p) { UI.toast(L('experience.fullHealth')); return false; }
    this.repair--;
    this.battle.repair('p', 16);
    Sfx.repair();
    UI.syncAll();
    return true;
  },

  /* ---------------- 每帧 ---------------- */
  update: function (dt) {
    if (this.paused) return;
    if (this.matchmaking) {
      this.updateMatchmaking(dt);
      return;
    }
    if (this.state === 'battle' && this.battle && !this.battle.over) {
      this.battle.update(dt);
      if (this.battle.over) this.endBattle();
    }
  },

  endBattle: function () {
    var b = this.battle;
    var res = b.decide(1 / 30);
    var won = res.winner === 'p';
    if (won) this.wins = (this.wins || 0) + 1;
    this.history.push({ round: this.roundIndex, won: won, t: res.playerTime, gt: res.ghostTime });
    this.result = res;
    this.state = 'result';
    if (won) Sfx.win(); else if (res.winner === 'g') Sfx.lose();

    var income = incomeFor(this.roundIndex, won, this.relics);
    this.coins += income;
    this.result.income = income;

    // 三选一：赢了给 3 张，输了只给 2 张
    var pool = RELICS.filter(function (r) {
      return !Game.relics.some(function (o) { return o.id === r.id; });
    });
    var rnd = mulberry32(this.seed + this.roundIndex * 313);
    var n = won ? 3 : 2;
    var picks = [];
    for (var i = 0; i < n && pool.length; i++) {
      picks.push(pool.splice((rnd() * pool.length) | 0, 1)[0]);
    }
    this.reward = picks;
    this.checkpoint();
    UI.showResult();
  },

  takeRelic: function (id) {
    var r = null;
    for (var i = 0; i < this.reward.length; i++) if (this.reward[i].id === id) r = this.reward[i];
    if (r) { this.relics.push(r); Sfx.coin(); }
    this.nextRound();
  },
  skipRelic: function () {
    this.coins += 45;
    Sfx.coin();
    this.nextRound();
  },

  nextRound: function () {
    this.roundIndex++;
    if (this.roundIndex >= CONFIG.TOTAL_ROUNDS) this.finishMatch();
    else { this.result = null; this.reward = null; this.beginBuild(); this.checkpoint(); }
  },

  finishMatch: function () {
    this.save.run = null;
    var wins = 0;
    for (var i = 0; i < this.history.length; i++) if (this.history[i].won) wins++;
    this.wins = wins;
    var delta = 0;
    for (var j = 0; j < this.history.length; j++) {
      delta += this.history[j].won ? 14 : -12;
    }
    if (wins >= 10) delta += 46;
    else if (wins >= 8) delta += 22;
    else if (wins >= 6) delta += 4;
    else if (wins <= 2) delta -= 46;
    else if (wins <= 4) delta -= 22;

    var before = this.save.rank;
    this.save.rank = Math.max(0, before + delta);
    this.save.matches++;
    this.save.totalWins += wins;
    if (wins > this.save.bestWins) this.save.bestWins = wins;
    this.persist();

    this.lastRankDelta = delta;
    this.state = 'matchEnd';
    UI.showMatchEnd(wins, delta, before, this.save.rank);
  },
};
