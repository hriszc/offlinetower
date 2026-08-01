/* ============================================================
 * 游戏主流程：状态机、征兵、拼字召唤、道具、强化、结算判定、广告
 * ============================================================ */
window.Game = (function () {
  'use strict';
  const CFG = window.CFG, Save = window.Save, Bot = window.Bot, Rand = window.Rand;

  const BOARD_COLS = 7, BOARD_ROWS = 5;   // col 0..6,row 0..4；阿斗在 (6,2)
  const ADOU_ROW = 2;

  let state = 'menu';          // menu | battle
  let battle = null;           // Engine.Battle
  let run = null;              // 本局数据
  let paused = false;
  let rafId = 0, lastTs = 0;
  let monsterSeq = 0;

  /* ================= 开局 ================= */
  function startBattle() {
    if (Save.stamina() < 1) {
      UI.showStaminaModal();
      return;
    }
    UI.showItemPick();   // 三选一道具
  }

  function confirmItem(itemId) {
    Save.spendStamina();
    const opp = Bot.makeOpponent(Save.rankIndex());
    const map = Save.mapOfToday();
    battle = new Engine.Battle(map, {});
    run = {
      mantou: CFG.ECONOMY.startMantou,
      drawCount: 0,
      frags: 0,
      tiles: [],                 // 手牌字牌 [{char,general,quality}]
      spell: [null, null, null], // 拼字槽
      bench: [],                 // 待部署 [{name,star,level,exp,kills}]
      item: itemId,
      levyLeft: 0,
      boosts: [],
      opp: opp,
      map: map,
      startTs: Date.now(),
      firstGame: !Save.load().firstGameDone
    };
    // 道具效果
    if (itemId === 'shield') { battle.adou.maxHp += 2; battle.adou.hp = battle.adou.maxHp; run.mantou -= 5; }
    if (itemId === 'food') run.mantou += 40;
    if (itemId === 'levy') run.levyLeft = 3;
    // 首局：送「赵」「云」+ 额外馒头,教学引导；正常局：赠送随机 2 字武将全套字牌（保证首将可守）
    if (run.firstGame) {
      run.mantou += 20;
      grantTile('赵', 'zhaoyun');
      grantTile('云', 'zhaoyun');
      run.tutorStep = 1;
    } else {
      // 赠字池收窄：2 字 + 射程 ≥3 + 基础输出 ≥10（曹操/赵云/周瑜），保证首将覆盖多路且能清怪；
      // 近战武将（张飞/关羽/吕布）由玩家后续拼出，需前置站位拦截（帮助文档有说明）
      const giftPool = CFG.GENERALS.filter(g => g.chars.length === 2 && g.rge >= 3 && g.atk * g.frq >= 10);
      const gift = Rand.pick(giftPool);
      for (const c of gift.chars) grantTile(c, gift.id);
      UI.toast('军师赠字：「' + gift.name + '」字牌已备,快去拼字召唤！', 'gold');
    }
    bindBattleEvents();
    paused = false;
    state = 'battle';
    UI.enterBattle(run, battle);
    UI.refresh();
    UI.tip('敌将至,速征兵拼字布阵！');
    if (run.tutorStep) { paused = true; UI.showTutor(run.tutorStep, { resume: true }); }
  }

  /* ================= 征兵 ================= */
  function recruit() {
    if (state !== 'battle' || !run) return;
    let cost = CFG.ECONOMY.recruitBase + CFG.ECONOMY.recruitStep * run.drawCount;
    if (run.levyLeft > 0) { cost = Math.ceil(cost / 2); }
    if (run.mantou < cost) { UI.tip('馒头不足,阿斗掉血可换馒头(卖血经济)！'); return; }
    run.mantou -= cost;
    run.drawCount++;
    if (run.levyLeft > 0) run.levyLeft--;
    if (Math.random() < CFG.TILE_RATE) {
      const pool = CFG.tilePool(ownedTiles());
      if (pool.length) {
        const it = Rand.weighted(pool);
        grantTile(it.char, it.general.id);
        UI.tip('抽到字牌「' + it.char + '」');
        maybeHintSummon();
      } else {
        run.frags += 2;
        UI.tip('字牌已集齐,获得碎片 ×2');
      }
    } else {
      run.frags += 2;
      UI.tip('获得武将碎片 ×2');
    }
    UI.refresh();
  }

  function grantTile(char, genId) {
    const g = CFG.GENERALS.find(x => x.id === genId);
    if (run.tiles.some(t => t.char === char)) { run.frags += 1; return; }
    run.tiles.push({ char: char, general: g.name, quality: g.quality });
  }

  // 已拥有字牌集合（手牌 + 拼字槽）
  function ownedTiles() {
    const o = {};
    for (const t of run.tiles) { (o[t.general] = o[t.general] || []).push(t.char); }
    for (const t of run.spell) if (t) (o[t.general] = o[t.general] || []).push(t.char);
    return o;
  }

  /* ================= 拼字 ================= */
  function tileClick(idx) {
    if (state !== 'battle') return;
    const t = run.tiles[idx];
    if (!t) return;
    const slot = run.spell.findIndex(s => !s);
    if (slot < 0) { UI.tip('拼字槽已满,点槽位可取回字牌'); return; }
    run.spell[slot] = t;
    run.tiles.splice(idx, 1);
    UI.refresh();
    checkSummonable();
    // 教学：首次放字 → 步骤 2（提示拼齐点击召唤）
    if (run.firstGame && run.tutorStep === 1) {
      run.tutorStep = 2;
      paused = true;
      UI.showTutor(run.tutorStep, { resume: true });
    }
  }
  function spellClick(idx) {
    const t = run.spell[idx];
    if (!t) return;
    run.spell[idx] = null;
    run.tiles.push(t);
    UI.refresh();
    checkSummonable();
  }
  // 槽字符集合与某武将姓名字符集合匹配 → 可召唤
  function matchGeneral() {
    const chars = run.spell.filter(Boolean).map(t => t.char).sort().join('');
    if (!chars) return null;
    return CFG.GENERALS.find(g => g.chars.slice().sort().join('') === chars) || null;
  }
  function checkSummonable() {
    const g = matchGeneral();
    UI.setSummonable(!!g && run.mantou >= CFG.ECONOMY.summonCost);
    return g;
  }

  function summon() {
    const g = matchGeneral();
    if (!g) { UI.tip('字牌未凑齐'); return; }
    if (run.mantou < CFG.ECONOMY.summonCost) { UI.tip('馒头不足,召唤需 ' + CFG.ECONOMY.summonCost); return; }
    run.mantou -= CFG.ECONOMY.summonCost;
    run.spell = [null, null, null];
    // 重复拼出 → 升星（方案：重复拼出=升星）
    const saved = Save.getGeneral(g.name);
    if (run.bench.some(b => b.name === g.name) || (battle.units.some(u => u.gen.name === g.name))) {
      const benchItem = run.bench.find(b => b.name === g.name);
      if (benchItem) {
        if (benchItem.star < 5) { benchItem.star++; Save.addStar(g.name, 1); UI.toast('「' + g.name + '」升星 → ' + benchItem.star + ' 星！', 'gold'); }
        else { run.frags += 5; UI.toast('「' + g.name + '」已满星,获得碎片 ×5', 'gold'); }
      } else {
        const unit = battle.units.find(u => u.gen.name === g.name);
        if (unit) {
          if (unit.star < 5) { unit.star++; Save.addStar(g.name, 1); UI.toast('「' + g.name + '」升星 → ' + unit.star + ' 星！', 'gold'); }
          else { run.frags += 5; UI.toast('「' + g.name + '」已满星,获得碎片 ×5', 'gold'); }
        }
      }
    } else {
      run.bench.push({ name: g.name, star: Math.max(1, saved.star), level: 1, exp: 0, kills: 0 });
      UI.toast('召唤成功！「' + g.name + '」(' + CFG.CLS_NAMES[g.cls] + ')', 'gold');
      if (run.firstGame && run.tutorStep === 2) {
        run.tutorStep = 3;
        paused = true;
        UI.showTutor(run.tutorStep, { resume: true });
      }
    }
    UI.refresh();
    checkSummonable();
  }

  /* ================= 碎片兑换 ================= */
  function exchangeFrag() {
    if (run.frags < CFG.ECONOMY.fragExchange) return;
    const pool = CFG.tilePool(ownedTiles());
    if (!pool.length) { UI.tip('字牌已全部集齐'); return; }
    run.frags -= CFG.ECONOMY.fragExchange;
    const it = Rand.weighted(pool);
    grantTile(it.char, it.general.id);
    UI.tip('碎片兑换字牌「' + it.char + '」');
    UI.refresh();
  }

  /* ================= 布阵 ================= */
  function placeUnit(benchIdx, col, row) {
    if (!battle || !run) return false;
    const item = run.bench[benchIdx];
    if (!item) return false;
    if (!battle.canPlace(col, row)) return false;
    const u = new Engine.Unit(item.name, item.star, item.level);
    u.exp = item.exp; u.kills = item.kills;
    if (battle.deploy(u, col, row)) {
      run.bench.splice(benchIdx, 1);
      UI.refresh();
      if (run.firstGame && run.tutorStep === 3) {
        run.tutorStep = 4;
        paused = true;
        UI.showTutor(run.tutorStep, { resume: true });
      }
      return true;
    }
    return false;
  }
  function moveUnit(uid, col, row) {
    if (!battle || !run) return false;
    const u = findUnit(uid);
    if (!u || !battle.canPlace(col, row)) return false;
    u.col = col; u.row = row;
    return true;
  }
  function recallUnit(uid) {
    if (!battle || !run) return;
    const u = findUnit(uid);
    if (!u) return;
    battle.recall(u);
    run.bench.push({ name: u.gen.name, star: u.star, level: u.level, exp: u.exp, kills: u.kills });
    UI.refresh();
  }
  function findUnit(uid) {
    // 类型归一：ui 层传入数字 _uid（防御历史字符串 'u1' 形态）
    const n = typeof uid === 'string' ? Number(uid.replace('u', '')) : uid;
    return battle.units.find(u => u._uid === n) || null;
  }
  function castUnit(uid) {
    if (!battle || !run) return;
    const u = findUnit(uid);
    if (!u) return;
    if (u.fury < 100) { UI.tip('怒气不足（' + Math.floor(u.fury) + '/100）'); return; }
    if (u.skillCd > 0) { UI.tip('技能冷却中'); return; }
    if (battle.castSkill(u)) UI.tip('「' + u.gen.skill.name + '」发动！');
  }

  /* ================= 战斗事件绑定 ================= */
  function bindBattleEvents() {
    battle.on('waveStart', (wc, count, powCut) => {
      if (wc.boss) UI.tip('⚠ 第 ' + wc.n + ' 波:BOSS 来袭！击杀 +10 馒头');
      else if (wc.elite) UI.tip('⚠ 第 ' + wc.n + ' 波:精英波(数量×1.5 血量×2)');
      else UI.tip('第 ' + wc.n + ' 波来袭(' + count + ' 敌)' + (powCut ? ' · 敌势稍减' : ''));
    });
    battle.on('kill', (m, attacker) => {
      run.mantou += CFG.ECONOMY.killMantou;
    });
    battle.on('bossKill', () => {
      run.mantou += CFG.ECONOMY.bossMantou;
      UI.toast('BOSS 击杀！+10 馒头', 'gold');
    });
    battle.on('arrive', m => {
      UI.toast('敌「' + CFG.MONSTER_TYPES[m.type].label + '」逼近阿斗！', 'red');
    });
    battle.on('adouHit', m => {
      run.mantou += CFG.ECONOMY.adouHitMantou;   // 卖血经济
      UI.adouHurt();
      UI.toast('阿斗掉血 -1 ❤,卖血 +10 馒头', 'red');
    });
    battle.on('adouHeal', () => UI.adouHeal());
    battle.on('economy', () => {
      run.mantou += 150;
      UI.toast('孙权:坐断东南,+150 馒头！', 'gold');
    });
    battle.on('levelUp', u => UI.toast('「' + u.gen.name + '」升级 → ' + u.level + ' 级！', 'gold'));
    battle.on('dmg', (m, dmg, crit) => UI.dmgFx(m, dmg, crit));
    battle.on('boltFx', (m, d) => UI.boltFx(m));
    battle.on('skillFx', (u, type, m, d) => UI.skillFx(u, type, m, d));
    battle.on('waveClear', w => {
      run.mantou += CFG.ECONOMY.waveClearMantou;
      // 第 30 波通关在即,不再弹三选一（避免被结算弹窗覆盖丢弃）
      if (w % 3 === 0 && w < CFG.MAX_WAVE && !battle.over) {
        paused = true;
        UI.showBoostPick();
      }
    });
    battle.on('finish', result => {
      paused = true;
      setTimeout(() => settle(result), 500);
    });
  }

  /* ================= 三选一强化 ================= */
  function applyBoost(boostId) {
    const b = CFG.BOOSTS.find(x => x.id === boostId);
    run.boosts.push(boostId);
    switch (boostId) {
      case 'atk': for (const u of battle.units) u.buffAtk += 0.15; break;
      case 'frq': for (const u of battle.units) u.buffFrq += 0.12; break;
      case 'adou': battle.adou.maxHp++; battle.adou.hp = battle.adou.maxHp; break;
      case 'mantou': run.mantou += 80; break;
      case 'star': {
        const list = battle.units;
        if (list.length) {
          const u = Rand.pick(list);
          if (u.star < 5) { u.star++; Save.addStar(u.gen.name, 1); }
        }
        break;
      }
    }
    paused = false;
    UI.refresh();
    UI.tip('强化「' + b.title + '」生效');
  }

  /* ================= 结算 ================= */
  function settle(result) {
    // 防竞态：finish 后 500ms 内玩家点撤退/回主城会置空 run/battle
    if (!battle || !run) return;
    const myWaves = battle.wavesSurvived();
    const myTime = Math.round(battle.time);
    const myAdou = battle.adou.hp;
    const opp = run.opp;
    let verdict;
    // 通关保底：满 30 波（最高成就）直接判胜，避免因用时 tie-break 对同为 30 波的机器人判负
    if (myWaves >= CFG.MAX_WAVE) verdict = 'win';
    else if (myWaves > opp.waves) verdict = 'win';
    else if (myWaves < opp.waves) verdict = 'lose';
    else {
      if (myTime < opp.timeSec) verdict = 'win';
      else if (myTime > opp.timeSec) verdict = 'lose';
      else {
        if (myAdou > opp.adouLeft) verdict = 'win';
        else if (myAdou < opp.adouLeft) verdict = 'lose';
        else verdict = 'draw';
      }
    }
    // 奖励
    let coins = 0, score = 0, stars = 1;
    if (verdict === 'win') { coins = 60 + myWaves * 3; score = CFG.SCORE_WIN; stars = 3; }
    else if (verdict === 'draw') { coins = 40 + myWaves * 2; score = 15; stars = 2; }
    else {
      coins = 15 + myWaves * 2; score = CFG.SCORE_LOSE; stars = 1;
      if (myWaves >= opp.waves * 0.8) stars = 2;
    }
    Save.load().coins += coins;
    Save.addScore(score);
    Save.recordGame(verdict === 'win');
    if (run.firstGame) { Save.load().firstGameDone = true; Save.save(); }
    UI.showSettle({
      verdict, myWaves, myTime, myAdou, opp,
      coins, score, stars,
      isFirst: run.firstGame
    });
    run = null; battle = null;
  }

  /* ================= 广告（体力恢复,纯 IAA 唯一广告点） ================= */
  function watchAd() {
    if (Save.adsLeft() <= 0) { UI.toast('今日广告次数已用完', 'red'); return; }
    UI.showAd(function () {
      Save.watchAd();
      // 回到主菜单：避免结算后看广告却停留在残留战斗画面（backToMenu 对菜单态幂等）
      Game.backToMenu();
    });
  }

  /* ================= 主循环 ================= */
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.1) dt = 0.1;
    if (state === 'battle' && battle && !paused) {
      battle.update(dt);
    }
    if (state === 'battle') UI.renderBattle(run, battle, paused);
  }

  /* ================= 导航 ================= */
  function backToMenu() {
    state = 'menu';
    run = null; battle = null; paused = false;
    UI.enterMenu();
  }
  function resume() { paused = false; }
  function quitToMenu() {
    // 中途撤退（不结算奖励,体力已消耗）
    state = 'menu';
    run = null; battle = null; paused = false;
    UI.enterMenu();
  }

  function init() {
    Save.load();
    UI.init();
    UI.enterMenu();
    rafId = requestAnimationFrame(loop);
  }

  function maybeHintSummon() {
    // 手牌+槽是否已能拼出某武将（提示玩家去拼字）
    const need = [];
    for (const g of CFG.GENERALS) {
      const have = g.chars.filter(c => run.tiles.some(t => t.char === c)).length;
      if (have > 0 && have < g.chars.length) need.push(g.name + '(' + have + '/' + g.chars.length + ')');
    }
    if (need.length) UI.hint('可拼:' + need.slice(0, 3).join(' '));
  }

  return {
    init, startBattle, confirmItem,
    recruit, exchangeFrag,
    tileClick, spellClick, summon,
    placeUnit, moveUnit, recallUnit, castUnit,
    applyBoost, watchAd, checkSummonable, resume,
    backToMenu, quitToMenu,
    get run() { return run; }, get battle() { return battle; }, get state() { return state; },
    get paused() { return paused; },
    BOARD_COLS, BOARD_ROWS, ADOU_ROW,
    monsterSeq: function () { return ++monsterSeq; }
  };
})();
