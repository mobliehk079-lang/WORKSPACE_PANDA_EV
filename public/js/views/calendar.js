// Monthly calendar: tasks (on their due date) + meetings
import { S, api, esc, $, $$, icon, openModal, deptVars, deptChip, prioBadge, dueBadge, dueInfo, statusPill, today, ymd, parse, WD, fmtMonth, fmtDate, fmtTime, setTitle, segmented, emptyState, deptSegButtons, t } from '../utils.js';
import { openTask, openNewTask } from './taskModal.js';

let monthState = null;

export function calendarView(el, { tasks, meetings }) {
  if (!monthState) { const d = parse(today()); monthState = { y: d.getFullYear(), m: d.getMonth() }; }
  const draw = () => {
    const { y, m } = monthState;
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7);
    const cells = Array.from({ length: weeks * 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const itemsOf = (ds) => [
      ...meetings.filter((x) => x.start_at.slice(0, 10) === ds).map((x) => ({ type: 'meet', x })),
      ...tasks.filter((x) => x.due_date === ds).map((x) => ({ type: 'task', x })),
    ];
    el.innerHTML = `<div class="glass card">
      <div class="cal-head">
        <button class="btn btn-icon" data-mv="-1" aria-label="${t('Previous month')}">${icon('left')}</button>
        <h3>${fmtMonth(y, m)}</h3>
        <button class="btn btn-icon" data-mv="1" aria-label="${t('Next month')}">${icon('right')}</button>
        <button class="btn btn-sm" data-mv="0">${t('Today')}</button>
        <div style="flex:1"></div>
        <div class="legend"><span><i style="--c:var(--accent)"></i>${t('Meeting')}</span><span><i style="--c:linear-gradient(90deg,var(--dept-it),var(--dept-marketing))"></i>${t('Task due')}</span><span><i style="--c:var(--bad)"></i>${t('Overdue')}</span></div>
      </div>
      <div class="cal">${WD.map((w) => `<div class="wd">${w}</div>`).join('')}
      ${cells.map((d) => {
        const ds = ymd(d); const items = itemsOf(ds); const we = d.getDay() === 0 || d.getDay() === 6;
        return `<div class="day ${d.getMonth() !== m ? 'other' : ''} ${ds === today() ? 'today' : ''} ${we ? 'we' : ''}" data-day="${ds}">
          <span class="n">${d.getDate()}</span>
          ${items.slice(0, 3).map((it) => it.type === 'meet'
            ? `<div class="ev meet" data-meet="${it.x.id}" title="${esc(it.x.title)}">${fmtTime(it.x.start_at)} ${esc(it.x.title)}</div>`
            : `<div class="ev ${dueInfo(it.x).over ? 'over' : ''} ${it.x.status === 'done' ? 'done' : ''}" style="${deptVars(it.x.dept_code)}" data-task="${it.x.id}" title="${esc(it.x.title)}">${esc(it.x.title)}</div>`).join('')}
          ${items.length > 3 ? `<span class="ev-more">+${items.length - 3}</span>` : ''}
          <div class="cal-dots">${items.slice(0, 5).map((it) => `<i style="${it.type === 'meet' ? '--dc1:var(--accent)' : dueInfo(it.x).over ? '--dc1:var(--bad)' : deptVars(it.x.dept_code)}"></i>`).join('')}</div>
        </div>`;
      }).join('')}</div></div>`;
    $$('[data-mv]', el).forEach((b) => b.addEventListener('click', () => {
      const v = Number(b.dataset.mv);
      if (!v) { const d = parse(today()); monthState = { y: d.getFullYear(), m: d.getMonth() }; }
      else { const d = new Date(monthState.y, monthState.m + v, 1); monthState = { y: d.getFullYear(), m: d.getMonth() }; }
      draw();
    }));
    $('.cal', el).addEventListener('click', (e) => {
      const tk = e.target.closest('[data-task]'); if (tk) return openTask(Number(tk.dataset.task));
      const mt = e.target.closest('[data-meet]'); if (mt) return showMeeting(meetings.find((x) => x.id === Number(mt.dataset.meet)));
      const day = e.target.closest('[data-day]'); if (day) showDay(day.dataset.day, itemsOf(day.dataset.day));
    });
  };
  draw();
}

function showMeeting(mt) {
  const md = openModal(`<div class="modal-head"><h2>${icon('meeting')} ${esc(mt.title)}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    <p>${icon('clock')} ${fmtDate(mt.start_at.slice(0, 10), { weekday: true, year: true })} · ${fmtTime(mt.start_at)} – ${fmtTime(mt.end_at)}</p>
    ${mt.location ? `<p>${icon('pin')} ${esc(mt.location)}</p>` : ''}
    ${mt.online_url ? `<p style="word-break:break-all">${icon('link')} <a href="${esc(mt.online_url)}" target="_blank" rel="noopener">${esc(mt.online_url)}</a></p>` : ''}
    ${mt.agenda ? `<div class="field"><span class="label">${t('Agenda')}</span><div class="input" style="white-space:pre-wrap;min-height:0">${esc(mt.agenda)}</div></div>` : ''}
    <p class="muted">${t('Organizer')}: ${esc(mt.organizer_name)} · ${t('{n} attendees', { n: mt.attendees.length })}</p>
    <div class="modal-foot"><a class="btn" href="#/meetings">${t('Open meetings page')}</a></div>`);
  md.el.querySelector('a[href="#/meetings"]').addEventListener('click', md.close);
}

function showDay(ds, items) {
  const md = openModal(`<div class="modal-head"><h2>${icon('calendar')} ${fmtDate(ds, { weekday: true, year: true })}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    <div class="list">${items.length ? items.map((it) => it.type === 'meet'
      ? `<div class="li" data-meet="${it.x.id}"><span class="stripe" style="--dc1:var(--accent);--dc2:var(--accent-2)"></span><div class="grow"><span class="t">${esc(it.x.title)}</span><span class="s">${icon('meeting')} ${fmtTime(it.x.start_at)} – ${fmtTime(it.x.end_at)}${it.x.location ? ' · ' + esc(it.x.location) : ''}</span></div></div>`
      : `<div class="li ${dueInfo(it.x).over ? 'over' : ''}" data-task="${it.x.id}"><span class="stripe" style="${deptVars(it.x.dept_code)}"></span><div class="grow"><span class="t">${esc(it.x.title)}</span><span class="s">${deptChip(it.x.dept_code)} ${prioBadge(it.x.priority)} ${statusPill(it.x.status)} ${esc(it.x.assignee_name || '')}</span></div>${dueBadge(it.x)}</div>`).join('') : emptyState(t('No tasks or meetings on this day'), 'calendar')}</div>
    <div class="modal-foot"><button class="btn btn-primary" data-new>${icon('plus')} ${t('Add a task due this day')}</button></div>`);
  md.el.addEventListener('click', (e) => {
    const tk = e.target.closest('[data-task]'); if (tk) { md.close(); return openTask(Number(tk.dataset.task)); }
    const mt = e.target.closest('[data-meet]'); if (mt) { md.close(); return showMeeting(items.find((i) => i.type === 'meet' && i.x.id === Number(mt.dataset.meet)).x); }
    if (e.target.closest('[data-new]')) { md.close(); openNewTask({ start: ds < today() ? ds : today(), due: ds }); }
  });
}

export async function renderCalendarPage(page) {
  setTitle(t('Tasks & meetings calendar'), t('Tasks are shown on their due date'));
  const seeAll = S.perms.seeAllDepts;
  page.innerHTML = `<div class="toolbar">${seeAll ? `<div class="seg" id="cal-dept">${deptSegButtons()}</div>` : ''}
    <div class="seg" id="cal-who"><button data-v="all" class="active">${t('Everything')}</button><button data-v="me">${t('Only mine')}</button></div><div class="spacer"></div>
    <button class="btn btn-primary" id="cal-new">${icon('plus')} ${t('Add task')}</button></div><div id="cal-body"><div class="skeleton" style="min-height:500px"></div></div>`;
  const st = { dept: 'all', who: 'all' };
  let tasks = [], meetings = [];
  const draw = () => {
    let ts = tasks, ms = meetings;
    if (st.dept !== 'all') { ts = ts.filter((x) => x.dept_code === st.dept); ms = ms.filter((x) => !x.dept_code || x.dept_code === st.dept); }
    if (st.who === 'me') { ts = ts.filter((x) => x.assignee_id === S.me.id); ms = ms.filter((x) => x.attendees.some((a) => a.user_id === S.me.id)); }
    calendarView($('#cal-body', page), { tasks: ts, meetings: ms });
  };
  const load = async () => { [tasks, meetings] = await Promise.all([api('/api/tasks?dept=all&hideOldDone=0'), api('/api/meetings')]); draw(); };
  if (seeAll) segmented($('#cal-dept', page), (v) => { st.dept = v; draw(); });
  segmented($('#cal-who', page), (v) => { st.who = v; draw(); });
  $('#cal-new', page).addEventListener('click', () => openNewTask());
  await load();
  const on = () => load().catch(() => {});
  window.addEventListener('tw:changed', on);
  return () => window.removeEventListener('tw:changed', on);
}
