// Kaeng (ໄພ່ແຄງ) — real-time multiplayer card game. Rooms live only in server memory (src/kaeng.js);
// updates arrive over the app's live stream as 'tw:kaeng' events.
import { S, api, esc, $, $$, icon, avatar, openModal, confirmDialog, toast, toastErr, t } from '../utils.js';
import { sfx, unlock, isMuted, setMuted } from '../sound.js';

const SUITS = [['♣', 'black'], ['♦', 'red'], ['♥', 'red'], ['♠', 'black']];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rankOf = (c) => c % 13;
const pts = (c) => Math.min(rankOf(c) + 1, 10);
const JOIN_KEY = 'pev-kaeng-join';

const cardHtml = (c, { sel = false, small = false, attr = '' } = {}) => {
  const [suit, color] = SUITS[Math.floor(c / 13)];
  return `<span class="kc ${color} ${small ? 'sm' : ''} ${sel ? 'sel' : ''}" ${attr}><b>${RANKS[rankOf(c)]}</b><i>${suit}</i></span>`;
};
const BOT_COLORS = [['#22d3ee', '#2563eb'], ['#a3e635', '#16a34a'], ['#fbbf24', '#ea580c'], ['#f472b6', '#9333ea'], ['#94a3b8', '#475569']];
/** Player face: profile photo (or initials) for people, a robot for practice bots */
const face = (p, size = 'lg') => {
  if (!p.bot) return avatar(p, size);
  const [a, b] = BOT_COLORS[((p.botNo || 1) - 1) % BOT_COLORS.length];
  return `<span class="avatar ${size} kg-botav" style="--dc1:${a};--dc2:${b}" title="${esc(p.name)}">🤖</span>`;
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

  // ---------------------------------------------------------------- sound
  // Play a sound for every new line in the room log (each player hears the same table)
  let heard = null;
  const sigOf = (l) => `${l.at}|${l.key}|${JSON.stringify(l.params)}`;
  function sounds(r) {
    if (!r) { heard = null; return; }
    const sigs = r.log.map(sigOf);
    if (!heard || heard.room !== r.id) { heard = { room: r.id, sig: sigs[sigs.length - 1], turn: r.turn }; return; }
    const i = sigs.lastIndexOf(heard.sig);
    const fresh = i >= 0 ? r.log.slice(i + 1) : r.log.slice(-1);
    heard.sig = sigs[sigs.length - 1];
    let delay = 0, started = false;
    const fx = [];
    for (const l of fresh) {
      const k = l.key;
      if (k.includes('started')) { sfx.shuffle(); started = true; }
      else if (k.includes('drew a card')) sfx.draw();
      else if (k.includes('discarded')) for (let n = 0; n < (l.params.n || 1); n++) sfx.card(n * 0.07);
      else if (k.includes('followed')) {
        sfx.lai();
        if (l.params.to != null) { sfx.bomb(); fx.push(() => throwBomb(l.params.by, l.params.to)); }
      }
      else if (k.includes('called Kaeng')) { sfx.kaeng(); delay = 900; }
      else if (k.includes('wins the round') || k.includes('Shared win')) {
        const won = r.result?.winners.includes(r.me);
        setTimeout(() => (won ? sfx.win() : sfx.lose()), delay + 250);
      } else if (k.includes('joined')) sfx.join();
    }
    if (r.status === 'playing' && r.turn === r.me && heard.turn !== r.me) setTimeout(() => sfx.turn(), started ? 1600 : 350);
    heard.turn = r.status === 'playing' ? r.turn : null;
    return fx;
  }

  // Lai: a bomb arcs from the player who followed to the player who was followed, then explodes
  function throwBomb(fromId, toId) {
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
  }
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
  const muteBtn = () => `<button class="kg-mute" id="kg-mute" title="${isMuted() ? t('Sound off') : t('Sound on')}" aria-label="${isMuted() ? t('Sound off') : t('Sound on')}" aria-pressed="${!isMuted()}">${isMuted() ? '🔇' : '🔊'}</button>`;
  const bindMute = () => $('#kg-mute', body)?.addEventListener('click', (e) => {
    setMuted(!isMuted());
    e.currentTarget.outerHTML = muteBtn(); bindMute();
    if (!isMuted()) sfx.tick();
  });
  const onGesture = () => unlock();
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);

  // ---------------------------------------------------------------- views
  function render() {
    const fx = sounds(data.room) || [];
    const r = data.room;
    if (!r) lobby();
    else if (r.status === 'playing') table(r);
    else roomView(r);
    fx.forEach((f) => f());
  }

  function lobby() {
    body.innerHTML = `<div class="kg-lobby">
      <div class="glass card kg-hero">
        <div class="kg-hero-cards">${[0, 25, 38, 51].map((c) => cardHtml(c)).join('')}</div>
        <h2>${t('Kaeng')}</h2>
        <p class="muted">${t('Play together in real time. Create a room and invite your colleagues (2–6 players).')}</p>
        <div class="kg-hero-btns"><button class="btn btn-primary" id="kg-create">${icon('plus')} ${t('Create room')}</button>
          <button class="btn" id="kg-practice">🤖 ${t('Practice with bots')}</button></div>
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
    $('#kg-practice', body).addEventListener('click', () => call('/api/kaeng/create', { bots: 3 }));
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
        ${face(p)}<div class="kg-pmeta"><b>${esc(p.name)}${p.id === r.me ? ` <span class="chip">${t('You')}</span>` : ''}${p.bot ? ` <span class="chip">🤖 ${t('Bot')}</span>` : ''}</b>
        <small>${p.id === r.hostId ? `${icon('trophy')} ${t('Host')} · ` : ''}${t('{n} wins', { n: p.wins })}${p.online ? '' : ` · ${t('Offline')}`}</small></div>
        ${hand ? `<div class="kg-reveal">${hand.map((c) => cardHtml(c, { small: true })).join('')}<span class="kg-total">${r.result.totals[p.id]}</span></div>` : ''}
        ${won ? `<span class="kg-win">${t('Winner')}</span>` : ''}
        ${p.bot && r.hostId === r.me ? `<button class="btn btn-sm btn-icon btn-ghost" data-rmbot="${p.id}" title="${t('Remove bot')}" aria-label="${t('Remove bot')}">${icon('x')}</button>` : ''}
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
          ${muteBtn()}
          <button class="btn" id="kg-invite">${icon('userPlus')} ${t('Invite')}</button>
          ${host && r.players.length < 6 ? `<button class="btn" id="kg-addbot">🤖 ${t('Add bot')}</button>` : ''}
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
    $('#kg-addbot', body)?.addEventListener('click', () => call('/api/kaeng/bot', { action: 'add' }));
    $$('[data-rmbot]', body).forEach((b) => b.addEventListener('click', () => call('/api/kaeng/bot', { action: 'remove', id: Number(b.dataset.rmbot) })));
    bindMute();
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

  // Seats around the oval, clockwise from my left (I sit at the bottom). [left %, top %]
  const SEATS = {
    1: [[50, 9]],
    2: [[8, 40], [92, 40]],
    3: [[8, 46], [50, 9], [92, 46]],
    4: [[8, 62], [16, 16], [84, 16], [92, 62]],
    5: [[7, 64], [12, 22], [50, 9], [88, 22], [93, 64]],
  };
  let lastKey = '';

  function table(r) {
    const mine = r.turn === r.me;
    const at = r.order.indexOf(r.me);
    const opps = [...r.order.slice(at + 1), ...r.order.slice(0, at)];
    const pl = (id) => r.players.find((p) => p.id === id);
    const lastRank = r.last ? rankOf(r.last.cards[0]) : null;
    const selRank = sel.length ? rankOf(sel[0]) : null;
    const lastLog = r.log[r.log.length - 1];
    const lastFollow = lastLog?.key.includes('followed') ? r.last?.by : null;
    const seats = SEATS[opps.length] || SEATS[5];
    const me = pl(r.me);

    let status;
    if (!mine) status = t("{name}'s turn", { name: esc(nameOf(r.turn)) });
    else if (r.drawn) status = t('Your turn: choose card(s) to discard');
    else status = r.canFollow ? t('Your turn: draw, follow (Lai) or call Kaeng') : t('Your turn: draw a card or call Kaeng');

    const seat = (id, [x, y]) => {
      const p = pl(id);
      return `<div class="kt-seat ${r.turn === id ? 'turn' : ''} ${p.online ? '' : 'off'} ${x < 50 ? 'left' : x > 50 ? 'right' : 'top'}" data-seat="${id}" style="left:${x}%;top:${y}%">
        <div class="kt-av">${face(p)}${lastFollow === id ? `<span class="kt-bubble">${t('Lai')}</span>` : ''}</div>
        <div class="kt-plate"><b>${p.bot ? '🤖 ' : ''}${esc(p.name)}</b><small>${icon('trophy')} ${p.wins}</small></div>
        <div class="kt-backs">${backs(Math.min(p.cards, 4))}<span class="kt-count">${p.cards}</span></div>
      </div>`;
    };
    const pill = (a, label, cls, on, extra = '') => `<button class="kt-pill ${cls}" data-a="${a}" ${on ? '' : 'disabled'}>${label}${extra}</button>`;

    body.innerHTML = `<div class="kt">
      <div class="kt-felt">
        <div class="kt-oval"></div>
        <button class="kt-exit" id="kg-leave" title="${t('Leave room')}" aria-label="${t('Leave room')}">${icon('left')}</button>
        <div class="kt-room">${t('Room {code}', { code: esc(r.id) })} · ${t('Round {n}', { n: r.round })} ${muteBtn()}</div>
        ${opps.map((id, i) => seat(id, seats[i])).join('')}
        <div class="kt-deck" title="${t('{n} left', { n: r.deck })}">${r.deck ? '<span class="kc back"></span><span class="kc back"></span>' : '<span class="kc empty"></span>'}<span class="kt-deck-n">${r.deck}</span></div>
        <div class="kt-pile" id="kt-pile">${r.last ? r.last.cards.map((c, i) => cardHtml(c, { attr: `style="--i:${i - (r.last.cards.length - 1) / 2}"` })).join('') : ''}
          ${r.last ? `<small class="kt-pile-by">${esc(nameOf(r.last.by))}</small>` : ''}</div>
        <div class="kt-status ${mine ? 'mine' : ''}">${status}</div>
        <div class="kt-pills">
          ${pill('kaeng', t('Call Kaeng'), 'orange', mine && !r.drawn)}
          ${mine && r.drawn
            ? pill('discard', t('Discard'), 'pink', sel.length > 0, sel.length ? ` <span>${sel.length}</span>` : '')
            : pill('draw', t('Draw'), 'blue', mine && !r.drawn && r.deck > 0)}
          ${pill('follow', t('Lai'), 'green', mine && r.canFollow, selRank === lastRank && sel.length && r.canFollow ? ` <span>${sel.length}</span>` : '')}
        </div>
      </div>
      <div class="kt-me ${mine ? 'turn' : ''}">
        <div class="kt-me-who" data-seat="${r.me}">${face(me)}<div><b>${esc(me.name)}</b><small>${icon('trophy')} ${me.wins}</small></div></div>
        <div class="kt-hand" id="kg-hand" style="--n:${r.hand.length}">${r.hand.map((c, i) => cardHtml(c, { sel: sel.includes(c), attr: `data-c="${c}" role="button" tabindex="0" aria-pressed="${sel.includes(c)}" style="--i:${i - (r.hand.length - 1) / 2}"` })).join('')}</div>
        <div class="kt-score" title="${t('Your points')}"><small>${t('Points')}</small><b>${r.total}</b></div>
      </div>
      ${logHtml(r)}
    </div>`;

    // Discarded cards fly in from whoever played them
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

    const hand = $('#kg-hand', body);
    const pick = (el) => {
      const c = Number(el.dataset.c);
      if (sel.includes(c)) sel = sel.filter((x) => x !== c);
      else if (sel.length && rankOf(sel[0]) !== rankOf(c)) sel = [c]; // only one rank at a time
      else sel = [...sel, c];
      sfx.tick();
      table(data.room);
    };
    hand.addEventListener('click', (e) => { const el = e.target.closest('[data-c]'); if (el) pick(el); });
    hand.addEventListener('keydown', (e) => { const el = e.target.closest('[data-c]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(el); } });
    $('#kg-leave', body).addEventListener('click', leave);
    bindMute();
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
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    window.removeEventListener('tw:kaeng', onRoom);
    window.removeEventListener('tw:kaeng-invite', onInvite);
    window.removeEventListener('tw:kaeng-join', onJoin);
  };
}
