// Weekly report ("Present"): what was done Monday → Friday, for the Saturday meeting.
// Staff see their own work; supervisors also their department; managers every department.
// Export: Present (full-screen slides), Print / PDF, Excel (CSV).
import {
  S, api, esc, $, $$, icon, avatar, deptChip, deptVars, dept, deptName, prioBadge, statusPill, roleBadge, fmtDate, addDays,
  setTitle, segmented, deptSegButtons, emptyState, runCountUps, t, STATUS_LABEL, PRIORITY, ROLE,
} from '../utils.js';

const range = (w) => {
  const a = fmtDate(w.start, { weekday: true }), b = fmtDate(w.end, { weekday: true, year: true });
  return `${a} – ${b}`;
};
const personName = (p) => p.name || t('Not assigned / left the department');

function statTiles(s) {
  return `<div class="stats stagger rp-stats">
    <div class="glass stat lift" style="--ic:linear-gradient(135deg,#6ee7b7,#059669)"><div class="k"><span class="ic">${icon('checkCircle')}</span><span>${t('Done this week')}</span></div>
      <div class="v"><span data-count="${s.done}">0</span></div><div class="d">${t('On time {a} · late {b}', { a: s.onTime, b: s.late })}</div></div>
    <div class="glass stat lift" style="--ic:linear-gradient(135deg,#a78bfa,#7c3aed)"><div class="k"><span class="ic">${icon('target')}</span><span>${t('On-time delivery')}</span></div>
      <div class="v">${s.done ? `<span data-count="${s.onTimeRate}" data-suffix="%">0%</span>` : '–'}</div><div class="d">${t('Of the tasks finished this week')}</div></div>
    <div class="glass stat lift" style="--ic:linear-gradient(135deg,#93c5fd,#2563eb)"><div class="k"><span class="ic">${icon('kanban')}</span><span>${t('Still in progress')}</span></div>
      <div class="v"><span data-count="${s.open}">0</span></div><div class="d">${t('Open at the end of the week')}</div></div>
    <div class="glass stat lift ${s.overdue ? 'bad' : ''}" style="--ic:linear-gradient(135deg,#fca5a5,#dc2626)"><div class="k"><span class="ic">${icon('alert')}</span><span>${t('Overdue')}</span></div>
      <div class="v"><span data-count="${s.overdue}">0</span></div><div class="d">${t('Past the due date and not finished')}</div></div>
    <div class="glass stat lift" style="--ic:linear-gradient(135deg,#fde68a,#d97706)"><div class="k"><span class="ic">${icon('calendar')}</span><span>${t('Next week')}</span></div>
      <div class="v"><span data-count="${s.next}">0</span></div><div class="d">${t('Starting or due next week')}</div></div>
  </div>`;
}

function taskLine(x, kind, { who = false, self = null } = {}) {
  let right = '';
  if (kind === 'done') right = `<span class="due ${x.late ? 'soon' : 'ok'}">${icon(x.late ? 'clock' : 'check')}${fmtDate(x.completed_at.slice(0, 10), { weekday: true })}${x.late ? ' · ' + t('late') : ''}</span>`;
  else if (kind === 'open') right = x.finished_later
    ? `<span class="due ok">${icon('check')}${t('Finished {d}', { d: fmtDate(x.finished_later) })}</span>`
    : `<span class="rp-prog"><i style="width:${x.progress}%"></i></span><span class="tnum">${x.progress}%</span><span class="due ${x.overdue ? 'over' : ''}">${icon(x.overdue ? 'alert' : 'clock')}${fmtDate(x.due_date)}</span>`;
  else right = `<span class="due">${icon('calendar')}${fmtDate(x.start_date)} → ${fmtDate(x.due_date)}</span>`;
  return `<li class="rp-task" data-task="${x.id}">
    <span class="rp-tt">${esc(x.title)}${who && x.assignee_name && x.assignee_id !== self ? ` <small class="muted">· ${esc(x.assignee_name)}</small>` : ''}</span>
    <span class="rp-meta">${kind === 'open' && !x.finished_later ? statusPill(x.status) : ''}${x.priority === 'urgent' || x.priority === 'high' ? prioBadge(x.priority) : ''}${right}</span></li>`;
}

