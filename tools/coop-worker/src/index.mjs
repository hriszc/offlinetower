import CoopSim from '../../../js/coop-sim.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;
const OFFLINE_GRACE_MS = 15000;
const ROOM_END_RETENTION_MS = 30 * 86400000;
const NICKNAMES = [
  '夜巡员', '守门人', '灯塔客', '墙匠', '拾荒者', '巡夜犬', '旧城客', '守夜人',
  '望火人', '纸灯客', '旧钟匠', '夜行者', '巷口哨兵', '乌鸦使', '窗边人', '红围巾',
  '雨夜客', '灯油匠', '修门匠', '巡街客', '影哨', '风帽人', '破晓者', '守灯人',
];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers),
  });
}

function cors(headers = {}) {
  return Object.assign({}, headers, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
}

function error(code, status, message) {
  return json({ error: code, message }, status);
}

function randomBytes(size) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function hex(bytes) {
  return Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
}

function randomCode() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

function randomSeed() {
  const bytes = randomBytes(4);
  return new DataView(bytes.buffer).getUint32(0, false) || 1;
}

async function tokenHash(token) {
  const bytes = new TextEncoder().encode(token);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request, maxBytes = 16384) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw Object.assign(new Error('body_too_large'), { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw Object.assign(new Error('body_too_large'), { status: 413 });
  }
  try { return text ? JSON.parse(text) : {}; }
  catch (_) { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

const UNIT_TYPES = new Set([
  'barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla', 'sniper', 'venom',
  'frost', 'quake', 'railgun', 'totem', 'wolf', 'owl', 'boar', 'chameleon',
  'elephant', 'frog', 'bee', 'turtle', 'tiger', 'phoenix',
]);
const FOOTPRINT = { barricade: 3, spike: 3, elephant: 3 };
const UNIT_COST = {
  barricade: 20, spike: 30, turret: 45, lamp: 55, flame: 65, tesla: 85,
  sniper: 70, venom: 60, frost: 70, quake: 75, railgun: 105, totem: 95,
  wolf: 110, owl: 115, boar: 130, chameleon: 125, elephant: 160,
  frog: 150, bee: 170, turtle: 165, tiger: 190, phoenix: 200,
};
const UNLOCKS = [
  { rank: 0, ids: ['barricade', 'spike', 'turret', 'lamp', 'flame', 'tesla'] },
  { rank: 100, ids: ['sniper', 'venom'] },
  { rank: 500, ids: ['frost', 'quake'] },
  { rank: 1000, ids: ['railgun', 'totem'] },
  { rank: 1500, ids: ['wolf', 'owl'] },
  { rank: 2000, ids: ['boar', 'chameleon'] },
  { rank: 2500, ids: ['elephant', 'frog'] },
  { rank: 3000, ids: ['bee', 'turtle'] },
  { rank: 3500, ids: ['tiger', 'phoenix'] },
];

function cleanLoadout(raw, rank) {
  const unlocked = [];
  UNLOCKS.forEach((group) => { if (rank >= group.rank) unlocked.push(...group.ids); });
  const unique = Array.from(new Set(Array.isArray(raw) ? raw : []));
  if (unique.length !== 6 || unique.some((id) => !unlocked.includes(id))) {
    throw Object.assign(new Error('invalid_loadout'), { status: 400 });
  }
  return unique;
}

function cleanDraft(raw, loadout) {
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error('invalid_draft'), { status: 400 });
  const source = Array.isArray(raw.build) ? raw.build : [];
  if (source.length > 27) throw Object.assign(new Error('invalid_build'), { status: 400 });
  const occupied = new Set();
  const build = source.map((unit) => {
    if (!unit || !UNIT_TYPES.has(unit.type) || !Number.isInteger(unit.col) ||
      unit.col < 0 || unit.col > 8 || !Number.isInteger(unit.lane) ||
      unit.lane < 0 || unit.lane > 2) {
      throw Object.assign(new Error('invalid_build'), { status: 400 });
    }
    if (loadout && !loadout.includes(unit.type)) throw Object.assign(new Error('invalid_build'), { status: 400 });
    const lv = Number.isInteger(unit.lv) ? unit.lv : 1;
    if (lv < 1 || lv > 3) throw Object.assign(new Error('invalid_build'), { status: 400 });
    const footprint = FOOTPRINT[unit.type] || 1;
    const firstLane = unit.lane - Math.floor((footprint - 1) / 2);
    if (firstLane < 0 || firstLane + footprint > 3) throw Object.assign(new Error('invalid_build'), { status: 400 });
    for (let lane = firstLane; lane < firstLane + footprint; lane++) {
      const key = unit.col + '|' + lane;
      if (occupied.has(key)) throw Object.assign(new Error('invalid_build'), { status: 400 });
      occupied.add(key);
    }
    const form = typeof unit.form === 'string' && /^[a-z0-9_-]{1,24}$/i.test(unit.form)
      ? unit.form : null;
    return { type: unit.type, col: unit.col, lane: unit.lane, lv, form };
  });
  const coins = Number.isInteger(raw.coins) ? raw.coins : 0;
  if (coins < 0 || coins > 50000) throw Object.assign(new Error('invalid_coins'), { status: 400 });
  return { build, coins };
}

function buildCost(build) {
  return build.reduce((sum, unit) => {
    const base = UNIT_COST[unit.type];
    let total = base;
    for (let level = 1; level < (unit.lv || 1); level++) {
      total += Math.round(base * (0.75 + 0.55 * level));
    }
    return sum + total;
  }, 0);
}

function acceptDraft(player, raw) {
  const draft = cleanDraft(raw, player.loadout);
  if (draft.coins + buildCost(draft.build) > player.budget) {
    throw Object.assign(new Error('invalid_economy'), { status: 400 });
  }
  return draft;
}

function cleanNickname(index) {
  if (!Number.isInteger(index) || index < 0 || index >= NICKNAMES.length) {
    throw Object.assign(new Error('invalid_nickname'), { status: 400 });
  }
  return NICKNAMES[index];
}

function cleanRank(value) {
  if (!Number.isInteger(value) || value < 0 || value > 50000) {
    throw Object.assign(new Error('invalid_rank'), { status: 400 });
  }
  return value;
}

async function api(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, service: 'zombieknock-coop', version: 1 });
  }

  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    const body = await readJson(request);
    const nickname = cleanNickname(body.nicknameIndex);
    const rank = cleanRank(body.rank);
    const loadout = cleanLoadout(body.loadout, rank);
    const initialDraft = cleanDraft({ build: [], coins: 95 });
    const suppliedCode = typeof body.code === 'string' && CODE_RE.test(body.code) ? body.code : null;
    const suppliedToken = typeof body.token === 'string' && /^[a-f0-9]{64}$/i.test(body.token)
      ? body.token.toLowerCase() : null;
    if (body.code && !suppliedCode) return error('invalid_code', 400, '房间码格式不正确');
    if (body.token && !suppliedToken) return error('invalid_token', 400, '房间凭证格式不正确');
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = suppliedCode || randomCode();
      const token = suppliedToken || hex(randomBytes(32));
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      const res = await stub.fetch('https://room.internal/internal/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code, nickname, nicknameIndex: body.nicknameIndex, rank, loadout,
          tokenHash: await tokenHash(token), initialDraft,
          maxPlayers: body.maxPlayers === CoopSim.MAX_PLAYERS ? CoopSim.MAX_PLAYERS : 3,
        }),
      });
      const result = await res.json();
      if (res.status === 201 || res.status === 200) return json(Object.assign(result, { token }), res.status);
      if (res.status === 409 && suppliedCode) return json(result, res.status);
      if (res.status !== 409) return json(result, res.status);
    }
    return error('room_code_unavailable', 503, '房间创建繁忙，请重试');
  }

  const match = url.pathname.match(/^\/api\/rooms\/([A-HJ-NP-Z2-9]{8})(?:\/(join|start|state|draft|ready|continue|delete|leave))?$/);
  if (!match) return error('not_found', 404, '没有这个接口');
  const code = match[1];
  const action = match[2] || 'state';
  if (!CODE_RE.test(code)) return error('invalid_code', 400, '房间码格式不正确');

  if (action === 'join') {
    if (request.method !== 'POST') return error('method_not_allowed', 405, '请求方式不支持');
    const body = await readJson(request);
    const rank = cleanRank(body.rank);
    const loadout = cleanLoadout(body.loadout, rank);
    const token = typeof body.token === 'string' && /^[a-f0-9]{64}$/i.test(body.token)
      ? body.token.toLowerCase() : hex(randomBytes(32));
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const res = await stub.fetch('https://room.internal/internal/join', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nickname: cleanNickname(body.nicknameIndex), nicknameIndex: body.nicknameIndex,
        rank, loadout, tokenHash: await tokenHash(token),
      }),
    });
    const result = await res.json();
    if (!res.ok) return json(result, res.status);
    return json(Object.assign(result, { token }), res.status);
  }

  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  const internal = new Request('https://room.internal/' + action, request);
  const response = await stub.fetch(internal);
  return new Response(response.body, {
    status: response.status,
    headers: cors(Object.fromEntries(response.headers.entries())),
  });
}

