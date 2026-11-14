// ============================================================================================
// Your account (everyone), and Admins (the main admin): mini admins with their phones and what they can do
// ============================================================================================
const PERMS = [
  ['requests', 'Answer requests', 'Approve or deny their phones\' requests, into each phone\'s own list'],
  ['pin', 'Approve on the phone with their own PIN', 'Their personal PIN works in My requests on their phones'],
  ['edit', 'Edit their lists', 'Add and remove sites on their phones\' own lists, open things for a while'],
  ['manage', 'Manage their phones', 'Rename, block or unblock, archive, ask for a log'],
  ['logs', 'Messages and logs', 'Read what their phones send'],
  ['settings', 'Settings for every phone', 'Public lists, starting lists and where approvals go (only with All phones)'],
];
// A signed command from a screen: the button shows it's working, then the answer.
async function runCommand(btn, label, cmd, okText) {
  const was = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try {
    const r = await command(cmd);
    if (!r.ok) throw new Error(r.error);
    await refreshData(r.sha).catch(e => console.log(`(carried on, line 1974) ${e && e.message}`));
    S.admins = null;
    if (r.warning) say(r.warning, true); else say(r.msg || okText);
    return r;
  } catch (e) { if (e.message !== 'SIGNED_OUT') say(e.message, true); btn.disabled = false; btn.textContent = was; return null; }
}
async function adminsList() {
  if (S.admins) return S.admins;
  try { S.admins = JSON.parse(await fileText('admins.json') || '{}'); } catch { S.admins = {}; }
  return S.admins;
}
function whoText(a) {
  if (a.role === 'owner') return 'Main admin: everything';
  const g = (a.groups || []).map(x => (groupDefs()[x] || {}).name).filter(Boolean);
  const n = (a.phones || []).length;
  const phones = a.phones === 'all' ? 'All phones' : [g.length ? g.join(', ') : '', n ? `${n} phone${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ') || 'No phones';
  const what = PERMS.filter(([k]) => a.can && a.can[k]).map(([, t]) => t.toLowerCase());
  return `${phones}: ${what.length ? what.join(', ') : 'look only'}`;
}

function accountScreen() {
  const devs = Object.entries((ME && ME.devices) || {});
  const dev = DEV && DEV.did;
  const changePw = h('button', { type: 'button', class: 'btn p wide', id: 'acPwGo' }, 'Change password');
  changePw.onclick = async () => {
    const old = $('acOld').value, a = $('acNew').value, b = $('acNew2').value;
    if (!old) return say('Type your current password.', true);
    const bad = pwProblem(a); if (bad) return say(bad, true);
    if (a !== b) { $('acNew2').value = ''; return say('The two new passwords don\'t match.', true); }
    if (await runCommand(changePw, 'Changing… (up to a minute)', { op: 'password', old, password: a }, 'Password changed.')) { S.sub = null; render(); }
  };
  const signOut = async () => {
    if (!(await uiConfirm('Sign out on this device?', 'You\'ll need your email and password (and the emailed link) to sign in here again.', 'Sign out', { icon: 'warn' }))) return;
    command({ op: 'signout' }).catch(e => console.log(`(carried on, line 2007) ${e && e.message}`));
    await sleep(400); localStorage.removeItem(PIN_KEY); localStorage.removeItem(BIO_KEY);
    await signedOutHere(); say('Signed out on this device.');
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Settings'),
    screenTitle('Your account', ME ? `${ME.name ? ME.name + ' · ' : ''}${ME.email}` : ''),
    ...myPinSection(), ...notifySection(),
    h('h2', { class: 'sec' }, 'Signed in on'),
    h('div', { class: 'group', id: 'myDevices' }, devs.map(([did, d]) => h('div', { class: 'row' }, h('span', { class: 'ic' }, icon(did === dev ? 'check' : 'phone', 20)),
      h('span', { class: 'grow' }, h('span', { class: 't' }, d.name + (did === dev ? ' (this one)' : '')),
        h('span', { class: 's' }, `Since ${new Date(d.added).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` + (d.lastUsed ? ` · last used ${ago(d.lastUsed)}` : ''))),
      did === dev ? null : h('button', { type: 'button', class: 'btn d sm', onclick: () => bg({ op: 'device-remove', device: did }, `${d.name} is signed out.`, () => { delete ME.devices[did]; }) }, 'Sign out')))),
    h('p', { class: 'hint' }, 'Don\'t recognise one? Sign it out, and change your password.'),
    h('h2', { class: 'sec' }, 'Change password'),
    pwField('acOld', 'Current password', 'current-password'), pwField('acNew', 'New password', 'new-password'), pwField('acNew2', 'The same new password again', 'new-password'),
    h('p', { class: 'hint', style: 'margin:0' }, 'At least 8 characters, with a letter and a number.'), changePw,
    h('h2', { class: 'sec' }, 'This device'),
    // Test versions of the app (inside the app only): this phone updates to test builds too.
    (() => {
      let on = false; try { on = INAPP && window.WLBAdmin && WLBAdmin.testVersions ? !!WLBAdmin.testVersions() : null; } catch { on = null; }
      if (on === null || !INAPP) return null;
      return h('div', { class: 'group' }, h('label', { class: 'tg', for: 'testVersions' },
        h('span', { class: 'grow' }, h('span', { class: 't' }, 'Get test versions of the app'),
          h('span', { class: 's' }, 'This phone updates to test builds too, before everyone else (Build APK makes a test build; "Release to everyone" gives it to all phones)')),
        h('input', { type: 'checkbox', class: 'sw', id: 'testVersions', checked: on, onchange: e => {
          try { WLBAdmin.setTestVersions(e.target.checked); } catch {}
          say(e.target.checked ? 'Test versions on: this phone looks for one next time the app opens.' : 'Test versions off: this phone gets only versions released to everyone.');
        } })));
    })(),
    h('button', { type: 'button', class: 'btn s wide', id: 'openPin', onclick: () => open({ name: 'pin' }) },
      getPin() || getBio() ? `The lock: ${[getBio() ? 'fingerprint' : '', getPin() ? 'PIN' : ''].filter(Boolean).join(' and ')}` : 'Lock with a PIN or fingerprint'),
    // Browser capabilities: only meaningful inside the app (it inspects the app's own WebView).
    INAPP ? h('div', { class: 'group' }, h('button', { type: 'button', class: 'row', id: 'openCaps', onclick: () => open({ name: 'capabilities' }) },
      h('span', { class: 'ic' }, icon('shield', 20)),
      h('span', { class: 'grow' }, h('span', { class: 't' }, 'Browser capabilities'), h('span', { class: 's' }, 'What this phone’s browser supports, and what LazerLock uses')),
      h('span', { class: 'chev' }, icon('chev', 18)))) : null,
    h('button', { type: 'button', class: 'btn dline wide', id: 'signOut', onclick: signOut }, 'Sign out on this device'));
}

// What LazerLock turns on today, in plain words (a fixed list so it reads well regardless of the raw flag names below).
// What LazerLock turns on today, in plain words.
// What LazerLock already turns on (left out of the "could add" list below), by WebViewFeature flag.
const CAP_USED = ['WEB_AUTHENTICATION', 'ALGORITHMIC_DARKENING', 'SAFE_BROWSING_ENABLE', 'DOCUMENT_START_SCRIPT'];
const CAP_USED_LABELS = 'passkeys, dark mode for sites, Safe Browsing, mixed-content images, early ad-block injection';
// Capabilities worth considering — keyed by their androidx.webkit WebViewFeature flag, each with what turning it on
// would PRACTICALLY do (not just the flag name). The page shows only the ones THIS phone's engine actually supports and
// LazerLock doesn't already use, so it reads as "things you could add". An engine that lacks one simply never lists it.
const CAP_CATALOG = {
  MUTE_AUDIO: ['Mute a page’s sound', 'Silence a site’s audio from the app itself, without the page knowing — for the media controls and muting autoplay.'],
  PAYMENT_REQUEST: ['In-page payment (Web Payment)', 'Let a site show the Google Pay / card sheet in place, instead of sending the user off to a separate checkout page.'],
  BACK_FORWARD_CACHE: ['Instant Back / Forward', 'Keep the last few pages in memory so Back and Forward are instant instead of reloading the page.'],
  SPECULATIVE_LOADING: ['Preload the next page', 'Start loading the page a link is likely to open before it’s tapped, so it appears instantly.'],
  SUPPRESS_ERROR_PAGE: ['Custom “can’t reach site” page', 'Replace Chrome’s default error page with LazerLock’s own styled message when a site won’t load.'],
  REQUESTED_WITH_HEADER_ALLOW_LIST: ['Stop the app-identifier header', 'Stop sending the X-Requested-With header that tells every site which app is doing the browsing (privacy).'],
  ATTRIBUTION_REGISTRATION_BEHAVIOR: ['Turn off ad attribution', 'Switch off the browser’s ad-conversion measurement, so sites can’t register ad attributions (privacy).'],
  USER_AGENT_METADATA: ['Control what sites learn about the device', 'Set exactly what the browser reveals about the device (User-Agent Client Hints) — for privacy, or to force a site’s mobile or desktop version.'],
  MULTI_PROFILE: ['Separate profiles', 'Keep cookies, logins and history separate per profile — e.g. different people sharing a phone, or school vs. personal.'],
  PROXY_OVERRIDE: ['Route through a proxy', 'Send all web traffic through a proxy or an external content filter.'],
};
// The app checks package registries for newer library versions off the main thread and calls back here.
window.wlLibUpdates = (data) => { try { S.libUpdates = data; if (S.sub && S.sub.name === 'capabilities') render(); } catch {} };

function capabilitiesScreen() {
  // Start the library-update check once per visit; the result arrives asynchronously via window.wlLibUpdates.
  if (INAPP && window.WLBAdmin && WLBAdmin.checkLibraryUpdates && S.libUpdates === undefined) {
    S.libUpdates = 'loading';
    try { WLBAdmin.checkLibraryUpdates(); } catch { S.libUpdates = null; }
  }
  const head = [backLink('Your account', () => open({ name: 'account' })),
    screenTitle('Browser capabilities', 'Features this phone’s engine could add, and library updates')];
  let feats = null, wv = '';
  try { if (INAPP && window.WLBAdmin && WLBAdmin.browserFeatures) feats = JSON.parse(WLBAdmin.browserFeatures() || '[]'); } catch {}
  try { if (INAPP && window.WLBAdmin && WLBAdmin.webViewVersion) wv = String(WLBAdmin.webViewVersion() || ''); } catch {}
  if (!feats) return h('main', { class: 'stack', style: 'padding-bottom:24px' }, ...head,
    h('p', { class: 'hint' }, 'Open this inside the LazerLock admin app to see the browser’s capabilities — a web browser can’t report them.'));
  const byName = {}; feats.forEach(f => { byName[f.name] = !!f.supported; });

  // The point of this page: capabilities the engine supports that LazerLock doesn't use yet — what you could add, and
  // what each would practically do. Engine-unsupported ones aren't shown (there'd be nothing to add).
  const canAdd = Object.entries(CAP_CATALOG).filter(([k]) => byName[k] && !CAP_USED.includes(k));
  const addBody = canAdd.length
    ? h('div', { class: 'group' }, canAdd.map(([, [label, what]]) => h('div', { class: 'row' },
        h('span', { class: 'ic' }, icon('plus', 20)),
        h('span', { class: 'grow' }, h('span', { class: 't' }, label), h('span', { class: 's' }, what)))))
    : h('p', { class: 'hint' }, 'Nothing new to suggest right now — this engine supports what LazerLock already uses.');

  // Library updates: an in-app check against the package registries (just a "worth a look" signal).
  const hasLibCheck = INAPP && window.WLBAdmin && WLBAdmin.checkLibraryUpdates;
  const libBody = !hasLibCheck ? null
    : (S.libUpdates === 'loading' || S.libUpdates === undefined) ? h('p', { class: 'hint' }, 'Checking for newer versions…')
    : (!Array.isArray(S.libUpdates) || !S.libUpdates.length) ? h('p', { class: 'hint' }, 'Couldn’t check right now — try again later.')
    : h('div', { class: 'group' }, S.libUpdates.map(l => h('div', { class: 'row' },
        h('span', { class: 'ic' }, icon(l.update ? 'shield' : 'check', 20)),
        h('span', { class: 'grow' }, h('span', { class: 't' }, l.name + (l.update ? ' — update available' : '')),
          h('span', { class: 's' }, l.latest ? `On ${l.current}, newest ${l.latest}` : `On ${l.current} · couldn’t reach registry`)))));

  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, ...head,
    wv ? h('p', { class: 'hint', style: 'margin-bottom:4px' }, 'Engine: ' + wv) : null,
    h('h2', { class: 'sec' }, 'Features you could add'),
    h('p', { class: 'hint', style: 'margin-top:0' }, 'Things this phone’s engine can do that LazerLock doesn’t use yet. Tell me any you’d like and I’ll look into building it in.'),
    addBody,
    libBody ? h('h2', { class: 'sec' }, 'Library updates') : null,
    libBody ? h('p', { class: 'hint', style: 'margin-top:0' }, 'If one shows an update, tell me and I’ll check what it adds and whether it’s worth building in.') : null,
    libBody,
    h('p', { class: 'hint', style: 'margin-top:14px;opacity:.75' }, 'Already in use: ' + CAP_USED_LABELS + '.'));
}

// Your approval PIN: the main admin's is the one for all phones (Settings); a helper's own works on their phones only.
function myPinSection() {
  if (isOwner()) return [h('h2', { class: 'sec' }, 'Your approval PIN'),
    h('div', { class: 'group' }, h('button', { type: 'button', class: 'row', id: 'acOwnerPin', onclick: () => open({ name: 'approvalpin', scope: 'all' }) }, h('span', { class: 'ic' }, icon('shield', 20)),
      h('span', { class: 'grow' }, h('span', { class: 't' }, 'PIN for all phones'), h('span', { class: 's' }, S.D.approvalPin ? 'Set: it works on every phone' : 'Not set')),
      h('span', { class: 'chev' }, icon('chev', 18))))];
  if (!canDo('pin')) return [];
  const set = ME.pin && ME.pin.set;
  const pinIn = (id, label) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('input', { class: 'inp', id, type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: '4 to 8 digits', style: 'max-width:12rem;font-size:20px;letter-spacing:.2em' }));
  const go = h('button', { type: 'button', class: 'btn p', id: 'myPinGo' }, set ? 'Change my PIN' : 'Set my PIN');
  go.onclick = async () => {
    const a = $('myPin').value, b = $('myPin2').value;
    if (!/^\d{4,8}$/.test(a)) return say('The PIN needs 4 to 8 digits.', true);
    if (a !== b) { $('myPin2').value = ''; return say('The two PINs don\'t match. Type it again.', true); }
    bg({ op: 'setpin', pin: a }, 'Your PIN is set. It works on your phones within a few minutes.', () => { ME.pin = { set: new Date().toISOString() }; });
  };
  const remove = h('button', { type: 'button', class: 'btn d sm', id: 'myPinRemove' }, 'Remove my PIN');
  remove.onclick = async () => { if (await uiConfirm('Remove your PIN?', 'You won\'t be able to approve on the phone until you set one again.', 'Remove', { icon: 'warn' }) &&
    true) bg({ op: 'setpin', pin: '' }, 'Your PIN is removed.', () => { ME.pin = null; }); };
  const where = allPhonesAdmin() ? 'any phone' : `${plural(Object.keys(S.D.devices).length, 'phone')} you look after`;
  return [h('h2', { class: 'sec' }, 'Your approval PIN'),
    h('div', { class: 'card', style: 'gap:8px' },
      h('p', { style: 'margin:0' }, `Type it in My requests on ${where} to approve or deny a request right there. It works only on the phones you look after.`),
      h('p', { class: 'hint', style: 'margin:0' }, set ? `Set${typeof set === 'string' ? ' · last changed ' + new Date(set).toLocaleDateString([], { day: 'numeric', month: 'short' }) : ''}.` : 'Not set yet.'),
      INAPP ? pinKeypad([{ id: 'myPin', label: set ? 'New PIN' : 'Your PIN' }, { id: 'myPin2', label: 'Repeat PIN' }], () => go.onclick())
            : [pinIn('myPin', set ? 'New PIN' : 'Your PIN'), pinIn('myPin2', 'The same PIN again')],
      h('div', { class: 'acts' }, INAPP ? null : go, set ? remove : null),
      h('p', { class: 'hint', style: 'margin:0' }, 'It has to be different from every other admin\'s. It only approves requests: it doesn\'t open this admin page. After 5 wrong tries on a phone, PIN approvals lock on it.'))];
}
// Your notifications: on this phone (in the app), by email, and about what (only what you can see).
function notifySection() {
  const n = (ME && ME.notify) || { phones: [], email: false, kinds: {} };
  const here = (() => { try { return INAPP && window.WLBAdmin && WLBAdmin.deviceId ? String(WLBAdmin.deviceId()) : null; } catch { return null; } })();
  // (The admin app isn't a listed phone: its notes are sealed with its own key, kept with your account.)
  const onHere = !!here && (ADMINAPP ? !!(n.apps || {})[here] : (n.phones || []).includes(here));
  if (ADMINAPP && onHere && !S.appNotifySynced) { S.appNotifySynced = true; try { WLBAdmin.setNotify(true); } catch {} }
  // Each switch saves by itself (no Save button): it shows at once, and the "Saving…" pill shows it going to GitHub.
  const save = (el, cmd) => bg({ op: 'notify', ...cmd }, (cmd.phone || cmd.app) && cmd.here ? 'Notifications are on for this phone. They start within a few minutes.' : 'Notifications saved.', () => {
    const next = { phones: [], email: false, kinds: {}, ...(ME.notify || {}) };
    if ('email' in cmd) next.email = cmd.email;
    if (cmd.kinds) next.kinds = cmd.kinds;
    if (cmd.phone) next.phones = cmd.here ? [...new Set([...(next.phones || []), cmd.phone])] : (next.phones || []).filter(x => x !== cmd.phone);
    if (cmd.app) { next.apps = { ...(next.apps || {}) }; if (cmd.here) next.apps[cmd.app.id] = { name: cmd.app.name }; else delete next.apps[cmd.app.id]; }
    ME.notify = next;
  });
  const sw = (id, title, sub, on, onchange, disabled) => h('label', { class: 'tg', for: id, style: disabled ? 'opacity:.55' : '' },
    h('span', { class: 'grow' }, h('span', { class: 't' }, title), h('span', { class: 's' }, sub)),
    h('input', { type: 'checkbox', class: 'sw', id, checked: on, disabled: !!disabled, onchange }));
  const kindsNow = () => Object.fromEntries(KINDS_UI.map(([k]) => [k, (n.kinds || {})[k] !== false]));
  const anyOn = onHere || (n.phones || []).length > 0 || n.email;
  return [h('h2', { class: 'sec' }, 'Notifications'),
    h('div', { class: 'group' },
      sw('ntHere', 'On this phone', ADMINAPP ? 'A notification from the LazerLock Admin app on this phone'
          : here ? 'A notification from the LazerLock app on this phone'
          : 'Open this page in the LazerLock Admin app (or the LazerLock app) on your phone to turn this on',
        onHere, e => {
          const on = e.target.checked;
          if (ADMINAPP) {
            let key = ''; try { key = WLBAdmin.notifyKey(); } catch {}
            if (!key) { e.target.checked = !on; return say('This phone can\'t make the key for notifications.', true); }
            try { WLBAdmin.setNotify(on); } catch {}
            save(e.target, { app: { id: here, key, name: deviceName() }, here: on });
          } else save(e.target, { phone: here, here: on });
        }, !here),
      sw('ntEmail', 'By email', `To ${ME ? ME.email : 'you'}`, !!n.email, e => save(e.target, { email: e.target.checked }))),
    anyOn ? h('span', { class: 'flabel' }, 'Tell me about') : null,
    anyOn ? h('div', { class: 'group' }, KINDS_UI.map(([k, t, s, need]) => {
      const can = need.some(p => canDo(p));
      return sw(`nt-${k}`, t, can ? s : `Needs "${PERMS.find(([p]) => p === need[0])[1]}", which you don't have`, can && kindsNow()[k],
        e => save(e.target, { kinds: { ...kindsNow(), [k]: e.target.checked } }), !can);
    })) : null,
    h('p', { class: 'hint', style: 'margin:0' }, isOwner() ? 'About every phone.' : 'Only about the phones you look after, and only about things you\'re allowed to do.' +
      (onHere ? ' (On this phone: notifications must be allowed for the app, and on in its Settings.)' : ''))];
}
const KINDS_UI = [
  ['requests', 'New requests', 'Someone asks for a site or more time (and new phones, if you manage every phone)', ['requests']],
  ['messages', 'Messages and logs', 'A phone sends a message or its log', ['logs']],
  ['problems', 'Phone problems', 'The app crashed on a phone', ['manage']],
];

