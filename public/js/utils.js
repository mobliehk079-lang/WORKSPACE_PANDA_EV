import { t, lang, MON, deptName, deptShort } from './i18n.js';
export { t, lang };

// ---------- Global state ----------
export const S = { me: null, perms: {}, depts: [], today: '', users: [] };
export const APP_NAME = 'PANDA EV WORKSPACE';

// ---------- API ----------
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const opts = { method, headers: { 'X-Lang': lang, ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof Blob) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  let res;
  try { res = await fetch(path, opts); } catch { throw new ApiError(0, t('Cannot connect to the server')); }
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    if (res.status === 401 && !path.includes('/login')) window.dispatchEvent(new CustomEvent('tw:unauth'));
    throw new ApiError(res.status, data?.error || t('Something went wrong. Please try again'));
  }
  return data;
}
export function uploadFile(taskId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/tasks/${taskId}/files`);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-Lang', lang);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let d = null; try { d = JSON.parse(xhr.responseText); } catch { /* */ }
      xhr.status < 300 ? resolve(d) : reject(new ApiError(xhr.status, d?.error || t('Upload failed')));
    };
    xhr.onerror = () => reject(new ApiError(0, t('Cannot connect to the server')));
    xhr.send(file);
  });
}

// ---------- HTML ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function h(html) { const tp = document.createElement('template'); tp.innerHTML = html.trim(); return tp.content.firstElementChild; }

// ---------- Icons (2px stroke, lucide style) ----------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  timeline: '<path d="M3 6h10M7 12h12M5 18h8"/><circle cx="16" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="16" cy="18" r="1.5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
  meeting: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="M23 7l-6 5 6 5z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  play: '<path d="M6 4l14 8-14 8z" fill="currentColor"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
  coffee: '<path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z"/><path d="M6 1v3M10 1v3M14 1v3"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a6 6 0 0 0 6-6c0-4.4-4.5-8.8-10-8.8z"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  trend: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  present: '<path d="M2 3h20M3 3v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V3M12 16v5M8 21h8"/><path d="M8 11l3-3 2 2 3-3"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
};
export const icon = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
export const DEPT_ICON = new Proxy({ it: 'monitor', finance: 'wallet', marketing: 'palette', bizdev: 'trend', mgmt: 'briefcase' }, { get: (o, k) => o[k] || 'folder' });
export const LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" fill-opacity=".25"/></svg>`;

// ---------- Constants (labels resolved once; changing language reloads the page) ----------
export const STATUS = [
  { key: 'todo', label: t('To do'), color: 'var(--s-todo)' },
  { key: 'doing', label: t('In progress'), color: 'var(--s-doing)' },
  { key: 'review', label: t('In review'), color: 'var(--s-review)' },
  { key: 'done', label: t('Done'), color: 'var(--s-done)' },
];
export const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.key, s.label]));
export const STATUS_COLOR = Object.fromEntries(STATUS.map((s) => [s.key, s.color]));
export const PRIORITY = { low: t('Low'), medium: t('Medium'), high: t('High'), urgent: t('Urgent') };
export const ROLE = { superadmin: t('Super admin'), admin: t('Manager'), supervisor: t('Supervisor'), staff: t('Staff') };
export const PRESENCE = { available: t('Available'), busy: t('Busy'), away: t('Away') };
export const LOAD = { free: t('Free'), balanced: t('Balanced'), overloaded: t('Overloaded'), away: t('Away') };

