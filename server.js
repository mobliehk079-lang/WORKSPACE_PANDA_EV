// PANDA EV WORKSPACE — server (plain Node.js, no npm dependencies)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import {
  openDb, tx, DATA_DIR, ymd, localIso, addDays, isYmd, isLocalDateTime, hashPassword, verifyPassword, ROOT, UPLOAD_DIR,
  EXT_KIND, EXT_MIME, DEPT_FILE_RULES, MAX_SIZE, extOf,
} from './src/db.js';
import { seedBase } from './src/seed.js';
import {
  HttpError, deny, isAdmin, isSuper, canSeeDept, canManageDept, canEditTask, canDeleteTask, permissions, visibleDeptIds, scopeDepts, inList,
  canSeeTask, canSetMembers, taskScope,
  membersWithLoad, sortByAvailability, workloadFor, kpiFor, kpiSeries,
} from './src/logic.js';
import { translate } from './src/i18n.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SESSION_DAYS = 7;
const COOKIE = 'tw_session';

const db = openDb();
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) seedBase(db);

// ======================================================================
// Router
// ======================================================================
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
}
const STATUS = ['todo', 'doing', 'review', 'done'];
const PRIORITY = ['low', 'medium', 'high', 'urgent'];
const ROLES = ['superadmin', 'admin', 'supervisor', 'staff'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v) => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);
const bad = (msg, vars) => new HttpError(400, msg, vars);

