// ================= Messages: threaded conversations with phones =================
const whenMsg = at => { try { return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const parseAt = s => { const t = Date.parse(s || ''); return isNaN(t) ? 0 : t; };
function adminInitials(name) { const w = String(name || '').trim().split(/\s+/).filter(Boolean); if (!w.length) return '?'; return (w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase(); }
function msgManage() { return fullAdmin() || canDo('manage') || canDo('requests'); }
// A phone's threads the current admin may see, with admin-only-hidden messages/threads removed, oldest activity first.
function visibleThreads(id) {
  const d = S.D.devices[id]; if (!d) return [];
  let threads = Array.isArray(d.threads) ? d.threads : [];
  if (!threads.length && Array.isArray(d.chat) && d.chat.length)
    threads = [{ id: 'legacy', subject: 'Messages', at: d.chat[d.chat.length - 1].at,
      msgs: d.chat.map((m, i) => ({ id: m.id || ('legacy' + i), who: m.who === 'admin' ? 'admin' : 'phone', text: m.text, at: m.at, by: m.by })) }];
  return threads.filter(t => t && !t.hideAdmin)
    .map(t => ({ ...t, msgs: (t.msgs || []).filter(m => m && !m.hideAdmin) }))
    .filter(t => (t.msgs || []).length)
    .sort((a, b) => parseAt(a.at) - parseAt(b.at));
}
function threadUnreadAdmin(t) { const seen = parseAt(t.seenByAdminAt); return (t.msgs || []).filter(m => m.who === 'phone' && !m.del && parseAt(m.at) > seen).length; }
function allThreadsFlat() {
  const out = [];
  for (const [id, d] of Object.entries(S.D.devices || {})) for (const t of visibleThreads(id)) out.push({ id, name: d.name || id, t });
  return out.sort((a, b) => parseAt(b.t.at) - parseAt(a.t.at));
}
function messagesUnread() { try { return allThreadsFlat().reduce((n, x) => n + threadUnreadAdmin(x.t), 0); } catch { return 0; } }

// The Messages tab: every phone's threads in one inbox, newest first.
function messagesScreen() {
  S.msgRef = null; S.msel = null;
  const flat = allThreadsFlat();
  return h('main', null,
    screenTitle('Messages', 'Conversations with every phone, newest first.'),
    msgManage() ? h('button', { type: 'button', class: 'btn p wide', style: 'margin-bottom:14px', onclick: () => { S.msgRef = null; open({ name: 'newmsg' }); } }, icon('send', 18), 'New message') : null,
    flat.length ? h('div', { class: 'msglist' }, ...flat.map(x => threadRowView(x.id, x.t, true)))
      : h('div', { class: 'empty' }, h('b', null, 'No messages yet'), 'Start a conversation with a phone, and replies appear here.'));
}
function threadRowView(id, t, showPhone) {
  const d = S.D.devices[id] || {}; const msgs = t.msgs || []; const last = msgs[msgs.length - 1];
  const unread = threadUnreadAdmin(t);
  const prev = !last ? '' : last.del ? 'Message deleted' : (last.who === 'admin' ? 'You: ' : '') + (last.text || (last.log ? 'App log' : last.ref ? 'About a request' : 'Message'));
  return h('button', { type: 'button', class: 'msgrow', onclick: () => open({ name: 'thread', id, thread: t.id }) },
    h('span', { class: 'msgav' }, adminInitials(d.name || id)),
    h('span', { class: 'msgmid' },
      h('span', { class: 'msgtop' }, h('span', { class: 'msgsubj' }, t.subject || 'Messages'), h('span', { class: 'msgtime' }, whenMsg(t.at))),
      h('span', { class: 'msgprev' + (unread ? ' un' : '') }, showPhone ? h('span', { class: 'msgtag' }, (d.name || id) + ' · ') : null, prev)),
    unread ? h('span', { class: 'badge' }, String(unread)) : null);
}

// One open thread: a full-height chat with a header, the conversation, read receipts, and a reply bar.
function threadScreen() {
  const { id, thread } = S.sub; const d = S.D.devices[id];
  if (!d) { S.sub = null; S.tab = 'messages'; return messagesScreen(); }
  const t = visibleThreads(id).find(x => x.id === thread);
  if (!t) { S.sub = null; S.tab = 'messages'; return messagesScreen(); }
  if (!S.msel || S.msel.thread !== thread) S.msel = null;      // selection belongs to one thread
  const scope = 'thread:' + thread;                            // a pending reference belongs to one composer only
  if (S.msgRefScope !== scope) { S.msgRef = null; S.msgRefScope = scope; }
  const selecting = !!(S.msel && S.msel.thread === thread && S.msel.ids.size);
  if (!selecting) markThreadRead(id, t);
  const msgs = (t.msgs || []).slice().sort((a, b) => parseAt(a.at) - parseAt(b.at));
  const body = msgs.length ? msgs.map(m => bubbleView(id, t, m, selecting)) : [h('p', { class: 'hint', style: 'margin:auto' }, 'No messages yet.')];
  setTimeout(() => { const el = $('chatThread'); if (el) el.scrollTop = el.scrollHeight; }, 0);
  const header = h('div', { class: 'chead' },
    h('button', { type: 'button', class: 'back', style: 'margin:0', onclick: () => { S.msel = null; S.sub = null; S.tab = 'messages'; render(); } }, icon('back', 20, 2), 'Messages'),
    h('span', { class: 'msgav' }, adminInitials(d.name || id)),
    h('span', { class: 'chmid' }, h('b', null, t.subject || 'Messages'), h('span', { class: 'chsub' }, d.name || id)),
    (msgManage() && msgs.some(m => !m.del)) ? h('button', { type: 'button', class: 'chsel', title: 'Select messages', onclick: () => { S.msel = { thread, ids: new Set() }; render(); } }, icon('check', 18, 2.2)) : null);
  const foot = selecting
    ? h('div', { class: 'selbar' }, h('span', null, `${S.msel.ids.size} selected`),
        h('button', { type: 'button', class: 'btn d sm', onclick: () => { S.msel = null; render(); } }, 'Cancel'),
        h('button', { type: 'button', class: 'btn p sm', disabled: S.msel.ids.size ? null : 'disabled', onclick: () => delSelected(id, t) }, 'Delete'))
    : (msgManage() ? composeRow(id, thread) : h('p', { class: 'hint', style: 'padding:10px 0' }, 'You can read this conversation, but not reply.'));
  return h('main', { class: 'thrd' }, header, h('div', { class: 'chat', id: 'chatThread' }, ...body), foot);
}

// A message bubble: request/log chip, text, and (admin's own) delivery/read ticks. In select mode a tap toggles it.
function bubbleView(id, t, m, selecting) {
  const d = S.D.devices[id] || {}; const mine = m.who === 'admin';
  const sel = selecting && !m.del && S.msel.ids.has(m.id);
  const parts = [];
  if (m.del) parts.push(h('div', { class: 'ctext del' }, 'Message deleted'));
  else {
    if (m.ref) parts.push(refChip(m.ref, mine, selecting));
    if (m.log) parts.push(logChip(id, m.log, mine, selecting));
    if (m.text) parts.push(h('div', { class: 'ctext' }, m.text));
  }
  parts.push(h('div', { class: 'cmeta' }, (mine ? (m.by ? m.by + ' · ' : '') : '') + whenMsg(m.at), mine && !m.del ? tickEl(d, t, m, id) : null));
  const attrs = { class: 'cbub ' + (mine ? 'me' : 'them') + (m.del ? ' gone' : '') + (sel ? ' sel' : '') };
  if (!m.del) {
    if (selecting) attrs.onclick = () => { if (S.msel.ids.has(m.id)) S.msel.ids.delete(m.id); else S.msel.ids.add(m.id); render(); };
    else { let timer = null;
      attrs.onpointerdown = () => { if (!msgManage()) return; timer = setTimeout(() => { S.msel = { thread: t.id, ids: new Set([m.id]) }; render(); }, 450); };
      attrs.onpointerup = () => clearTimeout(timer); attrs.onpointerleave = () => clearTimeout(timer); attrs.oncontextmenu = e => e.preventDefault();
    }
  }
  return h('div', attrs, ...parts);
}
function tickEl(d, t, m, id) {
  const read = parseAt(t.seenByPhoneAt) > 0 && parseAt(t.seenByPhoneAt) >= parseAt(m.at);
  // When the phone last synced: from seen.json (a number in ms), falling back to the record's own phoneSyncAt if present
  // (older data / other admins). phoneSyncAt is no longer carried in the owner's view, so seen.json is the source now.
  const sy = (typeof seenOf === 'function' && id) ? seenOf(id) : null;
  const syncAt = (sy && Number(sy.at)) || parseAt(d.phoneSyncAt);
  const delivered = syncAt > 0 && syncAt >= parseAt(m.at);
  return h('span', { class: 'tk' + (read ? ' read' : '') }, read || delivered ? '✓✓' : '✓');
}
function refChip(ref, mine, selecting) {
  return h('button', { type: 'button', class: 'rchip' + (mine ? ' onme' : ''), onclick: e => { e.stopPropagation(); if (!selecting) openRef(ref.number); } },
    icon('inbox', 15, 2), h('span', { class: 'rct' }, ref.subject || ('Request #' + ref.number)), h('span', { class: 'rcs' }, 'View'));
}
function logChip(id, log, mine, selecting) {
  return h('button', { type: 'button', class: 'rchip' + (mine ? ' onme' : ''), onclick: e => { e.stopPropagation(); if (!selecting) open({ name: 'log', id, file: log.file, from: { thread: S.sub.thread, id } }); } },
    icon('list', 15, 2), h('span', { class: 'rct' }, 'App log'), h('span', { class: 'rcs' }, 'Open'));
}
// Open a referenced request, remembering to come back to this thread afterwards.
function openRef(n) {
  const from = S.sub && S.sub.name === 'thread' ? { thread: S.sub.thread, id: S.sub.id } : null;
  if ((S.requests || []).some(i => i.number === n)) return open({ name: 'request', number: n, fromThread: from });
  if ((S.answeredList || []).some(i => i.number === n)) return open({ name: 'answered', number: n, fromThread: from });
  say('That request isn\'t in your current list.', true);
}
// Delete the selected messages, the same way as the phone: for everyone (a tombstone) or just from the admin view.
function delSelected(id, t) {
  const ids = [...S.msel.ids]; if (!ids.length) return;
  const forMe = () => { ids.forEach(mid => bg({ op: 'chatdel', device: id, thread: t.id, msg: mid, scope: 'me' }, null, () => markDelLocal(id, t.id, mid, 'me'))); S.msel = null; render(); say('Removed from your view.'); };
  const meBtn = h('button', { type: 'button', class: 'btn s wide', style: 'margin-top:4px', onclick: () => { forMe(); const c = $('dlgCancel'); if (c) c.click(); } }, 'Delete for me only');
  uiDialog({ title: ids.length === 1 ? 'Delete this message?' : `Delete ${ids.length} messages?`,
    text: 'Deleting for everyone removes them on the phone too, for good. “For me only” just hides them from your view.',
    icon: 'trash', red: true, danger: true, ok: 'Delete for everyone', cancel: 'Cancel', body: [meBtn],
    onOk: () => { ids.forEach(mid => bg({ op: 'chatdel', device: id, thread: t.id, msg: mid, scope: 'all' }, null, () => markDelLocal(id, t.id, mid, 'all'))); S.msel = null; render(); say('Deleted for everyone.'); } });
}
function markDelLocal(id, thread, msgId, scope) {
  const d = S.D.devices[id]; if (!d) return; const t = (d.threads || []).find(x => x.id === thread); if (!t) return;
  const m = (t.msgs || []).find(x => x.id === msgId); if (!m) return;
  if (scope === 'all') { m.del = true; delete m.text; delete m.ref; delete m.log; } else m.hideAdmin = true;
}
// Mark a thread read when the admin opens it, silently (no "Saved" noise, no notification — just the ticks).
function markThreadRead(id, t) {
  const newest = Math.max(0, ...(t.msgs || []).filter(m => m.who === 'phone').map(m => parseAt(m.at)));
  if (!newest || parseAt(t.seenByAdminAt) >= newest) return;
  S.seenSent = S.seenSent || {};
  const key = id + '|' + t.id;
  if ((S.seenSent[key] || 0) >= newest) return;
  S.seenSent[key] = newest;
  t.seenByAdminAt = new Date().toISOString();
  const d = S.D.devices[id]; if (d) d.adminViewAt = new Date().toISOString();
  setTimeout(() => { command({ op: 'chatseen', device: id, thread: t.id }).catch(e => console.log(`(carried on, chatseen) ${e && e.message}`)); }, 0);
}

// The reply bar: a paperclip (reference a request), the message box, and a round send button.
function composeRow(id, thread) {
  const input = h('textarea', { class: 'cinp', id: 'tReply', rows: '1', placeholder: 'Reply…',
    oninput: e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; } });
  const sendIt = () => {
    const text = input.value.trim(); const ref = S.msgRef || undefined;
    if (!text && !ref) return;
    S.msgRef = null;
    bg({ op: 'chat', device: id, thread, text, ref }, null, () => {
      const dd = S.D.devices[id]; const tt = (dd.threads || []).find(x => x.id === thread);
      if (tt) { tt.msgs = [...(tt.msgs || []), { id: 'tmp' + Date.now(), who: 'admin', text, at: new Date().toISOString(), by: (ME && ME.name) || 'You', ...(ref ? { ref } : {}) }]; tt.at = new Date().toISOString(); dd.adminViewAt = new Date().toISOString(); }
    });
  };
  const send = h('button', { type: 'button', class: 'csend', 'aria-label': 'Send', onclick: sendIt }, icon('send', 20, 2));
  const clip = h('button', { type: 'button', class: 'cclip' + (S.msgRef ? ' on' : ''), 'aria-label': 'Reference a request', onclick: () => attachRefMenu(id) }, icon('inbox', 20, 2));
  return h('div', null, h('div', { id: 'msgChip' }, chipInner()), h('div', { class: 'ccompose' }, clip, input, send));
}
function chipInner() {
  if (!S.msgRef) return null;
  return h('div', { class: 'rchip', style: 'margin:0 0 6px' }, icon('inbox', 15, 2),
    h('span', { class: 'rct' }, S.msgRef.subject || ('Request #' + S.msgRef.number)),
    h('button', { type: 'button', class: 'rcx', onclick: () => { S.msgRef = null; refreshChip(); const c = document.querySelector('.cclip'); if (c) c.classList.remove('on'); } }, 'Remove'));
}
function refreshChip() { const el = $('msgChip'); if (el) el.replaceChildren(...(chipInner() ? [chipInner()] : [])); }
function reqPhoneId(iss) { const raw = field(iss.body, 'Phone') || ''; const m = raw.match(/\(([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4})\)/i); return m ? m[1].toUpperCase() : null; }
// Reference a request: this phone's open requests and its recently answered ones.
function attachRefMenu(id) {
  // Closed requests live in answered.json, loaded lazily — fetch it once so they show here too.
  if (!Array.isArray(S.answeredList)) {
    const reopen = () => { document.querySelectorAll('.dlg-shade').forEach(s => s.remove()); attachRefMenu(id); };
    textOf('answered.json').then(t => { try { S.answeredList = JSON.parse(t || '[]'); } catch { S.answeredList = []; } reopen(); })
      .catch(() => { S.answeredList = []; reopen(); });
    return uiDialog({ title: 'Reference a request', icon: 'inbox', text: 'Loading your requests…', body: [], ok: 'Cancel', cancel: null });
  }
  const open0 = (S.requests || []).filter(iss => reqPhoneId(iss) === id).map(iss => ({ number: iss.number, title: describe(marker(iss.body)).title, when: 'Waiting' }));
  const closed = (S.answeredList || []).filter(x => x.phone === id).slice(0, 20).map(x => ({ number: x.number, title: describe(x.request).title, when: x.answer && x.answer.verdict === 'denied' ? 'Denied' : 'Approved' }));
  const all = [...open0, ...closed];
  const body = all.length ? all.map(r => h('button', { type: 'button', class: 'btn s wide', style: 'margin-top:6px;justify-content:space-between;text-align:left',
      onclick: () => { S.msgRef = { number: r.number, subject: r.title }; const c = $('dlgCancel'); if (c) c.click(); refreshChip(); const cc = document.querySelector('.cclip'); if (cc) cc.classList.add('on'); } },
      h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.title), h('span', { class: 'chip' + (r.when === 'Waiting' ? ' teal' : '') }, r.when)))
    : [h('p', { class: 'hint', style: 'margin:0' }, 'No requests from this phone yet.')];
  uiDialog({ title: 'Reference a request', icon: 'inbox', text: 'Link one of this phone\'s requests to your message.', body, ok: 'Done', cancel: null });
}

// Starting a new conversation: pick the phone, a subject, the first message, and an optional request reference.
function newMsgScreen() {
  S.msel = null;
  if (S.msgRefScope !== 'newmsg') { S.msgRef = null; S.msgRefScope = 'newmsg'; }
  const phones = Object.entries(S.D.devices || {}).map(([id, d]) => [id, d.name || id]).sort((a, b) => a[1].localeCompare(b[1]));
  if (!phones.length) { S.sub = null; S.tab = 'messages'; return messagesScreen(); }
  if (!S.newTo || !S.D.devices[S.newTo]) { S.newTo = (S.sub && S.sub.id) || phones[0][0]; S.msgRef = null; }
  const toSel = h('select', { class: 'inp', onchange: e => { S.newTo = e.target.value; S.msgRef = null; refreshChip(); } },
    phones.map(([id, nm]) => h('option', { value: id, selected: id === S.newTo ? 'selected' : null }, nm)));
  const subj = h('input', { class: 'inp', id: 'nmSubj', placeholder: 'e.g. Bedtime rules' });
  const msg = h('textarea', { class: 'inp', id: 'nmMsg', rows: '4', placeholder: 'Your message', style: 'resize:vertical' });
  const send = h('button', { type: 'button', class: 'btn p wide', onclick: () => {
    const id = S.newTo; const s = subj.value.trim(); const text = msg.value.trim(); const ref = S.msgRef || undefined;
    if (!id) return say('Pick a phone.', true);
    if (!s) return say('Type a subject.', true);
    if (!text && !ref) return say('Type a message.', true);
    S.msgRef = null; S.newTo = null; S.sub = null; S.tab = 'messages';
    bg({ op: 'chat', device: id, subject: s, text, ref }, 'Message sent.');
    render();
  } }, 'Start the conversation');
  return h('main', null,
    backLink('Messages', () => { S.msgRef = null; S.newTo = null; S.sub = null; S.tab = 'messages'; render(); }),
    screenTitle('New message', ''),
    h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'To'), toSel),
    h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Subject'), subj),
    h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Message'), msg),
    h('div', { class: 'field' }, h('div', { id: 'msgChip' }, chipInner()),
      h('button', { type: 'button', class: 'btn s sm', style: 'align-self:flex-start', onclick: () => attachRefMenu(S.newTo) }, icon('inbox', 16, 2), 'Reference a request')),
    send);
}