export const dept = (code) => S.depts.find((d) => d.code === code) || S.depts.find((d) => d.id === code);
export { deptName, deptShort };
export const deptVars = (code) => { const d = dept(code); return d ? `--dc1:${d.color};--dc2:${d.color2}` : ''; };
export const deptChip = (code, short = true) => { const d = dept(code); return d ? `<span class="chip dept-chip" style="${deptVars(code)}">${esc(short ? deptShort(d) : deptName(d))}</span>` : ''; };
export const prioBadge = (p) => `<span class="prio prio-${p}">${PRIORITY[p] || p}</span>`;
export const statusPill = (s) => `<span class="status-pill" style="--sc:${STATUS_COLOR[s]}">${STATUS_LABEL[s]}</span>`;
export const roleBadge = (r) => `<span class="role-badge role-${r}">${ROLE[r]}</span>`;
// Lao leading vowels (ເ ແ ໂ ໄ ໃ) are written before the consonant — keep them together with it
export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => (/^[ເແໂໄໃ]/.test(w) ? w.slice(0, 2) : [...w][0] || '')).join('');
export function avatar(user, size = '', withPresence = false) {
  const code = user.dept_code || dept(user.dept_id)?.code;
  const style = code ? deptVars(code) : '--dc1:#8b5cf6;--dc2:#ec4899';
  return `<span class="avatar ${size}" style="${style}" title="${esc(user.name)}">${esc(initials(user.name || user.assignee_name || '?'))}${withPresence && user.presence ? `<i class="pdot ${user.presence}"></i>` : ''}</span>`;
}

// ---------- Dates ----------
const z = (n) => String(n).padStart(2, '0');
export const ymd = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
export const today = () => ymd();
export { MONTHS, MON, WD, WD_FULL } from './i18n.js';
import { WD_FULL as _WDF, MONTHS as _MONTHS } from './i18n.js';
export function fmtDate(s, { year = false, weekday = false } = {}) {
  if (!s) return '-';
  const d = parse(s);
  return `${weekday ? _WDF[d.getDay()] + ' ' : ''}${d.getDate()} ${MON[d.getMonth()]}${year ? ' ' + d.getFullYear() : ''}`;
}
export const fmtMonth = (y, m) => `${_MONTHS[m]} ${y}`;
export const fmtTime = (iso) => (iso ? iso.slice(11, 16) : '');
export const fmtDateTime = (iso) => (iso ? `${fmtDate(iso.slice(0, 10), { year: true })} ${fmtTime(iso)}` : '-');
/** KPI series label: 'YYYY-MM-DD' (week start) or 'YYYY-MM' (month) */
export const fmtBucket = (k) => (k.length === 7 ? `${MON[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}` : fmtDate(k));
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso.replace(' ', 'T'))) / 1000;
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} hr ago', { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return t('{n} days ago', { n: Math.floor(s / 86400) });
  return fmtDate(iso.slice(0, 10), { year: true });
}
export function dueInfo(task) {
  if (task.status === 'done') {
    const late = task.completed_at && task.completed_at.slice(0, 10) > task.due_date;
    return { cls: late ? 'soon' : 'ok', text: late ? t('Finished {n} days late', { n: diffDays(task.due_date, task.completed_at.slice(0, 10)) }) : t('Finished on time') };
  }
  const d = diffDays(today(), task.due_date);
  if (d < 0) return { cls: 'over', text: t('Overdue {n} days', { n: -d }), over: true };
  if (d === 0) return { cls: 'soon', text: t('Due today') };
  if (d <= 2) return { cls: 'soon', text: t('In {n} days', { n: d }) };
  return { cls: '', text: fmtDate(task.due_date) };
}
export const dueBadge = (task) => { const i = dueInfo(task); return `<span class="due ${i.cls}">${icon('clock')}${i.text}</span>`; };
export const isOverdue = (task) => task.status !== 'done' && task.due_date < today();
export const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ---------- Toast ----------
export function toast(msg, type = 'info', { onClick, ms = 3800 } = {}) {
  const ic = type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'bell';
  const el = h(`<div class="toast ${type}"><span class="ti">${icon(ic)}</span><div>${msg}</div></div>`);
  $('#toasts').appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  el.addEventListener('click', () => { onClick?.(); close(); });
  setTimeout(close, ms);
}
export const toastErr = (e) => toast(esc(e.message || String(e)), 'err');

