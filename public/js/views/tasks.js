// Tasks: Kanban (drag & drop) / Timeline (Gantt) / Calendar + filters
import {
  S, api, esc, $, $$, h, icon, toast, toastErr, avatar, deptChip, deptVars, prioBadge, dueBadge, dueInfo, STATUS, STATUS_LABEL,
  PRIORITY, today, addDays, diffDays, parse, MONTHS, WD, segmented, debounce, setTitle, dept, deptName, emptyState, deptSegButtons, t,
} from '../utils.js';
import { openTask, openNewTask } from './taskModal.js';
import { calendarView } from './calendar.js';

// ======================================================================
// Task card
// ======================================================================
export function taskCard(task) {
  const over = dueInfo(task).over;
  return `<div class="tcard ${over ? 'over' : ''}" data-id="${task.id}" data-over="${t('Overdue')}" style="${deptVars(task.dept_code)}" tabindex="0" role="button" aria-label="${esc(task.title)}">
    ${task.cover_file_id ? `<div class="cover" style="background-image:url('/files/${task.cover_file_id}')"></div>` : ''}
    <h4>${esc(task.title)}</h4>
    <div class="meta">${prioBadge(task.priority)}${dueBadge(task)}</div>
    <div class="bar"><i style="width:${task.progress}%"></i></div>
    <div class="foot">
      ${task.assignee_name ? avatar({ name: task.assignee_name, dept_code: task.dept_code }, 'sm') : '<span class="avatar sm" style="--dc1:#94a3b8;--dc2:#64748b">?</span>'}
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(task.assignee_name || t('Not assigned'))}</span>
      ${task.file_count ? `<span class="ic">${icon('clip')}${task.file_count}</span>` : ''}${task.comment_count ? `<span class="ic">${icon('message')}${task.comment_count}</span>` : ''}
      <span>${task.progress}%</span>
    </div></div>`;
}

// ======================================================================
// Kanban + drag & drop (Pointer Events: mouse, pen and touch)
// ======================================================================
export function kanban(el, tasks) {
  const byId = new Map(tasks.map((x) => [x.id, x]));
  el.innerHTML = `<div class="board">${STATUS.map((s) => {
    const list = tasks.filter((x) => x.status === s.key);
    return `<section class="col glass" data-status="${s.key}"><div class="col-head" style="--sc:${s.color}"><span class="dot"></span>${s.label}<span class="n">${list.length}</span></div>
      <div class="col-body">${list.map(taskCard).join('')}</div></section>`;
  }).join('')}</div>
  <p class="hint drag-hint">${t('Tip: on phones and tablets, press and hold a card to drag it')}</p>`;
  const board = $('.board', el);
  board.addEventListener('click', (e) => { const c = e.target.closest('.tcard'); if (c && !c.dataset.justDragged) openTask(Number(c.dataset.id)); });
  board.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const c = e.target.closest('.tcard'); if (c) openTask(Number(c.dataset.id)); } });
  enableDnD(board, byId);
}

