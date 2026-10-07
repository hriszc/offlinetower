#!/usr/bin/env node
'use strict';

// Co-op client lifecycle checks. All fetches and timers stay inside this VM.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { webcrypto } = require('crypto');
const source = fs.readFileSync(require('path').join(__dirname, '../js/coop.js'), 'utf8');
const KEY = 'yeshou.coop.session.v1';
const token = 'a'.repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

function payload(phase = 'lobby', seat = 0) {
  const players = [0, 1].map(seat => ({ seat, nicknameIndex: seat, rank: 100, ready: false, continued: false }));
  return {
    room: { code: 'ABCDEFGH', phase, ownerSeat: 0, roundIndex: 0, maxPlayers: 6, players, teamWins: 8 },
    self: { ...players[seat], coins: 95, draft: { build: [] }, relics: [], loadout: [] },
  };
}

function setup({ room = payload(), session = { code: 'ABCDEFGH', token, nicknameIndex: 0, seenRound: -1, initialRank: 100 } } = {}) {
  const storage = new Map(session ? [[KEY, JSON.stringify(session)]] : []);
  const elements = new Map();
  const timers = new Map();
  const events = {};
  const calls = [];
  let timerId = 0;
  function element(id) {
    const el = { id, style: {}, classList: { toggle() {}, add() {}, remove() {} }, disabled: false, value: '', onclick: null };
    let html = '', children = [];
    Object.defineProperty(el, 'innerHTML', {
      get: () => html,
      set(value) {
        children.forEach(id => elements.delete(id));
        html = value; children = [];
        for (const found of value.matchAll(/id="([^"]+)"/g)) {
          children.push(found[1]); elements.set(found[1], element(found[1]));
        }
      },
    });
    return el;
  }
  const overlay = element('overlay'), hud = element('coopHud');
  const test = { room, calls, storage, timers, events, elements, overlay, hud, fail: false, deferred: null, toasts: [] };
  const context = {
    console, crypto: webcrypto, Uint8Array, Date, JSON, Math, URL, AbortController,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: {
      visibilityState: 'visible', getElementById: id => elements.get(id) || null,
      addEventListener: (event, fn) => { events[event] = fn; },
    },
    window: { COOP_API_BASE: 'https://mock.invalid/api', matchMedia: () => ({ matches: false }), addEventListener: (event, fn) => { events[event] = fn; } },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), requestAnimationFrame: () => ++timerId, cancelAnimationFrame() {},
    L: (key, values, fallback) => (fallback || key).replace(/\{(\w+)\}/g, (all, key) => values && values[key] !== undefined ? values[key] : all),
    CONFIG: { COOP_MAX_PLAYERS: 6, COOP_LANES_PER_PLAYER: 3 },
    normalizeLoadout: () => [], coopLocalSeat: seat => seat % 3,
    coopSideForSeat: seat => seat < 3 ? 'p' : 'g', coopLaneOffset: seat => (seat % 3) * 3,
    Sfx: {},
    Game: {
      coopMode: false, state: 'menu', coins: 95, grid: [],
      save: { rank: 100, matches: 0, totalWins: 0, bestWins: 0, loadout: [] },
      endCoop() { this.coopMode = false; this.state = 'menu'; this.grid = []; },
      startCoopRound(member, roundIndex) {
        this.coopMode = true; this.state = 'build'; this.roundIndex = roundIndex;
        this.coins = member.coins; this.grid = clone(member.draft.build);
      },
      playerBuild() { return this.grid; }, persist() {},
    },
    UI: {
      el: { overlay, coopHud: hud, timer: element('timer') }, overlayMode: null,
      closeOverlay() { overlay.innerHTML = ''; this.overlayMode = null; },
      showMenu() { overlay.innerHTML = '<div id="mockMenu">Menu</div>'; this.overlayMode = 'menu'; context.Coop.menuLabel(); },
      toast: text => test.toasts.push(text), setText: (el, text) => { el.textContent = text; },
      syncAll() { if (context.Coop) context.Coop.syncGameUI(); },
    },
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      if (test.deferred) return test.deferred;
      if (test.fail) throw new Error('offline');
      return { ok: true, json: async () => clone(test.room) };
    },
  };
  vm.createContext(context); vm.runInContext(source, context, { filename: 'js/coop.js' });
  test.context = context;
  test.click = async id => { assert.ok(elements.get(id), 'button exists: ' + id); elements.get(id).onclick(); await settle(); };
  test.poll = async () => {
    const found = [...timers].find(([, timer]) => [1000, 5000, 30000].includes(timer.delay));
    assert.ok(found, 'poll scheduled'); timers.delete(found[0]); found[1].fn(); await settle();
  };
  return test;
}

