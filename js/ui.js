// DOM helpers. Text always goes in as text nodes (never innerHTML), so names and notes can't inject markup.
import { iconShapes } from './icons.js';
import { chipColors } from './color.js';
// No inline style attributes (the CSP forbids them): colours go through CSS custom properties via CSSOM.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Icons come from one registry (js/icons.js). Chips colour themselves for the current theme (js/color.js).
const NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = 'ic') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of iconShapes(name)) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

export function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

/** CSS variables for a chip in a given colour: a muted tint behind, the colour (contrast-adjusted) in front. */
export function chipStyle(color) {
  const { bg, fg } = chipColors(/^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color : '#8E97A6', currentTheme());
  return { '--chip-bg': bg, '--chip-fg': fg };
}

/** A category, goal or bill type as its icon in a rounded-square chip tinted with its colour. */
export function badge(item, cls = 'badge') {
  return h('span', { class: cls, style: chipStyle(item?.color), 'aria-hidden': 'true' }, icon(item?.icon || 'tag'));
}

/** A progress ring. pct may exceed 100 (over budget); the meter animates in from empty. */
export function ring(pct, status, { label, sub } = {}) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const meter = svgEl('circle', { class: 'meter', cx: 50, cy: 50, r: R, 'stroke-dasharray': C.toFixed(2), 'stroke-dashoffset': C.toFixed(2) });
  const target = C * (1 - Math.max(0, Math.min(100, pct ?? 0)) / 100);
  requestAnimationFrame(() => requestAnimationFrame(() => meter.setAttribute('stroke-dashoffset', target.toFixed(2))));
  return h('div', { class: `ring st-${status}`, role: 'img', 'aria-label': `${pct ?? 0}% of the budget used` },
    svgEl('svg', { viewBox: '0 0 100 100' }, svgEl('circle', { class: 'track', cx: 50, cy: 50, r: R }), meter),
    h('div', { class: 'ring-label', 'aria-hidden': 'true' }, h('span', { class: 'ring-pct num' }, label ?? `${pct ?? 0}%`), sub ? h('span', { class: 'ring-sub' }, sub) : null));
}

// ---- toasts (one at a time; an action button such as Undo keeps it up longer) ----
let toastTimer = null;
export function toast(message, { action, onAction, ms } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  clearTimeout(toastTimer);
  host.replaceChildren();
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, message),
    action && h('button', { class: 'toast-btn', type: 'button', onclick: () => { close(); onAction?.(); } }, action));
  const close = () => { clearTimeout(toastTimer); el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  host.append(el);
  toastTimer = setTimeout(close, ms ?? (action ? 7000 : 2600));
}

/** Remove any toast now (the Add/Edit screen pins Save where toasts appear). */
export function clearToast() {
  clearTimeout(toastTimer);
  document.getElementById('toasts')?.replaceChildren();
}

// ---- bottom sheets & confirm ----
/** Open a sheet. `build(close)` returns its content. Esc, the backdrop or close() dismiss it. */
export function sheet(title, build, { onClose } = {}) {
  const prevFocus = document.activeElement;
  const back = h('div', { class: 'sheet-back' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    back.classList.add('out');
    setTimeout(() => back.remove(), 180);
    prevFocus?.focus?.({ preventScroll: true });
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
    build(close));
  back.append(panel);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  requestAnimationFrame(() => (panel.querySelector('[autofocus]') ?? panel.querySelector('button, input, select'))?.focus({ preventScroll: true }));
  return close;
}

/** Ask before doing something that can't be taken back. Resolves true/false. */
export function confirmDialog({ title, body, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (v, close) => { answered = true; resolve(v); close(); };
    sheet(title, (close) => h('div', { class: 'sheet-body' },
      ...(Array.isArray(body) ? body : [body]).map((p) => h('p', { class: 'muted' }, p)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: () => answer(false, close) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', autofocus: true, onclick: () => answer(true, close) }, ok))),
    { onClose: () => { if (!answered) resolve(false); } });
  });
}

/** A progress bar whose colour follows the budget state (the state is also written beside it). Animates in. */
export function bar(status, pct) {
  const w = Math.max(0, Math.min(100, pct ?? (status === 'over' ? 100 : 0)));
  const fill = h('div', { class: 'bar-fill' });
  requestAnimationFrame(() => requestAnimationFrame(() => fill.style.setProperty('width', `${w}%`)));
  return h('div', { class: `bar bar-${status}` }, fill);
}

export const statusText = { ok: '', warn: 'Nearly used', over: 'Over budget' };