function adminsScreen() {
  if (!S.admins) { adminsList().then(() => render()); return h('main', { class: 'stack' }, backLink('Settings'), screenTitle('Admins', ''), waitNote('Loading…')); }
  const list = Object.entries(S.admins).sort(([, a], [, b]) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : (a.name || a.email).localeCompare(b.name || b.email)));
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Settings'),
    screenTitle('Admins', 'Who can open this admin page, and what they can do'),
    h('div', { class: 'group', id: 'adminRows' }, list.map(([aid, a]) => h('button', { type: 'button', class: 'row', 'data-aid': aid, disabled: !!a.sending, onclick: () => open({ name: 'admin', aid }) },
      h('span', { class: 'av' + (a.status === 'active' ? '' : ' grey') }, (a.name || a.email)[0].toUpperCase()),
      h('span', { class: 'grow', style: 'min-width:0' }, h('span', { class: 't' }, a.name || a.email),
        h('span', { class: 's' }, a.name ? `${a.email} · ${whoText(a)}` : whoText(a))),
      a.sending ? chip('Sending…', 'amber') : a.status === 'invited' ? chip('Invited', 'amber') : a.status === 'paused' ? chip('Paused', 'red') : null,
      h('span', { class: 'chev' }, icon('chev', 18))))),
    h('button', { type: 'button', class: 'btn p wide', id: 'addAdmin', onclick: () => open({ name: 'admin', aid: null }) }, icon('plus', 18, 2.2), 'Add an admin'),
    h('p', { class: 'hint' }, 'A new admin gets an email to confirm their address and choose a password; until then they can\'t sign in. ' +
      'You get an email whenever any admin signs in on a new device.'));
}

