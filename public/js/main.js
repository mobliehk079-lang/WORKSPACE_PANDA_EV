import {
  S, api, esc, $, $$, h, icon, toast, toastErr, avatar, roleBadge, PRESENCE, DEPT_ICON, STATUS_LABEL, timeAgo, dept, deptShort, setTitle,
  t, lang, APP_NAME, LOGO, openModal, watchVideos, indexAvatars, confirmDialog, fmtDate, deptName, ROLE,
} from './utils.js';
import { setLang } from './i18n.js';
import { renderDashboard } from './views/dashboard.js';
import { renderTasks, renderMine } from './views/tasks.js';
import { renderCalendarPage } from './views/calendar.js';
import { renderWorkspace } from './views/workspace.js';
import { renderTeam } from './views/team.js';
import { renderKpi } from './views/kpi.js';
import { renderMeetings } from './views/meetings.js';
import { renderUsers } from './views/users.js';
import { openTask } from './views/taskModal.js';
import { renderReview, setBadge as setReviewBadge } from './views/review.js';
import { renderReport } from './views/report.js';
import { renderMonitor } from './views/monitor.js';
import { renderGame } from './views/game.js';

const app = $('#app');
let cleanup = null;
let lastHash = '#/dashboard';
let pollTimer = null;
let lastUnread = -1;

// ======================================================================
// Theme / language
// ======================================================================
function setTheme(th) {
  document.documentElement.dataset.theme = th;
  try { localStorage.setItem('tw-theme', th); } catch { /* */ }
  $$('[data-theme-ic]').forEach((b) => { b.innerHTML = icon(th === 'dark' ? 'sun' : 'moon'); });
  window.dispatchEvent(new CustomEvent('tw:theme'));
}
const toggleTheme = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
const langSwitch = () => `<div class="lang-switch" role="group" aria-label="Language"><button data-lang="lo" class="${lang === 'lo' ? 'active' : ''}">ລາວ</button><button data-lang="en" class="${lang === 'en' ? 'active' : ''}">EN</button></div>`;
const bindLang = (root) => $$('[data-lang]', root).forEach((b) => b.addEventListener('click', () => { if (b.dataset.lang !== lang) setLang(b.dataset.lang); }));

// ======================================================================
// Login / Register — brand only
// ======================================================================
async function showLogin(msg, mode = 'login') {
  clearInterval(pollTimer);
  document.title = APP_NAME;
  app.innerHTML = `<div class="auth-wrap">
    <div class="auth-top">${langSwitch()}</div>
    <div class="auth glass page">
      <div class="auth-brand"><div class="brand-logo lg">${LOGO}</div><h1>PANDA EV<span>WORKSPACE</span></h1></div>
      <div class="seg auth-tabs" id="auth-tabs"><button data-v="login" class="${mode === 'login' ? 'active' : ''}">${t('Log in')}</button><button data-v="register" class="${mode === 'register' ? 'active' : ''}">${t('Register')}</button></div>
      <div id="auth-body"></div>
    </div></div>`;
  bindLang(app);
  const tabs = $('#auth-tabs');
  const ind = h('<span class="seg-ind"></span>'); tabs.prepend(ind);
  const place = () => { const a = $('button.active', tabs); ind.style.left = a.offsetLeft + 'px'; ind.style.width = a.offsetWidth + 'px'; };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $$('button', tabs).forEach((x) => x.classList.toggle('active', x === b)); place(); draw(b.dataset.v); });
  requestAnimationFrame(place); document.fonts?.ready.then(place);
  draw(mode, msg);

  async function draw(m, message = '') {
    const body = $('#auth-body');
    if (m === 'login') {
      body.innerHTML = `<form class="auth-form" autocomplete="on">
        <div class="field"><label for="em">${t('Email')}</label><input class="input" id="em" type="email" name="email" required autocomplete="username" inputmode="email" autocapitalize="off"></div>
        <div class="field"><label for="pw">${t('Password')}</label><input class="input" id="pw" type="password" name="password" required autocomplete="current-password"></div>
        <div class="error-text" id="aerr">${esc(message)}</div>
        <button class="btn btn-primary btn-block" type="submit">${t('Log in')}</button></form>`;
      const f = $('form', body);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('button[type=submit]', f); btn.disabled = true; $('#aerr').textContent = '';
        try { await api('/api/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } }); await boot(); }
        catch (err) { $('#aerr').textContent = err.message; btn.disabled = false; }
      });
    } else {
      body.innerHTML = '<div class="skeleton" style="min-height:300px"></div>';
      let depts = [];
      try { depts = await api('/api/public/departments'); } catch { /* */ }
      body.innerHTML = `<form class="auth-form" autocomplete="on">
        <div class="field"><label for="rn">${t('Full name')}</label><input class="input" id="rn" name="name" required maxlength="120" autocomplete="name"></div>
        <div class="field"><label for="re">${t('Email')}</label><input class="input" id="re" type="email" name="email" required autocomplete="email" inputmode="email" autocapitalize="off"></div>
        <div class="row"><div class="field"><label for="rd">${t('Department')}</label><select class="input" id="rd" name="dept" required><option value="">—</option>${depts.map((d) => `<option value="${d.code}">${esc(lang === 'lo' ? d.name : d.name_en)}</option>`).join('')}</select></div>
          <div class="field"><label for="rt">${t('Job title')}</label><input class="input" id="rt" name="title" maxlength="120" autocomplete="organization-title"></div></div>
        <div class="field"><label for="rp">${t('Password')}</label><input class="input" id="rp" type="password" name="password" required minlength="8" autocomplete="new-password"><small class="hint">${t('At least 8 characters')}</small></div>
        <div class="error-text" id="aerr"></div>
        <button class="btn btn-primary btn-block" type="submit">${t('Register')}</button></form>`;
      const f = $('form', body);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('button[type=submit]', f); btn.disabled = true; $('#aerr').textContent = '';
        try {
          await api('/api/register', { method: 'POST', body: { name: f.name.value, email: f.email.value, dept: f.dept.value, title: f.title.value, password: f.password.value } });
          body.innerHTML = `<div class="auth-done">${icon('checkCircle')}<h3>${t('Registration sent')}</h3><p class="muted">${t('An administrator will review your request. You can log in once it is approved.')}</p>
            <button class="btn btn-block" id="to-login">${t('Back to log in')}</button></div>`;
          $('#to-login').addEventListener('click', () => $('#auth-tabs button[data-v=login]').click());
        } catch (err) { $('#aerr').textContent = err.message; btn.disabled = false; }
      });
    }
  }
}

