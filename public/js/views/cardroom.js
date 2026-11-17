// Shared screen for the multiplayer card games (Kaeng, Tiến Lên): lobby, waiting room, invites,
// sounds and effects. Each game supplies its rules text and its table (see kaeng.js / tienlen.js).
// Rooms live only in server memory (src/cards/); updates arrive over the app's live stream as 'tw:cards' events.
import { S, api, esc, $, $$, icon, avatar, openModal, confirmDialog, toast, toastErr, t } from '../utils.js';
import { sfx, unlock, isMuted, setMuted } from '../sound.js';

export const SUITS = [['♣', 'black'], ['♦', 'red'], ['♥', 'red'], ['♠', 'black']];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const rankOf = (c) => c % 13;
export const JOIN_KEY = 'pev-cards-join';
export const GAME_TITLE = { kaeng: () => t('Kaeng'), tienlen: () => t('Tien Len') };

export const cardHtml = (c, { sel = false, small = false, attr = '' } = {}) => {
  const [suit, color] = SUITS[Math.floor(c / 13)];
  return `<span class="kc ${color} ${small ? 'sm' : ''} ${sel ? 'sel' : ''}" ${attr}><b>${RANKS[rankOf(c)]}</b><i>${suit}</i></span>`;
};
const BOT_COLORS = [['#22d3ee', '#2563eb'], ['#a3e635', '#16a34a'], ['#fbbf24', '#ea580c'], ['#f472b6', '#9333ea'], ['#94a3b8', '#475569']];
/** Player face: profile photo (or initials) for people, a robot for practice bots */
export const face = (p, size = 'lg') => {
  if (!p.bot) return avatar(p, size);
  const [a, b] = BOT_COLORS[((p.botNo || 1) - 1) % BOT_COLORS.length];
  return `<span class="avatar ${size} kg-botav" style="--dc1:${a};--dc2:${b}" title="${esc(p.name)}">🤖</span>`;
};
export const backs = (n) => `<span class="kc-backs">${Array.from({ length: Math.min(n, 7) }, () => '<span class="kc back sm"></span>').join('')}</span>`;
/** Seats around the oval, clockwise from my left (I sit at the bottom). [left %, top %] */
export const SEATS = {
  1: [[50, 9]],
  2: [[8, 40], [92, 40]],
  3: [[8, 46], [50, 9], [92, 46]],
  4: [[8, 62], [16, 16], [84, 16], [92, 62]],
  5: [[7, 64], [12, 22], [50, 9], [88, 22], [93, 64]],
};
/** Log params may hold a message key (e.g. the kind of play) that needs translating first */
export const logText = (l) => {
  const p = { ...l.params };
  if (p.combo) p.combo = t(p.combo, { len: p.len });
  return t(l.key, p);
};

/**
 * game: { type, rules: [..], blurb, heroCards, resultText(res, nameOf), totalLabel,
 *         table(ctx, r), sound(l, r, fx, ctx) → true if handled }
 */