function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function getUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.dept_id,u.title,u.presence,u.status,d.code dept_code,s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN departments d ON d.id=u.dept_id WHERE s.token=?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now() || row.status !== 'active') { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return null; }
  return row;
}
const langOf = (req) => (req.headers['x-lang'] === 'en' ? 'en' : 'lo');
async function readJson(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Request is too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('Invalid request data'); }
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
/** Notification title is an English message key; params fill its {placeholders}. The client translates. */
function notify(userId, type, title, body = '', link = '', params = {}, refKey = null) {
  db.prepare('INSERT OR IGNORE INTO notifications (user_id,type,title,body,link,params,ref_key,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(userId, type, title, body, link, JSON.stringify(params), refKey, localIso());
}
const deptByCode = (code) => db.prepare('SELECT * FROM departments WHERE code=?').get(code);
const userById = (id) => db.prepare("SELECT id,name,role,dept_id,presence,status FROM users WHERE id=?").get(id);
const activeUser = (id) => { const u = userById(id); return u && u.status === 'active' ? u : null; };

// ======================================================================
// Auth / registration
// ======================================================================
const attempts = new Map();
const clientIp = (req) => String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
const isHttps = (req) => req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const cookie = (req, value, maxAge) => `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
function throttle(req, bucket, max = 20) {
  const key = `${bucket}:${clientIp(req)}`;
  const a = attempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 10 * 60_000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= max) throw new HttpError(429, 'Too many attempts. Please wait a moment');
  return { fail: () => { a.n++; attempts.set(key, a); }, ok: () => attempts.delete(key) };
}
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters');
  if (pw.length > 200) throw bad('Password is too long');
}

route('POST', '/api/login', async ({ req, res }) => {
  const th = throttle(req, 'login');
  const { email, password } = await readJson(req);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(str(email, 200));
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) { th.fail(); throw new HttpError(401, 'Incorrect email or password'); }
  if (u.status === 'pending') throw new HttpError(403, 'Your account is waiting for administrator approval');
  if (u.status === 'disabled') throw new HttpError(403, 'This account has been disabled. Please contact the administrator');
  th.ok();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.setHeader('Set-Cookie', cookie(req, token, SESSION_DAYS * 86400));
  return { ok: true };
}, { public: true });

route('POST', '/api/logout', ({ req, res }) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.setHeader('Set-Cookie', cookie(req, '', 0));
  return { ok: true };
}, { public: true });

// Departments list for the registration form (public, minimal)
route('GET', '/api/public/departments', () => db.prepare('SELECT code,name,short,name_en,short_en FROM departments ORDER BY id').all(), { public: true });

// Self-registration → pending until a super admin approves
route('POST', '/api/register', async ({ req }) => {
  const th = throttle(req, 'register', 10);
  const b = await readJson(req);
  const name = str(b.name, 120), email = str(b.email, 200).toLowerCase(), title = str(b.title, 120);
  if (!name) throw bad('Please enter your full name');
  if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email');
  checkPassword(b.password);
  const dept = deptByCode(b.dept);
  if (!dept) throw bad('Please choose a department');
  th.fail();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'This email is already registered');
  const id = Number(db.prepare("INSERT INTO users (name,email,password_hash,role,dept_id,title,status,created_at) VALUES (?,?,?,'staff',?,?,'pending',?)")
    .run(name, email, hashPassword(b.password), dept.id, title, localIso()).lastInsertRowid);
  for (const s of db.prepare("SELECT id FROM users WHERE role='superadmin' AND status='active'").all())
    notify(s.id, 'register', '{name} requested an account', email, '#/users', { name }, `register:${id}`);
  return { ok: true };
}, { public: true });

route('GET', '/api/bootstrap', ({ user }) => {
  const departments = db.prepare('SELECT id,code,name,short,name_en,short_en,description,description_en,color,color2 FROM departments ORDER BY id').all();
  const visible = visibleDeptIds(db, user);
  return {
    me: user,
    permissions: permissions(user),
    departments: departments.map((d) => ({ ...d, visible: visible.includes(d.id), fileRule: DEPT_FILE_RULES[d.code] })),
    today: ymd(),
  };
});

route('PATCH', '/api/me/presence', async ({ req, user }) => {
  const { presence } = await readJson(req);
  if (!['available', 'busy', 'away'].includes(presence)) throw bad('Invalid status');
  db.prepare('UPDATE users SET presence=? WHERE id=?').run(presence, user.id);
  return { presence };
});

route('POST', '/api/me/password', async ({ req, user }) => {
  const { current, password } = await readJson(req);
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id);
  if (!verifyPassword(String(current || ''), u.password_hash)) throw bad('Current password is incorrect');
  checkPassword(password);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), user.id);
  return { ok: true };
});

// ======================================================================
// User management (super admin only)
// ======================================================================
const requireSuper = (u) => { if (!isSuper(u)) deny('Only the super admin can manage users'); };
const USER_COLS = `u.id,u.name,u.email,u.role,u.dept_id,u.title,u.presence,u.status,u.created_at,d.code dept_code,
  (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status!='done') open_tasks,
  (SELECT MAX(s.expires_at) FROM sessions s WHERE s.user_id=u.id) last_session`;

route('GET', '/api/admin/users', ({ user }) => {
  requireSuper(user);
  return db.prepare(`SELECT ${USER_COLS} FROM users u LEFT JOIN departments d ON d.id=u.dept_id
    ORDER BY CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, CASE u.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END, u.dept_id, u.id`).all();
});

function validateUserFields(b, { partial = false } = {}) {
  const out = {};
  if (!partial || 'name' in b) { out.name = str(b.name, 120); if (!out.name) throw bad('Please enter your full name'); }
  if (!partial || 'email' in b) { out.email = str(b.email, 200).toLowerCase(); if (!EMAIL_RE.test(out.email)) throw bad('Please enter a valid email'); }
  if (!partial || 'role' in b) { if (!ROLES.includes(b.role)) throw bad('Invalid role'); out.role = b.role; }
  if ('title' in b) out.title = str(b.title, 120);
  if (!partial || 'dept' in b) {
    if (b.dept) { const d = deptByCode(b.dept); if (!d) throw bad('Please choose a department'); out.dept_id = d.id; }
    else out.dept_id = null;
  }
  if ('status' in b) { if (!['active', 'pending', 'disabled'].includes(b.status)) throw bad('Invalid status'); out.status = b.status; }
  return out;
}
function checkRoleDept(role, deptId) {
  if ((role === 'supervisor' || role === 'staff') && !deptId) throw bad('Supervisors and staff must belong to a department');
}

route('POST', '/api/admin/users', async ({ req, user }) => {
  requireSuper(user);
  const b = await readJson(req);
  const f = validateUserFields(b);
  if (f.role === 'admin' || f.role === 'superadmin') f.dept_id = null;
  checkRoleDept(f.role, f.dept_id);
  checkPassword(b.password);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(f.email)) throw new HttpError(409, 'This email is already registered');
  const id = Number(db.prepare("INSERT INTO users (name,email,password_hash,role,dept_id,title,status,created_at) VALUES (?,?,?,?,?,?,'active',?)")
    .run(f.name, f.email, hashPassword(b.password), f.role, f.dept_id, f.title || '', localIso()).lastInsertRowid);
  return db.prepare(`SELECT ${USER_COLS} FROM users u LEFT JOIN departments d ON d.id=u.dept_id WHERE u.id=?`).get(id);
});

route('PATCH', '/api/admin/users/:id', async ({ req, user, params }) => {
  requireSuper(user);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(Number(params.id));
  if (!target) throw new HttpError(404, 'User not found');
  const b = await readJson(req);
  const f = validateUserFields(b, { partial: true });
  const role = f.role ?? target.role;
  let deptId = 'dept_id' in f ? f.dept_id : target.dept_id;
  if (role === 'admin' || role === 'superadmin') deptId = null;
  f.dept_id = deptId;
  checkRoleDept(role, deptId);
  if (target.id === user.id && ((f.role && f.role !== 'superadmin') || (f.status && f.status !== 'active'))) throw bad('You cannot remove your own super admin access');
  if (f.email && f.email !== target.email && db.prepare('SELECT 1 FROM users WHERE email=? AND id!=?').get(f.email, target.id)) throw new HttpError(409, 'This email is already registered');
  if (target.role === 'superadmin' && ((f.role && f.role !== 'superadmin') || (f.status && f.status !== 'active'))) {
    const others = db.prepare("SELECT COUNT(*) c FROM users WHERE role='superadmin' AND status='active' AND id!=?").get(target.id).c;
    if (!others) throw bad('There must be at least one active super admin');
  }
  if ('password' in b && b.password) { checkPassword(b.password); f.password_hash = hashPassword(b.password); }
  const keys = Object.keys(f);
  tx(db, () => {
    if (keys.length) db.prepare(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => f[k]), target.id);
    // Moving department / disabling / password reset → end existing sessions
    if ((f.status && f.status !== 'active') || f.password_hash || (deptId !== target.dept_id) || (f.role && f.role !== target.role))
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
    // Leaving a department → unassign open tasks there so nothing is stuck with someone who cannot see it
    if (deptId !== target.dept_id) {
      db.prepare("UPDATE tasks SET assignee_id=NULL WHERE assignee_id=? AND status!='done'").run(target.id);
      db.prepare('DELETE FROM task_members WHERE user_id=?').run(target.id);
    }
  });
  return db.prepare(`SELECT ${USER_COLS} FROM users u LEFT JOIN departments d ON d.id=u.dept_id WHERE u.id=?`).get(target.id);
});

// ======================================================================
// Users / Team / Workload
// ======================================================================
route('GET', '/api/users', ({ user }) => {
  const depts = visibleDeptIds(db, user);
  return db.prepare(`SELECT u.id,u.name,u.role,u.title,u.presence,u.dept_id,d.code dept_code FROM users u LEFT JOIN departments d ON d.id=u.dept_id
    WHERE u.status='active' AND (u.dept_id IN (${inList(depts)}) OR u.role IN ('admin','superadmin')) ORDER BY u.dept_id, u.id`).all(...depts);
});

route('GET', '/api/team', ({ user, query }) => {
  const depts = scopeDepts(db, user, query.get('dept'));
  const list = membersWithLoad(db, depts);
  if (user.role !== 'staff') return list;
  // Staff see coworkers' workload numbers, but only the titles of tasks they are involved in
  const scope = taskScope(user);
  const mine = new Set(db.prepare(`SELECT t.id FROM tasks t WHERE t.dept_id IN (${inList(depts)}) AND ${scope.sql}`).all(...depts, ...scope.params).map((r) => r.id));
  return list.map((m) => ({ ...m, current: m.current.filter((x) => mine.has(x.id)) }));
});

route('GET', '/api/assignable', ({ user, query }) => {
  const d = deptByCode(query.get('dept') || user.dept_code);
  if (!d || !canSeeDept(user, d.id)) deny();
  let list = membersWithLoad(db, [d.id]);
  if (!canManageDept(user, d.id)) list = list.filter((m) => m.id === user.id);
  return sortByAvailability(list);
});

// ======================================================================
// Tasks
// ======================================================================
const TASK_SELECT = `SELECT t.*, d.code dept_code, au.name assignee_name, au.presence assignee_presence, bu.name assigner_name,
  (SELECT COUNT(*) FROM files f WHERE f.task_id=t.id) file_count,
  (SELECT COUNT(*) FROM comments c WHERE c.task_id=t.id) comment_count,
  (SELECT COUNT(*) FROM task_members m WHERE m.task_id=t.id) member_count,
  (SELECT f.id FROM files f WHERE f.task_id=t.id AND f.kind='image' ORDER BY f.id DESC LIMIT 1) cover_file_id
  FROM tasks t JOIN departments d ON d.id=t.dept_id LEFT JOIN users au ON au.id=t.assignee_id LEFT JOIN users bu ON bu.id=t.assigner_id`;

function getTask(id) {
  const t = db.prepare(`${TASK_SELECT} WHERE t.id=?`).get(id);
  if (!t) throw new HttpError(404, 'Task not found');
  return t;
}
const taskPerms = (user, t) => ({
  edit: canEditTask(db, user, t), assign: canManageDept(user, t.dept_id), approve: canManageDept(user, t.dept_id),
  remove: canDeleteTask(user, t), upload: canSeeTask(db, user, t), members: canSetMembers(user, t),
});
const NO_ACCESS = 'You do not have access to this task';
const requireSeeTask = (user, t) => { if (!canSeeTask(db, user, t)) deny(NO_ACCESS); };
const taskMembers = (id) => db.prepare('SELECT u.id,u.name,u.role,u.presence FROM task_members m JOIN users u ON u.id=m.user_id WHERE m.task_id=? ORDER BY u.name').all(id);

/** Coworkers must be active staff/supervisors of the task's department; the assignee is left out (they see it anyway) */
function validateMembers(deptId, ids, assigneeId) {
  if (!Array.isArray(ids)) throw bad('Invalid request data');
  const clean = [...new Set(ids.map(Number).filter((x) => Number.isInteger(x) && x !== assigneeId))].slice(0, 50);
  for (const id of clean) {
    const u = activeUser(id);
    if (!u || u.dept_id !== deptId || !['staff', 'supervisor'].includes(u.role)) throw bad('Coworkers must be in the same department as the task');
  }
  return clean;
}
/** Replace the coworker list; returns the ids that were newly added */
function setMembers(taskId, ids) {
  const before = new Set(db.prepare('SELECT user_id FROM task_members WHERE task_id=?').all(taskId).map((r) => r.user_id));
  if (ids.length) db.prepare(`DELETE FROM task_members WHERE task_id=? AND user_id NOT IN (${inList(ids)})`).run(taskId, ...ids);
  else db.prepare('DELETE FROM task_members WHERE task_id=?').run(taskId);
  for (const id of ids) db.prepare('INSERT OR IGNORE INTO task_members (task_id,user_id) VALUES (?,?)').run(taskId, id);
  return ids.filter((id) => !before.has(id));
}
/** Everyone involved in a task except `exceptId` (for notifications) */
const taskPeople = (t, exceptId) => [...new Set([t.assignee_id, t.assigner_id, t.created_by, ...taskMembers(t.id).map((m) => m.id)])].filter((x) => x && x !== exceptId);

route('GET', '/api/tasks', ({ user, query }) => {
  const depts = scopeDepts(db, user, query.get('dept'));
  const scope = taskScope(user);
  const where = [`t.dept_id IN (${inList(depts)})`, scope.sql];
  const params = [...depts, ...scope.params];
  const assignee = query.get('assignee');
  if (assignee === 'me') { where.push('t.assignee_id=?'); params.push(user.id); }
  else if (assignee) { where.push('t.assignee_id=?'); params.push(Number(assignee)); }
  const q = query.get('q');
  if (q) { where.push('(t.title LIKE ? OR t.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (query.get('hideOldDone') !== '0') { where.push("(t.status!='done' OR t.completed_at >= ?)"); params.push(addDays(ymd(), -30)); }
  return db.prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.sort, t.due_date`).all(...params);
});