// Add an admin (aid null), or change one.
function adminScreen() {
  const aid = S.sub.aid;
  const a = aid ? (S.admins || {})[aid] : null;
  if (aid && !a) { S.sub = { name: 'admins' }; return adminsScreen(); }
  const f = S.sub.form || (S.sub.form = a ? { name: a.name, phones: a.phones === 'all' ? 'all' : [...(a.phones || [])], groups: [...(a.groups || [])], can: { ...(a.can || {}) } }
    : { name: '', email: '', phones: [], groups: [], can: { requests: true, pin: true, edit: true, manage: false, logs: true, settings: false } });
  if (a && a.role === 'owner') {
    return h('main', { class: 'stack' }, backLink('Admins', () => open({ name: 'admins' })), screenTitle(a.name || a.email, a.email),
      h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'The main admin can do everything, including adding and removing admins.'),
        h('p', { class: 'hint', style: 'margin:0' }, 'To make someone else the main admin, run "Set up admin sign-in" on GitHub with their email.')),
      aid === ME.aid ? h('button', { type: 'button', class: 'btn s wide', onclick: () => open({ name: 'account' }) }, 'Your account and devices') : null);
  }
  const phones = Object.entries(S.D.devices).sort(([, x], [, y]) => (x.name || '').localeCompare(y.name || ''));
  const allBox = h('input', { type: 'checkbox', class: 'sw', id: 'adAll', checked: f.phones === 'all', onchange: e => { f.phones = e.target.checked ? 'all' : []; render(); } });
  // Groups and single phones: two sections, side by side (one above the other on a narrow screen).
  const groupBoxes = f.phones === 'all' ? null : h('div', { class: 'group', id: 'adGroups' }, groupIds().length ? groupIds().map(g => h('label', { class: 'check row', for: `adg-${g}` },
    h('input', { type: 'checkbox', id: `adg-${g}`, checked: (f.groups || []).includes(g), onchange: e => { f.groups = e.target.checked ? [...(f.groups || []), g] : (f.groups || []).filter(x => x !== g); } }),
    h('span', { class: 'grow' }, h('span', { class: 't' }, groupName(g)), h('span', { class: 's' }, `${plural(phonesInGroup(g).length, 'phone')} + future`))))
    : h('p', { class: 'hint', style: 'padding:12px;margin:0' }, 'No groups yet (Phones → Groups).'));
  const phoneBoxes = f.phones === 'all' ? null : h('div', { class: 'group', id: 'adPhones' }, phones.length ? phones.map(([id, d]) => h('label', { class: 'check row', for: `adp-${id}` },
    h('input', { type: 'checkbox', id: `adp-${id}`, checked: f.phones.includes(id), onchange: e => { f.phones = e.target.checked ? [...f.phones, id] : f.phones.filter(x => x !== id); } }),
    h('span', { class: 'grow' }, h('span', { class: 't' }, d.name || 'No name yet'), h('span', { class: 's mono' }, id)))) : h('p', { class: 'hint', style: 'padding:12px;margin:0' }, 'No phones yet.'));
  const pickers = f.phones === 'all' ? null : h('div', { class: 'pickcols' },
    h('div', { class: 'stack', style: 'gap:6px;min-width:0' }, h('span', { class: 'flabel' }, 'Groups'), h('span', { class: 'hint', style: 'margin:0' }, 'Every phone in them, now and later'), groupBoxes),
    h('div', { class: 'stack', style: 'gap:6px;min-width:0' }, h('span', { class: 'flabel' }, 'Single phones'), h('span', { class: 'hint', style: 'margin:0' }, 'Just these phones'), phoneBoxes));
  const perms = h('div', { class: 'group' }, PERMS.filter(([k]) => k !== 'settings' || f.phones === 'all').map(([k, t, s]) => h('label', { class: 'tg', for: `adc-${k}` },
    h('span', { class: 'grow' }, h('span', { class: 't' }, t), h('span', { class: 's' }, s)),
    h('input', { type: 'checkbox', class: 'sw', id: `adc-${k}`, checked: !!f.can[k], onchange: e => { f.can[k] = e.target.checked; } }))));
  const email = a ? null : h('input', { class: 'inp', id: 'adEmail', type: 'email', autocapitalize: 'off', spellcheck: 'false', value: f.email || '', oninput: e => { f.email = e.target.value; } });
  const name = h('input', { class: 'inp', id: 'adName', value: f.name || '', placeholder: 'e.g. Ms Green', oninput: e => { f.name = e.target.value; } });
  const save = h('button', { type: 'button', class: 'btn p wide', id: 'adSave' }, a ? 'Save changes' : 'Send the invitation');
  save.onclick = async () => {
    const phonesOut = f.phones === 'all' ? 'all' : f.phones;
    const groupsOut = phonesOut === 'all' ? [] : (f.groups || []).filter(g => groupDefs()[g]);
    if (phonesOut !== 'all' && !phonesOut.length && !groupsOut.length) return say('Tick at least one group or phone (or All phones).', true);
    const canOut = { ...f.can }; if (phonesOut !== 'all') canOut.settings = false;
    if (a) {
      bg({ op: 'update', target: aid, name: f.name, phones: phonesOut, groups: groupsOut, can: canOut }, `${f.name || a.email}: saved.`,
        () => { S.admins[aid] = { ...a, name: f.name, phones: phonesOut, groups: groupsOut, can: canOut }; S.sub = { name: 'admins' }; });
    } else {
      const em = (f.email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return say('Type their email address.', true);
      bg({ op: 'invite', email: em, name: f.name, phones: phonesOut, groups: groupsOut, can: canOut }, `Invitation sent to ${em}.`, () => {
        S.admins[`sending-${em}`] = { email: em.toLowerCase(), name: f.name || '', role: 'admin', status: 'invited', sending: true, phones: phonesOut, groups: groupsOut, can: canOut };
        S.sub = { name: 'admins' };
      });
    }
  };
  const extra = [];
  if (a) {
    if (a.status === 'invited') extra.push(h('p', { class: 'warn' }, `Invited: waiting for them to confirm their email${a.invitedUntil ? ` (the link works until ${new Date(a.invitedUntil).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}.`),
      h('button', { type: 'button', class: 'btn s wide', id: 'adResend', onclick: () => bg({ op: 'resend', target: aid }, 'Invitation sent again.') }, 'Send the invitation again'));
    const devs = Object.entries(a.devices || {});
    if (devs.length) extra.push(h('h2', { class: 'sec' }, 'Signed in on'), h('div', { class: 'group' }, devs.map(([did, d]) => h('div', { class: 'row' }, h('span', { class: 'ic' }, icon('phone', 20)),
      h('span', { class: 'grow' }, h('span', { class: 't' }, d.name), h('span', { class: 's' }, d.lastUsed ? `Last used ${ago(d.lastUsed)}` : '')),
      h('button', { type: 'button', class: 'btn d sm', onclick: () => bg({ op: 'device-remove', target: aid, device: did }, `${d.name} is signed out.`, () => { delete S.admins[aid].devices[did]; }) }, 'Sign out')))));
    extra.push(h('div', { class: 'stack', style: 'gap:8px;margin-top:8px' },
      a.status === 'paused'
        ? h('button', { type: 'button', class: 'btn s wide', id: 'adUnpause', onclick: () => bg({ op: 'update', target: aid, status: 'active' }, 'They can sign in again.', () => { S.admins[aid].status = 'active'; S.sub = { name: 'admins' }; }) }, 'Let them sign in again')
        : a.status === 'active' ? h('button', { type: 'button', class: 'btn dline wide', id: 'adPause', onclick: async e => {
          const btn = e.currentTarget;
          if (!(await uiConfirm(`Pause ${a.name || a.email}?`, 'They\'re signed out everywhere and can\'t sign in until you let them again. Nothing else changes.', 'Pause', { icon: 'ban', red: true }))) return;
          bg({ op: 'update', target: aid, status: 'paused' }, 'Paused.', () => { S.admins[aid].status = 'paused'; S.sub = { name: 'admins' }; }); } }, 'Pause') : null,
      h('button', { type: 'button', class: 'btn d wide', id: 'adRemove', onclick: async e => {
        const btn = e.currentTarget;
        if (!(await uiConfirmDanger(`Remove ${a.name || a.email}?`, 'They can\'t sign in any more. You can invite them again later.', 'Remove'))) return;
        bg({ op: 'remove', target: aid }, 'Removed.', () => { delete S.admins[aid]; S.sub = { name: 'admins' }; }); } }, 'Remove')));
  }
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Admins', () => open({ name: 'admins' })),
    screenTitle(a ? (a.name || a.email) : 'Add an admin', a ? a.email : 'They get an email to confirm their address and choose a password.'),
    a ? null : h('div', { class: 'field' }, h('label', { for: 'adEmail' }, 'Their email'), email),
    h('div', { class: 'field' }, h('label', { for: 'adName' }, 'Name (optional)'), name),
    h('h2', { class: 'sec' }, 'Phones they look after'),
    h('div', { class: 'group' }, h('label', { class: 'tg', for: 'adAll' }, h('span', { class: 'grow' }, h('span', { class: 't' }, 'All phones'),
      h('span', { class: 's' }, 'Including new ones')), allBox)),
    pickers,
    h('h2', { class: 'sec' }, 'What they can do'), perms,
    h('p', { class: 'hint' }, 'Ads, content filters, the phones\' PIN settings, groups and admin phones stay yours. Public lists they can see but not change. ' +
      'They only ever see the phones ticked here, and what those phones use; GitHub\'s automation checks every change they make.'),
    save, ...extra);
}

// ---------- approval PIN (typed on a phone to approve a request on the spot) ----------
// Stored in devices.json only as a salted PBKDF2-SHA256 hash, the same way GitHub's check computes it.
async function hashApprovalPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, 256);
  return { salt: u8b64(salt), hash: u8b64(new Uint8Array(bits)), iter: 150000 };
}
async function samePin(pin, rec) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Uint8Array.from(atob(rec.salt), c => c.charCodeAt(0)), iterations: Number(rec.iter) || 150000, hash: 'SHA-256' }, base, 256);
  return u8b64(new Uint8Array(bits)) === rec.hash;
}
function approvalPinScreen() {
  const sub = S.sub, all = sub.scope === 'all';
  const d = all ? null : S.D.devices[sub.scope];
  const who = all ? 'all phones' : (d && (d.name || sub.scope));
  const had = all ? !!S.D.approvalPin : !!(d && d.approvalPin && typeof d.approvalPin === 'object');
  const done = () => all ? back() : open({ name: 'phone', id: sub.scope });   // back to where it was opened from
  const field = (id, label) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('input', { class: 'inp', id, type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: '4 to 8 digits', style: 'max-width:12rem;font-size:20px;letter-spacing:.2em' }));
  const saveBtn = h('button', { type: 'button', class: 'btn p wide', id: 'apSave' }, had ? 'Change the PIN' : 'Set the PIN');
  saveBtn.onclick = async () => {
    const a = $('apNew').value, b = $('apAgain').value;
    if (!/^\d{4,8}$/.test(a)) return say('The PIN needs 4 to 8 digits.', true);
    if (a !== b) { $('apAgain').value = ''; return say('The two PINs don\'t match. Type it again.', true); }
    saveBtn.disabled = true;
    // Never the same as a helper admin's own PIN (so each approval says whose PIN it was).
    for (const x of Object.values(await adminsList())) {
      if (x.pin && x.pin.salt && await samePin(a, x.pin)) { saveBtn.disabled = false; return say(`That's ${x.name || x.email}'s PIN. Choose a different one.`, true); }
    }
    const hashed = await hashApprovalPin(a);
    if (all) S.D.approvalPin = hashed; else d.approvalPin = hashed;
    markDevices(); done();
    say(`Approval PIN ${had ? 'changed' : 'set'} for ${who}. It saves automatically.`);
  };
  const remove = () => {
    if (all) delete S.D.approvalPin; else delete d.approvalPin;
    markDevices(); done(); say(`Approval PIN removed for ${who}. It saves automatically.`);
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink(all ? 'Settings' : who, done),
    screenTitle(had ? 'Change the approval PIN' : 'Set an approval PIN', `For ${who}`),
    h('p', { class: 'hint' }, 'When you\'re with someone who wants a site, you can type this PIN on their phone to approve their request there and then, ' +
      'instead of answering it here. It only approves requests: it doesn\'t open this admin page, and it can\'t open sites on the adult, gambling or malware lists (only you can, with Approve anyway). A 6-digit PIN is best. ' +
    'Helper admins allowed to approve on the phone have their own PINs, which work only on their phones.'),
    INAPP ? pinKeypad([{ id: 'apNew', label: 'New PIN' }, { id: 'apAgain', label: 'Repeat PIN' }], () => saveBtn.onclick())
          : [field('apNew', 'New PIN'), field('apAgain', 'The same PIN again'), saveBtn],
    had ? h('button', { type: 'button', class: 'btn d', id: 'apRemove', onclick: remove }, 'Remove this PIN') : null,
    h('p', { class: 'hint' }, 'After 5 wrong PINs on a phone, PIN approvals lock on it for 24 hours (unlock it under Phones). Only a scrambled version of the PIN is stored.'));
}