export default {
  async fetch(request, env) {
    try {
      const response = await api(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: cors(Object.fromEntries(response.headers.entries())),
      });
    } catch (err) {
      const status = err && err.status ? err.status : 400;
      const known = new Set([
        'body_too_large', 'invalid_json', 'invalid_code', 'invalid_token', 'invalid_nickname',
        'invalid_rank', 'invalid_loadout', 'invalid_build', 'invalid_coins', 'invalid_economy',
        'invalid_reward',
      ]);
      const code = err && known.has(err.message) ? err.message : 'invalid_request';
      const messages = {
        body_too_large: '请求内容过大', invalid_json: '请求内容不是有效 JSON',
        invalid_code: '房间码格式不正确', invalid_token: '房间凭证格式不正确',
        invalid_nickname: '预设昵称无效', invalid_rank: '段位数据无效',
        invalid_loadout: '出战动物阵容无效', invalid_build: '布防数据无效',
        invalid_coins: '金币数值无效', invalid_economy: '布防和金币超出可用预算',
        invalid_reward: '遗物选择无效', invalid_request: '请求内容不正确',
      };
      return json({ error: code, message: messages[code] }, status, cors());
    }
  },
};

export class RoomObject {
  constructor(state) {
    this.state = state;
    this.queue = Promise.resolve();
    this.requests = [];
  }