// ---------- Modal ----------
export function openModal(html, { drawer = false, wide = false, onClose } = {}) {
  const ov = h(`<div class="overlay ${drawer ? 'drawer' : ''}"><div class="modal glass ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`);
  document.body.appendChild(ov);
  document.body.classList.add('modal-open');
  const modal = $('.modal', ov);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    ov.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { ov.remove(); if (!$('.overlay')) document.body.classList.remove('modal-open'); onClose?.(); }, 200);
  };
  const onKey = (e) => { if (e.key === 'Escape' && !$('.lightbox')) close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $$('[data-close]', ov).forEach((b) => b.addEventListener('click', close));
  // Autofocus only with a real keyboard — on phones/tablets it would pop the keyboard over the form
  if (matchMedia('(hover: hover) and (pointer: fine)').matches)
    setTimeout(() => $('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]):not([type=time]), textarea', modal)?.focus({ preventScroll: true }), 60);
  return { el: modal, close };
}
export function confirmDialog(title, text, { ok = t('Confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal(`<div class="modal-head"><h2>${esc(title)}</h2></div><p class="muted" style="margin-top:0">${esc(text)}</p>
      <div class="modal-foot"><button class="btn" data-close>${t('Cancel')}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button></div>`,
    { onClose: () => !answered && resolve(false) });
    $('[data-ok]', m.el).addEventListener('click', () => { answered = true; resolve(true); m.close(); });
  });
}

// ---------- Lightbox (image / video / PDF) ----------
export function lightbox(file) {
  const url = `/files/${file.id}`;
  let body;
  if (file.kind === 'image') body = `<img src="${url}" alt="${esc(file.name)}">`;
  else if (file.kind === 'video') body = `<video src="${url}" controls autoplay playsinline></video>`;
  else if (file.kind === 'pdf' || file.mime?.startsWith('text/')) body = `<iframe src="${url}" title="${esc(file.name)}"></iframe>`;
  else body = `<div style="color:#fff;text-align:center">${icon('file')}<p>${t('This file type cannot be previewed')}</p></div>`;
  const el = h(`<div class="lightbox"><div class="lb-bar"><b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)}</b>
    <a class="btn btn-sm" href="${url}?download=1">${icon('download')}<span class="hide-sm">${t('Download')}</span></a>
    <button class="btn btn-sm btn-icon" data-x aria-label="${t('Close')}">${icon('x')}</button></div><div class="lb-body">${body}</div></div>`);
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  $('[data-x]', el).addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target.classList.contains('lb-body')) close(); });
}
/**
 * Watch every <video> on the page (once, at boot). When the browser can read a file's sound but not its picture
 * (videoWidth 0 — usually HEVC/H.265 from an iPhone on Chrome/Edge for Windows) the player would stay black,
 * so replace it with an explanation and a download link. Players also get data-orient="portrait|landscape".
 */
export function watchVideos() {
  document.addEventListener('loadedmetadata', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (!v.videoWidth) {
      v.classList.add('no-picture');
      if (!v.controls) return; // small thumbnails keep their play icon
      const src = v.currentSrc.replace(/#.*$/, '');
      v.pause();
      v.replaceWith(h(`<div class="vid-warn">${icon('alert')}<b>${t('This browser cannot show this video')}</b>
        <span>${t('The video is probably in HEVC/H.265 format (iPhone default). Download it to watch, or upload it again as MP4 (H.264).')}</span>
        <small>${t('On iPhone: Settings → Camera → Formats → Most Compatible')}</small>
        <a class="btn btn-sm" href="${esc(src)}?download=1">${icon('download')} ${t('Download')}</a></div>`));
      return;
    }
    v.dataset.orient = v.videoHeight > v.videoWidth ? 'portrait' : 'landscape';
    v.dispatchEvent(new CustomEvent('tw:orient', { bubbles: true }));
  }, true);
}

/** Placeholder while the server converts a video to a format every browser can play */
export const convertingBox = () => `<div class="vid-warn converting"><span class="spinner"></span><b>${t('Converting the video…')}</b><span>${t('So it can play on every device. This takes a minute or two — the page updates by itself.')}</span></div>`;

export const FILE_STYLE = {
  pdf: ['PDF', 'linear-gradient(135deg,#f87171,#dc2626)'], sheet: ['XLS', 'linear-gradient(135deg,#34d399,#059669)'],
  doc: ['DOC', 'linear-gradient(135deg,#60a5fa,#2563eb)'], slide: ['PPT', 'linear-gradient(135deg,#fdba74,#ea580c)'],
  archive: ['ZIP', 'linear-gradient(135deg,#a8a29e,#57534e)'], design: ['ART', 'linear-gradient(135deg,#c084fc,#7c3aed)'],
  video: ['VID', 'linear-gradient(135deg,#f472b6,#db2777)'], image: ['IMG', 'linear-gradient(135deg,#a78bfa,#7c3aed)'],
};
const ACCEPT = {
  image: '.png,.jpg,.jpeg,.gif,.webp', video: '.mp4,.webm,.mov,.m4v,.ogv', pdf: '.pdf', sheet: '.xls,.xlsx,.csv,.ods',
  doc: '.doc,.docx,.txt,.md,.odt,.rtf', slide: '.ppt,.pptx,.odp', archive: '.zip,.rar,.7z', design: '.ai,.psd,.fig',
};
export const acceptFor = (code) => (dept(code)?.fileRule?.kinds || []).map((k) => ACCEPT[k]).join(',');
export const fileRuleLabel = (code) => t(dept(code)?.fileRule?.label || '');

// ---------- Count-up ----------
export function countUp(el, to, { dur = 1100, decimals = 0, suffix = '' } = {}) {
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(decimals) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export function runCountUps(root) {
  $$('[data-count]', root).forEach((el) => countUp(el, Number(el.dataset.count), { decimals: Number(el.dataset.dec || 0), suffix: el.dataset.suffix || '' }));
  requestAnimationFrame(() => requestAnimationFrame(() => $$('[data-w]', root).forEach((el) => { el.style.width = el.dataset.w + '%'; })));
}

// ---------- Tooltip ----------
export function showTip(html, x, y) {
  const el = $('#tooltip'); el.innerHTML = html; el.classList.add('show');
  const r = el.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 12;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (left < 8) left = 8;
  if (top < 8) top = y + 16;
  el.style.left = left + 'px'; el.style.top = top + 'px';
}
export const hideTip = () => $('#tooltip').classList.remove('show');

/** Segmented control with a sliding highlight */
export function segmented(container, onChange) {
  const ind = document.createElement('span'); ind.className = 'seg-ind'; container.prepend(ind);
  const place = () => { const a = $('button.active', container); if (a) { ind.style.left = a.offsetLeft + 'px'; ind.style.width = a.offsetWidth + 'px'; } };
  container.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('active')) return;
    $$('button', container).forEach((x) => x.classList.toggle('active', x === b)); place();
    b.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    onChange(b.dataset.v);
  });
  requestAnimationFrame(place);
  new ResizeObserver(place).observe(container);
  document.fonts?.ready.then(place);
}
export const debounce = (fn, ms = 250) => { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; };
export const emptyState = (text, ic = 'checkCircle') => `<div class="empty">${icon(ic)}${esc(text)}</div>`;
export function setTitle(title, crumb = '') {
  const el = $('#title');
  if (el) { el.textContent = title; $('#crumb').textContent = crumb; }
  document.title = `${title} · ${APP_NAME}`;
}
/** Department segmented buttons (all + each dept) */
export const deptSegButtons = (allLabel = t('All departments')) =>
  `<button data-v="all" class="active">${allLabel}</button>${S.depts.map((d) => `<button data-v="${d.code}"><span class="dot" style="background:${d.color}"></span>${esc(deptShort(d))}</button>`).join('')}`;