let dndAbort = null;
function enableDnD(board, byId) {
  dndAbort?.abort();
  dndAbort = new AbortController();
  const sig = { signal: dndAbort.signal };
  let st = null;
  const counts = () => $$('.col', board).forEach((c) => { $('.n', c).textContent = $$('.tcard:not(.drag-source)', c).length + ($('.drop-ph', c) ? 1 : 0); });

  const begin = (x, y) => {
    const { card } = st;
    const r = card.getBoundingClientRect();
    st.dragging = true;
    st.origin = { next: card.nextElementSibling };
    st.rect = r; st.off = { x: x - r.left, y: y - r.top };
    st.ghost = card.cloneNode(true);
    st.ghost.classList.add('drag-ghost');
    Object.assign(st.ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px', transform: 'rotate(2deg) scale(1.03)' });
    document.body.appendChild(st.ghost);
    st.ph = h(`<div class="drop-ph" style="height:${r.height}px"></div>`);
    card.before(st.ph);
    card.classList.add('drag-source');
    card.style.display = 'none';
    document.body.classList.add('dragging');
    counts();
  };
  const move = (x, y) => {
    st.ghost.style.transform = `translate(${x - st.off.x - st.rect.left}px, ${y - st.off.y - st.rect.top}px) rotate(${Math.max(-4, Math.min(4, (x - (st.lastX ?? x)) * 0.4))}deg) scale(1.03)`;
    st.lastX = x;
    const col = document.elementFromPoint(x, y)?.closest('.col');
    $$('.col', board).forEach((c) => c.classList.toggle('drop-target', c === col));
    if (col && board.contains(col)) {
      const body = $('.col-body', col);
      const before = $$('.tcard:not(.drag-source)', body).find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
      if (before) { if (st.ph.nextElementSibling !== before) body.insertBefore(st.ph, before); }
      else if (body.lastElementChild !== st.ph) body.appendChild(st.ph);
      counts();
    }
    const br = board.getBoundingClientRect();
    if (x < br.left + 50) board.scrollLeft -= 14; else if (x > br.right - 50) board.scrollLeft += 14;
    if (y < 90) window.scrollBy(0, -12); else if (y > innerHeight - 60) window.scrollBy(0, 12);
  };
  const finish = async () => {
    const { card, ghost, ph, origin } = st;
    const col = ph.closest('.col');
    $$('.col', board).forEach((c) => c.classList.remove('drop-target'));
    const pr = ph.getBoundingClientRect();
    ghost.style.transition = 'transform .28s cubic-bezier(.22,1,.36,1)';
    ghost.style.transform = `translate(${pr.left - st.rect.left}px, ${pr.top - st.rect.top}px)`;
    const id = Number(card.dataset.id);
    const task = byId.get(id);
    const newStatus = col.dataset.status;
    const prev = ph.previousElementSibling?.classList.contains('tcard') ? byId.get(Number(ph.previousElementSibling.dataset.id)) : null;
    const next = ph.nextElementSibling?.classList.contains('tcard') ? byId.get(Number(ph.nextElementSibling.dataset.id)) : null;
    const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1 : next ? next.sort - 1 : 0;
    const moved = newStatus !== task.status || ph.nextElementSibling !== origin.next;
    await new Promise((r) => setTimeout(r, 260));
    ghost.remove();
    card.style.display = '';
    card.classList.remove('drag-source');
    ph.replaceWith(card);
    document.body.classList.remove('dragging');
    card.dataset.justDragged = '1'; setTimeout(() => delete card.dataset.justDragged, 50);
    counts();
    if (!moved) return;
    const revert = () => {
      if (origin.next && origin.next.isConnected) origin.next.before(card);
      else $(`.col[data-status="${task.status}"] .col-body`, board).appendChild(card);
      counts();
    };
    if ((newStatus === 'done' || task.status === 'done') && newStatus !== task.status && !S.perms.approveDone) {
      revert();
      return toast(t('Only a supervisor can move tasks to "Done" — move it to "In review" instead'), 'err');
    }
    try {
      const body = { sort }; if (newStatus !== task.status) body.status = newStatus;
      Object.assign(task, await api(`/api/tasks/${id}`, { method: 'PATCH', body }));
      const fresh = h(taskCard(task));
      card.replaceWith(fresh);
      if (body.status) toast(t('Moved "{name}" to {status}', { name: esc(task.title), status: `<b>${STATUS_LABEL[newStatus]}</b>` }), 'ok');
      if (newStatus === 'done') celebrate(fresh);
    } catch (err) { revert(); toastErr(err); }
  };

  board.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.tcard');
    if (!card || e.button > 0) return;
    st = { card, sx: e.clientX, sy: e.clientY, touch: e.pointerType !== 'mouse', dragging: false };
    if (st.touch) st.timer = setTimeout(() => { if (st && !st.dragging) { begin(st.sx, st.sy); navigator.vibrate?.(12); } }, 260);
  }, sig);
  window.addEventListener('pointermove', (e) => {
    if (!st || st.finishing || !board.isConnected) return;
    if (!st.dragging) {
      const d = Math.hypot(e.clientX - st.sx, e.clientY - st.sy);
      if (st.touch) { if (d > 10) { clearTimeout(st.timer); st = null; } return; }
      if (d > 6) begin(st.sx, st.sy); else return;
    }
    e.preventDefault();
    move(e.clientX, e.clientY);
  }, { passive: false, signal: dndAbort.signal });
  const up = () => {
    if (!st || st.finishing) return;
    clearTimeout(st.timer);
    if (st.dragging) { st.finishing = true; finish().finally(() => { st = null; }); }
    else st = null;
  };
  window.addEventListener('pointerup', up, sig);
  window.addEventListener('pointercancel', up, sig);
  board.addEventListener('touchmove', (e) => { if (st?.dragging) e.preventDefault(); }, { passive: false, signal: dndAbort.signal });
  board.addEventListener('contextmenu', (e) => { if (st) e.preventDefault(); }, sig);
}