route('GET', '/api/tasks/:id', ({ user, params }) => {
  const t = getTask(Number(params.id));
  requireSeeTask(user, t);
  const files = db.prepare('SELECT f.*, u.name uploader_name FROM files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.task_id=? ORDER BY f.id DESC').all(t.id).map(fileOut);
  const comments = db.prepare('SELECT c.*, u.name user_name, u.role user_role FROM comments c JOIN users u ON u.id=c.user_id WHERE c.task_id=? ORDER BY c.id').all(t.id);
  return { ...t, files, comments, members: taskMembers(t.id), can: taskPerms(user, t) };
});

function validateAssignee(user, deptId, assigneeId) {
  if (assigneeId == null) return null;
  const a = activeUser(assigneeId);
  if (!a || a.dept_id !== deptId) throw bad('The assignee must be in the same department as the task');
  if (!canManageDept(user, deptId) && a.id !== user.id) deny('Staff can only assign tasks to themselves');
  return a.id;
}

route('POST', '/api/tasks', async ({ req, user }) => {
  const b = await readJson(req);
  const dept = deptByCode(b.dept || user.dept_code);
  if (!dept) throw bad('Please choose a department');
  if (!canSeeDept(user, dept.id)) deny('You can only add tasks in your own department');
  const title = str(b.title, 200);
  if (!title) throw bad('Please enter a task name');
  const start = isYmd(b.start_date) ? b.start_date : ymd();
  const due = isYmd(b.due_date) ? b.due_date : start;
  if (due < start) throw bad('The due date cannot be before the start date');
  const priority = PRIORITY.includes(b.priority) ? b.priority : 'medium';
  let status = STATUS.includes(b.status) ? b.status : 'todo';
  if (status === 'done' && !canManageDept(user, dept.id)) status = 'todo';
  const assigneeId = validateAssignee(user, dept.id, int(b.assignee_id) ?? (user.role === 'staff' ? user.id : null));
  const memberIds = validateMembers(dept.id, b.member_ids ?? [], assigneeId).filter((x) => x !== user.id);
  const now = localIso();
  const sort = (db.prepare('SELECT MIN(sort) m FROM tasks WHERE dept_id=? AND status=?').get(dept.id, status).m ?? 1) - 1;
  const id = Number(db.prepare(`INSERT INTO tasks (title,description,dept_id,assignee_id,assigner_id,created_by,start_date,due_date,completed_at,priority,status,progress,sort,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(title, str(b.description), dept.id, assigneeId, user.id, user.id, start, due,
    status === 'done' ? now : null, priority, status, status === 'done' ? 100 : Math.max(0, Math.min(100, int(b.progress) || 0)), sort, now, now).lastInsertRowid);
  setMembers(id, memberIds);
  if (assigneeId && assigneeId !== user.id) notify(assigneeId, 'assign', '{name} assigned you a task', title, `#/task/${id}`, { name: user.name });
  for (const m of memberIds) notify(m, 'member', '{name} added you to a task', title, `#/task/${id}`, { name: user.name });
  return getTask(id);
});

route('PATCH', '/api/tasks/:id', async ({ req, user, params }) => {
  const t = getTask(Number(params.id));
  requireSeeTask(user, t);
  if (!canEditTask(db, user, t)) deny('You can only edit tasks you are responsible for or created');
  const b = await readJson(req);
  let memberIds = null;
  if ('member_ids' in b) {
    if (!canSetMembers(user, t)) deny('Only the assignee, the creator or a supervisor can choose coworkers');
    const aid = 'assignee_id' in b ? int(b.assignee_id) : t.assignee_id;
    memberIds = validateMembers(t.dept_id, b.member_ids, aid);
  }
  const manager = canManageDept(user, t.dept_id);
  const up = {};
  if ('title' in b) { up.title = str(b.title, 200); if (!up.title) throw bad('Please enter a task name'); }
  if ('description' in b) up.description = str(b.description);
  if ('priority' in b) { if (!PRIORITY.includes(b.priority)) throw bad('Invalid priority'); up.priority = b.priority; }
  if ('start_date' in b) { if (!isYmd(b.start_date)) throw bad('Invalid start date'); up.start_date = b.start_date; }
  if ('due_date' in b) { if (!isYmd(b.due_date)) throw bad('Invalid due date'); up.due_date = b.due_date; }
  if ((up.due_date ?? t.due_date) < (up.start_date ?? t.start_date)) throw bad('The due date cannot be before the start date');
  if ('progress' in b) { const p = int(b.progress); if (Number.isNaN(p) || p == null) throw bad('Invalid progress'); up.progress = Math.max(0, Math.min(100, p)); }
  if ('sort' in b && Number.isFinite(Number(b.sort))) up.sort = Number(b.sort);
  if ('assignee_id' in b) {
    const aid = int(b.assignee_id);
    if (aid !== t.assignee_id) {
      if (!manager) deny('Only a supervisor can change the assignee');
      up.assignee_id = validateAssignee(user, t.dept_id, aid);
      up.assigner_id = user.id;
    }
  }
  if ('status' in b && b.status !== t.status) {
    if (!STATUS.includes(b.status)) throw bad('Invalid status');
    if ((b.status === 'done' || t.status === 'done') && !manager) deny('Only a supervisor can approve or reopen a completed task. Move it to "In review" instead');
    up.status = b.status;
    if (b.status === 'done') { up.completed_at = localIso(); up.progress = 100; }
    else if (t.status === 'done') up.completed_at = null;
    if (b.status === 'review') up.progress = Math.max(up.progress ?? t.progress, 90);
  }
  if (Object.keys(up).length) {
    up.updated_at = localIso();
    const ks = Object.keys(up);
    db.prepare(`UPDATE tasks SET ${ks.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...ks.map((k) => up[k]), t.id);
  }
  const link = `#/task/${t.id}`;
  const title = up.title || t.title;
  if (memberIds) for (const m of setMembers(t.id, memberIds)) if (m !== user.id) notify(m, 'member', '{name} added you to a task', title, link, { name: user.name });
  if (up.assignee_id && up.assignee_id !== user.id) notify(up.assignee_id, 'assign', '{name} assigned you a task', title, link, { name: user.name });
  if (up.status === 'review')
    for (const l of db.prepare("SELECT id FROM users WHERE role='supervisor' AND status='active' AND dept_id=? AND id!=?").all(t.dept_id, user.id))
      notify(l.id, 'review', '{name} submitted a task for review', title, link, { name: user.name });
  if (up.status === 'done' && t.assignee_id && t.assignee_id !== user.id) notify(t.assignee_id, 'done', 'Your task was approved 🎉', title, link);
  if (up.status && up.status !== 'done' && up.status !== 'review' && t.assignee_id && t.assignee_id !== user.id && manager)
    notify(t.assignee_id, 'status', 'Task status changed to "{status}"', title, link, { status: up.status });
  return getTask(t.id);
});

route('DELETE', '/api/tasks/:id', ({ user, params }) => {
  const t = getTask(Number(params.id));
  if (!canSeeDept(user, t.dept_id) || !canDeleteTask(user, t)) deny('You cannot delete this task');
  const files = db.prepare('SELECT stored FROM files WHERE task_id=?').all(t.id);
  db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.stored), { force: true }, () => {});
  return { ok: true };
});

route('POST', '/api/tasks/:id/comments', async ({ req, user, params }) => {
  const t = getTask(Number(params.id));
  requireSeeTask(user, t);
  const body = str((await readJson(req)).body, 3000);
  if (!body) throw bad('Please type a message');
  const id = Number(db.prepare('INSERT INTO comments (task_id,user_id,body,created_at) VALUES (?,?,?,?)').run(t.id, user.id, body, localIso()).lastInsertRowid);
  for (const uid of taskPeople(t, user.id))
    notify(uid, 'comment', '{name} commented', `${t.title}: ${body.slice(0, 80)}`, `#/task/${t.id}`, { name: user.name });
  return db.prepare('SELECT c.*, u.name user_name, u.role user_role FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(id);
});

// ======================================================================
// Review queue — supervisors/managers check work submitted "In review"
// ======================================================================
/** Departments whose work this user can approve */
const reviewDepts = (user) => visibleDeptIds(db, user).filter((id) => canManageDept(user, id));
const MEDIA_COLS = `,
  (SELECT f.id FROM files f WHERE f.task_id=t.id AND f.kind IN ('video','image') ORDER BY f.kind='video' DESC, f.id DESC LIMIT 1) media_id,
  (SELECT f.kind FROM files f WHERE f.task_id=t.id AND f.kind IN ('video','image') ORDER BY f.kind='video' DESC, f.id DESC LIMIT 1) media_kind
  FROM tasks t`;
const REVIEW_SELECT = TASK_SELECT.replace(/\n\s*FROM tasks t/, MEDIA_COLS);

route('GET', '/api/review', ({ user, query }) => {
  if (user.role === 'staff') deny('Only supervisors and managers can review tasks');
  const allowed = reviewDepts(user);
  const depts = scopeDepts(db, user, query.get('dept')).filter((id) => allowed.includes(id));
  if (query.get('state') === 'done')
    return db.prepare(`${REVIEW_SELECT} WHERE t.dept_id IN (${inList(depts)}) AND t.status='done' AND t.completed_at >= ? ORDER BY t.completed_at DESC LIMIT 100`)
      .all(...depts, addDays(ymd(), -30));
  // Oldest submission first — it has waited the longest
  return db.prepare(`${REVIEW_SELECT} WHERE t.dept_id IN (${inList(depts)}) AND t.status='review' ORDER BY t.updated_at, t.id`).all(...depts);
});

route('POST', '/api/tasks/:id/review', async ({ req, user, params }) => {
  const t = getTask(Number(params.id));
  if (!canManageDept(user, t.dept_id)) deny('Only supervisors and managers can review tasks');
  if (t.status !== 'review') throw new HttpError(409, 'This task is no longer waiting for review');
  const b = await readJson(req);
  const note = str(b.note, 3000);
  if (!['approve', 'changes'].includes(b.action)) throw bad('Invalid request data');
  if (b.action === 'changes' && !note) throw bad('Please write what needs to be changed');
  const now = localIso();
  tx(db, () => {
    if (b.action === 'approve') db.prepare("UPDATE tasks SET status='done', completed_at=?, progress=100, updated_at=? WHERE id=?").run(now, now, t.id);
    else db.prepare("UPDATE tasks SET status='doing', completed_at=NULL, updated_at=? WHERE id=?").run(now, t.id);
    if (note) db.prepare('INSERT INTO comments (task_id,user_id,body,created_at) VALUES (?,?,?,?)').run(t.id, user.id, b.action === 'changes' ? `↩ ${note}` : note, now);
  });
  const link = `#/task/${t.id}`;
  if (t.assignee_id && t.assignee_id !== user.id) {
    if (b.action === 'approve') notify(t.assignee_id, 'done', 'Your task was approved 🎉', t.title, link);
    else notify(t.assignee_id, 'changes', '{name} asked for changes', `${t.title}: ${note.slice(0, 80)}`, link, { name: user.name });
  }
  return getTask(t.id);
});

// ======================================================================
// Video conversion — browsers (Chrome/Edge on Windows especially) cannot show HEVC/H.265 or 10-bit HDR video,
// which is the iPhone default. When ffmpeg is installed (see Dockerfile), such uploads are converted to
// MP4/H.264 in the background, one at a time. Without ffmpeg videos are kept exactly as uploaded.
// ======================================================================
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
let hasFfmpeg = false;
const converting = new Set();
let videoQueue = Promise.resolve();
const run = (bin, args, timeout) => new Promise((resolve, reject) =>
  execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout))));