  fetch(request) {
    const run = () => this.handle(request);
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async handle(request) {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < 10000);
    if (this.requests.length >= 180) return error('rate_limited', 429, '请求太频繁，请稍后再试');
    this.requests.push(now);

    const path = new URL(request.url).pathname;
    if (path === '/internal/create' && request.method === 'POST') {
      const body = await readJson(request);
      const existing = await this.state.storage.get('room');
      if (existing) {
        const owner = existing.players.find((p) => safeEqual(p.tokenHash, body.tokenHash));
        if (owner && owner.seat === existing.ownerSeat) {
          return json({ room: this.publicRoom(existing), self: this.privateMember(owner) });
        }
        return error('collision', 409, '房间码冲突');
      }
      const player = {
        seat: 0, nickname: body.nickname, nicknameIndex: body.nicknameIndex,
        rank: body.rank, loadout: body.loadout, tokenHash: body.tokenHash, coins: 95, budget: 95, relics: [],
        draft: body.initialDraft, ready: false, continued: false, history: [], lastSeenAt: now,
      };
      const room = {
        code: body.code, maxPlayers: body.maxPlayers === CoopSim.MAX_PLAYERS ? CoopSim.MAX_PLAYERS : 3,
        createdAt: now, ownerSeat: 0, phase: 'lobby', roundIndex: 0,
        deadline: null, players: [player], result: null, teamWins: 0, teamHistory: [], rankDelta: null,
      };
      await this.store(room);
      return json({ room: this.publicRoom(room), self: this.privateMember(player) }, 201);
    }

    let room = await this.state.storage.get('room');
    if (!room) return error('room_not_found', 404, '房间不存在或已过期');
    room.players.forEach((p) => {
      if (!Number.isFinite(p.lastSeenAt)) p.lastSeenAt = now;
    });
    if (room.phase !== 'finished' && room.deadline && now >= room.deadline) {
      room = await this.advanceDeadline(room, now);
      if (!room) return error('room_not_found', 404, '房间不存在或已过期');
    }

    if (path === '/internal/join' && request.method === 'POST') {
      const body = await readJson(request);
      const joined = room.players.find((p) => safeEqual(p.tokenHash, body.tokenHash));
      if (joined) return json({ room: this.publicRoom(room), self: this.privateMember(joined) });
      const maxPlayers = room.maxPlayers || 3;
      if (room.phase !== 'lobby' || room.players.length >= maxPlayers) {
        return error('room_full', 409, '房间已满或已经开局');
      }
      const seat = room.players.length;
      const player = {
        seat, nickname: body.nickname, nicknameIndex: body.nicknameIndex,
        rank: body.rank, loadout: body.loadout, tokenHash: body.tokenHash, coins: 95, budget: 95, relics: [],
        draft: { build: [], coins: 95 }, ready: false, continued: false, history: [], lastSeenAt: now,
      };
      room.players.push(player);
      if (room.players.length >= maxPlayers) this.startPreparation(room, now);
      await this.store(room);
      return json({ room: this.publicRoom(room), self: this.privateMember(player) }, 201);
    }

    const player = await this.authorize(request, room);
    if (!player) return error('unauthorized', 401, '房间凭证无效');

    const touched = now - player.lastSeenAt >= 5000;
    if (touched) player.lastSeenAt = now;
    const presenceChanged = this.applyPresence(room, now);
    if (touched || presenceChanged) await this.store(room);

    if (path === '/leave' && request.method === 'POST') {
      if (player.seat !== room.ownerSeat) return error('forbidden', 403, '只有房主能结束合作房间');
      this.endRoom(room, 'owner_left', now);
      await this.store(room);
      return json({ room: this.publicRoom(room), self: this.privateMember(player) });
    }

    if (path === '/state' && request.method === 'GET') {
      return json({ room: this.publicRoom(room), self: this.privateMember(player) });
    }
    if (path === '/start' && request.method === 'POST') {
      if (player.seat !== room.ownerSeat) return error('forbidden', 403, '只有房主能开局');
      if (room.phase === 'lobby') {
        if (room.players.length < 2) return error('not_enough_players', 409, '至少两人才能开局');
        this.startPreparation(room, now);
        await this.store(room);
      }
      return json({ room: this.publicRoom(room), self: this.privateMember(player) });
    }
    if (path === '/draft' && request.method === 'POST') {
      if (room.phase !== 'preparing' || player.ready) return error('phase_locked', 409, '本回合布防已锁定');
      const body = await readJson(request);
      player.draft = acceptDraft(player, body);
      await this.store(room);
      return json({ ok: true });
    }
    if (path === '/ready' && request.method === 'POST') {
      if (room.phase === 'preparing' && player.ready) {
        return json({ room: this.publicRoom(room), self: this.privateMember(player) });
      }
      if (room.phase !== 'preparing') return error('phase_locked', 409, '本回合已提交或备战已结束');
      const body = await readJson(request);
      player.draft = acceptDraft(player, body);
      player.ready = true;
      if (room.players.every((p) => p.ready)) this.resolveRound(room, now);
      await this.store(room);
      return json({ room: this.publicRoom(room), self: this.privateMember(player) });
    }
    if (path === '/continue' && request.method === 'POST') {
      if (room.phase === 'result' && player.continued) {
        return json({ room: this.publicRoom(room), self: this.privateMember(player) });
      }
      if (room.phase !== 'result') return error('phase_locked', 409, '当前不能继续');
      const body = await readJson(request);
      this.applyRewardChoice(player, body);
      player.continued = true;
      if (room.players.every((p) => p.continued)) this.startNextPreparation(room, now);
      await this.store(room);
      return json({ room: this.publicRoom(room), self: this.privateMember(player) });
    }
    if (path === '/delete' && request.method === 'DELETE') {
      if (player.seat !== room.ownerSeat) return error('forbidden', 403, '只有房主能删除房间');
      await this.state.storage.delete('room');
      await this.state.storage.deleteAlarm();
      return json({ deleted: true });
    }
    return error('method_not_allowed', 405, '请求方式不支持');
  }