// ======================================================================
// Shell
// ======================================================================
function navHtml() {
  const p = S.perms;
  const link = (href, ic, label, extra = '') => `<a href="${href}" data-nav="${href}" title="${esc(label)}">${icon(ic)}<span class="nl">${label}</span>${extra}</a>`;
  return `
    <div class="nav-label">${t('Overview')}</div>
    <nav class="nav">
      ${link('#/dashboard', 'dashboard', t('Dashboard'))}
      ${link('#/mine', 'user', t('My work'))}
      ${link('#/tasks', 'kanban', p.seeAllDepts ? t('All plans') : t('Tasks'))}
      ${link('#/calendar', 'calendar', t('Calendar'))}
      ${link('#/meetings', 'meeting', t('Meetings'), '<span class="count" id="meet-count" hidden></span>')}
      ${link('#/report', 'present', t('Weekly report'))}
      ${p.approveDone ? link('#/review', 'checkCircle', t('Review work'), '<span class="count" id="review-count" hidden></span>') : ''}
    </nav>
    <div class="nav-label">${p.seeAllDepts ? t('Department workspaces') : t('My department')}</div>
    <nav class="nav">${S.depts.filter((d) => d.visible).map((d) => `<a href="#/dept/${d.code}" data-nav="#/dept/${d.code}" title="${esc(deptShort(d))}"><span class="dept-dot" style="background:linear-gradient(135deg,${d.color},${d.color2})"></span>${icon(DEPT_ICON[d.code])}<span class="nl">${esc(deptShort(d))}</span></a>`).join('')}</nav>
    <div class="nav-label">${t('Team & performance')}</div>
    <nav class="nav">
      ${link('#/team', 'users', t('My team'))}
      ${link('#/kpi', 'chart', p.viewTeamKpi ? t('Employee KPI') : t('My KPI'))}
      ${p.monitor ? link('#/monitor', 'zap', t('Monitor')) : ''}
    </nav>
    ${p.manageUsers ? `<div class="nav-label">${t('Administration')}</div><nav class="nav">${link('#/users', 'shield', t('Users'), '<span class="count" id="pending-count" hidden></span>')}</nav>` : ''}
    <div class="nav-label">${t('Fun')}</div>
    <nav class="nav">${link('#/game', 'cards', t('Minigame'), `<span class="nav-lock">${icon('lock')}</span>`)}</nav>`;
}

