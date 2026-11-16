// Monitor — charging stations and their chargers: who sees a problem updates it, IT fixes it
import {
  S, api, esc, $, $$, icon, toast, toastErr, setTitle, segmented, openModal, confirmDialog, emptyState, timeAgo, fmtDateTime, debounce,
  STATUS_LABEL, runCountUps, t,
} from '../utils.js';
import { openTask } from './taskModal.js';

export const CHARGER = {
  ok: { label: t('Working'), color: '#10b981' },
  fault: { label: t('Problem'), color: '#ef4444' },
  offline: { label: t('Offline'), color: '#94a3b8' },
  maintenance: { label: t('Under repair'), color: '#f59e0b' },
};
const STATION = {
  active: { label: t('Active'), color: '#10b981' },
  coming_soon: { label: t('Coming soon'), color: '#8b5cf6' },
  closed: { label: t('Temporarily closed'), color: '#94a3b8' },
};
const PROBLEM = ['fault', 'offline'];
const SWATCH = ['#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#a855f7'];
const pill = (s) => `<span class="status-pill" style="--sc:${s.color}">${s.label}</span>`;
const G = {
  green: 'linear-gradient(135deg,#6ee7b7,#059669)', blue: 'linear-gradient(135deg,#60a5fa,#2563eb)',
  red: 'linear-gradient(135deg,#fca5a5,#dc2626)', amber: 'linear-gradient(135deg,#fde68a,#d97706)',
};
const stat = (label, value, ic, grad, { suffix = '', sub = '', bad = false } = {}) => `<div class="glass stat ${bad ? 'bad' : ''}" style="--ic:${grad}">
  <div class="k"><span class="ic">${icon(ic)}</span><span>${label}</span></div><div class="v"><span data-count="${value}">0</span>${suffix}</div>${sub ? `<div class="d">${sub}</div>` : ''}</div>`;
/** Problems only count where the station is open: chargers of a station still being built are not "broken" */
const problems = (s) => (s.status === 'active' ? s.chargers.filter((c) => PROBLEM.includes(c.status)).length : 0);
const working = (s) => s.chargers.filter((c) => c.status === 'ok').length;

