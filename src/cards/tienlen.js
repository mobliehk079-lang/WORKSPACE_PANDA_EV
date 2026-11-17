// Tiến Lên (Vietnamese "go forward") rules — the common Southern version.
// - 2–4 players, 13 cards each. Cards rank 3 < 4 < … < K < A < 2; suits ♠ < ♣ < ♦ < ♥.
// - Plays: single, pair, triple, four of a kind, run of 3+ ranks (a 2 can never be in a run),
//   and 3+ pairs in a row ("double run"; no 2s).
// - To beat a play: same kind and length with a higher top card.
//   Chops: 3 pairs in a row or four of a kind beat a single 2; four of a kind also beats a pair of 2s;
//   4 pairs in a row beat a single 2, a pair of 2s, four of a kind and 3 pairs in a row.
// - Once you pass you are out until the pile is won. When everyone else has passed,
//   the last player to play clears the pile and leads anything.
// - First round in a room: whoever holds the lowest card dealt (3♠ when 4 play) leads and must play it.
//   Later rounds: the last winner leads.
// - First to empty their hand wins; the others are ranked by cards left.
import { bad, rankOf, suitOf, shuffled, log, nameOf, current, myTurn, takeFrom, touch, finish } from './core.js';

const HAND = 13;
/** Strength of a rank: 3 → 0 … K → 10, A → 11, 2 → 12 */
export const tlRank = (c) => (rankOf(c) + 11) % 13;
const SUIT_ORDER = [1, 2, 3, 0]; // ♣ 1, ♦ 2, ♥ 3, ♠ 0
/** Total order of cards: rank first, then suit */
export const value = (c) => tlRank(c) * 4 + SUIT_ORDER[suitOf(c)];
const byValue = (a, b) => value(a) - value(b);
const TWO = 12;

/** What kind of play these cards make, or null when it is not a valid play */
export function classify(cards) {
  const cs = [...cards].sort(byValue);
  const n = cs.length;
  if (!n) return null;
  const ranks = cs.map(tlRank);
  const top = value(cs[n - 1]);
  const allSame = ranks.every((r) => r === ranks[0]);
  if (n === 1) return { type: 'single', len: 1, top };
  if (allSame && n <= 4) return { type: ['', '', 'pair', 'triple', 'quad'][n], len: n, top };
  const consecutive = (rs) => rs.every((r, i) => i === 0 || r === rs[i - 1] + 1) && rs[rs.length - 1] !== TWO;
  if (n >= 3 && new Set(ranks).size === n && consecutive(ranks)) return { type: 'run', len: n, top };
  if (n >= 6 && n % 2 === 0) {
    const pairs = [];
    for (let i = 0; i < n; i += 2) { if (ranks[i] !== ranks[i + 1]) return null; pairs.push(ranks[i]); }
    if (consecutive(pairs)) return { type: 'pairs', len: n / 2, top };
  }
  return null;
}

/** Can `play` go on top of `prev`? (both from classify) */
export function beats(play, prev) {
  if (!prev) return true;
  if (play.type === prev.type && play.len === prev.len) return play.top > prev.top;
  const prevTwo = Math.floor(prev.top / 4) === TWO;
  if (prev.type === 'single' && prevTwo) return play.type === 'quad' || (play.type === 'pairs' && play.len >= 3);
  if (prev.type === 'pair' && prevTwo) return play.type === 'quad' || (play.type === 'pairs' && play.len >= 4);
  if (prev.type === 'quad') return play.type === 'pairs' && play.len >= 4;
  if (prev.type === 'pairs' && prev.len === 3) return play.type === 'quad' || (play.type === 'pairs' && play.len >= 4);
  return false;
}
const isChop = (play, prev) => !!prev && (play.type !== prev.type || play.len !== prev.len);

function start(room, order) {
  const deck = shuffled();
  const hands = Object.fromEntries(order.map((id) => [id, []]));
  for (let i = 0; i < HAND; i++) for (const id of order) hands[id].push(deck.pop());
  let turn = 0, mustPlay = null;
  // First round in the room: the lowest card dealt starts (3♠ with 4 players)
  if (room.round === 0) {
    const all = order.flatMap((id) => hands[id]);
    mustPlay = all.sort(byValue)[0];
    turn = order.findIndex((id) => hands[id].includes(mustPlay));
  }
  return { hands, order, turn, last: null, passed: [], mustPlay, finished: [] };
}

function nextTurn(g) {
  const n = g.order.length;
  for (let step = 1; step <= n; step++) {
    const i = (g.turn + step) % n;
    const id = g.order[i];
    if (g.last && id === g.last.by) { g.turn = i; return 'won'; } // everybody else passed
    if (!g.passed.includes(id)) { g.turn = i; return 'next'; }
  }
  return 'next';
}

function playCards(room, uid, cards) {
  const g = room.game;
  const combo = classify(cards);
  if (!combo) throw bad('These cards do not make a valid play');
  if (g.mustPlay != null && !cards.includes(g.mustPlay)) throw bad('The first play must include your lowest card');
  if (g.last && !beats(combo, g.last.combo)) throw bad('That does not beat the cards on the table');
  g.hands[uid] = takeFrom(g.hands[uid], cards);
  const prev = g.last;
  g.last = { by: uid, cards: [...cards].sort(byValue), combo };
  g.mustPlay = null;
  const chop = isChop(combo, prev?.combo);
  log(room, chop ? '{name} chopped {victim}!' : '{name} played {combo}', {
    name: nameOf(room, uid), victim: chop ? nameOf(room, prev.by) : undefined, combo: comboKey(combo), len: combo.len, n: cards.length,
    cards: g.last.cards, by: uid, ...(chop ? { to: prev.by, chop: true } : {}),
  });
  if (!g.hands[uid].length) return end(room, uid);
  if (nextTurn(g) === 'won') newPile(room);
  touch(room);
}
function newPile(room) {
  const g = room.game;
  g.last = null; g.passed = [];
  log(room, '{name} won the pile and leads', { name: nameOf(room, current(g)) });
}