function renderShell() {
  const me = S.me;
  app.innerHTML = `<div class="shell">
    <aside class="sidebar glass" id="sidebar">
      <div class="brand"><div class="brand-logo">${LOGO}</div><div class="nl"><b>PANDA EV</b><small>WORKSPACE</small></div></div>
      ${navHtml()}
      <div class="sidebar-foot">${meCardHtml()}</div>
    </aside>
    <div class="mobile-backdrop" id="mback"></div>
    <main class="main">
      <header class="topbar">
        <button class="btn btn-icon menu-btn" id="menu" aria-label="${t('Menu')}">${icon('menu')}</button>
        <div class="tb-title"><div class="crumb" id="crumb"></div><h1 id="title"></h1></div>
        <div class="spacer"></div>
        <div class="rel"><button class="btn presence-btn" id="presence"></button></div>
        <span class="hide-sm">${langSwitch()}</span>
        <button class="btn btn-icon" data-theme-ic id="theme" aria-label="${t('Toggle theme')}"></button>
        <div class="rel"><button class="btn btn-icon bell" id="bell" aria-label="${t('Notifications')}">${icon('bell')}<span class="badge-dot" id="unread" hidden></span></button></div>
      </header>
      <div id="view"></div>
    </main></div>`;
  $('#theme').onclick = toggleTheme;
  setTheme(document.documentElement.dataset.theme);
  bindLang(app);
  const sb = $('#sidebar'), mb = $('#mback');
  const closeMenu = () => { sb.classList.remove('open'); mb.classList.remove('show'); };
  $('#menu').onclick = () => { sb.classList.add('open'); mb.classList.add('show'); };
  mb.onclick = closeMenu;
  $$('.nav a', sb).forEach((a) => a.addEventListener('click', closeMenu));
  bindMeCard();
  renderPresence();
  $('#bell').onclick = toggleNotifications;
  pollNotifications();
  clearInterval(pollTimer);
  pollTimer = setInterval(pollNotifications, 20000);
  startLive();
}

// ======================================================================
// Live updates (game invites, card-game rooms) — one EventSource for the whole app
// ======================================================================
let liveSrc = null;
function startLive() {
  liveSrc?.close();
  if (!window.EventSource) return;
  liveSrc = new EventSource('/api/live');
  liveSrc.addEventListener('cards', (e) => { let d = null; try { d = JSON.parse(e.data); } catch { return; } window.dispatchEvent(new CustomEvent('tw:cards', { detail: d })); });
  liveSrc.addEventListener('invite', (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    window.dispatchEvent(new CustomEvent('tw:cards-invite', { detail: d }));
    const game = d.game === 'tienlen' ? 'tienlen' : 'kaeng';
    toast(`<b>${esc(t('{name} invited you to play {game}', { name: d.from, game: game === 'tienlen' ? t('Tien Len') : t('Kaeng') }))}</b><br><small>${esc(t('Tap to join room {code}', { code: d.room }))}</small>`, 'info', {
      ms: 12000, onClick: () => { try { sessionStorage.setItem('pev-cards-join', d.room); } catch { /* */ } location.hash = `#/game/${game}`; window.dispatchEvent(new CustomEvent('tw:cards-join')); },
    });
  });
}
const stopLive = () => { liveSrc?.close(); liveSrc = null; };

const meCardHtml = () => { const me = S.me; return `<button class="me-card" id="me-btn" aria-haspopup="menu" title="${t('My profile')}">${avatar(me, '', true)}<div class="meta nl"><b>${esc(me.name)}</b><small>${roleBadge(me.role)} ${me.dept_code ? esc(deptShort(dept(me.dept_code))) : ''}</small></div></button>`; };
const bindMeCard = () => { $('#me-btn').onclick = (e) => userMenu(e); };
/** After my name/photo changed: update every copy the app keeps, then redraw */
function refreshMe(changes) {
  Object.assign(S.me, changes);
  for (const list of [S.users, S.colleagues]) for (const u of list || []) if (u.id === S.me.id) Object.assign(u, changes);
  indexAvatars();
  const foot = $('.sidebar-foot');
  if (foot) { foot.innerHTML = meCardHtml(); bindMeCard(); }
}

