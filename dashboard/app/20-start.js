// ============================================================================================
// Start
// ============================================================================================
// Keeping up to date by itself: every 45 seconds while this page is on screen (and as soon as it comes back), the
// newest data, so a locked PIN, a new request or another admin's change shows without reloading. Never while
// something is being edited, saved or typed.
async function autoRefresh() {
  try {
    if (!S.connected || S.locked || document.visibilityState !== 'visible') return;
    if (S.devDirty || S.listDirty || !quietNow()) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox') return;
    const sha = await latestSha();
    if (sha && sha !== DATA.sha) await refreshData(sha);
  } catch {}
}
// While you're looking at waiting requests, poll quickly so one answered elsewhere (a PIN typed on the phone, or
// another admin) clears within a few seconds instead of up to 45. Otherwise keep the slow, quiet cadence.
function nextRefreshDelay() {
  const watching = !S.sub && S.tab === 'requests' && ((S.requests && S.requests.length) || (S.newPhones && S.newPhones.length));
  return watching ? 7000 : 45000;
}
(function scheduleRefresh() {
  setTimeout(async () => { try { await autoRefresh(); } finally { scheduleRefresh(); } }, nextRefreshDelay());
})();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoRefresh(); });
(async () => {
  if (INAPP) document.title = 'Admin';
  // (From before sign-in: a GitHub token kept here. Not used any more, so not kept.)
  try { localStorage.removeItem('wl-admin-locked'); localStorage.removeItem('wl-admin'); } catch {}
  if (!LINK && getSession()) {
    if (getPin() || getBio()) S.locked = true;             // the PIN or fingerprint first
    else {
      S.starting = true; render();
      try { await openData(); }
      catch (e) { S.connected = false; say(e.message, true); }
      S.starting = false;
    }
  }
  render();
})();
})();
