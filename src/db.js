// ฐานข้อมูล SQLite (ใช้ node:sqlite ที่มากับ Node.js — ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Where the database + uploads live. On Railway, attach a Volume: its mount path is picked up automatically.
export const DATA_DIR = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const DB_FILE = path.join(DATA_DIR, 'workspace.db');

export const SCHEMA_VERSION = 2;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  short_en TEXT NOT NULL DEFAULT '',
  description_en TEXT DEFAULT '',
  color TEXT NOT NULL,
  color2 TEXT NOT NULL,
  description TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin','admin','supervisor','staff')),
  dept_id INTEGER REFERENCES departments(id),
  title TEXT DEFAULT '',
  presence TEXT NOT NULL DEFAULT 'available' CHECK (presence IN ('available','busy','away')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','disabled')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  dept_id INTEGER NOT NULL REFERENCES departments(id),
  assignee_id INTEGER REFERENCES users(id),
  assigner_id INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  start_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  completed_at TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','review','done')),
  progress INTEGER NOT NULL DEFAULT 0,
  sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tasks_dept ON tasks(dept_id);
CREATE INDEX IF NOT EXISTS ix_tasks_assignee ON tasks(assignee_id);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  dept_id INTEGER NOT NULL REFERENCES departments(id),
  name TEXT NOT NULL,
  stored TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_files_task ON files(task_id);
-- Coworkers (same department) who can see and work on a task besides the assignee/creator
CREATE TABLE IF NOT EXISTS task_members (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_task_members_user ON task_members(user_id);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  location TEXT DEFAULT '',
  online_url TEXT DEFAULT '',
  agenda TEXT DEFAULT '',
  dept_id INTEGER REFERENCES departments(id),
  organizer_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_attendees (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','accepted','declined')),
  PRIMARY KEY (meeting_id, user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  link TEXT DEFAULT '',
  params TEXT DEFAULT '{}',
  ref_key TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_ref ON notifications(user_id, ref_key);
`;

// ---------- Departments (code is the stable key; new ones are added to existing databases on start) ----------
export const DEPTS = [
  { code: 'it', name: 'ພະແນກໄອທີ (IT)', short: 'IT', name_en: 'IT Department', short_en: 'IT', color: '#38bdf8', color2: '#6366f1',
    description: 'ດູແລລະບົບ, ເຄືອຂ່າຍ, ຄວາມປອດໄພ ແລະ ພັດທະນາຊອບແວພາຍໃນອົງກອນ', description_en: 'Systems, network, security and in-house software development' },
  { code: 'finance', name: 'ພະແນກການເງິນ / ບັນຊີ', short: 'ການເງິນ', name_en: 'Finance / Accounting', short_en: 'Finance', color: '#34d399', color2: '#059669',
    description: 'ບັນຊີ, ງົບການເງິນ, ອາກອນ, ເງິນເດືອນ ແລະ ງົບປະມານຂອງອົງກອນ', description_en: 'Accounting, financial statements, tax, payroll and budgeting' },
  { code: 'marketing', name: 'ພະແນກການຕະຫຼາດ / ກຣາຟິກ', short: 'ການຕະຫຼາດ', name_en: 'Marketing / Graphic', short_en: 'Marketing', color: '#f472b6', color2: '#fb923c',
    description: 'ແຄມເປນ, ຄອນເທັນ, ໂຊຊຽວມີເດຍ, ງານກຣາຟິກ ແລະ ວິດີໂອ', description_en: 'Campaigns, content, social media, graphics and video' },
  { code: 'bizdev', name: 'ພະແນກພັດທະນາທຸລະກິດ', short: 'ພັດທະນາທຸລະກິດ', name_en: 'Business Development', short_en: 'Biz Dev', color: '#fbbf24', color2: '#ea580c',
    description: 'ຫາຄູ່ຮ່ວມທຸລະກິດ, ຕົວແທນຈຳໜ່າຍ, ສາຂາໃໝ່ ແລະ ໂຄງການຂະຫຍາຍທຸລະກິດ', description_en: 'Partners, dealers, new branches and business expansion projects' },
  { code: 'mgmt', name: 'ພະແນກບໍລິຫານ', short: 'ບໍລິຫານ', name_en: 'Administration', short_en: 'Admin', color: '#a78bfa', color2: '#7c3aed',
    description: 'ບໍລິຫານທົ່ວໄປ, ບຸກຄະລາກອນ, ເອກະສານ, ສັນຍາ ແລະ ນະໂຍບາຍຂອງບໍລິສັດ', description_en: 'General administration, HR, documents, contracts and company policy' },
];
export function ensureDepartments(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO departments (code,name,short,name_en,short_en,description,description_en,color,color2) VALUES (?,?,?,?,?,?,?,?,?)');
  let added = 0;
  for (const d of DEPTS) added += Number(ins.run(d.code, d.name, d.short, d.name_en, d.short_en, d.description, d.description_en, d.color, d.color2).changes);
  return added;
}

export function openDb(file = DB_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const ver = db.prepare('PRAGMA user_version').get().user_version;
  const hasTables = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c > 0;
  if (hasTables && ver < SCHEMA_VERSION) {
    // โครงสร้างเปลี่ยน — ล้างข้อมูลเดโมเก่าแล้วสร้างใหม่
    console.log('Database schema changed: recreating demo data');
    db.exec('PRAGMA foreign_keys = OFF');
    for (const t of ['notifications', 'task_members', 'meeting_attendees', 'meetings', 'comments', 'files', 'tasks', 'sessions', 'users', 'departments']) db.exec(`DROP TABLE IF EXISTS ${t}`);
    db.exec('PRAGMA foreign_keys = ON');
    for (const f of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  // Existing workspaces get departments added later (no data is touched)
  if (db.prepare('SELECT COUNT(*) c FROM departments').get().c > 0) {
    const n = ensureDepartments(db);
    if (n) console.log(`  + ${n} new department(s) added`);
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- วันที่ (ใช้เวลาท้องถิ่นของเซิร์ฟเวอร์) ----------
const z = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
export const localIso = (d = new Date()) => `${ymd(d)}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
export function parseYmd(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
export function diffDays(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
export const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseYmd(s));
export const isLocalDateTime = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s);

// ---------- รหัสผ่าน ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---------- ชนิดไฟล์และสิทธิ์อัปโหลดรายแผนก ----------
export const EXT_KIND = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', ogv: 'video',
  pdf: 'pdf',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet',
  doc: 'doc', docx: 'doc', txt: 'doc', md: 'doc', odt: 'doc', rtf: 'doc',
  ppt: 'slide', pptx: 'slide', odp: 'slide',
  zip: 'archive', rar: 'archive', '7z': 'archive',
  ai: 'design', psd: 'design', fig: 'design',
};
export const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg',
  pdf: 'application/pdf',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', odt: 'application/vnd.oasis.opendocument.text', rtf: 'application/rtf',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  ai: 'application/postscript', psd: 'image/vnd.adobe.photoshop', fig: 'application/octet-stream',
};
// ไฟล์ที่ผู้ใช้อัปโหลดได้ (SVG ใช้เฉพาะข้อมูลตัวอย่าง ไม่เปิดให้อัปโหลด)
export const DEPT_FILE_RULES = {
  it:        { kinds: ['pdf', 'doc', 'sheet', 'slide', 'archive', 'image'], label: 'Documents (PDF, Word, Excel, PowerPoint, ZIP) and screenshots' },
  finance:   { kinds: ['pdf', 'sheet', 'doc'], label: 'PDF, Excel and Word documents' },
  marketing: { kinds: ['image', 'video', 'pdf', 'doc', 'slide', 'design'], label: 'Video clips, posters/images and documents' },
  bizdev:    { kinds: ['pdf', 'doc', 'sheet', 'slide', 'image', 'archive'], label: 'Documents (PDF, Word, Excel, PowerPoint, ZIP) and images' },
  mgmt:      { kinds: ['pdf', 'doc', 'sheet', 'slide', 'image', 'archive'], label: 'Documents (PDF, Word, Excel, PowerPoint, ZIP) and images' },
};
const ANY_DOC = { kinds: ['pdf', 'doc', 'sheet', 'slide', 'image', 'archive'], label: 'Documents (PDF, Word, Excel, PowerPoint, ZIP) and images' };
export const fileRuleFor = (code) => DEPT_FILE_RULES[code] || ANY_DOC;
export const MAX_SIZE = { video: 300 * 1024 * 1024, default: 30 * 1024 * 1024 };
export function extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
