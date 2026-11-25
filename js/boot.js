// Runs before the first paint (a plain blocking script, so the CSP needs no inline script).
// 1. Refuse to run inside a frame: a <meta> CSP can't send frame-ancestors, so this stops clickjacking.
// 2. Apply the saved appearance (dark by default, light, or follow the system) so there is no flash of the wrong
//    theme. Keep in step with resolveTheme() in js/theme.js.
// 3. Show the splash until the first screen renders (js/app.js removes the class; the timeout is a safety net).
(function () {
  var root = document.documentElement;
  if (window.top !== window.self) {
    root.setAttribute('data-framed', '');
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* cross-origin frame: stay hidden */ }
    return;
  }
  var pref = 'dark';
  try { pref = localStorage.getItem('crux-theme') || 'dark'; } catch (e) { /* storage blocked */ }
  var light = pref === 'light' || (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  root.setAttribute('data-theme', light ? 'light' : 'dark');
  root.style.colorScheme = light ? 'light' : 'dark';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#F6F7F9' : '#0E1116');
  root.classList.add('booting');
  setTimeout(function () { root.classList.remove('booting'); }, 6000);
})();
