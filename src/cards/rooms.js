// Multiplayer card rooms — kept only in memory. Nothing is written to the database:
// a room disappears when every person has left (or after a few idle hours), and a restart clears all rooms.
// Each room plays one game (see GAMES); the game's rules live in its own module.
// Practice bots (negative ids) can fill empty seats; they play their turns on the server after a short pause.
import crypto from 'node:crypto';
import { HttpError, bad, hooks, touch, log, playerOf, nameOf, current } from './core.js';
import kaeng from './kaeng.js';
import tienlen from './tienlen.js';

export const GAMES = { kaeng, tienlen };
const IDLE_MS = 3 * 3600_000;

const rooms = new Map();
let changed = () => {};
/** server.js passes a function that pushes the new state to everyone in the room */
export function onChange(fn) { changed = fn; }
hooks.after = (room) => { changed(room); scheduleBot(room); };

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = [...crypto.randomBytes(5)].map((b) => A[b % A.length]).join('');
    if (!rooms.has(code)) return code;
  }
}
const engine = (room) => GAMES[room.type];

export const roomOfUser = (uid) => [...rooms.values()].find((r) => r.players.some((p) => p.id === uid)) || null;
export const getRoom = (code) => rooms.get(String(code || '').toUpperCase()) || null;
export const invitesFor = (uid) => [...rooms.values()].filter((r) => r.invited.has(uid) && !playerOf(r, uid))
  .map((r) => ({ id: r.id, type: r.type, host: nameOf(r, r.hostId), players: r.players.length, status: r.status }));

const personOf = (u) => ({ id: u.id, name: u.name, avatar: u.avatar || null, dept_code: u.dept_code || null });

export function createRoom(user, type) {
  if (!GAMES[type]) throw bad('Invalid request data');
  leaveRoom(user.id);
  const room = { id: newCode(), type, hostId: user.id, players: [personOf(user)], invited: new Set(), status: 'lobby', game: null, result: null, wins: {}, round: 0, log: [], starter: user.id, touched: Date.now() };
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
  if (room.players.length >= engine(room).max) throw bad('This room is full');
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
  if (room.players.length >= engine(room).max) throw bad('This room is full');
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
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.status !== 'playing' || current(room.game) !== id) return;
    try { engine(room).botMove(room, id); } catch (e) { console.error(`${room.type} bot move failed:`, e.message); }
  }, 900 + Math.random() * 900);
}

// ---------------------------------------------------------------- rounds
export function startRound(room, uid) {
  if (room.hostId !== uid) throw new HttpError(403, 'Only the room host can start');
  if (room.status === 'playing') throw bad('A round is being played. Join when it ends');
  const eng = engine(room);
  if (room.players.length < eng.min) throw bad('At least 2 players are needed');
  if (room.players.length > eng.max) throw bad('This room is full');
  const ids = room.players.map((p) => p.id);
  const s = Math.max(0, ids.indexOf(room.starter));
  const order = [...ids.slice(s), ...ids.slice(0, s)];
  room.game = eng.start(room, order);
  room.result = null;
  room.status = 'playing';
  room.round++;
  log(room, 'Round {n} started — {name} goes first', { n: room.round, name: nameOf(room, current(room.game)) });
  touch(room);
}

export function act(room, uid, action, cards) {
  engine(room).act(room, uid, action, Array.isArray(cards) ? cards.map(Number) : []);
}

/** What one player may see: their own hand, everyone's card counts, and all hands only after the round */
export function view(room, uid, online = () => true) {
  const g = room.game;
  const out = {
    id: room.id, type: room.type, max: engine(room).max, hostId: room.hostId, status: room.status, round: room.round, me: uid,
    players: room.players.map((p) => ({ ...p, wins: room.wins[p.id] || 0, online: p.bot || online(p.id), cards: g ? g.hands[p.id]?.length ?? 0 : 0 })),
    invited: [...room.invited],
    log: room.log.slice(-12),
    result: room.result,
  };
  if (g) Object.assign(out, engine(room).view(room, uid));
  return out;
}

export const allRooms = () => [...rooms.values()];
// Rooms nobody touched for hours are dropped
setInterval(() => { for (const r of rooms.values()) if (Date.now() - r.touched > IDLE_MS) { clearTimeout(r.botTimer); rooms.delete(r.id); } }, 10 * 60_000).unref();
