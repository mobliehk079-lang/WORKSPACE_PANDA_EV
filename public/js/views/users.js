// User management (super admin): add / edit / approve registrations / disable / reset password
import { S, api, esc, $, $$, icon, avatar, roleBadge, deptChip, dept, deptName, ROLE, setTitle, segmented, openModal, confirmDialog, toast, toastErr, emptyState, fmtDate, debounce, t } from '../utils.js';

const STATUS_TXT = { active: t('Active'), pending: t('Waiting for approval'), disabled: t('Disabled') };
const genPassword = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return [...a].map((n) => c[n % c.length]).join('');
};

export async function renderUsers(page) {
  if (!S.perms.manageUsers) throw new Error(t('Only the super admin can manage users'));
  setTitle(t('Users'), t('Manage company accounts'));
  page.innerHTML = `<div class="toolbar">
      <div class="seg" id="us-st"><button data-v="all" class="active">${t('All')}</button><button data-v="pending">${STATUS_TXT.pending} <span class="count-pill" id="us-pc"></span></button><button data-v="active">${STATUS_TXT.active}</button><button data-v="disabled">${STATUS_TXT.disabled}</button></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="us-add">${icon('userPlus')} ${t('Add user')}</button>
    </div>
    <div class="toolbar filters">
      <div class="search"><span>${icon('search')}</span><input class="input" id="us-q" type="search" placeholder="${t('Search name or email…')}"></div>
      <select class="input" id="us-role"><option value="">${t('All roles')}</option>${Object.entries(ROLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select class="input" id="us-dept"><option value="">${t('All departments')}</option><option value="-">${t('No department (management)')}</option>${S.depts.map((d) => `<option value="${d.code}">${esc(deptName(d))}</option>`).join('')}</select>
      <span class="muted" id="us-count" style="font-size:.86rem"></span>
    </div>
    <div class="glass card ulist-wrap"><div class="ulist" id="us-list"><div class="skeleton"></div></div></div>`;
  const st = { status: 'all', q: '', role: '', dept: '' };
  let users = [];
  const list = $('#us-list', page);
  const draw = () => {
    const rows = users.filter((u) => (st.status === 'all' || u.status === st.status) && (!st.role || u.role === st.role)
      && (!st.dept || (st.dept === '-' ? !u.dept_code : u.dept_code === st.dept))
      && (!st.q || (u.name + ' ' + u.email).toLowerCase().includes(st.q.toLowerCase())));
    const pending = users.filter((u) => u.status === 'pending').length;
    $('#us-pc', page).textContent = pending || '';
    $('#us-count', page).textContent = t('{n} users', { n: rows.length });
    list.innerHTML = rows.length ? `<div class="urow uhead"><span>${t('User')}</span><span>${t('Role')}</span><span>${t('Department')}</span><span>${t('Status')}</span><span></span></div>` + rows.map((u) => `
      <div class="urow ${u.status}" data-id="${u.id}">
        <div class="who">${avatar(u)}<div style="min-width:0"><b>${esc(u.name)}${u.id === S.me.id ? ` <span class="chip">${t('You')}</span>` : ''}</b><small>${esc(u.email)}</small>${u.title ? `<small>${esc(u.title)}</small>` : ''}</div></div>
        <div data-l="${t('Role')}">${roleBadge(u.role)}</div>
        <div data-l="${t('Department')}">${u.dept_code ? deptChip(u.dept_code) : `<span class="muted">—</span>`}</div>
        <div data-l="${t('Status')}"><span class="ustatus ${u.status}">${STATUS_TXT[u.status]}</span><small class="muted">${fmtDate(u.created_at.slice(0, 10), { year: true })}</small></div>
        <div class="uact">${u.status === 'pending'
          ? `<button class="btn btn-sm btn-ok" data-a="approve">${icon('check')} ${t('Approve')}</button><button class="btn btn-sm btn-danger" data-a="reject">${icon('x')} ${t('Reject')}</button>`
          : `<button class="btn btn-sm" data-a="edit">${icon('edit')} ${t('Edit')}</button><button class="btn btn-sm btn-icon" data-a="pw" title="${t('Reset password')}" aria-label="${t('Reset password')}">${icon('key')}</button>
             ${u.id !== S.me.id ? `<button class="btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-ok'}" data-a="toggle">${u.status === 'active' ? t('Disable') : t('Enable')}</button>` : ''}`}</div>
      </div>`).join('') : emptyState(t('No users found'), 'users');
  };
  const load = async () => { users = await api('/api/admin/users'); draw(); };
  segmented($('#us-st', page), (v) => { st.status = v; draw(); });
  $('#us-q', page).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); draw(); }, 150));
  $('#us-role', page).addEventListener('change', (e) => { st.role = e.target.value; draw(); });
  $('#us-dept', page).addEventListener('change', (e) => { st.dept = e.target.value; draw(); });
  $('#us-add', page).addEventListener('click', () => userForm(null, load));
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const u = users.find((x) => x.id === Number(b.closest('[data-id]').dataset.id));
    const a = b.dataset.a;
    try {
      if (a === 'edit') return userForm(u, load);
      if (a === 'approve') return userForm(u, load, { approve: true });
      if (a === 'pw') return resetPassword(u);
      if (a === 'reject') {
        if (!(await confirmDialog(t('Reject registration'), t('Reject the request from {name}? The account will be disabled.', { name: u.name }), { ok: t('Reject'), danger: true }))) return;
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { status: 'disabled' } }); toast(t('Registration rejected'), 'ok');
      }
      if (a === 'toggle') {
        const off = u.status === 'active';
        if (off && !(await confirmDialog(t('Disable account'), t('{name} will be logged out and cannot log in until enabled again.', { name: u.name }), { ok: t('Disable'), danger: true }))) return;
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { status: off ? 'disabled' : 'active' } });
        toast(off ? t('Account disabled') : t('Account enabled'), 'ok');
      }
      await load();
    } catch (err) { toastErr(err); }
  });
  await load();
}