  async authorize(request, room) {
    const header = request.headers.get('authorization') || '';
    const match = header.match(/^Bearer ([a-f0-9]{64})$/i);
    if (!match) return null;
    const hash = await tokenHash(match[1]);
    for (const player of room.players) if (safeEqual(hash, player.tokenHash)) return player;
    return null;
  }

  publicRoom(room) {
    return {
      code: room.code, phase: room.phase, roundIndex: room.roundIndex,
      maxPlayers: room.maxPlayers || 3,
      deadline: room.deadline, ownerSeat: room.ownerSeat,
      players: room.players.map((p) => ({
        seat: p.seat, nickname: p.nickname, nicknameIndex: p.nicknameIndex,
        rank: p.rank, ready: !!p.ready, continued: !!p.continued,
      })),
      result: room.result,
      teamWins: room.teamWins,
      teamHistory: room.teamHistory,
      rankDelta: room.rankDelta,
      endReason: room.endReason || null,
    };
  }

  privateMember(player) {
    return {
      seat: player.seat, rank: player.rank, coins: player.coins,
      relics: player.relics.slice(), draft: player.draft, loadout: player.loadout,
      history: player.history.slice(), rewardChoices: player.rewardChoices || [],
      ready: !!player.ready, continued: !!player.continued,
    };
  }

