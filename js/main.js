'use strict';

/* ---------------------------------------------------------------
 * 启动 + 主循环
 * ------------------------------------------------------------- */
(function () {
  var acc = 0, last = 0, soundBudget = 0;
  var ftAcc = 0, ftN = 0;
  /* 菜单 / 备战期画面只是雾气和尘埃在飘，锁 30fps 就够看，
     省下的每一帧都是手机的发热。战斗期不锁帧。 */
  var IDLE_STEP = 1 / 32;
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function audioFor(e, budgetLeft) {
    switch (e.t) {
      case 'zattack': Sfx.growl(e.type); return 2;
      case 'homeHit': Sfx.bite(); Sfx.homeHit(); return 3;
      case 'hitUnit': Sfx.bite(); return 1;
      case 'pulse': Sfx.pulse(); Sfx.warning(); return 4;
      case 'boom': Sfx.boom(); return 2;
      case 'arc': Sfx.zap(); return 1;
      case 'zdeath':
        if (e.type === 'brute' || e.type === 'tank') Sfx.bigdie(); else Sfx.zdie();
        return 1;
      case 'shot': Sfx.shot(); return 1;
      case 'flame': Sfx.flame(); return 1;
      case 'quake': Sfx.boom(); return 2;
      case 'splash': Sfx.boom(); return 2;
      case 'heal': Sfx.repair(); return 1;
      case 'unitDead': Sfx.unitDie(); return 2;
      case 'spawn': Sfx.spawn(); return 0;
      default: return 0;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    var raw = (now - last) / 1000;
    var inBattle = !Game.paused && (Game.state === 'battle' || Game.state === 'coopReplay' || !!Game.matchmaking);
    if (!inBattle && raw < IDLE_STEP) return;
    var dt = Math.min(0.05, raw);
    last = now;

    Game.update(dt);

    if (Game.battle) {
      var fx = Game.battle.drainFx();
      soundBudget = 5;
      for (var i = 0; i < fx.length; i++) {
        Render.handleFx(fx[i]);
        if (soundBudget > 0) {
          var cost = audioFor(fx[i], soundBudget);
          if (cost > 0) soundBudget -= cost;
        }
      }
    }

    if (Game.save.reducedMotion || (reduceMotion && reduceMotion.matches)) {
      Render.shake = 0; Render.flash = 0; Render.glitch = 0;
      Render.damageFlash.p = 0; Render.damageFlash.g = 0;
    }
    Render.draw({
      battle: Game.battle,
      buildPhase: Game.state === 'build',
      roundIndex: Game.roundIndex,
      hoverCell: Game.hoverCell,
      armedType: Game.armedType,
      selectedCell: Game.selectedCell,
      playerMods: Game.playerMods(),
      coins: Game.coins,
      tutorialActive: Game.tutorialActive,
      tutorialStep: Game.tutorialStep,
      tutorialTarget: Game.tutorialTarget,
      coopMode: Game.coopMode,
      coopSeat: Game.coopSeat,
      coopSide: Game.coopSide,
      coopHomes: Game.coopHomes,
      coopReplay: Game.state === 'coopReplay',
      pendingPlacement: Game.pendingPlacement,
      flareTarget: UI.flareArmed ? UI.flareTarget : null,
    }, Game.paused ? 0 : dt);

    acc += dt;
    if (acc > 0.06) { acc = 0; if (Game.state !== 'menu') UI.syncAll(); }

    // 实测帧间隔：持续掉到 50fps 以下就降画质档位
    if (inBattle) {
      ftAcc += raw * 1000; ftN++;
      if (ftN >= 120) { Render.adaptQuality(ftAcc / ftN); ftAcc = 0; ftN = 0; }
    }
  }

  function boot() {
    Render.init(document.getElementById('game'));
    UI.init();
    Game.load();
    UI.applyPreferences();
    Monetize.init();
    UI.showMenu();
    window.render_game_to_text = function () {
      return JSON.stringify({ state: Game.state, paused: Game.paused,
        coordinates: '1280x720, origin top-left, x right, y down; lanes/columns indexed from 0',
        round: Game.roundIndex + 1, coins: Game.coins, tutorialStep: Game.tutorialStep,
        armedType: Game.armedType, selectedCell: Game.selectedCell, units: Game.playerBuild(),
        home: Game.battle ? Game.battle.hp : null, flare: Game.flare, repair: Game.repair,
        canResume: Game.canResume(), overlay: UI.overlayMode,
        zombies: Game.battle ? Game.battle.zombies.filter(function (z) { return !z.dead; }).map(function (z) {
          return { side: z.side, lane: z.lane, type: z.type, x: Math.round(z.x), y: Math.round(z.y), hp: z.hp };
        }) : [] });
    };
    if (window.Coop) Coop.openInviteFromUrl();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 0);
  else document.addEventListener('DOMContentLoaded', boot);
})();
