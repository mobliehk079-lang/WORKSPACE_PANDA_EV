// Permission rules (role + department), workload and KPI — enforced server-side on every read/write
import { ymd, addDays, diffDays, parseYmd } from './db.js';

export class HttpError extends Error { constructor(status, message, vars = {}) { super(message); this.status = status; this.vars = vars; } }
export const deny = (msg = 'You do not have permission to do this') => { throw new HttpError(403, msg); };

// ---------- สิทธิ์ ----------
export const isSuper = (u) => u.role === 'superadmin';
export const isAdmin = (u) => u.role === 'admin' || u.role === 'superadmin';
export const canSeeDept = (u, deptId) => isAdmin(u) || u.dept_id === deptId;
export const canManageDept = (u, deptId) => isAdmin(u) || (u.role === 'supervisor' && u.dept_id === deptId);
export const isTaskMember = (db, taskId, userId) => !!db.prepare('SELECT 1 FROM task_members WHERE task_id=? AND user_id=?').get(taskId, userId);
/** Assignee, creator, assigner or an added coworker — in the task's own department */
export const isInvolved = (db, u, t) => u.dept_id === t.dept_id && (t.assignee_id === u.id || t.created_by === u.id || t.assigner_id === u.id || isTaskMember(db, t.id, u.id));
/** Managers see everything, supervisors their whole department, staff only tasks they are involved in */
export const canSeeTask = (db, u, t) => canManageDept(u, t.dept_id) || isInvolved(db, u, t);
export const canEditTask = (db, u, t) => canSeeTask(db, u, t);
/** Who may change the coworker list: supervisors/managers, the assignee or the creator */
export const canSetMembers = (u, t) => canManageDept(u, t.dept_id) || (u.dept_id === t.dept_id && (t.assignee_id === u.id || t.created_by === u.id));
/** SQL filter (on tasks alias `a`) limiting staff to tasks they are involved in; everyone else is limited by department only */
export function taskScope(u, a = 't') {
  if (u.role !== 'staff') return { sql: '1=1', params: [] };
  return {
    sql: `(${a}.assignee_id=? OR ${a}.created_by=? OR ${a}.assigner_id=? OR EXISTS (SELECT 1 FROM task_members tm WHERE tm.task_id=${a}.id AND tm.user_id=?))`,
    params: [u.id, u.id, u.id, u.id],
  };
}
export const canDeleteTask = (u, t) => canManageDept(u, t.dept_id) || (u.role === 'staff' && t.created_by === u.id && t.assignee_id === u.id && t.status === 'todo');
export function permissions(u) {
  return {
    seeAllDepts: isAdmin(u),
    assignOthers: u.role !== 'staff',
    approveDone: u.role !== 'staff',
    createMeeting: u.role !== 'staff',
    viewTeamKpi: u.role !== 'staff',
    deleteTasks: u.role !== 'staff',
    manageUsers: isSuper(u),
  };
}
/** แผนกที่ผู้ใช้เข้าถึงได้ (array ของ id) */
export function visibleDeptIds(db, u) {
  if (isAdmin(u)) return db.prepare('SELECT id FROM departments ORDER BY id').all().map((r) => r.id);
  return u.dept_id ? [u.dept_id] : [];
}
/** แปลงพารามิเตอร์ ?dept=code|all เป็นรายการ dept id ที่อนุญาต */
export function scopeDepts(db, u, deptCode) {
  const allowed = visibleDeptIds(db, u);
  if (!deptCode || deptCode === 'all') return allowed;
  const d = db.prepare('SELECT id FROM departments WHERE code = ?').get(deptCode);
  if (!d) throw new HttpError(404, 'Department not found');
  if (!allowed.includes(d.id)) deny('You do not have access to this department');
  return [d.id];
}
export const inList = (ids) => (ids.length ? ids.map(() => '?').join(',') : 'NULL');

