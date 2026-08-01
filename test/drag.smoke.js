// 拖拽链路冒烟测试：召唤 → 拖到棋盘布阵 → 换位 → 拖回板凳召回（回归用户实测反馈 1）
// 以最小 DOM stub 模拟浏览器环境，加载全部 js（含 ui.js），用合成 pointer 事件驱动拖拽。
global.window = global;
global.navigator = { userAgent: 'node-smoke' };
global.localStorage = { _d: null, getItem() { return this._d; }, setItem(k, v) { this._d = v; }, removeItem() { this._d = null; } };
global.requestAnimationFrame = () => 0;      // 不递归驱动主循环
global.confirm = () => true;

/* ---------- 最小 DOM stub ---------- */
const allEls = [];
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '', className: '', dataset: {}, style: {},
    children: [], parentNode: null,
    _listeners: {}, _rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    dispatch(t, ev) { (this._listeners[t] || []).forEach(fn => fn(ev)); },
    getBoundingClientRect() { return this._rect; },
    setAttribute(k, v) { if (k === 'class') this.className = v; },
    getAttribute() { return null; },
    cloneNode() { return makeEl(this.tagName); },
    querySelector(sel) { return el._qsa(sel)[0] || null; },
    querySelectorAll(sel) { return el._qsa(sel); },
    _qsa(sel) {
      // 后代选择器（如 '.u-cd i'）在自身 children 子树中查找；单选择器回退全局
      if (sel.includes(' ')) {
        const parts = sel.trim().split(/\s+/);
        let cur = [this];
        for (const p of parts) {
          const next = [];
          for (const e of cur) {
            for (const c of e.children) {
              if (p[0] === '.') { if (c.className.split(' ').includes(p.slice(1))) next.push(c); }
              else if (p[0] === '#') { if (c.id === p.slice(1)) next.push(c); }
              else if (c.tagName.toLowerCase() === p.toLowerCase()) next.push(c);
            }
          }
          cur = next;
        }
        return cur;
      }
      if (sel[0] === '#') { const e = byId(sel.slice(1)); return e ? [e] : []; }
      if (sel[0] === '.') {
        const cs = sel.slice(1).split('.');   // 支持 '.unit.player' 多类
        return allEls.filter(e => cs.every(c => e.className.split(' ').includes(c)));
      }
      return allEls.filter(e => e.tagName.toLowerCase() === sel.toLowerCase());
    },
    classList: {
      _add(c) { if (!el.className.split(' ').includes(c)) el.className = (el.className + ' ' + c).trim(); },
      _rm(c) { el.className = el.className.split(' ').filter(x => x && x !== c).join(' '); },
      add(...cs) { cs.forEach(c => el.classList._add(c)); },
      remove(...cs) { cs.forEach(c => el.classList._rm(c)); },
      toggle(c, on) { if (on === undefined ? !el.classList.contains(c) : on) el.classList._add(c); else el.classList._rm(c); },
      contains(c) { return el.className.split(' ').includes(c); }
    }
  };
  // innerHTML 简易解析：提取 <tag class="..."> 创建子元素（文字内容忽略）
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html || ''; },
    set(v) {
      el._html = v;
      el.children = [];
      const re = /<([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/gi;
      let m;
      while ((m = re.exec(v))) {
        const child = makeEl(m[1]);
        const cm = (m[2] || '').match(/class="([^"]*)"/);
        if (cm) child.className = cm[1];
        el.appendChild(child);
      }
    }
  });
  allEls.push(el);
  return el;
}
function byId(id) { return allEls.find(e => e.id === id) || null; }

global.document = {
  body: makeEl('body'),
  createElement: makeEl,
  querySelector(sel) {
    if (sel[0] === '#') return byId(sel.slice(1));
    if (sel[0] === '.') { const c = sel.slice(1); return allEls.find(e => e.className.split(' ').includes(c)) || null; }
    return null;
  },
  querySelectorAll(sel) {
    if (sel[0] === '#') { const e = byId(sel.slice(1)); return e ? [e] : []; }
    if (sel[0] === '.') { const cs = sel.slice(1).split('.'); return allEls.filter(e => cs.every(c => e.className.split(' ').includes(c))); }
    return [];
  },
  addEventListener() {}
};
// 预置静态元素（对应 index.html 的 id）
['screen-menu', 'screen-battle', 'screen-gallery', 'screen-help',
 'btn-battle', 'btn-gallery', 'btn-weapon', 'btn-help', 'btn-quit', 'btn-recruit', 'btn-frag', 'btn-summon',
 'recruit-cost', 'frag-count', 'hud-wave', 'hud-time', 'hud-mantou', 'hud-hearts', 'hud-opp', 'hud-buffs',
 'tip-line', 'toast-el', 'hint-el', 'modal-mask', 'modal-content', 'bench', 'board', 'hand-tiles',
 'spell-slot', 'menu-rank-badge', 'menu-rank-name', 'menu-rank-bar', 'menu-rank-progress',
 'menu-coins', 'menu-stamina', 'menu-wl', 'menu-map', 'gallery-grid', 'gallery-count'
].forEach(id => { const e = makeEl('div'); e.id = id; document.body.appendChild(e); });
// 拼字槽 3 格
for (let i = 0; i < 3; i++) { const c = makeEl('div'); c.className = 'spell-cell'; document.body.appendChild(c); }

