// Shared helpers for the multiplayer card games (rooms.js + one engine per game).
// Everything lives in memory only — nothing is written to the database.
import crypto from 'node:crypto';
import { HttpError } from '../logic.js';

export const bad = (msg) => new HttpError(400, msg);
export { HttpError };

/** Card ids 0–51: rank = id % 13 (0 = A … 12 = K), suit = floor(id / 13) (0 ♣, 1 ♦, 2 ♥, 3 ♠) */
export const rankOf = (c) => c % 13;
export const suitOf = (c) => Math.floor(c / 13);

export function shuffled() {
  const d = [...Array(52).keys()];
  const r = crypto.randomBytes(4 * 52);
  for (let i = d.length - 1; i > 0; i--) { const j = r.readUInt32LE(i * 4) % (i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** rooms.js plugs in what happens after every change (push to players, let bots move) */
export const hooks = { after: () => {} };
export const touch = (room) => { room.touched = Date.now(); hooks.after(room); };

/** Log lines are English message keys + params; each client translates them */
export const log = (room, key, params = {}) => { room.log.push({ key, params, at: Date.now() }); if (room.log.length > 30) room.log.shift(); };
export const playerOf = (room, uid) => room.players.find((p) => p.id === uid);
export const nameOf = (room, uid) => playerOf(room, uid)?.name || '?';

/** Whose turn it is, and a guard for actions */
export const current = (g) => g.order[g.turn];
export function myTurn(room, uid) {
  if (room.status !== 'playing') throw bad('The round has not started');
  if (current(room.game) !== uid) throw bad('It is not your turn');
  return room.game;
}
/** Remove the chosen cards from a hand (checks they are really there) */
export function takeFrom(hand, cards) {
  const set = new Set(cards);
  if (!Array.isArray(cards) || !cards.length || set.size !== cards.length || !cards.every((c) => Number.isInteger(c) && hand.includes(c))) throw bad('You do not have those cards');
  return hand.filter((c) => !set.has(c));
}

/** End the round: keep only the result (who won, the revealed hands) and drop the deck and hands */
export function finish(room, winners, extra = {}) {
  room.result = { winners, ...extra };
  for (const w of winners) room.wins[w] = (room.wins[w] || 0) + 1;
  room.starter = winners[0];
  room.status = 'ended';
  clearTimeout(room.botTimer); room.botTimer = null;
  room.game = null;
  log(room, winners.length > 1 ? 'Shared win: {name}' : '{name} wins the round!', { name: winners.map((w) => nameOf(room, w)).join(', ') });
  touch(room);
}
