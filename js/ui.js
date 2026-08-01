/* ============================================================
 * UI：DOM 渲染、拖拽布阵、弹窗、特效（水墨文字风）
 * ============================================================ */
window.UI = (function () {
  'use strict';
  const CFG = window.CFG, Save = window.Save, Rand = window.Rand;
  const $ = s => document.querySelector(s);

  let boardEl = null, boardWrapEl = null, adouEl = null;
  let monsterEls = {};       // monsterSeq -> el
  let unitEls = {};          // unit id -> el
  let unitIdSeq = 0;
  let toastTimer = 0;
  let drag = null;           // 拖拽状态
  let hintEls = [];
  let hoverHintEl = null;

  /* ================= 基础 ================= */
  function init() {
    bindStatic();
    // 拖拽监听只需绑定一次
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  }

  function bindStatic() {
    $('#btn-battle').addEventListener('click', () => Game.startBattle());
    $('#btn-gallery').addEventListener('click', showGallery);
    $('#btn-help').addEventListener('click', () => showScreen('help'));
    document.querySelectorAll('.btn-back').forEach(b => {
      b.addEventListener('click', () => {
        const t = b.dataset.back;
        if (t === 'menu') Game.backToMenu();
      });
    });
    $('#btn-quit').addEventListener('click', () => {
      if (confirm('确定撤退回主城吗？本局成绩不计')) Game.quitToMenu();
    });
    $('#btn-recruit').addEventListener('click', () => Game.recruit());
    $('#btn-frag').addEventListener('click', () => Game.exchangeFrag());
    $('#btn-summon').addEventListener('click', () => Game.summon());
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    $('#screen-' + name).classList.remove('hidden');
  }

  /* ================= 菜单 ================= */
  function enterMenu() {
    showScreen('menu');
    refreshMenu();
  }
  function refreshMenu() {
    const d = Save.load();
    const rank = Save.rank();
    const prog = Save.rankProgress();
    $('#menu-rank-badge').textContent = rank.name;
    $('#menu-rank-name').textContent = rank.name;
    $('#menu-rank-bar').style.width = prog.pct + '%';
    $('#menu-rank-progress').textContent = (prog.idx >= CFG.RANKS.length - 1) ? '已至巅峰' :
      (d.score - prog.cur) + ' / ' + (prog.next - prog.cur) + ' 积分 → ' + CFG.RANKS[prog.idx + 1].name;
    $('#menu-coins').textContent = d.coins;
    $('#menu-stamina').textContent = Save.stamina();
    $('#menu-wl').textContent = d.today.wins + '-' + d.today.loses + '(' + Save.winRate() + '%)';
    const map = Save.mapOfToday();
    $('#menu-map').textContent = '今日地图:' + map.name + ' · ' + map.desc;
  }

  /* ================= 进入对局 ================= */
  function enterBattle(run, battle) {
    showScreen('battle');
    buildBoard();
    buildHudOpp(run.opp);
    refresh();
  }

  function buildBoard() {
    boardEl = $('#board');
    boardWrapEl = $('#board-wrap');
    boardEl.innerHTML = '';
    // 网格线
    for (let c = 1; c < Game.BOARD_COLS; c++) {
      const d = document.createElement('div');
      d.className = 'board-grid-line v';
      d.style.left = (c / Game.BOARD_COLS * 100) + '%';
      boardEl.appendChild(d);
    }
    for (let r = 1; r < Game.BOARD_ROWS; r++) {
      const d = document.createElement('div');
      d.className = 'board-grid-line h';
      d.style.top = (r / Game.BOARD_ROWS * 100) + '%';
      boardEl.appendChild(d);
    }
    // 阿斗
    adouEl = document.createElement('div');
    adouEl.id = 'adou-stand';
    boardEl.appendChild(adouEl);
    monsterEls = {}; unitEls = {}; unitIdSeq = 0;
  }

  function buildHudOpp(opp) {
    const el = $('#hud-opp');
    el.innerHTML = '<div class="avatar">' + opp.avatar + '</div>' +
      '<div style="min-width:0"><div class="opp-name">' + opp.nick + '</div>' +
      '<div class="opp-info">坚持 ' + opp.waves + ' 波 · ' + fmtTime(opp.timeSec) + ' · 剩 ' + opp.adouLeft + ' ❤</div></div>' +
      '<span class="opp-tag">' + opp.tag + '</span>';
  }

  /* ================= 刷新静态区 ================= */
  function refresh() {
    if (Game.state !== 'battle') return;
    const run = Game.run, battle = Game.battle;
    if (!run || !battle) return;
    refreshHud(run, battle);
    refreshSpell(run);
    refreshHand(run);
    refreshBench(run, battle);
    refreshUnits(run, battle);
    // 征兵按钮
    let cost = CFG.ECONOMY.recruitBase + CFG.ECONOMY.recruitStep * run.drawCount;
    if (run.levyLeft > 0) cost = Math.ceil(cost / 2);
    $('#recruit-cost').textContent = cost;
    $('#btn-recruit').disabled = run.mantou < cost;
    // 碎片
    $('#frag-count').textContent = run.frags;
    $('#btn-frag').disabled = run.frags < CFG.ECONOMY.fragExchange;
    Game.checkSummonable();
  }

  function refreshHud(run, battle) {
    $('#hud-wave').textContent = Math.min(battle.wave, CFG.MAX_WAVE);
    $('#hud-time').textContent = fmtTime(Math.floor(battle.time));
    $('#hud-mantou').textContent = run.mantou;
    const hearts = $('#hud-hearts');
    let h = '';
    for (let i = 0; i < battle.adou.maxHp; i++) {
      h += '<span class="heart' + (i < battle.adou.hp ? '' : ' lost') + '">❤</span>';
    }
    hearts.innerHTML = h;
    // 阿斗本体
    if (adouEl) {
      adouEl.style.left = ((6.5) / Game.BOARD_COLS * 100) + '%';
      adouEl.style.top = ((Game.ADOU_ROW + 0.5) / Game.BOARD_ROWS * 100) + '%';
      adouEl.innerHTML = '斗<div class="adou-hp">' + '❤'.repeat(battle.adou.hp) + '</div>';
      adouEl.classList.toggle('dead', battle.adou.hp <= 0);
    }
    // buffs
    const bub = $('#hud-buffs');
    bub.innerHTML = battle.bonds.map(b => '<span class="buff-chip">' + b.name + '</span>').join('');
    // 按钮状态实时刷新（战斗中获得资源后可用）
    let cost = CFG.ECONOMY.recruitBase + CFG.ECONOMY.recruitStep * run.drawCount;
    if (run.levyLeft > 0) cost = Math.ceil(cost / 2);
    $('#recruit-cost').textContent = cost;
    $('#btn-recruit').disabled = run.mantou < cost;
    $('#frag-count').textContent = run.frags;
    $('#btn-frag').disabled = run.frags < CFG.ECONOMY.fragExchange;
    Game.checkSummonable();
  }

  function refreshSpell(run) {
    const cells = document.querySelectorAll('.spell-cell');
    cells.forEach((cell, i) => {
      const t = run.spell[i];
      cell.className = 'spell-cell' + (t ? ' filled' : '');
      cell.textContent = t ? t.char : '';
      if (t) {
        cell.innerHTML = t.char + '<span class="tile-star">' + t.quality + '</span>';
      }
    });
    const matched = matchChars(run);
    if (matched) cells.forEach(c => c.classList.add('matched'));
  }
  function matchChars(run) {
    const chars = run.spell.filter(Boolean).map(t => t.char).sort().join('');
    if (!chars) return null;
    return CFG.GENERALS.find(g => g.chars.slice().sort().join('') === chars) || null;
  }

  function refreshHand(run) {
    const el = $('#hand-tiles');
    el.innerHTML = '';
    run.tiles.forEach((t, i) => {
      const d = document.createElement('div');
      d.className = 'tile';
      d.innerHTML = t.char + '<span class="tile-' + t.quality.toLowerCase() + '">' + t.quality + '</span>';
      d.addEventListener('pointerdown', ev => {
        ev.stopPropagation();
        Game.tileClick(i);
      });
      el.appendChild(d);
    });
  }

  function refreshBench(run, battle) {
    const el = $('#bench');
    el.innerHTML = '';
    run.bench.forEach((b, i) => {
      const g = CFG.GENERALS.find(x => x.name === b.name);
      const d = makeGenCard(g, b);
      d.classList.add('draggable');
      d.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        startDrag({ type: 'bench', idx: i, el: d, ev: ev });
      });
      el.appendChild(d);
    });
  }

  function makeGenCard(g, info) {
    const d = document.createElement('div');
    d.className = 'gen-card ' + g.quality.toLowerCase();
    const stars = '★'.repeat(info.star || 1) + '☆'.repeat(5 - (info.star || 1));
    const bonds = CFG.BONDS.filter(b => b.members.includes(g.name)).map(b => b.name).join('·');
    d.innerHTML =
      '<div class="gc-name">' + g.name + '</div>' +
      '<div class="gc-cls">' + CFG.CLS_NAMES[g.cls] + (g.quality === 'SSR' ? ' · 传奇' : ' · 史诗') + '</div>' +
      '<div class="gc-star">' + stars + '</div>' +
      '<div class="gc-lv">Lv.' + (info.level || 1) + '</div>' +
      '<div class="gc-bonds">' + bonds + '</div>' +
      '<div class="gc-skill">技:' + g.skill.name + '</div>';
    return d;
  }

  /* ================= 棋盘单位 ================= */
  function refreshUnits(run, battle) {
    // 武将
    const seen = {};
    battle.units.forEach((u, idx) => {
      const uid = 'u' + (u._uid || (u._uid = ++unitIdSeq));
      seen[uid] = true;
      let el = unitEls[uid];
      if (!el) {
        el = document.createElement('div');
        el.className = 'unit player';
        el.dataset.uid = uid;
        const face = document.createElement('div');
        face.className = 'u-face';
        el.appendChild(face);
        const fury = document.createElement('div');
        fury.className = 'u-fury';
        fury.innerHTML = '<i></i>';
        el.appendChild(fury);
        el.addEventListener('pointerdown', ev => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          // 按下即拖拽;松手时若未移动且满怒 → 释放技能
          startDrag({ type: 'unit', uid: uid, el: el, ev: ev });
        });
        boardEl.appendChild(el);
        unitEls[uid] = el;
      }
      el.style.left = ((u.col + 0.5) / Game.BOARD_COLS * 100) + '%';
      el.style.top = ((u.row + 0.5) / Game.BOARD_ROWS * 100) + '%';
      el.style.width = (74 / Game.BOARD_COLS) + '%';
      const face = el.querySelector('.u-face');
      face.innerHTML = u.gen.name;
      face.style.background = u.gen.quality === 'SSR' ? 'linear-gradient(160deg,#b8860b,#8a5a00)' : 'linear-gradient(160deg,#5a6f9e,#3f5280)';
      face.style.fontSize = u.gen.name.length >= 3 ? 'clamp(11px,1.6vw,17px)' : 'clamp(13px,2.2vw,24px)';
      const star = el.querySelector('.u-star');
      if (!star) {
        const s = document.createElement('div');
        s.className = 'u-star';
        el.appendChild(s);
      }
      el.querySelector('.u-star').textContent = '★'.repeat(u.star);
      el.querySelector('.u-fury i').style.width = Math.min(100, u.fury) + '%';
      el.classList.toggle('ready-fury', u.fury >= 100 && u.skillCd <= 0);
      el.classList.toggle('attacking', !!u.attacking && battle.time < u.attacking);
      const lv = el.querySelector('.u-lv');
      if (u.level > 1) {
        if (!lv) { const s = document.createElement('div'); s.className = 'u-lv'; el.appendChild(s); }
        el.querySelector('.u-lv').textContent = u.level;
      } else if (lv) lv.remove();
    });
    // 清理撤下的武将
    for (const uid in unitEls) {
      if (!seen[uid]) { unitEls[uid].remove(); delete unitEls[uid]; }
    }
    // 怪物
    const mseen = {};
    battle.monsters.forEach(m => {
      const id = m._id || (m._id = Game.monsterSeq());
      mseen[id] = true;
      let el = monsterEls[id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'unit monster';
        const face = document.createElement('div');
        face.className = 'u-face';
        el.appendChild(face);
        const hp = document.createElement('div');
        hp.className = 'u-hp';
        hp.innerHTML = '<i></i>';
        el.appendChild(hp);
        boardEl.appendChild(el);
        monsterEls[id] = el;
      }
      el.style.left = ((m.col + 0.5) / Game.BOARD_COLS * 100) + '%';
      el.style.top = ((m.row + 0.5) / Game.BOARD_ROWS * 100) + '%';
      el.style.width = (m.boss ? 13 : 9.5) + '%';
      const face = el.querySelector('.u-face');
      face.textContent = m.boss ? '帅' : (m.elite ? CFG.MONSTER_TYPES[m.type].label : CFG.MONSTER_TYPES[m.type].label);
      face.className = 'u-face' + (m.boss ? ' boss' : m.elite ? ' elite' : '');
      el.querySelector('.u-hp i').style.width = Math.max(0, m.hp / m.maxHp * 100) + '%';
    });
    for (const id in monsterEls) {
      if (!mseen[id]) { monsterEls[id].remove(); delete monsterEls[id]; }
    }
  }

  /* ================= 拖拽 ================= */
  function boardPos(ev) {
    const r = boardEl.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * Game.BOARD_COLS;
    const y = (ev.clientY - r.top) / r.height * Game.BOARD_ROWS;
    return { col: Math.max(0, Math.min(Game.BOARD_COLS - 1, Math.floor(x))),
             row: Math.max(0, Math.min(Game.BOARD_ROWS - 1, Math.floor(y))),
             overBoard: ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom };
  }

  function startDrag(info) {
    const srcRect = info.el.getBoundingClientRect();
    drag = {
      type: info.type, idx: info.idx, uid: info.uid,
      startX: info.ev.clientX, startY: info.ev.clientY,
      moved: false,
      ghost: null
    };
    // 克隆源元素作 ghost 跟随指针
    const g = info.el.cloneNode(true);
    g.style.position = 'fixed';
    g.style.left = srcRect.left + 'px';
    g.style.top = srcRect.top + 'px';
    g.style.width = srcRect.width + 'px';
    g.style.zIndex = 99;
    g.style.pointerEvents = 'none';
    g.classList.add('ghosting');
    document.body.appendChild(g);
    drag.ghost = g;
  }

  function onDragMove(ev) {
    if (!drag) return;
    const dx = ev.clientX - drag.startX, dy = ev.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 8) drag.moved = true;
    if (drag.moved) {
      const p = boardPos(ev);
      const r = boardEl.getBoundingClientRect();
      if (drag.ghost) {
        drag.ghost.style.left = (ev.clientX - 30) + 'px';
        drag.ghost.style.top = (ev.clientY - 30) + 'px';
      }
      // 高亮格子
      updateHoverHint(p, ev);
      // 棋盘武将拖出棋盘 → 显示收回
      const overBench = $('#bench').getBoundingClientRect();
      const inBench = ev.clientY > overBench.top && ev.clientY < overBench.bottom && ev.clientX > overBench.left - 40 && ev.clientX < overBench.right + 40;
      if (hoverHintEl) {
        hoverHintEl.classList.toggle('bad', !p.overBoard || (drag.type === 'bench' && !Game.battle.canPlace(p.col, p.row)));
      }
      drag.benchHover = inBench;
    }
  }

  function updateHoverHint(p, ev) {
    if (!hoverHintEl) {
      hoverHintEl = document.createElement('div');
      hoverHintEl.className = 'cell-hint';
      boardEl.appendChild(hoverHintEl);
    }
    if (p.overBoard) {
      hoverHintEl.style.display = 'block';
      hoverHintEl.style.left = ((p.col + 0.5) / Game.BOARD_COLS * 100) + '%';
      hoverHintEl.style.top = ((p.row + 0.5) / Game.BOARD_ROWS * 100) + '%';
      hoverHintEl.style.width = (60 / Game.BOARD_COLS) + '%';
      hoverHintEl.style.aspectRatio = '1';
      hoverHintEl.style.transform = 'translate(-50%,-50%)';
      const ok = Game.battle.canPlace(p.col, p.row);
      hoverHintEl.classList.toggle('ok', ok);
      hoverHintEl.classList.toggle('bad', !ok);
    } else hoverHintEl.style.display = 'none';
  }

  function onDragEnd(ev) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (hoverHintEl) { hoverHintEl.remove(); hoverHintEl = null; }
    if (d.ghost) { d.ghost.remove(); }
    if (!d.moved) {
      // 未移动:棋盘武将视为点击 → 释放技能
      if (d.type === 'unit') Game.castUnit(d.uid);
      return;
    }
    const p = boardPos(ev);
    const overBench = $('#bench').getBoundingClientRect();
    const inBench = ev.clientY > overBench.top && ev.clientY < overBench.bottom;
    if (d.type === 'bench') {
      if (p.overBoard) Game.placeUnit(d.idx, p.col, p.row);
    } else if (d.type === 'unit') {
      if (inBench) Game.recallUnit(d.uid);
      else if (p.overBoard) Game.moveUnit(d.uid, p.col, p.row);
    }
  }

  function onBoardPointerDown() {
    // 点击空白棋盘取消拖拽高亮（暂无选中态）
  }

  /* ================= 特效 ================= */
  function fxPos(m) {
    return { left: ((m.col + 0.5) / Game.BOARD_COLS * 100) + '%',
             top: ((m.row + 0.5) / Game.BOARD_ROWS * 100) + '%' };
  }
  function dmgFx(m, dmg, crit) {
    if (!boardEl) return;
    const p = fxPos(m);
    const el = document.createElement('div');
    el.className = 'dmg-float' + (crit ? ' crit' : '');
    el.textContent = dmg;
    el.style.left = p.left; el.style.top = p.top;
    boardEl.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
  function boltFx(m) {
    if (!boardEl) return;
    const p = fxPos(m);
    const el = document.createElement('div');
    el.className = 'bolt';
    el.style.left = p.left; el.style.top = p.top;
    el.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg');
    boardEl.appendChild(el);
    setTimeout(() => el.remove(), 500);
  }
  function skillFx(u, type, m, d) {
    if (!boardEl) return;
    const center = { left: ((u.col + 0.5) / Game.BOARD_COLS * 100) + '%',
                     top: ((u.row + 0.5) / Game.BOARD_ROWS * 100) + '%' };
    const spawn = (cls, pos, delay) => {
      const el = document.createElement('div');
      el.className = cls;
      el.style.left = pos.left; el.style.top = pos.top;
      el.style.animationDelay = delay + 's';
      boardEl.appendChild(el);
      setTimeout(() => el.remove(), 700 + delay * 1000);
    };
    if (type === 'aoe' || type === 'single' || type === 'stun') spawn('boom', m ? fxPos(m) : center, 0);
    if (type === 'dash') for (let i = 0; i < 3; i++) spawn('boom', { left: center.left, top: center.top }, i * 0.08);
    if (type === 'dot') for (let i = 0; i < 8; i++) spawn('flame', { left: (8 + Math.random() * 84) + '%', top: (8 + Math.random() * 84) + '%' }, i * 0.1);
    if (type === 'heal') {
      const el = document.createElement('div');
      el.className = 'dmg-float heal';
      el.textContent = '+1 ❤';
      el.style.left = ((6.5) / Game.BOARD_COLS * 100) + '%';
      el.style.top = ((Game.ADOU_ROW + 0.5) / Game.BOARD_ROWS * 100) + '%';
      boardEl.appendChild(el);
      setTimeout(() => el.remove(), 950);
    }
  }
  function adouHurt() {
    if (!adouEl) return;
    adouEl.classList.remove('hurt');
    void adouEl.offsetWidth;
    adouEl.classList.add('hurt');
  }
  function adouHeal() {
    if (!adouEl) return;
    adouEl.classList.remove('hurt');
    void adouEl.offsetWidth;
    adouEl.classList.add('hurt');
  }

  /* ================= 提示 ================= */
  function tip(msg) {
    $('#tip-line').textContent = msg;
  }
  function toast(msg, kind) {
    let el = $('#toast-el');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-el';
      el.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:60;' +
        'background:rgba(30,22,16,.92);color:#f7eccb;padding:10px 22px;border-radius:24px;' +
        'font-size:16px;border:2px solid #c9a227;box-shadow:0 4px 14px rgba(0,0,0,.4);pointer-events:none;' +
        'transition:opacity .3s;text-align:center;max-width:80%;';
      document.body.appendChild(el);
    }
    if (kind === 'gold') el.style.borderColor = '#c9a227';
    else if (kind === 'red') el.style.borderColor = '#a8342a';
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  }
  function hint(msg) {
    let el = $('#hint-el');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hint-el';
      el.style.cssText = 'position:fixed;bottom:150px;left:50%;transform:translateX(-50%);z-index:40;' +
        'background:rgba(255,255,255,.85);color:#a8342a;padding:6px 16px;border-radius:14px;' +
        'font-size:14px;border:1px solid #a8342a;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => el.remove(), 2200);
  }
  let hintTimer = 0;

  /* ================= 弹窗 ================= */
  function modal(html, opts) {
    opts = opts || {};
    const mask = $('#modal-mask');
    const box = $('#modal-content');
    box.innerHTML = html;
    mask.classList.remove('hidden');
    box.querySelectorAll('[data-close]').forEach(c => {
      c.addEventListener('click', () => { closeModal(); if (opts.onClose) opts.onClose(); });
    });
    return closeModal;
  }
  function closeModal() {
    $('#modal-mask').classList.add('hidden');
  }

  /* 道具三选一 */
  function showItemPick() {
    const items = CFG.ITEMS.slice();
    modal(
      '<h2>军备选择</h2><p>每局开局可选一件军备(每日重置)</p>' +
      '<div class="choice-grid">' +
      items.map(it => '<button class="choice-item" data-item="' + it.id + '">' +
        '<div class="ci-title">' + it.name + '</div><div class="ci-desc">' + it.desc + '</div></button>').join('') +
      '</div>',
      { onClose: () => Game.backToMenu() }
    );
    $('#modal-content').querySelectorAll('[data-item]').forEach(b => {
      b.addEventListener('click', () => { closeModal(); Game.confirmItem(b.dataset.item); });
    });
  }

  /* 三选一强化 */
  function showBoostPick() {
    const pool = CFG.BOOSTS.slice();
    const picks = [];
    while (picks.length < 3 && pool.length) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    modal('<h2>三选一强化</h2><p>每 3 波一次的抉择</p>' +
      '<div class="choice-grid">' +
      picks.map(b => '<button class="choice-item" data-boost="' + b.id + '">' +
        '<div class="ci-title">' + b.title + '</div><div class="ci-desc">' + b.desc + '</div></button>').join('') +
      '</div>');
    $('#modal-content').querySelectorAll('[data-boost]').forEach(b => {
      b.addEventListener('click', () => { closeModal(); Game.applyBoost(b.dataset.boost); });
    });
  }

  /* 体力不足 */
  function showStaminaModal() {
    modal('<h2>体力不足</h2>' +
      '<p>每局消耗 1 点体力,每日上限 30 点。<br>当前体力:' + Save.stamina() + '/30</p>' +
      '<div class="choice-grid">' +
      '<button class="choice-item" data-act="ad"><div class="ci-title">📺 看广告恢复 +10 体力</div><div class="ci-desc">今日剩余 ' + Save.adsLeft() + ' 次(纯 IAA,无充值)</div></button>' +
      '<button class="choice-item" data-act="back"><div class="ci-title">返回主城</div><div class="ci-desc">明日体力自动恢复</div></button>' +
      '</div>');
    $('#modal-content').querySelectorAll('[data-act]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'ad') Game.watchAd();
        else { closeModal(); Game.backToMenu(); }
      });
    });
  }

  /* 广告（模拟播放 3 秒） */
  function showAd(done) {
    let t = 3;
    modal('<h2>📺 激励视频</h2>' +
      '<div class="ad-box"><div class="ad-title">模拟广告</div>' +
      '<div class="ad-count" id="ad-count">3</div>' +
      '<div class="ad-note">开发版为模拟播放;上线接入平台激励视频后,看完即恢复体力</div></div>' +
      '<p>看完全程 +10 体力(每日 5 次)</p>');
    const iv = setInterval(() => {
      t--;
      const c = $('#ad-count');
      if (c) c.textContent = t;
      if (t <= 0) {
        clearInterval(iv);
        closeModal();
        if (done) done();
        refreshMenu();
      }
    }, 1000);
  }

  /* 结算 */
  function showSettle(r) {
    const win = r.verdict === 'win', draw = r.verdict === 'draw';
    const label = win ? '胜利' : (draw ? '平局' : '惜败');
    const stars = '<span class="star-row">' +
      [1, 2, 3].map(i => '<span class="' + (i <= r.stars ? 'on' : 'off') + '">★</span>').join('') + '</span>';
    const mePct = Math.min(100, Math.round(r.myWaves / Math.max(r.opp.waves, r.myWaves) * 100));
    modal('<h2 class="settle-result ' + r.verdict + '">' + label + '</h2>' +
      '<p>坚持 <b>' + r.myWaves + '</b> 波 · ' + fmtTime(r.myTime) + ' · 阿斗剩 ' + r.myAdou + ' ❤</p>' +
      '<div class="compare-bar">' +
      '<div class="cb-side">你<br><b>' + r.myWaves + '</b>波</div>' +
      '<div class="cb-track"><div class="cb-fill me" style="width:' + mePct + '%"></div>' +
      '<div class="cb-fill opp" style="width:' + (100 - mePct) + '%"></div></div>' +
      '<div class="cb-side">' + r.opp.nick + '<br><b>' + r.opp.waves + '</b>波</div>' +
      '</div>' +
      stars +
      '<div class="reward-line">蜜獾币 <b>+' + r.coins + '</b> · 军衔积分 <b>+' + r.score + '</b></div>' +
      (r.isFirst ? '<p style="color:#7c2118">首战完成！教学结束,此后按正常规则开局</p>' : '') +
      '<div><button class="btn btn-primary" data-close data-again>再来一局</button>' +
      '<button class="btn btn-secondary" data-close data-menu>回主城</button></div>');
    const box = $('#modal-content');
    box.querySelector('[data-again]').addEventListener('click', () => Game.startBattle());
    box.querySelector('[data-menu]').addEventListener('click', () => Game.backToMenu());
  }

  /* 引导 */
  function showTutor(step, opts) {
    opts = opts || {};
    const steps = {
      1: { t: '首战教学 · 拼字召唤', b: '<b>字牌</b>已送你「赵」「云」,点击下方字牌放入拼字槽', a: '▼' },
      2: { t: '首战教学 · 拼字召唤', b: '拼字槽凑齐 <b>赵+云</b>,点亮「召唤」按钮并点击,即可召唤 <b>赵云</b>', a: '▼' },
      3: { t: '首战教学 · 布阵', b: '召唤出的武将会出现在下方武将栏。<b>按住武将拖到棋盘</b>布阵,越靠前越早接敌', a: '▼' },
      4: { t: '首战教学 · 作战', b: '武将自动攻击,攒满怒气后<b>点击棋盘上的武将</b>释放技能。守住阿斗,比对手坚持更久！', a: '▶ 开战' }
    };
    const s = steps[Math.min(step, 4)];
    if (!s) return;
    modal('<h2>' + s.t + '</h2>' +
      '<div class="tutor-step"><div class="tutor-arrow">' + s.a + '</div><p>' + s.b + '</p></div>' +
      '<div><button class="btn btn-primary" data-close>知道了</button></div>',
      opts.resume ? { onClose: () => Game.resume() } : null);
  }

  /* ================= 图鉴 ================= */
  function showGallery() {
    showScreen('gallery');
    const grid = $('#gallery-grid');
    grid.innerHTML = '';
    let owned = 0;
    CFG.GENERALS.forEach(g => {
      const saved = Save.load().generals[g.name];
      const card = makeGenCard(g, saved || { star: 0, level: 1 });
      if (saved) { owned++; card.querySelector('.gc-name').style.color = '#7c2118'; }
      else {
        card.style.filter = 'grayscale(.85)';
        card.classList.add('not-owned');
      }
      if (saved && saved.star > 0) {
        card.innerHTML += '<div class="gc-own">' + saved.star + '</div>';
      }
      grid.appendChild(card);
    });
    $('#gallery-count').textContent = owned + '/10 已收集';
    const bonds = $('#bond-list');
    bonds.innerHTML = CFG.BONDS.map(b =>
      '<div class="bond-item"><b>' + b.name + '</b>(' + b.members.join('、') + ')<br>' + b.desc + '</div>').join('');
  }

  /* ================= 渲染循环 ================= */
  function renderBattle(run, battle, paused) {
    if (Game.state !== 'battle' || !run || !battle) return;
    refreshHud(run, battle);
    refreshUnits(run, battle);
  }

  function fmtTime(sec) {
    return Math.floor(sec / 60) + ':' + Rand.pad(Math.floor(sec % 60));
  }

  function setSummonable(ok) {
    const b = $('#btn-summon');
    if (b) {
      b.disabled = !ok;
      b.classList.toggle('btn-glow', !!ok);
    }
  }

  return {
    init, enterMenu, refreshMenu, showScreen,
    enterBattle, refresh, renderBattle,
    setSummonable, showItemPick, showBoostPick,
    showStaminaModal, showAd, showSettle, showTutor,
    dmgFx, boltFx, skillFx, adouHurt, adouHeal,
    tip, toast, hint, modal, closeModal
  };
})();
