// My team — member cards with workload bars
import { S, api, esc, $, $$, icon, avatar, deptChip, roleBadge, LOAD, PRESENCE, STATUS_LABEL, setTitle, segmented, runCountUps, dueInfo, emptyState, dept, deptName, deptSegButtons, t } from '../utils.js';
import { openNewTask, openTask } from './taskModal.js';

export function memberCard(m, i = 0) {
  const level = m.presence === 'away' ? 'away' : m.workload.level;
  const canAssign = S.perms.assignOthers && (S.perms.seeAllDepts || m.dept_id === S.me.dept_id);
  return `<div class="glass card lift member ${m.presence === 'away' ? 'away' : ''}" style="animation-delay:${i * 40}ms">
    <div class="top">${avatar(m, 'lg', true)}<div style="min-width:0;flex:1"><div class="name">${esc(m.name)}</div><div class="ttl">${esc(m.title || '')}</div>
      <div class="flex wrap" style="gap:6px;margin-top:4px">${S.perms.seeAllDepts ? deptChip(m.dept_code) : ''}${m.role === 'supervisor' ? roleBadge('supervisor') : ''}<span class="chip"><i class="pdot ${m.presence}" style="width:8px;height:8px"></i>${PRESENCE[m.presence]}</span></div></div></div>
    <div><div class="flex" style="justify-content:space-between;margin-bottom:6px"><span class="load-tag ${level}">${LOAD[level]}</span><span class="muted" style="font-size:.82rem">${t('Workload {n}%', { n: m.workload.percent })}</span></div>
      <div class="bar load-bar" style="height:9px"><i class="${m.workload.level}" data-w="${m.workload.percent}"></i></div></div>
    <div class="nums"><div><b data-count="${m.workload.active}">0</b><small>${t('Open')}</small></div><div><b data-count="${m.workload.byStatus.doing}">0</b><small>${STATUS_LABEL.doing}</small></div><div><b data-count="${m.workload.overdue}" style="color:${m.workload.overdue ? 'var(--bad)' : 'inherit'}">0</b><small>${t('Overdue')}</small></div></div>
    <div class="cur">${m.current.length ? m.current.map((x) => `<a href="#/task/${x.id}" data-task="${x.id}"><span class="status-pill" style="--sc:var(--s-${x.status});padding:0 6px 0 4px">${STATUS_LABEL[x.status]}</span><span style="overflow:hidden;text-overflow:ellipsis;${dueInfo(x).over ? 'color:var(--bad)' : ''}">${esc(x.title)}</span></a>`).join('') : `<span class="muted">${t('No open tasks — ready for new work')}</span>`}</div>
    ${canAssign ? `<button class="btn btn-sm" data-assign="${m.id}" data-dept="${m.dept_code}">${icon('plus')} ${t('Assign task')}</button>` : ''}
  </div>`;
}
export function bindMemberCards(root) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-assign]'); if (a) return openNewTask({ assignee: Number(a.dataset.assign), dept: a.dataset.dept });
    const x = e.target.closest('[data-task]'); if (x) { e.preventDefault(); openTask(Number(x.dataset.task)); }
  });
}

export async function renderTeam(page) {
  setTitle(t('My team'), S.perms.seeAllDepts ? t('Availability across all departments') : deptName(dept(S.me.dept_code)));
  page.innerHTML = `<div class="toolbar">${S.perms.seeAllDepts ? `<div class="seg" id="tm-dept">${deptSegButtons()}</div>` : ''}
    <div class="seg" id="tm-sort"><button data-v="free" class="active">${t('Most free first')}</button><button data-v="busy">${t('Busiest first')}</button></div><div class="spacer"></div><div class="summary-pills" id="tm-sum"></div></div>
    <div class="glass card" style="margin-bottom:18px;padding:12px 18px"><div class="legend"><b style="font-weight:500">${t('Workload')}:</b><span><i style="--c:#10b981"></i>${LOAD.free} (≤ 33%)</span><span><i style="--c:#f59e0b"></i>${LOAD.balanced} (34–75%)</span><span><i style="--c:#ef4444"></i>${LOAD.overloaded} (> 75%)</span><span class="muted">${t('Based on unfinished tasks weighted by priority (urgent ×2, high ×1.5, medium ×1, low ×0.5)')}</span></div></div>
    <div class="team-grid" id="tm-grid"></div>`;
  const st = { dept: 'all', sort: 'free' };
  let members = [];
  const draw = () => {
    const list = [...members].sort((a, b) => {
      const d = (a.presence === 'away') - (b.presence === 'away');
      return st.sort === 'free' ? d || a.workload.load - b.workload.load : b.workload.load - a.workload.load;
    });
    const c = (lv) => members.filter((m) => m.presence !== 'away' && m.workload.level === lv).length;
    $('#tm-sum', page).innerHTML = `<span class="load-tag free">${LOAD.free} ${c('free')}</span><span class="load-tag balanced">${LOAD.balanced} ${c('balanced')}</span><span class="load-tag overloaded">${LOAD.overloaded} ${c('overloaded')}</span><span class="load-tag away">${LOAD.away} ${members.filter((m) => m.presence === 'away').length}</span>`;
    const grid = $('#tm-grid', page);
    grid.innerHTML = list.length ? list.map(memberCard).join('') : emptyState(t('No members'), 'users');
    $$('.member', grid).forEach((el) => { el.style.animation = 'rise .6s cubic-bezier(.22,1,.36,1) both'; });
    runCountUps(grid);
  };
  const load = async () => { members = await api(`/api/team?dept=${st.dept}`); draw(); };
  if (S.perms.seeAllDepts) segmented($('#tm-dept', page), (v) => { st.dept = v; load(); });
  segmented($('#tm-sort', page), (v) => { st.sort = v; draw(); });
  bindMemberCards($('#tm-grid', page));
  await load();
  const on = () => load().catch(() => {});
  window.addEventListener('tw:changed', on);
  return () => window.removeEventListener('tw:changed', on);
}