export async function renderMonitor(page) {
  if (!S.perms.monitor) throw new Error(t('Only the IT team, supervisors and managers can open Monitor'));
  setTitle(t('Monitor'), t('Charging stations and chargers'));
  page.innerHTML = `<div class="toolbar">
      <div class="seg" id="mo-f"><button data-v="all" class="active">${t('All stations')}</button><button data-v="problem">${t('Has problems')} <span class="count-pill" id="mo-pc"></span></button></div>
      <div class="search"><span>${icon('search')}</span><input class="input" id="mo-q" type="search" placeholder="${t('Search station…')}"></div>
      <div class="spacer"></div>
      <span class="muted hide-sm" id="mo-upd" style="font-size:.82rem"></span>
      ${S.perms.manageStations ? `<button class="btn btn-primary" id="mo-add">${icon('plus')} ${t('Add station')}</button>` : ''}
    </div>
    <div id="mo-stats" class="stats"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
    <div class="mon-grid">
      <div class="glass card mon-list" id="mo-list"><div class="skeleton" style="min-height:300px"></div></div>
      <div class="glass card"><h3 class="card-title">${icon('clock')} ${t('Latest updates')}</h3><div id="mo-recent" class="mon-recent"></div></div>
    </div>`;
  const st = { f: 'all', q: '', open: new Set(), first: true };
  let data = { stations: [], recent: [], can: {} };
  let loadedAt = null;

  const draw = () => {
    const all = data.stations;
    const active = all.filter((s) => s.status === 'active');
    const chg = active.flatMap((s) => s.chargers);
    const nProblem = all.reduce((n, s) => n + problems(s), 0);
    const nFix = chg.filter((c) => c.status === 'maintenance').length;
    $('#mo-stats', page).innerHTML = `
      ${stat(t('Stations open'), active.length, 'pin', G.blue, { suffix: `<small>/${all.length}</small>`, sub: t('{n} coming soon', { n: all.filter((s) => s.status === 'coming_soon').length }) })}
      ${stat(t('Chargers working'), chg.filter((c) => c.status === 'ok').length, 'zap', G.green, { suffix: `<small>/${chg.length}</small>`, sub: t('At open stations') })}
      ${stat(t('Problems'), nProblem, 'alert', G.red, { bad: nProblem > 0, sub: nProblem ? t('Needs follow-up') : t('Everything is working 🎉') })}
      ${stat(t('Under repair'), nFix, 'edit', G.amber, { sub: t('Being fixed now') })}`;
    runCountUps($('#mo-stats', page));
    $('#mo-pc', page).textContent = all.filter((s) => problems(s)).length || '';

    const q = st.q.toLowerCase();
    const list = all.filter((s) => (st.f === 'all' || problems(s)) && (!q || `${s.name} ${s.address}`.toLowerCase().includes(q)));
    if (st.first) { all.filter((s) => problems(s)).forEach((s) => st.open.add(s.id)); st.first = false; }
    $('#mo-list', page).innerHTML = list.length ? `<div class="srow shead"><span>${t('Station')}</span><span>${t('Status')}</span><span>${t('Chargers')}</span></div>` + list.map((s) => {
      const i = all.indexOf(s);
      const ok = working(s), n = s.chargers.length, bad = problems(s);
      const open = st.open.has(s.id);
      return `<div class="station ${open ? 'open' : ''} ${bad ? 'has-problem' : ''}" data-sid="${s.id}">
        <button class="srow" data-toggle aria-expanded="${open}">
          <span class="who"><span class="st-av" style="--c:${SWATCH[i % SWATCH.length]}">PE</span><span style="min-width:0"><b>${esc(s.name)}</b><small>${esc(s.address)}</small></span></span>
          <span data-l="${t('Status')}">${pill(STATION[s.status])}${bad ? ` <span class="status-pill" style="--sc:#ef4444">${t('{n} problems', { n: bad })}</span>` : ''}</span>
          <span class="st-count" data-l="${t('Chargers')}"><b>${ok}/${n}</b><span class="bar"><i style="width:${n ? Math.round((ok / n) * 100) : 0}%;background:${bad ? '#f59e0b' : '#10b981'}"></i></span>${icon('right', 'icon chev')}</span>
        </button>
        ${open ? `<div class="chg-grid">${s.chargers.map(chargerTile).join('')}
          ${data.can.manage ? `<button class="chg add" data-addc="${s.id}">${icon('plus')}<b>${t('Add charger')}</b></button><button class="chg add" data-edits="${s.id}">${icon('edit')}<b>${t('Edit station')}</b></button>` : ''}</div>` : ''}
      </div>`;
    }).join('') : emptyState(st.f === 'problem' ? t('No problems — every charger is working') : t('No stations yet'), st.f === 'problem' ? 'checkCircle' : 'zap');

    $('#mo-recent', page).innerHTML = data.recent.length ? data.recent.map((l) => `<div class="mon-log" data-cid="${l.charger_id}">
        <span class="dot" style="background:${CHARGER[l.to_status].color}"></span>
        <div style="min-width:0;flex:1"><b>${esc(l.station_name.replace(/^Panda EV\s*—\s*/, ''))} · ${esc(l.charger_code)}</b> <span class="status-pill" style="--sc:${CHARGER[l.to_status].color}">${CHARGER[l.to_status].label}</span>
        ${l.note ? `<small class="note">${esc(l.note)}</small>` : ''}<small class="muted">${esc(l.user_name || '')} · ${timeAgo(l.created_at)}</small></div></div>`).join('')
      : `<div class="muted" style="font-size:.9rem">${t('No updates yet')}</div>`;
    $('#mo-upd', page).textContent = loadedAt ? t('Updated {t}', { t: loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : '';
  };
  const load = async () => { data = await api('/api/monitor'); loadedAt = new Date(); draw(); };
  const findCharger = (id) => { for (const s of data.stations) { const c = s.chargers.find((x) => x.id === id); if (c) return [c, s]; } return []; };

  segmented($('#mo-f', page), (v) => { st.f = v; draw(); });
  $('#mo-q', page).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); draw(); }, 150));
  $('#mo-add', page)?.addEventListener('click', () => stationForm(null, load));
  page.addEventListener('click', async (e) => {
    const tog = e.target.closest('[data-toggle]');
    if (tog) { const id = Number(tog.closest('[data-sid]').dataset.sid); if (st.open.has(id)) st.open.delete(id); else st.open.add(id); return draw(); }
    const c = e.target.closest('[data-cid]');
    if (c) { const [ch, s] = findCharger(Number(c.dataset.cid)); if (ch) chargerModal(ch, s, data.can, load); return; }
    const ad = e.target.closest('[data-addc]');
    if (ad) {
      try { await api(`/api/stations/${ad.dataset.addc}/chargers`, { method: 'POST', body: {} }); toast(t('Charger added'), 'ok'); await load(); } catch (err) { toastErr(err); }
      return;
    }
    const ed = e.target.closest('[data-edits]');
    if (ed) stationForm(data.stations.find((s) => s.id === Number(ed.dataset.edits)), load);
  });

  await load();
  // Everyone updates the same board: refresh it every 30 s while nothing is open on top
  const timer = setInterval(() => { if (!document.hidden && !$('.overlay')) load().catch(() => {}); }, 30_000);
  const on = () => load().catch(() => {});
  window.addEventListener('tw:changed', on);
  return () => { clearInterval(timer); window.removeEventListener('tw:changed', on); };
}

