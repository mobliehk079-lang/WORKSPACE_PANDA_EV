// Tiến Lên (Vietnamese card game) — the game's table, rules text and sounds. Rooms, lobby and invites: cardroom.js.
// The server (src/cards/tienlen.js) checks every play; the same rules run here only to preview a selection.
import { esc, $$, icon, t } from '../utils.js';
import { sfx } from '../sound.js';
import { cardRoomScreen, cardHtml, face, backs, SEATS, rankOf } from './cardroom.js';

const tlRank = (c) => (rankOf(c) + 11) % 13; // 3 → 0 … A → 11, 2 → 12
const SUIT_ORDER = [1, 2, 3, 0];               // ♠ < ♣ < ♦ < ♥
const value = (c) => tlRank(c) * 4 + SUIT_ORDER[Math.floor(c / 13)];
const TWO = 12;
const COMBO = { single: 'a single', pair: 'a pair', triple: 'three of a kind', quad: 'four of a kind', run: 'a run of {len}', pairs: '{len} pairs in a row' };

function classify(cards) {
  const cs = [...cards].sort((a, b) => value(a) - value(b));
  const n = cs.length;
  if (!n) return null;
  const ranks = cs.map(tlRank);
  const top = value(cs[n - 1]);
  if (n === 1) return { type: 'single', len: 1, top };
  if (ranks.every((r) => r === ranks[0]) && n <= 4) return { type: ['', '', 'pair', 'triple', 'quad'][n], len: n, top };
  const consecutive = (rs) => rs.every((r, i) => i === 0 || r === rs[i - 1] + 1) && rs[rs.length - 1] !== TWO;
  if (n >= 3 && new Set(ranks).size === n && consecutive(ranks)) return { type: 'run', len: n, top };
  if (n >= 6 && n % 2 === 0) {
    const pairs = [];
    for (let i = 0; i < n; i += 2) { if (ranks[i] !== ranks[i + 1]) return null; pairs.push(ranks[i]); }
    if (consecutive(pairs)) return { type: 'pairs', len: n / 2, top };
  }
  return null;
}
function beats(play, prev) {
  if (!prev) return true;
  if (play.type === prev.type && play.len === prev.len) return play.top > prev.top;
  const prevTwo = Math.floor(prev.top / 4) === TWO;
  if (prev.type === 'single' && prevTwo) return play.type === 'quad' || (play.type === 'pairs' && play.len >= 3);
  if (prev.type === 'pair' && prevTwo) return play.type === 'quad' || (play.type === 'pairs' && play.len >= 4);
  if (prev.type === 'quad') return play.type === 'pairs' && play.len >= 4;
  if (prev.type === 'pairs' && prev.len === 3) return play.type === 'quad' || (play.type === 'pairs' && play.len >= 4);
  return false;
}
const comboText = (c) => t(COMBO[c.type], { len: c.len });

