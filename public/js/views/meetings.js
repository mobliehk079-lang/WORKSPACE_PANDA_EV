// Meetings: schedule / accept-decline / cancel
import { S, api, esc, $, $$, icon, avatar, deptChip, dept, deptName, MON, fmtDate, fmtTime, today, addDays, setTitle, segmented, openModal, confirmDialog, toast, toastErr, emptyState, ROLE, t } from '../utils.js';
import { bindRsvp } from './dashboard.js';

const nowLocal = () => { const n = new Date(), z = (x) => String(x).padStart(2, '0'); return `${n.getFullYear()}-${z(n.getMonth() + 1)}-${z(n.getDate())}T${z(n.getHours())}:${z(n.getMinutes())}`; };
const RESP = { accepted: ['✓', t('Accepted')], declined: ['✕', t('Declined')], pending: ['…', t('Waiting')] };

function meetingCard(m) {
  const d = new Date(m.start_at);
  const past = m.end_at < nowLocal();
  const counts = { accepted: 0, declined: 0, pending: 0 }; m.attendees.forEach((a) => counts[a.response]++);
  return `<div class="glass card lift meet ${past ? 'past' : ''}" data-meeting="${m.id}">
    <div class="date"><b>${d.getDate()}</b><small>${MON[d.getMonth()]}</small></div>
    <div class="body">
      <div class="flex wrap" style="gap:8px;margin-bottom:4px">${m.dept_code ? deptChip(m.dept_code) : `<span class="chip">${t('Cross-department')}</span>`}${m.organizer_id === S.me.id ? `<span class="chip">${t('You organized this')}</span>` : ''}${past ? `<span class="chip">${t('Past')}</span>` : ''}</div>
      <h4>${esc(m.title)}</h4>
      <div class="info"><span>${icon('clock')}${fmtDate(m.start_at.slice(0, 10), { weekday: true })} ${fmtTime(m.start_at)} – ${fmtTime(m.end_at)}</span>
        ${m.location ? `<span>${icon('pin')}${esc(m.location)}</span>` : ''}
        ${m.online_url ? `<span>${icon('link')}<a href="${esc(m.online_url)}" target="_blank" rel="noopener">${t('Join online')}</a></span>` : ''}
        <span>${icon('user')}${t('Organizer')}: ${esc(m.organizer_name)}</span></div>
      ${m.agenda ? `<div class="agenda"><b style="font-weight:500">${t('Agenda')}:</b>\n${esc(m.agenda)}</div>` : ''}
      <div class="muted" style="font-size:.82rem">${t('Accepted {a} · waiting {b} · declined {c}', { a: counts.accepted, b: counts.pending, c: counts.declined })}</div>
      <div class="att">${m.attendees.map((a) => `<span class="att-chip ${a.response}" title="${esc(a.name)} — ${RESP[a.response][1]}">${avatar({ name: a.name, dept_code: a.dept_code }, 'sm')}${esc(a.name.split(' ')[0])}<span class="r">${RESP[a.response][0]}</span></span>`).join('')}</div>
      <div class="rsvp">${!past && m.my_response && m.organizer_id !== S.me.id ? `<span class="muted" style="font-size:.86rem">${t('Your answer')}:</span>
          <button class="btn btn-sm ${m.my_response === 'accepted' ? 'btn-ok' : ''}" data-rsvp="accepted">${icon('check')} ${t('Accept')}</button>
          <button class="btn btn-sm ${m.my_response === 'declined' ? 'btn-danger' : ''}" data-rsvp="declined">${icon('x')} ${t('Decline')}</button>` : ''}
        ${m.can_delete && !past ? `<button class="btn btn-sm btn-ghost btn-danger" data-cancel="${m.id}" style="margin-left:auto">${icon('trash')} ${t('Cancel meeting')}</button>` : ''}</div>
    </div></div>`;
}

export async function renderMeetings(page) {
  setTitle(t('Meetings'), S.perms.createMeeting ? (S.perms.seeAllDepts ? t('You can invite anyone') : t('You can invite people in {dept}', { dept: deptName(dept(S.me.dept_code)) })) : t('Meetings you are invited to'));
  page.innerHTML = `<div class="toolbar"><div class="seg" id="mt-when"><button data-v="up" class="active">${icon('calendar')}${t('Upcoming')}</button><button data-v="past">${t('Past')}</button></div><div class="spacer"></div>
    ${S.perms.createMeeting ? `<button class="btn btn-primary" id="mt-new">${icon('plus')} ${t('Schedule meeting')}</button>` : ''}</div><div class="list" id="mt-list" style="gap:16px"></div>`;
  let when = 'up', meetings = [];
  const list = $('#mt-list', page);
  const draw = () => {
    const nowIso = nowLocal();
    const items = when === 'up' ? meetings.filter((m) => m.end_at >= nowIso) : meetings.filter((m) => m.end_at < nowIso).reverse();
    list.innerHTML = items.length ? items.map(meetingCard).join('') : `<div class="glass card">${emptyState(when === 'up' ? t('No upcoming meetings') : t('No past meetings'), 'calendar')}</div>`;
    $$('.meet', list).forEach((el, i) => { el.style.animation = `rise .6s cubic-bezier(.22,1,.36,1) ${i * 50}ms both`; });
  };
  const load = async () => { meetings = await api('/api/meetings'); draw(); };
  segmented($('#mt-when', page), (v) => { when = v; draw(); });
  bindRsvp(list, load);
  list.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-cancel]'); if (!c) return;
    if (!(await confirmDialog(t('Cancel meeting'), t('All attendees will be notified. Continue?'), { ok: t('Cancel meeting'), danger: true }))) return;
    try { await api(`/api/meetings/${c.dataset.cancel}`, { method: 'DELETE' }); toast(t('Meeting cancelled'), 'ok'); load(); } catch (err) { toastErr(err); }
  });
  $('#mt-new', page)?.addEventListener('click', () => newMeeting(load));
  await load();
  api('/api/notifications').then((n) => n.items.filter((x) => x.type === 'meeting' && !x.is_read).forEach((x) => api('/api/notifications/read', { method: 'POST', body: { id: x.id } }))).catch(() => {});
}

