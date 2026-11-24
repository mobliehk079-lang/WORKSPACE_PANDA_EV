// Panda Jump — multiplayer 3D platformer rooms. Kept only in memory, like the card rooms:
// nothing is written to the database and a restart clears every room.
//
// Each client runs its own physics and sends its position ~15×/s over a WebSocket; the server relays
// everyone's positions to the room (15×/s), checks pushes (distance + cooldown), times races and counts knock-outs.
import crypto from 'node:crypto';
import { HttpError } from '../logic.js';

export const MAX_PLAYERS = 8;
const CHARACTERS = 4;
const TICK_MS = 66;
const PUSH_RANGE = 2.8;       // metres between the two players, as last reported
const PUSH_COOLDOWN = 450;    // ms
const KO_WINDOW = 5000;       // a fall within 5 s of being pushed counts as a knock-out
const COUNTDOWN_MS = 4000;
const RACE_MAX_MS = 20 * 60_000;
const OFFLINE_GRACE = 60_000; // keep the seat this long after the connection drops
const IDLE_MS = 3 * 3600_000;

const bad = (msg) => new HttpError(400, msg);
const rooms = new Map();
let notify = () => {}; // server.js: (uid, event, data) → pushes over the app's live stream

export function onNotify(fn) { notify = fn; }

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = 'J' + [...crypto.randomBytes(4)].map((b) => A[b % A.length]).join('');
    if (!rooms.has(code)) return code;
  }
}

const person = (u, ch) => ({
  id: u.id, name: u.name, avatar: u.avatar || null, dept_code: u.dept_code || null,
  ch: Number.isInteger(ch) && ch >= 0 && ch < CHARACTERS ? ch : 0,
  ws: null, st: null, stAt: 0, lastPush: 0, pushedBy: null, pushedAt: 0, ko: 0, falls: 0, gone: null,
});

export const roomOfUser = (uid) => [...rooms.values()].find((r) => r.players.has(uid)) || null;
export const getRoom = (code) => rooms.get(String(code || '').trim().toUpperCase()) || null;
export const invitesFor = (uid) => [...rooms.values()].filter((r) => r.invited.has(uid) && !r.players.has(uid))
  .map((r) => ({ id: r.id, host: r.players.get(r.hostId)?.name || '?', players: r.players.size, status: r.status }));

export function createRoom(user, ch) {
  leaveRoom(user.id);
  const room = {
    id: newCode(), hostId: user.id, players: new Map([[user.id, person(user, ch)]]), invited: new Set(),
    status: 'free', startAt: 0, race: null, results: null, round: 0, touched: Date.now(), timer: null,
  };
  rooms.set(room.id, room);
  room.timer = setInterval(() => tick(room), TICK_MS);
  return room;
}

export function joinRoom(code, user, ch) {
  const room = getRoom(code);
  if (!room) throw new HttpError(404, 'Room not found. It may have closed');
  const me = room.players.get(user.id);
  if (me) { if (Number.isInteger(ch)) me.ch = clampCh(ch); return room; }
  if (room.players.size >= MAX_PLAYERS) throw bad('This room is full');
  leaveRoom(user.id);
  room.players.set(user.id, person(user, ch));
  room.invited.delete(user.id);
  room.touched = Date.now();
  fx(room, { k: 'join', who: user.id, name: user.name });
  broadcastRoom(room);
  return room;
}

export function leaveRoom(uid) {
  const room = roomOfUser(uid);
  if (!room) return;
  const p = room.players.get(uid);
  room.players.delete(uid);
  if (p?.ws) { const ws = p.ws; p.ws = null; ws.send({ t: 'bye' }); ws.close(); }
  if (!room.players.size) return closeRoom(room);
  if (room.hostId === uid) room.hostId = room.players.keys().next().value;
  room.race?.entrants.delete(uid);
  fx(room, { k: 'leave', who: uid, name: p?.name || '?' });
  maybeEndRace(room);
  broadcastRoom(room);
}

function closeRoom(room) {
  clearInterval(room.timer);
  clearTimeout(room.raceTimer);
  rooms.delete(room.id);
}

