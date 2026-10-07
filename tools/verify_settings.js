'use strict';
// One browser, isolated save fixtures, deterministic game clock, no API traffic.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'output/playwright/settings');
const report = { checks: [], saves: [], layouts: [], errors: [] };
function check(ok, label) { assert(ok, label); report.checks.push(label); }
async function advance(page, frames = 4) {
  await page.evaluate(frames => { for (let i = 0; i < frames; i++) __advance(1 / 60); UI.syncAll(); }, frames);
}
async function fresh(browser, fixture = {}, reducedMotion = 'no-preference') {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 720 }, reducedMotion });
  await ctx.route(/^https?:/, route => route.abort());
  await ctx.addInitScript(fixture => {
    if (!sessionStorage.getItem('settings-fixture-initialized')) {
      localStorage.setItem('yeshou.save.v1', JSON.stringify(Object.assign({ rank: 802, name: '设置回归伙伴', muted: true, tutorialDone: true }, fixture)));
      sessionStorage.setItem('settings-fixture-initialized', 'true');
    }
    let time = 0, queue = [], seed = 20261007;
    requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
    performance.now = () => time;
    Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    window.__advance = dt => { time += dt * 1000; const callbacks = queue; queue = []; callbacks.forEach(callback => callback(time)); };
  }, fixture);
  const page = await ctx.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForSelector('#settingsBtn');
  await advance(page);
  return { ctx, page };
}
async function click(page, selector) { await page.locator(selector).click(); await advance(page); }
async function readPreferences(page) {
  return page.evaluate(() => ({
    rank: Game.save.rank, name: Game.save.name, largeText: Game.save.largeText,
    reducedMotion: Game.save.reducedMotion, soundVolume: Game.save.soundVolume, muted: Game.save.muted,
    storage: JSON.parse(localStorage.getItem(SAVE_KEY)),
    textSize: UI.el.stage.getAttribute('data-text-size'), motion: UI.el.stage.getAttribute('data-reduced-motion'),
    gain: Sfx.master ? Sfx.master.gain.value : null, audioVolume: Sfx.volume, audioEnabled: Sfx.enabled,
  }));
}
async function screenshot(page, name) { await page.screenshot({ path: path.join(OUT, name + '.png') }); }
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const fixtures = [
      { label: 'legacy save', save: {}, expected: [false, false, 1] },
      { label: 'invalid boolean and volume types', save: { largeText: 'true', reducedMotion: 1, soundVolume: '0.4' }, expected: [false, false, 1] },
      { label: 'null preferences', save: { largeText: null, reducedMotion: null, soundVolume: null }, expected: [false, false, 1] },
      { label: 'volume above maximum', save: { soundVolume: 3 }, expected: [false, false, 1] },
      { label: 'volume below minimum', save: { soundVolume: -3 }, expected: [false, false, 0] },
      { label: 'valid saved preferences', save: { largeText: true, reducedMotion: true, soundVolume: 0.37 }, expected: [true, true, 0.37] },
    ];
    for (const fixture of fixtures) {
      const { ctx, page } = await fresh(browser, fixture.save);
      const preferences = await readPreferences(page);
      check(JSON.stringify([preferences.largeText, preferences.reducedMotion, preferences.soundVolume]) === JSON.stringify(fixture.expected), fixture.label + ': defaults and clamps apply');
      check(preferences.rank === 802 && preferences.name === '设置回归伙伴', fixture.label + ': player identity and rank survive');
      check(preferences.audioVolume === fixture.expected[2] && !preferences.audioEnabled, fixture.label + ': loaded audio settings apply independently');
      report.saves.push({ label: fixture.label, preferences });
      await ctx.close();
    }

    const { ctx, page } = await fresh(browser);
    await click(page, '#settingsBtn');
    check(await page.evaluate(() => ['largeTextSetting', 'reducedMotionSetting', 'soundEnabledSetting'].every(id => {
      const input = document.getElementById(id); return input.type === 'checkbox' && !!input.closest('label');
    }) && document.getElementById('soundVolumeSetting').type === 'range'), 'settings use labelled native checkboxes and a native range');
    const originalGeometry = await page.evaluate(() => ({ scale: UI.scale, x: UI.offX, y: UI.offY }));
    await page.locator('#largeTextSetting').check();
    await page.locator('#reducedMotionSetting').check();
    let preferences = await readPreferences(page);
    check(preferences.storage.largeText && preferences.storage.reducedMotion && preferences.textSize === 'large' && preferences.motion === 'true', 'checkbox changes immediately persist and apply');
    const geometryAfter = await page.evaluate(() => { UI.fit(); return { scale: UI.scale, x: UI.offX, y: UI.offY, text: UI.el.stage.dataset.textSize }; });
    check(geometryAfter.scale === originalGeometry.scale && geometryAfter.x === originalGeometry.x && geometryAfter.y === originalGeometry.y && geometryAfter.text === 'large', 'large text survives fit without changing battlefield geometry');
    await page.locator('#soundVolumeSetting').focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < 37; i++) await page.keyboard.press('ArrowRight');
    preferences = await readPreferences(page);
    check(preferences.soundVolume === 0.37 && preferences.storage.soundVolume === 0.37 && preferences.audioVolume === 0.37, 'native range keyboard changes immediately save the volume');
    check(preferences.muted && !preferences.audioEnabled && preferences.gain === 0, 'changing volume does not silently unmute audio');
    check(await page.locator('#soundVolumeValue').textContent() === '37%', 'range displays the matching percentage');
    await page.locator('#soundEnabledSetting').check();
    preferences = await readPreferences(page);
    check(!preferences.muted && !preferences.storage.muted && preferences.audioEnabled && Math.abs(preferences.gain - 0.185) < 0.000001, 'unmuting applies the saved volume to the master gain');
    await page.locator('#soundEnabledSetting').uncheck();
    preferences = await readPreferences(page);
    check(preferences.muted && preferences.gain === 0 && preferences.soundVolume === 0.37, 'muting silences the gain while preserving volume');
    await page.locator('#soundEnabledSetting').check();
    await page.locator('#largeTextSetting').focus();
    await page.keyboard.press('Shift+Tab');
    check(await page.evaluate(() => document.activeElement.id === 'settingsBackBtn'), 'settings backward Tab wraps to return');
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.activeElement.id === 'largeTextSetting'), 'settings forward Tab wraps to first native control');
    await screenshot(page, 'settings-desktop-large');
    await click(page, '#settingsBackBtn');
    check(await page.evaluate(() => UI.overlayMode === 'menu' && document.activeElement.id === 'settingsBtn'), 'return restores the menu and settings button focus');
    await page.reload(); await page.waitForSelector('#settingsBtn'); await advance(page);
    preferences = await readPreferences(page);
    check(preferences.largeText && preferences.reducedMotion && preferences.soundVolume === 0.37 && !preferences.muted && preferences.textSize === 'large', 'reload retains all saved preferences and applies large text');
    await click(page, '#settingsBtn');
    check(await page.evaluate(() => ['largeTextSetting', 'reducedMotionSetting', 'soundEnabledSetting'].every(id => document.getElementById(id).checked) && document.getElementById('soundVolumeSetting').value === '37'), 'reopened native settings reflect saved preferences');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => UI.fit());
    const layout = await page.evaluate(() => {
      const rect = document.querySelector('.settings').getBoundingClientRect();
      const button = document.getElementById('settingsBackBtn').getBoundingClientRect();
      const body = document.querySelector('.settingsScroll');
      return { boxInside: rect.x >= -1 && rect.y >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        returnInside: button.x >= -1 && button.y >= -1 && button.right <= innerWidth + 1 && button.bottom <= innerHeight + 1,
        noHorizontalOverflow: body.scrollWidth <= body.clientWidth + 1, textSize: UI.el.stage.dataset.textSize };
    });
    check(layout.boxInside && layout.returnInside && layout.noHorizontalOverflow && layout.textSize === 'large', 'phone large-text settings and fixed return button fit rotated stage');
    report.layouts.push(layout); await screenshot(page, 'settings-phone-large');
    await click(page, '#settingsBackBtn');
    await page.setViewportSize({ width: 1280, height: 720 }); await page.evaluate(() => UI.fit());
    await click(page, '#playBtn'); await click(page, '#loadoutConfirm'); await click(page, '#startBtn'); await advance(page, 120);
    check(await page.evaluate(() => Game.state === 'battle'), 'settings regression enters a real battle');
    await click(page, '#pauseBtn'); await click(page, '#pauseSettingsBtn');
    const pausedAt = await page.evaluate(() => Game.battle.t);
    await advance(page, 180);
    check(await page.evaluate(time => Game.paused && Game.battle.t === time && UI.overlayMode === 'settings', pausedAt), 'pause settings never advance combat');
    await page.locator('#settingsBackBtn').focus(); await page.keyboard.press('p'); await advance(page, 60);
    check(await page.evaluate(time => Game.paused && Game.battle.t === time && UI.overlayMode === 'settings', pausedAt), 'P inside settings does not cancel pause');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => Game.paused && UI.overlayMode === 'pause' && document.activeElement.id === 'pauseSettingsBtn'), 'Escape restores the paused dialog and settings entry focus');
    await click(page, '#resumeBtn'); await advance(page, 60);
    check(await page.evaluate(time => !Game.paused && Game.battle.t > time, pausedAt), 'only resume advances combat again');
    await ctx.close();

    const { ctx: systemCtx, page: systemPage } = await fresh(browser, { reducedMotion: false }, 'reduce');
    await click(systemPage, '#settingsBtn');
    check(await systemPage.evaluate(() => {
      const checkbox = document.getElementById('reducedMotionSetting');
      return checkbox.checked && checkbox.disabled && checkbox.closest('label').textContent.includes(L('friendly.systemMotion')) && UI.motionReduced() && UI.el.stage.dataset.reducedMotion === 'true';
    }), 'system Reduce Motion forces a checked disabled control with explanation');
    await systemPage.evaluate(() => { Render.shake = 12; Render.flash = 0.8; Render.glitch = 1; Render.damageFlash.p = 1; Render.damageFlash.g = 1; });
    await advance(systemPage, 6);
    check(await systemPage.evaluate(() => Render.shake === 0 && Render.sx === 0 && Render.sy === 0 && Render.flash === 0 && Render.glitch === 0 && Render.damageFlash.p === 0 && Render.damageFlash.g === 0), 'system reduction suppresses actual shake, full-screen flashes and glitch');
    check(await systemPage.evaluate(() => getComputedStyle(document.getElementById('settingsBackBtn')).transitionDuration.split(',').every(value => parseFloat(value) === 0)), 'system reduction suppresses interface transitions');
    await systemCtx.close();
    check(report.errors.length === 0, 'no JavaScript page errors');
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, null, 2));
    console.log('PASS: ' + report.checks.length + ' settings checks, ' + report.saves.length + ' save fixtures');
  } finally { await browser.close(); }
}
main().catch(error => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'partial.json'), JSON.stringify(report, null, 2));
  console.error(error); process.exitCode = 1;
});
