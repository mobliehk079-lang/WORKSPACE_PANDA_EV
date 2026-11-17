// Kaeng (ໄພ່ແຄງ) rules.
// - 2–6 players, one 52-card deck. 5 cards each; the player who starts gets 6 and opens by discarding.
// - Points: A = 1, 2–10 face value, J/Q/K = 10. The hand total is the plain sum; the lowest total wins.
// - On your turn: draw 1 card, then discard 1 card or 2–4 cards of the same rank.
//   Instead of drawing you may: call "Kaeng" (everyone shows their hand), or
//   follow ("Lai"): if the last discard was another player's, play cards of the same rank straight away.
// - Empty your hand (by discarding or following) and you win at once.
// - Kaeng: the caller wins if nobody has a lower total (a tie goes to the caller); otherwise the lowest wins.
// - When the draw pile runs out, all hands are shown and the lowest total wins (equal lowest share the win).
import { bad, rankOf, shuffled, log, nameOf, current, myTurn, takeFrom, touch, finish } from './core.js';

const HAND = 5;
export const points = (c) => Math.min(rankOf(c) + 1, 10);
export const handTotal = (cards) => cards.reduce((s, c) => s + points(c), 0);
const sortHand = (cards) => [...cards].sort((a, b) => rankOf(a) - rankOf(b) || a - b);
const canFollow = (g, uid) => !!g.last && g.last.by !== uid && g.hands[uid].some((c) => rankOf(c) === g.last.rank);

function start(room, order) {
  const deck = shuffled();
  const hands = Object.fromEntries(order.map((id) => [id, []]));
  for (let i = 0; i < HAND; i++) for (const id of order) hands[id].push(deck.pop());
  hands[order[0]].push(deck.pop());
  return { deck, hands, order, turn: 0, drawn: true, last: null };
}

function nextTurn(room) {
  const g = room.game;
  g.turn = (g.turn + 1) % g.order.length;
  g.drawn = false;
  // Nothing left to draw: show hands (unless this player can still follow)
  if (!g.deck.length && !canFollow(g, current(g))) showdown(room, null, 'deck');
}

function draw(room, uid) {
  const g = myTurn(room, uid);
  if (g.drawn) throw bad('You already drew. Discard a card');
  if (!g.deck.length) return showdown(room, null, 'deck');
  g.hands[uid].push(g.deck.pop());
  g.drawn = true;
  log(room, '{name} drew a card', { name: nameOf(room, uid) });
  touch(room);
}

function sameRank(cards) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 4 || new Set(cards.map(rankOf)).size !== 1) throw bad('Choose 1 to 4 cards of the same rank');
}

function play(room, uid, cards, isFollow) {
  const g = room.game;
  sameRank(cards);
  g.hands[uid] = takeFrom(g.hands[uid], cards);
  const victim = isFollow ? g.last.by : null;
  g.last = { by: uid, cards: [...cards], rank: rankOf(cards[0]) };
  log(room, isFollow ? '{name} followed with {n} card(s)' : '{name} discarded {n} card(s)',
    { name: nameOf(room, uid), n: cards.length, cards: [...cards], by: uid, ...(isFollow ? { to: victim } : {}) });
  if (!g.hands[uid].length) return end(room, [uid], isFollow ? 'follow-out' : 'out', uid);
  nextTurn(room);
  touch(room);
}

function showdown(room, caller, reason) {
  const g = room.game;
  const totals = Object.fromEntries(g.order.map((id) => [id, handTotal(g.hands[id])]));
  let winners;
  if (caller) {
    const others = g.order.filter((id) => id !== caller);
    const low = Math.min(...others.map((id) => totals[id]));
    winners = totals[caller] <= low ? [caller] : others.filter((id) => totals[id] === low);
  } else {
    const low = Math.min(...Object.values(totals));
    winners = g.order.filter((id) => totals[id] === low);
  }
  end(room, winners, reason, caller);
}
function end(room, winners, reason, by) {
  const g = room.game;
  finish(room, winners, {
    reason, by,
    hands: Object.fromEntries(g.order.map((id) => [id, sortHand(g.hands[id])])),
    totals: Object.fromEntries(g.order.map((id) => [id, handTotal(g.hands[id])])),
  });
}

function act(room, uid, action, cards) {
  const g = myTurn(room, uid);
  if (action === 'draw') return draw(room, uid);
  if (action === 'discard') {
    if (!g.drawn) throw bad('Draw a card first');
    return play(room, uid, cards, false);
  }
  if (action === 'follow') {
    if (g.drawn) throw bad('You already drew. Discard a card');
    if (!g.last || g.last.by === uid) throw bad('There is nothing to follow');
    if (!cards.every((c) => rankOf(c) === g.last.rank)) throw bad('Follow with cards of the same rank as the last discard');
    return play(room, uid, cards, true);
  }
  if (action === 'kaeng') {
    if (g.drawn) throw bad('Call Kaeng at the start of your turn, before drawing');
    log(room, '{name} called Kaeng!', { name: nameOf(room, uid) });
    return showdown(room, uid, 'kaeng');
  }
  throw bad('Invalid request data');
}

function botMove(room, id) {
  const g = room.game, hand = g.hands[id];
  if (!g.drawn) {
    if (canFollow(g, id)) return act(room, id, 'follow', hand.filter((c) => rankOf(c) === g.last.rank));
    const total = handTotal(hand);
    if (total <= 6 || (total <= 12 && Math.random() < 0.4) || !g.deck.length) return act(room, id, 'kaeng');
    return act(room, id, 'draw');
  }
  // Throw away the rank that removes the most points
  const groups = {};
  for (const c of hand) (groups[rankOf(c)] ||= []).push(c);
  act(room, id, 'discard', Object.values(groups).sort((a, b) => handTotal(b) - handTotal(a))[0]);
}

function view(room, uid) {
  const g = room.game;
  const hand = sortHand(g.hands[uid] || []);
  return {
    order: g.order, turn: current(g), drawn: g.drawn, deck: g.deck.length,
    last: g.last ? { by: g.last.by, cards: g.last.cards } : null,
    hand, total: handTotal(hand), canFollow: current(g) === uid && !g.drawn && canFollow(g, uid),
  };
}

export default { type: 'kaeng', min: 2, max: 6, start, act, botMove, view };
