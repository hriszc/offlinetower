'use strict';

// Real combat events + affine foot anchoring; --preview renders the actual atlas once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/playwright/animal-motion');
const scope = vm.createContext({ console });
for (const file of ['i18n', 'config', 'sim', 'render']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, `js/${file}.js`), 'utf8'), scope,
    { filename: `js/${file}.js` });
}
let count = 0;
const check = (ok, message) => { assert(ok, message); count++; };
const near = (a, b) => Math.abs(a - b) < 1e-8;
const { Battle, defaultMods, makeZombie, UNITS, Render } = scope;
function fixture(type, side = 'p') {
  const b = new Battle({ roundIndex: 3, seed: 1007, playerBuild: [], ghostBuild: [],
    playerMods: defaultMods(), ghostMods: defaultMods() });
  b.addUnit(side, { type, col: 3, lane: 4 });
  const u = b.units[0];
  u.cd = 0;
  const z = makeZombie(side, 4, 'tank', u.x + (side === 'p' ? 1 : -1) * 18, b.wave, () => .5);
  z.hp = z.maxHp = 100000;
  b.zombies.push(z); b.rebuildBuckets();
  return { b, u, z };
}

// Capture the drawImage transform, rather than duplicating the pose implementation.
function canvas() {
  let matrix = [1, 0, 0, 1, 0, 0], stack = [];
  const images = [];
  function multiply(n) {
    const [a,b,c,d,e,f] = matrix, [A,B,C,D,E,F] = n;
    matrix = [a*A+c*B,b*A+d*B,a*C+c*D,b*C+d*D,a*E+c*F+e,b*E+d*F+f];
  }
  const api = { images, globalAlpha: 1,
    save() { stack.push(matrix.slice()); }, restore() { matrix = stack.pop(); },
    translate(x,y) { multiply([1,0,0,1,x,y]); },
    scale(x,y) { multiply([x,0,0,y,0,0]); }, transform(...n) { multiply(n); },
    drawImage() { images.push(matrix.slice()); } };
  return new Proxy(api, { get: (object, key) => key in object ? object[key] : () => {} });
}
Render.animalArtSprite = () => ({ img: {} });
const types = Object.keys(UNITS).filter(type => UNITS[type].animal);
check(types.length === 22, 'all 22 animal species are covered');
for (const type of types) for (const side of ['p', 'g']) {
  const { b, u, z } = fixture(type, side), d = UNITS[type];
  check(u.hurtT === 0, `${type}/${side}: new units have no stale hurt timer`);
  b.updateUnits(1/60);
  if (d.behavior === 'contact') b.updateZombies(1/60);
  check(d.behavior === 'block' ? u.actT === 0 : u.actT > 0,
    `${type}/${side}: real target triggers only the appropriate attack behavior`);
  if (d.behavior === 'shot') check(b.shots.length > 0, `${type}: attack produces an actual shot`);
  if (d.behavior !== 'shot' && d.behavior !== 'block') {
    check(z.hp < z.maxHp, `${type}: attack deals real damage`);
  }
  const hp = u.hp;
  b.beginZombieAttack(z, 'unit', u); b.resolveZombieAttack(z);
  check(u.hp < hp && near(u.hurtT, .28), `${type}/${side}: real enemy hit starts hurt animation`);
  const pose = Render.animalPose(u, .17, d);
  check(pose.hit === 1 && (pose.sx !== 1 || pose.sy !== 1 || pose.lean !== 0),
    `${type}/${side}: hurt is visibly distinct from idle`);
  for (const state of [{ actT: .3, pulse: .2, hurtT: 0 }, { actT: 0, pulse: 0, hurtT: .28 }]) {
    const copy = Object.assign({}, u, state), ctx = canvas(), face = side === 'p' ? 1 : -1;
    Render.drawAnimalUnit(ctx, copy, .17, 48, d, null, face);
    check(ctx.images.length === scope.unitFootprintLanes(type, 4).length,
      `${type}/${side}: every footprint is drawn`);
    ctx.images.forEach((m, index) => {
      const y = m[1]*15 + m[3]*33 + m[5];
      const expected = (scope.unitFootprintLanes(type, 4)[index]-4) *
        scope.CONFIG.GRID_LANE_PITCH/scope.CONFIG.UNIT_DRAW_SCALE + 33;
      check(near(y, expected), `${type}/${side}: attacking/hurt feet stay grounded`);
      check(Math.sign(m[0]) === face, `${type}/${side}: pose retains target-facing mirror`);
    });
  }
  for (const mode of ['thumbnail', 'reduce']) {
    Render.reduceAnimalMotion = mode === 'reduce';
    const copy = Object.assign({}, u, { thumbnail: mode === 'thumbnail' });
    const p = Render.animalPose(copy, .17, d);
    check(p.sx === 1 && p.sy === 1 && p.lean === 0, `${type}: ${mode} remains static`);
    if (mode === 'thumbnail') check(p.hit === 0 && p.attack === 0, `${type}: thumbnail hides combat cues`);
    Render.reduceAnimalMotion = false;
  }
  b.zombies = []; b.rebuildBuckets(); b.updateUnits(.5);
  const recovered = Render.animalPose(u, 1, d);
  check(u.hurtT === 0 && recovered.hit === 0 && recovered.attack === 0,
    `${type}/${side}: combat timers recover to idle`);
}
for (const type of types.filter(type => UNITS[type].behavior === 'healer')) {
  const { b, u } = fixture(type);
  b.zombies = []; b.addUnit('p', { type: 'turret', col: 3, lane: 4 });
  const ally = b.units[1]; ally.hp -= 15; b.rebuildBuckets();
  const hp = ally.hp; b.updateUnits(1/60);
  check(ally.hp > hp && ally.flash > 0, `${type}: genuine healing produces healing flash`);
  check(ally.hurtT === 0 && Render.animalPose(ally, .1, UNITS.turret).hit === 0,
    `${type}: healing does not impersonate enemy damage`);
  check(u.actT > 0, `${type}: healer receives its own gentle action cue`);
}
{
  const { b, u } = fixture('barricade');
  const z = makeZombie('p', 4, 'screamer', u.x, b.wave, () => .5);
  b.zombies = [z]; b.rebuildBuckets(); const hp = u.hp;
  b.damageZombie(z, z.hp + 1);
  check(u.hp === hp - scope.ZOMBIES.screamer.boom && near(u.hurtT, .28),
    'actual explosion triggers one damage/hurt event for a three-row animal');
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ passed: count, species: types.length }, null, 2));
console.log(`PASS: ${count} checks, ${types.length} species, actual attacks/hits/heals, grounded mirror poses, motion settings`);

