import { clearToast } from './ui.js';

// Hash routing: #/, #/add, #/entry/<id>, #/history?m=&c=, #/insights?t=, #/plan?m=, #/settings.
// Hash routes need no server rewrites, so deep links work on GitHub Pages and offline.

const routes = new Map();
let current = null; // { path, params, query, key }
let renderedKey = null;
let lastPage = '#/';

export const register = (pattern, view) => routes.set(pattern, view);

export function parse(hash = location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  for (const [pattern, view] of routes) {
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
    const m = path.match(re);
    if (m) return { path, pattern, view, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])), query: new URLSearchParams(qs), key: `#${raw}` };
  }
  return null;
}

/**
 * Render the route now, in this call stack, then update the URL. Rendering synchronously keeps the tap's
 * user gesture alive, which iOS needs before it opens the keyboard for the amount field.
 */
export function go(hash, { replace = false } = {}) {
  const r = parse(hash);
  if (!r) return;
  show(r);
  if (replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) history.pushState(null, '', hash);
}

/** Back to the page the editor was opened from (or Home). */
export const goBack = () => go(lastPage, { replace: true });

/** Change query parameters of the current page without adding history (filters, month pickers). */
export function setQuery(updates) {
  const q = new URLSearchParams(current?.query);
  for (const [k, v] of Object.entries(updates)) (v == null || v === '' ? q.delete(k) : q.set(k, v));
  const qs = q.toString();
  go(`#${current.path}${qs ? `?${qs}` : ''}`, { replace: true });
}

export function refresh() {
  const main = document.getElementById('view');
  const y = window.scrollY;
  if (current) show(current, { keepScroll: true });
  window.scrollTo(0, y);
  return main;
}

function show(r, { keepScroll = false } = {}) {
  const main = document.getElementById('view');
  current = r;
  renderedKey = r.key;
  if (!r.view.isEditor) lastPage = r.key;
  if (r.view.isEditor) clearToast();
  main.replaceChildren(r.view.render(r));
  main.dataset.view = r.view.name;
  document.querySelectorAll('.tabbar [data-tab]').forEach((a) => {
    const on = a.dataset.tab === r.view.tab;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = r.view.title ? `${r.view.title} · CRUX` : 'CRUX';
  if (!keepScroll) window.scrollTo(0, 0);
  r.view.after?.(main, r);
}

export function start() {
  const onNav = () => {
    const r = parse() ?? parse('#/');
    if (r.key === renderedKey) return; // already on screen (go() rendered it first)
    show(r);
  };
  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);
  onNav();
}
