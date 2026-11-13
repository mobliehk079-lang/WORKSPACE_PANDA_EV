// Task details (drawer) + new task form
import {
  S, api, uploadFile, esc, $, $$, h, icon, toast, toastErr, openModal, confirmDialog, lightbox, avatar, deptChip, prioBadge,
  STATUS, PRIORITY, LOAD, PRESENCE, dueBadge, dueInfo, fmtDateTime, timeAgo, fmtSize, today, addDays, acceptFor, fileRuleLabel,
  FILE_STYLE, deptName, roleBadge, t,
} from '../utils.js';

export const changed = () => window.dispatchEvent(new CustomEvent('tw:changed'));

/** Checkbox list of department staff who can be added as coworkers on a task */
export function memberPicker(deptId, selected = [], { exclude = [] } = {}) {
  const people = S.users.filter((u) => u.dept_id === deptId && u.role === 'staff' && !exclude.includes(u.id));
  if (!people.length) return `<div class="muted" style="font-size:.86rem">${t('No other staff in this department')}</div>`;
  return `<div class="check-list member-pick">${people.map((u) => `<label class="check-item"><input type="checkbox" value="${u.id}" ${selected.includes(u.id) ? 'checked' : ''}>${avatar(u, 'sm', true)}<span style="flex:1;min-width:0">${esc(u.name)}</span><small class="muted">${esc(u.title || '')}</small></label>`).join('')}</div>`;
}
const pickedIds = (root) => $$('.member-pick input:checked', root).map((i) => Number(i.value));
const memberChips = (list, deptCode) => list.map((u) => `<span class="att-chip">${avatar({ ...u, dept_code: deptCode }, 'sm')}${esc(u.name)}</span>`).join('');

export function fileCard(f, { canDelete = false, showTask = false } = {}) {
  const [label, bg] = FILE_STYLE[f.kind] || ['FILE', 'linear-gradient(135deg,#94a3b8,#475569)'];
  let thumb;
  if (f.kind === 'image') thumb = `<img src="/files/${f.id}" alt="" loading="lazy">`;
  else if (f.kind === 'video') thumb = `<video src="/files/${f.id}#t=0.5" preload="metadata" muted playsinline></video><span class="play">${icon('play')}</span>`;
  else thumb = `<span class="ficon" style="background:${bg}">${label}</span>`;
  return `<div class="fcard" data-file="${f.id}" tabindex="0">
    <div class="thumb">${thumb}</div>
    <div class="info"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${showTask && f.task_title ? esc(f.task_title) : `${fmtSize(f.size)} · ${esc(f.uploader_name || '')}`}</small></div>
    ${canDelete ? `<button class="del" data-del="${f.id}" title="${t('Delete file')}" aria-label="${t('Delete file')}">${icon('trash')}</button>` : ''}</div>`;
}
export function bindFileCards(root, getFiles, { onDelete } = {}) {
  const find = (id) => (typeof getFiles === 'function' ? getFiles() : getFiles).find((x) => x.id === id);
  root.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const f = find(Number(del.dataset.del));
      if (!(await confirmDialog(t('Delete file'), t('Delete the file "{name}"?', { name: f.name }), { ok: t('Delete file'), danger: true }))) return;
      try { await api(`/api/files/${f.id}`, { method: 'DELETE' }); toast(t('File deleted'), 'ok'); onDelete?.(f); } catch (err) { toastErr(err); }
      return;
    }
    const c = e.target.closest('[data-file]');
    if (c) { const f = find(Number(c.dataset.file)); if (f) lightbox(f); }
  });
}

export async function uploadMany(taskId, files, listEl) {
  const results = [];
  for (const file of files) {
    const row = h(`<div class="upload-item">${icon('upload')}<span style="width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)}</span><div class="bar"><i style="width:0%"></i></div></div>`);
    listEl?.appendChild(row);
    try {
      results.push(await uploadFile(taskId, file, (p) => { $('i', row).style.width = Math.round(p * 100) + '%'; }));
    } catch (e) { toast(`${esc(file.name)}: ${esc(e.message)}`, 'err', { ms: 6000 }); }
    row.remove();
  }
  if (results.length) toast(t('Uploaded {n} files', { n: results.length }), 'ok');
  return results;
}