// Admin app / browser: register this device's push token (from the native bridge or the web SDK) so phone→admin
// messages wake it instantly. Web push needs the Firebase web config + a VAPID key (see FCM-SETUP.md); without
// them this is a no-op and the dashboard falls back to its normal refresh.
function registerAdminPush() {
  // 1) Admin app: a token from the native bridge.
  try {
    if (INAPP && window.WLBAdmin && WLBAdmin.fcmToken) {
      const token = WLBAdmin.fcmToken();
      if (token && token.length > 20) sendAdminToken(token);
    }
  } catch (e) { console.log(e); }
  // 2) Browser (dashboard in a normal browser): the Firebase web SDK, if it's configured.
  if (!INAPP) registerWebPush();
}
function sendAdminToken(token) {
  let last = '', lastAt = 0;
  try { last = localStorage.getItem('fcmToken') || ''; lastAt = Number(localStorage.getItem('fcmTokenAt') || 0); } catch {}
  if (token === last && Date.now() - lastAt < 7 * 86400000) return;
  command({ op: 'fcmtoken', token }).then(() => { try { localStorage.setItem('fcmToken', token); localStorage.setItem('fcmTokenAt', String(Date.now())); } catch {} })
    .catch(e => console.log(`(carried on, fcmtoken) ${e && e.message}`));
}
// Browser push via the Firebase JS SDK + a service worker. FIREBASE_WEB is filled in from your Firebase console
// (see FCM-SETUP.md). If it's left blank, this does nothing.
async function registerWebPush() {
  try {
    const cfg = window.FIREBASE_WEB;
    if (!cfg || !cfg.apiKey || !cfg.vapidKey || !('serviceWorker' in navigator) || !('Notification' in window)) return;
    if (Notification.permission === 'denied') return;
    if (Notification.permission !== 'granted') { const p = await Notification.requestPermission(); if (p !== 'granted') return; }
    const [{ initializeApp }, { getMessaging, getToken, onMessage }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js'),
    ]);
    const appF = initializeApp(cfg);
    const reg = await navigator.serviceWorker.register('firebase-messaging-sw.js');
    const messaging = getMessaging(appF);
    const token = await getToken(messaging, { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
    if (token) sendAdminToken(token);
    onMessage(messaging, () => { refreshData().catch(() => {}); });   // in-tab ping: just re-sync
  } catch (e) { console.log(`Web push not set up: ${e && e.message}`); }
}

// A compact Messages section on a phone's own screen (full inbox lives in the Messages tab).
function phoneMessages(id) {
  const ths = visibleThreads(id).slice().sort((a, b) => parseAt(b.at) - parseAt(a.at));
  return h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Messages'),
    ths.length ? h('div', { class: 'msglist' }, ...ths.map(t => threadRowView(id, t, false))) : h('p', { class: 'hint', style: 'margin:0' }, 'No messages yet.'),
    msgManage() ? h('button', { type: 'button', class: 'btn s sm', style: 'margin-top:8px', onclick: () => { S.msgRef = null; open({ name: 'newmsg', id }); } }, icon('send', 16, 2), 'New message') : null,
    h('p', { class: 'hint', style: 'margin:0' }, 'Also in the Messages tab. Shows on the phone under ⋮ → Messages.'));
}


