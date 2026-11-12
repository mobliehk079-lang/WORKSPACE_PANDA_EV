// Animated SVG charts (lines draw in / bars grow) with hover tooltips
import { esc, showTip, hideTip, countUp, t } from './utils.js';

const NS = 'http://www.w3.org/2000/svg';
const niceMax = (v) => { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
const tipHtml = (title, rows) => `<div class="tt-h">${esc(title)}</div>${rows.map((r) => `<div class="tt-r"><i style="--c:${r.color}"></i>${esc(r.name)}<b>${r.value}</b></div>`).join('')}`;

/** โดนัท: segments = [{label, value, color}] */
export function donut(el, segments, { centerLabel = t('All tasks') } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 70, C = 2 * Math.PI * r, gap = total ? 3 : 0;
  let off = 0;
  const circles = segments.map((s) => {
    const len = total ? (s.value / total) * C : 0;
    const c = `<circle class="seg" r="${r}" cx="90" cy="90" stroke="${s.color}" stroke-dasharray="0 ${C}" data-len="${Math.max(0, len - gap)}" stroke-dashoffset="${-off}" data-label="${esc(s.label)}" data-v="${s.value}"></circle>`;
    off += len; return c;
  }).join('');
  el.innerHTML = `<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 180 180"><circle r="${r}" cx="90" cy="90" fill="none" stroke="var(--hairline)" stroke-width="22"></circle>${circles}</svg>
    <div class="center"><div><b data-n>0</b><small>${esc(centerLabel)}</small></div></div></div>
    <div class="dlegend">${segments.map((s) => `<div><i style="--c:${s.color}"></i>${esc(s.label)}<b>${s.value}</b></div>`).join('')}</div></div>`;
  countUp(el.querySelector('[data-n]'), total);
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('circle.seg').forEach((c) => c.setAttribute('stroke-dasharray', `${c.dataset.len} ${C}`))));
  el.querySelectorAll('circle.seg').forEach((c) => {
    c.addEventListener('mousemove', (e) => showTip(tipHtml(c.dataset.label, [{ name: t('Count'), value: `${c.dataset.v} (${total ? Math.round((c.dataset.v / total) * 100) : 0}%)`, color: c.getAttribute('stroke') }]), e.clientX, e.clientY));
    c.addEventListener('mouseleave', hideTip);
  });
}

function frame(el, height) {
  const W = Math.max(280, el.clientWidth || 600), H = height;
  const m = { t: 16, r: 12, b: 30, l: 34 };
  return { W, H, m, iw: W - m.l - m.r, ih: H - m.t - m.b };
}
function axes(g, { m, iw, ih }, max, labels, xAt) {
  let s = '';
  const n = [4, 5, 2].find((k) => Number.isInteger(max / k)) || 4;
  for (let i = 0; i <= n; i++) {
    const v = (max / n) * i, y = m.t + ih - (v / max) * ih;
    s += `<line class="gridline" x1="${m.l}" x2="${m.l + iw}" y1="${y}" y2="${y}"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end">${Math.round(v)}</text>`;
  }
  s += `<line class="baseline" x1="${m.l}" x2="${m.l + iw}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
  const step = Math.ceil(labels.length / Math.max(1, Math.floor(iw / 64)));
  labels.forEach((l, i) => { if (i % step === 0) s += `<text x="${xAt(i)}" y="${m.t + ih + 20}" text-anchor="middle">${esc(l)}</text>`; });
  g.innerHTML = s;
}

/** แท่ง (stacked หรือ grouped): {labels, series:[{name,color,values}]} */
export function barChart(el, { labels, series, stacked = true, height = 240, unit = '' }) {
  const f = frame(el, height);
  const { W, H, m, iw, ih } = f;
  const totals = labels.map((_, i) => stacked ? series.reduce((s, x) => s + x.values[i], 0) : Math.max(...series.map((x) => x.values[i])));
  const max = niceMax(Math.max(1, ...totals));
  const band = iw / labels.length;
  const groupW = Math.min(band * 0.62, stacked ? 42 : 22 * series.length);
  const xAt = (i) => m.l + band * i + band / 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const ax = document.createElementNS(NS, 'g'); ax.setAttribute('class', 'axis'); svg.appendChild(ax);
  axes(ax, f, max, labels, xAt);
  let marks = '';
  labels.forEach((_, i) => {
    let acc = 0;
    series.forEach((s, k) => {
      const v = s.values[i]; if (!v) return;
      const hgt = (v / max) * ih;
      let x, y, w;
      if (stacked) { w = groupW; x = xAt(i) - w / 2; y = m.t + ih - ((acc + v) / max) * ih; acc += v; }
      else { w = groupW / series.length - 2; x = xAt(i) - groupW / 2 + k * (w + 2); y = m.t + ih - hgt; }
      const gap = stacked && acc > v ? 2 : 0; // ช่องว่าง 2px ระหว่างชั้น
      const isTop = !stacked || series.slice(k + 1).every((x2) => !x2.values[i]);
      const rx = isTop ? Math.min(4, w / 2) : 0;
      const hh = Math.max(0, hgt - gap);
      // มุมโค้งเฉพาะปลายบน
      const d = rx ? `M${x},${y + hh}V${y + rx}Q${x},${y} ${x + rx},${y}H${x + w - rx}Q${x + w},${y} ${x + w},${y + rx}V${y + hh}Z` : `M${x},${y}h${w}v${hh}h${-w}Z`;
      marks += `<path class="mark grow-y" d="${d}" fill="${s.color}" style="animation-delay:${i * 50}ms"/>`;
    });
  });
  // แถบรับเมาส์ (ใหญ่กว่าแท่ง)
  labels.forEach((l, i) => { marks += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`; });
  // ป้ายผลรวมเฉพาะแท่งสูงสุด
  const mi = totals.indexOf(Math.max(...totals));
  if (totals[mi] > 0) marks += `<text class="lbl" x="${xAt(mi)}" y="${m.t + ih - (totals[mi] / max) * ih - 6}" text-anchor="middle">${totals[mi]}${unit}</text>`;
  const g = document.createElementNS(NS, 'g'); g.innerHTML = marks; svg.appendChild(g);
  el.innerHTML = `<div class="chart"></div>`;
  el.firstChild.appendChild(svg);
  svg.querySelectorAll('.hit').forEach((r) => {
    r.addEventListener('mousemove', (e) => { const i = +r.dataset.i; showTip(tipHtml(labels[i], series.map((s) => ({ name: s.name, value: s.values[i] + unit, color: s.color })).concat(stacked && series.length > 1 ? [{ name: t('Total'), value: totals[i] + unit, color: 'transparent' }] : [])), e.clientX, e.clientY); });
    r.addEventListener('mouseleave', hideTip);
  });
}

