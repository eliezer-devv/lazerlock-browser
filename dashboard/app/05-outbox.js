// ---------- Background save outbox: finish a save even if the page is closed mid-save ----------
// The dashboard commits changes when you leave a screen / minimize / close (above). As a guarantee for a hard close, we
// also keep the latest pending save, fully sealed and ready to POST, in IndexedDB; a service worker sends it — retrying
// when back online — even after the page is gone. A superseded copy is harmless: the automation rejects it as REPLAY
// (its nonce is behind), so at worst it's one ignored commit. Nothing here is needed while the page stays open.
let swReg = null;
async function ensureSW() {
  if (swReg) return swReg;
  if (!('serviceWorker' in navigator)) return null;
  try { swReg = await navigator.serviceWorker.register('firebase-messaging-sw.js'); } catch { swReg = null; }
  return swReg;
}
// Build the ready-to-POST GitHub issue for whatever's pending right now (same sealing as a normal save). It runs ON the
// signed-command chain, so its nonce can't collide with a normal save happening at the same moment (e.g. on 'hidden',
// where the direct save and this both fire): whichever is behind is simply rejected as REPLAY and dropped.
function buildCloseSave() {
  const run = signedChain.then(() => buildCloseSaveInner());
  signedChain = run.catch(e => { console.log(`(carried on) buildCloseSave ${e && e.message}`); appLog('Background (on-close) save couldn\'t be prepared: ' + (e && e.message)); return null; });
  return run;
}
async function buildCloseSaveInner() {
  // NOTE: no S.connected check here on purpose. The whole point of the on-close / background save is to build the
  // sealed request even when the network is down (going offline flips S.connected to false), so WorkManager can deliver
  // it once a connection returns. Signed-in is still required via ghToken() + the session/mac checks below; a pending
  // change implies the data was loaded, so S.D / S.L are present.
  if (S.saveBlocked || !ghToken()) return null;
  // What's still unsaved is NOT just S.listDirty/devDirty: a normal save moves the change into QUEUE.ops and clears
  // those flags immediately (optimistic), so while the queued POST is in flight or has failed, the real unsaved work
  // lives in QUEUE.ops. Build the on-close save from the queued ops AND any current dirty state (dirty wins per path).
  const byPath = new Map();     // put ops, coalesced per path and overlaid with the current dirty state
  const structural = [];        // delete / move ops (e.g. a list rename or archive) pass through in queue order
  // Queued devices.json content is untrimmed; trim it exactly as the normal send does (postOps), or the command can
  // blow past GitHub's 65,536-char issue-body limit and 422. List files need no trimming. baseText is local-only (merge).
  for (const o of coalesceOps(QUEUE.ops)) {
    if (o.op === 'put') byPath.set(o.path, { op: 'put', path: o.path, content: o.path === 'devices.json' ? trimForSave(o.content) : o.content, base: o.base || null });
    else { const { baseText, ...rest } = o; structural.push(rest); }
  }
  if (S.devDirty) byPath.set('devices.json', { op: 'put', path: 'devices.json', content: trimForSave(JSON.stringify(S.D, null, 2) + '\n'), base: S.devicesSha || null });
  if (S.listDirty) { const out = fromModel(S.L); if (!out.error) byPath.set(listPathOf(S.current), { op: 'put', path: listPathOf(S.current), content: JSON.stringify(out.data, null, 2) + '\n', base: S.listSha || null }); }
  const ops = [...structural, ...byPath.values()];   // structural ops first (a rename's move before the devices.json that references the new name)
  if (!ops.length) return null;
  const dev = await deviceKeys();
  const mac = await idb.get('mac');
  await getRequestKey();                 // do every await BEFORE claiming the nonce, so the claim below is atomic
  const s = getSession();
  if (!s || !mac) return null;
  s.n = (s.n || 0) + 1; setSession(s);    // claim the nonce (no await between read and write — can't collide)
  const payload = { op: 'write', ops, message: 'Save settings (background, on close)', rk: dev.enc, at: Date.now(), tz: localTz(), n: s.n };
  const p = JSON.stringify(payload);
  const sealedInner = { p, aid: s.aid, did: dev.did, mac: u8b64(await crypto.subtle.sign('HMAC', mac, enc8(p))) };
  const body = `🔒 Admin\n<!-- whitelist-admin-cmd\n${JSON.stringify(await seal(sealedInner))}\n-->`;
  return { url: `${API}/repos/${C.owner}/${C.repo}/issues`, method: 'POST', headers: ghHeaders(), body: JSON.stringify({ title: '🔒 Admin', body }) };
}
// Background save-on-close. Two different mechanisms:
//  - In the Android admin app (INAPP): we keep the latest sealed save STASHED in native as the user edits (stashNow,
//    debounced via scheduleStash). Native hands that stash to WorkManager from its own onStop — so it works even on a
//    hard swipe-close, where the WebView is torn down before any JS at close time could finish building/sending.
//  - In a web browser: the service-worker outbox (a background-sync that sends after the tab is gone).
// A successful in-page save clears/cancels either one (cancelNativeSave / clearOutbox), so nothing double-posts.
let stashTimer = null;
function scheduleStash() { if (!INAPP) return; if (stashTimer) clearTimeout(stashTimer); stashTimer = setTimeout(() => { stashTimer = null; stashNow(); }, 400); }
async function stashNow() {
  if (!INAPP) { appLog('Stash skipped: not running in the app (INAPP false).'); return; }
  if (!(window.WLBAdmin && WLBAdmin.stashPendingSave)) { appLog('Stash skipped: native stash bridge missing.'); return; }
  try {
    if (!(S.listDirty || S.devDirty || QUEUE.ops.length || QUEUE.failed || S.saveError)) { cancelNativeSave(); appLog('Stash skipped: nothing unsaved.'); return; }   // truly nothing unsaved (incl. the send-queue): drop any stash
    const req = await buildCloseSave();
    if (req) { WLBAdmin.stashPendingSave(JSON.stringify(req)); appLog('On-close save stashed in the app, ready for background delivery.'); }
    else appLog('On-close save NOT stashed (buildCloseSave returned nothing: no token / not signed in / not dirty).');
  } catch (e) { console.log('stashNow', e && e.message); appLog('On-close save couldn\'t be stashed: ' + (e && e.message)); }
}
async function armOutbox() {
  try {
    if (INAPP) { await stashNow(); return; }   // in the app: native delivers the stashed save from onStop
    const req = await buildCloseSave();
    if (!req) return;
    await idb.set('outbox', req);
    const reg = await ensureSW();
    if (!reg) return;
    // Register a background-sync so the worker sends it after we're gone. We do NOT poke the worker now: while the page
    // is alive the direct save usually lands first and clears the outbox, so poking would just double the commit. The
    // leftover (after a real close) is sent by the sync, or by the drain we fire on the next open / when we come back.
    if ('sync' in reg) { try { await reg.sync.register('wl-drain'); } catch {} }
  } catch (e) { console.log('armOutbox', e && e.message); }
}
function clearOutbox() { idb.del('outbox').catch(() => {}); }
// The in-page save landed: drop the native stash (and any queued job) so it can't post the same change again.
function cancelNativeSave() {
  // Only drop the native on-close stash when NOTHING is unsaved anywhere — not just when the UI dirty flags clear
  // (a normal save clears those the moment it queues the op, long before the send actually confirms).
  if (S.listDirty || S.devDirty || QUEUE.ops.length || QUEUE.busy || QUEUE.failed || S.saveError) return;
  try { if (INAPP && window.WLBAdmin && WLBAdmin.clearPendingSave) WLBAdmin.clearPendingSave(); } catch {}
}
// Waits for the automation's answers on that issue (sealed for this device). onEach(result) returns true to stop.
async function awaitAnswers(number, onEach, { minutes = 4, seen = new Set() } = {}) {
  const until = Date.now() + minutes * 60000;
  for (let wait = window.__wlPoll || 3000; Date.now() < until; wait = window.__wlPoll || Math.min(wait + 500, 4000)) {
    await sleep(wait);
    let list;
    try {
      const res = await fetch(`${API}/repos/${C.owner}/${C.repo}/issues/${number}/comments?per_page=50`, { headers: ghHeaders(), cache: 'no-store' });
      if (!res.ok) continue;
      list = await res.json();
    } catch { continue; }
    for (const c of list) {
      if (seen.has(c.id) || !c.user || c.user.type !== 'Bot') continue;          // only GitHub's automation answers
      const m = String(c.body || '').match(/<!-- whitelist-admin-result\s*([\s\S]*?)-->/);
      if (!m) continue;
      seen.add(c.id);
      let r; try { r = await unseal(JSON.parse(m[1])); } catch { continue; }
      if (onEach(r)) return r;
    }
  }
  return null;
}
// One command, and its answer. Unsigned: signing in and emailed links. Signed: everything once signed in, one at a
// time (each carries the next number, and GitHub refuses one that arrives after a later one).
let signedChain = Promise.resolve();
function command(cmd, opts = {}) {
  if (opts.signed === false) return commandNow(cmd, opts);
  const run = signedChain.then(() => commandNow(cmd, opts));
  signedChain = run.catch(e => console.log(`(carried on, line 710) ${e && e.message}`));
  return run;
}
async function commandNow(cmd, { signed = true, minutes = 4, onSent = null } = {}) {
  const dev = await deviceKeys();
  const payload = { ...cmd, rk: dev.enc, at: Date.now(), tz: localTz() };
  let sealed;
  if (signed) {
    const s = getSession(), mac = await idb.get('mac');
    if (!s || !mac) throw new Error('SIGNED_OUT');
    s.n = (s.n || 0) + 1; setSession(s);
    payload.n = s.n;
    const p = JSON.stringify(payload);
    sealed = { p, aid: s.aid, did: dev.did, mac: u8b64(await crypto.subtle.sign('HMAC', mac, enc8(p))) };
  } else sealed = { p: JSON.stringify(payload) };
  const number = await postCommand(sealed);
  // The command has reached GitHub now — it's durable and will be applied even if the app closes. Tell the caller so
  // it can show "Saved" straight away, while we keep waiting (below) only to catch a rare refusal and re-sync.
  if (onSent) { try { onSent(number); } catch (e) { console.log(e); } }
  const seen = new Set();
  const r = await awaitAnswers(number, () => true, { minutes, seen });
  if (!r) {
    // The issue was created, so the command is DURABLE — GitHub's automation will apply it once it runs. The private
    // repo's Actions are just busy/backed up (often behind an APK build) and haven't answered in time. Treat it as
    // saved-and-applying, NOT a failure: don't re-send it (that duplicates) and don't drop it. A background watcher
    // picks up a late answer to re-sync or to surface a genuine refusal; otherwise the next data refresh reconciles.
    watchLateAnswer(number, seen);
    return { ok: true, pending: true, number };
  }
  r.number = number;
  // Saved already; the admin data is re-packed after (a second answer says when, with the version to read).
  if (r.later) r.published = awaitAnswers(number, x => !!x.published, { minutes: 6, seen }).then(x => x ? x.sha || null : null).catch(() => null);
  if (r.code === 'SIGNED_OUT' || r.code === 'PAUSED') { await signedOutHere(r.error); throw new Error(r.error); }
  return r;
}

