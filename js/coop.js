'use strict';

/* 2–6 人合作房间客户端。只有 H5/iOS 打包目标会加载此文件。 */
var Coop = (function () {
  var KEY = 'yeshou.coop.session.v1';
  var API = (window.COOP_API_BASE || 'https://coop.pikafun.com/api').replace(/\/+$/, '');
  function tr(key, values, fallback) { return L('coop.' + key, values, fallback); }
  var NICKNAMES = [
    tr('nickname0', null, '夜巡员'), tr('nickname1', null, '守门人'),
    tr('nickname2', null, '灯塔客'), tr('nickname3', null, '墙匠'),
    tr('nickname4', null, '拾荒者'), tr('nickname5', null, '巡夜犬'),
    tr('nickname6', null, '旧城客'), tr('nickname7', null, '守夜人'),
    tr('nickname8', null, '望火人'), tr('nickname9', null, '纸灯客'),
    tr('nickname10', null, '旧钟匠'), tr('nickname11', null, '夜行者'),
    tr('nickname12', null, '巷口哨兵'), tr('nickname13', null, '乌鸦使'),
    tr('nickname14', null, '窗边人'), tr('nickname15', null, '红围巾'),
    tr('nickname16', null, '雨夜客'), tr('nickname17', null, '灯油匠'),
    tr('nickname18', null, '修门匠'), tr('nickname19', null, '巡街客'),
    tr('nickname20', null, '影哨'), tr('nickname21', null, '风帽人'),
    tr('nickname22', null, '破晓者'), tr('nickname23', null, '守灯人'),
  ];
  var LABELS = {
    room_not_found: tr('notFound', null, '房间不存在或已过期'), room_full: tr('full', null, '房间已满或已经开局'),
    unauthorized: tr('unauthorized', null, '房间凭证失效，请重新加入'),
    phase_locked: tr('phaseLocked', null, '本阶段已锁定，请刷新房间状态'),
    rate_limited: tr('rateLimited', null, '请求太频繁，请稍后再试'),
    invalid_build: tr('invalidBuild', null, '布防数据无效，请检查动物位置'),
    invalid_rank: tr('invalidRank', null, '段位数据无效'),
    invalid_economy: tr('invalidEconomy', null, '布防和金币超出可用预算'),
    invalid_reward: tr('invalidReward', null, '遗物选择无效'),
    invalid_loadout: tr('invalidLoadout', null, '动物伙伴阵容无效'),
    room_code_unavailable: tr('createFailed', null, '创建房间失败，请重试'),
    not_enough_players: tr('notEnoughPlayers', null, '至少两人才能开局'),
    forbidden: tr('hostOnly', null, '只有房主能开局'),
  };
  var stored = null;
  var state = null;
  var pollTimer = 0;
  var pollBusy = false;
  var pendingBusy = false;
  var connecting = false;
  var confirmingDelete = false;
  var offline = false;
  var draftTimer = 0;
  var replayFrame = 0;
  var replayElapsed = 0;
  var replayLast = 0;
  var replayAccumulator = 0;
  var replayIndex = -1;
  var replaying = false;
  var listenersBound = false;
  var errorToastAt = 0;
  var viewing = false;
  var activeReplay = null;
  var hudCollapsed = !!(window.matchMedia && (
    window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 760px)').matches
  ));

  function readSession() {
    try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); }
    catch (_) { stored = null; }
    if (!stored || !/^[A-HJ-NP-Z2-9]{8}$/.test(stored.code || '') || !/^[a-f0-9]{64}$/i.test(stored.token || '')) {
      stored = null;
    }
  }

  function saveSession() {
    try {
      if (stored) localStorage.setItem(KEY, JSON.stringify(stored));
      else localStorage.removeItem(KEY);
    } catch (_) { }
  }

  function randomHex(bytes) {
    var data = new Uint8Array(bytes);
    crypto.getRandomValues(data);
    return Array.prototype.map.call(data, function (n) {
      return n.toString(16).padStart(2, '0');
    }).join('');
  }

  function randomCode() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var data = new Uint8Array(8);
    crypto.getRandomValues(data);
    return Array.prototype.map.call(data, function (n) { return alphabet[n & 31]; }).join('');
  }

  function setOverlay(html, mode) {
    UI.el.overlay.innerHTML = html;
    UI.el.overlay.style.display = 'flex';
    UI.overlayMode = mode || 'coop';
    hideHud();
  }

  function messageFor(err) {
    return err && err.error === 'network' && err.message
      ? err.message : LABELS[err && err.error] || tr('genericError', null, '联机请求失败，请检查网络后重试');
  }

  async function request(path, method, body, needsAuth) {
    var headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (needsAuth !== false && stored) headers.authorization = 'Bearer ' + stored.token;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = controller ? setTimeout(function () { controller.abort(); }, 9000) : 0;
    var response;
    try {
      response = await fetch(API + path, {
        method: method || 'GET', headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        mode: 'cors', credentials: 'omit', cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
    } catch (e) {
      throw { error: 'network', message: e && e.name === 'AbortError'
        ? tr('requestTimeout', null, '请求超时') : tr('networkUnavailable', null, '网络不可用') };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    var data;
    try { data = await response.json(); }
    catch (_) { data = {}; }
    if (!response.ok) throw data && data.error ? data : { error: 'network' };
    return data;
  }

  function codePath(suffix) { return '/rooms/' + stored.code + (suffix ? '/' + suffix : ''); }

  function bindLifecycle() {
    if (listenersBound) return;
    listenersBound = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        if (viewing && stored) refresh();
        schedulePoll(0);
      } else {
        stopPollTimer();
      }
    });
    window.addEventListener('focus', function () { if (viewing && stored) refresh(); });
    window.addEventListener('pageshow', function () { if (viewing && stored) refresh(); });
    window.addEventListener('pagehide', function () {
      stopPollTimer();
    });
  }

  function stopPollTimer() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = 0;
  }

  function pollDelay() {
    if (!state || !state.room) return 1000;
    if (state.room.phase === 'lobby' || state.room.phase === 'preparing') return 1000;
    // Active rooms have a 15-second server presence grace period.
    return state.room.phase === 'finished' || state.room.phase === 'ended' ? 30000 : 5000;
  }

  function schedulePoll(delay) {
    stopPollTimer();
    if (!stored || stored.pending || document.visibilityState === 'hidden') return;
    pollTimer = setTimeout(async function () {
      pollTimer = 0;
      if (!pollBusy) await refresh();
      schedulePoll(pollDelay());
    }, delay === undefined ? pollDelay() : delay);
  }

  function startPolling() {
    bindLifecycle();
    schedulePoll(1000);
  }

  function startFromPayload(payload, token, nicknameIndex) {
    stored = {
      code: payload.room.code, token: token, nicknameIndex: nicknameIndex,
      quotaSpent: false, seenRound: -1, finishApplied: false,
      initialRank: payload.self.rank,
    };
    state = payload;
    saveSession();
    startPolling();
    routeState();
  }

  function showConnecting(message, busy) {
    connecting = true;
    setOverlay('<div class="overlayBox coopRoom"><h2>' + tr('connecting', null, '连接中') +
      '</h2><p class="sub" role="status">' + message + '</p>' +
      '<button class="big" id="retryCoopConnectionBtn"' + (busy ? ' disabled' : '') + '>' +
      tr('retryConnection', null, '重试连接') + '</button>' +
      '<button class="ghost" id="backCoopConnectionBtn">' + tr('backMenu', null, '返回主菜单') +
      '</button></div>');
    document.getElementById('retryCoopConnectionBtn').onclick = open;
    document.getElementById('backCoopConnectionBtn').onclick = leaveToMenu;
  }

  async function resumePending() {
    if (!stored || !stored.pending) return;
    if (pendingBusy) {
      if (viewing) showConnecting(tr('recovering', null, '正在恢复房间请求…'), true);
      return;
    }
    pendingBusy = true;
    stopPollTimer();
    showConnecting(tr('recovering', null, '正在恢复房间请求…'), true);
    var sessionToken = stored.token;
    var plan = stored.pending;
    var lastError = null;
    for (var attempt = 0; attempt < (plan.kind === 'create' ? 5 : 1); attempt++) {
      if (plan.kind === 'create' && attempt > 0) {
        stored.code = randomCode();
        saveSession();
      }
      try {
        var payload = plan.kind === 'create'
          ? await request('/rooms', 'POST', {
            code: stored.code, token: stored.token, nicknameIndex: stored.nicknameIndex,
            rank: plan.rank, loadout: plan.loadout, maxPlayers: CONFIG.COOP_MAX_PLAYERS,
          }, false)
          : await request('/rooms/' + stored.code + '/join', 'POST', {
            token: stored.token, nicknameIndex: stored.nicknameIndex,
            rank: plan.rank, loadout: plan.loadout,
          }, false);
        if (!stored || stored.token !== sessionToken) break;
        pendingBusy = false;
        startFromPayload(payload, sessionToken, stored.nicknameIndex);
        return;
      } catch (err) {
        lastError = err;
        if (plan.kind !== 'create' || !err || err.error !== 'collision') break;
      }
    }
    pendingBusy = false;
    if (viewing && stored && stored.token === sessionToken) {
      if (lastError && lastError.error === 'network') showConnecting(messageFor(lastError), false);
      else showEntry(messageFor(lastError));
    }
  }

  async function refresh() {
    if (!stored || pollBusy) return;
    if (stored.pending) { if (viewing) resumePending(); return; }
    pollBusy = true;
    var sessionToken = stored.token;
    try {
      var payload = await request(codePath('state'), 'GET');
      if (!stored || stored.token !== sessionToken) return;
      state = payload;
      offline = false;
      if (stored.initialRank === undefined && state.self) stored.initialRank = state.self.rank;
      saveSession();
      routeState();
    } catch (err) {
      if (!stored || stored.token !== sessionToken) return;
      if (err && (err.error === 'unauthorized' || err.error === 'room_not_found')) {
        stopPollTimer();
        stored = null; state = null; saveSession();
        if (Game.coopMode) Game.endCoop();
        if (viewing) showEntry(messageFor(err));
      } else if (viewing) {
        offline = true;
        if (connecting) showConnecting(messageFor(err), false);
        else {
          showError(messageFor(err));
          if (Game.coopMode && Game.state === 'build') renderHud();
        }
      }
    } finally {
      pollBusy = false;
    }
  }

  function open() {
    viewing = true;
    bindLifecycle();
    readSession();
    if (stored) {
      if (stored.pending) resumePending();
      else {
        showConnecting(tr('readingState', null, '正在读取房间状态…'), true);
        startPolling();
        refresh();
      }
    } else {
      showEntry();
    }
  }

  function inviteUrl(code) {
    var url = new URL(window.location.href);
    url.searchParams.set('room', code);
    return url.toString();
  }

  function openInviteFromUrl() {
    var url = new URL(window.location.href);
    var code = url.searchParams.get('room');
    if (code === null) return false;
    url.searchParams.delete('room');
    try { window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash); }
    catch (_) { }

    code = code.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
      readSession();
      showEntry(tr('invalidCode', null, '请输入有效的八位房间码。'));
      return true;
    }
    readSession();
    if (stored && stored.code === code) open();
    else {
      viewing = true;
      enterRoom('join', code);
    }
    return true;
  }

  function menuLabel() {
    readSession();
    return stored ? tr('menuResume', { code: stored.code }, '继续合作 · {code}')
      : tr('menuOpen', null, '创建或加入房间');
  }

  function showEntry(errorText) {
    viewing = true;
    connecting = false;
    stopPollTimer();
    if (Game.coopMode) Game.endCoop();
    var selected = stored && stored.nicknameIndex >= 0 ? stored.nicknameIndex : 0;
    var options = NICKNAMES.map(function (name, i) {
      return '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + name + '</option>';
    }).join('');
    var saved = stored ? '<button class="ghost" id="resumeCoopBtn">' +
      tr('resumeButton', { code: stored.code }, '继续房间 {code}') + '</button>' : '';
    setOverlay(
      '<div class="overlayBox coopRoom">' +
      '<h2>' + tr('title', null, '合作守夜') + '</h2>' +
      '<p class="sub">' + tr('intro', null, '邀请一到五位好友，最多六人；每侧三名玩家，每人负责三路。') + '</p>' +
      (errorText ? '<p class="sub" style="color:#ff9a82">' + errorText + '</p>' : '') +
      '<label>' + tr('nicknameLabel', null, '预设昵称') + '<select id="coopNickname">' + options + '</select></label>' +
      '<div class="coopEntryGrid">' +
      '<div class="coopEntryCard"><h3>' + tr('createTitle', null, '创建房间') + '</h3><p class="sub">' +
      tr('createDesc', null, '创建后把八位房间码发给最多五位好友。') + '</p>' +
      '<button class="big" id="createCoopBtn">' + tr('createButton', null, '创建房间') + '</button></div>' +
      '<div class="coopEntryCard"><h3>' + tr('joinTitle', null, '加入房间') + '</h3><p class="sub">' +
      tr('joinDesc', null, '输入房主分享的房间码。') + '</p>' +
      '<input id="coopCodeInput" autocomplete="off" autocapitalize="characters" maxlength="8" placeholder="' +
      tr('roomCodePlaceholder', null, '八位房间码') + '">' +
      '<button class="big" id="joinCoopBtn">' + tr('joinButton', null, '加入房间') + '</button></div>' +
      '</div>' + saved +
      '<button class="ghost" id="coopBackBtn">' + tr('backMenu', null, '返回主菜单') + '</button></div>', 'coop');
    var create = document.getElementById('createCoopBtn');
    var join = document.getElementById('joinCoopBtn');
    var codeInput = document.getElementById('coopCodeInput');
    if (codeInput) codeInput.addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, 8);
    });
    if (create) create.onclick = function () { enterRoom('create'); };
    if (join) join.onclick = function () { enterRoom('join'); };
    if (document.getElementById('resumeCoopBtn')) {
      document.getElementById('resumeCoopBtn').onclick = function () { open(); };
    }
    document.getElementById('coopBackBtn').onclick = function () {
      leaveToMenu();
    };
  }

  async function enterRoom(kind, inviteCode) {
    var nickEl = document.getElementById('coopNickname');
    var nicknameIndex = nickEl ? Number(nickEl.value)
      : (stored && Number.isInteger(stored.nicknameIndex) ? stored.nicknameIndex : 0);
    var code = (inviteCode || document.getElementById('coopCodeInput') &&
      document.getElementById('coopCodeInput').value || '').toUpperCase();
    if (kind === 'join' && !/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
      showEntry(tr('invalidCode', null, '请输入有效的八位房间码。'));
      return;
    }
    var loadout = normalizeLoadout(Game.save.loadout, Game.save.rank);
    stored = {
      code: kind === 'create' ? randomCode() : code,
      token: randomHex(32), nicknameIndex: nicknameIndex,
      pending: { kind: kind, rank: Game.save.rank, loadout: loadout },
    };
    saveSession();
    resumePending();
  }

  function showError(text) {
    var now = Date.now();
    if (now - errorToastAt > 4000) { errorToastAt = now; UI.toast(text); }
  }

  function applyPayload(payload) {
    state = payload;
    if (state && state.self && stored && stored.initialRank === undefined) {
      stored.initialRank = state.self.rank;
    }
    saveSession();
    routeState();
    schedulePoll(pollDelay());
  }

  function routeState() {
    if (!viewing || confirmingDelete || !state || !state.room || !state.self || !stored) return;
    connecting = false;
    var room = state.room;
    selfSeat = state.self.seat;
    if (room.phase === 'ended') {
      replaying = false;
      if (replayFrame) cancelAnimationFrame(replayFrame);
      replayFrame = 0;
      activeReplay = null;
      Game.endCoop();
      showRoomEnded();
      return;
    }
    if (room.phase === 'lobby') {
      Game.endCoop();
      showLobby(true);
      return;
    }
    if (room.result && room.result.roundIndex > stored.seenRound && !replaying) {
      startReplay(room.result);
      return;
    }
    if (room.phase === 'preparing') {
      enterBuild();
    } else if (room.phase === 'result') {
      if (!replaying && room.result && stored.seenRound >= room.result.roundIndex) {
        if (state.self.continued) showWaitingForTeam();
        else showRewardChoice();
      }
    } else if (room.phase === 'finished') {
      applyFinished();
      if (!replaying && room.result && stored.seenRound >= room.result.roundIndex) showFinished();
    }
  }

  var selfSeat = 0;

  function rosterHtml(room, self) {
    var rows = [];
    var capacity = Number.isInteger(room.maxPlayers) ? room.maxPlayers : 3;
    for (var seat = 0; seat < capacity; seat++) {
      var player = room.players.find(function (p) { return p.seat === seat; });
      var name = player ? NICKNAMES[player.nicknameIndex] : tr('emptySeat', null, '等待好友加入');
      var status = !player ? tr('empty', null, '空位') : player.ready ? tr('ready', null, '已准备')
        : player.continued ? tr('selected', null, '已选择') : tr('online', null, '在线');
      rows.push('<div class="coopPlayerCard"><b>' + name + '</b><span>' + status + '</span></div>');
    }
    return rows.join('');
  }

  function showLobby(updateOnly) {
    if (!state || !state.room) return;
    var room = state.room;
    var key = 'lobby|' + room.players.length + '|' + room.code;
    if (updateOnly && viewKey === key && document.getElementById('coopRoomCode')) return;
    viewKey = key;
    var self = state.self;
    var capacity = Number.isInteger(room.maxPlayers) ? room.maxPlayers : 3;
    var canStart = self.seat === room.ownerSeat && room.players.length >= 2 && room.players.length < capacity;
    var waitingText = room.players.length < 2
      ? tr('waitingForPlayers', null, '至少两人才能开局。房主可在 2–5 人时开局，6 人满员自动备战。')
      : canStart
        ? tr('waitingHost', null, '房主可现在开局，也可以继续等好友加入。')
        : tr('waitingDesc', null, '房主可在 2–5 人时开局，6 人满员自动备战。');
    setOverlay(
      '<div class="overlayBox coopRoom">' +
      '<h2>' + tr('waitingTitle', null, '等待守夜伙伴') + '</h2>' +
      '<p class="sub">' + waitingText + '</p>' +
      '<div class="coopRoomCode" id="coopRoomCode">' + room.code + '</div>' +
      '<button class="ghost" id="copyCoopCodeBtn">' + tr('copyCode', null, '复制房间码') + '</button>' +
      '<div class="coopRosterCards">' + rosterHtml(room, self) + '</div>' +
      '<p class="sub">' + tr('averageRank', null, '段位压力按入房玩家平均值计算') + ' · ' +
      (self.seat === 0 ? tr('owner', null, '房主') : tr('seatNumber', { n: self.seat + 1 }, '第 {n} 位守夜人')) + '</p>' +
      (canStart ? '<button class="big" id="startCoopRunBtn">' +
        tr('startButton', { n: room.players.length }, '以 {n} 人开局') + '</button>' : '') +
      '<div class="menuAux">' +
      (self.seat === room.ownerSeat ? '<button class="ghost" id="deleteCoopRoomBtn">' +
        tr('deleteRoom', null, '解散房间') + '</button>' : '') +
      '<button class="ghost" id="leaveCoopViewBtn">' + tr('leaveRoom', null, '返回主菜单') + '</button></div></div>', 'coop');
    document.getElementById('copyCoopCodeBtn').onclick = copyCode;
    document.getElementById('leaveCoopViewBtn').onclick = leaveToMenu;
    if (document.getElementById('startCoopRunBtn')) {
      document.getElementById('startCoopRunBtn').onclick = startCoopRun;
    }
    if (document.getElementById('deleteCoopRoomBtn')) {
      document.getElementById('deleteCoopRoomBtn').onclick = deleteRoom;
    }
  }

  var viewKey = '';

  async function startCoopRun() {
    var button = document.getElementById('startCoopRunBtn');
    if (button) button.disabled = true;
    try {
      applyPayload(await request(codePath('start'), 'POST'));
    } catch (err) {
      if (button) button.disabled = false;
      showError(messageFor(err));
      if (err && err.error === 'phase_locked') refresh();
    }
  }

  function copyCodeLegacy(code) {
    var field = document.createElement('textarea');
    var focused = document.activeElement;
    field.value = code;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;user-select:text;-webkit-user-select:text;';
    document.body.appendChild(field);
    field.focus();
    field.select();
    field.setSelectionRange(0, code.length);
    var copied = false;
    try { copied = !!document.execCommand && document.execCommand('copy'); }
    catch (_) { }
    field.remove();
    if (focused && typeof focused.focus === 'function') {
      try { focused.focus({ preventScroll: true }); }
      catch (_) { focused.focus(); }
    }
    return copied;
  }

  async function copyCode() {
    var code = state && state.room && state.room.code;
    if (!code) return;
    var link = inviteUrl(code);
    var copied = copyCodeLegacy(link);
    if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(link); copied = true; }
      catch (_) { }
    }
    if (copied) UI.toast(tr('copied', null, '房间码已复制'));
    else {
      UI.toast(tr('copyFailed', null, '无法自动复制，请长按房间码复制'));
    }
  }

  async function deleteRoom(confirmed) {
    if (!stored) return;
    if (confirmed !== true) {
      confirmingDelete = true;
      var active = state && state.room && state.room.phase !== 'finished' && state.room.phase !== 'ended';
      setOverlay('<div class="overlayBox coopRoom"><h2>' + tr('deleteRoom', null, '解散房间') +
        '</h2><p class="sub">' + (active
          ? tr('deleteConfirm', null, '解散后所有队友都会结束合作，房间无法恢复。')
          : tr('deleteRecordConfirm', null, '删除后无法继续查看这个房间的记录。已获得的段位与成绩会保留。')) +
        '</p><button class="big" id="confirmDeleteCoopBtn">' + tr('confirmDelete', null, '确认解散') +
        '</button><button class="ghost" id="cancelDeleteCoopBtn">' + tr('cancelDelete', null, '取消') + '</button></div>');
      document.getElementById('confirmDeleteCoopBtn').onclick = function () { deleteRoom(true); };
      document.getElementById('cancelDeleteCoopBtn').onclick = function () {
        confirmingDelete = false; viewKey = ''; routeState();
      };
      return;
    }
    var button = document.getElementById('confirmDeleteCoopBtn');
    if (button) button.disabled = true;
    var sessionToken = stored.token;
    try {
      await request(codePath('delete'), 'DELETE');
      if (!stored || stored.token !== sessionToken) return;
      stopPollTimer(); stored = null; state = null; saveSession();
      confirmingDelete = false;
      if (viewing) { Game.endCoop(); showEntry(tr('roomDeleted', null, '房间已删除')); }
    } catch (err) {
      if (button) button.disabled = false;
      if (viewing) showError(messageFor(err));
    }
  }

  function leaveToMenu() {
    // Preserve the same seat and any draft not yet acknowledged by the server.
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = 0; flushDraft(); }
    viewing = false;
    connecting = false;
    confirmingDelete = false;
    viewKey = '';
    replaying = false;
    if (replayFrame) cancelAnimationFrame(replayFrame);
    replayFrame = 0;
    activeReplay = null;
    saveSession();
    hideHud();
    Game.endCoop();
    UI.closeOverlay();
    UI.showMenu();
    schedulePoll(pollDelay());
  }

  function showRoomEnded() {
    var key = 'ended|' + state.room.code + '|' + state.room.endReason;
    if (viewKey === key) return;
    viewKey = key;
    setOverlay(
      '<div class="overlayBox coopRoom"><h2>' + tr('ownerLeftTitle', null, '房主离开了') + '</h2>' +
      '<p class="sub">' + tr('ownerLeftDesc', null, '本局合作守卫已结束。') + '</p>' +
      '<button class="big" id="coopEndedMenuBtn">' + tr('backMenu', null, '返回主菜单') + '</button></div>', 'coop');
    document.getElementById('coopEndedMenuBtn').onclick = leaveToMenu;
  }

  function countdown() {
    var deadline = state && state.room && state.room.deadline;
    if (!deadline) return tr('waitingAll', null, '等待队友到齐');
    var left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  }

  function hudToggleButton() {
    return '<button class="coopHudToggle" id="coopHudToggleBtn" type="button" aria-expanded="' +
      (!hudCollapsed) + '" aria-label="Toggle team panel">' + (hudCollapsed ? '+' : '−') + '</button>';
  }

  function bindHudToggle() {
    var toggle = document.getElementById('coopHudToggleBtn');
    if (toggle) toggle.onclick = function () {
      hudCollapsed = !hudCollapsed;
      renderHud();
    };
  }

  function enterBuild() {
    if (!state || !state.room || state.room.phase !== 'preparing') return;
    viewKey = 'build|' + state.room.roundIndex;
    if (!Game.coopMode || Game.roundIndex !== state.room.roundIndex) {
      var member = state.self;
      if (stored.draft && stored.draft.roundIndex === state.room.roundIndex && !state.self.ready) {
        member = Object.assign({}, member, { draft: { build: stored.draft.build }, coins: stored.draft.coins });
      }
      Game.startCoopRound(member, state.room.roundIndex);
    }
    Game.coopLocked = !!state.room.players[selfSeat].ready;
    if (Game.coopLocked) Game.pendingPlacement = null;
    UI.el.overlay.style.display = 'none';
    UI.overlayMode = null;
    UI.el.coopHud.style.display = 'block';
    UI.syncAll();
    renderHud();
  }

  function renderHud() {
    if (!state || !state.room || !Game.coopMode) return;
    var room = state.room;
    var seats = room.players.map(function (p) {
      var marker = p.ready ? '<i class="coopReadyDot">✓</i>' : '…';
      return '<span>' + marker + ' ' + NICKNAMES[p.nicknameIndex] + '</span>';
    }).join('');
    var label = tr('hudRound', { code: room.code, n: room.roundIndex + 1 }, '房间 {code} · 第 {n} / 12 局');
    var remain = countdown();
    var total = room.players.length;
    var localSeat = coopLocalSeat(selfSeat);
    var sideName = coopSideForSeat(selfSeat) === 'p'
      ? tr('leftSide', null, '左侧') : tr('rightSide', null, '右侧');
    var html = '<div class="coopHudBox"><div class="coopHudTop"><span>' + label + '</span>' +
      '<div class="coopHudControls"><b>' + remain + '</b>' + hudToggleButton() + '</div></div>' +
      '<div class="coopHudBody"><div class="coopRoster">' + seats + '</div><div class="coopRoster">' + tr('seatLanes', {
        side: sideName,
        a: localSeat * CONFIG.COOP_LANES_PER_PLAYER + 1,
        b: (localSeat + 1) * CONFIG.COOP_LANES_PER_PLAYER,
        ready: room.players.filter(function (p) { return p.ready; }).length, total: total,
      }, '你负责第 {a}–{b} 路 · 全队已准备 {ready} / {total}') + '</div>' +
      (offline ? '<div class="coopRoster" role="status">' +
        tr('reconnecting', null, '网络中断，正在重连 · 布防已保存在本机') + '</div>' : '') +
      '<div class="coopRoster"><button class="ghost" id="coopBackHudBtn">' +
      tr('hudLeave', null, '离开房间视图') + '</button></div></div></div>';
    if (UI.el.coopHud.innerHTML !== html) {
      UI.el.coopHud.innerHTML = html;
      var back = document.getElementById('coopBackHudBtn');
      if (back) back.onclick = leaveToMenu;
    }
    UI.el.coopHud.classList.toggle('isCollapsed', hudCollapsed);
    bindHudToggle();
    UI.el.coopHud.style.display = 'block';
  }

  function hideHud() {
    if (UI.el.coopHud) {
      UI.el.coopHud.style.display = 'none';
      UI.el.coopHud.innerHTML = '';
    }
  }

  function syncGameUI() {
    if (!Game.coopMode || Game.state !== 'build' || !state || !state.room ||
        state.room.phase !== 'preparing') return;
    renderHud();
    if (state && state.room && state.room.deadline && !Game.coopLocked) {
      var left = Math.max(0, Math.ceil((state.room.deadline - Date.now()) / 1000));
      UI.setText(UI.el.timer, tr('prepTimer', {
        time: Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'),
      }, '备战 {time}'));
    }
  }

  function averageRank() {
    var players = state && state.room && state.room.players;
    if (!players || !players.length) return Game.save.rank;
    return players.reduce(function (sum, player) { return sum + player.rank; }, 0) / players.length;
  }

  function serverBuild() {
    var offset = coopLaneOffset(selfSeat);
    return Game.playerBuild().map(function (unit) {
      return {
        type: unit.type, col: unit.col, lane: unit.lane - offset,
        lv: unit.lv || 1, form: unit.form || null,
      };
    });
  }

  function queueDraftSave() {
    if (!viewing || !stored || !state || !state.room || state.room.phase !== 'preparing' || Game.coopLocked) return;
    stored.draft = {
      roundIndex: state.room.roundIndex, build: serverBuild(), coins: Math.max(0, Math.floor(Game.coins)),
    };
    saveSession();
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      draftTimer = 0;
      flushDraft();
    }, 450);
  }

  async function flushDraft() {
    if (!stored || !stored.draft || !state || state.room.phase !== 'preparing' ||
        stored.draft.roundIndex !== state.room.roundIndex) return;
    var draft = stored.draft;
    try {
      await request(codePath('draft'), 'POST', { build: draft.build, coins: draft.coins });
    } catch (err) {
      if (err && err.error === 'phase_locked') refresh();
      else if (viewing) {
        offline = true; showError(messageFor(err));
        if (Game.coopMode && Game.state === 'build') renderHud();
      }
    }
  }

  function readyUp() {
    if (!state || !state.room || state.room.phase !== 'preparing' || Game.coopLocked) return;
    Game.pendingPlacement = null;
    UI.syncAll();
    if (Game.formChoice) Game.cancelFormChoice(true);
    if (stored && stored.quotaSpent) {
      submitReady();
      return;
    }
    UI.requestCoopMatch(function () {
      if (stored && !stored.quotaSpent) { stored.quotaSpent = true; saveSession(); }
      submitReady();
    });
  }

  async function submitReady() {
    if (!state || !state.room || state.room.phase !== 'preparing') return;
    Game.coopLocked = true;
    UI.syncAll();
    try {
      var payload = await request(codePath('ready'), 'POST', {
        build: serverBuild(), coins: Math.max(0, Math.floor(Game.coins)),
      });
      applyPayload(payload);
    } catch (err) {
      Game.coopLocked = false;
      UI.syncAll();
      showError(messageFor(err));
    }
  }

  function memberName(seat) {
    var p = state.room.players.find(function (player) { return player.seat === seat; });
    return p ? NICKNAMES[p.nicknameIndex] : tr('seatNumber', { n: seat + 1 }, '第 {n} 位守夜人');
  }

  function makeReplayView(result, timeline) {
    var units = [];
    var unitsBySeat = {};
    var homes = result.members.map(function (member) {
      return {
        seat: member.seat, side: coopSideForSeat(member.seat), sideSeat: coopLocalSeat(member.seat),
        name: memberName(member.seat),
        hp: member.maxHp, maxHp: member.maxHp,
      };
    });
    (result.inputs || []).forEach(function (input) {
      unitsBySeat[input.seat] = [];
      var unitMods = defaultMods();
      var unitSide = coopSideForSeat(input.seat);
      var laneOffset = coopLaneOffset(input.seat);
      if ((input.relics || []).indexOf('steel') >= 0) unitMods.hpMul *= 1.28;
      (input.build || []).forEach(function (unit, unitIndex) {
        var visualUnit = makeUnit(unitSide, unit.col, laneOffset + unit.lane,
          unit.type, unit.lv || 1, unitMods, unit.form || null);
        visualUnit.coopSeat = input.seat;
        visualUnit.coopIndex = unitIndex;
        unitsBySeat[input.seat][unitIndex] = visualUnit;
        units.push(visualUnit);
      });
    });
    var buckets = { p: [], g: [] };
    for (var lane = 0; lane < CONFIG.LANES.length; lane++) {
      buckets.p.push([]); buckets.g.push([]);
    }
    var own = result.members.find(function (member) { return member.seat === selfSeat; });
    var ownHp = own ? own.maxHp : CONFIG.HOME_HP;
    var battle = {
      units: units, zombies: [], shots: [], zBuckets: buckets,
      hp: { p: ownHp, g: CONFIG.HOME_HP },
      maxHp: { p: ownHp, g: CONFIG.HOME_HP },
      pulseQueue: 0, t: 0,
      drainFx: function () { return []; },
    };
    var actors = [];
    var actorById = {};
    var unitHits = [];
    var unitDamageByKey = {};
    var wave = { hpMul: 1, speedMul: 1, dmgMul: 1 };
    timeline.forEach(function (event, tick) {
      var start = tick ? timeline[tick - 1].at : 0;
      (event.laneEvents || []).forEach(function (lanes, seat) {
        if (!lanes) return;
        lanes.forEach(function (counts, localLane) {
          var globalLane = coopLaneOffset(seat) + localLane;
          if (!counts) return;
          (counts.unitHits || []).forEach(function (hit) {
            unitHits.push({ seat: seat, time: hit.at, unitIndex: hit.unitIndex, damage: hit.damage });
            var damageKey = seat + '|' + hit.unitIndex;
            if (!unitDamageByKey[damageKey]) unitDamageByKey[damageKey] = [];
            unitDamageByKey[damageKey].push({ time: hit.at, damage: hit.damage });
          });
          (counts.spawnedActors || []).forEach(function (spawned) {
            if (actorById[spawned.id]) return;
            var hash = 2166136261;
            for (var c = 0; c < spawned.id.length; c++) hash = Math.imul(hash ^ spawned.id.charCodeAt(c), 16777619);
            var random = mulberry32((result.seed ^ hash) >>> 0);
            var actorSide = coopSideForSeat(seat);
            var zombie = makeZombie(actorSide, globalLane, spawned.type,
              spawned.x === undefined ? CONFIG.RIFT_X + (actorSide === 'p' ? -12 : 12) : spawned.x, wave, random);
            var actor = {
              id: spawned.id, zombie: zombie, seat: seat, lane: globalLane,
              phase: zombie.phase,
              bornAt: start, points: [{ time: start, x: zombie.x, targetIndex: -1, atHome: false }],
              killedAt: null, deathX: zombie.x, burst: false,
            };
            actorById[actor.id] = actor;
            actors.push(actor);
          });
          (counts.actors || []).forEach(function (snapshot) {
            var actor = actorById[snapshot.id];
            if (!actor) return;
            (snapshot.pathEvents || []).forEach(function (point) {
              actor.points.push({
                time: point.at, x: point.x,
                targetIndex: point.targetIndex, atHome: !!point.atHome,
              });
            });
            actor.points.push({
              time: event.at, x: snapshot.x,
              targetIndex: snapshot.targetIndex, atHome: !!snapshot.atHome,
            });
          });
          (counts.killedActors || []).forEach(function (death) {
            var actor = actorById[death.id];
            if (!actor) return;
            actor.killedAt = death.at;
            actor.deathX = death.x;
            actor.deathY = actor.zombie.y;
          });
          if (counts.homeHits) {
            unitHits.push({ home: true, seat: seat, time: event.at, unitIndex: -1 });
          }
        });
      });
    });
    return { battle: battle, homes: homes, actors: actors, unitHits: unitHits, unitDamageByKey: unitDamageByKey };
  }

  function updateReplayView(time) {
    if (!activeReplay || !activeReplay.view) return;
    var view = activeReplay.view, battle = view.battle;
    var timeline = activeReplay.timeline;
    var prior = replayIndex >= 0 ? timeline[replayIndex] : null;
    var next = timeline[replayIndex + 1] || prior;
    var fromTime = prior ? prior.at : 0;
    var fraction = next && next.at > fromTime
      ? Math.max(0, Math.min(1, (time - fromTime) / (next.at - fromTime))) : 1;
    var previousTime = view.lastTime || 0;
    var visualDt = Math.max(0, time - previousTime);
    view.lastTime = time;
    view.homes.forEach(function (home) {
      var fromHp = prior && prior.hp[home.seat] !== undefined ? prior.hp[home.seat] : home.maxHp;
      var toHp = next && next.hp[home.seat] !== undefined ? next.hp[home.seat] : fromHp;
      home.hp = Math.max(0, fromHp + (toHp - fromHp) * fraction);
    });
    var ownHome = view.homes.find(function (home) { return home.seat === selfSeat; });
    battle.hp.p = ownHome ? ownHome.hp : CONFIG.HOME_HP;
    battle.t = time;
    battle.zombies = [];
    battle.shots = [];
    for (var lane = 0; lane < CONFIG.LANES.length; lane++) battle.zBuckets.p[lane].length = 0;
    battle.units.forEach(function (unit) {
      unit.flash = Math.max(0, unit.flash - visualDt * 4);
      var before = prior && prior.unitHp && prior.unitHp[unit.coopSeat]
        ? prior.unitHp[unit.coopSeat][unit.coopIndex] : unit.maxHp;
      var damage = 0;
      (view.unitDamageByKey[unit.coopSeat + '|' + unit.coopIndex] || []).forEach(function (hit) {
        if (hit.time > fromTime && hit.time <= time) damage += hit.damage;
      });
      unit.hp = Math.max(0, before - damage);
      unit.dead = unit.hp <= 0;
    });
    view.unitHits.forEach(function (hit) {
      if (hit.time <= previousTime || hit.time > time) return;
      if (hit.home) {
        Render.handleFx({ t: 'homeHit', side: 'p' });
        return;
      }
      var target = view.battle.units.find(function (unit) {
        return unit.coopSeat === hit.seat && unit.coopIndex === hit.unitIndex;
      });
      if (!target) return;
      target.flash = 0.9;
      Render.handleFx({ t: 'hitUnit', x: target.x, y: target.y, side: 'p', type: target.type });
    });
    view.actors.forEach(function (actor, index) {
      if (actor.killedAt !== null && actor.killedAt !== undefined &&
          previousTime < actor.killedAt && time >= actor.killedAt && !actor.burst) {
        actor.burst = true;
        if (index % 3 === 0) Render.handleFx({ t: 'zdeath', x: actor.deathX, y: actor.deathY, r: actor.zombie.r });
      }
      if (time < actor.bornAt || (actor.killedAt !== null && actor.killedAt !== undefined && time >= actor.killedAt)) return;
      var zombie = actor.zombie;
      var points = actor.points;
      var beforePoint = points[0], afterPoint = null;
      for (var pointIndex = 1; pointIndex < points.length; pointIndex++) {
        if (points[pointIndex].time <= time) beforePoint = points[pointIndex];
        else { afterPoint = points[pointIndex]; break; }
      }
      var move = afterPoint && afterPoint.time > beforePoint.time
        ? Math.max(0, Math.min(1, (time - beforePoint.time) / (afterPoint.time - beforePoint.time))) : 1;
      zombie.x = beforePoint.x + ((afterPoint ? afterPoint.x : beforePoint.x) - beforePoint.x) * move;
      zombie.phase = actor.phase + time * 6;
      battle.zombies.push(zombie);
      battle.zBuckets[zombie.side][zombie.lane].push(zombie);
    });
    battle.units.forEach(function (unit) {
      var nearby = null;
      unitFootprintLanes(unit.type, unit.lane).forEach(function (lane) {
        var list = battle.zBuckets.p[lane] || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].x >= unit.x - 35 && (!nearby || list[i].x > nearby.x)) nearby = list[i];
        }
      });
      unit.engaged = nearby ? 1 : 0;
      var flashPhase = (time * 2.5 + unit.col * 0.21 + unit.lane * 0.13) % 1;
      unit.actT = nearby && ATTACKERS[unit.type] && flashPhase < 0.3 ? 0.2 : 0;
      if (unit.actT && nearby) {
        battle.shots.push({
          x: unit.x + (nearby.x - unit.x) * flashPhase / 0.3,
          y: unit.y + (nearby.y - unit.y) * flashPhase / 0.3,
          color: UNITS[unit.type].glow || UNITS[unit.type].color,
        });
      }
    });
  }

  function startReplay(result) {
    if (!result || replaying) return;
    replaying = true;
    stopPollTimer();
    var ranks = (result.inputs || []).map(function (p) { return p.rank; });
    var average = ranks.length ? ranks.reduce(function (sum, rank) { return sum + rank; }, 0) / ranks.length : 0;
    var battle = result.inputs && window.CoopSim
      ? CoopSim.createBattle(result.inputs, result.roundIndex, result.seed, average) : null;
    if (!battle) { replaying = false; refresh(); return; }
    battle.coopViewerSeat = selfSeat;
    battle.coopHomes.forEach(function (home) { home.name = memberName(home.seat); });
    var visibleResult = Object.assign({}, result);
    activeReplay = { result: visibleResult, battle: battle };
    replayElapsed = 0;
    replayLast = 0;
    replayAccumulator = 0;
    Game.coopMode = true;
    Game.coopLocked = true;
    Game.coopSeat = selfSeat;
    Game.coopSide = coopSideForSeat(selfSeat);
    Game.coopRoom = state.room;
    Game.coopHomes = battle.coopHomes;
    Game.roundIndex = result.roundIndex;
    Game.coins = state.self.coins;
    Game.relics = (state.self.relics || []).map(function (id) {
      return RELICS.find(function (relic) { return relic.id === id; });
    }).filter(Boolean);
    Game.history = (state.room.teamHistory || []).slice(0, result.roundIndex).map(function (won, i) {
      return { round: i, won: !!won };
    });
    Game.pressure = rankPressure(average);
    Game.threat = rankThreat(average);
    Game.bot = { name: '', tag: '', rating: 0 };
    Game.battle = battle;
    Game.pendingPlacement = null;
    Game.selectedCell = null;
    Game.armedType = null;
    Game.matchmaking = null;
    Game.state = 'coopReplay';
    UI.el.overlay.style.display = 'none';
    UI.overlayMode = null;
    var title = tr('hudRound', {
      code: state.room.code, n: visibleResult.roundIndex + 1,
    }, '房间 {code} · 第 {n} / 12 局');
    UI.el.coopHud.innerHTML = '<div class="coopHudBox"><div class="coopHudTop"><span>' + title +
      '</span><div class="coopHudControls"><b id="coopBattleClock">0.0 / ' + visibleResult.duration.toFixed(1) + ' ' +
      tr('seconds', null, '秒') + '</b>' + hudToggleButton() + '</div></div>' +
      '<div class="coopHudBody"><div class="coopRoster" id="coopBattleRoster"></div>' +
      '<div class="coopRoster"><button class="ghost" id="coopBattleLeaveBtn">' +
      tr('hudLeave', null, '离开本局') + '</button></div></div></div>';
    UI.el.coopHud.classList.toggle('isCollapsed', hudCollapsed);
    UI.el.coopHud.style.display = 'block';
    bindHudToggle();
    document.getElementById('coopBattleLeaveBtn').onclick = leaveToMenu;
    UI.syncAll();
    replayFrame = requestAnimationFrame(tickReplay);
    schedulePoll(pollDelay());
  }

  function tickReplay(now) {
    if (!replaying || !activeReplay) return;
    if (replayLast && document.visibilityState === 'visible') {
      replayAccumulator += Math.min(0.25, Math.max(0, (now - replayLast) / 1000));
    }
    replayLast = now;
    var result = activeReplay.result;
    var battle = activeReplay.battle;
    while (replayAccumulator >= 0.05 && !battle.over) {
      var remaining = battle.baseWave.maxTime - battle.t;
      battle.advanceCoop(Math.min(0.05, remaining));
      replayAccumulator -= 0.05;
    }
    replayElapsed = Math.min(battle.t, result.duration);
    var roster = document.getElementById('coopBattleRoster');
    if (roster) roster.innerHTML = battle.coopHomes.map(function (home) {
      return '<span>' + home.name + ' ' + Math.ceil(home.hp) + '/' + home.maxHp + ' HP' +
        (home.hp <= 0 ? ' · ' + tr('fallen', null, '倒下') : '') + '</span>';
    }).join('');
    var clock = document.getElementById('coopBattleClock');
    if (clock) clock.textContent = Math.min(replayElapsed, result.duration).toFixed(1) + ' / ' +
      result.duration.toFixed(1) + ' ' + tr('seconds', null, '秒');
    if (battle.over || replayElapsed >= result.duration) {
      completeReplay();
      return;
    }
    replayFrame = requestAnimationFrame(tickReplay);
  }

  function completeReplay() {
    var round = activeReplay.result.roundIndex;
    replaying = false;
    activeReplay = null;
    if (replayFrame) cancelAnimationFrame(replayFrame);
    replayFrame = 0;
    Game.state = 'coopResult';
    Game.history = (state.room.teamHistory || []).map(function (won, i) {
      return { round: i, won: !!won };
    });
    hideHud();
    stored.seenRound = Math.max(stored.seenRound, round);
    saveSession();
    routeState();
    schedulePoll(1000);
  }

  function showRewardChoice() {
    var room = state.room;
    var result = room.result;
    var round = result.roundIndex;
    var key = 'reward|' + round + '|' + !!state.self.continued;
    if (viewKey === key) return;
    viewKey = key;
    var relById = {};
    RELICS.forEach(function (r) { relById[r.id] = r; });
    var personal = result.members.find(function (m) { return m.seat === selfSeat; });
    var choices = (state.self.rewardChoices || []).filter(function (id) { return !!relById[id]; });
    var buttons = choices.map(function (id) {
      var relic = relById[id];
      return '<button class="ghost coopRelicChoice" data-relic="' + id + '" title="' + relic.name + '：' + relic.text + '">' +
        '<span class="coopRelicName">' + relic.icon + ' ' + relic.name + '</span>' +
        '<span class="coopRelicEffect">' + relic.text + '</span></button>';
    }).join('');
    var winners = result.members.filter(function (m) { return m.survived; }).length;
    setOverlay(
      '<div class="overlayBox coopRoom">' +
      '<h2>' + (result.teamWon ? tr('resultWin', null, '至少一座家园守住了')
        : tr('resultLose', null, '全队家园失守')) + '</h2>' +
      '<p class="sub">' + tr('survivors', { n: winners, total: result.members.length }, '全队存活 {n} / {total}') + ' · ' +
      (personal && personal.survived ? tr('youHeld', null, '你守住了') : tr('youFell', null, '你的家园失守了')) +
      ' · ' + tr('revived', null, '下一小局会复活。') + '</p>' +
      '<div class="coopRosterCards">' + result.members.map(function (m) {
        return '<div class="coopPlayerCard"><b>' + memberName(m.seat) + '</b><span>' +
          (m.survived ? tr('heldStatus', null, '守住') + ' · ' + m.hp + ' HP'
            : tr('fallenStatus', null, '失守') + ' · ' + m.survivedSeconds.toFixed(1) + ' ' + tr('seconds', null, '秒')) +
          '</span></div>';
      }).join('') + '</div>' +
      '<p class="sub">' + tr('rewardPrompt', null, '选择一件遗物，或跳过领取 45 金币。120 秒内未选择会自动跳过。') + '</p>' +
      '<div class="coopRelicChoices">' + buttons + '</div>' +
      '<div class="coopRewardActions"><button class="ghost" id="coopSkipRewardBtn">' +
      tr('skipReward', null, '跳过 · +45 金币') + '</button></div>' +
      '<button class="ghost" id="coopMenuAfterResultBtn">' + tr('leaveRoom', null, '返回主菜单') + '</button></div>', 'coop');
    var relicButtons = UI.el.overlay.querySelectorAll('[data-relic]');
    for (var i = 0; i < relicButtons.length; i++) {
      relicButtons[i].onclick = function () { continueAfterReward(this.getAttribute('data-relic')); };
    }
    document.getElementById('coopSkipRewardBtn').onclick = function () { continueAfterReward(null); };
    document.getElementById('coopMenuAfterResultBtn').onclick = leaveToMenu;
  }

  async function continueAfterReward(relicId) {
    var buttons = UI.el.overlay.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    try {
      var payload = await request(codePath('continue'), 'POST', relicId ? { relicId: relicId } : { skip: true });
      applyPayload(payload);
    } catch (err) {
      for (var j = 0; j < buttons.length; j++) buttons[j].disabled = false;
      showError(messageFor(err));
      if (err && err.error === 'phase_locked') refresh();
    }
  }

  function showWaitingForTeam() {
    var key = 'continue-wait|' + state.room.roundIndex + '|' +
      state.room.players.map(function (p) { return p.continued ? '1' : '0'; }).join('');
    if (viewKey === key) return;
    viewKey = key;
    setOverlay(
      '<div class="overlayBox coopRoom"><h2>' + tr('waitContinueTitle', null, '遗物已锁定') + '</h2>' +
      '<p class="sub">' + tr('waitContinueDesc', null, '等其他守夜人选择，或等 120 秒到期自动跳过。之后会进入下一局备战。') + '</p>' +
      '<div class="coopRosterCards">' + state.room.players.map(function (p) {
        return '<div class="coopPlayerCard"><b>' + NICKNAMES[p.nicknameIndex] + '</b><span>' +
          (p.continued ? tr('chosen', null, '已选择') : tr('choosing', null, '选择中')) + '</span></div>';
      }).join('') + '</div><p class="sub">' + tr('localRoomProgress', null, '本机可离开，房间进度会保留。') + '</p>' +
      '<button class="ghost" id="coopWaitMenuBtn">' + tr('backMenu', null, '返回主菜单') + '</button></div>', 'coop');
    document.getElementById('coopWaitMenuBtn').onclick = leaveToMenu;
  }

  function applyFinished() {
    if (!stored || stored.finishApplied || !state || !state.room || !state.self) return;
    var before = Number.isInteger(stored.initialRank) ? stored.initialRank : state.self.rank - (state.room.rankDelta || 0);
    Game.save.rank = state.self.rank;
    Game.save.matches++;
    Game.save.totalWins += state.room.teamWins || 0;
    if ((state.room.teamWins || 0) > Game.save.bestWins) Game.save.bestWins = state.room.teamWins || 0;
    Game.persist();
    stored.finishApplied = true;
    stored.rankBefore = before;
    saveSession();
  }

  function showFinished() {
    var key = 'finished|' + state.room.teamWins;
    if (viewKey === key) return;
    viewKey = key;
    var before = Number.isInteger(stored.rankBefore) ? stored.rankBefore : state.self.rank - (state.room.rankDelta || 0);
    var delta = state.self.rank - before;
    setOverlay(
      '<div class="overlayBox coopRoom"><h2>' + tr('finishTitle', null, '合作守夜结束') + '</h2>' +
      '<p class="sub">' + tr('finishRounds', {
        n: state.room.teamWins, before: before, after: state.self.rank,
        delta: (delta >= 0 ? '+' : '') + delta,
      }, '12 局守住 {n} 局 · 段位 {before} → {after}（{delta}）') + '</p>' +
      '<div class="coopRosterCards">' + state.room.players.map(function (p) {
        return '<div class="coopPlayerCard"><b>' + NICKNAMES[p.nicknameIndex] + '</b><span>' +
          tr('currentRank', { n: p.rank }, '当前段位 {n}') + '</span></div>';
      }).join('') + '</div>' +
      (state.self.seat === state.room.ownerSeat ? '<button class="ghost" id="deleteCoopRoomBtn">' +
        tr('deleteRecord', null, '删除房间记录') + '</button>' : '') +
      '<button class="big" id="finishCoopBtn">' + tr('finishButton', null, '返回主菜单') + '</button></div>', 'coop');
    if (document.getElementById('deleteCoopRoomBtn')) {
      document.getElementById('deleteCoopRoomBtn').onclick = deleteRoom;
    }
    document.getElementById('finishCoopBtn').onclick = leaveToMenu;
  }

  return {
    NICKNAMES: NICKNAMES,
    open: open,
    openInviteFromUrl: openInviteFromUrl,
    menuLabel: menuLabel,
    hideHud: hideHud,
    syncGameUI: syncGameUI,
    averageRank: averageRank,
    queueDraftSave: queueDraftSave,
    readyUp: readyUp,
    get state() { return state; },
    get selfSeat() { return selfSeat; },
  };
})();

window.Coop = Coop;