// ======================================================================
// Task details
// ======================================================================
export async function openTask(id) {
  let task;
  try { task = await api(`/api/tasks/${id}`); } catch (e) { return toastErr(e); }
  let dirty = false;
  const m = openModal('<div class="skeleton"></div>', { drawer: true, onClose: () => { if (dirty) changed(); } });
  render();

  function render() {
    const can = task.can;
    const over = dueInfo(task).over;
    const assignees = S.users.filter((u) => u.dept_id === task.dept_id && !['admin', 'superadmin'].includes(u.role));
    const statusOpts = STATUS.map((s) => `<option value="${s.key}" ${s.key === task.status ? 'selected' : ''} ${!can.approve && (s.key === 'done' || task.status === 'done') && s.key !== task.status ? 'disabled' : ''}>${s.label}</option>`).join('');
    const media = task.files.filter((f) => f.kind === 'video');
    const others = task.files.filter((f) => f.kind !== 'video');
    const ro = !can.edit;
    m.el.innerHTML = `
      <div class="modal-head">
        <div style="flex:1;min-width:0">
          <div class="flex wrap" style="gap:8px;margin-bottom:8px">${deptChip(task.dept_code, false)} ${prioBadge(task.priority)} ${dueBadge(task)} ${over ? `<span class="chip" style="color:var(--bad);border-color:var(--bad)">⚠ ${t('Overdue')}</span>` : ''}</div>
          <input class="task-title-input" id="t-title" value="${esc(task.title)}" ${ro ? 'readonly' : ''} aria-label="${t('Task name')}">
        </div>
        <button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button>
      </div>
      ${ro ? `<div class="chip" style="margin-bottom:10px;white-space:normal">${icon('eye')} ${t('View only — only the assignee/creator and supervisors can edit')}</div>` : ''}
      <div class="row">
        <div class="field"><label>${t('Status')}</label><select class="input" id="t-status" ${ro ? 'disabled' : ''}>${statusOpts}</select></div>
        <div class="field"><label>${t('Priority')}</label><select class="input" id="t-prio" ${ro ? 'disabled' : ''}>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${k === task.priority ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>${t('Progress')}</label>
        <div class="progress-row"><input type="range" class="range" id="t-progress" min="0" max="100" step="5" value="${task.progress}" style="--p:${task.progress}%" ${ro ? 'disabled' : ''}><b id="t-pv">${task.progress}%</b></div></div>
      <div class="row">
        <div class="field"><label>${t('Assignee')}</label>${can.assign
          ? `<select class="input" id="t-assignee"><option value="">— ${t('Not assigned')} —</option>${assignees.map((u) => `<option value="${u.id}" ${u.id === task.assignee_id ? 'selected' : ''}>${esc(u.name)}${u.role === 'supervisor' ? ` (${t('Supervisor')})` : ''}</option>`).join('')}</select>`
          : `<div class="flex" style="min-height:44px">${task.assignee_name ? avatar({ name: task.assignee_name, dept_code: task.dept_code }, 'sm') + esc(task.assignee_name) : `<span class="muted">${t('Not assigned')}</span>`}</div>`}</div>
        <div class="field"><label>${t('Assigned by')}</label><div class="flex" style="min-height:44px">${task.assigner_name ? avatar({ name: task.assigner_name }, 'sm') + esc(task.assigner_name) : '-'}</div></div>
      </div>
      <div class="field"><label>${icon('users')} ${t('Coworkers')} <span class="hint">— ${t('can see and work on this task')}</span></label>
        ${can.members
          ? `<div id="t-members">${memberPicker(task.dept_id, task.members.map((u) => u.id), { exclude: [task.assignee_id] })}</div><small class="hint">${t('Other staff in the department cannot see this task. Supervisors always can.')}</small>`
          : `<div class="flex wrap" style="gap:6px;min-height:36px">${task.members.length ? memberChips(task.members, task.dept_code) : `<span class="muted">${t('No coworkers added')}</span>`}</div>`}
      </div>
      <div class="row row-3">
        <div class="field"><label>${t('Start date')}</label><input type="date" class="input" id="t-start" value="${task.start_date}" ${ro ? 'readonly' : ''}></div>
        <div class="field"><label>${t('Due date')}</label><input type="date" class="input" id="t-due" value="${task.due_date}" ${ro ? 'readonly' : ''}></div>
        <div class="field"><label>${t('Completed on')}</label><div class="flex" style="min-height:44px">${task.completed_at ? `${icon('checkCircle')} ${fmtDateTime(task.completed_at)}` : `<span class="muted">${t('Not finished')}</span>`}</div></div>
      </div>
      <div class="field"><label>${t('Description')}</label><textarea class="input" id="t-desc" rows="4" ${ro ? 'readonly' : ''} placeholder="${t('Describe the task…')}">${esc(task.description)}</textarea></div>
      <div class="modal-foot" style="justify-content:space-between">
        <div>${can.remove ? `<button class="btn btn-danger btn-sm" id="t-del">${icon('trash')} ${t('Delete task')}</button>` : ''}</div>
        <div class="flex wrap">${can.approve && task.status === 'review' ? `<button class="btn btn-ok" id="t-approve">${icon('check')} ${t('Approve as done')}</button>` : ''}
        ${!ro ? `<button class="btn btn-primary" id="t-save">${icon('check')} ${t('Save')}</button>` : ''}</div>
      </div>

      <div class="section"><h3>${icon('clip')} ${t('Attachments')} <span class="n">(${task.files.length})</span></h3>
        ${media.length ? `<div class="media-grid" style="margin-bottom:12px">${media.map((f) => `<div class="media-video"><video src="/files/${f.id}" controls preload="metadata" playsinline></video>
          <div class="cap">${icon('video')}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span><a class="btn btn-sm" style="color:#fff;background:rgba(0,0,0,.35)" href="/files/${f.id}?download=1" title="${t('Download')}">${icon('download')}</a></div></div>`).join('')}</div>` : ''}
        ${others.length ? `<div class="media-grid" id="t-files">${others.map((f) => fileCard(f, { canDelete: f.uploaded_by === S.me.id || can.approve })).join('')}</div>` : ''}
        ${can.upload ? `<label class="dropzone" id="t-drop" style="display:block;margin-top:12px">${icon('upload')}<div>${t('Drop files here or')} <b>${t('click to choose')}</b></div><small>${esc(fileRuleLabel(task.dept_code))}</small>
          <input type="file" id="t-file" multiple accept="${acceptFor(task.dept_code)}" hidden></label><div id="t-uploads" class="list" style="margin-top:8px"></div>` : ''}
      </div>

      <div class="section"><h3>${icon('message')} ${t('Comments')} <span class="n" id="t-cn">(${task.comments.length})</span></h3>
        <div class="comments" id="t-comments">${task.comments.length ? task.comments.map(commentHtml).join('') : `<div class="muted" style="font-size:.9rem">${t('No comments yet')}</div>`}</div>
        <form class="cmt-form" id="t-cform"><textarea class="input" name="body" placeholder="${t('Write a comment…')}" required maxlength="3000"></textarea><button class="btn btn-primary btn-icon" aria-label="${t('Send')}">${icon('right')}</button></form>
      </div>
      <p class="hint" style="margin-top:18px">${t('Created {a} · Updated {b}', { a: fmtDateTime(task.created_at), b: timeAgo(task.updated_at) })}</p>`;
    bind();
  }

  function commentHtml(c) {
    return `<div class="cmt">${avatar({ name: c.user_name, dept_code: ['admin', 'superadmin'].includes(c.user_role) ? null : task.dept_code }, 'sm')}<div class="bubble"><div class="h"><b>${esc(c.user_name)}</b>${c.user_role !== 'staff' ? roleBadge(c.user_role) : ''}<span style="margin-left:auto">${timeAgo(c.created_at)}</span></div><p>${esc(c.body)}</p></div></div>`;
  }

  function bind() {
    const el = m.el;
    $$('[data-close]', el).forEach((b) => b.addEventListener('click', m.close));
    const range = $('#t-progress', el);
    range?.addEventListener('input', () => { $('#t-pv', el).textContent = range.value + '%'; range.style.setProperty('--p', range.value + '%'); });
    $('#t-save', el)?.addEventListener('click', () => save());
    $('#t-approve', el)?.addEventListener('click', () => save({ status: 'done' }));
    $('#t-del', el)?.addEventListener('click', async () => {
      if (!(await confirmDialog(t('Delete task'), t('Delete the task "{name}" and all its attachments?', { name: task.title }), { ok: t('Delete task'), danger: true }))) return;
      try { await api(`/api/tasks/${task.id}`, { method: 'DELETE' }); toast(t('Task deleted'), 'ok'); dirty = true; m.close(); } catch (e) { toastErr(e); }
    });
    const fl = $('#t-files', el);
    if (fl) bindFileCards(fl, () => task.files, { onDelete: (f) => { task.files = task.files.filter((x) => x.id !== f.id); dirty = true; render(); } });
    const drop = $('#t-drop', el);
    if (drop) {
      const input = $('#t-file', el);
      const go = async (list) => { const res = await uploadMany(task.id, [...list], $('#t-uploads', el)); if (res.length) { task.files = [...res, ...task.files]; dirty = true; render(); } };
      input.addEventListener('change', () => go(input.files));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); go(e.dataTransfer.files); });
    }
    const cf = $('#t-cform', el);
    const ta = cf.body;
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) cf.requestSubmit(); });
    cf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = ta.value.trim(); if (!body) return;
      try {
        const c = await api(`/api/tasks/${task.id}/comments`, { method: 'POST', body: { body } });
        task.comments.push(c); dirty = true;
        const list = $('#t-comments', el);
        if (task.comments.length === 1) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', commentHtml(c));
        ta.value = '';
        $('#t-cn', el).textContent = `(${task.comments.length})`;
      } catch (err) { toastErr(err); }
    });
  }

  async function save(extra = {}) {
    const el = m.el;
    const body = { ...extra };
    if (task.can.edit) {
      Object.assign(body, {
        title: $('#t-title', el).value, description: $('#t-desc', el).value, priority: $('#t-prio', el).value,
        start_date: $('#t-start', el).value, due_date: $('#t-due', el).value, progress: Number($('#t-progress', el).value),
      });
      if (!extra.status) body.status = $('#t-status', el).value;
    }
    const as = $('#t-assignee', el); if (as) body.assignee_id = as.value ? Number(as.value) : null;
    const mem = $('#t-members', el); if (mem) body.member_ids = pickedIds(mem);
    try {
      task = { ...task, ...(await api(`/api/tasks/${task.id}`, { method: 'PATCH', body })) };
      dirty = true;
      toast(extra.status === 'done' ? t('Task approved as done 🎉') : t('Changes saved'), 'ok');
      render();
    } catch (e) { toastErr(e); }
  }
}