/** เส้น + พื้นที่ใต้เส้น พร้อม crosshair */
export function lineChart(el, { labels, series, height = 240 }) {
  const f = frame(el, height);
  const { W, H, m, iw, ih } = f;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const xAt = (i) => m.l + (labels.length === 1 ? iw / 2 : (iw * i) / (labels.length - 1));
  const yAt = (v) => m.t + ih - (v / max) * ih;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const ax = document.createElementNS(NS, 'g'); ax.setAttribute('class', 'axis'); svg.appendChild(ax);
  axes(ax, f, max, labels, xAt);
  let s = '<defs>';
  series.forEach((sr, k) => { s += `<linearGradient id="lg${k}-${el.id || ''}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sr.color}" stop-opacity=".28"/><stop offset="1" stop-color="${sr.color}" stop-opacity="0"/></linearGradient>`; });
  s += '</defs>';
  series.forEach((sr, k) => {
    const pts = sr.values.map((v, i) => [xAt(i), yAt(v)]);
    const path = pts.map((p, i) => {
      if (!i) return `M${p[0]},${p[1]}`;
      const [x0, y0] = pts[i - 1]; const cx = (x0 + p[0]) / 2;
      return `C${cx},${y0} ${cx},${p[1]} ${p[0]},${p[1]}`;
    }).join('');
    if (k === 0 || series.length === 1) s += `<path class="area" d="${path}L${xAt(labels.length - 1)},${m.t + ih}L${xAt(0)},${m.t + ih}Z" fill="url(#lg${k}-${el.id || ''})"/>`;
    s += `<path class="line draw" d="${path}" stroke="${sr.color}" style="animation-delay:${k * 200}ms"/>`;
    pts.forEach((p, i) => { s += `<circle class="dot-m" cx="${p[0]}" cy="${p[1]}" r="4" fill="${sr.color}" style="animation-delay:${900 + i * 60}ms"/>`; });
    const last = pts[pts.length - 1];
    if (series.length > 1 && last) s += `<text class="lbl" x="${last[0] - 4}" y="${last[1] - 10}" text-anchor="end">${esc(sr.name)}</text>`;
  });
  s += `<line class="crosshair" y1="${m.t}" y2="${m.t + ih}"/>`;
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;
  const g = document.createElementNS(NS, 'g'); g.innerHTML = s; svg.appendChild(g);
  el.innerHTML = `<div class="chart"></div>`;
  el.firstChild.appendChild(svg);
  svg.querySelectorAll('path.line').forEach((p) => { const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
  const hit = svg.querySelector('.hit'), ch = svg.querySelector('.crosshair');
  hit.addEventListener('mousemove', (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(((loc.x - m.l) / iw) * (labels.length - 1))));
    ch.setAttribute('x1', xAt(i)); ch.setAttribute('x2', xAt(i)); ch.style.opacity = 1;
    showTip(tipHtml(labels[i], series.map((sr) => ({ name: sr.name, value: sr.values[i], color: sr.color }))), e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', () => { ch.style.opacity = 0; hideTip(); });
}

/** แท่งแนวนอน (เปรียบเทียบแผนก/คน) rows=[{label, value, color, sub}] */
export function hbars(el, rows, { unit = '', max } = {}) {
  const mx = max || Math.max(1, ...rows.map((r) => r.value));
  el.innerHTML = `<div class="list">${rows.map((r, i) => `<div class="mini-bar" style="gap:12px">
    <span style="width:110px;flex:none;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.label)}</span>
    <div class="bar" style="height:12px"><i data-w="${(r.value / mx) * 100}" style="background:${r.color};transition-delay:${i * 80}ms"></i></div>
    <b style="width:52px;text-align:right;font-variant-numeric:tabular-nums">${r.value}${unit}</b></div>`).join('')}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('[data-w]').forEach((x) => { x.style.width = x.dataset.w + '%'; })));
}