function chargerTile(c) {
  const s = CHARGER[c.status];
  return `<button class="chg ${c.status}" data-cid="${c.id}" style="--sc:${s.color}" title="${esc(c.note || s.label)}">
    <span class="chg-top">${icon('zap')}<b>${esc(c.code)}</b>${c.task_id && c.task_status !== 'done' ? `<span class="chg-task" title="${t('Repair task')}">${icon('kanban')}</span>` : ''}</span>
    <span class="chg-st">${s.label}</span>
    ${c.note ? `<small class="note">${esc(c.note)}</small>` : c.model ? `<small class="muted">${esc(c.model)}</small>` : ''}
  </button>`;
}

async function chargerModal(c, station, can, reload) {
  const m = openModal(`
    <div class="modal-head"><h2>${icon('zap')} ${esc(station.name)} · ${esc(c.code)}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    <form id="cg">
      <div class="field"><label>${t('Charger status')}</label>
        <div class="chg-pick">${Object.entries(CHARGER).map(([k, v]) => `<label class="chg-opt" style="--sc:${v.color}"><input type="radio" name="status" value="${k}" ${k === c.status ? 'checked' : ''}><span class="dot"></span>${v.label}</label>`).join('')}</div></div>
      <div class="field"><label for="cg-note">${t('What is the problem? / what was done')}</label>
        <textarea class="input" id="cg-note" name="note" rows="3" maxlength="500" placeholder="${t('e.g. screen is black, cable damaged, not charging…')}">${esc(c.note)}</textarea></div>
      ${can.manage ? `<div class="row"><div class="field"><label>${t('Charger name')}</label><input class="input" name="code" value="${esc(c.code)}" maxlength="40" required></div>
        <div class="field"><label>${t('Model / power')}</label><input class="input" name="model" value="${esc(c.model)}" maxlength="80" placeholder="${t('e.g. DC 120 kW')}"></div></div>` : ''}
      <p class="hint">${c.updated_by_name ? t('Last update by {name} · {time}', { name: esc(c.updated_by_name), time: fmtDateTime(c.updated_at) }) : t('Last update {time}', { time: fmtDateTime(c.updated_at) })}</p>
      <div class="error-text" id="cg-err"></div>
      <div class="modal-foot" style="justify-content:space-between">
        <div>${can.manage ? `<button type="button" class="btn btn-danger btn-sm" id="cg-del">${icon('trash')} ${t('Delete charger')}</button>` : ''}</div>
        <div class="flex wrap"><button type="button" class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" type="submit">${icon('check')} ${t('Save')}</button></div>
      </div>
    </form>
    <div class="section"><h3>${icon('kanban')} ${t('Repair task')}</h3><div id="cg-task">${taskBox(c)}</div></div>
    <div class="section"><h3>${icon('clock')} ${t('History')}</h3><div id="cg-log" class="mon-recent"><div class="skeleton" style="min-height:60px"></div></div></div>`);
  const form = $('#cg', m.el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { status: form.status.value, note: form.note.value };
    if (can.manage) Object.assign(body, { code: form.code.value, model: form.model.value });
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try { await api(`/api/chargers/${c.id}`, { method: 'PATCH', body }); toast(t('Charger status saved'), 'ok'); m.close(); reload(); }
    catch (err) { $('#cg-err', m.el).textContent = err.message; btn.disabled = false; }
  });
  $('#cg-del', m.el)?.addEventListener('click', async () => {
    if (!(await confirmDialog(t('Delete charger'), t('Delete charger {name} and its history?', { name: c.code }), { ok: t('Delete charger'), danger: true }))) return;
    try { await api(`/api/chargers/${c.id}`, { method: 'DELETE' }); toast(t('Charger deleted'), 'ok'); m.close(); reload(); } catch (err) { toastErr(err); }
  });
  $('#cg-task', m.el).addEventListener('click', async (e) => {
    if (e.target.closest('[data-open-task]')) { m.close(); return openTask(c.task_id); }
    if (!e.target.closest('[data-new-task]')) return;
    try {
      // Save what was typed first so the task description has the latest note
      const status = form.status.value === 'ok' ? 'fault' : form.status.value;
      await api(`/api/chargers/${c.id}`, { method: 'PATCH', body: { status, note: form.note.value } });
      const updated = await api(`/api/chargers/${c.id}/task`, { method: 'POST', body: { title: t('Fix charger {code} — {station}', { code: c.code, station: station.name }) } });
      Object.assign(c, updated);
      toast(t('Repair task created for the IT team'), 'ok');
      $('#cg-task', m.el).innerHTML = taskBox(c);
      reload();
    } catch (err) { toastErr(err); }
  });
  try {
    const logs = await api(`/api/chargers/${c.id}/logs`);
    $('#cg-log', m.el).innerHTML = logs.length ? logs.map((l) => `<div class="mon-log"><span class="dot" style="background:${CHARGER[l.to_status].color}"></span>
      <div style="min-width:0;flex:1"><b>${l.from_status ? `${CHARGER[l.from_status]?.label || ''} → ` : ''}${CHARGER[l.to_status].label}</b>${l.note ? `<small class="note">${esc(l.note)}</small>` : ''}
      <small class="muted">${esc(l.user_name || '')} · ${fmtDateTime(l.created_at)}</small></div></div>`).join('') : `<div class="muted" style="font-size:.9rem">${t('No updates yet')}</div>`;
  } catch (err) { $('#cg-log', m.el).innerHTML = `<div class="error-text">${esc(err.message)}</div>`; }
}