(async () => {
  for (const seat of [0, 1]) {
    const t = setup({ room: payload('lobby', seat) });
    t.context.Coop.open(); await settle();
    await t.click('leaveCoopViewBtn');
    check(JSON.parse(t.storage.get(KEY)).token === token, 'return preserves credentials, seat ' + seat);
    await t.poll();
    check(t.context.UI.overlayMode === 'menu', 'background poll cannot reopen room, seat ' + seat);
    t.events.pagehide();
    check(!t.calls.some(call => /\/leave$/.test(call.url)), 'return and pagehide do not end room');
    t.context.Coop.open(); await settle();
    check(t.context.Coop.selfSeat === seat && !!t.elements.get('coopRoomCode'), 'resume restores same seat');
  }

  const late = setup();
  let resolve;
  late.deferred = new Promise(done => { resolve = done; });
  late.context.Coop.open(); await settle();
  await late.click('backCoopConnectionBtn');
  resolve({ ok: true, json: async () => payload() }); await settle();
  check(late.context.UI.overlayMode === 'menu', 'late connection cannot hijack menu');

  const net = setup(); net.fail = true;
  net.context.Coop.open(); await settle();
  check(!!net.elements.get('retryCoopConnectionBtn') && !!net.elements.get('backCoopConnectionBtn'), 'failed recovery has retry and return');
  net.fail = false; await net.click('retryCoopConnectionBtn');
  check(!!net.elements.get('coopRoomCode'), 'recovery retry reaches lobby');
  await net.click('deleteCoopRoomBtn');
  check(!net.calls.some(call => call.method === 'DELETE'), 'disband requires explicit confirmation');
  await net.poll();
  check(!!net.elements.get('confirmDeleteCoopBtn'), 'poll preserves disband confirmation');
  await net.click('cancelDeleteCoopBtn');
  check(!!net.elements.get('coopRoomCode'), 'cancel disband restores lobby');
  await net.click('deleteCoopRoomBtn'); await net.click('confirmDeleteCoopBtn');
  check(net.calls.filter(call => call.method === 'DELETE').length === 1 && !net.storage.has(KEY), 'confirmed disband deletes exactly once and clears session');

  const pending = setup({ session: { code: 'ABCDEFGH', token, nicknameIndex: 0, pending: { kind: 'create', rank: 100, loadout: [] } } });
  let finishPending;
  pending.deferred = new Promise(done => { finishPending = done; });
  pending.context.Coop.open(); await settle();
  pending.events.focus(); await settle();
  check(pending.calls.length === 1, 'focus during pending create does not duplicate request or fetch missing room');
  await pending.click('backCoopConnectionBtn');
  finishPending({ ok: true, json: async () => payload() }); await settle();
  check(pending.context.UI.overlayMode === 'menu' && !JSON.parse(pending.storage.get(KEY)).pending, 'late create preserves completed session without reopening');

  const pendingFailure = setup({ session: { code: 'ABCDEFGH', token, nicknameIndex: 0, pending: { kind: 'create', rank: 100, loadout: [] } } });
  pendingFailure.fail = true; pendingFailure.context.Coop.open(); await settle();
  check(!!pendingFailure.elements.get('retryCoopConnectionBtn'), 'failed pending create offers explicit retry');
  pendingFailure.fail = false; await pendingFailure.click('retryCoopConnectionBtn');
  check(!!pendingFailure.elements.get('coopRoomCode') && pendingFailure.calls.length === 2, 'pending retry reuses same room credentials');

  const prep = setup({ room: payload('preparing') });
  prep.context.Coop.open(); await settle();
  prep.context.Game.grid = [{ type: 'barricade', col: 8, lane: 1, lv: 1 }]; prep.context.Game.coins = 73;
  prep.context.Coop.queueDraftSave(); prep.fail = true;
  await prep.poll();
  check(prep.toasts.length > 0 && prep.hud.innerHTML.includes('role="status"'), 'preparing disconnect has toast and persistent HUD status');
  await prep.click('coopBackHudBtn');
  check(JSON.parse(prep.storage.get(KEY)).draft.coins === 73, 'return preserves unsent local draft');
  prep.fail = false; prep.context.Coop.open(); await settle();
  check(prep.context.Game.coins === 73 && prep.context.Game.grid.length === 1, 'resume restores local draft and coins');

  const finished = setup({ room: payload('finished') });
  finished.context.Coop.open(); await settle();
  check(finished.context.Game.save.matches === 1, 'finished room awards result once');
  finished.context.Coop.open(); await settle();
  check(finished.context.Game.save.matches === 1 && JSON.parse(finished.storage.get(KEY)).finishApplied, 'reopening finished room cannot award twice');
  console.log('✓ ' + checks + ' co-op client lifecycle checks passed (local fetch/timer mocks only)');
})().catch(error => { console.error(error); process.exitCode = 1; });