// window 级事件（pointermove/pointerup/pointercancel 绑定在 window）
const winListeners = {};
global.addEventListener = (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); };
function dispatchWin(t, ev) { (winListeners[t] || []).forEach(fn => fn(ev)); }

/* ---------- 加载游戏代码 ---------- */
require('../js/config.js');
require('../js/rand.js');
require('../js/engine.js');
require('../js/bot.js');
require('../js/save.js');
require('../js/game.js');
require('../js/ui.js');
const CFG = global.CFG, Game = global.Game, UI = global.UI, Save = global.Save;

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('✗ 断言失败: ' + msg); }
  else console.log('✓ ' + msg);
}

// 棋盘/板凳几何（模拟真实布局）
const boardEl = byId('board');
boardEl._rect = { left: 0, top: 80, right: 700, bottom: 580, width: 700, height: 500 };
const benchEl = byId('bench');
benchEl._rect = { left: 0, top: 640, right: 700, bottom: 700, width: 700, height: 60 };

Game.init();

// 跳过首局教学，直接进入正常局
Save.load().firstGameDone = true; Save.save();
Game.startBattle();
assert(Game.state === 'battle', '正常局开局进入战斗');

// 模拟完成一次召唤：bench 出现武将卡
Game.run.bench.push({ name: '赵云', level: 1, attackCount: 0, kills: 0 });
UI.refresh();
let cards = document.querySelectorAll('.gen-card');
assert(cards.length === 1, '召唤后武将卡出现在板凳（gen-card）');

/* ---------- 流程 1：召唤 → 拖到棋盘布阵 ---------- */
{
  const card = cards[0];
  card._rect = { left: 20, top: 650, right: 100, bottom: 690, width: 80, height: 40 };
  card.dispatch('pointerdown', { button: 0, clientX: 60, clientY: 670, preventDefault() {}, stopPropagation() {} });
  dispatchWin('pointermove', { clientX: 200, clientY: 200 });   // 拖到棋盘 (2,1) 附近
  dispatchWin('pointerup', { clientX: 200, clientY: 200 });
  assert(Game.battle.units.length === 1, '拖拽布阵成功:1 名武将上棋盘');
  assert(Game.battle.units[0].gen.name === '赵云' && Game.battle.units[0].col === 2 && Game.battle.units[0].row === 1,
    `武将落位 (${Game.battle.units[0].col},${Game.battle.units[0].row})`);
  assert(Game.run.bench.length === 0, '板凳清空');
}

/* ---------- 流程 2：棋盘上再拖走换位 ---------- */
{
  const unit = document.querySelectorAll('.unit.player')[0];
  unit._rect = { left: 200, top: 200, right: 240, bottom: 240, width: 40, height: 40 };
  unit.dispatch('pointerdown', { button: 0, clientX: 220, clientY: 220, preventDefault() {}, stopPropagation() {} });
  dispatchWin('pointermove', { clientX: 400, clientY: 300 });
  dispatchWin('pointerup', { clientX: 400, clientY: 300 });   // (4,2)
  const u = Game.battle.units[0];
  assert(u.col === 4 && u.row === 2, `换位成功 → (${u.col},${u.row})`);
  assert(Game.battle.units.length === 1, '换位不增减单位');
}

/* ---------- 流程 3：拖回板凳召回 ---------- */
{
  const unit = document.querySelectorAll('.unit.player')[0];
  unit._rect = { left: 400, top: 300, right: 440, bottom: 340, width: 40, height: 40 };
  unit.dispatch('pointerdown', { button: 0, clientX: 420, clientY: 320, preventDefault() {}, stopPropagation() {} });
  dispatchWin('pointermove', { clientX: 100, clientY: 660 });  // 拖到板凳区
  dispatchWin('pointerup', { clientX: 100, clientY: 660 });
  assert(Game.battle.units.length === 0, '拖回板凳召回成功');
  assert(Game.run.bench.length === 1, '武将回到板凳待命');
}

/* ---------- 反馈 2：对手实时推进（oppLive 纯函数） ---------- */
{
  const opp = { waves: 6 };
  const p0 = Game.oppLive(opp, 0);
  assert(p0.pw === 0 && p0.hp === 3 && !p0.fallen, '开局准备期:对手 0 波、满血、未倒下');
  const p3 = Game.oppLive(opp, 3);
  assert(p3.pw === 3 && p3.hp === 2 && !p3.fallen, `第 3 波:对手推进 3 波、剩 ${p3.hp} 血、对战中`);
  const p6 = Game.oppLive(opp, 6);
  assert(p6.pw === 6 && p6.hp === 0 && !p6.fallen, '第 6 波:对手坚持到预设波数、血量归零');
  const p7 = Game.oppLive(opp, 7);
  assert(p7.pw === 6 && p7.hp === 0 && p7.fallen, '第 7 波:对手已倒下（封顶 6 波）');
  const opp30 = { waves: 30 };
  assert(!Game.oppLive(opp30, 30).fallen, '对手预设 30 波:通关不倒下');
}

console.log(failures === 0 ? '\n拖拽链路冒烟 + 对手实时推进全部通过 ✔' : `\n${failures} 项断言失败 ✗`);
process.exitCode = failures > 0 ? 1 : 0;