  async store(room) {
    await this.state.storage.put('room', room);
    const deadlines = [room.phase === 'lobby' ? room.createdAt + 7 * 86400000
      : room.phase === 'finished' ? room.finishedAt + ROOM_END_RETENTION_MS
        : room.phase === 'ended' ? room.endedAt + ROOM_END_RETENTION_MS : room.deadline];
    if (room.phase !== 'finished' && room.phase !== 'ended') {
      const owner = room.players.find((p) => p.seat === room.ownerSeat);
      if (owner && room.phase !== 'lobby') deadlines.push((owner.lastSeenAt || room.createdAt) + OFFLINE_GRACE_MS);
      if (room.phase === 'preparing') {
        room.players.forEach((p) => {
          if (!p.ready) deadlines.push((p.lastSeenAt || room.createdAt) + OFFLINE_GRACE_MS);
        });
      }
    }
    const validDeadlines = deadlines.filter(Number.isFinite);
    const alarm = validDeadlines.length ? Math.min.apply(null, validDeadlines) : null;
    if (alarm !== null) await this.state.storage.setAlarm(alarm);
    else await this.state.storage.deleteAlarm();
  }

  applyPresence(room, now) {
    if (room.phase === 'finished' || room.phase === 'ended') return false;
    const owner = room.players.find((p) => p.seat === room.ownerSeat);
    if (owner && room.phase !== 'lobby' && now - (owner.lastSeenAt || room.createdAt) >= OFFLINE_GRACE_MS) {
      this.endRoom(room, 'owner_left', now);
      return true;
    }
    if (room.phase !== 'preparing') return false;
    let changed = false;
    room.players.forEach((p) => {
      if (!p.ready && now - (p.lastSeenAt || room.createdAt) >= OFFLINE_GRACE_MS) {
        p.ready = true;
        p.autoReadyAt = now;
        changed = true;
      }
    });
    if (changed && room.players.every((p) => p.ready)) this.resolveRound(room, now);
    return changed;
  }

  endRoom(room, reason, now) {
    if (room.phase === 'finished' || room.phase === 'ended') return;
    room.phase = 'ended';
    room.endReason = reason;
    room.endedAt = now;
    room.deadline = now + ROOM_END_RETENTION_MS;
  }

  startPreparation(room, now) {
    room.phase = 'preparing';
    room.deadline = now + 120000;
    room.players.forEach((p) => {
      p.ready = false;
      p.draft = p.draft || { build: [], coins: p.coins };
    });
  }