function userMenu(e) {
  e.stopPropagation();
  const wrap = $('.sidebar-foot');
  const ex = $('.menu', wrap); if (ex) return ex.remove();
  const m = h(`<div class="menu glass up">
    <div class="menu-head"><b>${esc(S.me.name)}</b><small>${esc(S.me.email)}</small></div>
    <button data-a="profile">${icon('user')}${t('My profile')}</button>
    <button data-a="pw">${icon('key')}${t('Change password')}</button>
    <div class="menu-lang">${icon('globe')}${langSwitch()}</div>
    <button data-a="out" class="btn-danger">${icon('logout')}${t('Log out')}</button></div>`);
  wrap.appendChild(m);
  bindLang(m);
  m.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const a = ev.target.closest('[data-a]')?.dataset.a; if (!a) return;
    m.remove();
    if (a === 'out') { stopLive(); await api('/api/logout', { method: 'POST' }).catch(() => {}); S.me = null; history.replaceState(null, '', '#/'); showLogin(); }
    if (a === 'profile') openProfile();
    if (a === 'pw') openProfile({ focusPassword: true });
  });
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }));
}

// ======================================================================
// My profile — photo, name, job title; password change (approved by a super admin)
// ======================================================================
/** Center-crop to a square and shrink to 320px so photos stay small and load fast everywhere */
async function squarePhoto(file) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) throw new Error(t('This image cannot be opened. Please choose a JPG, PNG or WebP image'));
  const side = Math.min(img.width, img.height), out = Math.min(320, side);
  const c = document.createElement('canvas'); c.width = c.height = out;
  c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
  img.close?.();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error(t('Upload failed')))), 'image/jpeg', 0.88));
}