export function invite(room, uid, ids) {
  if (!room.players.has(uid)) throw new HttpError(403, 'You are not in this room');
  const fresh = ids.filter((id) => !room.players.has(id) && !room.invited.has(id));
  for (const id of fresh) room.invited.add(id);
  room.touched = Date.now();
  return fresh;
}

const clampCh = (ch) => (Number.isInteger(ch) && ch >= 0 && ch < CHARACTERS ? ch : 0);

/** Room summary for the lobby and the in-game panel (positions travel separately) */
export function view(room, uid) {
  return {
    id: room.id, hostId: room.hostId, me: uid, max: MAX_PLAYERS, status: room.status, startAt: room.startAt, round: room.round, now: Date.now(),
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, avatar: p.avatar, dept_code: p.dept_code, ch: p.ch, ko: p.ko, falls: p.falls,
      online: !!p.ws, racing: !!room.race?.entrants.has(p.id), finished: room.race?.finished.find((f) => f.id === p.id)?.time ?? null,
    })),
    invited: [...room.invited],
    results: room.results,
  };
}

function send(p, msg, volatile) { p.ws?.send(msg, volatile); }
function broadcastRoom(room) { for (const p of room.players.values()) send(p, { t: 'room', room: view(room, p.id) }); }
function fx(room, data) { for (const p of room.players.values()) send(p, { t: 'fx', ...data }); }

/** Fresh names/photos from the profile (server.js passes a lookup) */
export function refreshPeople(room, lookup) {
  for (const p of room.players.values()) { const u = lookup(p.id); if (u) { p.name = u.name; p.avatar = u.avatar || null; } }
}

// ---------------------------------------------------------------- live connection
export function attach(user, ws) {
  const room = roomOfUser(user.id);
  if (!room) { ws.send({ t: 'bye', reason: 'Room not found. It may have closed' }); ws.close(); return; }
  const p = room.players.get(user.id);
  if (p.ws && p.ws !== ws) { const old = p.ws; p.ws = null; old.send({ t: 'bye', reason: 'Opened in another tab' }); old.close(); }
  p.ws = ws; p.gone = null;
  room.touched = Date.now();
  let budget = 0, last = Date.now();
  ws.onmessage = (raw) => {
    // simple rate limit: ~40 messages a second
    const now = Date.now();
    budget = Math.max(0, budget - (now - last) / 25); last = now;
    if (++budget > 40) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const r = roomOfUser(user.id);
    if (!r || r.players.get(user.id) !== p) return;
    handle(r, p, m);
  };
  ws.onclose = () => {
    if (p.ws !== ws) return;
    p.ws = null; p.gone = Date.now();
    const r = roomOfUser(user.id);
    if (!r) return;
    broadcastRoom(r);
    setTimeout(() => { if (!p.ws && p.gone && roomOfUser(user.id) === r) leaveRoom(user.id); }, OFFLINE_GRACE);
  };
  send(p, { t: 'room', room: view(room, p.id) });
  broadcastRoom(room);
}

const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);