function celebrate(el) {
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('span');
    const ang = (Math.PI * 2 * i) / 18, dist = 60 + Math.random() * 50;
    Object.assign(p.style, { position: 'fixed', left: r.left + r.width / 2 + 'px', top: r.top + 20 + 'px', width: '8px', height: '8px', borderRadius: '2px', zIndex: 999, pointerEvents: 'none',
      background: ['#8b5cf6', '#ec4899', '#34d399', '#fbbf24', '#38bdf8'][i % 5], transition: 'transform .8s cubic-bezier(.22,1,.36,1), opacity .8s' });
    document.body.appendChild(p);
    requestAnimationFrame(() => { p.style.transform = `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) rotate(${Math.random() * 360}deg)`; p.style.opacity = 0; });
    setTimeout(() => p.remove(), 850);
  }
}

// ======================================================================
// Timeline / Gantt
// ======================================================================
export function timeline(el, tasks, { groupBy = 'dept' } = {}) {
  let offset = 0;
  const DAYS = 56;
  const draw = () => {
    const w = el.clientWidth || innerWidth;
    const dw = w < 640 ? 30 : 36;
    const leftW = w < 640 ? 140 : w < 1000 ? 200 : 270;
    const start = addDays(today(), -14 + offset);
    const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
    const end = days[DAYS - 1];
    const visible = tasks.filter((x) => x.due_date >= start && x.start_date <= end)
      .sort((a, b) => (a.status === 'done') - (b.status === 'done') || a.start_date.localeCompare(b.start_date));
    const groups = [];
    const keyOf = (x) => (groupBy === 'assignee' ? x.assignee_name || t('Not assigned') : x.dept_code);
    for (const x of visible) { const k = keyOf(x); let g = groups.find((y) => y.k === k); if (!g) groups.push(g = { k, items: [] }); g.items.push(x); }
    const months = []; days.forEach((d) => { const k = d.slice(0, 7); const l = months[months.length - 1]; if (l && l.k === k) l.n++; else months.push({ k, n: 1, d }); });
    const todayIdx = days.indexOf(today());
    const totalW = DAYS * dw;
    let rows = '';
    groups.forEach((g) => {
      const label = groupBy === 'assignee' ? `${icon('user')} ${esc(g.k)}` : deptChip(g.k, false);
      rows += `<div class="g-group g-left">${label}<span class="muted" style="font-weight:400">${t('{n} tasks', { n: g.items.length })}</span></div><div class="g-track grp"></div>`;
      g.items.forEach((x, i) => {
        const s = Math.max(0, diffDays(start, x.start_date)), e = Math.min(DAYS - 1, diffDays(start, x.due_date));
        const info = dueInfo(x);
        rows += `<div class="g-row-label g-left" data-id="${x.id}"><span style="min-width:0;flex:1"><span class="t">${esc(x.title)}</span><span class="s">${esc(x.assignee_name || '-')} · ${STATUS_LABEL[x.status]}</span></span></div>
          <div class="g-track"><div class="g-bar ${x.status === 'done' ? 'done' : ''} ${info.over ? 'over' : ''}" data-id="${x.id}" style="${deptVars(x.dept_code)};left:${s * dw + 2}px;width:${Math.max(dw - 4, (e - s + 1) * dw - 4)}px;animation-delay:${i * 40}ms"
            title="${esc(x.title)} — ${x.start_date} → ${x.due_date} (${x.progress}%)"><i class="pf" style="width:${x.progress}%"></i><span>${x.progress}% · ${esc(x.title)}</span></div></div>`;
      });
    });
    el.innerHTML = `<div class="toolbar" style="margin-bottom:12px">
        <button class="btn btn-sm" data-sh="-14">${icon('left')} <span class="hide-sm">${t('2 weeks back')}</span></button><button class="btn btn-sm" data-sh="0">${t('Today')}</button><button class="btn btn-sm" data-sh="14"><span class="hide-sm">${t('2 weeks ahead')}</span> ${icon('right')}</button>
        <div class="spacer"></div>
        <div class="legend">${S.depts.map((d) => `<span><i style="--c:linear-gradient(90deg,${d.color},${d.color2})"></i>${esc(deptName(d))}</span>`).join('')}<span><i style="--c:repeating-linear-gradient(135deg,#ef4444 0 3px,transparent 3px 6px);box-shadow:0 0 0 1.5px #ef4444"></i>${t('Overdue')}</span><span><i style="--c:var(--accent-2);width:3px"></i>${t('Today')}</span></div>
      </div>
      <div class="glass gantt"><div class="gantt-scroll"><div class="gantt-grid" style="grid-template-columns:${leftW}px ${totalW}px">
        <div class="g-corner">${groupBy === 'assignee' ? t('Assignee / task') : t('Department / task')}</div>
        <div class="g-head"><div class="g-months">${months.map((mo) => { const d = parse(mo.d); return `<div class="g-month" style="width:${mo.n * dw}px">${MONTHS[d.getMonth()]} ${d.getFullYear()}</div>`; }).join('')}</div>
          <div class="g-days">${days.map((d) => { const dd = parse(d); const we = dd.getDay() === 0 || dd.getDay() === 6; return `<div class="g-day ${we ? 'we' : ''} ${d === today() ? 'today' : ''}" style="width:${dw}px">${WD[dd.getDay()]}<b>${dd.getDate()}</b></div>`; }).join('')}</div></div>
        <div class="g-weekends" style="left:${leftW}px;width:${totalW}px">${days.map((d) => { const wd = parse(d).getDay(); return `<span style="width:${dw}px;${wd === 0 || wd === 6 ? 'background:var(--hairline)' : ''}"></span>`; }).join('')}</div>
        ${rows || `<div class="g-left" style="grid-column:1/-1">${emptyState(t('No tasks in this period'), 'calendar')}</div>`}
        ${todayIdx >= 0 ? `<div class="g-today" style="left:${leftW + todayIdx * dw + dw / 2}px"></div>` : ''}
      </div></div></div>`;
    $$('[data-sh]', el).forEach((b) => b.addEventListener('click', () => { const v = Number(b.dataset.sh); offset = v === 0 ? 0 : offset + v; draw(); }));
    $$('[data-id]', el).forEach((b) => b.addEventListener('click', () => openTask(Number(b.dataset.id))));
    const sc = $('.gantt-scroll', el);
    if (todayIdx >= 0 && offset === 0) sc.scrollLeft = Math.max(0, todayIdx * dw - 3 * dw);
  };
  draw();
}

