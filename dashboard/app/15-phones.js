// ============================================================================================
// Phones
// ============================================================================================
// ---------- Groups of phones (e.g. everyone from one school): to see them together, and give helper admins ----------
const groupDefs = () => (S.D && S.D.groups && typeof S.D.groups === 'object') ? S.D.groups : {};
const groupName = g => (groupDefs()[g] || {}).name || g;
const groupIds = () => Object.keys(groupDefs()).sort((a, b) => groupName(a).localeCompare(groupName(b)));
const phonesInGroup = g => Object.entries(S.D.devices).filter(([, d]) => (d.groups || []).includes(g));
async function newGroup() {
  const nameIn = h('input', { class: 'inp', id: 'ngName', placeholder: 'e.g. Hillside School' });
  let id = '';
  const ok = await uiDialog({ title: 'New group', icon: 'phone', ok: 'Make it', body: [
    h('div', { class: 'field' }, h('label', { for: 'ngName' }, 'Its name'), nameIn),
    h('p', { class: 'hint', style: 'margin:0' }, 'Put phones in it from each phone\'s screen. A helper admin given the group looks after every phone in it, including ones added later.')],
    onOk: () => {
      const n = nameIn.value.trim();
      if (!n) { say('Type a name.', true); return false; }
      if (groupIds().some(g => groupName(g).toLowerCase() === n.toLowerCase())) { say('There\'s a group with that name already.', true); return false; }
      id = (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'group') + '-' + Math.random().toString(36).slice(2, 6);
      S.D.groups = { ...groupDefs(), [id]: { name: n.slice(0, 60) } };
    } });
  if (!ok) return null;
  markDevices();
  return id;
}
function groupsScreen() {
  const ids = groupIds();
  const rename = async g => {
    const nameIn = h('input', { class: 'inp', id: 'rgName', value: groupName(g) });
    const ok = await uiDialog({ title: 'Rename the group', icon: 'phone', ok: 'Rename', body: [h('div', { class: 'field' }, h('label', { for: 'rgName' }, 'Its name'), nameIn)],
      onOk: () => { if (!nameIn.value.trim()) { say('Type a name.', true); return false; } } });
    if (!ok) return;
    S.D.groups = { ...groupDefs(), [g]: { ...groupDefs()[g], name: nameIn.value.trim().slice(0, 60) } };
    markDevices(); render();
  };
  const remove = async g => {
    if (!(await uiConfirmDanger(`Delete ${groupName(g)}?`, 'The phones stay as they are; they just aren\'t in this group any more. Helper admins given this group no longer look after them.', 'Delete'))) return;
    const { [g]: _, ...rest } = groupDefs(); S.D.groups = rest;
    for (const d of [...Object.values(S.D.devices), ...Object.values(S.D.archived || {})]) if (d.groups) { d.groups = d.groups.filter(x => x !== g); if (!d.groups.length) delete d.groups; }
    markDevices(); render();
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Phones'),
    screenTitle('Groups', 'Phones that belong together, like everyone from one school'),
    ids.length ? h('div', { class: 'group' }, ids.map(g => h('div', { class: 'row' }, h('span', { class: 'ic' }, icon('phone', 20)),
      h('span', { class: 'grow' }, h('span', { class: 't' }, groupName(g)), h('span', { class: 's' }, plural(phonesInGroup(g).length, 'phone') + (phonesInGroup(g).length ? ': ' + phonesInGroup(g).map(([id, d]) => d.name || id).join(', ') : ''))),
      h('button', { type: 'button', class: 'btn s sm', onclick: () => rename(g) }, 'Rename'),
      h('button', { type: 'button', class: 'btn d sm', onclick: () => remove(g) }, 'Delete'))))
      : h('div', { class: 'card empty' }, h('b', null, 'No groups yet'), 'Make one, then put phones in it from each phone\'s screen.'),
    h('button', { type: 'button', class: 'btn p wide', id: 'newGroup', onclick: async () => { if (await newGroup()) render(); } }, icon('plus', 18, 2.2), 'New group'),
    h('p', { class: 'hint' }, 'Give a helper admin a group (Settings → Admins), and they look after every phone in it, including phones added to it later. Changes save automatically.'));
}

