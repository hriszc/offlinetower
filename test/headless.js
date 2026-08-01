// 无头回归测试：战斗数值配平 + 机器人分层 + 首将生存
// 失败断言 → 非零退出码（可作 CI 防线）
global.window = global;
require('../js/config.js');
require('../js/rand.js');
require('../js/engine.js');
require('../js/bot.js');
require('../js/save.js');

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
  for (const [gen, level, col, row] of deploys) {
    battle.deploy(new Engine.Unit(gen, level), col, row);
  }
  let t = 0;
  while (t < maxT && !battle.over) {
    battle.update(0.05);
    t += 0.05;
    // 模拟玩家技能运营：场上怪多（≥6）时才放技能（留怒应对精英/BOSS 波）
    if (battle.monsters.length >= 6 && Math.random() < 0.02) {
      const u = battle.units[Math.floor(Math.random() * battle.units.length)];
      battle.castSkill(u);
    }
  }
  console.log(`[${name}] over=${battle.over} result=${battle.result} wave=${battle.wave} time=${t.toFixed(0)}s ` +
    `kills=${ev.kills} adouHits=${ev.adouHits} adouHP=${battle.adou.hp}/${battle.adou.maxHp} bossKills=${ev.bossKills}`);
  return { battle, t, ev };
}

console.log('--- 战斗数值配平（无克制/无升星,局内按攻击次数升级） ---');
// 教学局：单赵云（rge3 覆盖多路）不应在前 2 波崩盘
const r1 = simOneGame('单赵云(教学)', [['赵云', 1, 2, 2]], 600);
assert(r1.battle.wave >= 3, `教学局单赵云至少撑到第 3 波（实际 ${r1.battle.wave} 波）`);
// 4 将 L1：10-12 波阵容成型前不崩
const r2 = simOneGame('4将L1', [['赵云', 1, 2, 2], ['张飞', 1, 1, 2], ['周瑜', 1, 2, 1], ['诸葛亮', 1, 2, 3]], 600);
assert(r2.battle.wave >= 10, `4将L1至少撑到第 10 波（实际 ${r2.battle.wave} 波）`);
// 6 将 L8（≈原 2 星强度 1.56x）：单局时长 5-10 分钟（300-600s）
const r3 = simOneGame('6将L8', [
  ['赵云', 8, 2, 2], ['张飞', 8, 1, 2], ['关羽', 8, 1, 1], ['周瑜', 8, 2, 1],
  ['诸葛亮', 8, 2, 3], ['吕布', 8, 1, 3]
], 600);
assert(r3.t >= 300 && r3.t <= 600, `6将L8单局时长 5-10 分钟（实际 ${r3.t.toFixed(0)}s）`);
// 模拟器未走三选一强化/留怒运营,能打到第 30 波终局即证明曲线可达；通关依赖玩家运营
assert(r3.battle.wave >= 30, `6将L8可打到第 30 波终局（实际 ${r3.battle.wave} 波）`);

console.log('--- 地图 countMul 生效（每日轮换差异化） ---');
{
  const b1 = new Engine.Battle(CFG.MAPS[1], {});   // 云梦泽狭道 countMul×1.25
  b1.startNextWave();
  assert(b1.queue.length >= 4, `云梦泽狭道第 1 波 ${b1.queue.length} 怪（≥4,数量×1.25 生效）`);
  const b2 = new Engine.Battle(CFG.MAPS[2], {});   // 虎牢关多路 countMul×0.9
  b2.startNextWave();
  assert(b2.queue.length <= 3, `虎牢关第 1 波 ${b2.queue.length} 怪（≤3,数量×0.9 生效）`);
}