function openProfile({ focusPassword = false } = {}) {
  let changed = false;
  const me = S.me;
  const d = me.dept_code ? dept(me.dept_code) : null;
  const m = openModal(`<div class="modal-head"><h2>${icon('user')} ${t('My profile')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    <div class="profile-top">
      <div id="pf-av"></div>
      <div class="profile-photo-btns">
        <label class="btn btn-sm">${icon('image')} ${t('Change photo')}<input type="file" id="pf-file" accept="image/jpeg,image/png,image/webp" hidden></label>
        <button type="button" class="btn btn-sm btn-ghost" id="pf-rm">${icon('trash')} ${t('Remove photo')}</button>
        <small class="hint">${t('JPG, PNG or WebP. It is cropped to a square.')}</small>
      </div>
    </div>
    <div class="profile-facts">
      <div><span>${t('Email')}</span><b>${esc(me.email)}</b></div>
      <div><span>${t('Role')}</span><b>${roleBadge(me.role)}</b></div>
      <div><span>${t('Department')}</span><b>${d ? esc(deptName(d)) : '—'}</b></div>
    </div>
    <form id="pf-form" class="profile-sec">
      <div class="row"><div class="field"><label for="pf-name">${t('Full name')} *</label><input class="input" id="pf-name" name="name" required maxlength="120" value="${esc(me.name)}" autocomplete="name"></div>
        <div class="field"><label for="pf-title">${t('Job title')}</label><input class="input" id="pf-title" name="title" maxlength="120" value="${esc(me.title || '')}" autocomplete="organization-title"></div></div>
      <div class="error-text" id="pf-err"></div>
      <div class="modal-foot" style="margin-top:0"><button class="btn btn-primary">${icon('check')} ${t('Save')}</button></div>
    </form>
    <div class="profile-sec" id="pf-pw"><div class="skeleton" style="min-height:120px"></div></div>`, { onClose: () => { if (changed) { window.dispatchEvent(new CustomEvent('tw:changed')); route(); } } });

  const drawAvatar = () => {
    $('#pf-av', m.el).innerHTML = avatar(S.me, 'xl profile-av');
    $('#pf-rm', m.el).hidden = !S.me.avatar;
  };
  drawAvatar();

  $('#pf-file', m.el).addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const lbl = e.target.closest('label'); lbl.classList.add('loading');
    try {
      const blob = await squarePhoto(file);
      const r = await api('/api/me/avatar', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      refreshMe({ avatar: r.avatar }); drawAvatar(); changed = true;
      toast(t('Profile photo updated'), 'ok');
    } catch (err) { toastErr(err); }
    finally { lbl.classList.remove('loading'); }
  });
  $('#pf-rm', m.el).addEventListener('click', async () => {
    try { await api('/api/me/avatar', { method: 'DELETE' }); refreshMe({ avatar: null }); drawAvatar(); changed = true; toast(t('Profile photo removed'), 'ok'); }
    catch (err) { toastErr(err); }
  });

  const pf = $('#pf-form', m.el);
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#pf-err', m.el).textContent = '';
    try {
      const r = await api('/api/me/profile', { method: 'PATCH', body: { name: pf.name.value, title: pf.title.value } });
      refreshMe({ name: r.name, title: r.title }); drawAvatar(); changed = true;
      toast(t('Changes saved'), 'ok');
    } catch (err) { $('#pf-err', m.el).textContent = err.message; }
  });

  const pwBox = $('#pf-pw', m.el);
  async function drawPw() {
    let st;
    try { st = await api('/api/me/password'); } catch (err) { pwBox.innerHTML = `<div class="error-text">${esc(err.message)}</div>`; return; }
    const pending = st.request;
    pwBox.innerHTML = `<h3 class="profile-h">${icon('key')} ${t('Change password')}</h3>
      ${pending ? `<div class="pw-pending">${icon('hourglass')}<div style="flex:1;min-width:0"><b>${t('Waiting for administrator approval')}</b><small>${t('Requested {date}. Your current password keeps working until it is approved.', { date: `${fmtDate(pending.created_at.slice(0, 10), { year: true })} ${pending.created_at.slice(11, 16)}` })}</small></div>
        <button type="button" class="btn btn-sm" id="pw-cancel">${t('Cancel request')}</button></div>` : ''}
      <form id="pw-form">
        <div class="field"><label for="pw-cur">${t('Current password')}</label><input class="input" id="pw-cur" type="password" name="current" required autocomplete="current-password"></div>
        <div class="row"><div class="field"><label for="pw-new">${t('New password')}</label><input class="input" id="pw-new" type="password" name="password" required minlength="8" autocomplete="new-password"><small class="hint">${t('At least 8 characters')}</small></div>
          <div class="field"><label for="pw-new2">${t('Confirm new password')}</label><input class="input" id="pw-new2" type="password" name="password2" required minlength="8" autocomplete="new-password"></div></div>
        ${st.direct ? '' : `<p class="hint" style="margin:0 0 10px">${icon('shield')} ${pending ? t('Sending a new request replaces the one that is waiting.') : t('A super admin must approve the new password before you can use it.')}</p>`}
        <div class="error-text" id="pw-err"></div>
        <div class="modal-foot" style="margin-top:0"><button class="btn btn-primary">${st.direct ? t('Change password') : t('Send for approval')}</button></div>
      </form>`;
    $('#pw-cancel', pwBox)?.addEventListener('click', async () => {
      if (!(await confirmDialog(t('Cancel request'), t('Cancel your password change request?'), { ok: t('Cancel request'), danger: true }))) return;
      try { await api('/api/me/password', { method: 'DELETE' }); toast(t('Request cancelled'), 'ok'); drawPw(); } catch (err) { toastErr(err); }
    });
    const f = $('#pw-form', pwBox);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#pw-err', pwBox); err.textContent = '';
      if (f.password.value !== f.password2.value) { err.textContent = t('The new passwords do not match'); return; }
      const btn = $('button.btn-primary', f); btn.disabled = true;
      try {
        const r = await api('/api/me/password', { method: 'POST', body: { current: f.current.value, password: f.password.value } });
        toast(r.applied ? t('Password changed') : t('Request sent. A super admin will review it'), 'ok', { ms: 5000 });
        drawPw();
      } catch (e2) { err.textContent = e2.message; btn.disabled = false; }
    });
    if (focusPassword) { focusPassword = false; pwBox.scrollIntoView({ block: 'nearest' }); $('#pw-cur', pwBox).focus({ preventScroll: true }); }
  }
  drawPw();
}

function renderPresence() {
  const b = $('#presence');
  b.innerHTML = `<i class="pdot ${S.me.presence}"></i><span class="lbl">${PRESENCE[S.me.presence]}</span>`;
  b.onclick = (e) => {
    e.stopPropagation();
    const ex = $('.menu', b.parentElement); if (ex) return ex.remove();
    const m = h(`<div class="menu glass">${Object.entries(PRESENCE).map(([k, v]) => `<button data-p="${k}"><i class="pdot ${k}"></i>${v}${k === S.me.presence ? ` <span style="margin-left:auto">${icon('check')}</span>` : ''}</button>`).join('')}</div>`);
    b.parentElement.appendChild(m);
    m.addEventListener('click', async (ev) => {
      const p = ev.target.closest('[data-p]')?.dataset.p; if (!p) return;
      m.remove();
      try { await api('/api/me/presence', { method: 'PATCH', body: { presence: p } }); S.me.presence = p; renderPresence(); toast(t('Status set to "{s}"', { s: PRESENCE[p] }), 'ok'); window.dispatchEvent(new CustomEvent('tw:changed')); }
      catch (err) { toastErr(err); }
    });
    setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }));
  };
}

