// 无头回归测试：战斗数值配平 + 机器人分层 + 首将生存
// 失败断言 → 非零退出码（可作 CI 防线）
global.window = global;
require('../js/config.js');
require('../js/rand.js');
require('../js/engine.js');
require('../js/bot.js');
require('../js/save.js');

const CFG = global.CFG;
const Engine = global.Engine;
const Bot = global.Bot;

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('✗ 断言失败: ' + msg); }
  else console.log('✓ ' + msg);
}

function simOneGame(name, deploys, maxT) {
  const battle = new Engine.Battle(CFG.MAPS[0], {});
  const ev = { kills: 0, adouHits: 0, finish: null, waves: 0, bossKills: 0 };
  battle.on('kill', () => ev.kills++);
  battle.on('bossKill', () => ev.bossKills++);
  battle.on('adouHit', () => ev.adouHits++);
  battle.on('finish', r => ev.finish = r);
  battle.on('waveClear', w => ev.waves = w);
  for (const [gen, star, col, row] of deploys) {
    battle.deploy(new Engine.Unit(gen, star, 1), col, row);
  }
  let t = 0;
  while (t < maxT && !battle.over) {
    battle.update(0.05);
    t += 0.05;
    if (battle.units.length && Math.random() < 0.01) {
      const u = battle.units[Math.floor(Math.random() * battle.units.length)];
      battle.castSkill(u);
    }
  }
  console.log(`[${name}] over=${battle.over} result=${battle.result} wave=${battle.wave} time=${t.toFixed(0)}s ` +
    `kills=${ev.kills} adouHits=${ev.adouHits} adouHP=${battle.adou.hp}/${battle.adou.maxHp} bossKills=${ev.bossKills}`);
  return { battle, t, ev };
}

console.log('--- 战斗数值配平 ---');
// 教学局：单赵云（rge3 覆盖多路）不应在前 2 波崩盘
const r1 = simOneGame('单赵云(教学)', [['赵云', 1, 2, 2]], 600);
assert(r1.battle.wave >= 3, `教学局单赵云至少撑到第 3 波（实际 ${r1.battle.wave} 波）`);
// 4 将 1 星：10-12 波阵容成型前不崩
const r2 = simOneGame('4将1星', [['赵云', 1, 2, 2], ['张飞', 1, 1, 2], ['周瑜', 1, 2, 1], ['诸葛亮', 1, 2, 3]], 600);
assert(r2.battle.wave >= 12, `4将1星至少撑到第 12 波（实际 ${r2.battle.wave} 波）`);
// 6 将 2 星：单局时长 5-10 分钟（300-600s）
const r3 = simOneGame('6将2星', [
  ['赵云', 2, 2, 2], ['张飞', 2, 1, 2], ['关羽', 2, 1, 1], ['周瑜', 2, 2, 1],
  ['诸葛亮', 2, 2, 3], ['吕布', 2, 1, 3]
], 600);
assert(r3.t >= 300 && r3.t <= 600, `6将2星单局时长 5-10 分钟（实际 ${r3.t.toFixed(0)}s）`);
assert(r3.battle.result === 'victory', '6将2星可通关 30 波');

console.log('--- 机器人分层（genWaves 层内均值,方案 §5.4 参数） ---');
const layers = [
  { rank: 0, name: '军士/校尉', mean: 7,  range: [6.5, 7.5] },
  { rank: 3, name: '少/中/上将', mean: 12, range: [11.5, 12.5] },
  { rank: 6, name: '大将/元帅/诸侯', mean: 19, range: [18.5, 19.5] },
  { rank: 9, name: '霸主/君主/皇帝', mean: 26, range: [25.5, 26.5] }
];
for (const L of layers) {
  let sum = 0, n = 500;
  for (let i = 0; i < n; i++) sum += Bot.genWaves(L.rank);
  const mean = sum / n;
  assert(mean >= L.range[0] && mean <= L.range[1],
    `${L.name} 机器人均值 ${mean.toFixed(1)} 在 [${L.range[0]},${L.range[1]}]（期望 ${L.mean}）`);
}
// 对手军衔：同段 45% / 高一段 35% / 低一段 20%（稳赢局）
{
  const dist = {}, n = 1000;
  for (let i = 0; i < n; i++) {
    const r = Bot.makeOpponent(5).rankIdx;
    dist[r] = (dist[r] || 0) + 1;
  }
  const lo = (dist[4] || 0) / n, mid = (dist[5] || 0) / n, hi = (dist[6] || 0) / n;
  assert(mid >= 0.4 && hi >= 0.3 && lo >= 0.15,
    `对手军衔分布: 同段 ${(mid * 100).toFixed(0)}% / 高一段 ${(hi * 100).toFixed(0)}% / 低一段 ${(lo * 100).toFixed(0)}%`);
}

console.log('--- 首将生存：赠字池候选（2字+rge≥3+输出≥10: 曹操/赵云/周瑜）各 20 局 ---');
const giftPool = CFG.GENERALS.filter(g => g.chars.length === 2 && g.rge >= 3 && g.atk * g.frq >= 10);
assert(giftPool.length === 3, `赠字池恰为 3 名（曹操/赵云/周瑜），实际 ${giftPool.map(g => g.name).join('/')}`);
for (const g of giftPool) {
  let failWave1 = 0, sum = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const b = new Engine.Battle(CFG.MAPS[0], {});
    b.deploy(new Engine.Unit(g.name, 1, 1), 2, 2);   // 中路站位
    let t = 0;
    while (t < 120 && !b.over) { b.update(0.05); t += 0.05; }
    if (b.wave < 2) failWave1++;
    sum += Math.min(b.wave, 8);
  }
  assert(failWave1 === 0, `赠将「${g.name}」20 局无一第 1 波崩盘（崩 ${failWave1} 局）`);
  assert(sum / N >= 3, `赠将「${g.name}」平均撑 ${(sum / N).toFixed(1)} 波（≥3）`);
}

console.log(failures === 0 ? '\n全部断言通过 ✔' : `\n${failures} 项断言失败 ✗`);
process.exitCode = failures > 0 ? 1 : 0;
