// Kaeng (ໄພ່ແຄງ) — multiplayer rooms kept only in memory. Nothing is written to the database:
// a room disappears when everyone leaves (or after a few idle hours), and a restart clears all rooms.
//
// Rules used here:
// - 2–6 players, one 52-card deck. 5 cards each; the player who starts gets 6 and opens by discarding.
// - Points: A = 1, 2–10 face value, J/Q/K = 10. The hand total is the plain sum; the lowest total wins.
// - On your turn: draw 1 card, then discard 1 card or 2–4 cards of the same rank.
//   Instead of drawing you may: call "Kaeng" (everyone shows their hand), or
//   follow ("Lai"): if the last discard was another player's, play cards of the same rank straight away.
// - Empty your hand (by discarding or following) and you win at once.
// - Kaeng: the caller wins if nobody has a lower total (a tie goes to the caller); otherwise the lowest wins.
// - When the draw pile runs out, all hands are shown and the lowest total wins (equal lowest share the win).
// Practice bots (negative ids) can fill empty seats; they play their turns on the server after a short pause.
import crypto from 'node:crypto';
import { HttpError } from './logic.js';

export const MAX_PLAYERS = 6;
const HAND = 5;
const IDLE_MS = 3 * 3600_000;

export const rankOf = (c) => c % 13;            // 0 = A … 12 = K
export const points = (c) => Math.min(rankOf(c) + 1, 10);
export const handTotal = (cards) => cards.reduce((s, c) => s + points(c), 0);
const sortHand = (cards) => [...cards].sort((a, b) => rankOf(a) - rankOf(b) || a - b);
const bad = (msg) => new HttpError(400, msg);

const rooms = new Map();
let changed = () => {};
/** server.js passes a function that pushes the new state to everyone in the room */
export function onChange(fn) { changed = fn; }