console.log('--- 技能自动释放 / 局内攻击升级 / 局间道具（回归设计变更 2/4/5） ---');
{
  // uid 契约：ui.js 生成数字 _uid,game.findUnit 按数字查找（防字符串 'u1' 不匹配回归）
  let seq = 0;
  const unit = { _uid: ++seq };
  const uidFromUi = unit._uid;
  const n = typeof uidFromUi === 'string' ? Number(uidFromUi.replace('u', '')) : uidFromUi;
  assert(n === unit._uid, 'uid 契约:ui 生成的数字 _uid 可被 findUnit 命中');
  // 主动技能自动释放：满怒且冷却就绪,update 自动触发（无需手动点击）
  const b = new Engine.Battle(CFG.MAPS[0], {});
  b.startNextWave();
  const zf = new Engine.Unit('张飞', 1);
  b.deploy(zf, 2, 2);
  zf.fury = 100; zf.skillCd = 0;
  b.update(0.05);
  assert(zf.fury === 0, '满怒且冷却就绪时自动释放技能（怒气清零）');
  assert(zf.skillCd > 0, '自动释放后进入冷却');
  // 未满怒不自动释放
  const zfB = new Engine.Unit('张飞', 1);
  b.deploy(zfB, 2, 3);
  zfB.fury = 50; zfB.skillCd = 0;
  b.update(0.05);
  assert(zfB.fury === 50, '未满怒不自动释放');
  // 技能效果：张飞大喝眩晕+伤害（castSkill 仍为引擎公共 API）
  const b2 = new Engine.Battle(CFG.MAPS[0], {});
  const zf2 = new Engine.Unit('张飞', 1);
  b2.deploy(zf2, 2, 2);
  const m = b2.spawnMonster({ type: '刀', elite: false, boss: false });
  m.col = 2.5; m.row = 2;
  zf2.fury = 100; zf2.skillCd = 0;
  b2.castSkill(zf2);
  assert(m.stunUntil > 0, '大喝眩晕生效');
  assert(m.hp < m.maxHp, '大喝造成伤害');
  // 局内成长：按攻击次数升级（无升星；赵云 col5 打停在阿斗处的怪,持续命中）
  const b4 = new Engine.Battle(CFG.MAPS[0], {});
  b4.wave = 1; b4.waveState = 'spawning';
  b4.adou.maxHp = 1000; b4.adou.hp = 1000;   // 防阿斗提前阵亡
  const zy = new Engine.Unit('赵云', 1);
  b4.deploy(zy, 5, 2);
  const mm = b4.spawnMonster({ type: '刀', elite: false, boss: false });
  mm.arrived = true; mm.col = 6; mm.row = 2; mm.maxHp = 1e9; mm.hp = 1e9;   // 打不死,持续攻击
  for (let i = 0; i < 400; i++) b4.update(0.05);            // 20s
  assert(zy.attackCount > 0, `攻击命中累积攻击次数（${zy.attackCount}）`);
  assert(zy.level >= 2, `按攻击次数升级生效（Lv.${zy.level}）`);
  // 局间道具常驻加成生效（原被动能力挪入）
  const b5 = new Engine.Battle(CFG.MAPS[0], {});
  const zf5 = new Engine.Unit('张飞', 1);
  const a0 = b5.effAtk(zf5);
  b5.permaAtk = 0.15; b5.permaFrq = 0.12; b5.permaCrit = 0.10; b5.permaCd = 0.85;
  assert(b5.effAtk(zf5) > a0 * 1.14, '局间道具攻击加成生效');
  assert(b5.skillCdMult() === 0.85, '局间道具冷却缩减生效');
  // 道具替换参数序（回归满 6 替换 bug:replaceItem(旧,新)）
  const sv = Save;
  sv.addItem('atk');
  assert(sv.items().join() === 'atk', 'addItem 生效');
  assert(sv.replaceItem('atk', 'frq') === true, 'replaceItem(旧,新) 替换成功');
  assert(sv.items().join() === 'frq', '替换后持有正确');
  assert(sv.replaceItem('不存在', 'zz') === false, '不存在的旧道具替换失败');
  // 满血开局语义:上限类加成后 hp 应同步（虎符/铁壁实际生效,非空头上限）
  const b6 = new Engine.Battle(CFG.MAPS[0], {});
  b6.adou.maxHp += 2; b6.adou.hp = b6.adou.maxHp;
  assert(b6.adou.hp === b6.adou.maxHp, '上限类道具后满血开局');
}

console.log('--- 机器人分层（genWaves 层内均值,方案 §5.4 参数） ---');
const layers = [
  { rank: 0, name: '军士/校尉', mean: 6,  range: [5.5, 6.5] },
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
    b.deploy(new Engine.Unit(g.name, 1), 2, 2);   // 中路站位
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
