#!/usr/bin/env node
'use strict';

/* Local integration checks for the co-op Worker and shared deterministic resolver. */
const assert = require('assert');
const { webcrypto } = require('crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const CoopSim = require('../js/coop-sim.js');
const workerModule = import('./coop-worker/src/index.mjs');

class MockStorage {
  constructor() { this.values = new Map(); this.alarmAt = null; }
  async get(key) {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm(at) { this.alarmAt = at; }
  async deleteAlarm() { this.alarmAt = null; }
}

class MockNamespace {
  constructor(RoomObject) { this.RoomObject = RoomObject; this.objects = new Map(); }
  idFromName(name) { return name; }
  get(id) {
    if (!this.objects.has(id)) {
      const state = { storage: new MockStorage() };
      const object = new this.RoomObject(state);
      const stub = {
        fetch(input, init) { return object.fetch(input instanceof Request ? input : new Request(input, init)); },
        alarm() { return object.alarm(); },
      };
      this.objects.set(id, { state, stub });
    }
    return this.objects.get(id).stub;
  }
  state(id) { return this.objects.get(id).state; }
  async alarm(id) { return this.objects.get(id).stub.alarm(); }
}

const loadout = ['barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla'];
const nicknames = [0, 1, 2].map((_, i) => ({
  nicknameIndex: i, rank: i * 350, loadout,
  token: String.fromCharCode(97 + i).repeat(64),
}));
let checks = 0;
function check(value, label) {
  assert.ok(value, label);
  checks++;
  console.log('✓ ' + label);
}

(async () => {
  const { default: worker, RoomObject } = await workerModule;
  const namespace = new MockNamespace(RoomObject);
  const env = { ROOMS: namespace };

  async function api(path, method = 'GET', body, token) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = 'Bearer ' + token;
    const response = await worker.fetch(new Request('https://coop.test/api' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    let data = {};
    try { data = await response.json(); } catch (_) { }
    return { status: response.status, data };
  }

  const health = await api('/health');
  check(health.status === 200 && health.data.service === 'zombieknock-coop', 'health endpoint');

  const duoCode = 'HJKLMPQ6';
  const duo = [
    { token: '1'.repeat(64), nicknameIndex: 23, rank: 350, loadout },
    { token: '2'.repeat(64), nicknameIndex: 22, rank: 700, loadout },
  ];
  let response = await api('/rooms', 'POST', { code: duoCode, ...duo[0] });
  check(response.status === 201 && response.data.room.players[0].nicknameIndex === 23,
    'new preset nicknames are accepted');
  response = await api('/rooms/' + duoCode + '/start', 'POST', undefined, duo[0].token);
  check(response.status === 409 && response.data.error === 'not_enough_players',
    'one member cannot start a co-op match');
  response = await api('/rooms/' + duoCode + '/join', 'POST', duo[1]);
  check(response.status === 201 && response.data.room.phase === 'lobby' && response.data.self.seat === 1,
    'two members stay in the lobby until the owner starts');
  response = await api('/rooms/' + duoCode + '/start', 'POST', undefined, duo[1].token);
  check(response.status === 403 && response.data.error === 'forbidden',
    'only the owner can start a two-member room');
  response = await api('/rooms/' + duoCode + '/start', 'POST', undefined, duo[0].token);
  check(response.status === 200 && response.data.room.phase === 'preparing' &&
    response.data.room.players.length === 2 && response.data.room.deadline > Date.now(),
    'owner starts the 120-second two-member prep');
  response = await api('/rooms/' + duoCode + '/join', 'POST', {
    token: '3'.repeat(64), nicknameIndex: 21, rank: 400, loadout,
  });
  check(response.status === 409 && response.data.error === 'room_full',
    'starting with two locks the roster');
  response = await api('/rooms/' + duoCode + '/start', 'POST', undefined, duo[0].token);
  check(response.status === 200 && response.data.room.players.length === 2 && response.data.room.phase === 'preparing',
    'owner start retry is idempotent');
  response = await api('/rooms/' + duoCode + '/ready', 'POST', { build: [], coins: 95 }, duo[0].token);
  check(response.status === 200 && response.data.room.phase === 'preparing',
    'first duo member ready waits for the second');
  response = await api('/rooms/' + duoCode + '/ready', 'POST', { build: [], coins: 95 }, duo[1].token);
  check(response.status === 200 && response.data.room.phase === 'result' &&
    response.data.room.result.inputs.length === 2 && response.data.room.result.members.length === 2,
    'both duo members ready resolves a six-lane round');
  const duoResult = response.data.room.result;
  const duoReplay = CoopSim.resolve(duoResult.inputs, duoResult.roundIndex, duoResult.seed, 525);
  check(JSON.stringify(duoReplay.members) === JSON.stringify(duoResult.members),
    'two-member local replay matches the server result');
  response = await api('/rooms/' + duoCode + '/continue', 'POST', { skip: true }, duo[0].token);
  check(response.status === 200 && response.data.room.phase === 'result',
    'first duo continuation waits for the second');
  response = await api('/rooms/' + duoCode + '/continue', 'POST', { skip: true }, duo[1].token);
  check(response.status === 200 && response.data.room.phase === 'preparing' && response.data.room.roundIndex === 1,
    'both duo members continue to the next round');
  response = await api('/rooms/' + duoCode + '/delete', 'DELETE', undefined, duo[0].token);
  check(response.status === 200 && response.data.deleted, 'owner deletes the completed duo smoke room');

  const createBody = {
    code: 'ABCDEFG2', token: nicknames[0].token,
    nicknameIndex: 0, rank: 0, loadout,
  };
  response = await api('/rooms', 'POST', createBody);
  const code = response.data.room && response.data.room.code;
  check(response.status === 201 && code === createBody.code, 'create room and return owner token');
  response = await api('/rooms', 'POST', createBody);
  check(response.status === 200 && response.data.room.players.length === 1, 'create retry is idempotent');

  response = await api('/rooms/' + code + '/state', 'GET', undefined, '0'.repeat(64));
  check(response.status === 401, 'reject an invalid room credential');
  response = await api('/rooms/' + code + '/state', 'GET', undefined, nicknames[0].token);
  check(response.status === 200 && response.data.self.seat === 0, 'owner can read private room state');

  for (let i = 1; i < 3; i++) {
    const member = nicknames[i];
    response = await api('/rooms/' + code + '/join', 'POST', member);
    check(response.status === 201 && response.data.self.seat === i, 'join seat ' + i);
  }
  const hostRefreshAt = Date.now();
  const hostRefresh = await api('/rooms/' + code + '/state', 'GET', undefined, nicknames[0].token);
  check(hostRefresh.status === 200 && hostRefresh.data.room.players.length === 3 && Date.now() - hostRefreshAt < 2000,
    'host sees the third member on the next status poll within two seconds locally');
  response = await api('/rooms/' + code + '/join', 'POST', nicknames[1]);
  check(response.status === 200 && response.data.self.seat === 1 && response.data.room.players.length === 3,
    'join retry does not occupy a second seat');
  response = await api('/rooms/' + code + '/join', 'POST', {
    ...nicknames[0], token: 'd'.repeat(64), nicknameIndex: 3,
  });
  check(response.status === 409 && response.data.error === 'room_full', 'reject a fourth member');
  check(response.data.error === 'room_full', 'lobby closes after the third player joins');

  const invalidBudget = await api('/rooms/' + code + '/draft', 'POST', {
    build: [{ type: 'turret', col: 8, lane: 1, lv: 1 }], coins: 51,
  }, nicknames[0].token);
  check(invalidBudget.status === 400 && invalidBudget.data.error === 'invalid_economy',
    'reject a draft that exceeds its server-validated budget');

  async function submitReady(memberIndex, draft) {
    return api('/rooms/' + code + '/ready', 'POST', draft, nicknames[memberIndex].token);
  }
  const drafts = [
    { build: [], coins: 95 },
    { build: [{ type: 'turret', col: 8, lane: 1, lv: 1 }], coins: 50 },
    { build: [], coins: 95 },
  ];
  response = await submitReady(0, drafts[0]);
  check(response.status === 200 && response.data.room.phase === 'preparing', 'first ready waits for the rest');
  response = await submitReady(0, { build: [], coins: 0 });
  check(response.status === 200 && response.data.self.ready, 'repeated ready is idempotent');
  response = await submitReady(1, drafts[1]);
  check(response.data.room.phase === 'preparing', 'second ready waits for the third');
  response = await submitReady(2, drafts[2]);
  check(response.status === 200 && response.data.room.phase === 'result', 'all ready starts server resolution');

  let state = await api('/rooms/' + code + '/state', 'GET', undefined, nicknames[0].token);
  const result = state.data.room.result;
  check(result.inputs.length === 3 && result.timeline === undefined, 'result stores seed and locked builds, not combat frames');
  const averageRank = result.inputs.reduce((sum, player) => sum + player.rank, 0) / 3;
  const replay = CoopSim.resolve(result.inputs, result.roundIndex, result.seed, averageRank);
  check(JSON.stringify(replay.members) === JSON.stringify(result.members), 'client resolver reproduces authoritative result');
  check(replay.duration > 0 && replay.duration <= CoopSim.durationFor(result.roundIndex),
    'co-op simulation stops on full-team defeat or the round timer');

  const supportBattle = CoopSim.createBattle([
    { seat: 0, build: [{ type: 'turret', col: 8, lane: 2 }], relics: [] },
    { seat: 1, build: [], relics: [] },
  ], 0, 123, 0);
  let supportShots = 0;
  for (let i = 0; i < 300 && !supportBattle.over; i++) {
    supportBattle.advanceCoop(0.05);
    supportBattle.drainFx().forEach((fx) => {
      if (fx.t === 'shot' && fx.seat === 0 && fx.targetSeat === 1) supportShots++;
    });
  }
  check(supportShots > 0, 'a turret can target an adjacent teammate’s zombies');

  const spikeBattle = CoopSim.createBattle([
    { seat: 0, build: [{ type: 'spike', col: 8, lane: 1 }], relics: [] },
    { seat: 1, build: [], relics: [] },
  ], 0, 123, 0);
  for (let i = 0; i < 40; i++) spikeBattle.advanceCoop(0.05);
  check(spikeBattle.zombies.some((z) => z.x > 560 && z.hp === z.maxHp) &&
    !spikeBattle.drainFx().some((fx) => fx.t === 'shot'),
  'spikes only retaliate at contact and do not fire at distant zombies');

  const wallRows = Array.from({ length: 9 }, (_, col) => ({ type: 'barricade', col, lane: 1 }));
  const redirectBattle = CoopSim.createBattle([
    { seat: 0, build: [], relics: [] },
    { seat: 1, build: wallRows, relics: [] },
  ], 0, 19, 0);
  const originalTargets = new Map();
  let zombieRedirected = false;
  for (let i = 0; i < 1000 && !redirectBattle.over; i++) {
    redirectBattle.advanceCoop(0.05);
    redirectBattle.zombies.forEach((z) => {
      if (!originalTargets.has(z.id)) originalTargets.set(z.id, z.coopHomeSeat);
      if (originalTargets.get(z.id) === 0 && z.coopHomeSeat === 1) zombieRedirected = true;
    });
  }
  check(zombieRedirected, 'zombies switch to a living teammate after their home falls');
  check(redirectBattle.over && redirectBattle.coopHomes.every((home) => !home.alive) &&
    redirectBattle.t < CoopSim.durationFor(0), 'the battle ends as soon as every home has fallen');

  const relicId = state.data.self.rewardChoices[0];
  const selected = await api('/rooms/' + code + '/continue', 'POST', { relicId }, nicknames[0].token);
  const selectedAgain = await api('/rooms/' + code + '/continue', 'POST', { skip: true }, nicknames[0].token);
  check(selected.status === 200 && selectedAgain.data.self.relics.includes(relicId), 'repeated reward submission cannot change the first choice');
  for (let i = 1; i < 3; i++) {
    response = await api('/rooms/' + code + '/continue', 'POST', { skip: true }, nicknames[i].token);
    check(response.status === 200, 'member ' + i + ' can continue after resolution');
  }
  state = await api('/rooms/' + code + '/state', 'GET', undefined, nicknames[0].token);
  check(state.data.room.phase === 'preparing' && state.data.room.roundIndex === 1, 'all continue advances and revives next round');

  const timeoutCode = 'BCDEFGH3';
  const timeoutCreate = await api('/rooms', 'POST', {
    code: timeoutCode, token: 'e'.repeat(64), nicknameIndex: 0, rank: 500, loadout,
  });
  check(timeoutCreate.status === 201, 'create timeout test room');
  for (let i = 1; i < 3; i++) {
    response = await api('/rooms/' + timeoutCode + '/join', 'POST', {
      nicknameIndex: i, rank: 500, loadout, token: (i === 1 ? 'f' : 'd').repeat(64),
    });
    check(response.status === 201, 'join timeout test seat ' + i);
  }
  const timeoutState = namespace.state(timeoutCode).storage;
  let room = await timeoutState.get('room');
  room.deadline = Date.now() - 1;
  await timeoutState.put('room', room);
  response = await api('/rooms/' + timeoutCode + '/state', 'GET', undefined, 'e'.repeat(64));
  check(response.status === 200 && response.data.room.phase === 'result', '120-second prep expiry resolves submitted drafts');

  const partialCode = 'CDEFGHJ4';
  const partialTokens = ['f', 'a', 'b'].map((char) => char.repeat(64));
  const partialOwner = { code: partialCode, token: partialTokens[0], nicknameIndex: 0, rank: 350, loadout };
  response = await api('/rooms', 'POST', partialOwner);
  check(response.status === 201, 'create result-timeout test room');
  for (let i = 1; i < 3; i++) {
    response = await api('/rooms/' + partialCode + '/join', 'POST', {
      nicknameIndex: i, rank: 350, loadout, token: partialTokens[i],
    });
    check(response.status === 201, 'join result-timeout seat ' + i);
  }
  for (let i = 0; i < 3; i++) {
    response = await api('/rooms/' + partialCode + '/ready', 'POST', { build: [], coins: 95 },
      partialTokens[i]);
  }
  check(response.data.room.phase === 'result', 'resolve result-timeout test round');
  const partialStorage = namespace.state(partialCode).storage;
  room = await partialStorage.get('room');
  const beforeCoins = room.players.map((p) => p.coins);
  room.deadline = Date.now() - 1;
  await partialStorage.put('room', room);
  response = await api('/rooms/' + partialCode + '/state', 'GET', undefined, 'f'.repeat(64));
  room = await partialStorage.get('room');
  check(response.data.room.phase === 'preparing' && room.players.every((p, i) => p.coins >= beforeCoins[i] + 45),
    '120-second result expiry auto-skips rewards for everyone');

  // Fast-forward the first room through all remaining rounds; no wall-clock battle waits are needed.
  for (let round = 1; round < CoopSim.MAX_ROUNDS; round++) {
    for (let i = 0; i < 3; i++) {
      response = await api('/rooms/' + code + '/ready', 'POST', { build: [], coins: 0 }, nicknames[i].token);
    }
    if (response.status !== 200 || response.data.room?.phase !== (round === 11 ? 'finished' : 'result')) {
      console.error('round response:', round + 1, response.status, response.data);
    }
    check(response.status === 200 && response.data.room.phase === (round === 11 ? 'finished' : 'result'),
      'resolve co-op round ' + (round + 1));
    if (round < 11) {
      for (let i = 0; i < 3; i++) {
        response = await api('/rooms/' + code + '/continue', 'POST', { skip: true }, nicknames[i].token);
      }
      check(response.data.room.roundIndex === round + 1, 'advance to co-op round ' + (round + 2));
    }
  }
  state = await api('/rooms/' + code + '/state', 'GET', undefined, nicknames[0].token);
  const finished = state.data.room;
  check(finished.phase === 'finished' && finished.teamHistory.length === 12, 'finish after exactly 12 rounds');
  check(finished.players.every((player) => player.rank === nicknames[player.seat].rank + finished.rankDelta || player.rank === 0),
    'apply the same shared rank delta to all members');

  const lobbyCode = 'EFGHJKL5';
  response = await api('/rooms', 'POST', {
    code: lobbyCode, token: '9'.repeat(64), nicknameIndex: 0, rank: 0, loadout,
  });
  check(response.status === 201 && response.data.room.phase === 'lobby', 'create lobby retention test room');
  // Alarm retention paths use the same stored phase metadata as production alarms.
  for (const [retentionCode, phase, ageDays] of [
    [lobbyCode, 'lobby', 8], [code, 'finished', 31],
  ]) {
    const storedRoom = await namespace.state(retentionCode).storage.get('room');
    if (phase === 'lobby') storedRoom.createdAt = Date.now() - ageDays * 86400000;
    else storedRoom.finishedAt = Date.now() - ageDays * 86400000;
    await namespace.state(retentionCode).storage.put('room', storedRoom);
    await namespace.alarm(retentionCode);
    check((await namespace.state(retentionCode).storage.get('room')) === undefined,
      phase + ' data expires after ' + ageDays + ' days');
  }

  console.log('\n' + checks + '/' + checks + ' co-op checks passed');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
