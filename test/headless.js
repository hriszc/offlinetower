// 临时无头测试：验证引擎核心循环与数值平衡
global.window = global;
require('../js/config.js');
require('../js/rand.js');
require('../js/engine.js');
require('../js/bot.js');
require('../js/save.js');

const CFG = global.CFG;
const Engine = global.Engine;
const Bot = global.Bot;
const Save = global.Save;

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
    // 随机放技能,模拟玩家
    if (battle.units.length && Math.random() < 0.01) {
      const u = battle.units[Math.floor(Math.random() * battle.units.length)];
      battle.castSkill(u);
    }
  }
  console.log(`[${name}] over=${battle.over} result=${battle.result} wave=${battle.wave} time=${t.toFixed(0)}s ` +
    `kills=${ev.kills} adouHits=${ev.adouHits} adouHP=${battle.adou.hp}/${battle.adou.maxHp} bossKills=${ev.bossKills}`);
  return battle;
}

// 用例1：单赵云（教学局）
simOneGame('单赵云', [['赵云', 1, 2, 2]], 600);
// 用例2：4 将 1 星（无升星）
simOneGame('4将1星', [['赵云', 1, 2, 2], ['张飞', 1, 1, 2], ['周瑜', 1, 2, 1], ['诸葛亮', 1, 2, 3]], 600);
// 用例3：6 将 2 星（成型）
simOneGame('6将2星', [
  ['赵云', 2, 2, 2], ['张飞', 2, 1, 2], ['关羽', 2, 1, 1], ['周瑜', 2, 2, 1],
  ['诸葛亮', 2, 2, 3], ['吕布', 2, 1, 3]
], 600);
// 用例4：6 将 5 星（满配）
simOneGame('6将5星', [
  ['赵云', 5, 2, 2], ['张飞', 5, 1, 2], ['关羽', 5, 1, 1], ['周瑜', 5, 2, 1],
  ['诸葛亮', 5, 2, 3], ['吕布', 5, 1, 3]
], 600);

// 机器人分层抽样
console.log('\n--- 机器人分层抽样(各 8 个) ---');
for (const ri of [0, 3, 6, 10]) {
  const ws = [];
  for (let i = 0; i < 8; i++) ws.push(Bot.makeOpponent(ri).waves);
  console.log(`玩家军衔idx=${ri}(${CFG.RANKS[ri].name}) → 对手波数: ${ws.join(',')}`);
}

// 存档军衔
Save.load();
console.log('\n存档军衔:', Save.rank().name, '积分:', Save.load().score);
console.log('今日地图:', Save.mapOfToday().name);
console.log('体力:', Save.stamina(), '广告剩余:', Save.adsLeft());
