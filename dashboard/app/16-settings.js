// ============================================================================================
// Settings
// ============================================================================================
// "Your account" (and, for the main admin, "Admins"), at the bottom of Settings.
function accountSection(section) {
  const status = `https://${C.owner.toLowerCase()}.github.io/${publicRepoName()}/`;
  const row = (ic, label, sub, onclick, id) => h('button', { type: 'button', class: 'row', onclick, id }, h('span', { class: 'ic' }, icon(ic, 20)),
    h('span', { class: 'grow' }, h('span', { class: 't' }, label), sub ? h('span', { class: 's' }, sub) : null), h('span', { class: 'chev' }, icon('chev', 18)));
  return section('Admin page', h('div', { class: 'group' },
    row('shield', 'Your account', ME ? `${ME.email}${getPin() || getBio() ? ` · locked on this ${INAPP ? 'phone' : 'device'}` : ''}` : '', () => open({ name: 'account' }), 'openAccount'),
    isOwner() ? row('phone', 'Admins', 'Add admins for some phones, and choose what they can do', () => { S.admins = null; open({ name: 'admins' }); }, 'openAdmins') : null,
    ADMINAPP ? row('download', 'App update', `${(() => { try { return 'Version ' + (WLBAdmin.appVersion ? WLBAdmin.appVersion() : '?') + ' · '; } catch { return ''; } })()}Check for a new version`, () => { try { WLBAdmin.updateApp(); } catch {} }, 'adminAppUpdate') : null,
    ADMINAPP ? row('ext', 'Share error log', 'Send the app\'s log to look into a problem', () => { try { WLBAdmin.shareLog(); } catch {} }, 'adminShareLog') : null,
    INAPP ? null : h('a', { class: 'row', href: status, target: '_blank', rel: 'noopener' }, h('span', { class: 'ic' }, icon('ext', 20)),
      h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, 'Open the status page')))));
}
function settingsScreen() {
  const D = S.D;
  const section = (title, ...kids) => h('section', { class: 'stack', style: 'gap:8px' }, h('h2', { class: 'sec', style: 'margin-top:4px' }, title), ...kids);
  // A mini admin: just their account (the settings for every phone aren't theirs to change).
  if (!fullAdmin()) return h('main', { class: 'stack' }, screenTitle('Settings', ME ? `Signed in as ${ME.name || ME.email}` : ''),
    h('div', { class: 'card' }, h('p', { style: 'margin:0' }, allPhonesAdmin() ? 'You look after every phone.' : `You look after ${plural(Object.keys(S.D.devices).length, 'phone')}: ${Object.values(S.D.devices).map(d => d.name || 'no name').join(', ') || 'none yet'}.`),
      h('p', { class: 'hint', style: 'margin:0' }, 'The settings for every phone are changed by the main admin.')),
    accountSection(section),
    INAPP && !ADMINAPP ? h('button', { type: 'button', class: 'btn s wide', onclick: () => $('closeBtn').click() }, 'Close admin and go back to the browser') : null);
  const row = (ic, label, count, onclick, id) => h('button', { type: 'button', class: 'row', onclick, id }, h('span', { class: 'ic' }, icon(ic, 20)),
    h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, label)), count != null ? h('span', { class: 'count' }, count) : null, h('span', { class: 'chev' }, icon('chev', 18)));
  const days = h('span', null, `${D.inactiveDays || 14} days`);
  const step = d => { D.inactiveDays = Math.max(1, Math.min(365, (D.inactiveDays || 14) + d)); days.textContent = `${D.inactiveDays} days`; markDevices(); };
  const status = `https://${C.owner.toLowerCase()}.github.io/${publicRepoName()}/`;
  return h('main', { class: 'stack' },
    screenTitle('Settings', 'For every phone'),
    !isOwner() ? h('div', { class: 'card' }, h('p', { class: 'hint', style: 'margin:0' }, 'Ads, filters and the approval PIN are set by the main admin.')) : section('Filters', h('div', { class: 'group' },
      h('label', { class: 'tg', for: 'adblock' }, h('span', { class: 'grow' }, h('span', { class: 't' }, 'Block ads'), h('span', { class: 's' }, 'AdGuard\'s ad lists (Base and Mobile Ads, plus its DNS list), updated daily by each phone')),
        h('input', { type: 'checkbox', class: 'sw', id: 'adblock', checked: D.adblock !== false, onchange: e => { D.adblock = e.target.checked; markDevices(); } })),
      ...AD_GROUPS.map(([key, title, desc]) => h('label', { class: 'tg', for: key }, h('span', { class: 'grow' }, h('span', { class: 't' }, title), h('span', { class: 's' }, desc)),
        h('input', { type: 'checkbox', class: 'sw', id: key, checked: D[key] !== false, onchange: e => { D[key] = e.target.checked; markDevices(); } }))),
      ...FILTERS.map(([key, title, desc]) => h('label', { class: 'tg', for: key }, h('span', { class: 'grow' }, h('span', { class: 't' }, title), h('span', { class: 's' }, desc)),
        h('input', { type: 'checkbox', class: 'sw', id: key, checked: D[key] !== false, onchange: e => { D[key] = e.target.checked; markDevices(); } }))),
      row('shield', 'Never block these addresses', (D.adblockExceptions || []).length || 'None', () => open({ name: 'neverblock' }), 'openNever'))),
    section('New phones start with', h('div', { class: 'group' }, [['photos', 'Open photos', 'Pictures on the pages'], ['videos', 'Open videos', 'Video players, and moving pictures'], ['sound', 'Open sound', 'Anything that plays sound']].map(([k, t, sub]) =>
      h('label', { class: 'tg', for: 'np_' + k }, h('span', { class: 'grow' }, h('span', { class: 't' }, t), h('span', { class: 's' }, sub)),
        h('input', { type: 'checkbox', class: 'sw', id: 'np_' + k, checked: !defBlocks({ mediaDefault: D.newPhoneMedia }, k), onchange: e => {
          const m = { mediaDefault: D.newPhoneMedia }; setDefault(m, k, e.target.checked ? 'open' : 'blocked');
          if (m.mediaDefault) D.newPhoneMedia = m.mediaDefault; else delete D.newPhoneMedia; markDevices(); } })))),
      h('p', { class: 'hint', style: 'margin:0' }, 'A new phone\'s default for photos, videos and sound. After that, each phone has its own (Phones → the phone), and changing these doesn\'t change phones you already have.')),
    section('New phones', h('div', { class: 'card', style: 'gap:8px' },
      h('span', { style: 'font-weight:600' }, 'Start with these lists'),
      h('div', { class: 'chips', style: 'gap:8px' }, S.lists.map(l => {
        const on = D.default.includes(l);
        return h('button', { type: 'button', class: 'lc pick dlist', 'aria-pressed': String(on), onclick: () => {
          D.default = on ? D.default.filter(x => x !== l) : [...D.default, l]; markDevices(); render(); } }, on ? icon('check', 15, 2.4) : null, listLabel(l));
      })),
      h('p', { class: 'hint', style: 'margin:0' }, 'Every phone also gets its own list, named after the person. The app\'s built-in starter lists follow these ticks from the next Build APK.'))),
    section('When you approve a request', h('div', { class: 'card', style: 'gap:8px' },
      h('span', { class: 'muted small' }, 'Change the list of'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'When you approve a request' },
        [['own', 'Just that phone'], ['public', 'Every phone']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String((D.requestsTo === 'public' ? 'public' : 'own') === v),
          onclick: () => { D.requestsTo = v; markDevices(); render(); } }, t))))),
    section('Phones that stop being used', h('div', { class: 'group' }, h('div', { class: 'tg', style: 'cursor:default' },
      h('span', { class: 'grow' }, h('span', { class: 't' }, 'Archive after'), h('span', { class: 's' }, 'Days without the app being opened')),
      h('div', { class: 'stepper' }, h('button', { type: 'button', 'aria-label': 'Fewer days', onclick: () => step(-1) }, '−'), days, h('button', { type: 'button', 'aria-label': 'More days', onclick: () => step(1) }, '+'))))),
    !isOwner() ? null : section('Approval PIN', h('div', { class: 'group' },
      h('button', { type: 'button', class: 'row', id: 'openApprovalPin', onclick: () => open({ name: 'approvalpin', scope: 'all' }) }, h('span', { class: 'ic' }, icon('shield', 20)),
        h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, 'PIN for all phones'),
          h('span', { class: 'dom' }, D.approvalPin ? 'Set: type it on a phone to approve a request there' : 'Not set')),
        h('span', { class: 'chev' }, icon('chev', 18))))),
    accountSection(section),
    INAPP && !ADMINAPP ? h('button', { type: 'button', class: 'btn s wide', onclick: () => $('closeBtn').click() }, 'Close admin and go back to the browser') : null);
}