function pass(room, uid) {
  const g = room.game;
  if (!g.last) throw bad('You lead this pile — play any cards');
  g.passed.push(uid);
  log(room, '{name} passed', { name: nameOf(room, uid), by: uid });
  if (nextTurn(g) === 'won') newPile(room);
  touch(room);
}

function end(room, winner) {
  const g = room.game;
  const left = Object.fromEntries(g.order.map((id) => [id, g.hands[id].length]));
  finish(room, [winner], {
    reason: 'out', by: winner,
    hands: Object.fromEntries(g.order.map((id) => [id, [...g.hands[id]].sort(byValue)])),
    totals: left,
    ranking: [...g.order].sort((a, b) => left[a] - left[b]),
  });
}

function act(room, uid, action, cards) {
  myTurn(room, uid);
  if (action === 'play') return playCards(room, uid, cards);
  if (action === 'pass') return pass(room, uid);
  throw bad('Invalid request data');
}

export const comboKey = (c) => ({ single: 'a single', pair: 'a pair', triple: 'three of a kind', quad: 'four of a kind', run: 'a run of {len}', pairs: '{len} pairs in a row' }[c.type]);

// ---------------------------------------------------------------- bots
/** Every play in `hand` of the given kind and length (lowest first) */
function candidates(hand, type, len) {
  const cs = [...hand].sort(byValue);
  const byRank = {};
  for (const c of cs) (byRank[tlRank(c)] ||= []).push(c);
  const out = [];
  if (type === 'single') for (const c of cs) out.push([c]);
  if (type === 'pair' || type === 'triple' || type === 'quad') {
    const k = { pair: 2, triple: 3, quad: 4 }[type];
    for (const r of Object.keys(byRank)) {
      const g = byRank[r];
      if (g.length >= k) for (let i = 0; i + k <= g.length; i++) out.push([...g.slice(0, k - 1), g[i + k - 1]]);
    }
  }
  if (type === 'run') {
    for (let s = 0; s + len - 1 < TWO; s++) {
      const rs = Array.from({ length: len }, (_, i) => s + i);
      if (!rs.every((r) => byRank[r])) continue;
      for (const topCard of byRank[rs[len - 1]]) out.push([...rs.slice(0, -1).map((r) => byRank[r][0]), topCard]);
    }
  }
  if (type === 'pairs') {
    for (let s = 0; s + len - 1 < TWO; s++) {
      const rs = Array.from({ length: len }, (_, i) => s + i);
      if (rs.every((r) => byRank[r]?.length >= 2)) out.push(rs.flatMap((r) => byRank[r].slice(-2)));
    }
  }
  return out;
}
function botMove(room, id) {
  const g = room.game, hand = g.hands[id];
  if (!g.last) {
    // Lead: the longest run starting at the lowest card if there is one, else the lowest card with its partners
    const low = [...hand].sort(byValue)[0];
    if (g.mustPlay != null && !hand.includes(g.mustPlay)) return;
    for (let len = Math.min(hand.length, 8); len >= 3; len--) {
      const run = candidates(hand, 'run', len).find((r) => tlRank(r[0]) === tlRank(low));
      if (run) { if (!run.includes(low)) run[0] = low; return act(room, id, 'play', run); }
    }
    const same = hand.filter((c) => tlRank(c) === tlRank(low));
    return act(room, id, 'play', same.length >= 2 && same.length <= 3 ? same : [low]);
  }
  const prev = g.last.combo;
  let opts = candidates(hand, prev.type, prev.len).filter((cs) => beats(classify(cs), prev));
  // Chops when someone plays a 2
  if (!opts.length && Math.floor(prev.top / 4) === TWO) opts = [...candidates(hand, 'quad', 4), ...candidates(hand, 'pairs', 3), ...candidates(hand, 'pairs', 4)].filter((cs) => beats(classify(cs), prev));
  // Keep 2s for later unless the hand is nearly empty
  const usesTwo = (cs) => cs.some((c) => tlRank(c) === TWO);
  if (hand.length > 5) { const cheap = opts.filter((cs) => !usesTwo(cs)); if (cheap.length || Math.random() < 0.6) opts = cheap; }
  if (!opts.length) return act(room, id, 'pass');
  opts.sort((a, b) => classify(a).top - classify(b).top);
  act(room, id, 'play', opts[0]);
}

function view(room, uid) {
  const g = room.game;
  const turn = current(g);
  return {
    order: g.order, turn,
    last: g.last ? { by: g.last.by, cards: g.last.cards, combo: comboKey(g.last.combo), len: g.last.combo.len } : null,
    passed: g.passed,
    hand: [...(g.hands[uid] || [])].sort(byValue),
    mustPlay: turn === uid ? g.mustPlay : null,
    canPass: turn === uid && !!g.last,
  };
}

export default { type: 'tienlen', min: 2, max: 4, start, act, botMove, view };