// When a phone last opened the app, and its version (from its check-in, every few hours).
const DAY = 86400000;
const seenOf = id => (S.seen && S.seen.phones && S.seen.phones[id]) || null;
const verNum = v => Number((String(v || '').match(/(\d+)$/) || [])[1]) || 0;
const olderApp = id => { const x = seenOf(id), l = S.seen && S.seen.latest; return !!(x && x.v && l && verNum(x.v) < verNum(l)); };
const daysAway = id => { const x = seenOf(id); return x ? Math.floor((Date.now() - x.at) / DAY) : null; };
function seenText(id) {
  const x = seenOf(id);
  if (!x) return null;
  const startOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((startOf(Date.now()) - startOf(x.at)) / DAY);
  return days <= 0 ? 'Used today' : days === 1 ? 'Used yesterday' : Date.now() - x.at >= 2 * DAY ? `Not seen for ${days} days` : `Used ${days} days ago`;
}
// The phone's clock: automatic time switched off, or changed by hand (timers and "for a while" go by GitHub's clock).
function clockNotes(id) {
  const c = (seenOf(id) || {}).clock;
  if (!c) return [];
  const out = [];
  if (c.auto === false) out.push('Automatic date and time is off on this phone.');
  if (c.changedAt && Date.now() - c.changedAt < 14 * DAY) out.push(`Its clock was changed by hand (${new Date(c.changedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}).`);
  if (out.length) out.push('Timers and "for a while" still go by GitHub\'s clock, so this doesn\'t get around them.');
  return out;
}
function phonesScreen() {
  const gf = S.groupFilter && groupDefs()[S.groupFilter] ? S.groupFilter : null;
  const entries = Object.entries(S.D.devices).filter(([, d]) => !gf || (d.groups || []).includes(gf))
    .sort(([, a], [, b]) => (!!a.name - !!b.name) || (a.name || '').localeCompare(b.name || ''));
  const archived = Object.keys(S.D.archived || {}).length;
  // One compact row per phone: name and ID, its lists, and only the tags that matter.
  const cards = entries.map(([id, d]) => {
    const off = [...AD_GROUPS, ...FILTERS].filter(([key]) => d[key] === 'off').map(([, title]) => title.replace('Block ', '').replace('Hide ', '').replace(/ and scams$/, ''));
    const away = daysAway(id), seen = seenText(id), v = (seenOf(id) || {}).v;
    const tags = [d.blocked ? chip('Blocked', 'red', 'ban') : null, !d.name ? chip('Needs a name', 'amber') : null,
      clockNotes(id).length ? chip('Clock', 'amber', 'clock') : null,
      protectionLapsed(id) ? chip('Protection', 'amber') : null,
      d.pinLockedUntil && Date.parse(d.pinLockedUntil) > Date.now() ? chip('Locked PIN', 'amber') : null,
      off.length ? chip(`${cap(off.join(', '))} off`, 'amber') : null].filter(Boolean);
    const lists = (d.blocked ? 'Blocked: no lists' : (d.lists || []).length
      ? (d.lists || []).map(l => ID_LIST.test(l) && l === id.toLowerCase() ? 'own list' : listLabel(l)).join(', ') : 'No lists') +
      ((d.groups || []).length ? ' · ' + d.groups.map(groupName).join(', ') : '');
    const find = [d.name, id, d.model, lists].join(' ').toLowerCase();
    const q = (S.phoneQuery || '').trim().toLowerCase();
    return h('button', { type: 'button', class: 'row phonerow phonecard', 'data-id': id, 'data-find': find, hidden: !!q && !find.includes(q), onclick: () => open({ name: 'phone', id }) },
      h('span', { class: 'av' }, (d.name || '?')[0].toUpperCase()),
      h('span', { class: 'grow', style: 'min-width:0;display:flex;flex-direction:column;gap:1px' },
        h('span', { style: 'display:flex;gap:6px;align-items:baseline;min-width:0' }, h('b', { class: 'pname' }, d.name || 'No name yet'), h('span', { class: 'muted small' }, id)),
        h('span', { class: 'muted small plists' }, lists),
        seen || v ? h('span', { class: 'small pseen', style: away >= 2 && !d.blocked ? 'color:var(--amber-ink,#8A5A00);font-weight:700' : 'color:var(--muted)' },
          [seen, v ? `App ${v}${olderApp(id) ? ' · older app' : ''}` : null].filter(Boolean).join(' · ')) : null),
      tags.length ? h('span', { class: 'chips', style: 'flex:none' }, tags) : null,
      h('span', { class: 'chev' }, icon('chev', 18)));
  });
  // Search: by name, ID, model or list, as you type.
  const search = h('div', { class: 'searchbox' }, icon('search', 18),
    h('input', { class: 'inp', id: 'phoneSearch', type: 'search', placeholder: 'Search phones: name, ID or list', 'aria-label': 'Search phones',
      value: S.phoneQuery || '', autocapitalize: 'off', spellcheck: 'false', oninput: e => {
        S.phoneQuery = e.target.value;
        const q = S.phoneQuery.trim().toLowerCase();
        let shown = 0;
        document.querySelectorAll('.phonerow').forEach(r => { const hit = !q || r.dataset.find.includes(q); r.hidden = !hit; if (hit) shown++; });
        $('phoneNone').hidden = shown > 0;
      } }));
  const addPhone = async () => {
    const idIn = h('input', { class: 'inp', id: 'apId', type: 'text', placeholder: 'e.g. K7M4-Q2XP', autocapitalize: 'characters', spellcheck: 'false' });
    const firstIn = h('input', { class: 'inp', id: 'apFirst', type: 'text', placeholder: 'e.g. Emma' });
    const lastIn = h('input', { class: 'inp', id: 'apLast', type: 'text', placeholder: 'e.g. Smith' });
    let id = '';
    const ok = await uiDialog({ title: 'Add a phone', icon: 'phone', ok: 'Add', body: [
      h('div', { class: 'field' }, h('label', { for: 'apId' }, 'The phone\'s ID'), idIn,
        h('span', { class: 'hint' }, 'On the phone: ⋮ → Settings → About this phone.')),
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:10px' },
        h('div', { class: 'field' }, h('label', { for: 'apFirst' }, 'First name'), firstIn),
        h('div', { class: 'field' }, h('label', { for: 'apLast' }, 'Last name'), lastIn))],
      onOk: () => {
        const raw = idIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        id = raw.slice(0, 4) + '-' + raw.slice(4);
        if (!/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(id)) { say('A phone ID looks like K7M4-Q2XP.', true); return false; }
        if (S.D.devices[id]) { say(`That phone is already listed as ${S.D.devices[id].name || id}.`, true); return false; }
      } });
    if (!ok) return;
    const first = firstIn.value.trim(), last = lastIn.value.trim();
    S.D.devices[id] = { name: [first, last].filter(Boolean).join(' '), lists: [...S.D.default] };
    if (first) S.D.devices[id].first = first;
    if (last) S.D.devices[id].last = last;
    markDevices(); open({ name: 'phone', id });
  };
  // Groups: tap one to see just its phones.
  const gchips = groupIds().length ? h('div', { class: 'chips', style: 'gap:8px' },
    [null, ...groupIds()].map(g => h('button', { type: 'button', class: 'lc pick', 'aria-pressed': String((gf || null) === g),
      onclick: () => { S.groupFilter = g; render(); } }, g ? groupName(g) : 'All phones'))) : null;
  return h('main', { class: 'stack' },
    screenTitle('Phones', `${plural(entries.length, 'phone')}${gf ? ` in ${groupName(gf)}` : ''}${archived && !gf ? ` · ${archived} archived` : ''}`),
    fullAdmin() || canDo('edit') || canDo('manage') ? null : h('p', { class: 'hint', style: 'margin:0' }, 'You can look at your phones and read what they send. Changing them is up to the main admin.'),
    // Phones where PIN approvals are locked (5 wrong PINs): unlock right here.
    (() => {
      const locked = Object.entries(S.D.devices).filter(([, d]) => pinLocked(d));
      if (!locked.length || !(fullAdmin() || canDo('manage'))) return null;
      // (A yellow banner for each, with Unlock: the way it always looked.)
      return h('div', { class: 'stack', id: 'lockedPins', style: 'gap:8px' }, locked.map(([id, d]) =>
        h('div', { class: 'warn', style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
          h('span', { style: 'flex:1;min-width:12rem' }, h('b', null, `${d.name || id}: `), `My requests PIN is locked (5 wrong PINs), until ${new Date(d.pinLockedUntil).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`),
          h('button', { type: 'button', class: 'btn s sm', onclick: () => unlockPin(id) }, 'Unlock'))));
    })(),
    // Not seen for 2 days or more: uninstalled, or another browser being used?
    (() => {
      const gone = entries.filter(([id, d]) => !d.blocked && daysAway(id) >= 2);
      return gone.length ? h('div', { class: 'warn', id: 'notSeen' }, gone.length === 1
        ? `${possessive(gone[0][1].name || gone[0][0])} phone hasn't opened the app for ${daysAway(gone[0][0])} days. It may have been uninstalled, or another browser is being used.`
        : `${joinWords(gone.map(([id, d]) => d.name || id))} haven't opened the app for 2 days or more. It may have been uninstalled, or another browser is being used.`) : null;
    })(),
    gchips,
    entries.length || gf ? search : null,
    entries.length ? h('div', { class: 'group phones' }, cards) : h('div', { class: 'card empty' }, h('b', null, 'No phones yet'), 'Phones appear here when the app is opened on them.'),
    h('p', { class: 'hint', id: 'phoneNone', hidden: !(S.phoneQuery || '').trim() || cards.some(c => !c.hidden) }, 'No phone matches.'),
    h('div', { class: 'group' },
      !isOwner() ? null : h('button', { type: 'button', class: 'row', id: 'openGroups', onclick: () => open({ name: 'groups' }) }, h('span', { class: 'ic' }, icon('phone', 20)),
        h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, 'Groups'), h('span', { class: 'muted small', style: 'display:block' }, 'Phones that belong together, like one school')),
        h('span', { class: 'count' }, groupIds().length), h('span', { class: 'chev' }, icon('chev', 18))),
      h('button', { type: 'button', class: 'row', id: 'openArchived', onclick: () => open({ name: 'archived' }) }, h('span', { class: 'ic' }, icon('archive', 20)),
        h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, 'Archived phones')), h('span', { class: 'count' }, archived), h('span', { class: 'chev' }, icon('chev', 18))),
      !fullAdmin() ? null : h('button', { type: 'button', class: 'row', id: 'addPhone', onclick: addPhone }, h('span', { class: 'ic' }, icon('plus', 20)),
        h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, 'Add a phone by its ID')), h('span', { class: 'chev' }, icon('chev', 18))),
      h('button', { type: 'button', class: 'row', id: 'exportPhones', onclick: exportAll }, h('span', { class: 'ic' }, icon('download', 20)),
        h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, 'Download everything as a spreadsheet'),
          h('span', { class: 'muted small', style: 'display:block' }, 'A tab for each list, and one for the phones')), h('span', { class: 'chev' }, icon('chev', 18))),
      !fullAdmin() ? null : h('button', { type: 'button', class: 'row', id: 'refreshAllPhones', onclick: async () => {
        if (!(await uiConfirm('Refresh all phones now?', 'Every phone is woken to pull the latest right away — useful after a batch of changes. (They also update on their own within a few minutes.)', 'Refresh all'))) return;
        const el = $('refreshAllPhones'); if (el) el.disabled = true;
        try { const r = await command({ op: 'refreshall' });
          if (r && r.ok) say(r.total ? `Waking ${plural(r.total, 'phone')} — they pull the latest within moments.` : 'No phones with instant push yet.');
          else say((r && r.error) || 'Couldn\'t do that just now.', true);
        } catch (e) { say(e.message || 'Couldn\'t do that just now.', true); }
        finally { const e2 = $('refreshAllPhones'); if (e2) e2.disabled = false; } } },
        h('span', { class: 'ic' }, icon('phone', 20)),
        h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, 'Refresh all phones now'),
          h('span', { class: 'muted small', style: 'display:block' }, 'Wake every phone to pull the latest changes instantly')),
        h('span', { class: 'chev' }, icon('chev', 18)))),
    h('p', { class: 'hint' }, 'Each phone asks for the person\'s first and last name when it\'s first opened. Its own list is named after its ID, and shown by the person\'s name. Tap a phone to rename it or change its lists.'));
}
// A phone's logs: "Get log" (the phone sends it at its next check), and the ones it has sent (newest first).
function logsSection(id, d) {
  if (!S.logFiles || S.logFiles.id !== id) {
    S.logFiles = { id, list: null, archived: [] };
    Promise.all([logFiles(id), logFiles(id, true)]).then(([l, a]) => { if (S.logFiles.id === id) { S.logFiles.list = l; S.logFiles.archived = a; render(); } })
      .catch(e => { if (S.logFiles.id === id) { S.logFiles.list = []; S.logFiles.err = e.message; render(); } });
  }
  const list = S.logFiles.list, archivedLogs = S.logFiles.archived || [];
  const newest = list && list[0] ? Date.parse(list[0].name.slice(0, 10) + 'T' + list[0].name.slice(11, 16).replace('-', ':') + ':00Z') : 0;
  const waiting = d.logRequested && d.logRequested > newest + 60000;
  const ask = async () => {
    d.logRequested = Date.now(); markDevices();
    await saveAll();
    say('Asked. The phone sends its log at its next check, within a few minutes (once it\'s online and the app is open).');
    render();
  };
  return h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Messages and logs'),
    h('p', { class: 'hint', style: 'margin:0' }, 'Messages from this phone\'s user, and the app\'s log: when you ask, when they send it, or after a crash. Kept 30 days. ' +
      (canDo('logs') ? 'Swipe one right to archive it (kept until deleted), or left to delete it.' : '')),
    fullAdmin() || canDo('manage') ? h('button', { type: 'button', class: 'btn s', id: 'pGetLog', onclick: ask }, 'Get log') : null,
    waiting ? h('p', { class: 'hint', style: 'margin:0' }, `Asked ${new Date(d.logRequested).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: waiting for the phone.`) : null,
    list == null ? h('p', { class: 'hint', style: 'margin:0' }, 'Looking for logs…')
      : list.length ? h('div', { class: 'group' }, list.map(f => {
          // A message shows its subject (read once, then kept); a log, "Log" and why it was sent.
          const isMsg = /_message\.txt$/.test(f.name), crash = /_after-a-crash\.txt$/.test(f.name);
          let info = null;
          if (isMsg) {
            S.msgInfo = S.msgInfo || {};
            const key = id + '/' + f.name;
            info = S.msgInfo[key];
            if (info === undefined) {
              S.msgInfo[key] = null;
              logText(id, f.name).then(t => { S.msgInfo[key] = { subject: (t.match(/^Subject: (.*)/) || [, 'Message'])[1], withLog: t.includes('───── The app\'s log ─────') }; render(); })
                .catch(() => { S.msgInfo[key] = { subject: 'Message', withLog: false }; render(); });
            }
          }
          const when = logLabel(f.name).split(' · ')[0];
          const canSwipe = canDo('logs');
          const wrap = r => canSwipe ? swipeLog(r, id, f.name, false) : r;
          return wrap(h('button', { type: 'button', class: 'row', onclick: () => open({ name: 'log', id, file: f.name, arc: f.arc }) },
            h('span', { class: 'ic', style: crash ? 'color:var(--red-ink,#8A2E1F)' : '' }, icon(isMsg ? 'send' : crash ? 'warn' : 'list', 20)),
            h('span', { class: 'grow' }, h('span', { class: 't' }, isMsg ? (info ? info.subject : 'Message') : 'Log'),
              h('span', { class: 's' }, isMsg ? `${when} · Message${info && info.withLog ? ', with the log' : ''}` : logLabel(f.name))),
            h('span', { class: 'chev' }, icon('chev', 18))));
        }))
      : h('p', { class: 'hint', style: 'margin:0' }, S.logFiles.err ? 'Couldn\'t look for logs: ' + S.logFiles.err : 'No logs yet.'),
    // Archived: put away (open one to restore or delete it).
    archivedLogs.length ? h('button', { type: 'button', class: 'btn s sm', id: 'logArchivedToggle', style: 'align-self:flex-start',
      onclick: () => { S.showArchivedLogs = !S.showArchivedLogs; render(); } }, `${S.showArchivedLogs ? 'Hide' : 'Show'} archived (${archivedLogs.length})`) : null,
    archivedLogs.length && S.showArchivedLogs ? h('div', { class: 'group', id: 'archivedLogs' }, archivedLogs.map(f => {
      const isMsg = /_message\.txt$/.test(f.name);
      return swipeLog(h('button', { type: 'button', class: 'row', onclick: () => open({ name: 'log', id, file: f.name, arc: true }) },
        h('span', { class: 'ic' }, icon('archive', 20)),
        h('span', { class: 'grow' }, h('span', { class: 't' }, isMsg ? 'Message' : 'Log'), h('span', { class: 's' }, logLabel(f.name))),
        h('span', { class: 'chev' }, icon('chev', 18))), id, f.name, true);
    })) : null);
}