function handle(room, p, m) {
  switch (m.t) {
    case 's': { // [x, y, z, yaw, vy, flags]
      const s = m.s;
      if (!Array.isArray(s) || s.length < 6) return;
      p.st = [num(s[0], 1e4), num(s[1], 1e4), num(s[2], 1e4), num(s[3], 100), num(s[4], 100), s[5] | 0];
      p.stAt = Date.now();
      return;
    }
    case 'ch':
      p.ch = clampCh(m.ch);
      broadcastRoom(room);
      return;
    case 'push': {
      const target = room.players.get(Number(m.to));
      const now = Date.now();
      if (!target || target === p || !p.st || !target.st || now - p.lastPush < PUSH_COOLDOWN) return;
      const dx = target.st[0] - p.st[0], dy = target.st[1] - p.st[1], dz = target.st[2] - p.st[2];
      const d = Math.hypot(dx, dz);
      if (d > PUSH_RANGE || Math.abs(dy) > 2) return;
      p.lastPush = now;
      // direction from the pusher's facing when they overlap, otherwise from pusher to target
      const fx0 = Math.sin(p.st[3]), fz0 = Math.cos(p.st[3]);
      const nx = d > 0.15 ? dx / d : fx0, nz = d > 0.15 ? dz / d : fz0;
      target.pushedBy = p.id; target.pushedAt = now;
      send(target, { t: 'pushed', from: p.id, dx: +nx.toFixed(3), dz: +nz.toFixed(3) });
      fx(room, { k: 'push', from: p.id, to: target.id });
      return;
    }
    case 'fall': {
      p.falls++;
      const now = Date.now();
      const by = p.pushedBy && now - p.pushedAt < KO_WINDOW ? room.players.get(p.pushedBy) : null;
      p.pushedBy = null;
      if (by) { by.ko++; fx(room, { k: 'ko', by: by.id, who: p.id, byName: by.name, name: p.name }); }
      else fx(room, { k: 'fall', who: p.id, name: p.name });
      broadcastRoom(room);
      return;
    }
    case 'start': {
      if (room.hostId !== p.id || room.status !== 'free') return;
      room.status = 'countdown';
      room.round++;
      room.startAt = Date.now() + COUNTDOWN_MS;
      room.results = null;
      room.race = { entrants: new Set(room.players.keys()), finished: [] };
      for (const q of room.players.values()) { q.ko = 0; q.falls = 0; q.pushedBy = null; }
      broadcastRoom(room);
      clearTimeout(room.raceTimer);
      room.raceTimer = setTimeout(() => {
        if (room.status !== 'countdown') return;
        room.status = 'race';
        broadcastRoom(room);
        room.raceTimer = setTimeout(() => endRace(room), RACE_MAX_MS);
      }, COUNTDOWN_MS);
      return;
    }
    case 'stop':
      if (room.hostId === p.id && room.status !== 'free') endRace(room);
      return;
    case 'finish': {
      if (room.status !== 'race' || !room.race.entrants.has(p.id) || room.race.finished.some((f) => f.id === p.id)) return;
      const time = Date.now() - room.startAt;
      const bolts = Math.max(0, Math.min(999, m.bolts | 0));
      room.race.finished.push({ id: p.id, time, bolts });
      fx(room, { k: 'finish', who: p.id, name: p.name, place: room.race.finished.length, time });
      if (!maybeEndRace(room)) broadcastRoom(room);
      return;
    }
    case 'emote':
      fx(room, { k: 'emote', who: p.id, e: Math.max(0, Math.min(5, m.e | 0)) });
  }
}

function maybeEndRace(room) {
  if (room.status !== 'race' || !room.race) return false;
  const left = [...room.race.entrants].filter((id) => room.players.has(id) && !room.race.finished.some((f) => f.id === id));
  if (left.length) return false;
  endRace(room);
  return true;
}

function endRace(room) {
  clearTimeout(room.raceTimer);
  const race = room.race;
  if (race) {
    const ranking = [
      ...race.finished,
      ...[...race.entrants].filter((id) => room.players.has(id) && !race.finished.some((f) => f.id === id)).map((id) => ({ id, time: null, bolts: 0 })),
    ].map((r) => {
      const q = room.players.get(r.id);
      return { ...r, name: q?.name || '?', ko: q?.ko || 0, falls: q?.falls || 0 };
    });
    room.results = { round: room.round, ranking };
  }
  room.status = 'free';
  room.race = null;
  broadcastRoom(room);
}

// ---------------------------------------------------------------- position relay
function tick(room) {
  const now = Date.now();
  if (now - room.touched > IDLE_MS) return closeRoom(room);
  const list = [];
  for (const p of room.players.values()) {
    if (p.st && p.ws && now - p.stAt < 5000) list.push([p.id, ...p.st.map((v, i) => (i < 5 ? Math.round(v * 100) / 100 : v)), p.ch]);
  }
  if (!list.length) return;
  room.touched = now;
  const msg = JSON.stringify({ t: 'w', now, d: list });
  for (const p of room.players.values()) p.ws?.send(msg, true);
}

export const allRooms = () => [...rooms.values()];
