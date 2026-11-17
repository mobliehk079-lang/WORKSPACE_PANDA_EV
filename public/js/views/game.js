// Minigame: party card game — tap to draw from a shuffled 52-card deck (players agree on what each card means).
// Hidden behind a passcode (checked by the server); the deck survives a page refresh in this tab.
import { api, $, icon, setTitle, toast, t } from '../utils.js';

const SUITS = [['♠', 'black'], ['♥', 'red'], ['♦', 'red'], ['♣', 'black']];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const OK_KEY = 'pev-game-ok', DECK_KEY = 'pev-game-deck';
const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* */ } },
  del: (k) => { try { sessionStorage.removeItem(k); } catch { /* */ } },
};

const cardOf = (id) => { const rank = RANKS[id % 13]; const [suit, color] = SUITS[Math.floor(id / 13)]; return { id, rank, suit, color }; };
function shuffled() {
  const d = [...Array(52).keys()];
  const r = crypto.getRandomValues(new Uint32Array(52));
  for (let i = d.length - 1; i > 0; i--) { const j = r[i] % (i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function loadDeck() {
  try {
    const s = JSON.parse(store.get(DECK_KEY));
    if (Array.isArray(s.deck) && s.deck.length === 52 && Number.isInteger(s.pos) && s.pos >= 0 && s.pos <= 52) return s;
  } catch { /* */ }
  return { deck: shuffled(), pos: 0 };
}

function faceHtml(c) {
  const corner = `<span class="r">${c.rank}</span><span class="s">${c.suit}</span>`;
  const center = ['J', 'Q', 'K'].includes(c.rank)
    ? `<div class="pc-royal"><b>${c.rank}</b><span>${c.suit}</span></div>`
    : `<div class="pc-pip">${c.suit}</div>`;
  return `<div class="pc-face pc-front ${c.color}"><div class="pc-corner tl">${corner}</div>${center}<div class="pc-corner br">${corner}</div></div>`;
}
const backHtml = () => `<div class="pc-face pc-back"><div class="pc-back-in">${icon('cards')}<b>PANDA EV</b></div></div>`;

export async function renderGame(page) {
  setTitle(t('Minigame'), t('Party card game'));
  let cleanup = null;
  // Switch between the passcode screen and the game (after unlocking / pressing Lock)
  const show = () => {
    cleanup?.(); page.replaceChildren();
    cleanup = store.get(OK_KEY) === '1' ? gameScreen(page, show) : lockScreen(page, show);
  };
  show();
  return () => cleanup?.();
}

function lockScreen(page, show) {
  page.innerHTML = `<div class="game-lock glass card">
    <div class="game-lock-ic">${icon('cards')}</div>
    <h2>${t('Minigame')}</h2>
    <p class="muted">${t('Enter the 8-digit passcode to open the game')}</p>
    <form id="g-unlock" autocomplete="off">
      <input class="input game-code" name="code" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" required aria-label="${t('Passcode')}" placeholder="••••••••">
      <div class="error-text" id="g-err"></div>
      <button class="btn btn-primary btn-block">${icon('lock')} ${t('Unlock')}</button>
    </form></div>`;
  const f = $('#g-unlock', page);
  f.code.addEventListener('input', () => { f.code.value = f.code.value.replace(/\D/g, '').slice(0, 8); });
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) f.code.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', f); btn.disabled = true; $('#g-err', page).textContent = '';
    try {
      await api('/api/minigame/unlock', { method: 'POST', body: { code: f.code.value } });
      store.set(OK_KEY, '1');
      show();
    } catch (err) {
      $('#g-err', page).textContent = err.message; btn.disabled = false; f.code.select();
      f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
    }
  });
  return null;
}

function gameScreen(page, show) {
  let st = loadDeck();
  const save = () => store.set(DECK_KEY, JSON.stringify(st));
  save();
  page.innerHTML = `<div class="game" id="g-wrap">
    <div class="toolbar game-bar">
      <div class="game-count"><b id="g-left"></b><small>/ 52 ${t('cards left')}</small></div>
      <div class="spacer"></div>
      <button class="btn btn-sm" id="g-new">${icon('shuffle')}<span class="hide-sm">${t('New deck')}</span></button>
      <button class="btn btn-sm btn-icon" id="g-full" aria-label="${t('Full screen')}" title="${t('Full screen')}">${icon('maximize')}</button>
      <button class="btn btn-sm btn-icon" id="g-lock" aria-label="${t('Lock')}" title="${t('Lock')}">${icon('lock')}</button>
    </div>
    <button class="game-stage" id="g-stage" aria-label="${t('Tap to draw a card')}">
      <div class="pc-slot" id="g-card"></div>
      <div class="game-rule" id="g-rule" aria-live="polite"></div>
    </button>
    <div class="game-history" id="g-hist"></div>
  </div>`;
  const wrap = $('#g-wrap', page);

  function drawStatus() {
    $('#g-left', page).textContent = 52 - st.pos;
    const hist = st.deck.slice(Math.max(0, st.pos - 14), st.pos).reverse().map(cardOf);
    $('#g-hist', page).innerHTML = hist.map((c, i) => `<span class="mini ${c.color} ${i === 0 ? 'now' : ''}">${c.rank}<i>${c.suit}</i></span>`).join('');
  }
  function showCurrent(animate) {
    const slot = $('#g-card', page), rule = $('#g-rule', page);
    if (!st.pos) {
      slot.innerHTML = `<div class="pc idle"><div class="pc-in">${backHtml()}</div></div>`;
      rule.innerHTML = `<div class="game-hint">${icon('cards')} ${t('Tap anywhere to draw a card')}</div>`;
      return drawStatus();
    }
    const c = cardOf(st.deck[st.pos - 1]);
    slot.innerHTML = `<div class="pc ${animate ? 'deal' : ''}"><div class="pc-in">${faceHtml(c)}${backHtml()}</div></div>`;
    rule.innerHTML = st.pos === 52 ? `<div class="game-hint">${t('That was the last card. Tap for a new deck')}</div>` : '';
    drawStatus();
  }
  let busy = false;
  function draw() {
    if (busy) return;
    if (st.pos >= 52) { st = { deck: shuffled(), pos: 0 }; save(); toast(t('New deck shuffled'), 'ok'); return showCurrent(false); }
    busy = true; setTimeout(() => { busy = false; }, 450);
    st.pos++; save();
    showCurrent(true);
    navigator.vibrate?.(15);
  }

  $('#g-stage', page).addEventListener('click', draw);
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || $('.overlay')) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); draw(); }
  };
  document.addEventListener('keydown', onKey);
  $('#g-new', page).addEventListener('click', () => { st = { deck: shuffled(), pos: 0 }; save(); showCurrent(false); toast(t('New deck shuffled'), 'ok'); });
  $('#g-full', page).addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrap.requestFullscreen?.().catch(() => toast(t('Full screen is not available on this device'), 'info'));
  });
  $('#g-lock', page).addEventListener('click', () => { store.del(OK_KEY); show(); });
  showCurrent(false);
  return () => { document.removeEventListener('keydown', onKey); if (document.fullscreenElement) document.exitFullscreen?.(); };
}
