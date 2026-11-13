// Review queue for supervisors/managers: tasks "In review" on the left, a preview (video / photos / details) on the right
import {
  S, api, esc, $, $$, icon, avatar, deptChip, deptVars, prioBadge, statusPill, dueBadge, fmtDate, timeAgo, lightbox, toast, toastErr,
  setTitle, segmented, deptSegButtons, debounce, emptyState, dept, deptName, deptShort, DEPT_ICON, roleBadge, t,
} from '../utils.js';
import { openTask, fileCard, bindFileCards } from './taskModal.js';

const isMedia = (f) => f.kind === 'video' || f.kind === 'image';

export async function renderReview(page) {
  setTitle(t('Review work'), t('Work submitted by your team, waiting for your check'));
  page.innerHTML = `
    <div class="toolbar filters">
      <div class="seg" id="rv-state"><button data-v="review" class="active">${icon('hourglass')}${t('Waiting for review')} <span class="count-pill" id="rv-n"></span></button><button data-v="done">${icon('checkCircle')}${t('Recently approved')}</button></div>
      ${S.perms.seeAllDepts ? `<div class="seg" id="rv-dept">${deptSegButtons()}</div>` : ''}
      <div class="spacer"></div>
      <div class="search"><span>${icon('search')}</span><input class="input" id="rv-q" type="search" placeholder="${t('Search tasks…')}" aria-label="${t('Search tasks…')}"></div>
    </div>
    <div class="review" id="rv">
      <div class="glass rv-list" id="rv-list" role="listbox" aria-label="${t('Review work')}"></div>
      <div class="glass rv-detail" id="rv-detail"></div>
    </div>`;
  const st = { state: 'review', dept: 'all', q: '', items: [], sel: null, task: null };
  const wrap = $('#rv', page), listEl = $('#rv-list', page), detail = $('#rv-detail', page);
  let reqId = 0;

  const visible = () => {
    const q = st.q.toLowerCase();
    return q ? st.items.filter((x) => `${x.title} ${x.description} ${x.assignee_name || ''}`.toLowerCase().includes(q)) : st.items;
  };

  async function load() {
    const items = await api(`/api/review?state=${st.state}&dept=${st.dept}`);
    st.items = items;
    if (st.state === 'review') { $('#rv-n', page).textContent = items.length || ''; setBadge(items.length); }
    const list = visible();
    if (!list.some((x) => x.id === st.sel)) st.sel = list[0]?.id ?? null;
    drawList();
    await showDetail(st.sel, { keepOpen: true });
  }

  function thumb(x) {
    if (x.media_kind === 'image') return `<img src="/files/${x.media_id}" alt="" loading="lazy">`;
    if (x.media_kind === 'video') return `<video src="/files/${x.media_id}#t=0.5" preload="metadata" muted playsinline></video><span class="play">${icon('play')}</span>`;
    return icon(DEPT_ICON[x.dept_code] || 'file');
  }

  function drawList() {
    const list = visible();
    if (!list.length) {
      listEl.innerHTML = emptyState(st.q ? t('No matching tasks') : st.state === 'review' ? t('Nothing waiting for review 🎉') : t('No approved tasks in the last 30 days'), st.state === 'review' ? 'checkCircle' : 'folder');
      return;
    }
    listEl.innerHTML = list.map((x) => `<button class="rv-item ${x.id === st.sel ? 'sel' : ''}" data-id="${x.id}" role="option" aria-selected="${x.id === st.sel}" style="${deptVars(x.dept_code)}">
      <span class="rv-thumb ${x.media_kind ? '' : 'none'}">${thumb(x)}</span>
      <span class="grow">
        <span class="rv-top">${statusPill(x.status)}<span>${timeAgo(x.status === 'done' ? x.completed_at : x.updated_at)}</span>${x.due_date < S.today && x.status !== 'done' ? `<span class="due over">${icon('alert')}${t('Overdue')}</span>` : ''}</span>
        <b class="rv-t">${esc(x.title)}</b>
        <small>${esc(deptShort(dept(x.dept_code)))} · ${esc(x.assignee_name || t('Not assigned'))}${x.file_count ? ` · ${icon('clip')}${x.file_count}` : ''}</small>
      </span></button>`).join('');
  }

  async function showDetail(id, { keepOpen = false } = {}) {
    st.sel = id;
    $$('.rv-item', listEl).forEach((b) => { const on = Number(b.dataset.id) === id; b.classList.toggle('sel', on); b.setAttribute('aria-selected', on); });
    if (!keepOpen) wrap.classList.toggle('open', id != null);
    if (id == null) { st.task = null; wrap.classList.remove('open'); detail.innerHTML = emptyState(t('Select a task on the left to review it'), 'eye'); return; }
    const my = ++reqId;
    detail.innerHTML = '<div class="skeleton" style="min-height:420px"></div>';
    let task;
    try { task = await api(`/api/tasks/${id}`); } catch (e) { if (my === reqId) detail.innerHTML = `<div class="empty">${icon('alert')}${esc(e.message)}</div>`; return; }
    if (my !== reqId) return;
    st.task = task;
    drawDetail();
  }

  function mainMedia(f) {
    if (!f) return `<div class="rv-nomedia">${icon('image')}<span>${t('No video or photo attached')}</span></div>`;
    return f.kind === 'video'
      ? `<video src="/files/${f.id}" controls preload="metadata" playsinline></video>`
      : `<img src="/files/${f.id}" alt="${esc(f.name)}" data-zoom="${f.id}" title="${t('Click to enlarge')}">`;
  }

  function drawDetail() {
    const x = st.task;
    const media = x.files.filter(isMedia).sort((a, b) => (b.kind === 'video') - (a.kind === 'video'));
    const others = x.files.filter((f) => !isMedia(f));
    const waiting = x.status === 'review';
    const canReview = waiting && x.can.approve;
    detail.innerHTML = `
      <div class="rv-scroll">
        <div class="rv-head">
          <button class="btn btn-sm btn-ghost rv-back" data-back>${icon('left')}${t('Back')}</button>
          ${statusPill(x.status)} ${deptChip(x.dept_code)}
          <span class="muted">${esc(x.assignee_name || t('Not assigned'))} · ${waiting ? t('Submitted {t}', { t: timeAgo(x.updated_at) }) : x.completed_at ? t('Approved {t}', { t: timeAgo(x.completed_at) }) : timeAgo(x.updated_at)}</span>
        </div>
        <h2 class="rv-title">${esc(x.title)}</h2>
        <div class="rv-body ${media.length ? '' : 'no-media'}">
          <div class="rv-media">
            <div class="rv-stage" id="rv-stage">${mainMedia(media[0])}</div>
            ${media.length > 1 ? `<div class="rv-strip">${media.map((f, i) => `<button class="rv-mini ${i ? '' : 'sel'}" data-media="${f.id}" title="${esc(f.name)}">${f.kind === 'image' ? `<img src="/files/${f.id}" alt="" loading="lazy">` : `<video src="/files/${f.id}#t=0.5" preload="metadata" muted playsinline></video><span class="play">${icon('play')}</span>`}</button>`).join('')}</div>` : ''}
          </div>
          <div class="rv-info">
            <div class="label">${t('Description')}</div>
            <div class="rv-desc">${x.description ? esc(x.description) : `<span class="muted">${t('No description')}</span>`}</div>
            <dl class="rv-meta">
              <div><dt>${t('Assignee')}</dt><dd>${x.assignee_name ? `${avatar({ name: x.assignee_name, dept_code: x.dept_code }, 'sm')} ${esc(x.assignee_name)}` : '-'}</dd></div>
              <div><dt>${t('Assigned by')}</dt><dd>${esc(x.assigner_name || '-')}</dd></div>
              <div><dt>${t('Start date')}</dt><dd>${fmtDate(x.start_date, { year: true })}</dd></div>
              <div><dt>${t('Due date')}</dt><dd>${fmtDate(x.due_date, { year: true })} ${dueBadge(x)}</dd></div>
              <div><dt>${t('Priority')}</dt><dd>${prioBadge(x.priority)}</dd></div>
              <div><dt>${t('Department')}</dt><dd>${esc(deptName(dept(x.dept_code)))}</dd></div>
            </dl>
          </div>
        </div>
        ${others.length ? `<div class="section"><h3>${icon('clip')} ${t('Other files')} <span class="n">(${others.length})</span></h3><div class="media-grid" id="rv-files">${others.map((f) => fileCard(f)).join('')}</div></div>` : ''}
        <div class="section"><h3>${icon('message')} ${t('Comments')} <span class="n">(${x.comments.length})</span></h3>
          <div class="comments">${x.comments.length ? x.comments.map((c) => `<div class="cmt">${avatar({ name: c.user_name, dept_code: ['admin', 'superadmin'].includes(c.user_role) ? null : x.dept_code }, 'sm')}<div class="bubble"><div class="h"><b>${esc(c.user_name)}</b>${c.user_role !== 'staff' ? roleBadge(c.user_role) : ''}<span style="margin-left:auto">${timeAgo(c.created_at)}</span></div><p>${esc(c.body)}</p></div></div>`).join('') : `<div class="muted" style="font-size:.9rem">${t('No comments yet')}</div>`}</div>
        </div>
      </div>
      <form class="rv-changes" id="rv-form" hidden>
        <label class="label" for="rv-note">${t('What needs to be changed?')}</label>
        <textarea class="input" id="rv-note" rows="3" maxlength="3000" required placeholder="${t('e.g. Make the logo bigger, fix the price in the caption…')}"></textarea>
        <div class="flex" style="justify-content:flex-end"><button type="button" class="btn" data-cancel>${t('Cancel')}</button><button class="btn btn-primary">${icon('right')} ${t('Send back for changes')}</button></div>
      </form>
      <div class="rv-actions">
        ${canReview ? `<button class="btn btn-primary" data-approve>${icon('check')} ${t('Approve')}</button><button class="btn" data-changes>${icon('edit')} ${t('Request changes')}</button>` : ''}
        <a href="#/task/${x.id}" class="rv-open" data-open>${t('Open full task')} →</a>
      </div>`;
    const files = $('#rv-files', detail);
    if (files) bindFileCards(files, x.files);
  }

  async function act(action, note = '') {
    const x = st.task;
    const btns = $$('.rv-actions button, .rv-changes button', detail);
    btns.forEach((b) => { b.disabled = true; });
    try {
      await api(`/api/tasks/${x.id}/review`, { method: 'POST', body: { action, note } });
      toast(action === 'approve' ? t('Task approved as done 🎉') : t('Sent back for changes'), 'ok');
      // Move on to the next task in the queue
      const list = visible();
      const i = list.findIndex((y) => y.id === x.id);
      st.items = st.items.filter((y) => y.id !== x.id);
      const rest = visible();
      st.sel = rest[Math.min(i, rest.length - 1)]?.id ?? null;
      $('#rv-n', page).textContent = st.items.length || '';
      setBadge(st.items.length);
      drawList();
      await showDetail(st.sel, { keepOpen: true });
    } catch (e) {
      toastErr(e);
      btns.forEach((b) => { b.disabled = false; });
      if (e.status === 409) load().catch(() => {});
    }
  }

  // ---------- Events ----------
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('.rv-item'); if (!b) return;
    showDetail(Number(b.dataset.id));
    if (matchMedia('(max-width: 920px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  detail.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) { wrap.classList.remove('open'); return; }
    if (e.target.closest('[data-approve]')) return act('approve');
    if (e.target.closest('[data-changes]')) { const f = $('#rv-form', detail); f.hidden = false; $('#rv-note', f).focus(); return; }
    if (e.target.closest('[data-cancel]')) { $('#rv-form', detail).hidden = true; return; }
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); return openTask(st.task.id); }
    const z = e.target.closest('[data-zoom]');
    if (z) { const f = st.task.files.find((y) => y.id === Number(z.dataset.zoom)); if (f) lightbox(f); return; }
    const mini = e.target.closest('[data-media]');
    if (mini) {
      const f = st.task.files.find((y) => y.id === Number(mini.dataset.media));
      $('#rv-stage', detail).innerHTML = mainMedia(f);
      $$('.rv-mini', detail).forEach((m) => m.classList.toggle('sel', m === mini));
    }
  });
  detail.addEventListener('submit', (e) => {
    e.preventDefault();
    const note = $('#rv-note', detail).value.trim();
    if (note) act('changes', note);
  });
  detail.addEventListener('keydown', (e) => { if (e.target.id === 'rv-note' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#rv-form', detail).requestSubmit(); });

  segmented($('#rv-state', page), (v) => { st.state = v; st.sel = null; load().catch(toastErr); });
  if (S.perms.seeAllDepts) segmented($('#rv-dept', page), (v) => { st.dept = v; st.sel = null; load().catch(toastErr); });
  $('#rv-q', page).addEventListener('input', debounce((e) => {
    st.q = e.target.value.trim();
    drawList();
    const list = visible();
    if (!list.some((x) => x.id === st.sel)) showDetail(list[0]?.id ?? null, { keepOpen: true });
  }, 200));

  // ↑ / ↓ move through the queue (desktop)
  const onKey = (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key) || $('.overlay, .lightbox') || e.target.closest('input, textarea, select, video')) return;
    const list = visible(); if (!list.length) return;
    e.preventDefault();
    const i = list.findIndex((x) => x.id === st.sel);
    const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next && next.id !== st.sel) { showDetail(next.id, { keepOpen: true }); $(`.rv-item[data-id="${next.id}"]`, listEl)?.scrollIntoView({ block: 'nearest' }); }
  };
  document.addEventListener('keydown', onKey);
  const onChanged = () => load().catch(() => {});
  window.addEventListener('tw:changed', onChanged);

  await load();
  return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('tw:changed', onChanged); };
}

/** Sidebar badge with the number of tasks waiting for review */
export function setBadge(n) {
  const el = document.getElementById('review-count');
  if (el) { el.hidden = !n; el.textContent = n > 99 ? '99+' : n; }
}