// ======================================================================
// Notifications
// ======================================================================
const NOTI_STYLE = {
  assign: ['user', 'linear-gradient(135deg,#8b5cf6,#6366f1)'], review: ['eye', 'linear-gradient(135deg,#fb923c,#ea580c)'],
  done: ['checkCircle', 'linear-gradient(135deg,#34d399,#059669)'], status: ['kanban', 'linear-gradient(135deg,#60a5fa,#2563eb)'],
  comment: ['message', 'linear-gradient(135deg,#a78bfa,#7c3aed)'], file: ['clip', 'linear-gradient(135deg,#f472b6,#db2777)'],
  meeting: ['meeting', 'linear-gradient(135deg,#818cf8,#7c3aed)'], 'meeting-soon': ['clock', 'linear-gradient(135deg,#818cf8,#7c3aed)'],
  rsvp: ['check', 'linear-gradient(135deg,#22d3ee,#0891b2)'], due: ['hourglass', 'linear-gradient(135deg,#fbbf24,#d97706)'],
  overdue: ['alert', 'linear-gradient(135deg,#f87171,#dc2626)'], changes: ['edit', 'linear-gradient(135deg,#fb923c,#ea580c)'],
  member: ['users', 'linear-gradient(135deg,#60a5fa,#7c3aed)'],
  'pw-request': ['key', 'linear-gradient(135deg,#a78bfa,#6366f1)'], 'pw-approved': ['key', 'linear-gradient(135deg,#34d399,#059669)'], 'pw-rejected': ['key', 'linear-gradient(135deg,#f87171,#dc2626)'],
  charger: ['zap', 'linear-gradient(135deg,#f87171,#dc2626)'], 'charger-ok': ['zap', 'linear-gradient(135deg,#34d399,#059669)'], register: ['userPlus', 'linear-gradient(135deg,#a78bfa,#db2777)'],
};
function notiTitle(n) {
  let p = {};
  try { p = JSON.parse(n.params || '{}'); } catch { /* */ }
  if (p.status) p.status = STATUS_LABEL[p.status] || p.status;
  return t(n.title, p);
}
let notiCache = { items: [], unread: 0 };
async function pollNotifications() {
  try {
    notiCache = await api('/api/notifications');
    const u = $('#unread');
    if (u) { u.hidden = !notiCache.unread; u.textContent = notiCache.unread > 9 ? '9+' : notiCache.unread; }
    if (lastUnread >= 0 && notiCache.unread > lastUnread) {
      const n = notiCache.items.find((x) => !x.is_read);
      if (n) toast(`<b>${esc(notiTitle(n))}</b><br><small>${esc(n.body)}</small>`, 'info', { onClick: () => { if (n.link) location.hash = n.link; } });
    } else if (lastUnread < 0) {
      const urgent = notiCache.items.filter((x) => !x.is_read && (x.type === 'overdue' || x.type === 'due')).length;
      if (urgent) toast(t('You have {n} tasks due soon or overdue', { n: `<b>${urgent}</b>` }), 'info', { onClick: toggleNotifications, ms: 6000 });
    }
    lastUnread = notiCache.unread;
    if ('reviewCount' in notiCache) setReviewBadge(notiCache.reviewCount);
    const pending = notiCache.items.filter((x) => x.type === 'meeting' && !x.is_read).length;
    const mc = $('#meet-count'); if (mc) { mc.hidden = !pending; mc.textContent = pending; }
    if (S.perms.manageUsers) {
      const pu = notiCache.items.filter((x) => x.type === 'register' && !x.is_read).length + (notiCache.pwRequests || 0);
      const pc = $('#pending-count'); if (pc) { pc.hidden = !pu; pc.textContent = pu; }
    }
  } catch { /* quiet */ }
}
function toggleNotifications(e) {
  e?.stopPropagation?.();
  const wrap = $('#bell').parentElement;
  const ex = $('.popover', wrap); if (ex) return ex.remove();
  const items = notiCache.items;
  const pop = h(`<div class="popover glass"><div class="ph">${t('Notifications')} <button class="btn btn-sm btn-ghost" data-all>${t('Mark all as read')}</button></div>
    ${items.length ? items.map((n) => { const [ic, c] = NOTI_STYLE[n.type] || ['bell', '']; return `<div class="notif ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link)}">
      <span class="ni" style="--c:${c}">${icon(ic)}</span><div style="min-width:0;flex:1"><b>${esc(notiTitle(n))}</b><small>${esc(n.body)}</small><span class="tm">${timeAgo(n.created_at)}</span></div></div>`; }).join('') : `<div class="empty">${t('No notifications yet')}</div>`}</div>`);
  wrap.appendChild(pop);
  pop.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('[data-all]')) { await api('/api/notifications/read', { method: 'POST', body: {} }); pop.remove(); return pollNotifications(); }
    const n = ev.target.closest('.notif'); if (!n) return;
    api('/api/notifications/read', { method: 'POST', body: { id: Number(n.dataset.id) } }).then(pollNotifications);
    pop.remove();
    if (n.dataset.link) location.hash = n.dataset.link;
  });
  setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }));
}

