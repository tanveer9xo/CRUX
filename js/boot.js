// Runs before the first paint (a plain blocking script, so the CSP needs no inline script).
// 1. Refuse to run inside a frame: a <meta> CSP can't send frame-ancestors, so this stops clickjacking.
// 2. Show the splash until the first screen renders (js/app.js removes the class; the timeout is a safety net).
(function () {
  var root = document.documentElement;
  if (window.top !== window.self) {
    root.setAttribute('data-framed', '');
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* cross-origin frame: stay hidden */ }
    return;
  }
  root.classList.add('booting');
  setTimeout(function () { root.classList.remove('booting'); }, 6000);
})();