function phoneScreen() {
  const id = S.sub.id;
  const d = S.D.devices[id];
  if (!d) { S.sub = null; return phonesScreen(); }
  // First and last name (the phone asks for both); "name" is the two together, used everywhere else.
  const parts = (d.name || '').trim().split(/\s+/);
  if (d.first === undefined && d.last === undefined && d.name) { d.first = parts[0] || ''; d.last = parts.slice(1).join(' '); }
  const setName = () => { d.name = [d.first, d.last].map(x => (x || '').trim()).filter(Boolean).join(' '); markDevices(); };
  // What you can change here: the main admin, everything; a helper, what they're allowed (the rest shows, read-only).
  const own = isOwner(), M = fullAdmin() || canDo('manage'), E = fullAdmin() || canDo('edit');
  const first = h('input', { class: 'inp', id: 'pFirst', value: d.first || '', placeholder: 'e.g. Emma', readonly: !M, oninput: e => { d.first = e.target.value; setName(); } });
  const last = h('input', { class: 'inp', id: 'pLast', value: d.last || '', placeholder: 'e.g. Smith', readonly: !M, oninput: e => { d.last = e.target.value; setName(); } });
  // The owner's email, typed at setup on the phone. Editable by the main admin; kept in devices.json.
  const email = h('input', { class: 'inp', id: 'pEmail', type: 'email', value: d.email || '', placeholder: 'e.g. parent@email.com', readonly: !M,
    // Update the model (and the save bar) as they type, but DON'T re-render — a re-render per keystroke rebuilds the
    // field and loses focus, so you can't type. Re-render once on blur, to refresh anything that depends on the email.
    oninput: e => { const v = e.target.value.trim(); if (v !== (d.email || '')) delete d.emailConfirmed; if (v) d.email = v; else delete d.email; markDevices(); },
    onchange: () => render() });
  const lists = h('div', { class: 'chips', style: 'gap:8px' }, S.lists.map(l => {
    const on = (d.lists || []).includes(l);
    return h('button', { type: 'button', class: 'lc pick', 'aria-pressed': String(on), disabled: !!d.blocked || !E, onclick: () => {
      d.lists = on ? d.lists.filter(x => x !== l) : [...(d.lists || []), l]; markDevices(); render(); } }, on ? icon('check', 15, 2.4) : null, listLabel(l));
  }));
  const req = h('select', { class: 'inp', id: 'pReq', disabled: !E, onchange: e => { if (e.target.value) d.requestsTo = e.target.value; else delete d.requestsTo; markDevices(); } },
    [['', 'The usual (see Settings)'], ['own', 'Its own list'], ...S.lists.map(n => [n, n === 'public' ? 'The default public list' : `The ${listLabel(n)} list`])].map(([v, t]) => h('option', { value: v }, t)));
  req.value = d.requestsTo === 'own' || S.lists.includes(d.requestsTo) ? d.requestsTo : '';
  const filterRows = [...AD_GROUPS, ...FILTERS].map(([key, title]) => h('div', { class: 'frow' },
    h('span', { class: 'small', style: 'font-weight:600' }, title.replace('Block ', '').replace(/^./, c => c.toUpperCase())),
    h('div', { class: 'seg', role: 'group', 'aria-label': title },
      [['', 'Usual'], ['on', 'On'], ['off', 'Off']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String((d[key] || '') === v),
        onclick: () => { if (v) d[key] = v; else delete d[key]; markDevices(); render(); } }, t)))));
  const pinMode = d.approvalPin === 'none' ? 'none' : (d.approvalPin && typeof d.approvalPin === 'object') ? 'own' : '';
  const pinSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Approval PIN' },
    [['', 'Usual'], ['own', 'Own PIN'], ['none', 'None']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(pinMode === v),
      onclick: () => {
        if (v === 'own') { if (pinMode !== 'own') open({ name: 'approvalpin', scope: id }); return; }
        if (v === 'none') d.approvalPin = 'none'; else delete d.approvalPin;
        markDevices(); render();
      } }, t)));
  const locked = d.pinLockedUntil && Date.parse(d.pinLockedUntil) > Date.now();
  const ads = h('div', { class: 'seg', role: 'group', 'aria-label': 'Ads' },
    [['', 'Usual'], ['on', 'Blocked'], ['off', 'Allowed']].map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String((d.adblock || '') === v),
      onclick: () => { if (v) d.adblock = v; else delete d.adblock; markDevices(); render(); } }, t)));
  // Block: keep it listed but allow nothing. Its lists are set aside, and Unblock gives them back.
  const block = async () => {
    if (!(await uiConfirmDanger(`Block ${d.name || id}'s phone?`, 'It won\'t be able to open any site until you unblock it. ' +
      'Its lists are kept, and come back exactly as they were when you unblock it.', 'Block', 'ban'))) return;
    d.blockedLists = [...new Set([...(d.lists || []), ...(d.blockedLists || [])])];
    d.lists = []; d.blocked = true;
    markDevices(); render();
    say(`${d.name || id} will be blocked in a few minutes.`);
  };
  const unblock = () => {
    d.lists = [...new Set([...(d.lists || []), ...(d.blockedLists || []).filter(l => S.lists.includes(l))])];
    delete d.blocked; delete d.blockedLists;
    markDevices(); render();
    say(`${d.name || id} will be unblocked in a few minutes.`);
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Phones'),
    h('div', { style: 'display:flex;align-items:center;gap:14px;padding:0 4px' }, h('span', { class: 'av big' }, (d.name || '?')[0].toUpperCase()),
      h('div', { style: 'min-width:0' }, h('h1', { style: 'margin:0;font:700 28px/1.15 var(--display);overflow-wrap:anywhere' }, d.name || 'No name yet'), h('span', { class: 'muted small mono' }, `${id}${d.model ? ' · ' + d.model : ''}`))),
    h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:10px' },
      h('div', { class: 'field' }, h('label', { for: 'pFirst' }, 'First name'), first),
      h('div', { class: 'field' }, h('label', { for: 'pLast' }, 'Last name'), last)),
    h('div', { class: 'field' }, h('label', { for: 'pEmail' }, 'Owner\'s email'), email,
      d.email ? h('p', { class: 'hint', style: `margin:0;${d.emailConfirmed ? 'color:var(--accent-text)' : ''}` },
        d.emailConfirmed ? '✓ Confirmed by the owner.' : 'Not confirmed yet — the owner enters the emailed code on the phone.') : null),
    // My requests PIN locked (5 wrong PINs): a yellow banner at the top, with Unlock.
    locked ? h('div', { class: 'warn', id: 'pinLockedBanner', style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
      h('span', { style: 'flex:1;min-width:12rem' }, `My requests PIN is locked (5 wrong PINs), until ${new Date(d.pinLockedUntil).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`),
      M ? h('button', { type: 'button', class: 'btn s sm', id: 'pinUnlock', onclick: () => unlockPin(id) }, 'Unlock') : null) : null,
    d.blocked ? h('p', { class: 'warn' }, `Blocked: it can't open any site. Its lists (${(d.blockedLists || []).map(listLabel).join(', ') || 'none'}) come back when you unblock it.`) : null,
    phoneSeenPart(id, d, M),
    h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Lists it uses'), lists,
      h('p', { class: 'hint', style: 'margin:0' }, d.blocked ? 'Unblock it to change its lists.' : 'A site opens if any of these allows it, and is blocked if any of them blocks it.')),
    own ? h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Groups'),
      h('div', { class: 'chips', style: 'gap:8px' }, groupIds().map(g => {
        const on = (d.groups || []).includes(g);
        return h('button', { type: 'button', class: 'lc pick', 'aria-pressed': String(on), onclick: () => {
          d.groups = on ? (d.groups || []).filter(x => x !== g) : [...(d.groups || []), g];
          if (!d.groups.length) delete d.groups;
          markDevices(); render(); } }, on ? icon('check', 15, 2.4) : null, groupName(g));
      }), h('button', { type: 'button', class: 'lc addtxt', onclick: async () => {
        const g = await newGroup(); if (g) { d.groups = [...(d.groups || []), g]; markDevices(); render(); } } }, icon('plus', 15, 2.4), 'New group')),
      h('p', { class: 'hint', style: 'margin:0' }, 'Helper admins given a group look after every phone in it.')) : null,
    phoneMediaAndSearch(id, d, M),
    phoneTimers(id),
    phoneBrowsers(id, d, M),
    phoneMessages(id),
    h('div', { class: 'field' }, h('label', { for: 'pReq' }, 'When you approve its requests, change'), req),
    own ? [    h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Approval PIN'), pinSeg,
      h('p', { class: 'hint', style: 'margin:0' }, pinMode === 'own' ? 'This phone has its own PIN.' : pinMode === 'none' ? 'Requests from this phone can\'t be approved with a PIN.'
        : S.D.approvalPin ? 'Uses the PIN for all phones (Settings).' : 'No PIN for all phones is set (Settings).'),
      pinMode === 'own' ? h('button', { type: 'button', class: 'btn s sm', onclick: () => open({ name: 'approvalpin', scope: id }) }, 'Change its PIN') : null,
      pinMode === 'none' ? null : pinsHere(id),
      locked ? null
        : h('button', { type: 'button', class: 'btn s sm', id: 'pinUnlockAny', onclick: () => unlockPin(id) }, 'Unlock PIN approvals on this phone'),
      locked ? null : h('p', { class: 'hint', style: 'margin:0' }, 'If the phone says PIN approval is locked, this unlocks it (it picks it up within a few minutes).')),
    h('details', { class: 'more' }, h('summary', null, 'Ads & content filters'),
      h('div', { class: 'field', style: 'margin-top:8px' }, h('span', { class: 'flabel' }, 'Ads'), ads),
      h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Filters'), ...filterRows,
        h('p', { class: 'hint', style: 'margin:0' }, 'Usual follows Settings → Filters.'))),
    h('label', { class: 'tg', for: 'pAdmin' }, h('span', { class: 'grow' }, h('span', { class: 't' }, 'Admin phone'),
        h('span', { class: 's' }, 'Gets phone notifications about new requests, logs and crashes (it can switch them off in its Settings)')),
      h('input', { type: 'checkbox', class: 'sw', id: 'pAdmin', checked: d.admin === true, onchange: e => {
        if (e.target.checked) d.admin = true; else delete d.admin; markDevices(); } }))]
      : readOnlyPart(d, locked, M),
    canDo('logs') ? logsSection(id, d) : null,
    !M ? null : h('div', { class: 'stack', style: 'gap:8px;margin-top:8px' },
      h('button', { type: 'button', class: 'btn s wide', id: 'pRefresh', onclick: async () => {
        const el = $('pRefresh'); if (el) el.disabled = true;
        try { const r = await command({ op: 'refreshone', id });
          if (r && r.ok) say(`${d.name || id} is refreshing now.`); else say((r && r.error) || 'Couldn\'t do that just now.', true);
        } catch (e) { say(e.message || 'Couldn\'t do that just now.', true); }
        finally { const e2 = $('pRefresh'); if (e2) e2.disabled = false; } } }, 'Refresh this phone now'),
      d.blocked ? h('button', { type: 'button', class: 'btn s wide', id: 'pUnblock', onclick: unblock }, 'Unblock this phone')
        : h('button', { type: 'button', class: 'btn dline wide', id: 'pBlock', onclick: block }, 'Block this phone'),
      h('button', { type: 'button', class: 'btn s wide', id: 'pArchive', onclick: () => archiveNow(id) }, 'Archive now'),
      h('p', { class: 'hint' }, 'Block: it stays here but can\'t open any site, for a lost phone or one that shouldn\'t be used. ' +
        'Archive: put it away, with its own list, until it\'s needed again (Phones → Archived phones → Restore). If it\'s still being used, it comes back by itself.')));
}
// Last used, app version ("Ask it to update"), and its clock.
function phoneSeenPart(id, d, M) {
  const x = seenOf(id);
  if (!x) return null;
  const asked = Number(d.updateRequested) > x.at;
  const ask = async () => { d.updateRequested = Date.now(); markDevices(); await saveAll(); say('Asked. The phone offers the update next time the app is open.'); render(); };
  const notes = clockNotes(id);
  const sp = seenProtect(id);
  const lapsed = protectionLapsed(id);
  return h('div', { class: 'stack', style: 'gap:6px' },
    h('div', { class: 'card kvs', style: 'padding:6px 14px' },
      h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Last used'), h('span', { class: 'v' }, `${seenText(id)} (${new Date(x.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})`)),
      x.v ? h('div', { class: 'kv' }, h('span', { class: 'k' }, 'App'), h('span', { class: 'v' }, `${x.v}${olderApp(id) ? ` (newest: ${S.seen.latest})` : ' (up to date)'}`)) : null),
    olderApp(id) && M ? h('button', { type: 'button', class: 'btn s sm', id: 'pAskUpdate', disabled: asked, onclick: ask }, asked ? 'Asked it to update' : 'Ask it to update') : null,
    // Protection lapsed: Android dropped a means (the cover, uninstall lock or battery) while the phone is meant to
    // be protected. Shown like the clock warning, with what's missing, so it's noticed remotely.
    lapsed ? h('p', { class: 'warn', id: 'pProtect', style: 'margin:0' },
      `Protection needs attention on this phone: ${(Array.isArray(sp.missing) && sp.missing.length ? sp.missing.join(', ') : 'a protection is off')}. Ask whoever has the phone to reopen LazerLock → ⋮ → Settings → Protection & controls → Phone protection and tap the part that's off.`) : null,
    notes.length ? h('p', { class: 'warn', id: 'pClock', style: 'margin:0' }, notes.join(' ')) : null);
}
// A phone's default for photos, videos and sound, and its text search. Changed by those who manage the phone.
function phoneMediaAndSearch(id, d, M) {
  const fname = firstName(d), who = possessive(fname);
  const sw = (sid, on, change, disabled) => h('input', { type: 'checkbox', class: 'sw', id: sid, checked: on, disabled, onchange: e => change(e.target.checked) });
  // Whether a PIN is set. The PIN's hash is owned by the phone and reported in seen.json (it isn't in devices.json for a
  // full admin), so read it from there — but only a hash newer than the last reset counts, so a reset shows as cleared
  // straight away rather than lingering until the phone next syncs. The sub-admin view carries a plain `set` flag.
  const op = d.openPin || {};
  const seenRec = seenOf(id) || {}, seenOp = (seenRec.openPin && typeof seenRec.openPin === 'object') ? seenRec.openPin : {};
  const seenSetFresh = !!(seenOp.set && (!op.resetAt || (seenRec.at || 0) > op.resetAt));
  const opSet = !!(op.hash || op.set || seenSetFresh);
  // A temporary pause: armed by the admin (pauseMins/pauseAt); the phone reports when it actually started (pauseStart),
  // which is its first app-open after arming. "Waiting" = armed but the phone hasn't opened yet; "running" = the window
  // is counting down now; once it ends the phone is back on by itself (so the row shows "On" again).
  const pauseMins = Number(op.pauseMins) || 0, pauseAt = Number(op.pauseAt) || 0, now = Date.now();
  const pauseArmed = pauseMins > 0 && pauseAt > 0;
  // Trust the phone's reported start only if it's for THIS arm — the phone always starts a window after the admin arms
  // it, so a start time older than pauseAt belongs to a previous pause (seen.json just hasn't caught up yet).
  const pauseStart = Number(seenOp.pauseStart) >= pauseAt ? Number(seenOp.pauseStart) : 0;
  const pauseEndsAt = pauseStart > 0 ? pauseStart + pauseMins * 60000 : 0;
  const pauseRunning = pauseArmed && pauseEndsAt > now;
  const pauseWaiting = pauseArmed && pauseStart <= 0;
  const paused = pauseRunning || pauseWaiting;
  return h('div', { class: 'stack', style: 'gap:10px' },
    h('div', { class: 'stack', style: 'gap:6px' },
      h('div', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'flabel' }, 'Photos, videos and sound'),
        h('span', { class: 'hint', style: 'margin:0' }, `The default for every site left on Default — changing it updates those sites on ${who} phone straight away.`)),
      defaultRows(k => defBlocks(d, k) ? 'blocked' : 'open', (k, v) => { setDefault(d, k, v); markDevices(); render(); }, !M, 'pMedia_')),
    h('div', { class: 'stack', style: 'gap:6px' },
      h('div', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'flabel' }, 'Text search'),
        h('span', { class: 'hint', style: 'margin:0' }, 'Words only, safe search on. Opening a result follows this phone\'s lists.')),
      h('div', { class: 'mrows' },
        h('div', { class: 'mrow' }, h('div', { class: 'top' }, h('b', null, 'Text search'),
          obSeg('Text search', d.search === true ? 'open' : 'blocked', v => { if (v === 'open') d.search = true; else { delete d.search; delete d.searchApprovedOnly; } markDevices(); render(); },
            { disabled: !M, opts: [['open', 'On'], ['blocked', 'Off']], id: 'pSearch' }))),
        h('label', { class: 'mrow', for: 'pSearchOnly', style: d.search === true ? '' : 'opacity:.55' }, h('div', { class: 'top' },
          h('span', { class: 'grow', style: 'display:flex;flex-direction:column' }, h('b', null, 'Only show results already approved'),
            h('span', { class: 's' }, d.searchApprovedOnly ? 'On: only pages this phone can open' : 'Off: new sites show too, to ask for')),
          sw('pSearchOnly', d.searchApprovedOnly === true, on => { if (on) d.searchApprovedOnly = true; else delete d.searchApprovedOnly; markDevices(); render(); }, !M || d.search !== true)))),
      h('p', { class: 'hint', style: 'margin:0' }, d.search === true ? '' : 'Off to start with. The phone can ask for it, or you turn it on here.')),
    h('div', { class: 'stack', style: 'gap:6px' },
      h('div', { class: 'stack', style: 'gap:2px' }, h('span', { class: 'flabel' }, 'PIN to send open requests'),
        h('span', { class: 'hint', style: 'margin:0' }, `When on, ${who} phone must enter a PIN before it can ask to open a site or media — so open requests can't be sent without it. Block requests never need it. The PIN is set on the phone (Settings → Protection & controls); here you can turn it off for a short while (it comes back on by itself) or remove it.`)),
      h('div', { class: 'mrows' },
        h('div', { class: 'mrow' }, h('div', { class: 'top' },
          h('span', { class: 'grow', style: 'display:flex;flex-direction:column' }, h('b', null, 'Require a PIN'),
            h('span', { class: 's' }, !opSet ? 'No PIN set yet'
              : !op.on ? 'Off — not required right now'
              : pauseRunning ? `Temporarily off — back on in ${fmtMin(Math.max(1, Math.ceil((pauseEndsAt - now) / 60000)))}`
              : pauseWaiting ? `Temporarily off for ${fmtMin(pauseMins)} — starts when the phone opens the app`
              : 'On — a PIN is needed to open things')),
          // The PIN exists on the phone. The admin can turn it off for a short window (which auto-returns), or cancel that.
          (M && opSet)
            ? (!op.on
                ? h('button', { type: 'button', class: 'btn s sm', onclick: () => { const o = { ...(d.openPin || {}) }; o.on = true; d.openPin = o; markDevices(); render(); } }, 'Turn on')
                : paused
                  ? h('button', { type: 'button', class: 'btn s sm', onclick: () => resumeOpenPin(d) }, 'Turn back on now')
                  : h('button', { type: 'button', class: 'btn s sm', onclick: () => pauseOpenPin(d) }, 'Temporarily turn off'))
            : null)),
        h('div', { class: 'mrow' }, h('div', { class: 'top' },
          h('span', { class: 'grow', style: 'display:flex;flex-direction:column' }, h('b', null, 'The PIN'),
            h('span', { class: 's' }, opSet ? 'Set on the phone' : 'Not set yet — set it on the phone')),
          M && opSet ? h('button', { type: 'button', class: 'btn d sm', onclick: () => resetOpenPin(d) }, 'Remove') : null)),
        h('div', { class: 'mrow' }, h('div', { class: 'top' },
          h('span', { class: 'grow', style: 'display:flex;flex-direction:column' }, h('b', null, 'Recovery email'),
            h('span', { class: 's' }, op.email
              ? op.email + (op.emailConfirmed ? ' · confirmed' : ' · not confirmed yet')
              : 'None yet — the parent sets it on the phone'))))),
      h('p', { class: 'hint', style: 'margin:0' }, opSet ? '' : 'The parent sets the PIN on the phone. Once set, it is kept even if the app is reinstalled.')));
}
// Remove the open-requests PIN: clears it everywhere so the parent must set a new one on the phone.
async function resetOpenPin(d) {
  if (!(await uiConfirm('Remove the open-requests PIN?', 'The current PIN stops working and its recovery email is cleared, so the parent sets a new one — with a fresh email — on the phone. The phone picks this up within a few minutes.', 'Remove', { icon: 'ban', red: true }))) return;
  // Clear the PIN directly (the main admin writes devices.json, so there's no backend step to do it), AND flag reset:true
  // and a resetAt stamp — the phone obeys resetAt and drops its local PIN. Clearing the PIN clears the recovery email too.
  const op = { ...(d.openPin || {}) };
  delete op.hash; delete op.resetCode; delete op.emailCode; delete op.set; delete op.email; delete op.emailConfirmed;
  delete op.pauseMins; delete op.pauseAt; delete op.pauseStart;
  op.reset = true; op.resetAt = Date.now();
  d.openPin = op;
  markDevices(); saveAll();
  say('Open-requests PIN removed. The parent sets a new one on the phone.');
}
// Temporarily turn the PIN off for a small window, starting when the phone next opens the app; it switches back on by itself.
function pausePicker() {
  return new Promise(resolve => {
    const close = v => { shade.remove(); document.removeEventListener('keydown', keys, true); resolve(v); };
    const opt = m => h('button', { type: 'button', class: 'btn p', style: 'flex:1;min-width:76px', onclick: () => close(m) }, fmtMin(m));
    const dlg = h('section', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Temporarily turn off the PIN' },
      h('div', { class: 'dhead' }, h('span', { class: 'dicon' }, icon('clock', 22)), h('h2', null, 'Temporarily turn off')),
      h('p', null, 'How long should the PIN be off? The timer starts when the phone next opens the app, and the PIN switches back on by itself when it ends.'),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, opt(2), opt(5), opt(10), opt(15)),
      h('div', { class: 'dacts' }, h('button', { type: 'button', class: 'btn d', onclick: () => close(0) }, 'Cancel')));
    const shade = h('div', { class: 'dlg-shade', onclick: e => { if (e.target === shade) close(0); } }, dlg);
    const keys = e => { if (e.key === 'Escape') { e.preventDefault(); close(0); } };
    document.addEventListener('keydown', keys, true);
    document.body.append(shade);
  });
}
async function pauseOpenPin(d) {
  const m = await pausePicker();
  if (!m) return;
  const op = { ...(d.openPin || {}) };
  op.pauseMins = m; op.pauseAt = Date.now(); delete op.pauseStart; delete op.set;
  d.openPin = op;
  markDevices(); saveAll();
  say(`PIN off for ${fmtMin(m)} once the phone opens the app — it comes back on by itself.`);
}
async function resumeOpenPin(d) {
  const op = { ...(d.openPin || {}) };
  delete op.pauseMins; delete op.pauseAt; delete op.pauseStart; delete op.set;
  d.openPin = op;
  markDevices(); saveAll();
  say('PIN back on.');
}
// PIN approvals locked on a phone (5 wrong PINs): unlocked, and saved, straight away.
const pinLocked = d => !!(d && d.pinLockedUntil && Date.parse(d.pinLockedUntil) > Date.now());
function unlockPin(id) {
  const d = S.D.devices[id];
  if (!d) return;
  delete d.pinLockedUntil; delete d.pinFails;
  d.pinUnlocks = (Number(d.pinUnlocks) || 0) + 1;         // (clears a lock the phone itself remembers, too)
  markDevices(); saveAll();
  say(`PIN approvals unlocked on ${d.name || id}. The phone picks it up within a few minutes.`);
}
// A helper's view of what only the main admin changes on a phone (and the PIN lock, which managing can unlock).
function readOnlyPart(d, locked, M) {
  const usual = (v, on, off) => v === 'on' ? on : v === 'off' ? off : 'Usual';
  const filters = [...AD_GROUPS, ...FILTERS].filter(([k]) => d[k] === 'on' || d[k] === 'off').map(([k, t]) => `${t.replace(/^(Block|Hide) /, '')} ${d[k]}`);
  const row = (t, v) => h('div', { class: 'ro' }, h('span', { class: 'grow' }, h('span', { class: 't' }, t), h('span', { class: 's' }, v)), h('span', { class: 'tag' }, 'View only'));
  return [h('span', { class: 'flabel' }, 'Set by the main admin'),
    h('div', { class: 'group', style: 'background:var(--bg)' },
      row('Ads', usual(d.adblock, 'Blocked', 'Allowed')),
      row('Content filters', filters.length ? filters.join(', ') : 'Usual'),
      row('Approving with a PIN', d.approvalPin === 'none' ? 'Off on this phone' : canDo('pin') ? 'On: your own PIN works here (Settings → Your account)' : 'On')),
    locked ? null
      : M ? h('button', { type: 'button', class: 'btn s sm', id: 'pinUnlockAny', style: 'align-self:flex-start', onclick: () => unlockPin(Object.keys(S.D.devices).find(k => S.D.devices[k] === d)) }, 'Unlock PIN approvals on this phone') : null];
}
// The main admin: every PIN that works on a phone (yours, and each helper's who looks after it).
function pinsHere(id) {
  if (!S.admins) { adminsList().then(() => render()); return null; }
  const d = S.D.devices[id];
  const yours = (d.approvalPin && typeof d.approvalPin === 'object') || S.D.approvalPin;
  const helpers = Object.values(S.admins).filter(a => a.role !== 'owner' && a.status === 'active' && a.can && a.can.pin && looksAfter(a, id));
  const row = (letter, t, sub, set, me) => h('div', { class: 'row' }, h('span', { class: 'av' + (set ? '' : ' grey') }, letter),
    h('span', { class: 'grow' }, h('span', { class: 't' }, t), h('span', { class: 's' }, sub)),
    h('span', { class: 'small', style: `font-weight:700;color:${set ? 'var(--accent)' : 'var(--faint)'}` }, set ? 'Set' : 'Not set yet'));
  return h('div', { class: 'stack', style: 'gap:6px' }, h('span', { class: 'flabel' }, 'PINs that work here'),
    h('div', { class: 'group' }, row('Y', 'Yours', (d.approvalPin && typeof d.approvalPin === 'object') ? 'This phone\'s own PIN' : 'Your PIN for all phones', !!yours),
      ...helpers.map(a => row((a.name || a.email)[0].toUpperCase(), a.name || a.email, `Helper · ${whoText(a).split(':')[0]}`, !!a.pin))),
    h('p', { class: 'hint', style: 'margin:0' }, 'Each admin has their own PIN; nobody sees anyone else\'s. 5 wrong tries on this phone locks it for everyone\'s PIN until you unlock it.'));
}
// Does this (helper) admin look after this phone: every phone, picked, or in one of their groups?
const looksAfter = (a, id) => a.phones === 'all' || (a.phones || []).includes(id) ||
  ((S.D.devices[id] || {}).groups || []).some(g => (a.groups || []).includes(g));
