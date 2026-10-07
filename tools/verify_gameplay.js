'use strict';

// Lightweight regressions for relic effects and the visible battle result.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Battle, combineMods, defaultMods, makeZombie, config } = require('../js/sim.js');
const CoopSim = require('../js/coop-sim.js');
const relics = (ids) => ids.map((id) => config.RELICS.find((relic) => relic.id === id));
const ctx = vm.createContext({ console });
for (const file of ['js/i18n.js', 'js/config.js', 'js/sim.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
assert.deepEqual(Object.keys(ctx.TEXT.zh.experience).sort(), Object.keys(ctx.TEXT.en.experience).sort(),
  'new experience messages must be available in both languages');
for (const key of ['retryConnection', 'reconnecting', 'deleteConfirm', 'deleteRecordConfirm',
  'confirmDelete', 'cancelDelete']) {
  assert(ctx.TEXT.zh.coop[key] && ctx.TEXT.en.coop[key], `co-op message ${key} must be bilingual`);
}

function battle(ids = []) {
  return new Battle({ roundIndex: 0, seed: 100, playerMods: combineMods(relics(ids)),
    playerBuild: [], ghostBuild: [] });
}
function walker(b, lane, x = config.CONFIG.RIFT_X) {
  return makeZombie('p', lane, 'walker', x, b.wave, () => 0.5);
}
function travel(ids) {
  const b = battle(ids), z = walker(b, 1), start = z.x;
  b.zombies.push(z); b.rebuildBuckets(); b.updateZombies(0.05);
  return start - z.x;
}
assert(Math.abs(travel(['lore']) / travel([]) - 0.88) < 1e-10,
  'Cadaver Notes must slow actual zombie movement by 12%');
assert.equal(combineMods(relics(['lore', 'powder', 'steel'])).zombieSpeedMul, 0.88);

for (const ids of [[], ['foundation'], ['spares'], ['foundation', 'spares']]) {
  const solo = battle(ids);
  const coop = CoopSim.createBattle([{ seat: 0, build: [], relics: ids },
    { seat: 3, build: [], relics: [] }], 0, 100, 0);
  const expected = 100 + (ids.includes('foundation') ? 35 : 0) + (ids.includes('spares') ? 25 : 0);
  assert.equal(solo.maxHp.p, expected);
  assert.equal(solo.hp.p, expected);
  assert.equal(coop.coopHomes[0].maxHp, expected);
  assert.equal(coop.coopHomes[0].hp, expected, 'co-op must start at full reinforced health');
}
for (const won of [false, true]) {
  for (const ids of [[], ['ration'], ['satchel'], ['ration', 'satchel']]) {
    const soloRelics = ids.map((id) => ctx.RELICS.find((relic) => relic.id === id));
    const expected = 74 + 3 * 16 + (won ? 30 : 12) +
      (ids.includes('ration') ? 15 : 0) + (ids.includes('satchel') ? 30 : 0);
    assert.equal(ctx.incomeFor(3, won, soloRelics), expected);
    assert.equal(CoopSim.income(3, won, ids), expected, 'income relics must work in both modes');
  }
}

const hitBattle = battle();
const first = walker(hitBattle, 2, config.CONFIG.HOME_P_X);
first.attackKind = 'home'; hitBattle.t = 3; hitBattle.resolveZombieAttack(first);
const later = walker(hitBattle, 0, config.CONFIG.HOME_P_X);
later.attackKind = 'home'; hitBattle.t = 4; hitBattle.resolveZombieAttack(later);
assert.deepEqual(hitBattle.firstHomeHit.p, { lane: 2, time: 3, zombie: 'walker' },
  'failure diagnosis must retain the first damaged lane');
assert.equal(hitBattle.firstHomeHit.g, null);

const coopHit = CoopSim.createBattle([{ seat: 0, build: [], relics: [] },
  { seat: 3, build: [], relics: [] }], 0, 100, 0);
coopHit.t = 5;
coopHit.coopHomeHit({ coopHomeSeat: 0, lane: 1, dmg: 10, type: 'walker' });
assert.deepEqual(coopHit.coopHomes[0].firstHit, { lane: 1, time: 5, zombie: 'walker' });

const live = new Battle({ roundIndex: 0, seed: 100,
  playerBuild: [{ type: 'spike', col: 8, lane: 1 }, { type: 'barricade', col: 7, lane: 1 },
    { type: 'turret', col: 6, lane: 1 }], ghostBuild: [],
  playerMods: defaultMods(), ghostMods: defaultMods() });
live.runToEnd();
assert(live.over, 'representative battle must finish');
const visible = { time: live.t, kills: live.killed.p, hp: live.hp.p };
const result = live.decide();
assert.equal(live.t, visible.time, 'settlement must not run a hidden battle');
assert.equal(result.playerTime, visible.time);
assert.equal(result.playerKills, visible.kills);
assert.equal(result.playerHpFrac, visible.hp / live.maxHp.p);
assert.equal(result.winner, 'p');
live.t += 10; live.killed.p += 100; live.hp.p = 0;
const unchanged = live.result();
assert.equal(unchanged.playerTime, result.playerTime);
assert.equal(unchanged.playerKills, result.playerKills);
assert.equal(unchanged.playerHpFrac, result.playerHpFrac, 'all result statistics must use one snapshot');

console.log('PASS: movement relic, stacked income/health in solo and co-op, first-hit diagnosis, visible result snapshot');