// ======================================================================
// Filters + views (shared with department workspaces)
// ======================================================================
export async function mountTaskViews(root, { fixedDept = null, view = 'kanban', onView } = {}) {
  const seeAll = S.perms.seeAllDepts && !fixedDept;
  const st = { view, dept: fixedDept || 'all', assignee: '', priority: '', q: '', mine: false, tasks: [], meetings: null };
  root.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="tv-view">
        <button data-v="kanban" class="${view === 'kanban' ? 'active' : ''}">${icon('kanban')}Kanban</button>
        <button data-v="timeline" class="${view === 'timeline' ? 'active' : ''}">${icon('timeline')}Timeline</button>
        <button data-v="calendar" class="${view === 'calendar' ? 'active' : ''}">${icon('calendar')}${t('Calendar')}</button>
      </div>
      ${seeAll ? `<div class="seg" id="tv-dept">${deptSegButtons()}</div>` : ''}
      <div class="spacer"></div>
      <button class="btn btn-primary" id="tv-new">${icon('plus')} ${t('Add task')}</button>
    </div>
    <div class="toolbar filters">
      <div class="search"><span>${icon('search')}</span><input class="input" id="tv-q" type="search" placeholder="${t('Search tasks…')}" aria-label="${t('Search tasks…')}"></div>
      <select class="input" id="tv-assignee" aria-label="${t('Assignee')}"></select>
      <select class="input" id="tv-prio" aria-label="${t('Priority')}"><option value="">${t('All priorities')}</option>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="btn" id="tv-mine" aria-pressed="false">${icon('user')} ${t('My tasks')}</button>
      <span class="muted" id="tv-count" style="font-size:.86rem"></span>
    </div>
    <div id="tv-body"><div class="skeleton" style="min-height:360px"></div></div>`;

  const fillAssignees = () => {
    const users = S.users.filter((u) => !['admin', 'superadmin'].includes(u.role) && (st.dept === 'all' || u.dept_code === st.dept));
    $('#tv-assignee', root).innerHTML = `<option value="">${t('Everyone')}</option>${users.map((u) => `<option value="${u.id}" ${String(u.id) === st.assignee ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}`;
  };
  const filtered = () => st.tasks.filter((x) =>
    (!st.assignee || String(x.assignee_id) === st.assignee) && (!st.priority || x.priority === st.priority) &&
    (!st.mine || x.assignee_id === S.me.id) && (!st.q || (x.title + ' ' + (x.description || '')).toLowerCase().includes(st.q.toLowerCase())));
  const draw = async () => {
    const body = $('#tv-body', root);
    const list = filtered();
    $('#tv-count', root).textContent = t('{n} tasks', { n: list.length });
    if (st.view === 'kanban') kanban(body, list);
    else if (st.view === 'timeline') timeline(body, list, { groupBy: st.dept === 'all' ? 'dept' : 'assignee' });
    else {
      if (!st.meetings) st.meetings = await api('/api/meetings');
      const meets = st.dept === 'all' ? st.meetings : st.meetings.filter((mt) => !mt.dept_code || mt.dept_code === st.dept);
      calendarView(body, { tasks: list, meetings: st.mine ? meets.filter((mt) => mt.attendees.some((a) => a.user_id === S.me.id)) : meets });
    }
  };
  const load = async () => { st.tasks = await api(`/api/tasks?dept=${st.dept}`); await draw(); };
  segmented($('#tv-view', root), (v) => { st.view = v; onView?.(v); draw(); });
  if (seeAll) segmented($('#tv-dept', root), (v) => { st.dept = v; st.assignee = ''; fillAssignees(); load(); });
  $('#tv-q', root).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); draw(); }, 200));
  $('#tv-assignee', root).addEventListener('change', (e) => { st.assignee = e.target.value; draw(); });
  $('#tv-prio', root).addEventListener('change', (e) => { st.priority = e.target.value; draw(); });
  $('#tv-mine', root).addEventListener('click', (e) => { st.mine = !st.mine; e.currentTarget.classList.toggle('btn-primary', st.mine); e.currentTarget.setAttribute('aria-pressed', st.mine); draw(); });
  $('#tv-new', root).addEventListener('click', () => openNewTask({ dept: st.dept !== 'all' ? st.dept : undefined }));
  fillAssignees();
  await load();
  const onChanged = () => { st.meetings = null; load().catch(() => {}); };
  // Redraw the timeline when the screen size changes (rotate iPad / resize window)
  let lastW = root.clientWidth;
  const ro = new ResizeObserver(debounce(() => { if (st.view === 'timeline' && Math.abs(root.clientWidth - lastW) > 40) { lastW = root.clientWidth; draw(); } }, 200));
  ro.observe(root);
  window.addEventListener('tw:changed', onChanged);
  return () => { window.removeEventListener('tw:changed', onChanged); ro.disconnect(); };
}

export async function renderTasks(page, view = 'kanban') {
  setTitle(S.perms.seeAllDepts ? t('All department plans') : t('Department tasks'), S.perms.seeAllDepts ? t('Filter by department') : deptName(dept(S.me.dept_code)));
  return mountTaskViews(page, { view: view || 'kanban', onView: (v) => history.replaceState(null, '', `#/tasks/${v}`) });
}
