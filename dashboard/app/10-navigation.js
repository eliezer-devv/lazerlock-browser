// ============================================================================================
// Navigation
// ============================================================================================
let lastScreenKey = '';
// Leaving a screen that saves itself on exit (the site editor): commit its draft first, so a forgotten Done doesn't
// lose the change. Wrapped so a hiccup here can never block navigation.
function leaveSub() { try { if (S.sub && S.sub.name === 'site' && typeof S.sub.commit === 'function') S.sub.commit(); } catch (e) { console.log('leaveSub', e); } }
// Changing screen is a natural save point: commit the draft, then flush pending changes in the background (not awaited,
// so navigation stays instant). This is how "lots of settings, saved on page change" works.
function go(tab) { leaveSub(); flushSave(); S.tab = tab; S.sub = null; render(); }
function open(sub) { leaveSub(); flushSave(); S.sub = sub; render(); }
function back() { leaveSub(); flushSave(); S.sub = null; render(); }
// After answering a request from its detail screen, go back to the requests list instead of the "already answered" card.
function backOrRender() { if (S.sub && S.sub.fromThread) return reqBack(); if (S.sub && S.sub.name === 'request') back(); else render(); }
// After viewing/answering a request that was opened from a message, go back to that conversation.
function reqBack() { const f = S.sub && S.sub.fromThread; if (f && S.D.devices[f.id]) { S.sub = { name: 'thread', id: f.id, thread: f.thread }; S.tab = 'messages'; render(); } else back(); }
const reqBackLabel = () => (S.sub && S.sub.fromThread) ? 'Messages' : 'Requests';
const screenTitle = (title, sub) => h('div', { class: 'title' }, h('h1', null, title), sub ? h('p', null, sub) : null);
const backLink = (label, onclick = back) => h('button', { type: 'button', class: 'back', onclick }, icon('back', 20, 2), label);
function render() {
  const view = $('view');
  if (S.connected && S.pendingSub) { S.tab = 'phones'; S.sub = S.pendingSub; S.pendingSub = null; S.focusRequest = null; }
  let node;
  if (LINK && LINK.kind !== 'done') node = linkScreen();
  else if (S.starting) node = h('main', null, screenTitle('Opening…', ''), waitNote('Loading your data…'));
  else if (S.locked) node = unlockScreen();   // the lock is only a privacy screen for the person: it overlays whatever's underneath (a live, still-connected session) without disconnecting or disrupting it
  else if (!S.connected) node = signInScreen();
  else if (S.sub) node = ({ site: siteScreen, temp: tempScreen, block: blockScreen, nomedia: noMediaScreen, import: importScreen,
    listsettings: listSettingsScreen, phone: phoneScreen, archived: archivedScreen, neverblock: neverBlockScreen, pin: pinScreen,
    log: logScreen, account: accountScreen, admins: adminsScreen, admin: adminScreen, groups: groupsScreen, capabilities: capabilitiesScreen,
    approvalpin: approvalPinScreen, embeds: embedsScreen, request: requestDetailsScreen, answered: answeredDetailsScreen, timer: timerScreen, browsers: browsersScreen,
    thread: threadScreen, newmsg: newMsgScreen })[S.sub.name]();
  else node = ({ requests: requestsScreen, sites: sitesScreen, phones: phonesScreen, timers: timersScreen, messages: messagesScreen, settings: settingsScreen })[S.tab]();
  view.replaceChildren(node);
  const key = S.connected ? (S.sub ? 'sub:' + S.sub.name : 'tab:' + S.tab) : 'connect';
  if (key !== lastScreenKey) { window.scrollTo(0, 0); lastScreenKey = key; }
  const inSub = !S.connected || !!S.sub;
  $('app').classList.toggle('sub', inSub);
  // While the lock screen is up, hide the chrome (top bar, tabs, buttons) so it shows cleanly — the session is still
  // connected underneath, so these are only hidden for the lock, not disabled.
  document.querySelector('.top').hidden = S.locked || (!!S.sub && S.connected);
  $('tabs').hidden = inSub || S.locked;
  $('connBtn').hidden = !S.connected || S.locked;
  $('syncTop').hidden = !S.connected || S.locked;
  renderTabs(); renderSaveBar(); renderSync();
  view.querySelectorAll('[data-sync]').forEach(n => n._picker && n._picker.sync());
}
function renderTabs() {
  const waiting = S.requests ? S.requests.length + S.newPhones.length : 0;
  // (A mini admin sees only what they can use.)
  const tabs = [canDo('requests') ? ['requests', 'Requests', 'inbox', waiting] : null, canDo('edit') ? ['sites', 'Sites', 'globe', 0] : null,
    seesPhones() ? ['phones', 'Phones', 'phone', 0] : null, seesPhones() ? ['timers', 'Timers', 'clock', 0] : null,
    (seesPhones() || canDo('requests')) ? ['messages', 'Messages', 'send', messagesUnread()] : null, ['settings', 'Settings', 'sliders', 0]].filter(Boolean);
  $('tabs').replaceChildren(...tabs.map(([id, label, ic, badge]) => h('button', { type: 'button', 'aria-current': S.tab === id ? 'page' : null, onclick: () => go(id) },
    h('span', { class: 'pill' }, icon(ic, 22), badge ? h('span', { class: 'badge', 'aria-label': `${badge} waiting` }, badge) : null), label)));
}
$('syncTop').append(icon('sync', 20));
$('syncTop').onclick = () => syncNow($('syncTop'));
$('connBtn').onclick = () => go('settings');
$('syncPill').onclick = () => showSaveProblem();
$('closeBtn').hidden = !INAPP || ADMINAPP;
$('closeBtn').onclick = async () => {
  if ((S.listDirty || S.devDirty) && !(await uiConfirmDanger('Close without saving?', 'Your changes haven\'t been saved.', 'Close', 'warn'))) return;
  if ((QUEUE.sending || QUEUE.ops.length || CMDQ.sending) && !(await uiConfirmDanger('Still saving', 'Closing now may stop your last change from being saved. Wait a moment, or close anyway.', 'Close anyway', 'warn'))) return;
  closeAdmin();
};

