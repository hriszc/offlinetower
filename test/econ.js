// 经济循环模拟：与 game.js 真实逻辑一致的征兵/拼字/召唤/布阵 + 断言
global.window = global;
require('../js/config.js');
require('../js/rand.js');
require('../js/engine.js');

const CFG = global.CFG;
const Engine = global.Engine;
const Rand = global.Rand;

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('✗ 断言失败: ' + msg); }
  else console.log('✓ ' + msg);
}

function simulate(strategyName, opts) {
  const battle = new Engine.Battle(CFG.MAPS[0], {});
  let mantou = CFG.ECONOMY.startMantou;
  let drawCount = 0, frags = 0;
  let tiles = [], spell = [null, null, null];
  let bench = [];
  battle.on('kill', () => mantou += CFG.ECONOMY.killMantou);
  battle.on('waveClear', w => mantou += CFG.ECONOMY.waveClearMantou);
  battle.on('adouHit', () => mantou += CFG.ECONOMY.adouHitMantou);
  battle.on('bossKill', () => mantou += CFG.ECONOMY.bossMantou);

  function owned() {
    const o = {};
    for (const t of tiles) (o[t.general] = o[t.general] || []).push(t.char);
    for (const t of spell) if (t) (o[t.general] = o[t.general] || []).push(t.char);
    return o;
  }
  function match() {
    const chars = spell.filter(Boolean).map(t => t.char).sort().join('');
    if (!chars) return null;
    return CFG.GENERALS.find(g => g.chars.slice().sort().join('') === chars) || null;
  }
  // 部署策略：中路优先（覆盖多行），同 game.js 首将赠池站位逻辑
  const DEPLOY_ORDER = [[2, 2], [1, 2], [2, 1], [1, 1], [2, 3], [1, 3], [3, 2], [2, 0], [2, 4], [3, 1], [3, 3], [1, 0], [1, 4], [0, 2], [3, 0], [3, 4], [0, 1], [0, 3], [4, 2], [0, 0], [0, 4], [4, 1], [4, 3], [5, 2], [4, 0], [4, 4], [5, 1], [5, 3], [5, 0], [5, 4]];
  let depIdx = 0;
  function tryDeploy() {
    if (!bench.length) return;
    const item = bench[0];
    while (depIdx < DEPLOY_ORDER.length) {
      const [col, row] = DEPLOY_ORDER[depIdx];
      if (battle.canPlace(col, row)) {
        battle.deploy(new Engine.Unit(item.name, item.star, 1), col, row);
        bench.shift();
        depIdx++;
        return;
      }
      depIdx++;
    }
  }
  // 与 game.js 一致：首局送赵/云；正常局赠 2字+rge≥3 武将全套字牌
  if (opts && opts.firstGame) {
    mantou += 20;
    tiles.push({ char: '赵', general: '赵云', quality: 'SSR' });
    tiles.push({ char: '云', general: '赵云', quality: 'SSR' });
  } else if (opts && opts.gift) {
    const giftPool = CFG.GENERALS.filter(g => g.chars.length === 2 && g.rge >= 3 && g.atk * g.frq >= 10);
    const g = Rand.pick(giftPool);
    for (const c of g.chars) tiles.push({ char: c, general: g.name, quality: g.quality });
  }

  function doRecruit() {
    const cost = CFG.ECONOMY.recruitBase + CFG.ECONOMY.recruitStep * drawCount;
    if (mantou < cost) return false;
    mantou -= cost; drawCount++;
    if (Math.random() < CFG.TILE_RATE) {
      const pool = CFG.tilePool(owned());
      if (pool.length) {
        const it = Rand.weighted(pool);
        tiles.push({ char: it.char, general: it.general.name, quality: it.general.quality });
      } else frags += 2;
    } else frags += 2;
    if (frags >= 10) {
      frags -= 10;
      const pool = CFG.tilePool(owned());
      if (pool.length) {
        const it = Rand.weighted(pool);
        tiles.push({ char: it.char, general: it.general.name, quality: it.general.quality });
      }
    }
    return true;
  }
  function placeTile() {
    let best = null, bestMiss = 99, bestIdx = -1, bestSlot = -1;
    for (const g of CFG.GENERALS) {
      if (bench.some(b => b.name === g.name)) continue;
      if (battle.units.some(u => u.gen.name === g.name)) continue;
      const missing = g.chars.filter(c => !spell.some(s => s && s.char === c));
      const haveInTiles = missing.filter(c => tiles.some(t => t.char === c));
      if (haveInTiles.length && missing.length < bestMiss) {
        const idx = tiles.findIndex(t => t.char === haveInTiles[0]);
        const slot = spell.findIndex(s => !s);
        if (slot >= 0) { best = g; bestMiss = missing.length; bestIdx = idx; bestSlot = slot; }
      }
    }
    if (best) {
      spell[bestSlot] = tiles[bestIdx];
      tiles.splice(bestIdx, 1);
      return true;
    }
    return false;
  }

  let t = 0, turn = 0;
  while (t < 600 && !battle.over && turn < 5000) {
    turn++;
    const g = match();
    if (g && mantou >= CFG.ECONOMY.summonCost) {
      mantou -= CFG.ECONOMY.summonCost;
      spell = [null, null, null];
      if (bench.some(b => b.name === g.name)) {
        bench.find(b => b.name === g.name).star++;
      } else {
        bench.push({ name: g.name, star: 1, level: 1, exp: 0, kills: 0 });
      }
    } else if (g) {
      // 拼齐但钱不够 → 等待卖血攒钱
    } else if (placeTile()) {
      // 拼字凑字中
    } else {
      doRecruit();
    }
    tryDeploy();
    battle.update(0.05);
    t += 0.05;
  }
  const names = battle.units.map(u => u.gen.name + '★' + u.star + 'L' + u.level);
  const summoned = bench.length + battle.units.length;
  console.log(`[${strategyName}] result=${battle.result} wave=${battle.wave} time=${t.toFixed(0)}s ` +
    `召唤=${summoned}人 场上=[${names.join(',')}] 馒头=${mantou} 抽卡=${drawCount}次 碎片=${frags}`);
  return { battle, summoned };
}

console.log('--- 经济循环（与 game.js 赠字逻辑一致） ---');
const r1 = simulate('首局(送赵/云)', { firstGame: true });
assert(r1.summoned >= 1, '首局能召唤至少 1 将');
assert(r1.battle.wave >= 2, `首局至少撑到第 2 波（实际 ${r1.battle.wave} 波）`);

const N = 20;
let minWave = 99, failFirst = 0, avgWave = 0;
for (let i = 0; i < N; i++) {
  const r = simulate('正常局#' + (i + 1), { gift: true });
  if (r.summoned < 1) { console.error('✗ 正常局未召唤出首将'); failures++; }
  if (r.battle.wave < 2) failFirst++;
  minWave = Math.min(minWave, r.battle.wave);
  avgWave += r.battle.wave;
}
avgWave /= N;
assert(failFirst === 0, `正常局 ${N} 局无一第 1 波崩盘（崩 ${failFirst} 局）`);
assert(minWave >= 2, `正常局最低撑到第 ${minWave} 波（≥2）`);
assert(avgWave >= 3, `正常局平均撑 ${avgWave.toFixed(1)} 波（≥3）`);

console.log(failures === 0 ? '\n全部断言通过 ✔' : `\n${failures} 项断言失败 ✗`);
process.exitCode = failures > 0 ? 1 : 0;