function lists(r, opts = {}) {
  const block = (kind, ic, title, items, empty) => `<div class="rp-block rp-${kind}"><h4>${icon(ic)} ${title} <span class="rp-n">${items.length}</span></h4>
    ${items.length ? `<ul>${items.map((x) => taskLine(x, kind, opts)).join('')}</ul>` : `<p class="muted rp-none">${empty}</p>`}</div>`;
  return `<div class="rp-lists">
    ${block('done', 'checkCircle', t('Done this week'), r.done, t('Nothing finished this week'))}
    ${block('open', 'kanban', t('Still in progress'), r.open, t('No open tasks'))}
    ${block('next', 'calendar', t('Plan for next week'), r.next, t('Nothing planned yet'))}</div>`;
}

const miniCounts = (s) => `<span class="rp-counts">
  <span title="${t('Done this week')}" class="ok">${icon('checkCircle')}${s.done}</span>
  <span title="${t('Still in progress')}">${icon('kanban')}${s.open}</span>
  ${s.overdue ? `<span title="${t('Overdue')}" class="bad">${icon('alert')}${s.overdue}</span>` : ''}
  <span title="${t('Next week')}">${icon('calendar')}${s.next}</span></span>`;

function personCard(p, open) {
  const u = { name: personName(p), dept_id: p.dept_id };
  return `<details class="rp-person" ${open ? 'open' : ''}><summary>
      ${p.id ? avatar(u) : `<span class="avatar" style="--dc1:#94a3b8;--dc2:#64748b">?</span>`}
      <span class="grow"><b>${esc(personName(p))}</b><small>${p.role ? roleBadge(p.role) : ''} ${esc(p.title || '')}</small></span>
      ${miniCounts(p.summary)}<span class="rp-chev">${icon('right')}</span></summary>
    ${lists(p)}</details>`;
}

// "My work" card: shown first for everyone
function myCard(r) {
  return `<section class="glass card rp-mine">
    <h3 class="card-title">${avatar(S.me)}<span><b>${t('My work')}</b><small class="muted"> · ${esc(S.me.name)}</small></span><span class="sub">${miniCounts(r.summary)}</span></h3>
    ${lists(r, { who: true, self: S.me.id })}</section>`;
}