// The Other browsers screen for one phone.
function browsersScreen() {
  const id = S.sub.id, d = S.D.devices[id];
  if (!d) { S.sub = null; return phoneScreen(); }
  const M = fullAdmin() || canDo('manage');
  const p = protectOf(d) || { mode: 'off', apps: {}, blockNew: true };
  const em = effectiveMode(id, d);   // the mode to SHOW: your setting, or what the phone reports if you haven't set one
  const st = protectState(id);
  const apps = seenApps(id).slice().sort((a, b) => (a.kind === 'browser' ? 0 : 1) - (b.kind === 'browser' ? 0 : 1) || (a.label || '').localeCompare(b.label || ''));
  const browsers = apps.filter(a => a.kind === 'browser' || a.kind === 'system');
  const browserPkgs = new Set(browsers.map(a => a.pkg));
  // Apps you've added to block (not web browsers): shown in their own list, each with the Allow/Block switch so a
  // blocked one can be undone.
  const addedList = (() => {
    const out = [], seen = new Set();
    apps.filter(a => (a.kind === 'added' || a.kind === 'app') && !browserPkgs.has(a.pkg) && p.apps && p.apps[a.pkg]).forEach(a => { if (!seen.has(a.pkg)) { out.push(a); seen.add(a.pkg); } });
    Object.keys(p.apps || {}).filter(pk => !seen.has(pk) && !browserPkgs.has(pk)).forEach(pk => { out.push(seenApps(id).find(a => a.pkg === pk) || { pkg: pk, label: pk, kind: 'added' }); seen.add(pk); });
    return out.sort((a, b) => (a.label || a.pkg).localeCompare(b.label || b.pkg));
  })();
  const name = firstName(d);
  const setMode = v => { const pr = ensureProtect(d); pr.mode = v; if (v === 'off') { pr.off = true; pr.offAt = Date.now(); } else { delete pr.off; delete pr.offAt; } markDevices(); render(); };
  const appRow = (a, added) => {
    const dec = appDecision(d, a);
    return h('div', { class: 'row', style: 'align-items:center;gap:10px' },
      h('span', { class: 'av', style: 'background:var(--chipoff);color:var(--ink2)' }, (a.label || '?')[0].toUpperCase()),
      h('span', { class: 'grow', style: 'min-width:0' }, h('span', { class: 'name' }, a.label || a.pkg),
        h('span', { class: 'dom mono', style: 'font-size:11px' }, a.pkg)),
      h('div', { class: 'seg', role: 'group', 'aria-label': `${a.label}: allow or block`, style: 'flex:none;width:9.5rem' },
        [['allow', 'Allow'], ['block', 'Block']].map(([v, t]) => h('button', { type: 'button', class: v === 'block' ? 'strict' : '', 'aria-pressed': String(dec === v),
          disabled: !M, onclick: () => {
            const pr = ensureProtect(d);
            // An app you added yourself drops off this list once you set it to Allow; real browsers stay listed.
            if (added && v === 'allow') delete pr.apps[a.pkg]; else pr.apps[a.pkg] = v;
            markDevices(); render(); } }, t))));
  };
  // Add an app the phone didn't flag as a browser (one with its own web view).
  const addApp = async () => {
    const others = seenApps(id).filter(a => a.kind === 'app' && !(p.apps && p.apps[a.pkg]));
    if (!others.length) { say('No other apps reported yet. The phone sends its app list every few minutes.', true); return; }
    const pick = h('select', { class: 'inp', id: 'addAppSel' }, [h('option', { value: '' }, 'Choose an app…'),
      ...others.sort((a, b) => (a.label || '').localeCompare(b.label || '')).map(a => h('option', { value: a.pkg }, a.label || a.pkg))]);
    const ok = await uiDialog({ title: 'Add an app', icon: 'globe', ok: 'Block it', body: [
      h('p', { class: 'hint', style: 'margin:0 0 8px' }, `An app that lets ${name} browse (say, a game with its own web window), to block it the same way.`), pick] });
    if (!ok || !pick.value) return;
    const pr = ensureProtect(d); pr.apps[pick.value] = 'block'; markDevices(); render();
  };
  const sw = (label, sub, on, change, disabled) => h('label', { class: 'tg', style: disabled ? 'opacity:.55' : '' },
    h('span', { class: 'grow' }, h('span', { class: 't' }, label), h('span', { class: 's' }, sub)),
    h('input', { type: 'checkbox', class: 'sw', checked: on, disabled: !!disabled, onchange: e => { change(e.target.checked); markDevices(); render(); } }));
  const isOwner = seenProtect(id) && seenProtect(id).owner;
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink(d.name || id, () => open({ name: 'phone', id })),
    screenTitle('Block other browsers', `Keep this the only way ${name} can open websites`),
    // What's set up on the phone now.
    h('div', { class: 'card', style: 'gap:8px' },
      h('div', { style: 'display:flex;align-items:center;gap:8px' }, h('b', { style: 'flex:1' }, 'Protection on the phone'),
        st ? h('span', { class: `chip ${st.tone}`, style: 'flex:none' }, st.label.split(' · ')[0]) : h('span', { class: 'chip', style: 'flex:none' }, 'No report yet')),
      // The per-means breakdown — what the phone has actually granted (the same four its own Protection screen shows).
      (() => { const rows = protectMeans(id); return rows ? h('div', { class: 'group', style: 'margin-top:2px' }, [h('div', { class: 'small muted', style: 'margin:0;padding:10px 16px 4px' }, 'On the phone now:'), ...rows.map(([t, on]) =>
        h('div', { class: 'ro' }, h('span', { class: 'grow' }, h('span', { class: 't' }, t)),
          h('span', { class: `chip ${on ? 'teal' : 'amber'}`, style: 'flex:none' }, on ? '✓ On' : 'Off')))]) : null; })(),
      (!protectMeans(id) && p.mode && p.mode !== 'off' && !(seenProtect(id) && seenProtect(id).owner)) ?
        h('p', { class: 'hint', style: 'margin:0' }, 'Waiting for the phone to report which permissions it has — open the app on the phone once it\'s online, and grant the steps it shows.') : null,
      protectionLapsed(id) ? h('p', { class: 'warn', style: 'margin:0' }, `Protection has lapsed on the phone${Array.isArray(seenProtect(id).missing) && seenProtect(id).missing.length ? ': ' + seenProtect(id).missing.join(', ') : ''}. Whoever has the phone was alerted to put it back.`) : null,
      seenProtect(id) && seenProtect(id).coverLists ? h('p', { class: 'hint', style: 'margin:0;color:var(--accent-text)' }, '✓ Also covering the whole Accessibility & Device admin lists.') : null,
      // Accessibility-recovery watchdog: what the phone reports (active / needs its one-time adb grant / waiting).
      (() => { const s = seenProtect(id); if (!s || !(s.recovery || p.recovery)) return null;
        if (s.recoveryActive) return h('p', { class: 'hint', style: 'margin:0;color:var(--accent-text)' }, '✓ Guard-recovery watchdog is active — the screen guard switches itself back on if it\'s turned off.');
        if (s.recovery && !s.recoveryGranted) return h('p', { class: 'warn', style: 'margin:0' }, 'Guard-recovery is on but needs its one-time adb grant on the phone (the phone\'s Protection screen shows the command). Until then it does nothing.');
        if (s.recovery) return h('p', { class: 'hint', style: 'margin:0' }, 'Guard-recovery is on (waiting for protection to be fully in place).');
        return null; })(),
      h('p', { class: 'hint', style: 'margin:0' }, 'Turned on from the phone (one switch under ⋮ → Settings → Protection & controls → Phone protection). Raising protection is free; turning it off sends you a request to approve.')),
    // Protection is a single on/off switch — device admin is the one method.
    M ? h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Protection'),
      h('div', { class: 'group' },
        sw('Protect this phone', 'Device admin: other browsers and blocked apps are covered the moment they open, and the app can\'t be removed without a step that\'s covered. Set up on the phone, no computer needed.', em !== 'off', on => setMode(on ? 'cover' : 'off')),
        em !== 'off' ? sw('Screen guard', 'Turn the screen guard off from here if you need to (the phone picks it up within a minute).', p.overlay !== false, v => { const pr = lockMode(d, 'cover'); pr.overlay = v; }) : null,
        em !== 'off' && p.overlay !== false ? sw('Cover the whole Accessibility & Device admin screens', 'Stronger: covers those entire settings screens, not just this app\'s own pages. Off by default (it also covers other apps on them). The phone can turn this on itself, but only you can turn it off.', p.coverLists === true, v => { const pr = lockMode(d, 'cover'); if (v) { pr.coverLists = true; delete pr.coverListsOff; } else { delete pr.coverLists; pr.coverListsOff = true; } }) : null,
        em !== 'off' && p.overlay !== false ? sw('Switch the screen guard back on if it\'s turned off', 'A watchdog that re-enables the screen guard the instant someone switches it off in Settings. One shared switch with the phone. Needs a one-time adb grant on the phone (shown on the phone\'s Protection screen); until that\'s done it does nothing.', p.recovery === true, v => { const pr = lockMode(d, 'cover'); if (v) { pr.recovery = true; delete pr.recoveryOffAt; } else { delete pr.recovery; pr.recoveryOffAt = Date.now(); } }) : null)) : null,
    // The apps.
    h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Apps that can open websites'),
      browsers.length ? h('div', { class: 'group' }, browsers.map(appRow))
        : h('p', { class: 'hint', style: 'margin:0' }, 'None reported yet. The phone sends its list every few minutes once it\'s online.'),
      M ? h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
        h('button', { type: 'button', class: 'btn s sm', onclick: addApp }, icon('plus', 15, 2.4), 'Add an app')) : null),
    // Apps you added (not browsers): their own list, same style, each with Allow / Block.
    (addedList.length || M) ? h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Apps you added to block'),
      addedList.length ? h('div', { class: 'group' }, addedList.map(a => appRow(a, true)))
        : h('p', { class: 'hint', style: 'margin:0' }, 'None yet. Use Add an app above to block an app that isn\'t a web browser (a game with its own web window, say).'),
      addedList.length ? h('p', { class: 'hint', style: 'margin:0' }, 'Set one to Allow and it drops off this list. Only phone-detected browsers stay.') : null) : null,
    M ? sw('Block new browsers straight away', 'A newly installed browser is blocked at once; you\'re asked, and can allow it.', p.blockNew !== false, v => { ensureProtect(d).blockNew = v; }) : null,
    h('p', { class: 'hint' }, 'This protection is visible on the phone: a blocked app shows a plain screen saying the browser is managed, and who by. You can switch it all off here at any time.'));
}