function userForm(u, reload, { approve = false } = {}) {
  const isNew = !u;
  const pw = isNew ? genPassword() : '';
  const m = openModal(`<div class="modal-head"><h2>${icon(isNew ? 'userPlus' : approve ? 'check' : 'edit')} ${isNew ? t('Add user') : approve ? t('Approve registration') : t('Edit user')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    ${approve ? `<p class="hint" style="margin-top:0">${t('Check the details and choose a role, then approve.')}</p>` : ''}
    <form id="uf">
      <div class="row"><div class="field"><label>${t('Full name')} *</label><input class="input" name="name" required maxlength="120" value="${esc(u?.name || '')}"></div>
        <div class="field"><label>${t('Email')} *</label><input class="input" name="email" type="email" required inputmode="email" autocapitalize="off" value="${esc(u?.email || '')}"></div></div>
      <div class="row"><div class="field"><label>${t('Role')} *</label><select class="input" name="role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === (u?.role || 'staff') ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>${t('Department')}</label><select class="input" name="dept"><option value="">— ${t('No department (management)')} —</option>${S.depts.map((d) => `<option value="${d.code}" ${d.code === u?.dept_code ? 'selected' : ''}>${esc(deptName(d))}</option>`).join('')}</select></div></div>
      <div class="field"><label>${t('Job title')}</label><input class="input" name="title" maxlength="120" value="${esc(u?.title || '')}"></div>
      ${isNew ? `<div class="field"><label>${t('Initial password')} *</label><div class="flex"><input class="input" name="password" required minlength="8" value="${pw}" style="flex:1;font-family:ui-monospace,monospace"><button type="button" class="btn btn-icon" id="uf-gen" title="${t('Generate')}" aria-label="${t('Generate')}">${icon('key')}</button></div><small class="hint">${t('Give this password to the user. They can change it after logging in.')}</small></div>` : ''}
      <div class="hint" id="uf-role-hint"></div>
      <div class="error-text" id="uf-err"></div>
      <div class="modal-foot"><button type="button" class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary">${icon('check')} ${isNew ? t('Add user') : approve ? t('Approve') : t('Save')}</button></div>
    </form>`);
  const f = $('#uf', m.el);
  const hint = () => {
    const r = f.role.value;
    const needDept = r === 'supervisor' || r === 'staff';
    f.dept.disabled = !needDept;
    if (!needDept) f.dept.value = '';
    $('#uf-role-hint', m.el).textContent = {
      superadmin: t('Super admin: everything a manager can do, plus managing users.'),
      admin: t('Manager: sees and assigns work in every department.'),
      supervisor: t('Supervisor: manages one department.'),
      staff: t('Staff: works on tasks in one department.'),
    }[r];
  };
  f.role.addEventListener('change', hint); hint();
  $('#uf-gen', m.el)?.addEventListener('click', () => { f.password.value = genPassword(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: f.name.value, email: f.email.value, role: f.role.value, dept: f.dept.value || null, title: f.title.value };
    try {
      if (isNew) {
        body.password = f.password.value;
        await api('/api/admin/users', { method: 'POST', body });
        try { await navigator.clipboard?.writeText(`${body.email}\n${body.password}`); } catch { /* */ }
        toast(t('User added. Email and password copied to the clipboard'), 'ok', { ms: 6000 });
      } else {
        if (approve) body.status = 'active';
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body });
        toast(approve ? t('Registration approved') : t('Changes saved'), 'ok');
      }
      m.close(); reload();
    } catch (err) { $('#uf-err', m.el).textContent = err.message; }
  });
}

function resetPassword(u) {
  const pw = genPassword();
  const m = openModal(`<div class="modal-head"><h2>${icon('key')} ${t('Reset password')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    <p class="muted" style="margin-top:0">${esc(u.name)} · ${esc(u.email)}</p>
    <form id="rp"><div class="field"><label>${t('New password')}</label><div class="flex"><input class="input" name="password" required minlength="8" value="${pw}" style="flex:1;font-family:ui-monospace,monospace"><button type="button" class="btn btn-icon" id="rp-gen" aria-label="${t('Generate')}">${icon('key')}</button></div>
      <small class="hint">${t('The user will be logged out of all devices.')}</small></div>
    <div class="error-text" id="rp-err"></div>
    <div class="modal-foot"><button type="button" class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary">${t('Reset password')}</button></div></form>`);
  const f = $('#rp', m.el);
  $('#rp-gen', m.el).addEventListener('click', () => { f.password.value = genPassword(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { password: f.password.value } });
      try { await navigator.clipboard?.writeText(f.password.value); } catch { /* */ }
      toast(t('Password reset and copied to the clipboard'), 'ok'); m.close();
    } catch (err) { $('#rp-err', m.el).textContent = err.message; }
  });
}
void $$; void dept;
