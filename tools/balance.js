/* 无头平衡测试：模拟一个「还算聪明」的玩家跑完 12 小局，
   统计每小局胜率、双方存活时间、家园被打爆比例。 */
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console });
// i18n.js 必须排在 config.js 之前：config.js 在加载期就用 L() 取文案，
// 且 I18N.init() 读 navigator.language —— 无头环境没有 navigator，会自动兜底成 en，
// 这里显式给 zh，保证平衡测试的日志与人工核对时的中文口径一致。
['js/i18n.js', 'js/config.js', 'js/sim.js', 'js/bots.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));

vm.runInContext(`
function playerPlan() {
  var plan = [];
  // 第 1 小局只用裂隙侧 3×3；三格墙按中心路记录一次。
  [
    ['spike', 8, 1], ['barricade', 7, 1],
    ['turret', 6, 0], ['turret', 6, 1], ['flame', 6, 2],
  ].forEach(function (p) { plan.push({ op: 'place', type: p[0], col: p[1], lane: p[2], round: 0 }); });
  // 第 2 小局扩到 6×6，安排跨路建筑并覆盖新增区域。
  [
    ['turret', 8, 3], ['flame', 8, 4], ['lamp', 8, 5],
    ['lamp', 7, 3], ['tesla', 7, 4], ['tesla', 7, 5],
    ['lamp', 6, 3], ['tesla', 6, 4],
    ['spike', 5, 4], ['flame', 5, 0],
    ['barricade', 4, 4], ['lamp', 4, 0],
    ['turret', 3, 3], ['lamp', 3, 4], ['tesla', 3, 5],
  ].forEach(function (p) { plan.push({ op: 'place', type: p[0], col: p[1], lane: p[2], round: 1 }); });

  [
    ['barricade', 7, 1, 'ironwall'], ['barricade', 4, 4, 'thornwall'],
    ['spike', 8, 1, 'bleedteeth'], ['spike', 5, 4, 'hookspikes'],
    ['turret', 6, 0, 'armorpiercing'], ['turret', 6, 1, 'rapidbow'], ['turret', 8, 3, 'trackerbow'],
    ['lamp', 8, 5, 'widebeam'], ['lamp', 7, 3, 'sodiumflare'],
    ['lamp', 6, 3, 'stroboscope'], ['lamp', 4, 0, 'widebeam'],
    ['flame', 6, 2, 'fanfire'], ['flame', 8, 4, 'needlefire'], ['flame', 5, 0, 'emberfire'],
    ['tesla', 7, 4, 'topology'], ['tesla', 6, 4, 'lightningspear'], ['tesla', 3, 5, 'pulsecoil'],
  ].forEach(function (row) {
    plan.push({ op: 'up', type: row[0], col: row[1], lane: row[2], to: 2, form: row[3] });
  });
  plan.filter(function (p) { return p.op === 'up'; }).forEach(function (p) {
    plan.push({ op: 'up', type: p.type, col: p.col, lane: p.lane, to: 3 });
  });
  return plan;
}
var currentRound = 0;
function spend(grid, occupied, plan, idx, budget) {
  var guard = 0;
  while (idx < plan.length && guard++ < 40) {
    var p = plan[idx];
    if (p.op === 'place') {
      if (p.round > currentRound) break;
      if (!isColUnlocked(currentRound, p.col) || !isLaneUnlocked(currentRound, p.lane)) { idx++; continue; }
      var center = unitAnchorLane(p.type, p.lane, unlockedLaneCount(currentRound));
      var rows = unitFootprintLanes(p.type, center), blocked = center < 0;
      for (var ri = 0; ri < rows.length; ri++) {
        if (!isLaneUnlocked(currentRound, rows[ri]) || occupied[p.col + ',' + rows[ri]]) { blocked = true; break; }
      }
      if (blocked) { idx++; continue; }
      var cost = UNITS[p.type].cost;
      if (cost > budget) break;
      var unit = { type: p.type, col: p.col, lane: center, lv: 1, form: null };
      budget -= cost; grid[p.col + '|' + center] = unit;
      for (var ri2 = 0; ri2 < rows.length; ri2++) occupied[p.col + ',' + rows[ri2]] = true;
      idx++;
    } else {
      var cur = gridUnitAt(grid, p.col, p.lane);
      if (!cur || cur.lv >= p.to) { idx++; continue; }
      var c2 = upgradeCost(cur.type, cur.lv);
      if (c2 > budget) break;
      budget -= c2;
      if (cur.lv === 1 && !cur.form && p.form) cur.form = p.form;
      cur.lv++;
      idx++;
    }
  }
  return { idx: idx, budget: budget };
}
function runPlayer(seed, trials) {
  var rows = [];
  var rnd = mulberry32(seed);
  var grid = {}, occupied = {}, plan = playerPlan(), idx = 0, coins = CONFIG.START_COINS, relics = [];
  var wins = 0;
  for (var r = 0; r < CONFIG.TOTAL_ROUNDS; r++) {
    currentRound = r;
    var s = spend(grid, occupied, plan, idx, coins); idx = s.idx; coins = s.budget;
    var build = []; for (var k in grid) build.push(grid[k]);
    var bot = makeBot(r, seed + r, TEST_PRESSURE);
    var agg = { pWin: 0, gWin: 0, draw: 0, pTime: 0, gTime: 0, pDead: 0, gDead: 0, pTimeout: 0, pEndHp: 0, gap: 0 };
    for (var i = 0; i < trials; i++) {
      var b = new Battle({
        roundIndex: r, pressure: TEST_PRESSURE, playerBuild: build, ghostBuild: bot.build,
        playerMods: combineMods(relics), ghostMods: bot.mods, seed: 1000 + i * 977 + r * 31,
      });
      b.runToEnd(1 / 30);
      var res = b.decide(1 / 30);
      agg[res.winner === 'p' ? 'pWin' : res.winner === 'g' ? 'gWin' : 'draw']++;
      agg.pTime += res.playerTime; agg.gTime += res.ghostTime;
      if (b.dead.p !== null) agg.pDead++; if (b.dead.g !== null) agg.gDead++;
      agg.gap += res.playerTime - res.ghostTime;
      if (res.timeout) agg.pTimeout++;
      agg.pEndHp += res.playerHpFrac;
    }
    var won = agg.pWin > agg.gWin;
    if (won) wins++;
    rows.push({
      r: r, bot: bot.name, tag: bot.tag, units: build.length, botUnits: bot.build.length,
      coins: coins, win: (agg.pWin / trials * 100), pT: agg.pTime / trials, gT: agg.gTime / trials,
      pDead: agg.pDead / trials * 100, endHp: agg.pEndHp / trials * 100, gap: agg.gap / trials,
    });
    coins += incomeFor(r, won, relics);
    var pool = RELICS.filter(function (x) { return true; });
    relics.push(pool[(rnd() * pool.length) | 0]);
  }
  return { rows: rows, wins: wins };
}
globalThis.__run = runPlayer;
var TEST_PRESSURE = 1;
`, ctx);

ctx.__setSlope = v => vm.runInContext('BOT_SKILL_SLOPE = ' + v, ctx);
ctx.__setPressure = v => vm.runInContext('TEST_PRESSURE = ' + v, ctx);
ctx.__setSlope(parseFloat(process.argv[4] || '0.5'));
ctx.__setPressure(parseFloat(process.argv[5] || '1'));

const trials = parseInt(process.argv[2] || '120', 10);
const seeds = parseInt(process.argv[3] || '24', 10);
const totals = [];
for (let s = 0; s < seeds; s++) totals.push(ctx.__run(100 + s * 37, trials));
ctx.__run(100, trials);

console.log('小局  镜像              流派    我单位 敌单位  胜率   我坚持  敌坚持  时长差  我爆家');
console.log('─'.repeat(92));
for (let r = 0; r < ctx.CONFIG.TOTAL_ROUNDS; r++) {
  const acc = { win: 0, pT: 0, gT: 0, pDead: 0, endHp: 0, units: 0, botUnits: 0, tag: '', nm: '', gap: 0 };
  for (const t of totals) {
    const row = t.rows[r];
    acc.win += row.win; acc.pT += row.pT; acc.gT += row.gT;
    acc.pDead += row.pDead; acc.endHp += row.endHp; acc.gap += row.gap;
    acc.units += row.units; acc.botUnits += row.botUnits; acc.tag = row.tag; acc.nm = row.bot;
  }
  const n = totals.length;
  console.log(
    (r + 1).toString().padStart(3) + '   ' +
    acc.nm.slice(0, 16).padEnd(18) +
    acc.tag.padEnd(7) +
    (acc.units / n).toFixed(1).padStart(5) + ' ' +
    (acc.botUnits / n).toFixed(1).padStart(6) + ' ' +
    (acc.win / n).toFixed(0).padStart(4) + '%' +
    (acc.pT / n).toFixed(1).padStart(8) + 's' +
    (acc.gT / n).toFixed(1).padStart(7) + 's' +
    (acc.gap / n).toFixed(1).padStart(7) + 's' +
    (acc.pDead / n).toFixed(0).padStart(6) + '%');
}
const avgWins = totals.reduce((a, t) => a + t.wins, 0) / totals.length;
console.log('─'.repeat(92));
console.log('平均每大局胜场: ' + avgWins.toFixed(2) + ' / ' + ctx.CONFIG.TOTAL_ROUNDS +
  '  (胜率 ' + (avgWins / ctx.CONFIG.TOTAL_ROUNDS * 100).toFixed(1) + '%)');