function timersScreen() {
  const all = Object.entries(timerDefs());
  const on = all.filter(([, t]) => timerOn(t) && !t.paused).length;
  const by = new Map();
  for (const [id, t] of all.sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''))) {
    const k = timerFor(t);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push([id, t]);
  }
  return h('main', { class: 'stack' },
    h('div', { style: 'display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap' },
      h('div', { class: 'grow' }, screenTitle('Timers', all.length ? `${plural(all.length, 'timer')} · ${on} on now` : 'Changes that switch on at set times')),
      canTimers() ? h('button', { type: 'button', class: 'btn p sm', id: 'newTimer', onclick: () => newTimer(null) }, icon('plus', 16, 2.4), 'New timer') : null),
    all.length ? null : h('div', { class: 'card empty' }, h('b', null, 'No timers yet'),
      'For example: Bedtime (nothing opens 21:00–07:00), Homework time (only the School list, 16:00–18:00), or an hour of YouTube a day.'),
    ...[...by.entries()].flatMap(([who, rows]) => [h('h2', { class: 'sec' }, who), h('div', { class: 'group' }, rows.map(([id, t]) => timerRow(id, t)))]),
    all.length ? h('p', { class: 'hint' }, 'When timers overlap, all of them apply and the strictest wins: an allowance that\'s used up blocks its sites even during a timer that opens them.') : null);
}
// One phone's timers (on its screen): its own and its groups'.
function phoneTimers(id) {
  const d = S.D.devices[id];
  const rows = Object.entries(timerDefs()).filter(([, t]) => (t.for.phones || []).includes(id) || (d.groups || []).some(g => (t.for.groups || []).includes(g)));
  return h('div', { class: 'field', id: 'pTimers' },
    h('div', { style: 'display:flex;align-items:center;gap:10px' }, h('span', { class: 'flabel grow' }, 'Timers'),
      canTimers() ? h('button', { type: 'button', class: 'btn s sm', id: 'pNewTimer', onclick: () => newTimer(id) }, icon('plus', 15, 2.4), 'New timer') : null),
    rows.length ? h('div', { class: 'group' }, rows.map(([tid, t]) => timerRow(tid, t)))
      : h('p', { class: 'hint', style: 'margin:0' }, 'None. A timer switches changes on at set times: bedtime, homework time, or so much time a day on some sites.'));
}
// Choices in a row: [[value, label]], the picked one pressed; red for the strict ones.
function choiceSeg(label, value, opts, set, disabled) {
  return h('div', { class: 'seg wrap', role: 'group', 'aria-label': label }, opts.map(([v, t]) =>
    h('button', { type: 'button', 'data-v': v, class: /^(none|blocked|off|no|paused)$/.test(v) ? 'strict' : '', 'aria-pressed': String((value || '') === v), disabled,
      onclick: () => { if ((value || '') !== v) set(v); } }, t)));
}
// One timer: everything about it.
function timerScreen() {
  const id = S.sub.id, t = timerDefs()[id];
  const backTo = () => { if (S.sub.from && S.D.devices[S.sub.from]) open({ name: 'phone', id: S.sub.from }); else { S.sub = null; S.tab = 'timers'; render(); } };
  const backLabel = S.sub.from && S.D.devices[S.sub.from] ? (S.D.devices[S.sub.from].name || S.sub.from) : 'Timers';
  if (!t) return h('main', { class: 'stack' }, backLink(backLabel, backTo), h('div', { class: 'card empty' }, h('b', null, 'Not there any more'), 'It was deleted.'));
  const ed = timerMine(t) && canTimers();
  const ch = (fn, redraw = true) => { fn(); markDevices(); if (redraw) render(); };
  t.for = t.for || { groups: [], phones: [] };
  t.during = t.during || {};
  const name = h('input', { class: 'inp', id: 'tName', value: t.name || '', maxlength: 40, readonly: !ed, oninput: e => { t.name = e.target.value; markDevices(); } });
  // For: groups and phones.
  const forChips = h('div', { class: 'chips', style: 'gap:8px', id: 'tFor' },
    (fullAdmin() ? groupIds() : []).map(g => { const on = t.for.groups.includes(g);
      return h('button', { type: 'button', class: 'lc pick', 'data-g': g, 'aria-pressed': String(on), disabled: !ed, onclick: () => ch(() => {
        t.for.groups = on ? t.for.groups.filter(x => x !== g) : [...t.for.groups, g]; }) }, on ? icon('check', 15, 2.4) : null, `${groupName(g)} (group)`); }),
    Object.entries(S.D.devices).sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || '')).map(([pid, d]) => { const on = t.for.phones.includes(pid);
      return h('button', { type: 'button', class: 'lc pick', 'data-p': pid, 'aria-pressed': String(on), disabled: !ed, onclick: () => ch(() => {
        t.for.phones = on ? t.for.phones.filter(x => x !== pid) : [...t.for.phones, pid]; }) }, on ? icon('check', 15, 2.4) : null, d.name || pid); }));
  // Kind.
  const KINDS = [['schedule', 'On a schedule', 'Days and hours, every week'], ['once', 'One time only', 'Doesn\'t repeat: from now (or a set day and time) for as long as you choose, then it\'s over'],
    ['allowance', 'A daily allowance', 'So much time a day on some sites or lists']];
  const kinds = h('div', { class: 'group', id: 'tKind' }, KINDS.map(([k, title, sub]) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name: 'tkind', value: k, checked: t.kind === k, disabled: !ed, onchange: () => ch(() => {
      const was = t.kind; t.kind = k;
      if (k === 'once') { t.startAt = t.startAt || Date.now(); if (was !== 'once') t.minutes = 120; }
      if (k === 'allowance') { if (was !== 'allowance') t.minutes = 60; t.on = t.on || { sites: [], lists: [] }; t.usedUp = t.usedUp || 'block'; t.days = t.days || [0, 1, 2, 3, 4, 5, 6]; }
      if (k === 'schedule') { t.days = t.days || [1, 2, 3, 4, 5]; t.from = t.from || '16:00'; t.to = t.to || '18:00'; }
    }) }), h('span', { class: 'grow' }, h('b', null, title), h('span', { class: 'small muted', style: 'display:block' }, sub)))));
  const dayChips = () => h('div', { class: 'chips daychips', style: 'gap:6px' }, DAYS.map((dn, i) => { const on = (t.days || []).includes(i);
    return h('button', { type: 'button', class: 'lc pick', 'data-day': i, 'aria-pressed': String(on), disabled: !ed, onclick: () => ch(() => {
      t.days = on ? t.days.filter(x => x !== i) : [...(t.days || []), i].sort(); }) }, dn); }));
  const timeIn = (idv, val, set) => h('input', { class: 'inp', id: idv, type: 'time', value: val, step: 300, readonly: !ed, style: 'max-width:9rem', onchange: e => { if (/^\d\d:\d\d$/.test(e.target.value)) { set(e.target.value); markDevices(); } } });
  // A picker for "how long" (hours and minutes).
  const howLong = (idv, min, set) => {
    const host = h('div', { id: idv, 'data-sync': '' });
    const lbl = h('div', { class: 'flabel' });
    host._picker = makePicker(host, min, m => { lbl.textContent = `${fmtMin(m)}`; if (m > 0 && ed) { set(m); markDevices(); } });
    lbl.textContent = fmtMin(min);
    return h('div', { class: 'stack', style: 'gap:2px' }, lbl, host);
  };
  const parts = [];
  if (t.kind === 'schedule') {
    parts.push(h('span', { class: 'flabel' }, 'When'), h('div', { class: 'card', style: 'gap:10px' }, dayChips(),
      h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, h('span', null, 'From'), timeIn('tFrom', t.from, v => { t.from = v; }), h('span', null, 'to'), timeIn('tTo', t.to, v => { t.to = v; })),
      hm(t.to) <= hm(t.from) ? h('p', { class: 'hint', style: 'margin:0' }, `Ends the next morning (${t.from} to ${t.to}).`) : null));
  } else if (t.kind === 'once') {
    const local = new Date(t.startAt - new Date(t.startAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    parts.push(h('span', { class: 'flabel' }, 'When'), h('div', { class: 'card', style: 'gap:10px' },
      choiceSeg('Starts', t.startAt <= Date.now() + 60000 ? 'now' : 'at', [['now', 'From now'], ['at', 'At a set time']], v => ch(() => { t.startAt = v === 'now' ? Date.now() : Date.now() + 3600000; }), !ed),
      t.startAt > Date.now() + 60000 ? h('input', { class: 'inp', id: 'tStart', type: 'datetime-local', value: local, readonly: !ed, onchange: e => { const v = Date.parse(e.target.value); if (v) { t.startAt = v; markDevices(); } } }) : null,
      h('span', { class: 'small muted' }, 'For how long'), howLong('tLong', t.minutes || 120, m => { t.minutes = m; }),
      timerOver(t) ? h('p', { class: 'hint', style: 'margin:0' }, 'This one is over. Change the time to use it again, or delete it.') : null));
  } else {
    t.on = t.on || { sites: [], lists: [] };
    const siteIn = h('input', { class: 'inp', id: 'tSite', type: 'text', placeholder: 'e.g. youtube.com', autocapitalize: 'off', spellcheck: 'false' });
    const addSite = () => { const v = siteIn.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) return say('Type a site, like youtube.com.', true);
      ch(() => { t.on.sites = [...new Set([...(t.on.sites || []), v])]; }); };
    parts.push(h('span', { class: 'flabel' }, 'Time a day'), h('div', { class: 'card', style: 'gap:10px' }, howLong('tLong', t.minutes || 60, m => { t.minutes = m; }), dayChips(),
      h('span', { class: 'small muted' }, 'Days it applies. Starts again at midnight.')),
      h('span', { class: 'flabel' }, 'On'), h('div', { class: 'card', style: 'gap:10px' },
        h('div', { class: 'chips', style: 'gap:8px' }, (t.on.sites || []).map(s => h('button', { type: 'button', class: 'lc pick', 'aria-pressed': 'true', disabled: !ed,
          'aria-label': `${s}: take it off`, onclick: () => ch(() => { t.on.sites = t.on.sites.filter(x => x !== s); }) }, s, icon('x', 14, 2.4))),
          S.lists.map(l => { const on = (t.on.lists || []).includes(l);
            return h('button', { type: 'button', class: 'lc pick', 'data-list': l, 'aria-pressed': String(on), disabled: !ed, onclick: () => ch(() => {
              t.on.lists = on ? t.on.lists.filter(x => x !== l) : [...(t.on.lists || []), l]; }) }, on ? icon('check', 15, 2.4) : null, `${listLabel(l)} list`); })),
        ed ? h('div', { style: 'display:flex;gap:8px' }, siteIn, h('button', { type: 'button', class: 'btn s sm', onclick: addSite }, 'Add')) : null,
        h('span', { class: 'small muted' }, 'Sites, or whole lists. Time counts only while one of them is on screen.')),
      h('span', { class: 'flabel' }, 'When it\'s used up'),
      h('div', { class: 'group' }, [['block', 'They\'re blocked until tomorrow'], ['media', 'Only videos and sound are blocked']].map(([v, tx]) => h('label', { class: 'radio' },
        h('input', { type: 'radio', name: 'tused', value: v, checked: (t.usedUp || 'block') === v, disabled: !ed, onchange: () => ch(() => { t.usedUp = v; }) }), h('span', { class: 'grow' }, tx)))),
      h('p', { class: 'hint', style: 'margin:0' }, 'On the phone: "32 min left today" while on them, a note at 5 minutes left, then "Ask for more time".'));
  }
  // During it (schedule and once).
  if (t.kind !== 'allowance') {
    const d = t.during;
    const set = (k, v) => ch(() => { if (v) d[k] = v; else delete d[k]; if (k === 'sites' && !['only', 'also'].includes(v)) delete d.lists; });
    const ROWS = [['sites', 'Sites', [['', 'No change'], ['only', 'Only some lists'], ['also', 'Also these lists'], ['none', 'Nothing opens']],
        { '': 'As the phone\'s lists say', only: `Only ${joinWords((d.lists || []).map(listLabel)) || 'the lists below'} open${(d.lists || []).length === 1 ? 's' : ''}`, also: 'The lists below open too', none: 'Nothing opens: a full screen instead' }],
      ['photos', 'Photos', [['', 'No change'], ['open', 'Open'], ['blocked', 'Blocked']], { '': 'As each site is set', open: 'Open on every site', blocked: 'Blocked on every site, whatever its setting' }],
      ['videos', 'Videos', [['', 'No change'], ['open', 'Open'], ['blocked', 'Blocked']], { '': 'As each site is set', open: 'Open on every site', blocked: 'Blocked on every site, whatever its setting' }],
      ['sound', 'Sound', [['', 'No change'], ['open', 'Open'], ['blocked', 'Blocked']], { '': 'As each site is set', open: 'Open on every site', blocked: 'Blocked on every site, whatever its setting' }],
      ['search', 'Search', [['', 'No change'], ['on', 'On'], ['off', 'Off']], { '': 'As the phone is set', on: 'A search box', off: 'No search box' }],
      ['ask', 'Asking for sites', [['', 'No change'], ['no', 'Can\'t ask']], { '': 'Requests can still be sent', no: 'Nothing new can be asked for (they can still ask for time)' }],
      ['temporary', 'Temporary access', [['', 'No change'], ['paused', 'Paused']], { '': 'Ones you approved still work', paused: 'Sites open "for a while" wait until it\'s over' }]];
    // The "lists that open" picker sits right under the Sites row, so it's clear what it belongs to.
    const listsPicker = () => h('div', { class: 'drow sublists', 'data-k': 'tLists' },
      h('span', { class: 'small', style: 'font-weight:600' }, d.sites === 'only' ? 'Lists that open during it' : 'Lists that also open during it'),
      h('div', { class: 'chips', style: 'gap:8px', id: 'tLists' }, S.lists.map(l => { const on = (d.lists || []).includes(l);
        return h('button', { type: 'button', class: 'lc pick', 'data-list': l, 'aria-pressed': String(on), disabled: !ed, onclick: () => ch(() => {
          d.lists = on ? d.lists.filter(x => x !== l) : [...(d.lists || []), l]; }) }, on ? icon('check', 15, 2.4) : null, listLabel(l)); })));
    parts.push(h('span', { class: 'flabel' }, 'During it'), h('div', { class: 'card during', style: 'gap:0;padding:4px 14px' },
      ROWS.flatMap(([k, title, opts, says], i) => {
        const row = h('div', { class: 'drow', 'data-k': k, style: i ? 'border-top:1px solid var(--line2)' : '' },
          h('b', null, title), choiceSeg(title, d[k], opts, v => set(k, v), !ed), h('span', { class: 'small muted' }, says[d[k] || '']));
        return (k === 'sites' && (d.sites === 'only' || d.sites === 'also')) ? [row, listsPicker()] : [row];
      })));
  }
  const del = async () => {
    if (!(await uiConfirmDanger(`Delete ${t.name || 'this timer'}?`, 'It stops on every phone it\'s for, within a few minutes.', 'Delete', 'trash'))) return;
    delete S.D.timers[id]; markDevices(); backTo(); say('Deleted. It saves automatically.');
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink(backLabel, backTo),
    h('div', { class: 'field' }, h('label', { for: 'tName' }, 'Name'), name),
    h('label', { class: 'tg', for: 'tOn' }, h('span', { class: 'grow' }, h('span', { class: 't' }, 'On'), h('span', { class: 's' }, t.paused ? 'Paused: it does nothing until you switch it on' : timerStatus(t)[0])),
      h('input', { type: 'checkbox', class: 'sw', id: 'tOn', checked: !t.paused, disabled: !ed, onchange: e => ch(() => { if (e.target.checked) delete t.paused; else t.paused = true; }) })),
    h('span', { class: 'flabel' }, 'For'), forChips,
    !t.for.groups.length && !t.for.phones.length ? h('p', { class: 'warn', style: 'margin:0' }, 'Pick who it\'s for: a group, or phones.') : null,
    h('span', { class: 'flabel' }, 'Kind of timer'), kinds, ...parts,
    h('p', { class: 'hint' }, 'Times follow the phone\'s own clock and time zone, so "16:00" means 4pm where the phone is.'),
    ed ? h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn dline', id: 'tDelete', onclick: del }, 'Delete timer'),
      h('button', { type: 'button', class: 'btn p grow', id: 'tDone', onclick: async () => { await saveAll(); backTo(); } }, 'Done')) : null,
    ed ? null : h('p', { class: 'hint' }, 'Only the main admin can change this one.'));
}