function taskBox(c) {
  if (c.task_id && c.task_status) {
    return `<button class="btn" data-open-task>${icon('kanban')} ${esc(c.task_title)} <span class="status-pill" style="--sc:var(--s-${c.task_status})">${STATUS_LABEL[c.task_status]}</span></button>
      ${c.task_status === 'done' ? `<button class="btn btn-sm" data-new-task style="margin-left:6px">${icon('plus')} ${t('New repair task')}</button>` : ''}`;
  }
  return `<button class="btn" data-new-task>${icon('plus')} ${t('Create repair task for IT')}</button>
    <p class="hint" style="margin-top:6px">${t('Creates a task in the IT department so the fix can be assigned and tracked. You are added as a coworker to follow it.')}</p>`;
}

function stationForm(s, reload) {
  const isNew = !s;
  const m = openModal(`
    <div class="modal-head"><h2>${icon(isNew ? 'plus' : 'edit')} ${isNew ? t('Add station') : t('Edit station')}</h2><button class="btn btn-icon btn-ghost" data-close aria-label="${t('Close')}">${icon('x')}</button></div>
    <form id="sf">
      <div class="field"><label for="sf-name">${t('Station name')} *</label><input class="input" id="sf-name" name="name" required maxlength="160" value="${esc(s?.name || 'Panda EV — ')}"></div>
      <div class="field"><label for="sf-addr">${t('Address')}</label><input class="input" id="sf-addr" name="address" maxlength="300" value="${esc(s?.address || '')}"></div>
      <div class="row">
        <div class="field"><label>${t('Status')}</label><select class="input" name="status">${Object.entries(STATION).map(([k, v]) => `<option value="${k}" ${k === (s?.status || 'active') ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
        ${isNew ? `<div class="field"><label>${t('Number of chargers')}</label><input class="input" type="number" name="chargers" min="0" max="50" value="4"></div>` : ''}
      </div>
      <div class="error-text" id="sf-err"></div>
      <div class="modal-foot" style="justify-content:space-between">
        <div>${!isNew ? `<button type="button" class="btn btn-danger btn-sm" id="sf-del">${icon('trash')} ${t('Delete station')}</button>` : ''}</div>
        <div class="flex wrap"><button type="button" class="btn" data-close>${t('Cancel')}</button><button class="btn btn-primary" type="submit">${icon('check')} ${t('Save')}</button></div>
      </div>
    </form>`);
  const form = $('#sf', m.el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: form.name.value, address: form.address.value, status: form.status.value };
    if (isNew) body.chargers = Number(form.chargers.value);
    try {
      await api(isNew ? '/api/stations' : `/api/stations/${s.id}`, { method: isNew ? 'POST' : 'PATCH', body });
      toast(isNew ? t('Station added') : t('Station saved'), 'ok'); m.close(); reload();
    } catch (err) { $('#sf-err', m.el).textContent = err.message; }
  });
  $('#sf-del', m.el)?.addEventListener('click', async () => {
    if (!(await confirmDialog(t('Delete station'), t('Delete {name} with all its chargers and history?', { name: s.name }), { ok: t('Delete station'), danger: true }))) return;
    try { await api(`/api/stations/${s.id}`, { method: 'DELETE' }); toast(t('Station deleted'), 'ok'); m.close(); reload(); } catch (err) { toastErr(err); }
  });
}