export async function renderReport(page) {
  setTitle(t('Weekly report'), t('Monday to Friday · for the Saturday meeting'));
  const st = { week: S.today, dept: 'all', data: null };
  page.innerHTML = `
    <div class="toolbar rp-toolbar no-print">
      <div class="rp-week glass"><button class="btn btn-icon btn-ghost" id="rp-prev" aria-label="${t('Previous week')}">${icon('left')}</button>
        <b id="rp-range"></b><button class="btn btn-icon btn-ghost" id="rp-next" aria-label="${t('Next week')}">${icon('right')}</button></div>
      <button class="btn btn-sm" id="rp-this">${t('This week')}</button>
      ${S.perms.seeAllDepts ? `<div class="seg" id="rp-dept">${deptSegButtons()}</div>` : ''}
      <div class="spacer"></div>
      ${S.me.role !== 'staff' ? `<button class="btn btn-primary" id="rp-present-team">${icon('present')}${t('Present team')}</button>` : ''}
      <button class="btn ${S.me.role !== 'staff' ? '' : 'btn-primary'}" id="rp-present-mine">${icon('present')}${S.me.role !== 'staff' ? t('Present my work') : t('Present')}</button>
      <button class="btn" id="rp-print">${icon('printer')}<span class="hide-sm">${t('PDF / Print')}</span></button>
      <button class="btn" id="rp-csv">${icon('sheet')}<span class="hide-sm">Excel</span></button>
    </div>
    <div class="print-head"><h1></h1><p></p></div>
    <div id="rp-body"><div class="stats">${'<div class="skeleton"></div>'.repeat(5)}</div></div>`;
  const body = $('#rp-body', page);

  async function load() {
    const q = new URLSearchParams({ week: st.week, dept: st.dept });
    const d = await api(`/api/report?${q}`);
    st.data = d;
    st.week = d.week.start;
    $('#rp-range', page).textContent = range(d.week);
    $('#rp-next', page).disabled = d.week.start >= weekOf(S.today);
    $('#rp-this', page).hidden = d.week.start === weekOf(S.today);
    $('.print-head h1', page).textContent = `${t('Weekly report')} · ${reportWho(d)}`;
    $('.print-head p', page).textContent = range(d.week);
    if (!d.depts) {
      body.innerHTML = `${statTiles(d.mine.summary)}${myCard(d.mine)}`;
    } else {
      const multi = d.depts.length > 1;
      body.innerHTML = `${myCard(d.mine)}
        <h2 class="rp-section">${icon('users')} ${esc(teamName())}</h2>
        ${statTiles(d.summary)}${d.depts.map((x) => `<section class="glass card rp-dept" style="${deptVars(x.code)}">
          <h3 class="card-title">${deptChip(x.code, false)}<span class="sub">${miniCounts(x.summary)}</span></h3>
          ${x.people.length ? x.people.map((p) => personCard(p, !multi)).join('') : emptyState(t('No members in this department yet'), 'users')}
        </section>`).join('')}`;
    }
    runCountUps(body);
  }
  const teamName = () => (st.dept !== 'all' ? deptName(dept(st.dept)) : S.perms.seeAllDepts ? t('All departments') : deptName(dept(S.me.dept_code)));
  const reportWho = (d) => (d.depts ? `${S.me.name} · ${teamName()}` : S.me.name);
  const reload = () => load().catch((e) => { body.innerHTML = `<div class="glass card empty">${icon('alert')}${esc(e.message)}</div>`; });

  $('#rp-prev', page).onclick = () => { st.week = addDays(st.week, -7); reload(); };
  $('#rp-next', page).onclick = () => { st.week = addDays(st.week, 7); reload(); };
  $('#rp-this', page).onclick = () => { st.week = S.today; reload(); };
  if (S.perms.seeAllDepts) segmented($('#rp-dept', page), (v) => { st.dept = v; reload(); });
  body.addEventListener('click', (e) => { const li = e.target.closest('[data-task]'); if (li) location.hash = `#/task/${li.dataset.task}`; });

  // Print / PDF: open every person so nothing is hidden on paper
  $('#rp-print', page).onclick = () => {
    const closed = $$('details.rp-person:not([open])', body);
    closed.forEach((x) => { x.open = true; });
    const restore = () => { closed.forEach((x) => { x.open = false; }); window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
  };
  $('#rp-csv', page).onclick = () => st.data && downloadCsv(st.data, reportWho(st.data));
  // Leaders: team presentation (department by department) and their own, separately. Staff: their own.
  const team = $('#rp-present-team', page);
  if (team) team.onclick = () => st.data?.depts && present(st.data, teamName(), 'team');
  $('#rp-present-mine', page).onclick = () => st.data && present(st.data, S.me.name, 'mine');

  await load();
  const on = () => reload();
  window.addEventListener('tw:changed', on);
  return () => window.removeEventListener('tw:changed', on);
}

const weekOf = (s) => { const d = new Date(s + 'T00:00:00'); return addDays(s, -((d.getDay() + 6) % 7)); };

// ---------------------------------------------------------------------------------------------
// Excel (CSV with BOM so Excel reads Lao text correctly)
// ---------------------------------------------------------------------------------------------
function downloadCsv(d, who) {
  const rows = [[t('Part'), t('Week'), t('Department'), t('Employee'), t('Section'), t('Task'), t('Status'), t('Priority'), t('Start'), t('Due'), t('Completed'), t('Progress'), t('Note')]];
  const wk = `${d.week.start} – ${d.week.end}`;
  const push = (part, deptCode, person, r) => {
    const sec = { done: t('Done this week'), open: t('Still in progress'), next: t('Plan for next week') };
    for (const k of ['done', 'open', 'next']) for (const x of r[k]) {
      const note = k === 'done' ? (x.late ? t('Late') : t('On time')) : k === 'open' ? (x.finished_later ? t('Finished {d}', { d: x.finished_later }) : x.overdue ? t('Overdue') : '') : '';
      rows.push([part, wk, deptName(dept(deptCode || x.dept_code)), person ?? x.assignee_name ?? '', sec[k], x.title, STATUS_LABEL[x.status], PRIORITY[x.priority],
        x.start_date, x.due_date, x.completed_at ? x.completed_at.slice(0, 10) : '', `${x.progress}%`, note]);
    }
  };
  push(t('My work'), null, S.me.name, d.mine);
  for (const dp of d.depts || []) for (const p of dp.people) push(deptName(dept(dp.code)), dp.code, personName(p), p);
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `weekly-report_${d.week.start}_${who.replace(/[\\/:*?"<>|\s]+/g, '-')}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------------------------------------
// Present: full-screen slides (← → / click / swipe, Esc to close)
// ---------------------------------------------------------------------------------------------
function present(d, who, mode = 'mine') {
  const slides = [];
  const big = (s) => `<div class="sl-stats">
    <div><b>${s.done}</b><span>${t('Done this week')}</span></div>
    <div><b>${s.done ? s.onTimeRate + '%' : '–'}</b><span>${t('On-time delivery')}</span></div>
    <div><b>${s.open}</b><span>${t('Still in progress')}</span></div>
    <div class="${s.overdue ? 'bad' : ''}"><b>${s.overdue}</b><span>${t('Overdue')}</span></div>
    <div><b>${s.next}</b><span>${t('Next week')}</span></div></div>`;
  const listSlide = (head, r, opts) => `<div class="sl-head">${head}</div>${big(r.summary)}${lists(r, opts)}`;
  slides.push(`<div class="sl-title"><span class="sl-logo">${icon('present')}</span><h1>${t('Weekly report')}</h1><h2>${esc(who)}</h2><p>${range(d.week)}</p>
    ${big(mode === 'team' ? d.summary : d.mine.summary)}</div>`);
  if (mode === 'mine')
    slides.push(listSlide(`<div class="who">${avatar(S.me, 'lg')}<div><h2>${t('My work')}</h2><small>${esc(S.me.name)}</small></div></div>`, d.mine, { who: true, self: S.me.id }));
  if (mode === 'team') {
    const single = d.depts.length === 1;
    for (const dp of d.depts) {
      const rows = dp.people.map((p) => `<tr><td><div class="who">${p.id ? avatar({ name: p.name, dept_id: p.dept_id }) : ''}<b>${esc(personName(p))}</b></div></td>
        <td class="num ok">${p.summary.done}</td><td class="num">${p.summary.open}</td><td class="num ${p.summary.overdue ? 'bad' : ''}">${p.summary.overdue}</td><td class="num">${p.summary.next}</td></tr>`).join('');
      slides.push(`<div class="sl-head" style="${deptVars(dp.code)}">${deptChip(dp.code, false)}</div>${big(dp.summary)}
        <table class="sl-table"><thead><tr><th>${t('Employee')}</th><th class="num">${t('Done')}</th><th class="num">${t('In progress')}</th><th class="num">${t('Overdue')}</th><th class="num">${t('Next week')}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="muted">${t('No members in this department yet')}</td></tr>`}</tbody></table>`);
      // One slide per person when presenting a single department (keeps "all departments" short)
      if (single) for (const p of dp.people) if (p.done.length || p.open.length || p.next.length)
        slides.push(listSlide(`<div class="who">${p.id ? avatar({ name: p.name, dept_id: p.dept_id }, 'lg') : ''}<div><h2>${esc(personName(p))}</h2><small>${esc(p.title || (p.role ? ROLE[p.role] : ''))}</small></div></div>`, p, { who: !p.id }));
    }
  }
  const el = document.createElement('div');
  el.className = 'slides';
  el.innerHTML = `<div class="sl-stage">${slides.map((s, i) => `<section class="slide" data-i="${i}">${s}</section>`).join('')}</div>
    <div class="sl-bar"><button class="btn btn-icon" data-a="prev" aria-label="${t('Previous')}">${icon('left')}</button><span class="sl-n"></span>
      <button class="btn btn-icon" data-a="next" aria-label="${t('Next')}">${icon('right')}</button><span class="spacer"></span>
      <button class="btn btn-icon" data-a="full" aria-label="${t('Full screen')}">${icon('maximize')}</button>
      <button class="btn btn-icon" data-a="close" aria-label="${t('Close')}">${icon('x')}</button></div>`;
  document.body.appendChild(el);
  document.body.classList.add('modal-open');
  let i = 0;
  const show = (n) => {
    i = Math.max(0, Math.min(slides.length - 1, n));
    $$('.slide', el).forEach((s, k) => s.classList.toggle('on', k === i));
    $('.sl-n', el).textContent = `${i + 1} / ${slides.length}`;
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    el.remove();
    if (!$('.overlay')) document.body.classList.remove('modal-open');
  };
  const onKey = (e) => {
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); show(i + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); show(i - 1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
    else if (e.key === 'Escape' && !document.fullscreenElement) { e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'prev') show(i - 1);
    else if (a === 'next') show(i + 1);
    else if (a === 'close') close();
    else if (a === 'full') (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.())?.catch?.(() => {});
  });
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
  el.requestFullscreen?.().catch(() => {});
  show(0);
}
