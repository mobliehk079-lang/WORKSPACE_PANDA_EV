// Employee KPI: summary + weekly/monthly charts + ranking within each department
import { S, api, esc, $, $$, icon, avatar, deptChip, dept, deptName, setTitle, segmented, runCountUps, emptyState, deptSegButtons, fmtBucket, t } from '../utils.js';
import { barChart, lineChart } from '../charts.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function renderKpi(page) {
  const team = S.perms.viewTeamKpi;
  setTitle(team ? t('Employee KPI') : t('My KPI'), team ? (S.perms.seeAllDepts ? t('All departments') : deptName(dept(S.me.dept_code))) : t('Your performance'));
  page.innerHTML = `<div class="toolbar">
      ${S.perms.seeAllDepts ? `<div class="seg" id="k-dept">${deptSegButtons()}</div>` : ''}
      <div class="seg" id="k-period"><button data-v="week" class="active">${t('Weekly')}</button><button data-v="month">${t('Monthly')}</button></div>
      <div class="spacer"></div><span class="muted" id="k-focus" style="font-size:.86rem"></span>
    </div>
    <div id="k-body"><div class="stats">${'<div class="skeleton"></div>'.repeat(4)}</div></div>`;
  const st = { dept: 'all', period: 'week', user: null };
  const load = async () => {
    const q = new URLSearchParams({ dept: st.dept, period: st.period });
    if (st.user) q.set('user', st.user);
    const d = await api(`/api/kpi?${q}`);
    const focus = st.user ? d.users.find((u) => u.id === st.user) : null;
    const s = focus || d.summary;
    $('#k-focus', page).innerHTML = focus ? `${t('Viewing')}: <b>${esc(focus.name)}</b> <button class="btn btn-sm btn-ghost" id="k-clear">${icon('x')} ${t('Whole team')}</button>` : team ? t('Tap an employee in the table to see their chart') : '';
    $('#k-clear', page)?.addEventListener('click', () => { st.user = null; load(); });
    const body = $('#k-body', page);
    const periodName = st.period === 'week' ? t('Last 8 weeks') : t('Last 6 months');
    const depts = [...new Set(d.users.map((u) => u.dept_code))];
    body.innerHTML = `
      <div class="stats stagger">
        <div class="glass stat lift" style="--ic:linear-gradient(135deg,#a78bfa,#7c3aed)"><div class="k"><span class="ic">${icon('checkCircle')}</span><span>${t('Done / total')}</span></div><div class="v"><span data-count="${s.done}">0</span><small>/ ${s.total}</small></div><div class="d">${t('Completion {n}%', { n: s.completionRate })}</div></div>
        <div class="glass stat lift" style="--ic:linear-gradient(135deg,#6ee7b7,#059669)"><div class="k"><span class="ic">${icon('target')}</span><span>${t('On-time delivery')}</span></div><div class="v"><span data-count="${s.onTimeRate}" data-suffix="%">0%</span></div><div class="d">${t('On time {a} · late {b}', { a: s.onTime, b: s.late })}</div></div>
        <div class="glass stat lift ${s.overdue ? 'bad' : ''}" style="--ic:linear-gradient(135deg,#fca5a5,#dc2626)"><div class="k"><span class="ic">${icon('alert')}</span><span>${t('Overdue tasks')}</span></div><div class="v"><span data-count="${s.overdue}">0</span></div><div class="d">${t('Unfinished and past the due date')}</div></div>
        <div class="glass stat lift" style="--ic:linear-gradient(135deg,#93c5fd,#2563eb)"><div class="k"><span class="ic">${icon('clock')}</span><span>${t('Average time per task')}</span></div><div class="v"><span data-count="${s.avgDays}" data-dec="1">0</span><small>${t('days')}</small></div><div class="d">${t('From start date to actual completion')}</div></div>
      </div>
      <div class="grid g-2 stagger">
        <div class="glass card lift"><h3 class="card-title">${icon('chart')} ${st.period === 'week' ? t('Tasks completed per week') : t('Tasks completed per month')}<span class="sub">${periodName}${focus ? ' · ' + esc(focus.name) : ''}</span></h3><div id="k-bar"></div>
          <div class="legend" style="margin-top:8px"><span><i style="--c:var(--s-done)"></i>${t('On time')}</span><span><i style="--c:var(--s-review)"></i>${t('Late')}</span></div></div>
        <div class="glass card lift"><h3 class="card-title">${icon('target')} ${t('On-time rate')}<span class="sub">${t('% per period (periods with completed tasks)')}</span></h3><div id="k-line"></div></div>
      </div>
      <div class="glass card lift mt"><h3 class="card-title">${icon('trophy')} ${team ? t('Ranking within department') : t('My performance summary')}<span class="sub">${t('Score = on time 50% + completion 30% + not overdue 20%')}</span></h3>
        <div class="table-wrap">${d.users.length ? `<table class="rank-table"><thead><tr><th>${t('Rank')}</th><th>${t('Employee')}</th><th>${t('Done / total')}</th><th>${t('On time')}</th><th class="num">${t('Overdue')}</th><th class="num">${t('Avg (days)')}</th><th class="num">${t('Score')}</th></tr></thead>
          <tbody>${depts.map((dc) => `${depts.length > 1 ? `<tr class="grp"><td colspan="7">${deptChip(dc, false)}</td></tr>` : ''}
            ${d.users.filter((u) => u.dept_code === dc).sort((a, b) => a.rank - b.rank).map((u) => `<tr data-user="${u.id}" class="${u.id === st.user ? 'sel' : ''}">
              <td><span class="medal ${u.rank <= 3 && team ? 'm' + u.rank : ''}">${team ? u.rank : '–'}</span></td>
              <td><div class="who">${avatar(u)}<div><b>${esc(u.name)}</b><small>${esc(u.title || '')}</small></div></div></td>
              <td><div class="mini-bar"><div class="bar"><i data-w="${u.completionRate}"></i></div><span class="tnum">${u.done}/${u.total}</span></div></td>
              <td><div class="mini-bar"><div class="bar"><i data-w="${u.onTimeRate}" style="background:linear-gradient(90deg,#34d399,#059669)"></i></div><span class="tnum">${u.onTimeRate}%</span></div></td>
              <td class="num" style="${u.overdue ? 'color:var(--bad);font-weight:600' : ''}">${u.overdue}</td>
              <td class="num">${u.avgDays}</td>
              <td class="num"><b style="font-size:1.05rem">${u.score}</b></td></tr>`).join('')}`).join('')}</tbody></table>` : emptyState(t('No data'), 'chart')}</div></div>`;
    runCountUps(body);
    const labels = d.series.labels.map(fmtBucket);
    barChart($('#k-bar', body), { labels, series: [{ name: t('On time'), color: css('--s-done'), values: d.series.onTime }, { name: t('Late'), color: css('--s-review'), values: d.series.late }], height: 250 });
    const idx = d.series.done.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
    const lineEl = $('#k-line', body);
    if (idx.length) lineChart(lineEl, { labels: idx.map((i) => labels[i]), series: [{ name: t('On time') + ' %', color: css('--s-doing'), values: idx.map((i) => Math.round((d.series.onTime[i] / d.series.done[i]) * 100)) }], height: 250 });
    else lineEl.innerHTML = emptyState(t('No completed tasks in this period'), 'chart');
    $$('tr[data-user]', body).forEach((tr) => tr.addEventListener('click', () => { if (!team) return; st.user = Number(tr.dataset.user) === st.user ? null : Number(tr.dataset.user); load(); }));
  };
  if (S.perms.seeAllDepts) segmented($('#k-dept', page), (v) => { st.dept = v; st.user = null; load(); });
  segmented($('#k-period', page), (v) => { st.period = v; load(); });
  await load();
  const on = () => load().catch(() => {});
  window.addEventListener('tw:theme', on);
  window.addEventListener('tw:changed', on);
  return () => { window.removeEventListener('tw:theme', on); window.removeEventListener('tw:changed', on); };
}
