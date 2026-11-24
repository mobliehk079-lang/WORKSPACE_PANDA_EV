// Minigame: Panda Jump — 3D platformer (solo or with colleagues).
// Lobby + invites here; the game itself runs full screen (js/jump/engine.js, loaded only when this tab opens).
// Rooms live only in server memory (src/jump/); positions travel over a WebSocket at /api/jump/ws.
import { S, api, esc, $, $$, icon, avatar, openModal, confirmDialog, toast, toastErr, t } from '../utils.js';

const CH_KEY = 'pev-jump-ch';
export const JUMP_JOIN_KEY = 'pev-jump-join';
const getCh = () => { try { const v = Number(localStorage.getItem(CH_KEY)); return v >= 0 && v < 4 ? v : 0; } catch { return 0; } };
const setCh = (v) => { try { localStorage.setItem(CH_KEY, String(v)); } catch { /* */ } };

export function jumpScreen(body, lock) {
  let data = { room: null, invites: [] };
  let engine = null;          // module, loaded lazily
  let templates = null;
  let preview = null;
  let game = null, overlay = null, ws = null;
  let alive = true;
  let ch = getCh();

  const call = async (path, payload) => {
    try {
      data = await api(path, { method: payload === undefined ? 'GET' : 'POST', body: payload });
      return true;
    } catch (err) {
      if (err.status === 423) { lock(); return false; }
      toastErr(err); return false;
    }
  };

  async function loadEngine(onProgress) {
    engine ||= await import('../jump/engine.js');
    templates ||= await engine.loadTemplates(onProgress);
    return engine;
  }

  // ---------------------------------------------------------------- lobby
  function render() {
    if (!alive || game) return;
    preview?.destroy(); preview = null;
    const r = data.room;
    body.innerHTML = `<div class="kg-lobby pj-lobby">
      <div class="glass card pj-hero">
        <div class="pj-stage"><canvas class="pj-preview" aria-label="${t('Choose your panda')}"></canvas><div class="pj-loading">${icon('zap')} ${t('Loading pandas…')}</div></div>
        <h2>${t('Panda Jump')}</h2>
        <p class="muted">${t('Jump across floating islands, collect lightning bolts and reach the PANDA EV charging station. Race your colleagues and push them into the sea!')}</p>
        <div class="pj-pick" role="radiogroup" aria-label="${t('Choose your panda')}"></div>
        ${r ? `<div class="pj-inroom"><b>${esc(t('You are in room {code}', { code: r.id }))}</b><small class="muted">${t('{n} players', { n: r.players.length })}</small></div>
          <div class="kg-hero-btns"><button class="btn btn-primary btn-lg" id="pj-enter">${icon('play')} ${t('Enter the game')}</button><button class="btn" id="pj-leave">${icon('logout')} ${t('Leave room')}</button></div>`
        : `<div class="kg-hero-btns"><button class="btn btn-primary" id="pj-create">${icon('users')} ${t('Play with colleagues')}</button>
          <button class="btn" id="pj-solo">${icon('play')} ${t('Play alone')}</button></div>
          <form class="kg-join" id="pj-join"><input class="input" name="code" maxlength="6" placeholder="${t('Room code')}" autocapitalize="characters" autocomplete="off" aria-label="${t('Room code')}"><button class="btn">${t('Join')}</button></form>`}
      </div>
      ${r ? '' : invitesCard()}
      <details class="glass card kg-rules"><summary>${icon('file')} ${t('How to play')}</summary><ul>
        <li>${t('Computer: WASD or arrow keys to move, Space to jump (press again in the air for a double jump), F to push, drag the mouse to turn the camera.')}</li>
        <li>${t('Phone / iPad: touch and drag on the left side to move, ⤒ to jump, ✋ to push, drag on the right side to turn the camera. Landscape is best.')}</li>
        <li>${t('Flags are checkpoints. Fall into the sea and you start again from the last flag.')}</li>
        <li>${t('Pink pads bounce you high, orange blocks crumble, blue blocks blink on and off, red bars knock you away.')}</li>
        <li>${t('With colleagues: everyone plays in the same world. The host starts a race; the first to reach the charging station wins. Pushing someone into the sea counts as a knock-out 💥.')}</li>
        <li>${t('Jump on a friend’s head to bounce higher.')}</li>
      </ul></details>
    </div>`;
    const pick = $('.pj-pick', body);
    const drawPick = () => {
      pick.innerHTML = (engine?.CHARACTERS || []).map((c, i) => `<button class="pj-pick-b ${i === ch ? 'on' : ''}" role="radio" aria-checked="${i === ch}" data-ch="${i}"><i style="background:${c.color}"></i>${esc(t(c.name))}</button>`).join('');
      $$('[data-ch]', pick).forEach((b) => b.addEventListener('click', () => choose(Number(b.dataset.ch))));
    };
    const choose = (i) => { ch = i; setCh(i); preview?.set(i); drawPick(); };
    $('#pj-create', body)?.addEventListener('click', async () => { if (await call('/api/jump/create', { ch })) startGame('multi'); });
    $('#pj-solo', body)?.addEventListener('click', () => startGame('solo'));
    $('#pj-join', body)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim().toUpperCase();
      if (code && await call('/api/jump/join', { code, ch })) startGame('multi');
    });
    $$('[data-join]', body).forEach((b) => b.addEventListener('click', async () => { if (await call('/api/jump/join', { code: b.dataset.join, ch })) startGame('multi'); }));
    $('#pj-enter', body)?.addEventListener('click', () => startGame('multi'));
    $('#pj-leave', body)?.addEventListener('click', async () => { await call('/api/jump/leave', {}); render(); });

    const stage = $('.pj-stage', body);
    loadEngine((p) => { const l = $('.pj-loading', stage); if (l) l.textContent = `${t('Loading pandas…')} ${Math.round(p * 100)}%`; })
      .then(() => {
        if (!alive || game || !stage.isConnected) return;
        drawPick();
        $('.pj-loading', stage)?.remove();
        preview = engine.createPreview($('.pj-preview', stage), templates, { index: ch, onPick: choose });
      })
      .catch((err) => { console.error(err); const l = $('.pj-loading', stage); if (l) l.textContent = t('Could not load the 3D game. Please refresh the page.'); });
  }

  const invitesCard = () => {
    const inv = data.invites;
    return `<div class="glass card"><h3 class="card-title">${icon('bell')} ${t('Invitations')}</h3>
      ${inv.length ? inv.map((i) => `<div class="kg-inv"><div><b>${esc(t('Room {code}', { code: i.id }))}</b><small class="muted">${esc(t('Host: {name}', { name: i.host }))} · ${t('{n} players', { n: i.players })}${i.status !== 'free' ? ` · ${t('Racing')}` : ''}</small></div><button class="btn btn-sm btn-primary" data-join="${esc(i.id)}">${t('Join')}</button></div>`).join('')
        : `<p class="muted" style="margin:0">${t('No invitations yet. When someone invites you, it shows up here.')}</p>`}</div>`;
  };

  // ---------------------------------------------------------------- game
  async function startGame(mode) {
    if (game) return;
    overlay = document.createElement('div');
    overlay.className = 'pj-overlay';
    overlay.innerHTML = `<div class="pj-boot">${icon('zap')} ${t('Loading pandas…')}</div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('pj-open');
    // Phones: go full screen (must happen inside the tap)
    if (matchMedia('(pointer: coarse)').matches) overlay.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    preview?.destroy(); preview = null;
    try { await loadEngine(); } catch (err) { console.error(err); closeOverlay(); toast(t('Could not load the 3D game. Please refresh the page.'), 'err'); return; }
    if (!alive) return closeOverlay();
    const root = document.createElement('div');
    overlay.replaceChildren(root);
    game = engine.createGame(root, {
      templates, ch, mode, meId: S.me.id, t,
      send: mode === 'multi' ? (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); } : null,
      onExit: () => exitGame(mode),
      onInvite: () => inviteDialog(),
      onCharacter: (i) => { ch = i; setCh(i); },
    });
    if (mode === 'multi') connect((m) => game?.onNet(m));
  }

  let retry = 0, retryTimer = 0;
  function connect(onMessage) {
    clearTimeout(retryTimer);
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/jump/ws`);
    ws = sock;
    let bye = false;
    sock.onopen = () => { retry = 0; };
    sock.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'bye') { bye = true; if (m.reason) toast(t(m.reason), 'info'); closeGame(); return; }
      onMessage(m);
    };
    sock.onclose = () => {
      if (ws !== sock || bye || !game) return;
      if (++retry > 8) { toast(t('Lost the connection to the room'), 'err'); closeGame(); return; }
      retryTimer = setTimeout(() => { if (game) connect(onMessage); }, Math.min(4000, 600 * retry));
    };
  }

  async function exitGame(mode) {
    if (mode === 'multi') {
      if (!(await confirmDialog(t('Leave room'), t('You can join again with the room code.'), { ok: t('Leave') }))) return;
      await call('/api/jump/leave', {});
    }
    closeGame();
  }
  function closeGame() {
    clearTimeout(retryTimer);
    const sock = ws; ws = null;
    if (sock) { sock.onclose = null; try { sock.close(); } catch { /* */ } }
    game?.destroy(); game = null;
    closeOverlay();
    if (alive) call('/api/jump').then(render);
  }
  function closeOverlay() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    overlay?.remove(); overlay = null;
    document.body.classList.remove('pj-open');
  }

  // ---------------------------------------------------------------- invite
  async function inviteDialog() {
    let online = new Set();
    try { online = new Set(await api('/api/cards/online')); } catch (err) { if (err.status === 423) return lock(); }
    const r = data.room?.id ? data.room : (await api('/api/jump').catch(() => ({}))).room;
    if (!r) return;
    const inRoom = new Set(r.players.map((p) => p.id));
    const seen = new Set();
    const people = [...(S.colleagues || []), ...(S.users || [])].filter((u) => u.id !== S.me.id && !inRoom.has(u.id) && !seen.has(u.id) && seen.add(u.id))
      .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.name.localeCompare(b.name));
    const m = openModal(`<div class="modal-head"><h2>${icon('userPlus')} ${t('Invite players')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
      <p class="hint" style="margin-top:0">${t('People with a green dot have the app open and get the invite right away. Others can join later with the code {code}.', { code: `<b>${esc(r.id)}</b>` })}</p>
      <div class="search" style="margin-bottom:10px"><span>${icon('search')}</span><input class="input" id="ji-q" type="search" placeholder="${t('Search name…')}"></div>
      <div class="check-list" id="ji-list">${people.map((u) => `<label class="check-item" data-q="${esc(u.name.toLowerCase())}"><input type="checkbox" value="${u.id}">${avatar({ ...u, presence: online.has(u.id) ? 'available' : 'away' }, 'sm', true)}<span style="flex:1;min-width:0">${esc(u.name)}</span>${r.invited?.includes(u.id) ? `<small class="muted">${t('Invited')}</small>` : ''}</label>`).join('') || `<p class="muted">${t('No one else to invite')}</p>`}</div>
      <div class="modal-foot"><button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" id="ji-send">${icon('check')} ${t('Send invites')}</button></div>`);
    $('#ji-q', m.el).addEventListener('input', (e) => { const qv = e.target.value.trim().toLowerCase(); $$('[data-q]', m.el).forEach((el) => { el.hidden = qv && !el.dataset.q.includes(qv); }); });
    $('#ji-send', m.el).addEventListener('click', async () => {
      const ids = $$('#ji-list input:checked', m.el).map((i) => Number(i.value));
      if (!ids.length) return toast(t('Choose at least one person'), 'info');
      if (await call('/api/jump/invite', { ids })) { toast(t('Invites sent'), 'ok'); m.close(); }
    });
  }

  // ---------------------------------------------------------------- start
  async function joinPending() {
    let code = null;
    try { code = sessionStorage.getItem(JUMP_JOIN_KEY); sessionStorage.removeItem(JUMP_JOIN_KEY); } catch { /* */ }
    if (!code || game) return;
    if (data.room?.id === code || await call('/api/jump/join', { code, ch })) startGame('multi');
  }
  const onInvite = () => { if (!game) call('/api/jump').then(render); };
  const onJoin = () => joinPending();
  window.addEventListener('tw:cards-invite', onInvite);
  window.addEventListener('tw:jump-join', onJoin);

  body.innerHTML = '<div class="skeleton" style="min-height:300px"></div>';
  call('/api/jump').then((ok) => { if (ok) { render(); joinPending(); } });

  return () => {
    alive = false;
    window.removeEventListener('tw:cards-invite', onInvite);
    window.removeEventListener('tw:jump-join', onJoin);
    preview?.destroy();
    if (game) closeGame();
  };
}