// ---------- ภาระงาน ----------
export const PRIORITY_WEIGHT = { low: 0.5, medium: 1, high: 1.5, urgent: 2 };
export const CAPACITY = 6; // คะแนนภาระงานที่ถือว่า "เต็ม 100%"
export function workloadFor(tasks) {
  const active = tasks.filter((t) => t.status !== 'done');
  const load = active.reduce((s, t) => s + (PRIORITY_WEIGHT[t.priority] || 1), 0);
  const level = load <= 2 ? 'free' : load <= 4.5 ? 'balanced' : 'overloaded';
  const today = ymd();
  return {
    active: active.length,
    load: Math.round(load * 10) / 10,
    percent: Math.min(100, Math.round((load / CAPACITY) * 100)),
    level,
    overdue: active.filter((t) => t.due_date < today).length,
    byStatus: { todo: active.filter((t) => t.status === 'todo').length, doing: active.filter((t) => t.status === 'doing').length, review: active.filter((t) => t.status === 'review').length },
  };
}
export function membersWithLoad(db, deptIds, { roles = ['supervisor', 'staff'] } = {}) {
  const users = db.prepare(`SELECT u.id,u.name,u.email,u.role,u.title,u.presence,u.dept_id,d.code dept_code FROM users u LEFT JOIN departments d ON d.id=u.dept_id
    WHERE u.status='active' AND u.dept_id IN (${inList(deptIds)}) AND u.role IN (${inList(roles)}) ORDER BY u.dept_id, CASE u.role WHEN 'supervisor' THEN 0 ELSE 1 END, u.id`).all(...deptIds, ...roles);
  const tasks = db.prepare(`SELECT id,title,assignee_id,status,priority,due_date,progress FROM tasks WHERE status!='done' AND dept_id IN (${inList(deptIds)})`).all(...deptIds);
  return users.map((u) => {
    const mine = tasks.filter((t) => t.assignee_id === u.id);
    const w = workloadFor(mine);
    const current = mine.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 3).map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date, priority: t.priority, progress: t.progress }));
    return { ...u, workload: w, current };
  });
}
/** เรียงคนที่ว่างที่สุดก่อน (คนที่ "ไม่อยู่" ไปท้ายสุด) */
export function sortByAvailability(list) {
  return [...list].sort((a, b) => (a.presence === 'away') - (b.presence === 'away') || a.workload.load - b.workload.load || a.workload.active - b.workload.active || a.name.localeCompare(b.name, 'th'));
}

// ---------- KPI ----------
export function kpiFor(tasks, today = ymd()) {
  const done = tasks.filter((t) => t.status === 'done' && t.completed_at);
  const onTime = done.filter((t) => t.completed_at.slice(0, 10) <= t.due_date).length;
  const overdue = tasks.filter((t) => t.status !== 'done' && t.due_date < today).length;
  const avgDays = done.length ? done.reduce((s, t) => s + Math.max(1, diffDays(t.start_date, t.completed_at.slice(0, 10)) + 1), 0) / done.length : 0;
  const total = tasks.length;
  const onTimeRate = done.length ? Math.round((onTime / done.length) * 100) : 0;
  const completionRate = total ? Math.round((done.length / total) * 100) : 0;
  const score = total ? Math.round(onTimeRate * 0.5 + completionRate * 0.3 + Math.max(0, 100 - overdue * 25) * 0.2) : 0;
  return { total, done: done.length, onTime, late: done.length - onTime, onTimeRate, completionRate, overdue, avgDays: Math.round(avgDays * 10) / 10, score };
}

function weekStart(d) { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return ymd(x); }
/** Weekly (8 weeks) or monthly (6 months) completed tasks split on-time/late. Labels are date keys; the client formats them. */
export function kpiSeries(tasks, period = 'week') {
  const today = ymd();
  const buckets = [];
  if (period === 'month') {
    const t = parseYmd(today);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
      const key = ymd(d).slice(0, 7);
      buckets.push({ key, label: key });
    }
  } else {
    const ws = weekStart(parseYmd(today));
    for (let i = 7; i >= 0; i--) {
      const s = addDays(ws, -7 * i);
      buckets.push({ key: s, label: s });
    }
  }
  const onTime = buckets.map(() => 0), late = buckets.map(() => 0);
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completed_at) continue;
    const c = t.completed_at.slice(0, 10);
    const key = period === 'month' ? c.slice(0, 7) : weekStart(parseYmd(c));
    const i = buckets.findIndex((b) => b.key === key);
    if (i < 0) continue;
    if (c <= t.due_date) onTime[i]++; else late[i]++;
  }
  return { period, labels: buckets.map((b) => b.label), onTime, late, done: onTime.map((v, i) => v + late[i]) };
}