// A command that was durably posted but hadn't been answered in time: keep watching, longer, in the background. If the
// automation finally answers OK, re-sync the tidied result / new version like a normal save; if it answers with a real
// refusal (e.g. someone else changed it first), surface that so the admin knows; if it never answers here, leave it —
// the change is still queued and a later data refresh will reflect it.
async function watchLateAnswer(number, seen) {
  try {
    const r = await awaitAnswers(number, () => true, { minutes: 20, seen });
    if (!r) return;
    if (!r.ok) { QUEUE.failed = r.error || 'A change was refused.'; QUEUE.sending = false; appLog('Save refused by GitHub after a delay: ' + QUEUE.failed); renderSync(); return; }
    for (const [path, text] of Object.entries(r.files || {})) {
      OVER.set(path, { text });
      if (path === 'devices.json') {
        S.devicesSha = await gitSha(text);
        if (!S.devDirty) { try { const d = JSON.parse(text); S.D = d; if (!S.D.archived) S.D.archived = {}; softRender(); } catch (e) { console.log('late devices', e); } }
      } else if (path === listPathOf(S.current)) {           // keep the open list's base fresh too (e.g. an approval changed it)
        S.listSha = await gitSha(text);
        if (!S.listDirty) { try { S.L = toModel(JSON.parse(text)); softRender(); } catch (e) { console.log('late list', e); } }
      }
    }
    const sha = r.later ? await awaitAnswers(number, x => !!x.published, { minutes: 6, seen }).then(x => x ? x.sha || null : null).catch(() => null) : r.sha;
    if (quietNow()) refreshData(sha).catch(e => console.log('late refresh', e));
  } catch (e) { console.log('watchLateAnswer', e && e.message); }
}

