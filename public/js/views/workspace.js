// Department workspace: tasks / files / members (separate per department)
import { S, api, esc, $, icon, deptVars, dept, deptName, deptShort, DEPT_ICON, setTitle, segmented, runCountUps, emptyState, openModal, acceptFor, fileRuleLabel, toast, t } from '../utils.js';
import { deptDesc } from '../i18n.js';
import { mountTaskViews } from './tasks.js';
import { fileCard, bindFileCards, uploadMany, changed } from './taskModal.js';
import { memberCard, bindMemberCards } from './team.js';

export async function renderWorkspace(page, code, tab = 'board') {
  const d = dept(code);
  if (!d) throw new Error(t('Department not found'));
  if (!d.visible) throw new Error(t('You do not have access to this department'));
  setTitle(`Workspace · ${deptShort(d)}`, deptName(d));
  const [team, files, tasks] = await Promise.all([api(`/api/team?dept=${code}`), api(`/api/files?dept=${code}`), api(`/api/tasks?dept=${code}`)]);
  const open = tasks.filter((x) => x.status !== 'done').length;
  page.innerHTML = `
    <div class="glass hero" style="${deptVars(code)}">
      <div class="hico">${icon(DEPT_ICON[code])}</div>
      <div style="min-width:0;flex:1"><h2>${esc(deptName(d))}</h2><p>${esc(deptDesc(d))}</p><p class="hint" style="margin-top:6px">${icon('upload')} ${t('Accepted files')}: ${esc(fileRuleLabel(code))}</p></div>
      <div class="hstats"><div><b data-count="${team.length}">0</b><small>${t('Members')}</small></div><div><b data-count="${open}">0</b><small>${t('Open tasks')}</small></div><div><b data-count="${files.length}">0</b><small>${t('Files')}</small></div></div>
    </div>
    <div class="seg tabs" id="ws-tab">
      <button data-v="board" class="${tab === 'board' ? 'active' : ''}">${icon('kanban')}${t('Task board')}</button>
      <button data-v="files" class="${tab === 'files' ? 'active' : ''}">${icon('folder')}${t('Files')} (${files.length})</button>
      <button data-v="members" class="${tab === 'members' ? 'active' : ''}">${icon('users')}${t('Members')} (${team.length})</button>
    </div>
    <div id="ws-body"></div>`;
  runCountUps(page);
  let sub = null;
  const body = $('#ws-body', page);
  const show = async (tb) => {
    if (typeof sub === 'function') sub(); sub = null;
    body.innerHTML = '';
    history.replaceState(null, '', `#/dept/${code}/${tb}`);
    if (tb === 'board') sub = await mountTaskViews(body, { fixedDept: code });
    else if (tb === 'files') sub = await filesTab(body, code);
    else { body.innerHTML = `<div class="team-grid">${team.map(memberCard).join('')}</div>`; bindMemberCards(body); runCountUps(body); }
  };
  segmented($('#ws-tab', page), show);
  await show(tab);
  return () => { if (typeof sub === 'function') sub(); };
}

async function filesTab(root, code) {
  const d = dept(code);
  const kinds = [['all', t('All'), 'folder'], ['image', t('Images/posters'), 'image'], ['video', t('Videos'), 'video'], ['doc', t('Documents'), 'file']]
    .filter(([k]) => k === 'all' || k === 'doc' || d.fileRule.kinds.includes(k));
  root.innerHTML = `<div class="toolbar"><div class="seg" id="fk">${kinds.map(([k, l, ic], i) => `<button data-v="${k}" class="${i ? '' : 'active'}">${icon(ic)}${l}</button>`).join('')}</div><div class="spacer"></div>
    <button class="btn btn-primary" id="f-up">${icon('upload')} ${t('Upload files')}</button></div><div id="f-grid"></div>`;
  let files = [];
  let kind = 'all';
  const grid = $('#f-grid', root);
  const canManage = S.perms.assignOthers && (S.perms.seeAllDepts || S.me.dept_code === code);
  const draw = () => {
    const list = files.filter((f) => kind === 'all' || (kind === 'doc' ? !['image', 'video'].includes(f.kind) : f.kind === kind));
    grid.innerHTML = list.length ? `<div class="files-grid stagger">${list.map((f) => fileCard(f, { showTask: true, canDelete: f.uploaded_by === S.me.id || canManage })).join('')}</div>` : `<div class="glass card">${emptyState(t('No files in this category yet'), 'folder')}</div>`;
  };
  const load = async () => { files = await api(`/api/files?dept=${code}`); draw(); };
  bindFileCards(grid, () => files, { onDelete: () => { load(); changed(); } });
  segmented($('#fk', root), (v) => { kind = v; draw(); });
  $('#f-up', root).addEventListener('click', async () => {
    const tasks = await api(`/api/tasks?dept=${code}`);
    if (!tasks.length) return toast(t('There are no tasks in this department yet — create a task first'), 'err');
    const m = openModal(`<div class="modal-head"><h2>${icon('upload')} ${t('Upload files')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
      <p class="hint" style="margin-top:0">${t('Every file belongs to a task — choose the task to attach to')}</p>
      <div class="field"><label>${t('Task')}</label><select class="input" id="up-task">${tasks.map((x) => `<option value="${x.id}">${esc(x.title)}${x.assignee_name ? ' — ' + esc(x.assignee_name) : ''}</option>`).join('')}</select></div>
      <label class="dropzone" id="up-drop" style="display:block">${icon('upload')}<div>${t('Drop files here or')} <b>${t('click to choose')}</b></div><small>${esc(fileRuleLabel(code))}</small><input type="file" id="up-file" multiple accept="${acceptFor(code)}" hidden></label>
      <div class="list" id="up-list" style="margin-top:10px"></div>`);
    const go = async (fl) => {
      const res = await uploadMany(Number($('#up-task', m.el).value), [...fl], $('#up-list', m.el));
      if (res.length) { m.close(); await load(); changed(); }
    };
    $('#up-file', m.el).addEventListener('change', (e) => go(e.target.files));
    const dz = $('#up-drop', m.el);
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); go(e.dataTransfer.files); });
  });
  await load();
  return () => {};
}