function archivedScreen() {
  const entries = Object.entries(S.D.archived || {});
  const phones = Object.entries(S.D.devices);
  const cards = entries.map(([aid, a]) => {
    const give = h('select', { class: 'inp', 'aria-label': 'Give to phone', style: 'min-height:44px' }, h('option', { value: '' }, 'Give to another phone…'),
      phones.map(([pid, p]) => h('option', { value: pid }, `${p.name || 'No name'} (${pid})`)));
    give.onchange = () => { if (give.value) bringBack(aid, give.value); };
    return h('div', { class: 'card', 'data-archived': aid },
      h('div', null, h('b', { style: 'font-size:17px' }, a.name || `${a.model || 'Phone'} (no name)`),
        h('div', { class: 'muted small mono' }, [aid, a.model, a.lastSeen ? `last seen ${String(a.lastSeen).slice(0, 10)}` : null].filter(Boolean).join(' · '))),
      h('div', { class: 'chips' }, (a.lists || []).map(l => chip(listLabel(l), (a.archivedLists || []).includes(l) ? 'amber' : 'teal'))),
      h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn p grow', onclick: () => bringBack(aid, aid) }, 'Restore'),
        h('button', { type: 'button', class: 'btn d', onclick: () => deleteArchived(aid) }, 'Delete for good')),
      phones.length ? give : null);
  });
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Phones'),
    screenTitle('Archived phones', 'Phones that stopped checking in. Their own lists are kept, not deleted.'),
    entries.length ? cards : h('div', { class: 'card empty' }, h('b', null, 'None'), 'Phones not seen for a while are archived here automatically.'),
    h('p', { class: 'hint' }, 'After a factory reset a phone gets a new ID and appears as a new phone. Use Give to another phone to hand it its old name and lists.'));
}
// Archive a phone now, the same way the daily check does after it's unused for a while: its own lists
// (ones no other phone uses) move to docs/lists/archive/, and it moves to Archived phones.
const allListsOf = d => [...new Set([...(d.lists || []), ...(d.blockedLists || [])])];
async function archiveNow(id) {
  if (S.devDirty || S.listDirty) return say('Save or undo your changes first.', true);
  const d = S.D.devices[id], who = d.name || id;
  const own = allListsOf(d).filter(l => l !== 'public' && !S.D.default.includes(l) &&
    !Object.entries(S.D.devices).some(([other, o]) => other !== id && allListsOf(o).includes(l)));
  if (!(await uiConfirm(`Archive ${who} now?`, (own.length ? `Its own list (${own.map(listLabel).join(', ')}) is archived with it. ` : '') +
    'You can restore it from Archived phones.', 'Archive', { icon: 'archive' }))) return;
  try {
    const moved = [];
    for (const l of own) {
      if (await moveFile(`docs/lists/${l}.json`, `docs/lists/archive/${l}.json`, `Archive list ${l} with phone ${who}`)) moved.push(l);
    }
    S.lists = S.lists.filter(l => !moved.includes(l));
    S.D.archived[id] = { ...d, archivedOn: new Date().toISOString().slice(0, 10), archivedLists: moved };
    delete S.D.devices[id];
    S.devicesSha = await putJson('devices.json', S.D, S.devicesSha, `Archive phone ${who}`);
    if (moved.includes(S.current)) await openList('public');
    back(); say(`${who} archived.`);
  } catch (e) { say(e.message, true); }
}

