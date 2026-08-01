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
  let settlePending = false;   // 结算后道具弹层守卫（玩家快速操作时不再错弹）
  let rafId = 0, lastTs = 0;
  let monsterSeq = 0;

  /* ================= 开局 ================= */
  function startBattle() {
    settlePending = false;
    if (Save.stamina() < 1) {
      UI.showStaminaModal();
      return;
    }
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
      bench: [],                 // 待部署 [{name,level,attackCount,kills}]
      waveMantouMul: 1,          // 道具「碧眼儿」: 每波馒头 ×1.1
      opp: opp,
      map: map,
      startTs: Date.now(),
      firstGame: !Save.load().firstGameDone
    };
    // 局间道具（唯一道具层,每局结束 3 选 1,最多 6 个）作用于本局 + 武器装配
    applyPersistItems();
    battle.adou.hp = battle.adou.maxHp;   // 上限类道具/武器后满血开局
    // 首局：送「赵」「云」+ 额外馒头,教学引导；正常局：赠送随机 2 字武将全套字牌（保证首将可守）
    if (run.firstGame) {
      run.mantou += CFG.ECONOMY.firstGameMantou;
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
    if (run.mantou < cost) { UI.tip('馒头不足,阿斗掉血可换馒头(卖血经济)！'); return; }
    run.mantou -= cost;
    run.drawCount++;
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
    // 无升星：重复拼出同一武将 → 转化为碎片（收集已记录）
    if (run.bench.some(b => b.name === g.name) || (battle.units.some(u => u.gen.name === g.name))) {
      run.frags += 5;
      UI.toast('「' + g.name + '」已在军中,转化为碎片 ×5', 'gold');
    } else {
      run.bench.push({ name: g.name, level: 1, attackCount: 0, kills: 0 });
      Save.collect(g.name);
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
    if (!battle.canPlace(col, row)) {
      // 布阵失败给明确提示（人口满 / 阿斗列 / 格子占用），避免「拖了没反应」的困惑
      if (battle.popUsed >= battle.popMax) UI.tip('人口已满(6 人),召回一名武将再布阵');
      else if (col === 6) UI.tip('阿斗营帐前不能布阵');
      else UI.tip('该格已被占用');
      return false;
    }
    const u = new Engine.Unit(item.name, item.level);
    u.attackCount = item.attackCount; u.kills = item.kills;
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
    run.bench.push({ name: u.gen.name, level: u.level, attackCount: u.attackCount, kills: u.kills });
    UI.refresh();
  }
  function findUnit(uid) {
    // 类型归一：ui 层传入数字 _uid（防御历史字符串 'u1' 形态）
    const n = typeof uid === 'string' ? Number(uid.replace('u', '')) : uid;
    return battle.units.find(u => u._uid === n) || null;
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
      dropWeapon('boss');
    });
    battle.on('arrive', m => {
      UI.toast('敌「' + CFG.MONSTER_TYPES[m.type].label + '」逼近阿斗！', 'red');
    });
    battle.on('adouHit', m => {
      run.mantou += CFG.ECONOMY.adouHitMantou;   // 卖血经济
      UI.adouHurt();
      UI.toast('阿斗掉血 -1 ❤,卖血 +10 馒头', 'red');
    });
    battle.on('economy', () => {
      run.mantou += 150;
      UI.toast('孙权:坐断东南,+150 馒头！', 'gold');
    });
    battle.on('levelUp', u => UI.toast('「' + u.gen.name + '」升级 → ' + u.level + ' 级！', 'gold'));
    battle.on('dmg', (m, dmg, crit) => UI.dmgFx(m, dmg, crit));
    battle.on('boltFx', (m, d) => UI.boltFx(m));
    battle.on('skillFx', (u, type, m, d) => UI.skillFx(u, type, m, d));
    battle.on('waveClear', w => {
      // 道具「碧眼儿」：每波馒头产出 +10%
      run.mantou += Math.round(CFG.ECONOMY.waveClearMantou * (run.waveMantouMul || 1));
      dropWeapon(w % 5 === 0 ? 'elite' : 'normal');
    });
    battle.on('finish', result => {
      paused = true;
      setTimeout(() => settle(result), 500);
    });
  }

  /* ================= 武器（图鉴 v1.2 §4：专属 + 5 级品质 + 8 合 1 精炼） ================= */
  // 掉落：普通波 2% / 精英波(5/10/15/20/25/30 每 5 波) 8% / BOSS 击杀 20%；掉落当前随机上阵武将的专属武器
  function dropWeapon(kind) {
    if (!battle.units.length || !run) return;
    const cfg = CFG.WEAPON_DROP[kind];
    if (!cfg || Math.random() >= cfg.rate) return;
    const u = Rand.pick(battle.units);
    const qName = Rand.pick(cfg.quals);
    const q = CFG.WEAPON_QUALITIES.findIndex(x => x.name === qName);
    const w = CFG.WEAPONS.find(x => x.general === u.gen.name);
    if (!w || q < 0) return;
    Save.addWeapon(u.gen.name, q);
    UI.toast('掉落武器:「' + w.name + '」(' + qName + '级)', 'gold');
  }
  // 精炼：8 件同名同品质 → 1 件高 1 品质（金毕业不可再精炼）
  function refineWeapon(generalName) {
    const r = Save.refineWeapon(generalName);
    if (r) {
      const w = CFG.WEAPONS.find(x => x.general === generalName);
      UI.toast('精炼成功:「' + w.name + '」→ ' + CFG.WEAPON_QUALITIES[r.q].name + '级', 'gold');
    }
    return r;
  }
  /* ================= 局间道具（唯一道具层,每局结束 3 选 1,最多 6 个、可替换） ================= */
  // 图鉴 v1.2 §3.2：10 个道具映射到战斗常驻加成
  function applyPersistItems() {
    const items = Save.load().items;
    if (items.includes('jimiao'))   battle.permaCd = 0.85;          // 锦囊妙计: 技能冷却 ×0.85
    if (items.includes('luanxiong')) battle.permaDmgAdd = 0.08;     // 乱世奸雄: 全队造成伤害 +8%
    if (items.includes('weizhen'))  battle.permaEliteDmg = 0.30;    // 威震华夏: 对精英/BOSS +30%
    if (items.includes('yishen'))   battle.permaKillFrq = 1;        // 一身是胆: 击杀叠攻速
    if (items.includes('chitu'))    battle.permaFrq = 0.10;         // 人中赤兔: 全队攻速 +10%
    if (items.includes('rende'))    battle.adou.maxHp++;            // 仁德之君: 阿斗上限 +1
    if (items.includes('yanhou'))   battle.permaSkillDmg = 0.15;    // 燕人咆哮: 技能伤害 +15%
    if (items.includes('dadudu'))   battle.permaDotExtra = 2;       // 大都督: 灼烧 +2 秒
    if (items.includes('zhonghu'))  battle.permaMonSlow = 0.10;     // 冢虎之谋: 怪物移速 -10%
    if (items.includes('biluaner')) run.waveMantouMul = 1.1;        // 碧眼儿: 每波馒头 +10%
    // 武器装配（每武将专属武器,按品质加成生效）
    const ws = Save.load().weapons || {};
    for (const name in ws) {
      if (ws[name] && ws[name].q !== undefined) battle.weaponMap[name] = ws[name].q;
    }
  }
  function pickRewardItem(itemId) {
    Save.addItem(itemId);
  }
  function replaceRewardItem(newId, oldId) {
    return Save.replaceItem(oldId, newId);
  }

  /* ================= 对手实时推进（反馈 2：假 PVP 实时对抗展示） ================= */
  // 纯函数：按对手预设坚持波数同步推进——波次封顶 opp.waves，血量 3→0 线性递减，超过即倒下
  function oppLive(opp, wave) {
    const pw = Math.min(wave, opp.waves);
    const fallen = wave > opp.waves;
    const hpMax = 3;
    const hp = opp.waves <= 0 ? 0 : Math.max(0, Math.ceil(hpMax * (1 - pw / opp.waves)));
    return { pw, fallen, hp, hpMax };
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
    // 每局结束 3 选 1 局间道具（独立弹窗层叠在结算之上；守卫防玩家已点「再来一局/回主城」后错弹）
    settlePending = true;
    setTimeout(() => {
      if (settlePending) UI.showItemReward();
      settlePending = false;
    }, 400);
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
    run = null; battle = null; paused = false; settlePending = false;
    UI.enterMenu();
  }
  function resume() { paused = false; }
  function quitToMenu() {
    // 中途撤退（不结算奖励,体力已消耗）
    state = 'menu';
    run = null; battle = null; paused = false; settlePending = false;
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
    init, startBattle,
    recruit, exchangeFrag,
    tileClick, spellClick, summon,
    placeUnit, moveUnit, recallUnit,
    pickRewardItem, replaceRewardItem,
    refineWeapon,
    oppLive,
    watchAd, checkSummonable, resume,
    backToMenu, quitToMenu,
    get run() { return run; }, get battle() { return battle; }, get state() { return state; },
    get paused() { return paused; },
    BOARD_COLS, BOARD_ROWS, ADOU_ROW,
    monsterSeq: function () { return ++monsterSeq; }
  };
})();
