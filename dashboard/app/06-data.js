// ---------- What this admin sees: encrypted in the public repository, at a given version ----------
const RAW = 'https://raw.githubusercontent.com';
const DATA = { sha: null, key: null, index: null, cache: new Map() };
// The public repository's newest version (null if GitHub didn't say: the branch name would give an old, cached copy).
async function latestSha() {
  for (const auth of [true, false]) {
    try {
      const res = await fetch(`${API}/repos/${C.owner}/${publicRepoName()}/commits/${branch()}`,
        { headers: { Accept: 'application/vnd.github.sha', ...(auth && ghToken() ? { Authorization: `Bearer ${ghToken()}` } : {}) }, cache: 'no-store' });
      if (res.ok) { const t = (await res.text()).trim(); if (/^[0-9a-f]{40}$/.test(t)) return t; }
    } catch {}
  }
  return null;
}
async function aesOpen(key, text) {
  const { iv, d } = JSON.parse(text);
  return dec8(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u8(iv) }, key, b64u8(d)));
}
// Loads the index (and this device's key) at version [sha]. False: this device has no key there (signed out).
async function loadData(sha, { cached = false } = {}) {
  const s = getSession();
  if (!s) throw new Error('SIGNED_OUT');
  sha = sha || await latestSha() || s.sha;
  if (!sha) return false;
  const at = p => `${RAW}/${C.owner}/${publicRepoName()}/${sha}/a/${s.ah}/${p}`;
  // (A version that opened here before never changes, so this browser's copy will do: that's the quick open.)
  const how = { cache: cached ? 'force-cache' : 'no-store' };
  const kres = await fetch(at(`k/${s.dh}.json`), how);
  if (kres.status === 404) return false;
  if (!kres.ok) throw new Error(`Couldn't load your data (${kres.status}). Check this device is online.`);
  const k = await unseal(await kres.json());
  const key = await crypto.subtle.importKey('raw', b64u8(k.k), 'AES-GCM', false, ['decrypt']);
  const ires = await fetch(at('i.json'), how);
  if (!ires.ok) throw new Error(`Couldn't load your data (${ires.status}).`);
  const index = JSON.parse(await aesOpen(key, await ires.text()));
  Object.assign(DATA, { sha, key, index, at });
  ME = index.me;
  if (typeof S !== 'undefined') S.admins = null;                // (read again from this version, when needed)
  const now = getSession();
  if (now && now.sha !== sha) setSession({ ...now, sha });      // (the last version that opened here)
  return true;
}
// Opens this admin's data: at [sha] (just published), else the newest version, else the last one that opened here.
// If none of those has it (GitHub can take a moment to show a new version), it asks GitHub's automation, which
// publishes it again, and says if this device really was signed out. It never signs out by itself.
async function openData(sha) {
  const tryAt = async (v, o) => { try { return await loadAll(v, o); } catch (e) { console.log('open', e); return false; } };
  if (sha) for (let i = 0; i < 3; i++) { if (await tryAt(sha)) return true; await sleep(3000); }
  else {
    // Opening: what showed here last time, at once ("Updating…"), then the newest.
    const last = getSession() && getSession().sha;
    if (last && await tryAt(last, { cached: true })) {
      S.updating = true; renderSync();
      (async () => {
        try { const v = await latestSha(); if (v && v !== DATA.sha && quietNow() && !S.devDirty && !S.listDirty) await refreshData(v); }
        catch (e) { console.log('update', e); }
        S.updating = false; renderSync();
        const a = document.activeElement;
        if (!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox')) render();
      })();
      return true;
    }
    if (await tryAt()) return true;
  }
  const s = getSession();
  if (s && s.sha && s.sha !== sha && await tryAt(s.sha)) {
    command({ op: 'refresh' }).then(r => r.ok && refreshData(r.sha)).catch(e => console.log(`(carried on, line 802) ${e && e.message}`));     // (then the newest, quietly)
    return true;
  }
  const r = await command({ op: 'refresh' });           // (signed out for real: this signs out, and throws)
  if (!r.ok) throw new Error(r.error);
  for (let i = 0; i < 5; i++) { if (await tryAt(r.sha)) return true; await sleep(4000); }
  throw new Error('Your data isn\'t showing yet. Reload the page in a minute.');
}
async function fileText(path) {
  const f = DATA.index && DATA.index.files[path];
  if (!f) return null;
  const ck = f.n + f.h;
  if (!DATA.cache.has(ck)) DATA.cache.set(ck, (async () => {
    const res = await fetch(DATA.at(`f/${f.n}.json`), { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status}).`);
    return aesOpen(DATA.key, await res.text());
  })());
  try { return await DATA.cache.get(ck); } catch (e) { DATA.cache.delete(ck); throw e; }
}
let ME = null;                     // who's signed in: { aid, email, name, role, phones, can, devices }
const isOwner = () => !!ME && ME.role === 'owner';
const canDo = what => isOwner() || !!(ME && ME.can && ME.can[what]);
const allPhonesAdmin = () => isOwner() || (ME && ME.phones === 'all');
const fullAdmin = () => isOwner() || (allPhonesAdmin() && canDo('settings'));
// The Phones tab: for anyone who can change something there, or read their phones' messages.
const seesPhones = () => fullAdmin() || canDo('edit') || canDo('manage') || canDo('logs');

// ---------- Reading and changing files (the rest of the page uses these, as before) ----------
// Changes show here at once ("overlay") and go to GitHub as one command; the next arrives once it's answered.
const OVER = new Map();            // path -> { text } or { gone: true }
const gitSha = async text => { const b = enc8(text); const head = enc8(`blob ${b.length}\0`); const all = new Uint8Array(head.length + b.length); all.set(head); all.set(b, head.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', all))].map(x => x.toString(16).padStart(2, '0')).join(''); };
// ---------- three-way merge (used only to recover a save when the file changed under us) ----------
// Combines the admin's edits (mine) with a concurrent change on the server (theirs) against the common
// ancestor (base), so a save is never lost to "it changed since you loaded it" and the concurrent change
// (an approved request, a newly-registered phone) isn't dropped either. Verified against merge_test.js.
const mClone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const mEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mObj = x => x && typeof x === 'object' && !Array.isArray(x);
const mKey = x => (mObj(x) ? (x.domain ?? x.id ?? x.name ?? JSON.stringify(x)) : x);
function mergeArr(base, mine, theirs) {
  const bk = new Map(base.map(x => [mKey(x), x])), mk = new Map(mine.map(x => [mKey(x), x])), tk = new Map(theirs.map(x => [mKey(x), x]));
  const order = [], seen = new Set();
  for (const x of [...mine, ...theirs]) { const k = mKey(x); if (!seen.has(k)) { seen.add(k); order.push(k); } }
  const out = [];
  for (const k of order) {
    const inB = bk.has(k), inM = mk.has(k), inT = tk.has(k);
    if (inM && inT) out.push(merge3(inB ? bk.get(k) : undefined, mk.get(k), tk.get(k)));
    else if (inM && !inT) { if (!(inB && mEq(bk.get(k), mk.get(k)))) out.push(mClone(mk.get(k))); }   // mine added/changed -> keep; unchanged+removed-by-them -> drop
    else { if (!(inB && mEq(bk.get(k), tk.get(k)))) out.push(mClone(tk.get(k))); }                     // theirs added/changed -> keep; unchanged+removed-by-me -> drop
  }
  return out;
}
function merge3(base, mine, theirs) {
  if (mEq(mine, theirs)) return mClone(mine);
  if (mEq(base, mine)) return mClone(theirs);     // I didn't touch it
  if (mEq(base, theirs)) return mClone(mine);     // they didn't touch it
  if (mObj(mine) && mObj(theirs)) {
    const b = mObj(base) ? base : {}, out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const inM = k in mine, inT = k in theirs;
      if (inM && inT) out[k] = merge3(b[k], mine[k], theirs[k]);
      else if (inM && !inT) { if (!(k in b) || !mEq(b[k], mine[k])) out[k] = mClone(mine[k]); }
      else { if (!(k in b) || !mEq(b[k], theirs[k])) out[k] = mClone(theirs[k]); }
    }
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs)) return mergeArr(Array.isArray(base) ? base : [], mine, theirs);
  return mClone(mine);   // a scalar both sides changed -> the admin's intent wins
}
async function textOf(path) {
  if (OVER.has(path)) return OVER.get(path).gone ? null : OVER.get(path).text;
  return fileText(path);
}
async function getRaw(path) {   // a file: { sha }; a folder: its files [{ type, name }]. null if neither.
  const t = await textOf(path);
  if (t != null) return { sha: await gitSha(t) };
  const names = new Set([...Object.keys(DATA.index ? DATA.index.files : {}), ...OVER.keys()].filter(p => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')));
  const files = [];
  for (const p of names) if (await textOf(p) != null) files.push({ type: 'file', name: p.slice(path.length + 1) });
  return files.length ? files : null;
}
async function getJson(path) {
  const t = await textOf(path);
  return t == null ? null : { sha: await gitSha(t), data: JSON.parse(t) };
}
const QUEUE = { ops: [], message: '', timer: null, busy: false, sending: false, failed: null };
function queueOp(op, message) {
  QUEUE.ops.push(op);
  if (!QUEUE.message && message) QUEUE.message = message;
  scheduleStash();   // keep the native on-close stash in step with the send-queue (not just with the UI dirty flags)
  clearTimeout(QUEUE.timer);
  QUEUE.timer = setTimeout(flushQueue, 60);
  renderSync();
}
async function putJson(path, data, fileSha, message) {
  let baseText = null;   // what this change is based on — kept so a conflict can be merged, not lost
  try { baseText = OVER.has(path) ? (OVER.get(path).gone ? null : OVER.get(path).text) : await fileText(path); } catch (e) { baseText = null; }
  const text = JSON.stringify(data, null, 2) + '\n';
  queueOp({ op: 'put', path, content: text, base: fileSha || null, baseText }, message);
  OVER.set(path, { text });
  return gitSha(text);
}
// The file as it is on the server right now (past our optimistic overlay). For conflict recovery.
async function freshJson(path) {
  const t = await fileText(path);
  return t == null ? null : { sha: await gitSha(t), data: JSON.parse(t) };
}
// A save was refused because a file changed under us (an approved request, a new phone). Rather than lose the
// admin's work: pull the newest published data, merge each refused change with what's now on the server, re-base
// it, and let it save again. Returns false if the fresh data isn't reachable yet (caller then surfaces it).
async function reconcileFailedOps(ops) {
  try {
    const start = DATA.sha;                                   // wait briefly for the concurrent change to publish
    for (let i = 0; i < 5; i++) { const v = await latestSha(); if (v && v !== start) { await loadData(v).catch(() => false); break; } await sleep(1500); }
    for (const op of ops) {
      if (op.op !== 'put') continue;
      const fr = await freshJson(op.path);
      const theirs = fr ? fr.data : (op.baseText != null ? JSON.parse(op.baseText) : null);
      if (theirs == null) return false;
      const base = op.baseText != null ? JSON.parse(op.baseText) : theirs;
      const merged = merge3(base, JSON.parse(op.content), theirs);
      if (op.path === 'devices.json') {   // keep the shape the rest of the page expects
        if (!Array.isArray(merged.default)) merged.default = ['public'];
        if (!merged.devices) merged.devices = {};
        if (!merged.archived) merged.archived = {};
      }
      const text = JSON.stringify(merged, null, 2) + '\n';
      const ancestor = JSON.stringify(theirs, null, 2) + '\n';   // the server version we merged onto == the new base
      op.content = text; op.base = fr ? fr.sha : await gitSha(text); op.baseText = ancestor;
      OVER.set(op.path, { text });
      // Reflect the merge in what's on screen — but never over newer edits the admin just made (those save next).
      if (op.path === 'devices.json') { S.devicesSha = op.base; if (!S.devDirty) S.D = merged; }
      else if (op.path === listPathOf(S.current)) { S.listSha = op.base; if (!S.listDirty) S.L = toModel(merged); }
    }
    softRender();
    return true;
  } catch (e) { console.log('reconcile', e && e.message); appLog('Save merge-retry error: ' + (e && e.message)); return false; }
}
async function deleteFile(path, fileSha, message) {
  queueOp({ op: 'delete', path, base: fileSha || null }, message);
  OVER.set(path, { gone: true });
}
async function moveFile(from, to, message) {   // keeps the content exactly
  const t = await textOf(from);
  if (t == null) return false;
  queueOp({ op: 'move', from, to }, message);
  OVER.set(to, { text: t }); OVER.set(from, { gone: true });
  return true;
}
// [again]: answering one that was answered already ('undo' an approval, or 'approve' a denied one after all).
async function reply(number, text, again) { queueOp({ op: 'reply', number, text, ...(again ? { again } : {}) }, `Answer request #${number}`); }
// Each put/delete carries the whole file, so only the LAST one per path matters. Collapse them before sending:
// a run of failed saves (or rapid edits) otherwise stacks several full-file copies into one command, and the GitHub
// issue it's posted in caps at 65536 characters — stacked copies are what pushed it over (a 422). reply/move stay.
function coalesceOps(list) {
  const out = [], at = new Map();
  for (const o of list) {
    if (o.op === 'put' || o.op === 'delete') { if (at.has(o.path)) out[at.get(o.path)] = o; else { at.set(o.path, out.length); out.push(o); } }
    else out.push(o);
  }
  return out;
}
// Fields the backend's owner-save restores from the latest on the server — so the page never needs to SEND them.
// Trimming them from the saved copy keeps the command small (message threads especially) and keeps the payload well
// under GitHub's issue limit. They stay in S.D for display; only the copy that goes to GitHub is trimmed. This MUST
// match the backend's restore set (admin.js PHONE_OWNED + KEEP_BUT_RESTORE), or a trimmed field would be lost.
const SERVER_OWNED = ['phoneSyncAt', 'fcm', 'fcmAt', 'pinFails', 'pinLockedUntil', 'answerChanges', 'key', 'threads', 'adminViewAt'];
function trimForSave(content) {
  let d; try { d = JSON.parse(content); } catch { return content; }
  if (!d || typeof d !== 'object') return content;
  delete d.adminFcm;
  for (const map of [d.devices, d.archived]) for (const id in (map || {})) { const x = map[id]; if (x && typeof x === 'object') for (const f of SERVER_OWNED) delete x[f]; }
  return JSON.stringify(d, null, 2) + '\n';
}
async function flushQueue() {
  if (QUEUE.busy || !QUEUE.ops.length || QUEUE.failed) return;
  const ops = coalesceOps(QUEUE.ops.splice(0)), message = QUEUE.message;
  QUEUE.message = ''; QUEUE.busy = true; QUEUE.sending = true; renderSync();
  try {
    // "Saved" shows the moment the change reaches GitHub (onSent) — it's durable from then on. We keep awaiting the
    // answer to catch a rare refusal and to re-sync the tidied result, but the pill no longer waits for it.
    // baseText is a local-only copy of the prior file contents (used to merge a conflict). It must NOT be sent: it
    // would roughly double the command and push the GitHub issue body past its 65536-char limit (a 422). Strip it here;
    // the originals in QUEUE.ops keep baseText for reconcileFailedOps.
    const postOps = ops.map(o => {
      const { baseText, ...rest } = o;                                  // baseText is local-only (merge); never sent
      if (rest.op === 'put' && rest.path === 'devices.json') rest.content = trimForSave(rest.content);   // drop server-restored fields to keep the command small
      return rest;
    });
    const r = await command({ op: 'write', ops: postOps, message }, { onSent: () => { QUEUE.sending = false; QUEUE.savedAt = Date.now(); renderSync(); } });
    if (!r.ok) throw new Error(r.error || 'It wasn\'t saved.');
    if (QUEUE.conflictTries) appLog('Save succeeded after ' + QUEUE.conflictTries + ' merge-retr' + (QUEUE.conflictTries > 1 ? 'ies' : 'y') + '.');
    QUEUE.busy = false; QUEUE.sending = false; QUEUE.savedAt = Date.now(); QUEUE.conflictTries = 0;
    // Durably posted but not yet applied (the automation is slow): it's saved and will land. Don't re-pack from the
    // server now — that would show the pre-change data over the optimistic change. The background watcher re-syncs later.
    if (r.pending) { renderSync(); if (QUEUE.ops.length && !QUEUE.failed) flushQueue(); return; }
    if (r.warning) say(r.warning, true);
    // Saved a little differently (tidied by GitHub's automation): carry on from what's there now.
    for (const [path, text] of Object.entries(r.files || {})) {
      if (QUEUE.ops.some(o => o.path === path || o.to === path)) continue;      // (a newer change of it is on its way)
      OVER.set(path, { text });
      if (path === 'devices.json') {
        S.devicesSha = await gitSha(text);
        if (!S.devDirty) { try { const d = JSON.parse(text); S.D = d; if (!S.D.archived) S.D.archived = {}; softRender(); } catch (e) { console.log('devices', e); } }
      } else if (path === listPathOf(S.current)) {           // keep the open list's base fresh too (e.g. an approval changed it)
        S.listSha = await gitSha(text);
        if (!S.listDirty) { try { S.L = toModel(JSON.parse(text)); softRender(); } catch (e) { console.log('list', e); } }
      }
    }
    afterSave(r);
    cancelNativeSave();   // truly saved (the send-queue drained): now it's safe to drop the native on-close stash
  } catch (e) {
    QUEUE.sending = false;
    if (e.message === 'SIGNED_OUT') { QUEUE.busy = false; appLog('Save stopped: signed out on this device.'); renderSync(); return; }
    QUEUE.ops.unshift(...ops);
    // It changed under us (an approved request, a newly-registered phone). Merge our edits with what's now on the
    // server and save again, rather than lose the admin's work. Bounded, and busy stays set so nothing re-enters.
    if (/changed since you loaded it/i.test(e.message) && (QUEUE.conflictTries || 0) < 4) {
      QUEUE.conflictTries = (QUEUE.conflictTries || 0) + 1;
      appLog('Save: the data changed on the server since it loaded — merging your changes and retrying (attempt ' + QUEUE.conflictTries + ').');
      renderSync();
      const ok = await reconcileFailedOps(ops);
      QUEUE.busy = false;
      if (ok) { renderSync(); flushQueue(); return; }
      appLog('Save: couldn\'t fetch the latest data to merge — showing as not saved so nothing is lost.');
    } else { QUEUE.busy = false; }
    QUEUE.failed = e.message;
    appLog('Save failed (shown as "Not saved"): ' + e.message);
  }
  renderSync();
  if (QUEUE.ops.length && !QUEUE.failed) flushQueue();
}
// Redraws, unless that would interrupt: a finger or mouse held down (a swipe, a drag) waits until it's let go, and
// something being typed isn't cleared.
let pointerHeld = false, renderWaiting = false;
document.addEventListener('pointerdown', () => { pointerHeld = true; }, true);
const letGo = () => { pointerHeld = false; if (renderWaiting) { renderWaiting = false; setTimeout(softRender, 0); } };
document.addEventListener('pointerup', letGo, true);
document.addEventListener('pointercancel', letGo, true);
function softRender() {
  if (pointerHeld) { renderWaiting = true; return; }
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio') return;
  render();
}
// Once a save is re-packed for the admin page: the newest data, once nothing else is still on its way (until then,
// what's shown here stays, changes included).
const PUB = { pending: 0 };
const quietNow = () => !PUB.pending && !QUEUE.busy && !QUEUE.ops.length && !QUEUE.failed && !CMDQ.pending;
function afterSave(r) {
  if (!r.later) { if (!QUEUE.ops.length && !QUEUE.busy && !PUB.pending) refreshData(r.sha).catch(e => console.log('refresh', e)); return; }
  PUB.pending++; renderSync();
  r.published.then(async sha => {
    PUB.pending--;
    if (!quietNow()) return;                       // (the last one to finish reads it)
    const was = DATA.sha;
    await refreshData().catch(e => console.log('refresh', e));
    if (DATA.sha === was && sha) { await sleep(3000); if (quietNow()) await refreshData(sha).catch(e => console.log('refresh', e)); }
  }).finally(() => { renderSync(); softRender(); });
}
// After a save (or "Check for new requests"): the newest data, without losing what's being edited.
async function refreshData(sha) {
  if (!(await loadData(sha).catch(() => false))) return;      // (not there yet: what's shown stays)
  OVER.clear();
  if (!S.devDirty) await loadDevices();
  const folder = await getRaw('docs/lists');
  S.lists = ['public', ...(Array.isArray(folder) ? folder.filter(f => f.type === 'file' && f.name.endsWith('.json')).map(f => f.name.slice(0, -5)).sort() : [])];
  if (!S.listDirty) await openList(S.lists.includes(S.current) ? S.current : 'public');
  S.logFiles = null; S.otherLists = null;
  await loadInbox();
}
// Account and admin changes (notifications, PINs, admins…): shown here at once, saved in the background (the
// "Saving…" pill), so nothing waits for GitHub. If GitHub refuses one, it says why, and shows what GitHub has.
const CMDQ = { pending: 0, sending: 0 };
function bg(cmd, okText, apply) {
  if (apply) { try { apply(); } catch (e) { console.log(e); } }
  let sent = false;
  const markSent = () => { if (!sent) { sent = true; CMDQ.sending--; QUEUE.savedAt = Date.now(); renderSync(); } };   // "Saved" once it reaches GitHub
  CMDQ.pending++; CMDQ.sending++; renderSync(); render();
  command(cmd, { onSent: markSent }).then(async r => {
    if (!r.ok) throw new Error(r.error || 'It wasn\'t saved.');
    QUEUE.savedAt = Date.now();
    if (r.pending) { renderSync(); return; }   // durably posted, applying in the background — don't re-pack from the server (would show the pre-change data over what was just changed)
    if (r.later) afterSave(r); else await refreshData(r.sha).catch(e => console.log(`(carried on, line 951) ${e && e.message}`));
    if (r.warning) say(r.warning, true); else if (okText) say(r.msg || okText);
  }).catch(async e => {
    if (e.message === 'SIGNED_OUT') return;
    say(e.message, true);
    await refreshData().catch(e => console.log(`(carried on, line 956) ${e && e.message}`));               // (back to what GitHub has)
  }).finally(() => {
    markSent();                                                           // (also clears "sending" if it failed before it was sent)
    CMDQ.pending--; renderSync();
    // (Not while something's being typed: that would clear it.)
    const a = document.activeElement;
    if (!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox')) render();
  });
}
// "Saving…" / "Saved" / "Not saved", at the top of every screen.
function renderSync() {
  const el = $('syncPill');
  if (!el) return;
  const busy = QUEUE.sending || QUEUE.ops.length || CMDQ.sending;   // "Saving…" only while actually sending to GitHub; once sent it's "Saved"
  const upd = !busy && !QUEUE.failed && S.updating;
  el.hidden = !(busy || upd || QUEUE.failed || (QUEUE.savedAt && Date.now() - QUEUE.savedAt < 5000));
  el.className = QUEUE.failed ? 'bad' : busy || upd ? 'busy' : 'ok';
  el.replaceChildren(QUEUE.failed ? 'Not saved: tap for details' : busy ? 'Saving…' : upd ? 'Updating…' : 'Saved');
  if (!busy && !QUEUE.failed && QUEUE.savedAt) setTimeout(renderSync, 5200);
}
async function showSaveProblem() {
  if (!QUEUE.failed) return;
  const retry = await uiDialog({ title: 'Not saved', icon: 'warn', red: true, text: QUEUE.failed,
    ok: 'Try again', cancel: 'Start over' });
  if (retry) {
    // Re-sync with the server and merge our edits in first, so "Try again" actually goes through instead of
    // hitting the same "it changed under us" wall. (For an ordinary network blip the merge is a harmless no-op.)
    QUEUE.failed = null; QUEUE.conflictTries = 0; QUEUE.busy = true; renderSync();
    await reconcileFailedOps(QUEUE.ops); QUEUE.busy = false;
    flushQueue(); return;
  }
  if (!(await uiConfirmDanger('Start over?', 'Your changes that weren\'t saved are thrown away, and everything is loaded again from GitHub.', 'Start over', 'warn'))) return;
  QUEUE.failed = null; QUEUE.ops = []; OVER.clear(); S.listDirty = false; S.devDirty = false;
  try { await refreshData(); } catch (e) { say(e.message, true); }
  render();
}