// ======================================================================
// Router
// ======================================================================
const ROUTES = [
  [/^#\/dashboard$/, renderDashboard],
  [/^#\/tasks(?:\/(kanban|timeline|calendar))?$/, renderTasks],
  [/^#\/mine(?:\/(kanban|timeline|calendar))?$/, renderMine],
  [/^#\/calendar$/, renderCalendarPage],
  [/^#\/dept\/(\w+)(?:\/(\w+))?$/, renderWorkspace],
  [/^#\/team$/, renderTeam],
  [/^#\/kpi$/, renderKpi],
  [/^#\/meetings$/, renderMeetings],
  [/^#\/review$/, renderReview],
  [/^#\/report$/, renderReport],
  [/^#\/monitor$/, renderMonitor],
  [/^#\/users$/, renderUsers],
  [/^#\/game(?:\/(kaeng|tienlen))?$/, renderGame],
];

async function route() {
  if (!S.me) return;
  const hash = location.hash || '#/dashboard';
  const tm = /^#\/task\/(\d+)$/.exec(hash);
  if (tm) {
    history.replaceState(null, '', lastHash);
    if (!$('#view').childElementCount) await route();
    return openTask(Number(tm[1]));
  }
  const r = ROUTES.find(([re]) => re.test(hash));
  if (!r || (hash === '#/review' && !S.perms.approveDone) || (hash === '#/monitor' && !S.perms.monitor)) { location.hash = '#/dashboard'; return; }
  lastHash = hash;
  const [re, fn] = r;
  const params = hash.match(re).slice(1);
  $$('.nav a').forEach((a) => a.classList.toggle('active', hash === a.dataset.nav || (a.dataset.nav !== '#/dashboard' && hash.startsWith(a.dataset.nav + '/'))));
  const view = $('#view');
  const old = view.firstElementChild;
  if (old) { old.classList.add('leaving'); await new Promise((r2) => setTimeout(r2, 150)); }
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const page = h('<div class="page"></div>');
  view.replaceChildren(page);
  window.scrollTo({ top: 0 });
  try { cleanup = await fn(page, ...params); }
  catch (e) {
    if (e.status === 401) return;
    page.innerHTML = `<div class="glass card empty">${icon('alert')}${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('tw:unauth', () => { if (S.me) { stopLive(); S.me = null; showLogin(t('Your session has expired. Please log in again')); } });

// ======================================================================
// Boot
// ======================================================================
async function boot() {
  try {
    const b = await api('/api/bootstrap');
    Object.assign(S, { me: b.me, perms: b.permissions, depts: b.departments, today: b.today });
    [S.users, S.colleagues] = await Promise.all([api('/api/users'), api('/api/colleagues')]);
    indexAvatars();
    lastUnread = -1;
    renderShell();
    if (!location.hash || location.hash === '#/' || location.hash === '#') history.replaceState(null, '', '#/dashboard');
    await route();
  } catch (e) {
    if (e.status === 401) showLogin(); else app.innerHTML = `<div class="auth-wrap"><div class="glass card empty">${icon('alert')}${esc(e.message)}</div></div>`;
  }
}
watchVideos();
boot();
void setTitle;