/** null = fine as is; otherwise 'remux' (only the container is wrong) or 'encode' */
async function videoNeeds(file, ext) {
  let s;
  try { s = JSON.parse(await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt', '-of', 'json', file], 30_000)).streams?.[0]; }
  catch { return null; }
  if (!s) return null; // no picture at all — nothing to convert
  const codecOk = ['h264', 'vp8', 'vp9', 'av1'].includes(s.codec_name) && (!s.pix_fmt || s.pix_fmt === 'yuv420p');
  const containerOk = ['mp4', 'm4v', 'webm'].includes(ext);
  if (codecOk && containerOk) return null;
  return codecOk && s.codec_name === 'h264' ? 'remux' : 'encode';
}
const fileOut = (f) => ({ ...f, processing: converting.has(f.id) });

function queueVideo(id, mode) {
  converting.add(id);
  videoQueue = videoQueue.then(() => convertVideo(id, mode)
    .catch((e) => console.error(`Video ${id} conversion failed:`, e.message, String(e.stderr || '').slice(-500)))
    .finally(() => converting.delete(id)));
}
async function convertVideo(id, mode) {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(id);
  if (!f) return;
  const src = path.join(UPLOAD_DIR, f.stored);
  if (!fs.existsSync(src)) return;
  const stored = `${crypto.randomBytes(16).toString('hex')}.mp4`;
  const dest = path.join(UPLOAD_DIR, stored);
  // Longest side at most 1920px, even dimensions; phone rotation is applied automatically
  const scale = "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))'";
  const video = mode === 'remux' ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', scale];
  const started = Date.now();
  try {
    await run(FFMPEG, ['-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', ...video, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dest], 30 * 60_000);
  } catch (e) { fs.rm(dest, { force: true }, () => {}); throw e; }
  const size = fs.statSync(dest).size;
  const name = f.name.replace(/\.[^.]+$/, '') + '.mp4';
  const r = db.prepare("UPDATE files SET stored=?, name=?, mime='video/mp4', size=? WHERE id=? AND stored=?").run(stored, name, size, f.id, f.stored);
  if (!r.changes) { fs.rm(dest, { force: true }, () => {}); return; } // deleted meanwhile
  fs.rm(src, { force: true }, () => {});
  console.log(`Video ${id} converted (${mode}) in ${Math.round((Date.now() - started) / 1000)}s: ${name}`);
}
/** On start: detect ffmpeg, then check every stored video once (fixes videos uploaded before conversion existed) */
run(FFMPEG, ['-version'], 10_000).then(async () => {
  hasFfmpeg = true;
  console.log('  ffmpeg found: unplayable videos (HEVC/H.265, 10-bit, .mov) will be converted to MP4/H.264');
  for (const f of db.prepare("SELECT id,stored FROM files WHERE kind='video'").all()) {
    const mode = await videoNeeds(path.join(UPLOAD_DIR, f.stored), extOf(f.stored));
    if (mode) queueVideo(f.id, mode);
  }
}, () => console.log('  ffmpeg not found: videos are kept exactly as uploaded'));

// ======================================================================
// Files
// ======================================================================
route('POST', '/api/tasks/:id/files', async ({ req, user, params }) => {
  const t = getTask(Number(params.id));
  if (!canSeeTask(db, user, t)) deny('You can only upload files to tasks you can see');
  let name;
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { name = ''; }
  name = path.basename(name).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 180);
  if (!name) throw bad('File name is missing');
  const ext = extOf(name);
  const kind = EXT_KIND[ext];
  const rule = DEPT_FILE_RULES[t.dept_code];
  if (!kind || ext === 'svg' || !rule.kinds.includes(kind)) throw new HttpError(415, 'This department only accepts: {types}', { types: rule.label, _translate: ['types'] });
  const limit = MAX_SIZE[kind] || MAX_SIZE.default;
  const mb = Math.round(limit / 1048576);
  if (Number(req.headers['content-length'] || 0) > limit) throw new HttpError(413, 'File is larger than {mb} MB', { mb });
  const stored = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const dest = path.join(UPLOAD_DIR, stored);
  let size = 0;
  try {
    await pipeline(req, async function* (src) {
      for await (const chunk of src) { size += chunk.length; if (size > limit) throw new HttpError(413, 'File is larger than {mb} MB', { mb }); yield chunk; }
    }, fs.createWriteStream(dest));
  } catch (e) { fs.rm(dest, { force: true }, () => {}); throw e; }
  if (!size) { fs.rm(dest, { force: true }, () => {}); throw bad('The file is empty'); }
  const id = Number(db.prepare('INSERT INTO files (task_id,dept_id,name,stored,mime,size,kind,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(t.id, t.dept_id, name, stored, EXT_MIME[ext] || 'application/octet-stream', size, kind, user.id, localIso()).lastInsertRowid);
  if (kind === 'video' && hasFfmpeg) { const mode = await videoNeeds(dest, ext); if (mode) queueVideo(id, mode); }
  if (t.assignee_id && t.assignee_id !== user.id) notify(t.assignee_id, 'file', '{name} attached a file to your task', `${t.title}: ${name}`, `#/task/${t.id}`, { name: user.name });
  return fileOut(db.prepare('SELECT f.*, u.name uploader_name FROM files f LEFT JOIN users u ON u.id=f.uploaded_by WHERE f.id=?').get(id));
});

route('GET', '/api/files', ({ user, query }) => {
  const depts = scopeDepts(db, user, query.get('dept'));
  const scope = taskScope(user);
  return db.prepare(`SELECT f.*, u.name uploader_name, t.title task_title, d.code dept_code FROM files f JOIN departments d ON d.id=f.dept_id
    LEFT JOIN users u ON u.id=f.uploaded_by JOIN tasks t ON t.id=f.task_id WHERE f.dept_id IN (${inList(depts)}) AND ${scope.sql} ORDER BY f.id DESC`).all(...depts, ...scope.params).map(fileOut);
});
/** A file is visible exactly when its task is */
function canSeeFile(user, f) {
  const t = f.task_id ? db.prepare('SELECT * FROM tasks WHERE id=?').get(f.task_id) : null;
  return t ? canSeeTask(db, user, t) : canManageDept(user, f.dept_id);
}

route('DELETE', '/api/files/:id', ({ user, params }) => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(Number(params.id));
  if (!f) throw new HttpError(404, 'File not found');
  if (!canSeeFile(user, f) || !(f.uploaded_by === user.id || canManageDept(user, f.dept_id))) deny('You can only delete files you uploaded');
  db.prepare('DELETE FROM files WHERE id=?').run(f.id);
  fs.rm(path.join(UPLOAD_DIR, f.stored), { force: true }, () => {});
  return { ok: true };
});

function serveUpload(req, res, user, id, download) {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(id);
  if (!f) throw new HttpError(404, 'File not found');
  if (!canSeeFile(user, f)) deny('You do not have access to this file');
  const file = path.join(UPLOAD_DIR, f.stored);
  if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) throw new HttpError(404, 'File not found');
  const stat = fs.statSync(file);
  // The stored name changes when a video is converted, so it doubles as a version tag: browsers revalidate (cheap 304)
  const etag = `"${f.stored}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache' }); return res.end(); }
  const headers = {
    'Content-Type': f.mime,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-cache',
    ETag: etag,
  };
  // SVG/text may contain script — serve sandboxed (PDF must not be sandboxed or the browser viewer breaks)
  if (f.mime.startsWith('image/svg') || f.mime.startsWith('text/')) headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    if (start >= stat.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
}

// ======================================================================
// Meetings
// ======================================================================
function meetingRows(user, extraWhere = '', extraParams = []) {
  let where = '1=1';
  const params = [];
  if (!isAdmin(user)) {
    where = '(m.organizer_id=? OR EXISTS (SELECT 1 FROM meeting_attendees a WHERE a.meeting_id=m.id AND a.user_id=?)' + (user.role === 'supervisor' ? ' OR m.dept_id=?)' : ')');
    params.push(user.id, user.id);
    if (user.role === 'supervisor') params.push(user.dept_id);
  }
  const rows = db.prepare(`SELECT m.*, u.name organizer_name, d.code dept_code FROM meetings m JOIN users u ON u.id=m.organizer_id LEFT JOIN departments d ON d.id=m.dept_id
    WHERE ${where} ${extraWhere} ORDER BY m.start_at`).all(...params, ...extraParams);
  const att = db.prepare('SELECT a.user_id, a.response, u.name, u.dept_id, d.code dept_code FROM meeting_attendees a JOIN users u ON u.id=a.user_id LEFT JOIN departments d ON d.id=u.dept_id WHERE a.meeting_id=? ORDER BY u.id');
  return rows.map((m) => {
    const attendees = att.all(m.id);
    const mine = attendees.find((a) => a.user_id === user.id);
    return { ...m, attendees, my_response: mine ? mine.response : null, can_delete: m.organizer_id === user.id || isAdmin(user) };
  });
}
route('GET', '/api/meetings', ({ user, query }) => {
  const from = query.get('from'), to = query.get('to');
  const w = []; const p = [];
  if (isYmd(from)) { w.push('AND m.end_at >= ?'); p.push(from); }
  if (isYmd(to)) { w.push('AND m.start_at < ?'); p.push(addDays(to, 1)); }
  return meetingRows(user, w.join(' '), p);
});
route('POST', '/api/meetings', async ({ req, user }) => {
  if (user.role === 'staff') deny('Only supervisors and managers can schedule meetings');
  const b = await readJson(req);
  const title = str(b.title, 200);
  if (!title) throw bad('Please enter a meeting title');
  if (!isLocalDateTime(b.start_at) || !isLocalDateTime(b.end_at)) throw bad('Please enter a valid date and time');
  if (b.end_at <= b.start_at) throw bad('The end time must be after the start time');
  const url = str(b.online_url, 500);
  if (url && !/^https?:\/\//i.test(url)) throw bad('The online link must start with http:// or https://');
  const ids = [...new Set((Array.isArray(b.attendee_ids) ? b.attendee_ids : []).map(Number).filter((x) => Number.isInteger(x) && x !== user.id))];
  if (!ids.length) throw bad('Please choose at least one attendee');
  const people = ids.map(activeUser);
  if (people.some((p) => !p)) throw bad('Some attendees were not found');
  if (!isAdmin(user) && people.some((p) => p.dept_id !== user.dept_id)) deny('Supervisors can only invite people from their own department');
  const deptSet = new Set(people.map((p) => p.dept_id).concat(isAdmin(user) ? [] : [user.dept_id]));
  const deptId = deptSet.size === 1 ? [...deptSet][0] : null;
  const start = b.start_at.slice(0, 16) + ':00', end = b.end_at.slice(0, 16) + ':00';
  const id = tx(db, () => {
    const mid = Number(db.prepare('INSERT INTO meetings (title,start_at,end_at,location,online_url,agenda,dept_id,organizer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(title, start, end, str(b.location, 200), url, str(b.agenda), deptId, user.id, localIso()).lastInsertRowid);
    db.prepare("INSERT INTO meeting_attendees (meeting_id,user_id,response) VALUES (?,?,'accepted')").run(mid, user.id);
    for (const p of people) db.prepare("INSERT INTO meeting_attendees (meeting_id,user_id,response) VALUES (?,?,'pending')").run(mid, p.id);
    return mid;
  });
  for (const p of people) notify(p.id, 'meeting', '{name} invited you to a meeting', `${title} — ${start.slice(0, 10)} ${start.slice(11, 16)}`, '#/meetings', { name: user.name }, `meet-invite:${id}`);
  return meetingRows(user, 'AND m.id=?', [id])[0];
});
route('POST', '/api/meetings/:id/respond', async ({ req, user, params }) => {
  const { response } = await readJson(req);
  if (!['accepted', 'declined'].includes(response)) throw bad('Invalid response');
  const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(Number(params.id));
  if (!m) throw new HttpError(404, 'Meeting not found');
  const r = db.prepare('UPDATE meeting_attendees SET response=? WHERE meeting_id=? AND user_id=?').run(response, m.id, user.id);
  if (!r.changes) deny('You are not on the attendee list for this meeting');
  if (m.organizer_id !== user.id)
    notify(m.organizer_id, 'rsvp', response === 'accepted' ? '{name} accepted the meeting' : '{name} declined the meeting', m.title, '#/meetings', { name: user.name }, `rsvp:${m.id}:${user.id}:${response}:${Date.now()}`);
  return meetingRows(user, 'AND m.id=?', [m.id])[0];
});
route('DELETE', '/api/meetings/:id', ({ user, params }) => {
  const m = db.prepare('SELECT * FROM meetings WHERE id=?').get(Number(params.id));
  if (!m) throw new HttpError(404, 'Meeting not found');
  if (m.organizer_id !== user.id && !isAdmin(user)) deny('Only the organizer can cancel this meeting');
  const att = db.prepare('SELECT user_id FROM meeting_attendees WHERE meeting_id=?').all(m.id);
  db.prepare('DELETE FROM meetings WHERE id=?').run(m.id);
  for (const a of att) if (a.user_id !== user.id) notify(a.user_id, 'meeting', 'Meeting cancelled', m.title, '#/meetings');
  return { ok: true };
});

// ======================================================================
// Notifications
// ======================================================================
function generateReminders(user) {
  const today = ymd();
  for (const t of db.prepare("SELECT id,title,due_date FROM tasks WHERE assignee_id=? AND status!='done' AND due_date BETWEEN ? AND ?").all(user.id, today, addDays(today, 2)))
    notify(user.id, 'due', t.due_date === today ? 'Task due today' : 'Task due soon', t.title, `#/task/${t.id}`, {}, `due:${t.id}:${t.due_date}`);
  for (const t of db.prepare("SELECT id,title FROM tasks WHERE assignee_id=? AND status!='done' AND due_date < ?").all(user.id, today))
    notify(user.id, 'overdue', 'Task is overdue', t.title, `#/task/${t.id}`, {}, `overdue:${t.id}`);
  const nowIso = localIso(), next = localIso(new Date(Date.now() + 24 * 3600_000));
  for (const m of db.prepare(`SELECT m.id,m.title,m.start_at FROM meetings m JOIN meeting_attendees a ON a.meeting_id=m.id
    WHERE a.user_id=? AND a.response!='declined' AND m.start_at BETWEEN ? AND ?`).all(user.id, nowIso, next))
    notify(user.id, 'meeting-soon', 'Meeting within 24 hours', `${m.title} — ${m.start_at.slice(11, 16)}`, '#/meetings', {}, `meet-soon:${m.id}`);
}
route('GET', '/api/notifications', ({ user }) => {
  generateReminders(user);
  const items = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 40').all(user.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(user.id).c;
  const out = { items, unread };
  if (user.role !== 'staff') {
    const depts = reviewDepts(user);
    out.reviewCount = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE status='review' AND dept_id IN (${inList(depts)})`).get(...depts).c;
  }
  return out;
});
route('POST', '/api/notifications/read', async ({ req, user }) => {
  const { id } = await readJson(req);
  if (id) db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(Number(id), user.id);
  else db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(user.id);
  return { ok: true };
});

// ======================================================================
// KPI
// ======================================================================
route('GET', '/api/kpi', ({ user, query }) => {
  const period = query.get('period') === 'month' ? 'month' : 'week';
  const depts = scopeDepts(db, user, query.get('dept'));
  let people = db.prepare(`SELECT u.id,u.name,u.title,u.role,u.dept_id,d.code dept_code FROM users u JOIN departments d ON d.id=u.dept_id
    WHERE u.status='active' AND u.dept_id IN (${inList(depts)}) AND u.role='staff' ORDER BY u.id`).all(...depts);
  if (user.role === 'staff') people = people.filter((p) => p.id === user.id);
  const ids = people.map((p) => p.id);
  const tasks = db.prepare(`SELECT id,assignee_id,dept_id,status,start_date,due_date,completed_at FROM tasks WHERE assignee_id IN (${inList(ids)})`).all(...ids);
  const rows = people.map((p) => ({ ...p, ...kpiFor(tasks.filter((t) => t.assignee_id === p.id)) }));
  for (const d of depts) rows.filter((r) => r.dept_id === d).sort((a, b) => b.score - a.score || b.done - a.done).forEach((r, i) => { r.rank = i + 1; });
  const focus = int(query.get('user'));
  if (focus && !ids.includes(focus)) deny("You do not have access to this employee's KPI");
  return {
    period,
    summary: kpiFor(tasks),
    series: kpiSeries(focus ? tasks.filter((t) => t.assignee_id === focus) : tasks, period),
    users: rows.sort((a, b) => a.dept_id - b.dept_id || a.rank - b.rank),
  };
});

// ======================================================================
// Dashboard
// ======================================================================
route('GET', '/api/dashboard', ({ user, query }) => {
  const today = ymd();
  const depts = scopeDepts(db, user, query.get('dept'));
  const scope = taskScope(user);
  const all = db.prepare(`${TASK_SELECT} WHERE t.dept_id IN (${inList(depts)}) AND ${scope.sql}`).all(...depts, ...scope.params);
  const open = all.filter((t) => t.status !== 'done');
  const byStatus = Object.fromEntries(STATUS.map((s) => [s, s === 'done'
    ? all.filter((t) => t.status === 'done' && t.completed_at >= addDays(today, -30)).length
    : all.filter((t) => t.status === s).length]));
  const lite = (t) => ({ id: t.id, title: t.title, dept_code: t.dept_code, due_date: t.due_date, status: t.status, priority: t.priority, progress: t.progress, assignee_name: t.assignee_name, assignee_id: t.assignee_id });
  const members = membersWithLoad(db, depts);
  const staffIds = members.filter((m) => m.role === 'staff').map((m) => m.id);
  const kpiTasks = all.filter((t) => staffIds.includes(t.assignee_id));
  const overdue = open.filter((t) => t.due_date < today);
  const result = {
    today,
    statusCounts: byStatus,
    openCount: open.length,
    overdue: overdue.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8).map(lite),
    overdueCount: overdue.length,
    dueSoon: open.filter((t) => t.due_date >= today && t.due_date <= addDays(today, 3)).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8).map(lite),
    people: {
      total: members.length,
      free: members.filter((m) => m.presence !== 'away' && m.workload.level === 'free').length,
      balanced: members.filter((m) => m.presence !== 'away' && m.workload.level === 'balanced').length,
      overloaded: members.filter((m) => m.presence !== 'away' && m.workload.level === 'overloaded').length,
      away: members.filter((m) => m.presence === 'away').length,
    },
    members: sortByAvailability(members).map((m) => ({ id: m.id, name: m.name, title: m.title, role: m.role, dept_code: m.dept_code, presence: m.presence, workload: m.workload })),
    kpi: kpiFor(kpiTasks),
    series: kpiSeries(kpiTasks, 'week'),
  };
  if (depts.length > 1) {
    result.perDept = depts.map((id) => {
      const d = db.prepare('SELECT code FROM departments WHERE id=?').get(id);
      const ts = all.filter((t) => t.dept_id === id);
      const ms = members.filter((m) => m.dept_id === id);
      return {
        code: d.code,
        counts: Object.fromEntries(STATUS.slice(0, 3).map((s) => [s, ts.filter((t) => t.status === s).length])),
        overdue: ts.filter((t) => t.status !== 'done' && t.due_date < today).length,
        free: ms.filter((m) => m.presence !== 'away' && m.workload.level === 'free').length,
        members: ms.length,
        kpi: kpiFor(ts.filter((t) => staffIds.includes(t.assignee_id))),
      };
    });
  }
  const mine = db.prepare(`${TASK_SELECT} WHERE t.assignee_id=?`).all(user.id);
  const myOpen = mine.filter((t) => t.status !== 'done');
  result.mine = {
    today: myOpen.filter((t) => t.start_date <= today).sort((a, b) => a.due_date.localeCompare(b.due_date)).map(lite),
    dueSoon: myOpen.filter((t) => t.due_date <= addDays(today, 3)).sort((a, b) => a.due_date.localeCompare(b.due_date)).map(lite),
    upcoming: myOpen.filter((t) => t.start_date > today).length,
    workload: workloadFor(mine),
    kpi: kpiFor(mine),
    doneThisMonth: mine.filter((t) => t.status === 'done' && t.completed_at && t.completed_at.slice(0, 7) === today.slice(0, 7)).length,
  };
  result.meetings = meetingRows(user, 'AND m.end_at >= ? AND EXISTS (SELECT 1 FROM meeting_attendees a2 WHERE a2.meeting_id=m.id AND a2.user_id=?)', [localIso(), user.id]).slice(0, 5);
  if (isSuper(user)) result.pendingUsers = db.prepare("SELECT COUNT(*) c FROM users WHERE status='pending'").get().c;
  return result;
});

// ======================================================================
// HTTP server + static files
// ======================================================================
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC_DIR, 'index.html');
  res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const lang = langOf(req);
  try {
    const fm = /^\/files\/(\d+)$/.exec(url.pathname);
    if (fm && req.method === 'GET') {
      const user = getUser(req);
      if (!user) throw new HttpError(401, 'Please log in');
      return serveUpload(req, res, user, Number(fm[1]), url.searchParams.get('download') === '1');
    }
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    // CSRF: state-changing requests must come from the same origin
    if (req.method !== 'GET' && req.headers.origin) {
      let o = ''; try { o = new URL(req.headers.origin).host; } catch { /* */ }
      const hosts = [req.headers.host, ...String(req.headers['x-forwarded-host'] || '').split(',')].map((h) => String(h || '').trim()).filter(Boolean);
      if (!hosts.includes(o)) throw new HttpError(403, 'Invalid origin');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const user = getUser(req);
      if (!r.opts.public && !user) throw new HttpError(401, 'Please log in');
      const out = await r.handler({ req, res, user, params, query: url.searchParams });
      return send(res, 200, out ?? { ok: true });
    }
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.destroy();
    send(res, e.status || 500, { error: e instanceof HttpError ? translate(lang, e.message, e.vars) : translate(lang, 'Something went wrong. Please try again') });
    if (req.readable) req.resume();
  }
});
server.listen(PORT, () => console.log(`\n  ⚡ PANDA EV WORKSPACE  →  http://localhost:${PORT}   (data: ${DATA_DIR})\n`));
// Railway sends SIGTERM on redeploy — close the database cleanly
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); try { db.close(); } catch { /* */ } process.exit(0); });
