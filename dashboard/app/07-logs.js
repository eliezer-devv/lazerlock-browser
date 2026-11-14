// ---------- a phone's logs (logs/<ID>/ in the private repository, kept 30 days) ----------
// A phone's logs and messages (newest first); [archived]: the ones put away (logs/<ID>/archive/, kept until deleted).
async function logFiles(id, archived = false) {
  const dir = archived ? `logs/${id}/archive` : `logs/${id}`;
  const paths = new Set(Object.keys(DATA.index ? DATA.index.files : {}));
  for (const [p, o] of OVER) { if (o.gone) paths.delete(p); else paths.add(p); }      // (archived or deleted just now)
  return [...paths].filter(p => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/') && p.endsWith('.txt'))
    .map(p => ({ type: 'file', name: p.slice(dir.length + 1) })).sort((a, b) => b.name.localeCompare(a.name));
}
async function logText(id, name) {
  const t = await textOf(`logs/${id}/${name}`);
  if (t == null) throw new Error('It isn\'t there any more.');
  return t;
}
// "2026-10-04_06-57_asked-for.txt" -> "4 Oct, 07:57 · asked for" (in this computer's time); a message: "… · Message"
function logLabel(name) {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})_?(.*)\.txt$/);
  if (!m) return name;
  const when = new Date(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  return when.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) +
    (m[4] === 'message' ? ' · Message' : m[4] ? ' · ' + m[4].replace(/-/g, ' ') : '');
}
function logScreen() {
  const { id, file, arc } = S.sub;
  const path = arc ? `archive/${file}` : file;
  if (!S.logView || S.logView.file !== path) {
    S.logView = { file: path, text: null };
    logText(id, path).then(t => { S.logView = { file: path, text: t }; render(); }).catch(e => { S.logView = { file: path, text: 'Couldn\'t load it: ' + e.message }; render(); });
  }
  const text = S.logView.text;
  const download = () => saveFile(new Blob([text || ''], { type: 'text/plain' }), `lazerlock-log-${id}-${file}`);
  const name = (S.D.devices[id] && S.D.devices[id].name) || id;
  const from = S.sub.from;
  return h('main', { class: 'stack' }, backLink(from ? 'Messages' : name, () => from ? (S.sub = { name: 'thread', id: from.id, thread: from.thread }, S.tab = 'messages', render()) : open({ name: 'phone', id })),
    screenTitle(/_message\.txt$/.test(file) ? (String(text || '').match(/^Subject: (.*)/) || [, 'Message'])[1] : 'Log', `${name} · ${logLabel(file)}`),
    h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'btn s', id: 'logDownload', disabled: text == null, onclick: download }, 'Download'),
      h('button', { type: 'button', class: 'btn s', id: 'logArchive', onclick: () => archiveLog(id, file, !arc) }, icon('archive', 18), arc ? 'Restore' : 'Archive'),
      h('button', { type: 'button', class: 'btn d', id: 'logDelete', onclick: () => deleteLog(id, path) }, icon('trash', 18), 'Delete')),
    arc ? h('p', { class: 'hint', style: 'margin:0' }, 'Archived: kept until you delete it (other logs go after 30 days).') : null,
    h('pre', { class: 'logtext' }, text == null ? 'Loading…' : text));
}
// A row that can be swiped, like My requests on the phone: past a third of the way, it slides off and its space
// closes, then [act] runs; sooner, it springs back. right/left: { label, icon, color, run }. A tap is still a tap.
function swipeable(row, { right, left }) {
  const trail = h('div', { class: 'trail' });
  const box = h('div', { class: 'swipe' }, trail, row);
  let x0 = 0, y0 = 0, dx = 0, dragging = false, down = false, moved = false, shown = 0;
  // The trail: the action's colour, with its icon and word on the side the row is moving away from.
  const show = d => {
    const a = d > 0 ? right : d < 0 ? left : null, side = !a || !d ? 0 : d > 0 ? 1 : -1;
    if (!side) { trail.style.visibility = 'hidden'; shown = 0; return; }
    trail.style.visibility = 'visible';
    if (side === shown) return;
    shown = side;
    trail.style.background = a.color;
    trail.style.justifyContent = side > 0 ? 'flex-start' : 'flex-end';
    const ic = icon(a.icon, 22, 2), w = h('span', null, a.label);
    trail.replaceChildren(...(side > 0 ? [ic, w] : [w, ic]));
  };
  const back = () => { row.style.transition = 'transform .16s ease'; row.style.transform = ''; setTimeout(() => { row.style.transition = ''; show(0); }, 170); };
  row.addEventListener('pointerdown', e => { down = true; dragging = false; moved = false; x0 = e.clientX; y0 = e.clientY; dx = 0; });
  row.addEventListener('pointermove', e => {
    if (!down) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!dragging) {
      if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my) * 1.5) { if (Math.abs(my) > 10) down = false; return; }   // (only a clearly sideways move)
      dragging = true; moved = true; try { row.setPointerCapture(e.pointerId); } catch {}
    }
    dx = mx;
    if ((dx > 0 && !right) || (dx < 0 && !left)) dx = dx / 6;     // (no action that way: it barely moves)
    row.style.transform = `translateX(${dx}px)`; show(dx);
  });
  const end = () => {
    if (!down) return;
    down = false;
    if (!dragging) return;
    dragging = false;
    const a = dx > 0 ? right : dx < 0 ? left : null, w = box.offsetWidth;
    if (!a || Math.abs(dx) < w / 3) return back();
    row.style.transition = 'transform .18s ease'; row.style.transform = `translateX(${dx > 0 ? w : -w}px)`;
    setTimeout(() => {
      box.style.height = box.offsetHeight + 'px'; box.classList.add('collapsing');
      requestAnimationFrame(() => { box.style.height = '0px'; box.style.opacity = '0'; });
      setTimeout(() => a.run(), 210);
    }, 180);
  };
  row.addEventListener('pointerup', end); row.addEventListener('pointercancel', () => { if (dragging) { down = false; dragging = false; back(); } else down = false; });
  row.addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
  return box;
}
// A log's row, swiped: right archives it (or, in Archived, restores it), left deletes it. Done straight away.
function swipeLog(row, id, file, archived) {
  return swipeable(row, {
    right: archived ? { label: 'Restore', icon: 'undo', color: 'var(--accent)', run: () => archiveLog(id, file, false, true) }
      : { label: 'Archive', icon: 'archive', color: 'var(--accent)', run: () => archiveLog(id, file, true, true) },
    left: { label: 'Delete', icon: 'trash', color: 'var(--red)', run: () => deleteLog(id, archived ? `archive/${file}` : file, true) },
  });
}
// Archive a log or message (kept until deleted: the others go after 30 days), or bring it back.
async function archiveLog(id, file, toArchive, swiped) {
  const from = `logs/${id}/${toArchive ? '' : 'archive/'}${file}`, to = `logs/${id}/${toArchive ? 'archive/' : ''}${file}`;
  if (await moveFile(from, to, `${toArchive ? 'Archive' : 'Restore'} a log of ${id}`)) {
    S.logFiles = null; S.logView = null;
    if (swiped) render(); else open({ name: 'phone', id });
    say(toArchive ? (swiped ? 'Archived' : 'Archived. It\'s under Show archived, and kept until you delete it.') : (swiped ? 'Put back' : 'Restored.'));
  }
}
async function deleteLog(id, path, swiped) {
  // (Swiped: straight away, like My requests on the phone. From its own screen: asked first.)
  if (!swiped && !(await uiConfirmDanger('Delete it?', 'It\'s deleted for good.', 'Delete'))) return;
  const full = `logs/${id}/${path}`;
  const f = await getRaw(full);
  await deleteFile(full, f && f.sha, `Delete a log of ${id}`);
  S.logFiles = null; S.logView = null;
  if (swiped) render(); else open({ name: 'phone', id });
  say(swiped ? 'Deleted' : 'Deleted.');
}
// This device was signed out (removed, paused, or the password was reset elsewhere).
async function signedOutHere(why) {
  await forgetDevice();
  S.connected = false; S.sub = null; ME = null;
  QUEUE.ops = []; QUEUE.failed = null; OVER.clear();
  // Tell the app so this phone stops acting as an admin phone (notifications etc.) the moment it's signed out.
  if (INAPP && window.WLBAdmin && WLBAdmin.adminSignedOut) try { WLBAdmin.adminSignedOut(); } catch {}
  render();
  if (why) say(why, true);
}
// Reopened from the background (called by the app): re-ask the PIN/fingerprint if one is set, by reloading the gate.
// Re-lock when the app is reopened — WITHOUT reloading the page, so after unlocking you return to the same screen
// you were on (S.sub is kept). Showing the unlock screen just needs connected=false + locked=true.
// Reopened from the background: just raise the lock screen for the person. It does NOT disconnect the session or touch
// any in-flight work — saves keep finishing, unsaved edits stay in memory — so unlocking returns to exactly where they were.
window.wlRelock = () => { try { if ((getPin() || getBio()) && !S.locked) { S.locked = true; S.bioAsked = false; render(); } } catch {} };   // clear bioAsked so the fingerprint prompt opens by itself again on reopen
const NO_ISSUES_MSG = 'Couldn\'t answer it.';
const listPathOf = name => name === 'public' ? 'docs/whitelist.json' : `docs/lists/${name}.json`;

