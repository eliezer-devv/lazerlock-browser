// ---------- messages ----------
let toastTimer;
function say(text, error = false) {
  // (Problems shown here also go in the app's log, inside the app.)
  if (error) { try { window.WLBAdmin && WLBAdmin.log && WLBAdmin.log(String(text)); } catch {} }
  const t = $('toast');
  t.textContent = text; t.className = error ? 'error' : ''; t.hidden = false;
  t.style.transform = ''; t.style.opacity = ''; t.style.transition = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, error ? 9000 : 3500);
}
$('toast').onclick = () => { $('toast').hidden = true; };
// Write a line to the app's log (inside the admin app) WITHOUT showing the user a toast. Used to record what the
// saving pipeline is doing — failures (with GitHub's status), conflicts, merges and retries — so the exported log
// explains a save problem on its own, instead of only flashing "Not saved" on screen.
function appLog(text) { try { if (window.WLBAdmin && WLBAdmin.log) WLBAdmin.log(String(text)); } catch {} }
// The page's own unexpected errors: in the app's log (inside the app), and the browser's console.
window.addEventListener('error', e => { try { window.WLBAdmin && WLBAdmin.log && WLBAdmin.log(`Script error: ${e.message} (line ${e.lineno})`); } catch {} });
window.addEventListener('unhandledrejection', e => { try { window.WLBAdmin && WLBAdmin.log && WLBAdmin.log(`Script error: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`); } catch {} });
// Swiped to the side: it goes (a short drag springs back). It follows the finger, fading as it goes.
(() => {
  const t = $('toast');
  let x0 = null, dx = 0, moved = false;
  t.style.touchAction = 'pan-y';
  t.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; moved = false; t.style.transition = 'none'; t.setPointerCapture(e.pointerId); });
  t.addEventListener('pointermove', e => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 4) moved = true;
    t.style.transform = `translateX(calc(-50% + ${dx}px))`;
    t.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / 220));
  });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    t.style.transition = 'transform .18s ease, opacity .18s ease';
    if (Math.abs(dx) > 70) {
      t.style.transform = `translateX(calc(-50% + ${dx > 0 ? 600 : -600}px))`; t.style.opacity = '0';
      clearTimeout(toastTimer);
      setTimeout(() => { t.hidden = true; t.style.transform = ''; t.style.opacity = ''; t.style.transition = ''; }, 190);
    } else { t.style.transform = ''; t.style.opacity = ''; }
  };
  t.addEventListener('pointerup', end);
  t.addEventListener('pointercancel', end);
  // A swipe isn't also a tap.
  t.addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); moved = false; } }, true);
})();