function shuffled() {
  const d = [...Array(52).keys()];
  const r = crypto.randomBytes(4 * 52);
  for (let i = d.length - 1; i > 0; i--) { const j = r.readUInt32LE(i * 4) % (i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = [...crypto.randomBytes(5)].map((b) => A[b % A.length]).join('');
    if (!rooms.has(code)) return code;
  }
}
const log = (room, key, params = {}) => { room.log.push({ key, params, at: Date.now() }); if (room.log.length > 30) room.log.shift(); };
const touch = (room) => { room.touched = Date.now(); changed(room); scheduleBot(room); };
const playerOf = (room, uid) => room.players.find((p) => p.id === uid);
const nameOf = (room, uid) => playerOf(room, uid)?.name || '?';

export const roomOfUser = (uid) => [...rooms.values()].find((r) => r.players.some((p) => p.id === uid)) || null;
export const getRoom = (code) => rooms.get(String(code || '').toUpperCase()) || null;
export const invitesFor = (uid) => [...rooms.values()].filter((r) => r.invited.has(uid) && !playerOf(r, uid))
  .map((r) => ({ id: r.id, host: nameOf(r, r.hostId), players: r.players.length, status: r.status }));

const personOf = (u) => ({ id: u.id, name: u.name, avatar: u.avatar || null, dept_code: u.dept_code || null });

export function createRoom(user) {
  leaveRoom(user.id);
  const room = { id: newCode(), hostId: user.id, players: [personOf(user)], invited: new Set(), status: 'lobby', game: null, result: null, wins: {}, round: 0, log: [], starter: user.id, touched: Date.now() };
  rooms.set(room.id, room);
  log(room, '{name} created the room', { name: user.name });
  touch(room);
  return room;
}

export function joinRoom(code, user) {
  const room = getRoom(code);
  if (!room) throw new HttpError(404, 'Room not found. It may have closed');
  if (playerOf(room, user.id)) return room;
  if (room.status === 'playing') throw bad('A round is being played. Join when it ends');
  if (room.players.length >= MAX_PLAYERS) throw bad('This room is full');
  leaveRoom(user.id);
  room.players.push(personOf(user));
  room.invited.delete(user.id);
  log(room, '{name} joined', { name: user.name });
  touch(room);
  return room;
}

/** Leaving during a round cancels the round (the others cannot finish without that hand) */
export function leaveRoom(uid) {
  const room = roomOfUser(uid);
  if (!room) return;
  const name = nameOf(room, uid);
  room.players = room.players.filter((p) => p.id !== uid);
  delete room.wins[uid];
  // Only bots left (or nobody): close the room
  if (!room.players.some((p) => !p.bot)) { clearTimeout(room.botTimer); rooms.delete(room.id); changed(room, [uid]); return; }
  if (room.hostId === uid) room.hostId = room.players.find((p) => !p.bot).id;
  if (room.starter === uid) room.starter = room.hostId;
  if (room.status === 'playing') {
    room.status = 'lobby'; room.game = null;
    clearTimeout(room.botTimer); room.botTimer = null;
    log(room, '{name} left — the round was cancelled', { name });
  } else log(room, '{name} left', { name });
  room.touched = Date.now();
  changed(room, [uid]);
}

export function invite(room, uid, ids) {
  if (!playerOf(room, uid)) throw new HttpError(403, 'You are not in this room');
  const fresh = ids.filter((id) => !playerOf(room, id) && !room.invited.has(id));
  for (const id of fresh) room.invited.add(id);
  touch(room);
  return fresh;
}

// ---------------------------------------------------------------- practice bots
let botSeq = 0;
export function addBot(room, uid) {
  if (room.hostId !== uid) throw new HttpError(403, 'Only the room host can add bots');
  if (room.status === 'playing') throw bad('A round is being played. Join when it ends');
  if (room.players.length >= MAX_PLAYERS) throw bad('This room is full');
  const used = new Set(room.players.filter((p) => p.bot).map((p) => p.botNo));
  let n = 1; while (used.has(n)) n++;
  const bot = { id: -(++botSeq), name: `Bot ${n}`, botNo: n, bot: true, avatar: null, dept_code: null };
  room.players.push(bot);
  log(room, '{name} joined', { name: bot.name });
  touch(room);
}
export function removeBot(room, uid, botId) {
  if (room.hostId !== uid) throw new HttpError(403, 'Only the room host can add bots');
  if (room.status === 'playing') throw bad('A round is being played. Join when it ends');
  const b = room.players.find((p) => p.id === botId && p.bot);
  if (!b) return;
  room.players = room.players.filter((p) => p !== b);
  delete room.wins[b.id];
  if (room.starter === b.id) room.starter = room.hostId;
  log(room, '{name} left', { name: b.name });
  touch(room);
}
function scheduleBot(room) {
  if (room.botTimer || room.status !== 'playing' || !rooms.has(room.id)) return;
  const id = current(room.game);
  if (!playerOf(room, id)?.bot) return;
  // A "thinking" pause so people can follow what the bot does
  room.botTimer = setTimeout(() => { room.botTimer = null; botMove(room, id); }, 900 + Math.random() * 900);
}
function botMove(room, id) {
  if (room.status !== 'playing' || current(room.game) !== id) return;
  const g = room.game, hand = g.hands[id];
  try {
    if (!g.drawn) {
      if (canFollow(g, id)) return follow(room, id, hand.filter((c) => rankOf(c) === g.last.rank));
      const total = handTotal(hand);
      if (total <= 6 || (total <= 12 && Math.random() < 0.4)) return kaeng(room, id);
      if (!g.deck.length) return kaeng(room, id);
      return draw(room, id);
    }
    // Throw away the rank that removes the most points
    const groups = {};
    for (const c of hand) (groups[rankOf(c)] ||= []).push(c);
    const best = Object.values(groups).sort((a, b) => handTotal(b) - handTotal(a))[0];
    discard(room, id, best);
  } catch (e) { console.error('Kaeng bot move failed:', e.message); }
}

export function startRound(room, uid) {
  if (room.hostId !== uid) throw new HttpError(403, 'Only the room host can start');
  if (room.status === 'playing') throw bad('A round is being played. Join when it ends');
  if (room.players.length < 2) throw bad('At least 2 players are needed');
  const deck = shuffled();
  const ids = room.players.map((p) => p.id);
  const s = Math.max(0, ids.indexOf(room.starter));
  const order = [...ids.slice(s), ...ids.slice(0, s)];
  const hands = Object.fromEntries(order.map((id) => [id, []]));
  for (let i = 0; i < HAND; i++) for (const id of order) hands[id].push(deck.pop());
  hands[order[0]].push(deck.pop());
  room.game = { deck, hands, order, turn: 0, drawn: true, last: null, discarded: 0 };
  room.result = null;
  room.status = 'playing';
  room.round++;
  log(room, 'Round {n} started — {name} goes first', { n: room.round, name: nameOf(room, order[0]) });
  touch(room);
}

const current = (g) => g.order[g.turn];
function myTurn(room, uid) {
  if (room.status !== 'playing') throw bad('The round has not started');
  if (current(room.game) !== uid) throw bad('It is not your turn');
  return room.game;
}
function takeCards(hand, cards) {
  if (!Array.isArray(cards) || cards.length < 1 || cards.length > 4) throw bad('Choose 1 to 4 cards of the same rank');
  const set = new Set(cards);
  if (set.size !== cards.length || !cards.every((c) => Number.isInteger(c) && hand.includes(c))) throw bad('You do not have those cards');
  if (new Set(cards.map(rankOf)).size !== 1) throw bad('Choose 1 to 4 cards of the same rank');
  return hand.filter((c) => !set.has(c));
}
const canFollow = (g, uid) => !!g.last && g.last.by !== uid && g.hands[uid].some((c) => rankOf(c) === g.last.rank);

function nextTurn(room) {
  const g = room.game;
  g.turn = (g.turn + 1) % g.order.length;
  g.drawn = false;
  // Nothing left to draw: show hands (unless this player can still follow)
  if (!g.deck.length && !canFollow(g, current(g))) showdown(room, null, 'deck');
}

export function draw(room, uid) {
  const g = myTurn(room, uid);
  if (g.drawn) throw bad('You already drew. Discard a card');
  if (!g.deck.length) return showdown(room, null, 'deck');
  g.hands[uid].push(g.deck.pop());
  g.drawn = true;
  log(room, '{name} drew a card', { name: nameOf(room, uid) });
  touch(room);
}

export function discard(room, uid, cards) {
  const g = myTurn(room, uid);
  if (!g.drawn) throw bad('Draw a card first');
  play(room, uid, cards, false);
}

export function follow(room, uid, cards) {
  const g = myTurn(room, uid);
  if (g.drawn) throw bad('You already drew. Discard a card');
  if (!g.last || g.last.by === uid) throw bad('There is nothing to follow');
  if (!cards.every((c) => rankOf(c) === g.last.rank)) throw bad('Follow with cards of the same rank as the last discard');
  play(room, uid, cards, true);
}

function play(room, uid, cards, isFollow) {
  const g = room.game;
  g.hands[uid] = takeCards(g.hands[uid], cards);
  g.last = { by: uid, cards: [...cards], rank: rankOf(cards[0]) };
  g.discarded += cards.length;
  log(room, isFollow ? '{name} followed with {n} card(s)' : '{name} discarded {n} card(s)', { name: nameOf(room, uid), n: cards.length, cards: [...cards] });
  if (!g.hands[uid].length) return finish(room, [uid], isFollow ? 'follow-out' : 'out', uid);
  nextTurn(room);
  touch(room);
}

export function kaeng(room, uid) {
  const g = myTurn(room, uid);
  if (g.drawn) throw bad('Call Kaeng at the start of your turn, before drawing');
  log(room, '{name} called Kaeng!', { name: nameOf(room, uid) });
  showdown(room, uid, 'kaeng');
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
  finish(room, winners, reason, caller);
}

function finish(room, winners, reason, by) {
  const g = room.game;
  room.result = {
    reason, by, winners,
    hands: Object.fromEntries(g.order.map((id) => [id, sortHand(g.hands[id])])),
    totals: Object.fromEntries(g.order.map((id) => [id, handTotal(g.hands[id])])),
  };
  for (const w of winners) room.wins[w] = (room.wins[w] || 0) + 1;
  room.starter = winners[0];
  room.status = 'ended';
  clearTimeout(room.botTimer); room.botTimer = null;
  room.game = null; // the round is over: drop the deck and hands
  log(room, winners.length > 1 ? 'Shared win: {name}' : '{name} wins the round!', { name: winners.map((w) => nameOf(room, w)).join(', ') });
  touch(room);
}

/** What one player may see: their own hand, everyone's card counts, and all hands only after the round */
export function view(room, uid, online = () => true) {
  const g = room.game;
  const out = {
    id: room.id, hostId: room.hostId, status: room.status, round: room.round, me: uid,
    players: room.players.map((p) => ({ ...p, wins: room.wins[p.id] || 0, online: p.bot || online(p.id), cards: g ? g.hands[p.id]?.length ?? 0 : 0 })),
    invited: [...room.invited],
    log: room.log.slice(-12),
    result: room.result,
  };
  if (g) {
    const hand = sortHand(g.hands[uid] || []);
    Object.assign(out, {
      order: g.order, turn: current(g), drawn: g.drawn, deck: g.deck.length,
      last: g.last ? { by: g.last.by, cards: g.last.cards } : null,
      hand, total: handTotal(hand), canFollow: current(g) === uid && !g.drawn && canFollow(g, uid),
    });
  }
  return out;
}

export const allRooms = () => [...rooms.values()];
// Rooms nobody touched for hours are dropped
setInterval(() => { for (const r of rooms.values()) if (Date.now() - r.touched > IDLE_MS) { clearTimeout(r.botTimer); rooms.delete(r.id); } }, 10 * 60_000).unref();