  resolveRound(room, now) {
    const averageRank = room.players.reduce((sum, p) => sum + p.rank, 0) / room.players.length;
    const seed = randomSeed();
    const outcome = CoopSim.resolve(room.players.map((p) => ({
      seat: p.seat, rank: p.rank, build: p.draft.build, relics: p.relics,
    })), room.roundIndex, seed, averageRank, { timeline: false });
    room.teamWins += outcome.teamWon ? 1 : 0;
    room.teamHistory.push(!!outcome.teamWon);
    room.players.forEach((p) => {
      const memberResult = outcome.members.find((m) => m.seat === p.seat);
      p.history.push(!!(memberResult && memberResult.survived));
      p.coins = Math.max(0, Math.min(50000,
        p.draft.coins + CoopSim.income(room.roundIndex, !!(memberResult && memberResult.survived), p.relics)));
      p.lastBuild = p.draft.build;
      p.budget = p.coins + buildCost(p.lastBuild);
      const choices = CoopSim.rewardChoices(seed + p.seat + 1, p.relics);
      p.rewardChoices = outcome.teamWon ? choices : choices.slice(0, 2);
      p.ready = false;
      p.continued = false;
    });
    room.result = {
      version: outcome.version, roundIndex: outcome.roundIndex, seed: outcome.seed,
      duration: outcome.duration, teamWon: outcome.teamWon, members: outcome.members,
      inputs: room.players.map((p) => ({
        seat: p.seat, rank: p.rank, build: p.lastBuild, relics: p.relics.slice(),
      })),
    };
    room.deadline = now + 120000;
    if (room.roundIndex >= CoopSim.MAX_ROUNDS - 1) {
      room.phase = 'finished';
      room.finishedAt = now;
      room.deadline = room.finishedAt + 30 * 86400000;
      room.rankDelta = CoopSim.rankDelta(room.teamWins);
      room.players.forEach((p) => { p.rank = Math.max(0, p.rank + room.rankDelta); });
    } else {
      room.phase = 'result';
    }
  }

  applyRewardChoice(player, body) {
    if (body && typeof body.relicId === 'string') {
      if (player.rewardChoices.indexOf(body.relicId) < 0 || player.relics.indexOf(body.relicId) >= 0) {
        throw Object.assign(new Error('invalid_reward'), { status: 400 });
      }
      player.relics.push(body.relicId);
    } else {
      player.coins = Math.min(50000, player.coins + 45);
      player.budget = Math.min(50000, player.budget + 45);
    }
  }

  startNextPreparation(room, now) {
    room.roundIndex++;
    room.players.forEach((p) => {
      p.continued = false;
      p.ready = false;
      p.draft = { build: p.lastBuild || [], coins: p.coins };
      p.rewardChoices = [];
    });
    this.startPreparation(room, now);
  }

  async advanceDeadline(room, now) {
    if (room.phase === 'preparing') {
      this.resolveRound(room, now);
    } else if (room.phase === 'result') {
      room.players.forEach((p) => {
        if (!p.continued) p.coins = Math.min(50000, p.coins + 45);
        if (!p.continued) p.budget = Math.min(50000, p.budget + 45);
        p.continued = true;
      });
      this.startNextPreparation(room, now);
    } else if (room.phase === 'lobby' && now >= room.createdAt + 7 * 86400000) {
      await this.state.storage.delete('room');
      await this.state.storage.deleteAlarm();
      return null;
    } else if (room.phase === 'finished' && now >= room.finishedAt + 30 * 86400000) {
      await this.state.storage.delete('room');
      await this.state.storage.deleteAlarm();
      return null;
    } else if (room.phase === 'ended' && now >= room.endedAt + ROOM_END_RETENTION_MS) {
      await this.state.storage.delete('room');
      await this.state.storage.deleteAlarm();
      return null;
    }
    await this.store(room);
    return room;
  }

  async alarm() {
    const room = await this.state.storage.get('room');
    if (!room) return;
    const now = Date.now();
    const changed = this.applyPresence(room, now);
    if (changed) {
      await this.store(room);
      return;
    }
    const deadline = room.phase === 'lobby' ? room.createdAt + 7 * 86400000
      : room.phase === 'finished' ? room.finishedAt + ROOM_END_RETENTION_MS
        : room.phase === 'ended' ? room.endedAt + ROOM_END_RETENTION_MS : room.deadline;
    if (deadline && now >= deadline) await this.advanceDeadline(room, now);
    else if (deadline) await this.state.storage.setAlarm(deadline);
  }
}