// ======================================================================
// New task — assignees sorted by who is most free
// ======================================================================
export function assigneeItem(u, i, selected) {
  const away = u.presence === 'away';
  const level = away ? 'away' : u.workload.level;
  return `<label class="assignee ${selected ? 'sel' : ''}"><input type="radio" name="assignee" value="${u.id}" ${selected ? 'checked' : ''}>
    ${avatar(u, '', true)}
    <span class="grow"><b>${esc(u.name)}</b>${i === 0 && !away ? `<span class="best">${t('Most free')}</span>` : ''}<small>${esc(u.title || '')} · ${PRESENCE[u.presence]} · ${t('{n} open tasks', { n: u.workload.active })}</small></span>
    <span class="lb"><span class="load-tag ${level}">${LOAD[level]}</span><div class="bar load-bar" style="margin-top:5px"><i class="${u.workload.level}" style="width:${u.workload.percent}%"></i></div></span></label>`;
}

export async function openNewTask(prefill = {}) {
  const deps = S.depts.filter((d) => d.visible);
  const deptCode = prefill.dept || S.me.dept_code || deps[0].code;
  const t0 = today();
  const m = openModal(`
    <div class="modal-head"><h2>${icon('plus')} ${t('New task')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    <form id="nt">
      <div class="field"><label for="nt-title">${t('Task name')} *</label><input class="input" id="nt-title" name="title" required maxlength="200"></div>
      <div class="field"><label for="nt-desc">${t('Description')}</label><textarea class="input" id="nt-desc" name="description" rows="3" placeholder="${t('Describe the task…')}"></textarea></div>
      <div class="row">
        <div class="field"><label>${t('Department')}</label>${S.perms.seeAllDepts
          ? `<select class="input" name="dept">${deps.map((d) => `<option value="${d.code}" ${d.code === deptCode ? 'selected' : ''}>${esc(deptName(d))}</option>`).join('')}</select>`
          : `<div class="flex" style="min-height:44px">${deptChip(deptCode, false)}</div><input type="hidden" name="dept" value="${deptCode}">`}</div>
        <div class="field"><label>${t('Priority')}</label><select class="input" name="priority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${k === 'medium' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="field"><label>${t('Start date')} *</label><input type="date" class="input" name="start_date" value="${prefill.start || t0}" required></div>
        <div class="field"><label>${t('Due date')} *</label><input type="date" class="input" name="due_date" value="${prefill.due || addDays(prefill.start || t0, 3)}" required></div>
      </div>
      <div class="field"><label>${t('Assignee')} <span class="hint">— ${t('most free first')}</span></label><div class="assignee-list" id="nt-assignees"><div class="skeleton" style="min-height:60px"></div></div></div>
      <div class="field"><label>${icon('users')} ${t('Coworkers')} <span class="hint">— ${t('can see and work on this task')}</span></label><div id="nt-members"></div>
        <small class="hint">${t('Other staff in the department cannot see this task. Supervisors always can.')}</small></div>
      <div class="field"><label>${t('Attach files (optional)')}</label><input type="file" class="input" id="nt-files" multiple><small class="hint" id="nt-rule"></small></div>
      <div class="error-text" id="nt-err"></div>
      <div class="modal-foot"><button type="button" class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" type="submit">${icon('plus')} ${t('Create task')}</button></div>
    </form>`);
  const form = $('#nt', m.el);
  let selected = prefill.assignee || null;
  async function loadAssignees() {
    const code = form.dept.value;
    $('#nt-rule', m.el).textContent = `${t('Accepted files')}: ${fileRuleLabel(code)}`;
    $('#nt-files', m.el).accept = acceptFor(code);
    const deptId = S.depts.find((d) => d.code === code)?.id;
    const keep = pickedIds($('#nt-members', m.el));
    $('#nt-members', m.el).innerHTML = memberPicker(deptId, keep, { exclude: [S.me.id] });
    const box = $('#nt-assignees', m.el);
    try {
      const list = await api(`/api/assignable?dept=${code}`);
      if (S.me.role === 'staff') selected = S.me.id;
      if (selected && !list.some((u) => u.id === selected)) selected = null;
      box.innerHTML = list.length ? list.map((u, i) => assigneeItem(u, i, u.id === selected)).join('') : `<div class="muted">${t('No members in this department')}</div>`;
      if (S.me.role === 'staff') box.insertAdjacentHTML('beforeend', `<small class="hint">${t('Staff can create tasks for themselves — supervisors assign tasks to others')}</small>`);
    } catch (e) { box.innerHTML = `<div class="error-text">${esc(e.message)}</div>`; }
  }
  $('#nt-assignees', m.el).addEventListener('change', (e) => {
    selected = Number(e.target.value);
    $$('.assignee', m.el).forEach((a) => a.classList.toggle('sel', $('input', a).checked));
  });
  form.dept.addEventListener('change', () => { selected = null; loadAssignees(); });
  loadAssignees();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      const created = await api('/api/tasks', { method: 'POST', body: {
        title: form.title.value, description: form.description.value, dept: form.dept.value, priority: form.priority.value,
        start_date: form.start_date.value, due_date: form.due_date.value, assignee_id: selected, status: prefill.status || 'todo',
        member_ids: pickedIds($('#nt-members', m.el)),
      } });
      const files = $('#nt-files', m.el).files;
      if (files.length) await uploadMany(created.id, [...files], null);
      toast(t('Task "{name}" created', { name: esc(created.title) }), 'ok');
      m.close(); changed();
    } catch (err) { $('#nt-err', m.el).textContent = err.message; btn.disabled = false; }
  });
}
