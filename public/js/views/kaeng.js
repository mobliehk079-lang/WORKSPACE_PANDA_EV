// Kaeng (ໄພ່ແຄງ) — real-time multiplayer card game. Rooms live only in server memory (src/kaeng.js);
// updates arrive over the app's live stream as 'tw:kaeng' events.
import { S, api, esc, $, $$, icon, avatar, openModal, confirmDialog, toast, toastErr, t } from '../utils.js';

const SUITS = [['♣', 'black'], ['♦', 'red'], ['♥', 'red'], ['♠', 'black']];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rankOf = (c) => c % 13;
const pts = (c) => Math.min(rankOf(c) + 1, 10);
const JOIN_KEY = 'pev-kaeng-join';

const cardHtml = (c, { sel = false, small = false, attr = '' } = {}) => {
  const [suit, color] = SUITS[Math.floor(c / 13)];
  return `<span class="kc ${color} ${small ? 'sm' : ''} ${sel ? 'sel' : ''}" ${attr}><b>${RANKS[rankOf(c)]}</b><i>${suit}</i></span>`;
};
const backs = (n) => `<span class="kc-backs">${Array.from({ length: Math.min(n, 7) }, () => '<span class="kc back sm"></span>').join('')}</span>`;

export function kaengScreen(body, lock) {
  let data = { room: null, invites: [] };
  let sel = [];
  let online = new Set();
  const nameOf = (id) => data.room?.players.find((p) => p.id === id)?.name || '?';

  const call = async (path, payload) => {
    try {
      const d = await api(path, { method: payload === undefined ? 'GET' : 'POST', body: payload });
      data = d; sel = []; render();
      return true;
    } catch (err) {
      if (err.status === 423) { lock(); return false; }
      toastErr(err); return false;
    }
  };
  const act = (action, cards) => call('/api/kaeng/action', { action, cards });

  async function joinPending() {
    let code = null;
    try { code = sessionStorage.getItem(JOIN_KEY); sessionStorage.removeItem(JOIN_KEY); } catch { /* */ }
    if (code && data.room?.id !== code) await call('/api/kaeng/join', { code });
  }

  // ---------------------------------------------------------------- views
  function render() {
    const r = data.room;
    if (!r) return lobby();
    if (r.status === 'playing') return table(r);
    return roomView(r);
  }

  function lobby() {
    body.innerHTML = `<div class="kg-lobby">
      <div class="glass card kg-hero">
        <div class="kg-hero-cards">${[0, 25, 38, 51].map((c) => cardHtml(c)).join('')}</div>
        <h2>${t('Kaeng')}</h2>
        <p class="muted">${t('Play together in real time. Create a room and invite your colleagues (2–6 players).')}</p>
        <button class="btn btn-primary" id="kg-create">${icon('plus')} ${t('Create room')}</button>
        <form class="kg-join" id="kg-join"><input class="input" name="code" maxlength="5" placeholder="${t('Room code')}" autocapitalize="characters" autocomplete="off" aria-label="${t('Room code')}"><button class="btn">${t('Join')}</button></form>
      </div>
      <div class="glass card">
        <h3 class="card-title">${icon('bell')} ${t('Invitations')}</h3>
        ${data.invites.length ? data.invites.map((i) => `<div class="kg-inv"><div><b>${esc(t('Room {code}', { code: i.id }))}</b><small class="muted">${esc(t('Host: {name}', { name: i.host }))} · ${t('{n} players', { n: i.players })}${i.status === 'playing' ? ` · ${t('Playing')}` : ''}</small></div><button class="btn btn-sm btn-primary" data-join="${esc(i.id)}">${t('Join')}</button></div>`).join('')
          : `<p class="muted" style="margin:0">${t('No invitations yet. When someone invites you, it shows up here.')}</p>`}
      </div>
      ${rulesCard()}
    </div>`;
    $('#kg-create', body).addEventListener('click', () => call('/api/kaeng/create', {}));
    $('#kg-join', body).addEventListener('submit', (e) => { e.preventDefault(); const code = e.target.code.value.trim().toUpperCase(); if (code) call('/api/kaeng/join', { code }); });
    $$('[data-join]', body).forEach((b) => b.addEventListener('click', () => call('/api/kaeng/join', { code: b.dataset.join })));
  }

  const rulesCard = () => `<details class="glass card kg-rules"><summary>${icon('file')} ${t('How to play')}</summary><ul>
    <li>${t('Everyone gets 5 cards. The first player gets 6 and starts by discarding.')}</li>
    <li>${t('Points: A = 1, 2–10 as shown, J/Q/K = 10. The lowest total wins.')}</li>
    <li>${t('On your turn: draw 1 card, then discard 1 card or 2–4 cards of the same rank.')}</li>
    <li>${t('Lai: if you hold the same rank as the last discard, you may follow with it instead of drawing.')}</li>
    <li>${t('Kaeng: at the start of your turn, call Kaeng to show all hands. If nobody is lower than you (a tie counts), you win.')}</li>
    <li>${t('Empty your hand and you win at once. If the draw pile runs out, the lowest hand wins.')}</li>
  </ul></details>`;

  function playersHtml(r, { revealed = false } = {}) {
    return `<div class="kg-players">${r.players.map((p) => {
      const won = revealed && r.result?.winners.includes(p.id);
      const hand = revealed ? r.result?.hands[p.id] : null;
      return `<div class="kg-player ${won ? 'won' : ''} ${p.online ? '' : 'off'}">
        ${avatar(p, 'lg')}<div class="kg-pmeta"><b>${esc(p.name)}${p.id === r.me ? ` <span class="chip">${t('You')}</span>` : ''}</b>
        <small>${p.id === r.hostId ? `${icon('trophy')} ${t('Host')} · ` : ''}${t('{n} wins', { n: p.wins })}${p.online ? '' : ` · ${t('Offline')}`}</small></div>
        ${hand ? `<div class="kg-reveal">${hand.map((c) => cardHtml(c, { small: true })).join('')}<span class="kg-total">${r.result.totals[p.id]}</span></div>` : ''}
        ${won ? `<span class="kg-win">${t('Winner')}</span>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  function resultText(res) {
    const w = res.winners.map(nameOf).join(', ');
    if (res.reason === 'kaeng') return res.winners.includes(res.by) ? t('{name} called Kaeng and nobody was lower', { name: nameOf(res.by) }) : t('{name} called Kaeng, but {winner} was lower', { name: nameOf(res.by), winner: w });
    if (res.reason === 'out') return t('{name} discarded every card', { name: w });
    if (res.reason === 'follow-out') return t('{name} followed and emptied their hand', { name: w });
    return t('The draw pile ran out — the lowest hand wins');
  }

  function roomView(r) {
    const host = r.hostId === r.me;
    body.innerHTML = `<div class="kg-room">
      <div class="glass card">
        <div class="kg-room-head">
          <div><small class="muted">${t('Room code')}</small><div class="kg-code">${esc(r.id)}</div></div>
          <div class="spacer"></div>
          <button class="btn" id="kg-invite">${icon('userPlus')} ${t('Invite')}</button>
          <button class="btn btn-ghost" id="kg-leave">${icon('logout')} ${t('Leave')}</button>
        </div>
        ${r.result ? `<div class="kg-result">${icon('trophy')}<div><b>${esc(resultText(r.result))}</b><small>${t('Round {n} is over. The cards are not saved.', { n: r.round })}</small></div></div>` : ''}
        ${playersHtml(r, { revealed: !!r.result })}
        <div class="kg-start">
          ${host ? `<button class="btn btn-primary btn-lg" id="kg-start" ${r.players.length < 2 ? 'disabled' : ''}>${icon('play')} ${r.result ? t('Play again') : t('Start game')}</button>
            ${r.players.length < 2 ? `<small class="muted">${t('Invite at least 1 more player to start')}</small>` : ''}`
            : `<span class="muted">${icon('clock')} ${t('Waiting for {name} to start…', { name: esc(nameOf(r.hostId)) })}</span>`}
        </div>
      </div>
      ${logHtml(r)}
      ${rulesCard()}
    </div>`;
    $('#kg-invite', body).addEventListener('click', () => inviteDialog(r));
    $('#kg-leave', body).addEventListener('click', leave);
    $('#kg-start', body)?.addEventListener('click', () => call('/api/kaeng/start', {}));
  }

  const logHtml = (r) => `<div class="glass card kg-log"><h3 class="card-title">${icon('message')} ${t('Table talk')}</h3>
    ${[...r.log].reverse().map((l) => `<div><span>${esc(t(l.key, l.params))}</span>${l.params.cards ? `<span class="kg-log-cards">${l.params.cards.map((c) => cardHtml(c, { small: true })).join('')}</span>` : ''}</div>`).join('')}</div>`;

  async function leave() {
    const playing = data.room?.status === 'playing';
    if (!(await confirmDialog(t('Leave room'), playing ? t('The round will be cancelled for everyone.') : t('You can join again with the room code.'), { ok: t('Leave'), danger: playing }))) return;
    call('/api/kaeng/leave', {});
  }

  function table(r) {
    const mine = r.turn === r.me;
    const opps = [...r.order.slice(r.order.indexOf(r.me) + 1), ...r.order.slice(0, r.order.indexOf(r.me))];
    const pl = (id) => r.players.find((p) => p.id === id);
    const lastRank = r.last ? rankOf(r.last.cards[0]) : null;
    const selRank = sel.length ? rankOf(sel[0]) : null;
    let status;
    if (!mine) status = `${icon('hourglass')} ${t("{name}'s turn", { name: esc(nameOf(r.turn)) })}`;
    else if (r.drawn) status = `${icon('zap')} ${t('Your turn: choose card(s) to discard')}`;
    else status = `${icon('zap')} ${r.canFollow ? t('Your turn: draw, follow (Lai) or call Kaeng') : t('Your turn: draw a card or call Kaeng')}`;
    body.innerHTML = `<div class="kg-table">
      <div class="kg-opps">${opps.map((id) => { const p = pl(id); return `<div class="kg-opp ${r.turn === id ? 'turn' : ''} ${p.online ? '' : 'off'}">${avatar(p, '')}<div class="kg-pmeta"><b>${esc(p.name)}</b><small>${t('{n} cards', { n: p.cards })}</small></div>${backs(p.cards)}</div>`; }).join('')}</div>
      <div class="kg-center">
        <div class="kg-pile">${r.deck ? '<span class="kc back"></span>' : '<span class="kc empty"></span>'}<small>${t('{n} left', { n: r.deck })}</small></div>
        <div class="kg-discard">${r.last ? `<div class="kg-last">${r.last.cards.map((c) => cardHtml(c)).join('')}</div><small>${esc(nameOf(r.last.by))}</small>` : `<span class="kc empty"></span><small>${t('Discard')}</small>`}</div>
      </div>
      <div class="kg-status ${mine ? 'mine' : ''}">${status}</div>
      <div class="kg-me ${mine ? 'turn' : ''}">
        <div class="kg-hand" id="kg-hand">${r.hand.map((c) => cardHtml(c, { sel: sel.includes(c), attr: `data-c="${c}" role="button" tabindex="0" aria-pressed="${sel.includes(c)}"` })).join('')}</div>
        <div class="kg-me-bar">
          <span class="kg-sum">${t('Your points')}: <b>${r.total}</b></span>
          <div class="spacer"></div>
          ${mine && !r.drawn ? `<button class="btn btn-primary" data-a="draw" ${r.deck ? '' : 'disabled'}>${icon('download')} ${t('Draw')}</button>
            ${r.canFollow ? `<button class="btn btn-ok" data-a="follow">${icon('zap')} ${t('Lai')}${selRank === lastRank && sel.length ? ` (${sel.length})` : ''}</button>` : ''}
            <button class="btn btn-danger" data-a="kaeng">${icon('eye')} ${t('Kaeng!')}</button>` : ''}
          ${mine && r.drawn ? `<button class="btn btn-primary" data-a="discard" ${sel.length ? '' : 'disabled'}>${icon('upload')} ${t('Discard')}${sel.length ? ` (${sel.length})` : ''}</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="kg-leave" title="${t('Leave room')}" aria-label="${t('Leave room')}">${icon('logout')}</button>
        </div>
      </div>
      ${logHtml(r)}
    </div>`;
    const hand = $('#kg-hand', body);
    const pick = (el) => {
      const c = Number(el.dataset.c);
      if (sel.includes(c)) sel = sel.filter((x) => x !== c);
      else if (sel.length && rankOf(sel[0]) !== rankOf(c)) sel = [c]; // only one rank at a time
      else sel = [...sel, c];
      table(data.room);
    };
    hand.addEventListener('click', (e) => { const el = e.target.closest('[data-c]'); if (el) pick(el); });
    hand.addEventListener('keydown', (e) => { const el = e.target.closest('[data-c]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(el); } });
    $('#kg-leave', body).addEventListener('click', leave);
    $$('[data-a]', body).forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      if (a === 'draw') return act('draw');
      if (a === 'discard') return act('discard', sel);
      if (a === 'follow') {
        const cards = sel.length && rankOf(sel[0]) === lastRank ? sel : r.hand.filter((c) => rankOf(c) === lastRank);
        return act('follow', cards);
      }
      if (a === 'kaeng') {
        if (!(await confirmDialog(t('Kaeng!'), t('Show everyone’s cards now? You have {n} points.', { n: r.total }), { ok: t('Kaeng!') }))) return;
        return act('kaeng');
      }
    }));
  }

  // ---------------------------------------------------------------- invite
  async function inviteDialog(r) {
    try { online = new Set(await api('/api/kaeng/online')); } catch (err) { if (err.status === 423) return lock(); }
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
      if (await call('/api/kaeng/invite', { ids })) { toast(t('Invites sent'), 'ok'); m.close(); }
    });
  }

  // ---------------------------------------------------------------- live
  const onRoom = (e) => {
    const before = data.room;
    data.room = e.detail;
    if (before && !data.room) api('/api/kaeng').then((d) => { data = d; render(); }).catch(() => {});
    if (data.room?.status !== 'playing') sel = [];
    else sel = sel.filter((c) => data.room.hand.includes(c));
    if (before?.status === 'playing' && data.room?.status === 'ended') navigator.vibrate?.([30, 40, 30]);
    if (data.room?.status === 'playing' && data.room.turn === data.room.me && before?.turn !== data.room.me) navigator.vibrate?.(25);
    render();
  };
  const onInvite = () => api('/api/kaeng').then((d) => { data = d; render(); }).catch(() => {});
  const onJoin = () => joinPending();
  window.addEventListener('tw:kaeng', onRoom);
  window.addEventListener('tw:kaeng-invite', onInvite);
  window.addEventListener('tw:kaeng-join', onJoin);

  body.innerHTML = '<div class="skeleton" style="min-height:300px"></div>';
  call('/api/kaeng').then((ok) => { if (ok) joinPending(); });

  return () => {
    window.removeEventListener('tw:kaeng', onRoom);
    window.removeEventListener('tw:kaeng-invite', onInvite);
    window.removeEventListener('tw:kaeng-join', onJoin);
  };
}
