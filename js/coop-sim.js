'use strict';

/*
 * Deterministic, server-authoritative co-op round resolver.
 * This file is deliberately classic-script/CommonJS compatible so the exact
 * same version runs in H5/iOS playback and the Cloudflare Worker.
 */
(function (root, factory) {
  var gameSim = root;
  if (typeof module !== 'undefined' && module.exports) gameSim = require('./sim.js');
  var api = factory(gameSim);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CoopSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (gameSim) {
  var COMBAT = (gameSim && gameSim.config) || gameSim || {};
  var GAME_UNITS = COMBAT.UNITS || {};
  var UNIT_POWER = {
    barricade: 0.06, spike: 0.42, turret: 1.08, lamp: 0.34,
    flame: 1.38, tesla: 1.32, sniper: 0.92, venom: 1.02,
    frost: 0.44, quake: 0.82, railgun: 1.4, totem: 0.58,
    wolf: 1.20, owl: 1.12, boar: 0.92, chameleon: 1.08, elephant: 0.42,
    frog: 1.30, bee: 1.26, turtle: 0.48, tiger: 1.46, phoenix: 0.94,
  };
  var UNIT_HP = {
    barricade: 175, spike: 62, turret: 82, lamp: 74, flame: 74,
    tesla: 68, sniper: 65, venom: 78, frost: 72, quake: 85,
    railgun: 60, totem: 90, wolf: 92, owl: 70, boar: 168,
    chameleon: 88, elephant: 315, frog: 94, bee: 108, turtle: 235,
    tiger: 124, phoenix: 138,
  };
  var FORM_HP = {
    ironwall: [1, 1.28, 1.45], thornwall: [1, 1.08, 1.18],
    gatewall: [1, 1.16, 1.30], bleedteeth: [1, 0.90, 0.95],
    sturdy: [1, 1.25, 1.45],
  };
  var FORM_POWER = {
    fierce: [1, 1.25, 1.50], swift: [1, 1.25, 1.45],
  };
  var FORM_SPIKE_RETAL = {
    bleedteeth: [1, 1.45, 1.70], hookspikes: [1, 0.90, 1],
    phosphorspikes: [1, 1, 1.10],
  };
  var ZOMBIES = {
    bug: { hp: 8, speed: 42, radius: 9, dmg: 1, rate: 0.9 },
    walker: { hp: 34, speed: 26, radius: 17, dmg: 3, rate: 1.1 },
    runner: { hp: 22, speed: 64, radius: 14, dmg: 2, rate: 0.7 },
    brute: { hp: 155, speed: 19, radius: 27, dmg: 9, rate: 1.6 },
    tank: { hp: 330, speed: 13, radius: 33, dmg: 15, rate: 2.0 },
  };
  var PLAYER_HOME_X = 152;
  var PLAYER_RIFT_X = 640;
  var PLAYER_COL_START_X = 190;
  var PLAYER_COL_PITCH = 42;
  var UNIT_CONTACT_PAD = 17;
  var FOOTPRINT = { barricade: 3, spike: 3, elephant: 3 };
  var RELIC = {
    foundation: 'hp', gears: 'rate', steel: 'hp', powder: 'damage',
    satchel: 'income', lore: 'slow', spares: 'hp', doublebow: 'damage',
    coldlight: 'slow', fuse: 'damage', overload: 'damage', ration: 'income',
  };
  var RELIC_IDS = Object.keys(RELIC);
  var MAX_ROUNDS = 12;
  var HOME_HP = 100;
  var REPAIR_CHARGES = 2;
  var FLARE_CHARGES = 3;

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rankPressure(score) {
    var s = Math.max(0, Math.min(50000, Number(score) || 0));
    var ranks = [
      [0, 1], [350, 1.04], [800, 1.09], [1350, 1.14],
      [2000, 1.2], [2800, 1.27],
    ];
    for (var i = ranks.length - 1; i >= 0; i--) {
      if (s < ranks[i][0]) continue;
      if (i === ranks.length - 1) return ranks[i][1];
      var next = ranks[i + 1], span = next[0] - ranks[i][0];
      return ranks[i][1] + (next[1] - ranks[i][1]) * ((s - ranks[i][0]) / span);
    }
    return 1;
  }

  function relicFlags(ids) {
    var out = { hp: 0, unitHp: 1, rate: 1, damage: 1, spike: 1, slow: 0, repair: 0, extra: 0, income: 0 };
    (ids || []).forEach(function (id) {
      if (!RELIC[id]) return;
      if (id === 'foundation') out.hp += 35;
      else if (id === 'gears') out.rate *= 1.18;
      else if (id === 'steel') out.unitHp *= 1.28;
      else if (id === 'powder') out.damage *= 1.22;
      else if (id === 'satchel') out.income += 30;
      else if (id === 'lore' || id === 'coldlight') out.slow += 0.12;
      else if (id === 'spares') out.hp += 25;
      else if (id === 'fuse') out.spike *= 1.65;
      else if (id === 'doublebow' || id === 'overload') out.damage *= 1.12;
      else if (id === 'ration') out.income += 15;
    });
    return out;
  }

  function safeBuild(build) {
    return (Array.isArray(build) ? build : []).filter(function (u) {
      return u && GAME_UNITS[u.type] &&
        Number.isInteger(u.col) && u.col >= 0 && u.col < 9 &&
        Number.isInteger(u.lane) && u.lane >= 0 && u.lane < 3 &&
        Number.isInteger(u.lv || 1) && (u.lv || 1) >= 1 && (u.lv || 1) <= 3;
    });
  }

  function unitFormHp(unit) {
    var values = FORM_HP[unit.form];
    return values ? values[Math.max(0, Math.min(2, (unit.lv || 1) - 1))] : 1;
  }

  function spikeRetaliation(unit, mods) {
    var values = FORM_SPIKE_RETAL[unit.form];
    var formMul = values ? values[Math.max(0, Math.min(2, unit.lv - 1))] : 1;
    return 24 * Math.pow(1.42, unit.lv - 1) * mods.damage * mods.spike * formMul;
  }

  function makeStructures(player, seat, mods) {
    return safeBuild(player.build).map(function (unit, index) {
      var maxHp = Math.round(UNIT_HP[unit.type] * Math.pow(1.35, (unit.lv || 1) - 1) *
        mods.unitHp * unitFormHp(unit));
      return {
        key: seat + '|' + index, index: index,
        type: unit.type, col: unit.col, lane: unit.lane, lv: unit.lv || 1,
        hp: maxHp, maxHp: maxHp,
      };
    });
  }

  function structureLanes(unit) {
    if (FOOTPRINT[unit.type]) return [0, 1, 2];
    return [unit.lane];
  }

  function lanePowerFromStructures(player, lane) {
    var power = 0;
    player.units.forEach(function (unit) {
      if (unit.hp <= 0) return;
      var type = unit.type;
      var behavior = GAME_UNITS[type].behavior;
      var width = behavior === 'shot' || behavior === 'aura' || behavior === 'chain' ||
        behavior === 'quake' || behavior === 'healer' ? 1 : 0;
      var from = Math.max(0, unit.lane - width), to = Math.min(2, unit.lane + width);
      if (FOOTPRINT[type]) { from = 0; to = 2; }
      if (lane < from || lane > to) return;
      var level = unit.lv || 1;
      var value = UNIT_POWER[type] * (1 + (level - 1) * 0.4) * player.mods.damage * player.mods.rate;
      var formPower = FORM_POWER[unit.form];
      if (formPower) value *= formPower[Math.max(0, Math.min(2, level - 1))];
      else if (unit.form && unit.form !== 'sturdy') value *= 1.08;
      power += value / (to - from + 1);
    });
    return power;
  }

  function unitContactX(unit, zombie) {
    return PLAYER_COL_START_X + unit.col * PLAYER_COL_PITCH + zombie.radius + UNIT_CONTACT_PAD;
  }

  function nearestStructureAhead(player, lane, zombie) {
    var target = null, targetX = -1;
    player.units.forEach(function (unit) {
      if (unit.hp <= 0 || structureLanes(unit).indexOf(lane) < 0) return;
      var contactX = unitContactX(unit, zombie);
      if (contactX <= zombie.x + 0.001 && contactX > targetX) {
        target = unit;
        targetX = contactX;
      }
    });
    return target;
  }

  function hitStructure(unit, damage, at, laneHits) {
    if (!unit || unit.hp <= 0 || damage <= 0) return false;
    var dealt = Math.min(unit.hp, damage);
    unit.hp -= dealt;
    if (laneHits) {
      var hit = laneHits[unit.index];
      if (!hit) hit = laneHits[unit.index] = { unitIndex: unit.index, damage: 0, hp: unit.hp, destroyed: false, at: at };
      hit.damage += dealt;
      hit.hp = unit.hp;
      hit.destroyed = unit.hp <= 0;
      hit.at = at;
    }
    return unit.hp <= 0;
  }

  function durationFor(roundIndex) {
    var t = Math.max(0, Math.min(1, roundIndex / (MAX_ROUNDS - 1)));
    return 46 + t * 40;
  }

  function resolve(players, roundIndex, seed, averageRank, options) {
    var includeTimeline = !(options && options.timeline === false);
    var r = Math.max(0, Math.min(MAX_ROUNDS - 1, roundIndex | 0));
    var random = rng(seed || 1);
    var duration = durationFor(r);
    var elapsedDuration = duration;
    var steps = 12;
    var stepSeconds = duration / steps;
    var pressure = rankPressure(averageRank);
    var result = (players || []).slice(0, COMBAT.CONFIG.COOP_MAX_PLAYERS).map(function (player, seat) {
      var mods = relicFlags(player.relics);
      var actualSeat = Number.isInteger(player.seat) ? player.seat : seat;
      var member = {
        seat: actualSeat,
        hp: HOME_HP + mods.hp,
        maxHp: HOME_HP + mods.hp,
        alive: true,
        survivedSeconds: duration,
        kills: 0,
        repairs: REPAIR_CHARGES,
        flares: FLARE_CHARGES,
        mods: mods,
      };
      member.units = makeStructures(player, actualSeat, mods);
      member.hordes = [[], [], []];
      return member;
    });
    var timeline = [];
    var progress = 0;

    for (var tick = 0; tick < steps; tick++) {
      progress = tick / steps;
      var alive = result.filter(function (p) { return p.alive; });
      if (!alive.length) break;
      // One single-player stream per room member, shared among whoever is still
      // standing. Zombies already assigned to a fallen home stay there.
      var pulseDensity = (5 + progress * 13) / (14 - progress * 5);
      var spawnRate = 0.88 + progress * 0.38 + pulseDensity;
      var spawnCount = Math.max(1, Math.round(spawnRate * stepSeconds * result.length));
      var assigned = {};
      alive.forEach(function (p) { assigned[p.seat] = [0, 0, 0]; });
      for (var z = 0; z < spawnCount; z++) {
        var target = alive[(random() * alive.length) | 0];
        assigned[target.seat][(random() * 3) | 0]++;
      }

      var laneEvents = includeTimeline ? [] : null;
      result.forEach(function (p) {
        if (!p.alive) return;
        var incoming = assigned[p.seat] || [0, 0, 0];
        if (includeTimeline) laneEvents[p.seat] = [];
        for (var lane = 0; lane < 3; lane++) {
          var count = incoming[lane] * 2;
          var horde = p.hordes[lane];
          var spawnedActors = includeTimeline ? [] : null;
          for (var spawn = 0; spawn < count; spawn++) {
            var kindRoll = random();
            var type = kindRoll < 0.8 ? 'bug' : r < 2 || kindRoll < 0.86 ? 'walker'
              : kindRoll < 0.92 ? 'runner' : kindRoll < 0.97 ? 'brute' : 'tank';
            var stats = ZOMBIES[type];
            var actor = {
              id: p.seat + '-' + lane + '-' + tick + '-' + spawn,
              type: type,
              hp: stats.hp * pressure * (1 + r * 0.045),
              speed: stats.speed,
              radius: stats.radius,
              x: PLAYER_RIFT_X - 12,
              dmg: stats.dmg * pressure,
              rate: stats.rate,
              attackCd: 0.50,
              bornAt: Math.round(duration * tick / steps * 100) / 100,
            };
            if (includeTimeline) {
              actor.visualTargetIndex = (nearestStructureAhead(p, lane, actor) || {}).index;
              if (actor.visualTargetIndex === undefined) actor.visualTargetIndex = -1;
              actor.contactUnitIndex = -2;
              actor.visualEvents = [];
            }
            horde.push(actor);
            if (includeTimeline) spawnedActors.push({ id: actor.id, type: actor.type, x: actor.x });
          }

          var tickStart = duration * tick / steps;
          var capacity = Math.floor(lanePowerFromStructures(p, lane) * stepSeconds * (1 + p.mods.slow * 0.5));
          var killedIds = includeTimeline ? [] : null;
          var killedActors = includeTimeline ? [] : null;
          var killed = Math.min(horde.length, capacity);
          // Auto-flare fires at a lane cluster of four or more.
          if (count >= 4 && p.flares > 0) {
            var flareKills = Math.min(horde.length - killed, 6);
            if (flareKills > 0) { p.flares--; killed += flareKills; }
          }
          // Turrets clear the oldest zombies first. The remaining horde stays in
          // this lane and keeps attacking the same living structure next tick.
          horde.sort(function (a, b) {
            if (a.bornAt !== b.bornAt) return a.bornAt - b.bornAt;
            return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
          });
          for (var dead = 0; dead < killed; dead++) {
            var shotZombie = horde.shift();
            if (includeTimeline) {
              killedIds.push(shotZombie.id);
              killedActors.push({ id: shotZombie.id, x: shotZombie.x, at: tickStart });
            }
          }
          p.kills += killed;
          var laneHits = includeTimeline ? {} : null;
          var homeDamage = 0;
          var homeHitCount = 0;
          var slices = Math.max(1, Math.ceil(stepSeconds / 0.1));
          var dt = stepSeconds / slices;
          for (var slice = 0; slice < slices; slice++) {
            var contactTime = tickStart + (slice + 1) * dt;
            horde.forEach(function (zombie) {
              var target = nearestStructureAhead(p, lane, zombie);
              var targetIndex = target ? target.index : -1;
              if (includeTimeline && zombie.visualTargetIndex !== targetIndex) {
                var previousTarget = p.units[zombie.visualTargetIndex];
                if (zombie.visualTargetIndex >= 0 && previousTarget) {
                  var previousHit = laneHits[previousTarget.index];
                  zombie.visualEvents.push({
                    at: previousHit && previousHit.destroyedAt !== undefined ? previousHit.destroyedAt : contactTime,
                    x: unitContactX(previousTarget, zombie),
                    targetIndex: previousTarget.index, atHome: false,
                  });
                }
                zombie.visualTargetIndex = targetIndex;
                zombie.contactUnitIndex = -2;
              }
              if (target) {
                var contactX = unitContactX(target, zombie);
                if (zombie.x > contactX) zombie.x = Math.max(contactX, zombie.x - zombie.speed * dt);
                if (includeTimeline && zombie.x <= contactX + 0.001 && zombie.contactUnitIndex !== target.index) {
                  zombie.visualEvents.push({ at: contactTime, x: contactX, targetIndex: target.index, atHome: false });
                  zombie.contactUnitIndex = target.index;
                }
                if (target.type === 'spike' && zombie.x <= contactX + 0.001) {
                  zombie.hp -= spikeRetaliation(target, p.mods) * dt;
                }
                if (zombie.hp > 0 && zombie.x <= contactX + 0.001) {
                  zombie.attackCd -= dt;
                  if (zombie.attackCd <= 0) {
                    var destroyed = hitStructure(target, zombie.dmg, contactTime, laneHits);
                    zombie.attackCd += zombie.rate;
                    if (destroyed && includeTimeline) laneHits[target.index].destroyedAt = contactTime;
                  }
                }
              } else {
                var homeContact = PLAYER_HOME_X + zombie.radius + 24;
                if (zombie.x > homeContact) zombie.x = Math.max(homeContact, zombie.x - zombie.speed * dt);
                if (includeTimeline && zombie.x <= homeContact + 0.001 && zombie.contactUnitIndex !== -1) {
                  zombie.visualEvents.push({ at: contactTime, x: homeContact, targetIndex: -1, atHome: true });
                  zombie.contactUnitIndex = -1;
                }
                if (zombie.x <= homeContact + 0.001) {
                  zombie.attackCd -= dt;
                  if (zombie.attackCd <= 0) {
                    homeDamage += zombie.dmg;
                    homeHitCount++;
                    zombie.attackCd += zombie.rate;
                  }
                }
              }
            });
            for (var h = horde.length - 1; h >= 0; h--) {
              if (horde[h].hp > 0) continue;
              if (includeTimeline) {
                killedIds.push(horde[h].id);
                killedActors.push({ id: horde[h].id, x: horde[h].x, at: contactTime });
              }
              p.kills++;
              horde.splice(h, 1);
            }
          }
          p.hordes[lane] = horde;
          var leaked = 0, blocked = 0;
          horde.forEach(function (zombie) {
            var target = nearestStructureAhead(p, lane, zombie);
            if (target) {
              if (zombie.x <= unitContactX(target, zombie) + 0.001) blocked++;
            } else if (zombie.x <= PLAYER_HOME_X + zombie.radius + 24) leaked++;
          });
          p.hp -= homeDamage;
          if (includeTimeline) {
            laneEvents[p.seat][lane] = {
              spawned: count, killed: killedIds.length, killedIds: killedIds,
              spawnedActors: spawnedActors, killedActors: killedActors,
              leaked: leaked, blocked: blocked,
              homeHits: homeHitCount > 0 ? 1 : 0,
              unitHits: Object.keys(laneHits).map(function (key) { return laneHits[key]; }),
              actors: horde.map(function (zombie) {
                var target = nearestStructureAhead(p, lane, zombie);
                return { id: zombie.id, type: zombie.type, hp: zombie.hp, x: zombie.x,
                  targetIndex: target ? target.index : -1,
                  atHome: !target && zombie.x <= PLAYER_HOME_X + zombie.radius + 24,
                  pathEvents: zombie.visualEvents.slice() };
              }),
            };
            horde.forEach(function (zombie) { zombie.visualEvents = []; });
          }
        }
        if (p.repairs > 0 && p.maxHp - p.hp >= 16) {
          p.hp = Math.min(p.maxHp, p.hp + 16 + p.mods.repair);
          p.repairs--;
        }
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          p.survivedSeconds = Math.round(duration * (tick + 1) / steps * 10) / 10;
        }
      });
      var tickAt = Math.round(duration * (tick + 1) / steps * 10) / 10;
      if (includeTimeline) timeline.push({
        at: tickAt,
        activeSeats: result.filter(function (p) { return p.alive; }).map(function (p) { return p.seat; }),
        hp: result.map(function (p) { return Math.max(0, Math.round(p.hp)); }),
        kills: result.map(function (p) { return p.kills; }),
        unitHp: result.reduce(function (all, p) {
          all[p.seat] = p.units.map(function (unit) { return Math.max(0, unit.hp); });
          return all;
        }, []),
        laneEvents: laneEvents,
      });
      if (!result.some(function (p) { return p.alive; })) {
        elapsedDuration = tickAt;
        break;
      }
    }

    var members = result.map(function (p) {
      return {
        seat: p.seat, survived: p.alive, hp: Math.max(0, Math.round(p.hp)),
        maxHp: p.maxHp, survivedSeconds: p.survivedSeconds, kills: p.kills,
      };
    });
    return {
      version: 1,
      roundIndex: r,
      seed: seed >>> 0,
      duration: elapsedDuration,
      teamWon: members.some(function (p) { return p.survived; }),
      members: members,
      timeline: timeline,
    };
  }

  function memberMods(ids) {
    var relicById = {};
    (COMBAT.RELICS || []).forEach(function (relic) { relicById[relic.id] = relic; });
    var relics = (ids || []).map(function (id) { return relicById[id]; }).filter(Boolean);
    return gameSim.combineMods(relics);
  }

  function createBattle(players, roundIndex, seed, averageRank) {
    if (!gameSim || !gameSim.Battle) throw new Error('shared battle core is unavailable');
    var inputs = (players || []).slice(0, COMBAT.CONFIG.COOP_MAX_PLAYERS).map(function (player, index) {
      return {
        seat: Number.isInteger(player.seat) ? player.seat : index,
        build: safeBuild(player.build),
        mods: memberMods(player.relics),
      };
    }).sort(function (a, b) { return a.seat - b.seat; });
    if (!inputs.length) throw new Error('co-op battle needs at least one member');

    var fallbackMods = gameSim.defaultMods();
    var battle = new gameSim.Battle({
      roundIndex: Math.max(0, Math.min(MAX_ROUNDS - 1, roundIndex | 0)),
      totalRounds: MAX_ROUNDS,
      pressure: rankPressure(averageRank),
      seed: seed || 1,
      playerMods: inputs[0].mods,
      ghostMods: fallbackMods,
      playerBuild: [], ghostBuild: [],
    });
    battle.coopMode = true;
    battle.activeLanes = COMBAT.CONFIG.LANES.map(function (_lane, lane) { return lane; });
    battle.coopTeamSize = inputs.length;
    battle.coopHomes = inputs.map(function (input) {
      var maxHp = COMBAT.CONFIG.HOME_HP + input.mods.homeHp;
      return {
        seat: input.seat,
        side: COMBAT.coopSideForSeat(input.seat),
        sideSeat: COMBAT.coopLocalSeat(input.seat),
        hp: maxHp,
        maxHp: maxHp,
        alive: true,
        survivedSeconds: 0,
        firstHit: null,
        mods: input.mods,
      };
    });
    battle.coopMembers = battle.coopHomes;
    battle.coopHomeHit = function (zombie) {
      var home = this.coopHomes.find(function (candidate) { return candidate.seat === zombie.coopHomeSeat; });
      if (!home || !home.alive) return;
      home.hp = Math.max(0, home.hp - zombie.dmg);
      if (!home.firstHit) home.firstHit = { lane: zombie.lane, time: this.t, zombie: zombie.type };
      this.emit({ t: 'homeHit', side: home.side, seat: home.seat, dmg: zombie.dmg, zombie: zombie.type });
      if (home.hp <= 0) {
        home.alive = false;
        home.survivedSeconds = this.t;
        this.units.forEach(function (unit) {
          if (unit.coopOwnerSeat === home.seat) unit.dead = true;
        });
        this.emit({ t: 'homeDown', side: home.side, seat: home.seat });
      }
      var viewer = this.coopHomes.find(function (candidate) { return candidate.seat === this.coopViewerSeat; }, this);
      if (viewer) {
        this.hp[viewer.side] = viewer.hp;
        this.maxHp[viewer.side] = viewer.maxHp;
      }
    };
    battle.retargetCoopZombie = function (zombie) {
      var previous = this.coopHomes.find(function (home) { return home.seat === zombie.coopHomeSeat; });
      if (!previous || previous.alive) return;
      var alive = this.coopHomes.filter(function (home) { return home.alive; });
      if (!alive.length) return;
      var sameSide = alive.filter(function (home) { return home.side === previous.side; });
      var candidates = sameSide.length ? sameSide : alive;
      var next = candidates[(this.rnd() * candidates.length) | 0];
      var localLane = ((zombie.lane % 3) + 3) % 3;
      zombie.coopHomeSeat = next.seat;
      zombie.targetMods = next.mods;
      zombie.lane = COMBAT.coopLaneOffset(next.seat) + localLane;
      if (zombie.side !== next.side) {
        zombie.side = next.side;
        zombie.x = COMBAT.CONFIG.RIFT_X + (next.side === 'p' ? -1 : 1) * 24;
      }
      zombie.y = COMBAT.CONFIG.LANES[zombie.lane];
      this.cancelZombieAttack(zombie);
    };
    battle.spawnOne = function () {
      if (this.zombies.length >= gameSim.zombieCapAt(this.t) * this.coopTeamSize) return;
      var alive = this.coopHomes.filter(function (home) { return home.alive; });
      if (!alive.length) return;
      var home = alive[(this.rnd() * alive.length) | 0];
      var localLane = (this.rnd() * 3) | 0;
      var lane = COMBAT.coopLaneOffset(home.seat) + localLane;
      var zombie = gameSim.makeZombie(
        home.side, lane, this.pickType(), COMBAT.CONFIG.RIFT_X + (this.rnd() - 0.5) * 60,
        this.wave, this.rnd
      );
      zombie.coopHomeSeat = home.seat;
      zombie.targetMods = home.mods;
      this.zombies.push(zombie);
      this.zBuckets[home.side][lane].push(zombie);
      this.spawned[home.side]++;
      this.emit({ t: 'spawn', x: zombie.x, y: zombie.y, side: home.side, seat: home.seat });
    };
    battle.updateSpawns = function (dt) {
      if (this.pulseQueue > 0) {
        this.pulseGap -= dt;
        if (this.pulseGap <= 0) {
          this.pulseQueue--;
          this.pulseGap = 0.16;
          this.spawnOne();
        }
      }
      this.pulseTimer -= dt;
      if (this.pulseTimer <= 0) {
        this.pulseTimer = this.wave.pulseEvery;
        this.pulseQueue = Math.round(this.wave.pulseSize * this.coopTeamSize);
        this.pulseGap = 0;
        this.emit({ t: 'pulse' });
      }
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        var progress = Math.max(0, Math.min(1, this.t / this.wave.maxTime));
        this.spawnTimer = COMBAT.lerp(this.wave.interval0, this.wave.interval1, progress) *
          (0.75 + this.rnd() * 0.5) / this.coopTeamSize;
        this.spawnOne();
      }
    };
    battle.advanceCoop = function (dt) {
      if (this.over) return;
      this.update(dt);
      var living = this.coopHomes.filter(function (home) { return home.alive; });
      if (!living.length) {
        this.coopDefeat = true;
        this.over = true;
      } else if (this.t >= this.baseWave.maxTime - 1e-8) {
        this.timeout = true;
        this.over = true;
      }
      if (this.coopViewerSeat !== undefined) {
        var viewer = this.coopHomes.find(function (home) { return home.seat === this.coopViewerSeat; }, this);
        if (viewer) {
          this.hp[viewer.side] = viewer.hp;
          this.maxHp[viewer.side] = viewer.maxHp;
        }
      }
    };
    inputs.forEach(function (input) {
      input.build.forEach(function (unit, index) {
        var side = COMBAT.coopSideForSeat(input.seat);
        battle.addUnit(side, Object.assign({}, unit, {
          lane: COMBAT.coopLaneOffset(input.seat) + unit.lane, coopIndex: index,
        }), input.mods, input.seat);
      });
    });
    battle.rebuildBuckets();
    return battle;
  }

  function resolve(players, roundIndex, seed, averageRank, options) {
    var battle = createBattle(players, roundIndex, seed, averageRank);
    var maxTime = battle.baseWave.maxTime;
    var step = 0.05;
    var guard = Math.ceil(maxTime / step) + 2;
    while (!battle.over && guard-- > 0) {
      battle.advanceCoop(Math.min(step, maxTime - battle.t));
    }
    if (!battle.over) battle.over = true;
    var duration = Math.round(Math.min(battle.t, maxTime) * 10) / 10;
    var members = battle.coopHomes.map(function (home) {
      return {
        seat: home.seat, side: home.side, sideSeat: home.sideSeat, survived: home.alive,
        hp: Math.max(0, Math.round(home.hp)), maxHp: home.maxHp,
        survivedSeconds: home.alive ? duration : Math.round(home.survivedSeconds * 10) / 10,
        firstHit: home.firstHit,
        kills: 0,
      };
    });
    return {
      version: 2,
      roundIndex: Math.max(0, Math.min(MAX_ROUNDS - 1, roundIndex | 0)),
      seed: seed >>> 0,
      duration: duration,
      teamWon: members.some(function (member) { return member.survived; }),
      members: members,
      timeline: options && options.timeline === false ? undefined : [],
    };
  }

  function rewardChoices(seed, ownedIds) {
    var random = rng(seed || 1);
    var pool = RELIC_IDS.filter(function (id) { return (ownedIds || []).indexOf(id) < 0; });
    var out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice((random() * pool.length) | 0, 1)[0]);
    return out;
  }

  function income(roundIndex, won, relicIds) {
    var mods = relicFlags(relicIds);
    return 74 + roundIndex * 16 + (won ? 30 : 12) + mods.income;
  }

  function rankDelta(wins) {
    var delta = wins * 14 - (MAX_ROUNDS - wins) * 12;
    if (wins >= 10) delta += 46;
    else if (wins >= 8) delta += 22;
    else if (wins >= 6) delta += 4;
    else if (wins <= 2) delta -= 46;
    else if (wins <= 4) delta -= 22;
    return delta;
  }

  return {
    MAX_ROUNDS: MAX_ROUNDS,
    MAX_PLAYERS: COMBAT.CONFIG.COOP_MAX_PLAYERS,
    RELIC_IDS: RELIC_IDS.slice(),
    durationFor: durationFor,
    rankPressure: rankPressure,
    resolve: resolve,
    createBattle: createBattle,
    rewardChoices: rewardChoices,
    income: income,
    rankDelta: rankDelta,
  };
});
