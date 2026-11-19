// Full-screen slides (← → / click / swipe, Esc to close), shared by "Present" views.
// A slide never scrolls: when its items don't fit the screen it is split into several pages
// (re-measured when the screen size changes, e.g. on entering full screen).
//
// A spec is one logical slide: { total, page(k, n, a, b) } → html of page k of n showing items a..b-1;
// total = number of items that can be split across pages (0 = a single fixed page).
//
// Options: autoplay (ms per slide; adds a play/pause button + P key, loops), play (start playing), onClose().
// Returns { update(specs) } to swap in fresh content while staying on the same slide.
import { $, $$, icon, t } from './utils.js';

export function slideshow(specs, { autoplay = 0, play = false, onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'slides';
  el.innerHTML = `<div class="sl-stage"></div><div class="sl-prog"><i></i></div>
    <div class="sl-bar"><button class="btn btn-icon" data-a="prev" aria-label="${t('Previous')}">${icon('left')}</button><span class="sl-n"></span>
      <button class="btn btn-icon" data-a="next" aria-label="${t('Next')}">${icon('right')}</button><span class="spacer"></span>
      ${autoplay ? `<button class="btn btn-icon" data-a="play" aria-label="${t('Auto-play')}" title="${t('Auto-play')}"></button>` : ''}
      <button class="btn btn-icon" data-a="full" aria-label="${t('Full screen')}">${icon('maximize')}</button>
      <button class="btn btn-icon" data-a="close" aria-label="${t('Close')}">${icon('x')}</button></div>`;
  document.body.appendChild(el);
  document.body.classList.add('modal-open');
  const stage = $('.sl-stage', el);

  // Split a spec into pages that fit the stage without scrolling: as many items as fit on the
  // first page (it may also hold stat tiles), then the most items per page that fit every later page.
  const probe = document.createElement('section');
  probe.className = 'slide sl-probe';
  const fits = (html) => { probe.innerHTML = html; return probe.scrollHeight <= probe.clientHeight + 1; };
  const paginate = (spec) => {
    const total = spec.total;
    if (!total) return [spec.page(0, 1, 0, 0)];
    let first = total;
    while (first > 1 && !fits(spec.page(0, first < total ? 2 : 1, 0, first))) first--;
    if (first >= total) return [spec.page(0, 1, 0, total)];
    const left = total - first;
    let per = left;
    for (; per > 1; per--) {
      const n = 1 + Math.ceil(left / per);
      let ok = true;
      for (let k = 1; ok && k < n; k++) ok = fits(spec.page(k, n, first + (k - 1) * per, first + k * per));
      if (ok) break;
    }
    // per = 1 also covers a single item taller than the screen (that page may still scroll)
    const n = 1 + Math.ceil(left / per), out = [spec.page(0, n, 0, first)];
    for (let k = 1; k < n; k++) out.push(spec.page(k, n, first + (k - 1) * per, first + k * per));
    return out;
  };

  let slides = [], owner = [], i = 0, lastSize = '';
  const build = (force = false) => {
    const size = `${stage.clientWidth}x${stage.clientHeight}`;
    if (size === lastSize && !force) return;
    lastSize = size;
    // stay on the same slide (and page within it) after re-paginating or refreshing
    const cur = owner[i] ?? 0, sub = owner.length ? i - owner.indexOf(cur) : 0;
    stage.replaceChildren(probe);
    slides = []; owner = [];
    specs.forEach((sp, si) => { for (const h of paginate(sp)) { slides.push(h); owner.push(si); } });
    stage.innerHTML = slides.map((s, k) => `<section class="slide" data-i="${k}">${s}</section>`).join('');
    const start = owner.indexOf(Math.min(cur, specs.length - 1));
    const end = owner.lastIndexOf(owner[start]);
    show(Math.max(0, Math.min(start + Math.max(0, sub), end)), false);
  };

  // Auto-play: next slide every `autoplay` ms, looping; any manual move restarts the timer
  let playing = !!autoplay && play, pt = null;
  const prog = $('.sl-prog', el);
  const arm = () => {
    clearTimeout(pt);
    prog.classList.remove('run'); void prog.offsetWidth;
    if (!playing) return;
    prog.style.setProperty('--d', `${autoplay}ms`);
    prog.classList.add('run');
    pt = setTimeout(() => show(i + 1 >= slides.length ? 0 : i + 1), autoplay);
  };
  const drawPlay = () => { const b = $('[data-a="play"]', el); if (b) { b.innerHTML = icon(playing ? 'pause' : 'play'); b.classList.toggle('on', playing); } };
  const show = (n, rearm = true) => {
    i = Math.max(0, Math.min(slides.length - 1, n));
    $$('.slide', stage).forEach((s, k) => s.classList.toggle('on', k === i));
    $('.sl-n', el).textContent = `${i + 1} / ${slides.length}`;
    if (rearm) arm();
  };

  let rt = null;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(build, 150); };
  window.addEventListener('resize', onResize);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    clearTimeout(rt); clearTimeout(pt);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    el.remove();
    if (!$('.overlay')) document.body.classList.remove('modal-open');
    onClose?.();
  };
  const toggle = () => { playing = !playing; drawPlay(); arm(); };
  const onKey = (e) => {
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); show(i + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); show(i - 1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
    else if ((e.key === 'p' || e.key === 'P') && autoplay) toggle();
    else if (e.key === 'Escape' && !document.fullscreenElement) { e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'prev') show(i - 1);
    else if (a === 'next') show(i + 1);
    else if (a === 'play') toggle();
    else if (a === 'close') close();
    else if (a === 'full') (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.())?.catch?.(() => {});
  });
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
  drawPlay();
  build();
  arm();
  el.requestFullscreen?.().catch(() => {});

  return {
    update(next) { if (!el.isConnected) return; specs = next; build(true); },
    get open() { return el.isConnected; },
  };
}