async function preview() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
    '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 670 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => window.Render && Render.animalAtlas &&
      Render.animalAtlas.complete && Render.animalAtlas.naturalWidth > 0);
    await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 1000; c.height = 670;
      c.style.cssText = 'position:fixed;inset:0;z-index:99999;width:1000px;height:670px';
      document.body.appendChild(c); const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff8e8'; ctx.fillRect(0,0,1000,670);
      ctx.fillStyle = '#294553'; ctx.font = 'bold 27px sans-serif';
      ctx.fillText('动物动作 · 真实游戏插画', 30, 42);
      ctx.font = '18px sans-serif'; ctx.fillText('静止',240,78); ctx.fillText('进攻',490,78); ctx.fillText('受击',740,78);
      const rows = ['turret','flame','tesla','quake'];
      Render.reduceAnimalMotion = false;
      rows.forEach((type, row) => {
        const d = UNITS[type], y = 185 + row*143;
        ctx.fillStyle = '#294553'; ctx.font = '18px sans-serif'; ctx.fillText(d.name,25,y-10);
        [0,1,2].forEach((state,col) => {
          ctx.save(); ctx.translate(265+col*250,y);
          ctx.strokeStyle = '#b0bb82'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-90,33); ctx.lineTo(90,33); ctx.stroke();
          const u = { type, lane: 4, id: 1, side: 'p', actT: state===1?.3:0,
            pulse: state===1?.2:0, hurtT: state===2?.28:0 };
          Render.drawAnimalUnit(ctx,u,.17,48,d,null,1); ctx.restore();
        });
      });
    });
    await page.screenshot({ path: path.join(OUT, 'animal-actions.jpg'), type: 'jpeg', quality: 88 });
    assert.deepEqual(errors, [], 'preview has no browser exceptions');
    console.log('PREVIEW: ' + path.join(OUT, 'animal-actions.jpg'));
  } finally { await browser.close(); }
}
if (process.argv.includes('--preview')) preview().catch(error => { console.error(error); process.exitCode = 1; });