async function bringBack(fromId, toId) {
  if (S.devDirty) return say('Save or undo your phone changes first.', true);
  const a = S.D.archived[fromId], to = S.D.devices[toId], who = a.name || fromId;
  if (!(await uiConfirm(fromId === toId ? `Restore ${who}?` : `Give ${who}'s name and lists to ${to.name || to.model || toId}?`,
    fromId === toId ? 'It comes back with its lists.' : 'That phone takes over its name and lists.', fromId === toId ? 'Restore' : 'Give', { icon: 'archive' }))) return render();
  try {
    const renamed = {};
    const oldOwn = fromId.toLowerCase(), newOwn = toId.toLowerCase();   // a phone's own list is named after its ID
    for (const l of a.archivedLists || []) {
      // Giving to a different phone: the old phone's own list becomes the NEW phone's own list — so it keeps its
      // sites, shows the new owner's name (not a bare ID), and future approvals land in it. If the new phone already
      // has an own list (made, empty, when it registered), replace that one.
      if (fromId !== toId && l === oldOwn) {
        if (S.lists.includes(newOwn)) { const ex = await getRaw(`docs/lists/${newOwn}.json`); if (ex) await deleteFile(`docs/lists/${newOwn}.json`, ex.sha, `Replace ${newOwn}'s empty own list`); }
        if (await moveFile(`docs/lists/archive/${l}.json`, `docs/lists/${newOwn}.json`, `Give ${who}'s own list to its new phone`)) { if (!S.lists.includes(newOwn)) S.lists.push(newOwn); renamed[l] = newOwn; }
        continue;
      }
      let name = l, n = 2;
      while (S.lists.includes(name)) name = `${l}-${n++}`;
      if (await moveFile(`docs/lists/archive/${l}.json`, `docs/lists/${name}.json`, `Restore list ${name} from the archive`)) { S.lists.push(name); renamed[l] = name; }
    }
    const restoredLists = (a.lists || []).map(l => renamed[l] || l).filter(l => S.lists.includes(l));
    const { lastSeen, archivedOn, archivedLists, ...kept } = a;
    const target = to || { lists: [], registered: new Date().toISOString().slice(0, 10) };
    S.D.devices[toId] = { ...kept, ...target, name: target.name || a.name || '', model: target.model || a.model,
      lists: [...new Set([...(target.lists || []), ...restoredLists])],
      ...(fromId !== toId ? { previousIds: [...(a.previousIds || []), fromId] } : {}) };
    if (!target.requestsTo && a.requestsTo) S.D.devices[toId].requestsTo = a.requestsTo;
    if (Array.isArray(a.blockedLists) && fromId === toId) S.D.devices[toId].blockedLists = a.blockedLists.map(l => renamed[l] || l).filter(l => S.lists.includes(l));
    delete S.D.archived[fromId];
    S.devicesSha = await putJson('devices.json', S.D, S.devicesSha, `Restore phone ${who}`);
    render();
    say(`${who} restored. Lists: ${S.D.devices[toId].lists.map(listLabel).join(', ') || 'none'}.`);
  } catch (e) { say(e.message, true); }
}
async function deleteArchived(id) {
  if (S.devDirty) return say('Save or undo your phone changes first.', true);
  const a = S.D.archived[id];
  const lost = a.archivedLists || [];
  if (!(await uiConfirmDanger(`Delete ${a.name || id} for good?`, lost.length ? `Its archived lists (${lost.join(', ')}) are deleted too.` : 'This can\'t be undone.', 'Delete'))) return;
  try {
    for (const l of lost) {
      const f = await getRaw(`docs/lists/archive/${l}.json`);
      if (f) await deleteFile(`docs/lists/archive/${l}.json`, f.sha, `Delete archived list ${l}`);
    }
    delete S.D.archived[id];
    S.devicesSha = await putJson('devices.json', S.D, S.devicesSha, `Delete archived phone ${a.name || id}`);
    render(); say(`${a.name || id} deleted.`);
  } catch (e) { say(e.message, true); }
}

// The content filters: [key in devices.json, switch title, description]. They win over your lists: a
// listed site only opens if it was approved "anyway" (or has "Open even if a filter lists it").
// AdGuard's other groups, next to "Block ads": [key in devices.json, switch title, description]. On unless switched off.
const AD_GROUPS = [
  ['trackers', 'Block trackers', 'AdGuard\'s tracking lists: trackers and analytics, and tracking codes (like utm_source) taken out of addresses'],
  ['annoyances', 'Hide annoyances', 'AdGuard\'s annoyance lists: cookie notices, pop-ups, "get our app" banners, widgets and social buttons'],
];
const FILTERS = [
  ['adult', 'Block adult content', 'Adult sites, and anything from them. HaGeZi\'s and OISD\'s NSFW lists (the ones Mullvad used)'],
  ['gambling', 'Block gambling', 'Gambling sites, and anything from them. HaGeZi\'s gambling list'],
  ['malware', 'Block malware and scams', 'Sites known for malware, phishing and scams. HaGeZi\'s threat list'],
];