export function cardRoomScreen(body, lock, game) {
  let data = { room: null, invites: [] };
  let online = new Set();
  const ctx = { body, sel: [], nameOf: (id) => data.room?.players.find((p) => p.id === id)?.name || '?' };
  const { nameOf } = ctx;

  const call = async (path, payload) => {
    try {
      const d = await api(path, { method: payload === undefined ? 'GET' : 'POST', body: payload });
      data = d; ctx.sel = []; render();
      return true;
    } catch (err) {
      if (err.status === 423) { lock(); return false; }
      toastErr(err); return false;
    }
  };
  ctx.act = (action, cards) => call('/api/cards/action', { action, cards });
  ctx.redraw = () => game.table(ctx, data.room);

  async function joinPending() {
    let code = null;
    try { code = sessionStorage.getItem(JOIN_KEY); sessionStorage.removeItem(JOIN_KEY); } catch { /* */ }
    if (code && data.room?.id !== code) await call('/api/cards/join', { code });
  }

  // ---------------------------------------------------------------- sound + effects
  // Play a sound for every new line in the room log (each player hears the same table)
  let heard = null;
  const sigOf = (l) => `${l.at}|${l.key}|${JSON.stringify(l.params)}`;
  function sounds(r) {
    if (!r || r.type !== game.type) { heard = null; return []; }
    const sigs = r.log.map(sigOf);
    if (!heard || heard.room !== r.id) { heard = { room: r.id, sig: sigs[sigs.length - 1], turn: r.turn }; return []; }
    const i = sigs.lastIndexOf(heard.sig);
    const fresh = i >= 0 ? r.log.slice(i + 1) : r.log.slice(-1);
    heard.sig = sigs[sigs.length - 1];
    const fx = [];
    let started = false;
    ctx.delay = 0;
    for (const l of fresh) {
      if (game.sound?.(l, r, fx, ctx)) continue;
      const k = l.key;
      if (k.includes('started')) { sfx.shuffle(); started = true; }
      else if (k.includes('wins the round') || k.includes('Shared win')) {
        const won = r.result?.winners.includes(r.me);
        setTimeout(() => (won ? sfx.win() : sfx.lose()), ctx.delay + 250);
      } else if (k.includes('joined')) sfx.join();
    }
    if (r.status === 'playing' && r.turn === r.me && heard.turn !== r.me) setTimeout(() => sfx.turn(), started ? 1600 : 350);
    heard.turn = r.status === 'playing' ? r.turn : null;
    return fx;
  }

  /** A bomb arcs from one seat to another, then explodes (Kaeng: Lai, Tiến Lên: chop) */
  ctx.throwBomb = (fromId, toId) => {
    const from = $(`[data-seat="${fromId}"] .avatar`, body), to = $(`[data-seat="${toId}"] .avatar`, body);
    if (!from || !to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
    const dx = x1 - x0, dy = y1 - y0, lift = Math.max(120, Math.abs(dx) * 0.35);
    const bomb = document.createElement('div');
    bomb.className = 'kg-bomb'; bomb.textContent = '💣';
    bomb.style.left = `${x0}px`; bomb.style.top = `${y0}px`;
    document.body.appendChild(bomb);
    const steps = 12, frames = [];
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      frames.push({ transform: `translate(-50%, -50%) translate(${dx * p}px, ${dy * p - lift * 4 * p * (1 - p)}px) rotate(${p * 540}deg) scale(${1 + 0.5 * Math.sin(p * Math.PI)})` });
    }
    bomb.animate(frames, { duration: 750, easing: 'cubic-bezier(.35,.1,.6,1)', fill: 'forwards' }).onfinish = () => { bomb.remove(); explode(x1, y1, toId); };
  };
  function explode(x, y, toId) {
    const boom = document.createElement('div');
    boom.className = 'kg-boom';
    boom.style.left = `${x}px`; boom.style.top = `${y}px`;
    boom.innerHTML = '<span class="kg-boom-flash"></span><span class="kg-boom-ring"></span><span class="kg-boom-txt">💥</span>'
      + Array.from({ length: 14 }, (_, i) => `<i style="--a:${(i / 14) * 360 + Math.random() * 20}deg;--d:${60 + Math.random() * 70}px;--s:${6 + Math.random() * 8}px"></i>`).join('');
    document.body.appendChild(boom);
    setTimeout(() => boom.remove(), 1100);
    const seat = $(`[data-seat="${toId}"]`, body);
    seat?.classList.add('hit'); setTimeout(() => seat?.classList.remove('hit'), 900);
    const felt = $('.kt-felt', body);
    felt?.classList.add('shake'); setTimeout(() => felt?.classList.remove('shake'), 500);
    navigator.vibrate?.([40, 30, 60]);
  }
  /** Played cards fly into the middle from whoever played them */
  let lastKey = '';
  ctx.flyIn = (r) => {
    const key = r.last ? `${r.last.by}:${r.last.cards.join(',')}` : '';
    if (key && key !== lastKey) {
      const pile = $('#kt-pile', body);
      const from = r.last.by === r.me ? $('#kg-hand', body) : $(`[data-seat="${r.last.by}"]`, body);
      if (pile && from) {
        const a = pile.getBoundingClientRect(), b = from.getBoundingClientRect();
        pile.style.setProperty('--fx', `${b.left + b.width / 2 - (a.left + a.width / 2)}px`);
        pile.style.setProperty('--fy', `${b.top + b.height / 2 - (a.top + a.height / 2)}px`);
        pile.classList.add('fly');
      }
    }
    lastKey = key;
  };
  ctx.muteBtn = () => `<button class="kg-mute" id="kg-mute" title="${isMuted() ? t('Sound off') : t('Sound on')}" aria-label="${isMuted() ? t('Sound off') : t('Sound on')}" aria-pressed="${!isMuted()}">${isMuted() ? '🔇' : '🔊'}</button>`;
  ctx.bindMute = () => $('#kg-mute', body)?.addEventListener('click', (e) => {
    setMuted(!isMuted());
    e.currentTarget.outerHTML = ctx.muteBtn(); ctx.bindMute();
    if (!isMuted()) sfx.tick();
  });
  /** Tap cards in the hand to select them; the game decides what a valid selection is */
  ctx.bindHand = (pick) => {
    const hand = $('#kg-hand', body);
    const go = (el) => { pick(Number(el.dataset.c)); sfx.tick(); ctx.redraw(); };
    hand.addEventListener('click', (e) => { const el = e.target.closest('[data-c]'); if (el) go(el); });
    hand.addEventListener('keydown', (e) => { const el = e.target.closest('[data-c]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(el); } });
  };
  const onGesture = () => unlock();
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);

  // ---------------------------------------------------------------- views
  function render() {
    const fx = sounds(data.room);
    const r = data.room;
    if (!r) lobby();
    else if (r.type !== game.type) otherGame(r);
    else if (r.status === 'playing') game.table(ctx, r);
    else roomView(r);
    fx.forEach((f) => f());
  }

  function otherGame(r) {
    body.innerHTML = `<div class="kg-lobby"><div class="glass card kg-hero">
      <h2>${esc(t('You are in a {game} room', { game: GAME_TITLE[r.type]?.() || r.type }))}</h2>
      <p class="muted">${t('Leave that room first to play here.')}</p>
      <div class="kg-hero-btns"><a class="btn btn-primary" href="#/game/${esc(r.type)}">${t('Go to my room')}</a><button class="btn" id="kg-leave">${icon('logout')} ${t('Leave room')}</button></div>
    </div></div>`;
    $('#kg-leave', body).addEventListener('click', () => call('/api/cards/leave', {}));
  }

  function lobby() {
    const invites = data.invites.filter((i) => i.type === game.type);
    body.innerHTML = `<div class="kg-lobby">
      <div class="glass card kg-hero">
        <div class="kg-hero-cards">${game.heroCards.map((c) => cardHtml(c)).join('')}</div>
        <h2>${GAME_TITLE[game.type]()}</h2>
        <p class="muted">${game.blurb}</p>
        <div class="kg-hero-btns"><button class="btn btn-primary" id="kg-create">${icon('plus')} ${t('Create room')}</button>
          <button class="btn" id="kg-practice">🤖 ${t('Practice with bots')}</button></div>
        <form class="kg-join" id="kg-join"><input class="input" name="code" maxlength="5" placeholder="${t('Room code')}" autocapitalize="characters" autocomplete="off" aria-label="${t('Room code')}"><button class="btn">${t('Join')}</button></form>
      </div>
      <div class="glass card">
        <h3 class="card-title">${icon('bell')} ${t('Invitations')}</h3>
        ${invites.length ? invites.map((i) => `<div class="kg-inv"><div><b>${esc(t('Room {code}', { code: i.id }))}</b><small class="muted">${esc(t('Host: {name}', { name: i.host }))} · ${t('{n} players', { n: i.players })}${i.status === 'playing' ? ` · ${t('Playing')}` : ''}</small></div><button class="btn btn-sm btn-primary" data-join="${esc(i.id)}">${t('Join')}</button></div>`).join('')
          : `<p class="muted" style="margin:0">${t('No invitations yet. When someone invites you, it shows up here.')}</p>`}
      </div>
      ${rulesCard()}
    </div>`;
    $('#kg-create', body).addEventListener('click', () => call('/api/cards/create', { type: game.type }));
    $('#kg-practice', body).addEventListener('click', () => call('/api/cards/create', { type: game.type, bots: 3 }));
    $('#kg-join', body).addEventListener('submit', (e) => { e.preventDefault(); const code = e.target.code.value.trim().toUpperCase(); if (code) call('/api/cards/join', { code }); });
    $$('[data-join]', body).forEach((b) => b.addEventListener('click', () => call('/api/cards/join', { code: b.dataset.join })));
  }

  const rulesCard = () => `<details class="glass card kg-rules"><summary>${icon('file')} ${t('How to play')}</summary><ul>${game.rules.map((x) => `<li>${x}</li>`).join('')}</ul></details>`;

  function playersHtml(r, { revealed = false } = {}) {
    const rank = r.result?.ranking;
    const players = revealed && rank ? [...r.players].sort((a, b) => rank.indexOf(a.id) - rank.indexOf(b.id)) : r.players;
    return `<div class="kg-players">${players.map((p) => {
      const won = revealed && r.result?.winners.includes(p.id);
      const hand = revealed ? r.result?.hands[p.id] : null;
      return `<div class="kg-player ${won ? 'won' : ''} ${p.online ? '' : 'off'}">
        ${revealed && rank ? `<span class="kg-place">${rank.indexOf(p.id) + 1}</span>` : ''}
        ${face(p)}<div class="kg-pmeta"><b>${esc(p.name)}${p.id === r.me ? ` <span class="chip">${t('You')}</span>` : ''}${p.bot ? ` <span class="chip">🤖 ${t('Bot')}</span>` : ''}</b>
        <small>${p.id === r.hostId ? `${icon('trophy')} ${t('Host')} · ` : ''}${t('{n} wins', { n: p.wins })}${p.online ? '' : ` · ${t('Offline')}`}</small></div>
        ${hand ? `<div class="kg-reveal">${hand.map((c) => cardHtml(c, { small: true })).join('')}<span class="kg-total" title="${esc(game.totalLabel)}">${r.result.totals[p.id]}</span></div>` : ''}
        ${won ? `<span class="kg-win">${t('Winner')}</span>` : ''}
        ${p.bot && r.hostId === r.me ? `<button class="btn btn-sm btn-icon btn-ghost" data-rmbot="${p.id}" title="${t('Remove bot')}" aria-label="${t('Remove bot')}">${icon('x')}</button>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function roomView(r) {
    const host = r.hostId === r.me;
    body.innerHTML = `<div class="kg-room">
      <div class="glass card">
        <div class="kg-room-head">
          <div><small class="muted">${t('Room code')}</small><div class="kg-code">${esc(r.id)}</div></div>
          <div class="spacer"></div>
          ${ctx.muteBtn()}
          <button class="btn" id="kg-invite">${icon('userPlus')} ${t('Invite')}</button>
          ${host && r.players.length < r.max ? `<button class="btn" id="kg-addbot">🤖 ${t('Add bot')}</button>` : ''}
          <button class="btn btn-ghost" id="kg-leave">${icon('logout')} ${t('Leave')}</button>
        </div>
        ${r.result ? `<div class="kg-result">${icon('trophy')}<div><b>${esc(game.resultText(r.result, nameOf))}</b><small>${t('Round {n} is over. The cards are not saved.', { n: r.round })}</small></div></div>` : ''}
        ${playersHtml(r, { revealed: !!r.result })}
        <div class="kg-start">
          ${host ? `<button class="btn btn-primary btn-lg" id="kg-start" ${r.players.length < 2 ? 'disabled' : ''}>${icon('play')} ${r.result ? t('Play again') : t('Start game')}</button>
            ${r.players.length < 2 ? `<small class="muted">${t('Invite at least 1 more player to start')}</small>` : ''}`
            : `<span class="muted">${icon('clock')} ${t('Waiting for {name} to start…', { name: esc(nameOf(r.hostId)) })}</span>`}
        </div>
      </div>
      ${ctx.logHtml(r)}
      ${rulesCard()}
    </div>`;
    $('#kg-invite', body).addEventListener('click', () => inviteDialog(r));
    $('#kg-addbot', body)?.addEventListener('click', () => call('/api/cards/bot', { action: 'add' }));
    $$('[data-rmbot]', body).forEach((b) => b.addEventListener('click', () => call('/api/cards/bot', { action: 'remove', id: Number(b.dataset.rmbot) })));
    ctx.bindMute();
    $('#kg-leave', body).addEventListener('click', ctx.leave);
    $('#kg-start', body)?.addEventListener('click', () => call('/api/cards/start', {}));
  }

  ctx.logHtml = (r) => `<div class="glass card kg-log"><h3 class="card-title">${icon('message')} ${t('Table talk')}</h3>
    ${[...r.log].reverse().map((l) => `<div><span>${esc(logText(l))}</span>${l.params.cards ? `<span class="kg-log-cards">${l.params.cards.map((c) => cardHtml(c, { small: true })).join('')}</span>` : ''}</div>`).join('')}</div>`;

  ctx.leave = async () => {
    const playing = data.room?.status === 'playing';
    if (!(await confirmDialog(t('Leave room'), playing ? t('The round will be cancelled for everyone.') : t('You can join again with the room code.'), { ok: t('Leave'), danger: playing }))) return;
    call('/api/cards/leave', {});
  };

  // ---------------------------------------------------------------- invite
  async function inviteDialog(r) {
    try { online = new Set(await api('/api/cards/online')); } catch (err) { if (err.status === 423) return lock(); }
    const inRoom = new Set(r.players.map((p) => p.id));
    const seen = new Set();
    const people = [...(S.colleagues || []), ...(S.users || [])].filter((u) => !inRoom.has(u.id) && !seen.has(u.id) && seen.add(u.id))
      .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.name.localeCompare(b.name));
    const m = openModal(`<div class="modal-head"><h2>${icon('userPlus')} ${t('Invite players')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
      <p class="hint" style="margin-top:0">${t('People with a green dot have the app open and get the invite right away. Others can join later with the code {code}.', { code: `<b>${esc(r.id)}</b>` })}</p>
      <div class="search" style="margin-bottom:10px"><span>${icon('search')}</span><input class="input" id="ki-q" type="search" placeholder="${t('Search name…')}"></div>
      <div class="check-list" id="ki-list">${people.map((u) => `<label class="check-item" data-q="${esc(u.name.toLowerCase())}"><input type="checkbox" value="${u.id}">${avatar({ ...u, presence: online.has(u.id) ? 'available' : 'away' }, 'sm', true)}<span style="flex:1;min-width:0">${esc(u.name)}</span>${r.invited.includes(u.id) ? `<small class="muted">${t('Invited')}</small>` : ''}</label>`).join('') || `<p class="muted">${t('No one else to invite')}</p>`}</div>
      <div class="modal-foot"><button class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" id="ki-send">${icon('check')} ${t('Send invites')}</button></div>`);
    $('#ki-q', m.el).addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); $$('[data-q]', m.el).forEach((el) => { el.hidden = q && !el.dataset.q.includes(q); }); });
    $('#ki-send', m.el).addEventListener('click', async () => {
      const ids = $$('#ki-list input:checked', m.el).map((i) => Number(i.value));
      if (!ids.length) return toast(t('Choose at least one person'), 'info');
      if (await call('/api/cards/invite', { ids })) { toast(t('Invites sent'), 'ok'); m.close(); }
    });
  }

  // ---------------------------------------------------------------- live
  const onRoom = (e) => {
    const before = data.room;
    data.room = e.detail;
    if (before && !data.room) api('/api/cards').then((d) => { data = d; render(); }).catch(() => {});
    if (data.room?.status !== 'playing') ctx.sel = [];
    else ctx.sel = ctx.sel.filter((c) => data.room.hand.includes(c));
    if (before?.status === 'playing' && data.room?.status === 'ended') navigator.vibrate?.([30, 40, 30]);
    if (data.room?.status === 'playing' && data.room.turn === data.room.me && before?.turn !== data.room.me) navigator.vibrate?.(25);
    render();
  };
  const onInvite = () => api('/api/cards').then((d) => { data = d; render(); }).catch(() => {});
  const onJoin = () => joinPending();
  window.addEventListener('tw:cards', onRoom);
  window.addEventListener('tw:cards-invite', onInvite);
  window.addEventListener('tw:cards-join', onJoin);

  body.innerHTML = '<div class="skeleton" style="min-height:300px"></div>';
  call('/api/cards').then((ok) => { if (ok) joinPending(); });

  return () => {
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    window.removeEventListener('tw:cards', onRoom);
    window.removeEventListener('tw:cards-invite', onInvite);
    window.removeEventListener('tw:cards-join', onJoin);
  };
}