const TIENLEN = {
  type: 'tienlen',
  heroCards: [41, 3, 27, 14],
  get blurb() { return t('Vietnamese card game for 2–4 players. Be the first to play all 13 cards.'); },
  get totalLabel() { return t('Cards left'); },
  get rules() {
    return [
      t('Everyone gets 13 cards. Cards rank 3 (lowest) … K, A, 2 (highest); suits ♠ < ♣ < ♦ < ♥.'),
      t('Play a single, a pair, three or four of a kind, a run of 3+ (no 2s), or 3+ pairs in a row.'),
      t('Beat the cards on the table with the same kind and length, with a higher top card — or pass.'),
      t('Once you pass you are out until the pile is won. When everyone else passes, you clear the pile and lead anything.'),
      t('Chop: 3 pairs in a row or four of a kind beat a single 2; four of a kind also beats a pair of 2s; 4 pairs in a row beat them all.'),
      t('The first round starts with the lowest card (3♠). After that the winner leads. Empty your hand first to win.'),
    ];
  },
  resultText(res, nameOf) { return t('{name} played every card first!', { name: res.winners.map(nameOf).join(', ') }); },
  sound(l, r, fx, ctx) {
    const k = l.key;
    if (k.includes('chopped')) {
      for (let n = 0; n < Math.min(l.params.n || 1, 6); n++) sfx.card(n * 0.05);
      sfx.kaeng(); sfx.bomb(); fx.push(() => ctx.throwBomb(l.params.by, l.params.to));
    } else if (k.includes('played')) for (let n = 0; n < Math.min(l.params.n || 1, 6); n++) sfx.card(n * 0.06);
    else if (k.includes('passed')) sfx.tick();
    else if (k.includes('won the pile')) sfx.draw();
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
  const seats = SEATS[opps.length] || SEATS[3];
  const me = pl(r.me);
  const prev = r.last ? classify(r.last.cards) : null;
  const pick = sel.length ? classify(sel) : null;
  const okPlay = mine && !!pick && beats(pick, prev) && (r.mustPlay == null || sel.includes(r.mustPlay));
  const lastLog = r.log[r.log.length - 1];
  const chopper = lastLog?.params.chop ? lastLog.params.by : null;

  let status;
  if (!mine) status = t("{name}'s turn", { name: esc(nameOf(r.turn)) });
  else if (r.mustPlay != null) status = t('You start: your play must include {card}', { card: cardHtml(r.mustPlay, { small: true }) });
  else if (!r.last) status = t('You lead: play any cards');
  else status = t('Beat {combo} or pass', { combo: esc(comboText(prev)) });
  let preview = '';
  if (mine && sel.length) {
    preview = !pick ? t('Not a valid play') : !beats(pick, prev) ? t('{combo} — does not beat the table', { combo: comboText(pick) }) : `${comboText(pick)} ✓`;
  }

  const seat = (id, [x, y]) => {
    const p = pl(id);
    const passed = r.passed.includes(id);
    return `<div class="kt-seat ${r.turn === id ? 'turn' : ''} ${p.online ? '' : 'off'} ${passed ? 'passed' : ''} ${x < 50 ? 'left' : x > 50 ? 'right' : 'top'}" data-seat="${id}" style="left:${x}%;top:${y}%">
      <div class="kt-av">${face(p)}${chopper === id ? `<span class="kt-bubble">${t('Chop!')}</span>` : passed ? `<span class="kt-bubble grey">${t('Pass')}</span>` : ''}</div>
      <div class="kt-plate"><b>${p.bot ? '🤖 ' : ''}${esc(p.name)}</b><small>${icon('trophy')} ${p.wins}</small></div>
      <div class="kt-backs">${backs(Math.min(p.cards, 4))}<span class="kt-count">${p.cards}</span></div>
    </div>`;
  };
  const pill = (a, label, cls, on, extra = '') => `<button class="kt-pill ${cls}" data-a="${a}" ${on ? '' : 'disabled'}>${label}${extra}</button>`;

  body.innerHTML = `<div class="kt tl">
    <div class="kt-felt">
      <div class="kt-oval"></div>
      <button class="kt-exit" id="kg-leave" title="${t('Leave room')}" aria-label="${t('Leave room')}">${icon('left')}</button>
      <div class="kt-room">${t('Room {code}', { code: esc(r.id) })} · ${t('Round {n}', { n: r.round })} ${ctx.muteBtn()}</div>
      ${opps.map((id, i) => seat(id, seats[i])).join('')}
      <div class="kt-pile tl-pile" id="kt-pile">${r.last ? r.last.cards.map((c, i) => cardHtml(c, { attr: `style="--i:${(i - (r.last.cards.length - 1) / 2) * (r.last.cards.length > 4 ? 0.4 : 1)}"` })).join('') : `<span class="tl-empty">${t('New pile')}</span>`}
        ${r.last ? `<small class="kt-pile-by">${esc(comboText(prev))} · ${esc(nameOf(r.last.by))}</small>` : ''}</div>
      <div class="kt-status ${mine ? 'mine' : ''}">${status}</div>
      <div class="kt-pills">
        ${pill('pass', t('Pass'), 'orange', mine && r.canPass)}
        ${pill('clear', t('Clear'), 'grey', sel.length > 0)}
        ${pill('play', t('Play cards'), 'blue', okPlay, sel.length ? ` <span>${sel.length}</span>` : '')}
      </div>
      ${preview ? `<div class="tl-preview ${okPlay ? 'ok' : 'no'}">${esc(preview)}</div>` : ''}
    </div>
    <div class="kt-me ${mine ? 'turn' : ''}">
      <div class="kt-me-who" data-seat="${r.me}">${face(me)}<div><b>${esc(me.name)}</b><small>${icon('trophy')} ${me.wins}</small></div></div>
      <div class="kt-hand many" id="kg-hand" style="--n:${r.hand.length}">${r.hand.map((c, i) => cardHtml(c, { sel: sel.includes(c), attr: `data-c="${c}" role="button" tabindex="0" aria-pressed="${sel.includes(c)}" style="--i:${i - (r.hand.length - 1) / 2}"` })).join('')}</div>
      <div class="kt-score" title="${t('Cards left')}"><small>${t('Cards')}</small><b>${r.hand.length}</b></div>
    </div>
    ${ctx.logHtml(r)}
  </div>`;

  ctx.flyIn(r);
  ctx.bindHand((c) => { ctx.sel = ctx.sel.includes(c) ? ctx.sel.filter((x) => x !== c) : [...ctx.sel, c]; });
  body.querySelector('#kg-leave').addEventListener('click', ctx.leave);
  ctx.bindMute();
  $$('[data-a]', body).forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'pass') return ctx.act('pass');
    if (a === 'play') return ctx.act('play', ctx.sel);
    if (a === 'clear') { ctx.sel = []; ctx.redraw(); }
  }));
}

export const tienlenScreen = (body, lock) => cardRoomScreen(body, lock, TIENLEN);
