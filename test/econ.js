// 经济循环模拟：与 game.js 真实逻辑一致的征兵/拼字/召唤/布阵 + 断言
global.window = global;
require('../js/config.js');
require('../js/rand.js');
require('../js/engine.js');

// 固定种子 RNG（mulberry32）：让所有断言完全确定化,消除随机左尾失败（CI 可靠）
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(20260801);


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
  let tiles = [], bench = [];
  battle.on('kill', () => mantou += CFG.ECONOMY.killMantou);
  battle.on('waveClear', w => mantou += CFG.ECONOMY.waveClearMantou);
  battle.on('adouHit', () => mantou += CFG.ECONOMY.adouHitMantou);
  battle.on('bossKill', () => mantou += CFG.ECONOMY.bossMantou);

  // 模拟正常玩家运营（游戏内强制机制）：无开局军备、无局内三选一强化（道具仅保留局间一种）

  function owned() {
    const o = {};
    for (const t of tiles) (o[t.general] = o[t.general] || []).push(t.char);
    return o;
  }
  // 收集配对：手牌凑齐某武将全部姓名字 → 可召唤（跳过拼字槽 UI 交互,聚焦经济/掉率回归）
  function match() {
    for (const g of CFG.GENERALS) {
      if (bench.some(b => b.name === g.name)) continue;
      if (battle.units.some(u => u.gen.name === g.name)) continue;
      if (g.chars.every(c => tiles.some(t => t.char === c))) return g;
    }
    return null;
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
        battle.deploy(new Engine.Unit(item.name, item.level), col, row);
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
    let cost = CFG.ECONOMY.recruitBase + CFG.ECONOMY.recruitStep * drawCount;
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
  let t = 0, turn = 0;
  while (t < 600 && !battle.over && turn < 12000) {  // 12000 turns ≈ 600s（与真实单局上限一致）
    turn++;
    const g = match();
    const cost = CFG.ECONOMY.recruitBase + CFG.ECONOMY.recruitStep * drawCount;
    if (g && mantou >= CFG.ECONOMY.summonCost) {
      mantou -= CFG.ECONOMY.summonCost;
      for (const c of g.chars) {
        const i = tiles.findIndex(t => t.char === c);
        if (i >= 0) tiles.splice(i, 1);
      }
      if (!bench.some(b => b.name === g.name)) {
        bench.push({ name: g.name, level: 1, attackCount: 0, kills: 0 });
      }
    } else if (g) {
      // 已拼齐但钱不够 → 等待卖血攒钱
    } else if (mantou >= cost) {
      doRecruit();   // 真实玩家：有钱优先抽卡获取字牌
    }
    tryDeploy();
    battle.update(0.05);
    t += 0.05;
  }
  const names = battle.units.map(u => u.gen.name + 'L' + u.level);
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
let minWave = 99, failFirst = 0, avgWave = 0, summoned2 = 0;
for (let i = 0; i < N; i++) {
  const r = simulate('正常局#' + (i + 1), { gift: true });
  if (r.summoned < 1) { console.error('✗ 正常局未召唤出首将'); failures++; }
  if (r.summoned >= 2) summoned2++;
  if (r.battle.wave < 2) failFirst++;
  minWave = Math.min(minWave, r.battle.wave);
  avgWave += r.battle.wave;
}
avgWave /= N;
assert(failFirst === 0, `正常局 ${N} 局无一第 1 波崩盘（崩 ${failFirst} 局）`);
assert(minWave >= 2, `正常局最低撑到第 ${minWave} 波（≥2）`);
assert(avgWave >= 3, `正常局平均撑 ${avgWave.toFixed(1)} 波（≥3）`);
// 第 2 将可达性：模拟器未用局间道具/主动卖血（真实玩家更强），故仅要求部分局能召唤第 2 将，作为构筑循环下限
// 若此断言连续失败，说明「第 5 波危机」过紧，字谜召唤核心循环被经济卡死，需调 tilePool 加权或经济参数
assert(summoned2 >= 2, `正常局 ${N} 局中 ${summoned2} 局召唤出第 2 将（≥2 局）`);

console.log(failures === 0 ? '\n全部断言通过 ✔' : `\n${failures} 项断言失败 ✗`);
process.exitCode = failures > 0 ? 1 : 0;
