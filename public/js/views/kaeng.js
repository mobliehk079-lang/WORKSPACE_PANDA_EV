// Kaeng (ໄພ່ແຄງ) — the game's table, rules text and sounds. Rooms, lobby and invites: cardroom.js.
import { esc, $$, icon, confirmDialog, t } from '../utils.js';
import { sfx } from '../sound.js';
import { cardRoomScreen, cardHtml, face, backs, SEATS, rankOf } from './cardroom.js';

const KAENG = {
  type: 'kaeng',
  heroCards: [0, 25, 38, 51],
  get blurb() { return t('Play together in real time. Create a room and invite your colleagues (2–6 players).'); },
  get totalLabel() { return t('Points'); },
  get rules() {
    return [
      t('Everyone gets 5 cards. The first player gets 6 and starts by discarding.'),
      t('Points: A = 1, 2–10 as shown, J/Q/K = 10. The lowest total wins.'),
      t('On your turn: draw 1 card, then discard 1 card or 2–4 cards of the same rank.'),
      t('Lai: if you hold the same rank as the last discard, you may follow with it instead of drawing.'),
      t('Kaeng: at the start of your turn, call Kaeng to show all hands. If nobody is lower than you (a tie counts), you win.'),
      t('Empty your hand and you win at once. If the draw pile runs out, the lowest hand wins.'),
    ];
  },
  resultText(res, nameOf) {
    const w = res.winners.map(nameOf).join(', ');
    if (res.reason === 'kaeng') return res.winners.includes(res.by) ? t('{name} called Kaeng and nobody was lower', { name: nameOf(res.by) }) : t('{name} called Kaeng, but {winner} was lower', { name: nameOf(res.by), winner: w });
    if (res.reason === 'out') return t('{name} discarded every card', { name: w });
    if (res.reason === 'follow-out') return t('{name} followed and emptied their hand', { name: w });
    return t('The draw pile ran out — the lowest hand wins');
  },
  sound(l, r, fx, ctx) {
    const k = l.key;
    if (k.includes('drew a card')) sfx.draw();
    else if (k.includes('discarded')) for (let n = 0; n < (l.params.n || 1); n++) sfx.card(n * 0.07);
    else if (k.includes('followed')) {
      sfx.lai();
      if (l.params.to != null) { sfx.bomb(); fx.push(() => ctx.throwBomb(l.params.by, l.params.to)); }
    } else if (k.includes('called Kaeng')) { sfx.kaeng(); ctx.delay = 900; }
    else return false;
    return true;
  },
  table,
};

function table(ctx, r) {
  const { body, nameOf } = ctx;
  const sel = ctx.sel;
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
      <div class="kt-room">${t('Room {code}', { code: esc(r.id) })} · ${t('Round {n}', { n: r.round })} ${ctx.muteBtn()}</div>
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
    ${ctx.logHtml(r)}
  </div>`;

  ctx.flyIn(r);
  // Only one rank can be selected at a time
  ctx.bindHand((c) => {
    if (ctx.sel.includes(c)) ctx.sel = ctx.sel.filter((x) => x !== c);
    else if (ctx.sel.length && rankOf(ctx.sel[0]) !== rankOf(c)) ctx.sel = [c];
    else ctx.sel = [...ctx.sel, c];
  });
  body.querySelector('#kg-leave').addEventListener('click', ctx.leave);
  ctx.bindMute();
  $$('[data-a]', body).forEach((b) => b.addEventListener('click', async () => {
    const a = b.dataset.a;
    if (a === 'draw') return ctx.act('draw');
    if (a === 'discard') return ctx.act('discard', ctx.sel);
    if (a === 'follow') {
      const cards = ctx.sel.length && rankOf(ctx.sel[0]) === lastRank ? ctx.sel : r.hand.filter((c) => rankOf(c) === lastRank);
      return ctx.act('follow', cards);
    }
    if (a === 'kaeng') {
      if (!(await confirmDialog(t('Kaeng!'), t('Show everyone’s cards now? You have {n} points.', { n: r.total }), { ok: t('Kaeng!') }))) return;
      return ctx.act('kaeng');
    }
  }));
}

export const kaengScreen = (body, lock) => cardRoomScreen(body, lock, KAENG);
