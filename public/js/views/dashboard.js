// Role-based dashboard
import {
  S, api, esc, $, icon, avatar, deptChip, deptVars, prioBadge, dueBadge, dueInfo, statusPill, STATUS, LOAD, PRESENCE, dept, deptName, deptShort,
  fmtDate, fmtTime, fmtBucket, MON, today, setTitle, segmented, runCountUps, emptyState, toast, toastErr, deptSegButtons, DEPT_ICON, t,
} from '../utils.js';
import { donut, barChart, hbars } from '../charts.js';
import { openTask, openNewTask } from './taskModal.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const stat = (label, value, ic, grad, { suffix = '', sub = '', bad = false } = {}) => `<div class="glass stat lift ${bad ? 'bad' : ''}" style="--ic:${grad}">
  <div class="k"><span class="ic">${icon(ic)}</span><span>${label}</span></div><div class="v"><span data-count="${value}" data-suffix="${suffix}">0${suffix}</span></div>${sub ? `<div class="d">${sub}</div>` : ''}</div>`;
const G = {
  violet: 'linear-gradient(135deg,#a78bfa,#7c3aed)', blue: 'linear-gradient(135deg,#60a5fa,#2563eb)', orange: 'linear-gradient(135deg,#fdba74,#ea580c)',
  red: 'linear-gradient(135deg,#fca5a5,#dc2626)', green: 'linear-gradient(135deg,#6ee7b7,#059669)', pink: 'linear-gradient(135deg,#f9a8d4,#db2777)', amber: 'linear-gradient(135deg,#fde68a,#d97706)',
};
function taskLi(x) {
  return `<div class="li ${dueInfo(x).over ? 'over' : ''}" data-task="${x.id}"><span class="stripe" style="${deptVars(x.dept_code)}"></span>
    <div class="grow"><span class="t">${esc(x.title)}</span><span class="s">${S.perms.seeAllDepts ? deptChip(x.dept_code) : ''}${prioBadge(x.priority)}${statusPill(x.status)}${x.assignee_name ? `<span>${esc(x.assignee_name)}</span>` : ''}</span></div>
    <div class="li-end">${dueBadge(x)}<div class="bar"><i data-w="${x.progress}"></i></div></div></div>`;
}
export function meetingLi(m) {
  const d = new Date(m.start_at);
  return `<div class="li" style="cursor:default" data-meeting="${m.id}">
    <div class="meet" style="gap:12px;width:100%;align-items:center"><div class="date" style="width:52px;padding:5px 0"><b style="font-size:1.2rem">${d.getDate()}</b><small>${MON[d.getMonth()]}</small></div>
    <div class="grow" style="min-width:0;flex:1"><span class="t">${esc(m.title)}</span><span class="s">${icon('clock')}${fmtTime(m.start_at)} – ${fmtTime(m.end_at)} ${m.location ? `· ${esc(m.location)}` : ''} ${m.online_url ? `· <a href="${esc(m.online_url)}" target="_blank" rel="noopener">${t('Online link')}</a>` : ''}</span>
    ${m.my_response && m.organizer_id !== S.me.id ? `<div class="rsvp" style="margin-top:6px">${m.my_response === 'pending' ? `<button class="btn btn-sm btn-ok" data-rsvp="accepted">${icon('check')} ${t('Accept')}</button><button class="btn btn-sm btn-danger" data-rsvp="declined">${icon('x')} ${t('Decline')}</button>` : `<span class="load-tag ${m.my_response === 'accepted' ? 'free' : 'overloaded'}">${m.my_response === 'accepted' ? t('Accepted') : t('Declined')}</span>`}</div>` : ''}</div></div></div>`;
}
export function bindRsvp(root, reload) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rsvp]'); if (!b) return;
    const id = Number(b.closest('[data-meeting]').dataset.meeting);
    try { await api(`/api/meetings/${id}/respond`, { method: 'POST', body: { response: b.dataset.rsvp } }); toast(b.dataset.rsvp === 'accepted' ? t('Meeting accepted') : t('Meeting declined'), 'ok'); reload(); }
    catch (err) { toastErr(err); }
  });
}
function memberLi(m) {
  const level = m.presence === 'away' ? 'away' : m.workload.level;
  return `<div class="li" style="cursor:default">${avatar(m, '', true)}<div class="grow"><span class="t">${esc(m.name)}</span><span class="s">${S.perms.seeAllDepts ? deptChip(m.dept_code) : ''}${PRESENCE[m.presence]} · ${t('{n} tasks', { n: m.workload.active })}</span></div>
    <div class="li-end"><span class="load-tag ${level}">${LOAD[level]}</span><div class="bar load-bar"><i class="${m.workload.level}" data-w="${m.workload.percent}"></i></div></div></div>`;
}

export async function renderDashboard(page) {
  const me = S.me;
  const hr = new Date().getHours();
  const hello = hr < 12 ? t('Good morning') : hr < 17 ? t('Good afternoon') : t('Good evening');
  setTitle(`${hello}, ${me.name.split(' ')[0]}`, fmtDate(today(), { weekday: true, year: true }));
  const isStaff = me.role === 'staff';
  page.innerHTML = `${S.perms.seeAllDepts ? `<div class="toolbar"><div class="seg" id="db-dept">${deptSegButtons(`${icon('layers')}${t('All departments')}`)}</div></div>` : ''}<div id="db-body"><div class="stats">${'<div class="skeleton"></div>'.repeat(4)}</div></div>`;
  let deptSel = 'all';
  const dbBody = $('#db-body', page);
  dbBody.addEventListener('click', (e) => { const x = e.target.closest('[data-task]'); if (x) openTask(Number(x.dataset.task)); });
  bindRsvp(dbBody, () => load());
  const load = async () => {
    const d = await api(`/api/dashboard?dept=${deptSel}`);
    dbBody.innerHTML = (d.pendingUsers ? `<a class="glass card lift banner" href="#/users">${icon('userPlus')}<span>${t('{n} registration requests are waiting for approval', { n: `<b>${d.pendingUsers}</b>` })}</span><span class="sub">${t('Review')} →</span></a>` : '') + (isStaff ? staffView(d) : managerView(d));
    runCountUps(dbBody);
    drawCharts(dbBody, d);
    $('#db-new', dbBody)?.addEventListener('click', () => openNewTask({ dept: deptSel !== 'all' ? deptSel : undefined }));
  };
  if (S.perms.seeAllDepts) segmented($('#db-dept', page), (v) => { deptSel = v; load(); });
  await load();
  const on = () => load().catch(() => {});
  window.addEventListener('tw:changed', on);
  window.addEventListener('tw:theme', on);
  return () => { window.removeEventListener('tw:changed', on); window.removeEventListener('tw:theme', on); };

  function managerView(d) {
    const scopeName = deptSel === 'all' ? (S.perms.seeAllDepts ? t('All departments') : deptName(dept(me.dept_code))) : deptName(dept(deptSel));
    return `
      <div class="stats stagger">
        ${stat(t('Open tasks'), d.openCount, 'layers', G.violet, { sub: esc(scopeName) })}
        ${stat(t('In progress'), d.statusCounts.doing, 'zap', G.blue, { sub: t('{n} to do', { n: d.statusCounts.todo }) })}
        ${stat(t('In review'), d.statusCounts.review, 'eye', G.orange, { sub: t('Waiting for supervisor approval') })}
        ${stat(t('Overdue'), d.overdueCount, 'alert', G.red, { bad: d.overdueCount > 0, sub: d.overdueCount ? t('Needs follow-up') : t('Nothing overdue 🎉') })}
        ${stat(t('Free people'), d.people.free, 'coffee', G.green, { sub: t('of {n} · {o} overloaded', { n: d.people.total, o: d.people.overloaded }) })}
        ${stat(t('On-time delivery'), d.kpi.onTimeRate, 'target', G.pink, { suffix: '%', sub: t('{n} tasks done', { n: d.kpi.done }) })}
      </div>
      <div class="grid g-12 stagger">
        <div class="glass card lift"><h3 class="card-title">${icon('kanban')} ${t('Task status')}<span class="sub">${t('Done = last 30 days')}</span></h3><div id="ch-donut"></div></div>
        <div class="glass card lift"><h3 class="card-title">${icon('chart')} ${d.perDept ? t('Open tasks by department') : t('Workload by person')}<span class="sub">${d.perDept ? t('Count by status') : t('% of capacity')}</span></h3><div id="ch-cmp"></div>
          ${d.perDept ? `<div class="legend" style="margin-top:8px">${STATUS.slice(0, 3).map((s) => `<span><i style="--c:${s.color}"></i>${s.label}</span>`).join('')}</div>` : ''}</div>
      </div>
      <div class="grid g-21 mt stagger">
        <div class="glass card lift"><h3 class="card-title">${icon('trophy')} ${t('Tasks completed per week')}<span class="sub">${t('Last 8 weeks')}</span></h3><div id="ch-week"></div>
          <div class="legend" style="margin-top:8px"><span><i style="--c:var(--s-done)"></i>${t('On time')}</span><span><i style="--c:var(--s-review)"></i>${t('Late')}</span></div></div>
        <div class="glass card lift"><h3 class="card-title">${icon('users')} ${t("Who's free / overloaded")}<a class="sub" href="#/team">${t('See all')} →</a></h3>
          <div class="summary-pills" style="margin-bottom:12px"><span class="load-tag free">${LOAD.free} ${d.people.free}</span><span class="load-tag balanced">${LOAD.balanced} ${d.people.balanced}</span><span class="load-tag overloaded">${LOAD.overloaded} ${d.people.overloaded}</span><span class="load-tag away">${LOAD.away} ${d.people.away}</span></div>
          <div class="list scroll-list">${d.members.map(memberLi).join('')}</div></div>
      </div>
      ${d.perDept ? `<div class="grid g-3 mt stagger">${d.perDept.map((p) => { const dd = dept(p.code); return `<a href="#/dept/${p.code}" class="glass card lift" style="${deptVars(p.code)};color:inherit">
          <div class="flex" style="margin-bottom:12px"><span class="avatar" style="${deptVars(p.code)};border-radius:12px">${icon(DEPT_ICON[p.code])}</span><b style="flex:1">${esc(deptName(dd))}</b><span class="muted" style="font-size:.82rem">${t('{n} people', { n: p.members })}</span></div>
          <div class="flex wrap" style="gap:6px;margin-bottom:10px">${STATUS.slice(0, 3).map((s) => `<span class="status-pill" style="--sc:${s.color}">${s.label} ${p.counts[s.key]}</span>`).join('')}</div>
          <div class="flex wrap" style="justify-content:space-between;font-size:.86rem;gap:6px"><span>${t('Overdue')} <b style="color:${p.overdue ? 'var(--bad)' : 'inherit'}">${p.overdue}</b></span><span>${LOAD.free} <b>${p.free}</b></span><span>${t('On time')} <b>${p.kpi.onTimeRate}%</b></span></div>
          <div class="bar" style="margin-top:10px"><i data-w="${p.kpi.onTimeRate}" style="background:linear-gradient(90deg,var(--dc1),var(--dc2))"></i></div></a>`; }).join('')}</div>` : ''}
      <div class="grid g-2 mt stagger">
        <div class="glass card lift"><h3 class="card-title" style="color:var(--bad)">${icon('alert')} ${t('Overdue tasks')}<span class="sub">${t('{n} tasks', { n: d.overdueCount })}</span></h3>
          <div class="list">${d.overdue.length ? d.overdue.map(taskLi).join('') : emptyState(t('Nothing overdue. Great job!'))}</div></div>
        <div class="glass card lift"><h3 class="card-title">${icon('hourglass')} ${t('Due within 3 days')}<button class="btn btn-sm btn-primary" id="db-new" style="margin-left:auto">${icon('plus')} ${t('Assign task')}</button></h3>
          <div class="list">${d.dueSoon.length ? d.dueSoon.map(taskLi).join('') : emptyState(t('Nothing due soon'))}</div></div>
      </div>
      ${d.meetings.length ? `<div class="glass card lift mt"><h3 class="card-title">${icon('meeting')} ${t('My upcoming meetings')}<a class="sub" href="#/meetings">${t('See all')} →</a></h3><div class="list">${d.meetings.map(meetingLi).join('')}</div></div>` : ''}`;
  }

  function staffView(d) {
    const my = d.mine;
    const level = me.presence === 'away' ? 'away' : my.workload.level;
    return `
      <div class="stats stagger">
        ${stat(t('My open tasks'), my.workload.active, 'layers', G.violet, { sub: t('{n} starting later', { n: my.upcoming }) })}
        ${stat(t('Due soon / overdue'), my.dueSoon.length, 'hourglass', G.amber, { sub: t('Within 3 days'), bad: my.workload.overdue > 0 })}
        ${stat(t('Done this month'), my.doneThisMonth, 'checkCircle', G.green, { sub: t('{n} in total', { n: my.kpi.done }) })}
        ${stat(t('On-time delivery'), my.kpi.onTimeRate, 'target', G.pink, { suffix: '%', sub: t('Avg {n} days per task', { n: my.kpi.avgDays }) })}
      </div>
      <div class="grid g-21 stagger">
        <div class="glass card lift"><h3 class="card-title">${icon('zap')} ${t('My tasks today')}<button class="btn btn-sm btn-primary" id="db-new" style="margin-left:auto">${icon('plus')} ${t('Add task')}</button></h3>
          <div class="list">${my.today.length ? my.today.map(taskLi).join('') : emptyState(t('No open tasks today ☕'))}</div></div>
        <div class="glass card lift"><h3 class="card-title">${icon('user')} ${t('My workload')}</h3>
          <div class="flex" style="margin-bottom:10px">${avatar(me, 'lg', true)}<div style="min-width:0"><b>${esc(me.name)}</b><div class="muted" style="font-size:.86rem">${esc(me.title || '')}</div></div></div>
          <div class="flex" style="justify-content:space-between;margin-bottom:6px"><span class="load-tag ${level}">${LOAD[level]}</span><span class="muted" style="font-size:.86rem">${t('{n}% of capacity', { n: my.workload.percent })}</span></div>
          <div class="bar load-bar" style="height:10px"><i class="${my.workload.level}" data-w="${my.workload.percent}"></i></div>
          <div class="member" style="margin-top:14px"><div class="nums"><div><b>${my.workload.byStatus.todo}</b><small>${STATUS[0].label}</small></div><div><b>${my.workload.byStatus.doing}</b><small>${STATUS[1].label}</small></div><div><b>${my.workload.byStatus.review}</b><small>${STATUS[2].label}</small></div></div></div>
          <p class="hint">${t('Set your status (available / busy / away) with the button at the top')}</p></div>
      </div>
      <div class="grid g-2 mt stagger">
        <div class="glass card lift"><h3 class="card-title">${icon('hourglass')} ${t('Due soon')}</h3><div class="list">${my.dueSoon.length ? my.dueSoon.map(taskLi).join('') : emptyState(t('Nothing due soon'))}</div></div>
        <div class="glass card lift"><h3 class="card-title">${icon('meeting')} ${t('Upcoming meetings')}<a class="sub" href="#/meetings">${t('See all')} →</a></h3><div class="list">${d.meetings.length ? d.meetings.map(meetingLi).join('') : emptyState(t('No upcoming meetings'), 'calendar')}</div></div>
      </div>
      <div class="glass card lift mt"><h3 class="card-title">${icon('kanban')} ${t('Tasks in {dept}', { dept: esc(deptShort(dept(me.dept_code))) })}<a class="sub" href="#/dept/${me.dept_code}">${t('Open workspace')} →</a></h3><div id="ch-donut"></div></div>`;
  }

  function drawCharts(body, d) {
    const dn = $('#ch-donut', body);
    if (dn) donut(dn, STATUS.map((s) => ({ label: s.label, value: d.statusCounts[s.key], color: css(`--s-${s.key}`) })), { centerLabel: t('All tasks') });
    const cmp = $('#ch-cmp', body);
    if (cmp) {
      if (d.perDept) barChart(cmp, { labels: d.perDept.map((p) => deptShort(dept(p.code))), series: STATUS.slice(0, 3).map((s) => ({ name: s.label, color: css(`--s-${s.key}`), values: d.perDept.map((p) => p.counts[s.key]) })), unit: '', height: 230 });
      else hbars(cmp, d.members.filter((m) => m.role === 'staff').sort((a, b) => b.workload.percent - a.workload.percent).map((m) => ({ label: m.name.split(' ')[0], value: m.workload.percent, color: m.workload.level === 'overloaded' ? 'linear-gradient(90deg,#fb7185,#ef4444)' : m.workload.level === 'balanced' ? 'linear-gradient(90deg,#fcd34d,#f59e0b)' : 'linear-gradient(90deg,#34d399,#10b981)' })), { unit: '%', max: 100 });
    }
    const wk = $('#ch-week', body);
    if (wk) barChart(wk, { labels: d.series.labels.map(fmtBucket), series: [{ name: t('On time'), color: css('--s-done'), values: d.series.onTime }, { name: t('Late'), color: css('--s-review'), values: d.series.late }], height: 250 });
  }
}
