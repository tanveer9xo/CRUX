// DOM helpers. Text always goes in as text nodes (never innerHTML), so names and notes can't inject markup.
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

// Icons: 24×24 stroke paths drawn for CRUX.
const PATHS = {
  home: ['M4 11l8-7 8 7', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  chart: ['M4 20h16', 'M7 16v-5', 'M12 16V7', 'M17 16v-8'],
  plan: ['M5 4h14v16H5z', 'M9 9h6', 'M9 13h6', 'M9 17h3'],
  gear: ['M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  left: ['M15 6l-6 6 6 6'],
  right: ['M9 6l6 6-6 6'],
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12l5 5L20 7'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M5 7l1 13h12l1-13', 'M9 7V4h6v3'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13z', 'M20 20l-4.8-4.8'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  archive: ['M4 5h16v4H4z', 'M6 9v10h12V9', 'M10 13h4'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13 7l4 4'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z'],
  alert: ['M12 4L2.5 20h19z', 'M12 10v4', 'M12 17h.01'],
};

const NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = 'ic') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of PATHS[name] ?? []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Category badge: the emoji on a tint of the category colour. */
export function badge(cat, cls = 'badge') {
  return h('span', { class: cls, style: { '--c': cat?.color ?? '#7C8796' }, 'aria-hidden': 'true' }, cat?.emoji || '•');
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

/** A progress bar whose colour follows the budget state; the state is also spoken and written. */
export function bar(status, pct, color) {
  const w = Math.max(0, Math.min(100, pct ?? (status === 'over' ? 100 : 0)));
  return h('div', { class: `bar bar-${status}`, style: color ? { '--c': color } : undefined },
    h('div', { class: 'bar-fill', style: { width: `${w}%` } }));
}

export const statusText = { ok: '', warn: 'Nearly used', over: 'Over budget' };