function newMeeting(reload) {
  const people = S.users.filter((u) => u.id !== S.me.id && (S.perms.seeAllDepts || u.dept_id === S.me.dept_id));
  const groups = S.perms.seeAllDepts
    ? [[t('Management'), people.filter((u) => !u.dept_id)], ...S.depts.map((d) => [deptName(d), people.filter((u) => u.dept_id === d.id)])]
    : [[deptName(dept(S.me.dept_code)), people]];
  const m = openModal(`<div class="modal-head"><h2>${icon('meeting')} ${t('Schedule meeting')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    <form id="mf">
      <div class="field"><label for="mf-t">${t('Meeting title')} *</label><input class="input" id="mf-t" name="title" required maxlength="200"></div>
      <div class="row row-3"><div class="field"><label>${t('Date')} *</label><input type="date" class="input" name="date" value="${addDays(today(), 1)}" min="${today()}" required></div>
        <div class="field"><label>${t('Start')} *</label><input type="time" class="input" name="start" value="10:00" required></div>
        <div class="field"><label>${t('End')} *</label><input type="time" class="input" name="end" value="11:00" required></div></div>
      <div class="row"><div class="field"><label>${t('Location')}</label><input class="input" name="location"></div>
        <div class="field"><label>${t('Online link')}</label><input class="input" name="online_url" type="url" inputmode="url" placeholder="https://"></div></div>
      <div class="field"><label>${t('Agenda')}</label><textarea class="input" name="agenda" rows="3" placeholder="1. …&#10;2. …"></textarea></div>
      <div class="field"><label>${t('Attendees')} * <span class="hint" id="mf-n"></span></label>
        <div class="flex" style="margin-bottom:6px"><input class="input" id="mf-q" type="search" placeholder="${t('Search names…')}" style="flex:1"><button type="button" class="btn btn-sm" id="mf-all">${t('Select all')}</button></div>
        <div class="check-list" id="mf-people">${groups.filter(([, l]) => l.length).map(([g, l]) => `<div class="check-group">${esc(g)}</div>${l.map((u) => `<label class="check-item" data-name="${esc(u.name.toLowerCase())}"><input type="checkbox" value="${u.id}">${avatar(u, 'sm', true)}<span style="flex:1;min-width:0">${esc(u.name)}</span><small class="muted">${ROLE[u.role]}</small></label>`).join('')}`).join('')}</div>
        ${!S.perms.seeAllDepts ? `<small class="hint">${t('Supervisors can only invite people from their own department')}</small>` : ''}</div>
      <div class="error-text" id="mf-err"></div>
      <div class="modal-foot"><button type="button" class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary">${icon('check')} ${t('Send invitations')}</button></div>
    </form>`);
  const f = $('#mf', m.el);
  const count = () => { $('#mf-n', m.el).textContent = t('({n} selected)', { n: $$('#mf-people input:checked', m.el).length }); };
  count();
  $('#mf-people', m.el).addEventListener('change', count);
  $('#mf-q', m.el).addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); $$('.check-item', m.el).forEach((c) => { c.style.display = !q || c.dataset.name.includes(q) ? '' : 'none'; }); });
  $('#mf-all', m.el).addEventListener('click', () => { const vis = $$('.check-item', m.el).filter((c) => c.style.display !== 'none').map((c) => $('input', c)); const all = vis.every((i) => i.checked); vis.forEach((i) => { i.checked = !all; }); count(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = $$('#mf-people input:checked', m.el).map((i) => Number(i.value));
    try {
      await api('/api/meetings', { method: 'POST', body: { title: f.title.value, start_at: `${f.date.value}T${f.start.value}`, end_at: `${f.date.value}T${f.end.value}`, location: f.location.value, online_url: f.online_url.value, agenda: f.agenda.value, attendee_ids: ids } });
      toast(t('Invitations sent to {n} people', { n: ids.length }), 'ok');
      m.close(); reload();
      window.dispatchEvent(new CustomEvent('tw:changed'));
    } catch (err) { $('#mf-err', m.el).textContent = err.message; }
  });
}
