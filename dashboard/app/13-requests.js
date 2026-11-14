// ============================================================================================
// Requests
// ============================================================================================
function marker(body) {
  const m = (body || '').match(/<!-- whitelist-request\s*([\s\S]*?)-->/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
}
const field = (body, name) => ((body || '').match(new RegExp('\\*\\*' + name + ':\\*\\*\\s*(.+)')) || [])[1] || '';
async function loadInbox() {
  try {
    // Requests waiting (and new phones), as GitHub's automation published them: each one's details from its
    // private record, in the same form as before.
    const items = JSON.parse(await textOf('inbox.json') || '[]');
    for (const i of items) {
      const r = i.record && i.record.request;
      const who = r && (r.name || (S.D.devices[String(r.device || r.id || '').toUpperCase()] || {}).name);
      i.body = r ? (who ? `**Phone:** ${who} (\`${r.device || r.id || ''}\`)\n` : '') +
        (r.note ? `**Note:** ${String(r.note).replace(/\n/g, ' ')}\n` : '') + `<!-- whitelist-request\n${JSON.stringify(r)}\n-->` : '';
      i._log = (i.record && i.record.log) || [];
      i._site = (i.record && i.record.site) || null;           // what the site says it is (found when it arrived)
    }
    const answered = new Set(S.answeredNumbers || []);
    S.requests = items.filter(i => i.kind === 'request' && marker(i.body) && marker(i.body).type !== 'recoveryon' && !answered.has(i.number));
    S.newPhones = items.filter(i => i.kind === 'phone' && (marker(i.body) || {}).type === 'register' && !answered.has(i.number));
    try { S.answeredList = JSON.parse(await textOf('answered.json') || '[]'); } catch { S.answeredList = []; }
    try { S.seen = JSON.parse(await textOf('seen.json') || 'null'); } catch (e) { console.log('seen', e); S.seen = null; }
    S.inboxError = null;
  } catch (e) {
    S.requests = []; S.newPhones = [];
    S.inboxError = e.message;
  }
  if (S.focusRequest && !S.sub) S.tab = 'requests';
  if (S.focusRequest) render(); else softRender();      // (not in the middle of a swipe, or while typing)
  if (S.focusRequest) {
    const card = document.querySelector(`[data-n="${CSS.escape(S.focusRequest)}"]`);
    if (card) { card.classList.add('focus'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else say('That request has already been answered.');
    S.focusRequest = null;
  }
}
// "Check for new requests": the newest published data.
async function checkInbox() {
  try { await refreshData(); } catch (e) { say(e.message, true); }
}
// "Sync now": ask the server to republish the newest, then pull everything — lists, phones, requests and each
// phone's reported status (seen.json). Everything in one, matching the Sync button on the phone app.
async function syncNow(btn) {
  if (btn) { btn.disabled = true; btn.classList.add('spin'); }
  try {
    await command({ op: 'refresh' }).then(r => (r && r.ok) ? refreshData(r.sha) : refreshData()).catch(() => refreshData());
    try { S.seen = JSON.parse(await textOf('seen.json') || 'null'); } catch (e) { console.log('seen', e); }
    say('Synced — showing the latest.');
  } catch (e) { say(e.message, true); }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('spin'); } render(); }
}
// "photos", "photos and sound", "photos, videos and sound" (a request's mediaKind, e.g. "photos,sound"; not given: all).
function mediaWords(k) {
  const all = ['photos', 'videos', 'sound'];
  let list = String(k || '').split(',').map(x => x.trim()).filter(x => all.includes(x));
  if (!list.length) list = all;
  list = all.filter(x => list.includes(x));
  return list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}
const capFirst = t => t.charAt(0).toUpperCase() + t.slice(1);
// ---- Photos, videos and sound: each phone's default (Open or Blocked) ----
const MKINDS = [['photos', 'Photos'], ['videos', 'Videos'], ['sound', 'Sound']];
// (devices.json: "mediaDefault": { photos: 'blocked', … }, only the blocked ones; open otherwise.)
const defBlocks = (d, k) => !!(d && d.mediaDefault && d.mediaDefault[k] === 'blocked');
const joinWords = l => l.length <= 1 ? (l[0] || '') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1];
const firstName = d => ((d && (d.first || d.name)) || 'This phone').trim().split(/\s+/)[0];
// Open | Blocked, for one kind (or [opts] with Default too, for a site).
function obSeg(label, value, set, { disabled = false, opts = [['open', 'Open'], ['blocked', 'Blocked']], id } = {}) {
  return h('div', { class: 'seg ob', role: 'group', 'aria-label': label, id }, opts.map(([v, t]) =>
    h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(value === v), disabled, onclick: () => { if (value !== v) set(v); } }, t)));
}
// The three kinds as rows of Open | Blocked: [get](k) → 'open' | 'blocked'; [set](k, v).
function defaultRows(get, set, disabled, prefix) {
  return h('div', { class: 'mrows' }, MKINDS.map(([k, t]) => h('div', { class: 'mrow' },
    h('div', { class: 'top' }, h('b', null, t), obSeg(t, get(k), v => set(k, v), { disabled, id: prefix ? prefix + k : null })))));
}
function setDefault(d, k, v) {
  const md = { ...(d.mediaDefault || {}) };
  if (v === 'blocked') md[k] = 'blocked'; else delete md[k];
  if (Object.keys(md).length) d.mediaDefault = md; else delete d.mediaDefault;
}
function describe(req) {
  if (!req || typeof req !== 'object') return { title: 'A request from a phone', page: null };
  if (req.type === 'browser') return { title: `A new browser: ${req.label || req.pkg || 'an app'}`, page: null };
  if (req.type === 'timer') { const tn = (timerDefs()[req.timer] || {}).name || req.timerName || 'a timer', m = Number(req.minutes) || 30;
    return { title: req.ask === 'more' ? `${fmtMin(m)} more of ${tn} today` : `${fmtMin(m)} off ${tn}`, page: null }; }
  if (req.type === 'mediaDefault') return { title: 'Change this phone\'s default', page: null };
  if (req.type === 'search') return { title: req.off === true ? 'Turn off search' : req.wasOn === true ? 'Change search' : 'Turn on search', page: null };
  if (req.type === 'unprotect') return { title: 'Turn off phone protection', page: null };
  if (req.type === 'uncoverlists') return { title: 'Turn off the stronger lists cover', page: null };
  if (req.type === 'unrecovery') return { title: 'Turn off guard-recovery', page: null };
  // A site request needs a domain/action; without one (e.g. a record still loading), don't guess "Open ?".
  if (!req.domain && !req.action && req.media === undefined && !(Array.isArray(req.frames) && req.frames.length)) return { title: 'A request from a phone', page: null };
  const site = req.domain || '?';
  if (Array.isArray(req.frames) && req.frames.length) return { title: `Embedded content on ${site}`, page: null };
  const page = req.scope === 'page' && req.url ? pageKey(req.url) : null;
  if (req.action === 'block') {
    if (req.media === 'off') return { title: page ? `Turn off ${mediaWords(req.mediaKind)} on one page of ${site}` : `Turn off ${mediaWords(req.mediaKind)} on ${site}`, page };
    return { title: page ? `Block one page on ${site}` : `Block ${site}`, page };
  }
  const mw = mediaWords(req.mediaKind);
  if (req.media === 'on' && req.item) return { title: `One ${/video/.test(req.mediaKind || '') ? 'video' : 'photo'} on ${page ? 'a page of ' : ''}${site}`, page };
  if (req.media === 'on') return { title: page ? `${capFirst(mw)} on one page of ${site}` : `${capFirst(mw)} on ${site}`, page };
  return { title: page ? `Open one page on ${site}` : `Open ${site}`, page };
}
function requestsScreen() {
  const reqs = S.requests;
  const waiting = reqs ? reqs.length : 0;
  const sub = reqs === null ? 'Checking for requests…' : waiting ? `${plural(waiting, 'request')} waiting for you` : 'Nothing waiting for you';
  const kids = [screenTitle('Requests', sub)];
  if (S.inboxError) kids.push(h('div', { class: 'card' }, h('p', { class: 'warn' }, S.inboxError)));
  // Waiting requests: each a compact row (like an answered one) — tap to open its details and answer.
  if (reqs && reqs.length) {
    const eligible = reqs.filter(bulkOK);
    if (eligible.length < 1) S.selMode = false;
    kids.push(h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px' },
      h('h2', { class: 'sec', style: 'margin:0' }, 'Waiting'),
      eligible.length > 1 ? h('button', { type: 'button', class: 'btn s sm', id: 'selToggle', onclick: () => { S.selMode = !S.selMode; S.selected = new Set(); render(); } }, S.selMode ? 'Done' : 'Select') : null));
    kids.push(h('div', { class: 'group' }, reqs.map(waitingRow)));
    if (S.selMode) {
      const n = selSet().size, allOn = n === eligible.length;
      kids.push(h('div', { class: 'selbar' },
        h('button', { type: 'button', class: 'btn s sm', onclick: () => { S.selected = allOn ? new Set() : new Set(eligible.map(i => i.number)); render(); } }, allOn ? 'None' : 'All'),
        h('span', { class: 'grow small', style: 'text-align:center' }, n ? `${plural(n, 'request')} selected` : 'Tap the ones to answer'),
        h('button', { type: 'button', class: 'btn d sm', disabled: !n, onclick: denySelected }, n ? `Deny ${n}` : 'Deny'),
        h('button', { type: 'button', class: 'btn p sm', disabled: !n, onclick: approveSelected }, n ? `Approve ${n}` : 'Approve')));
    }
  }
  else if (reqs && !S.inboxError) kids.push(h('div', { class: 'empty' }, h('b', null, 'All caught up'), 'New requests from phones appear here.'));
  if (S.newPhones.length) {
    kids.push(h('h2', { class: 'sec' }, S.newPhones.length === 1 ? 'New phone' : 'New phones'));
    kids.push(...S.newPhones.map(newPhoneCard));
  }
  kids.push(h('div', { class: 'acts', style: 'justify-content:center' },
    h('button', { type: 'button', class: 'btn s sm', id: 'refreshInbox', onclick: async e => { e.target.disabled = true; await checkInbox(); } }, 'Check for new requests')));
  if (S.answered.length) {
    kids.push(h('h2', { class: 'sec' }, 'Answered just now'));
    kids.push(h('div', { class: 'group' }, S.answered.map(a => h('div', { class: 'row' }, h('span', { class: 'ic', style: 'color:var(--accent)' }, icon('check', 20, 2.2)),
      h('span', { class: 'grow' }, h('span', { class: 'name' }, a.title), h('span', { class: 'dom' }, a.label))))));
  }
  const done = (S.answeredList || []).slice(0, S.answeredMore ? 60 : 8);
  if (done.length) {
    kids.push(h('h2', { class: 'sec' }, 'Answered'));
    kids.push(h('div', { class: 'group', id: 'answeredList' }, done.map(x => {
      const who = (S.D.devices[x.phone] || (S.D.archived || {})[x.phone] || {}).name || x.phone;
      const a = x.answer, denied = a.verdict === 'denied';
      const by = a.how === 'pin' ? `On the phone with ${a.by === ME.name || (isOwner() && a.by === 'the main admin') ? 'your' : possessive(a.by)} PIN`
        : `${a.how === 'page' ? 'On the admin page' : 'On GitHub'} by ${a.by === (ME.name || ME.email) ? 'you' : a.by}`;
      return h('button', { type: 'button', class: 'row tap', 'data-answered': x.number, onclick: () => open({ name: 'answered', number: x.number }) },
        h('span', { class: 'ic', style: `color:${denied ? 'var(--red-ink,#8A2E1F)' : 'var(--accent)'}` }, icon(denied ? 'ban' : 'check', 20, 2.2)),
        h('span', { class: 'grow', style: 'min-width:0' }, h('span', { class: 'name' }, describe(x.request).title),
          h('span', { class: 'dom' }, `${who} · ${new Date(a.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`),
          h('span', { class: 'dom' }, by)),
        h('span', { class: 'small', style: `font-weight:700;color:${denied ? 'var(--red-ink,#8A2E1F)' : 'var(--accent)'}` }, a.undone ? 'Undone' : denied ? 'Denied' : 'Approved'),
        icon('chev', 16));
    })));
    if (!S.answeredMore && S.answeredList.length > done.length) kids.push(h('button', { type: 'button', class: 'btn s sm', style: 'align-self:center', onclick: () => { S.answeredMore = true; render(); } }, 'Show more'));
  }
  return h('main', { class: 'stack' }, kids);
}
const possessive = n => /^the /.test(n) ? `${n}'s` : `${n}'${/s$/i.test(n) ? '' : 's'}`;
const phoneName = issue => field(issue.body, 'Phone').replace(/`/g, '').replace(/\s*\([A-Z0-9-]+\)\s*$/, '') || 'A phone';
// Straightforward "open the site" requests can be approved in a batch from the list. Anything that wants a closer look
// — a block, turning media back on, embedded content, a filtered site, or a settings/timer/browser request — is left
// to be opened and answered on its own.
function bulkOK(issue) {
  const req = marker(issue.body);
  if (!req || typeof req !== 'object') return false;
  if (['timer', 'browser', 'unprotect', 'uncoverlists', 'unrecovery', 'mediaDefault', 'search'].includes(req.type)) return false;
  if (req.action === 'block' || req.media === 'on' || !req.domain) return false;
  if (Array.isArray(req.frames) && req.frames.length) return false;
  if (Array.isArray(req.filtered) && req.filtered.some(f => ['adult', 'gambling', 'malware'].includes(f))) return false;
  return !!S.D.devices[String(req.device || '').toUpperCase()];   // a known phone, so its own list is a safe target
}
const selSet = () => (S.selected instanceof Set ? S.selected : (S.selected = new Set()));
// Approve every selected request at once: each is sent as a plain "approve" to the phone's own list, and they ride out
// together in one save. Requests needing a closer look were never selectable, so this stays safe.
async function approveSelected() {
  const nums = [...selSet()];
  const list = (S.requests || []).filter(i => nums.includes(i.number) && bulkOK(i));
  if (!list.length) return;
  if (!(await uiConfirm(`Approve ${plural(list.length, 'request')}?`, 'Each opens the site as asked, added to that phone\'s own list. It saves automatically.', 'Approve all', { icon: 'check' }))) return;
  list.forEach(issue => {
    const req = marker(issue.body);
    reply(issue.number, 'approve own', false);
    S.answeredNumbers = [...(S.answeredNumbers || []), issue.number];
    S.answered.unshift({ title: describe(req).title, label: `Approved, in their own list · ${phoneName(issue)}` });
  });
  const done = new Set(list.map(i => i.number));
  S.requests = (S.requests || []).filter(i => !done.has(i.number));
  S.selMode = false; S.selected = new Set();
  render();
  say(`Approved ${plural(list.length, 'request')}. GitHub does them within a minute, and the phones are told a few minutes after.`);
}
// Deny every selected request at once: each is sent as a plain "deny" (no reason) to the phone's own list, and they
// ride out together in one save. Same safe set as Approve — only straightforward requests are ever selectable.
async function denySelected() {
  const nums = [...selSet()];
  const list = (S.requests || []).filter(i => nums.includes(i.number) && bulkOK(i));
  if (!list.length) return;
  if (!(await uiConfirm(`Deny ${plural(list.length, 'request')}?`, 'Each is turned down, with no reason given. It saves automatically.', 'Deny all', { icon: 'ban', red: true }))) return;
  list.forEach(issue => {
    const req = marker(issue.body);
    reply(issue.number, 'deny', false);
    S.answeredNumbers = [...(S.answeredNumbers || []), issue.number];
    S.answered.unshift({ title: describe(req).title, label: `Denied · ${phoneName(issue)}` });
  });
  const done = new Set(list.map(i => i.number));
  S.requests = (S.requests || []).filter(i => !done.has(i.number));
  S.selMode = false; S.selected = new Set();
  render();
  say(`Denied ${plural(list.length, 'request')}. GitHub does them within a minute, and the phones are told a few minutes after.`);
}
// A waiting request, as a compact row: tap it to open the details and answer there. In select mode, the eligible ones
// tap to tick/untick instead (the rest still open as usual).
function waitingRow(issue) {
  const req = marker(issue.body);
  const { title } = describe(req);
  const phone = phoneName(issue);
  if (S.selMode) {
    const ok = bulkOK(issue), sel = selSet().has(issue.number);
    return h('button', { type: 'button', class: 'row tap' + (sel ? ' sel' : ''), 'data-n': issue.number, onclick: () => {
        if (!ok) return open({ name: 'request', number: issue.number });
        const s = selSet(); if (s.has(issue.number)) s.delete(issue.number); else s.add(issue.number); render();
      } },
      ok ? h('span', { class: 'chk' + (sel ? ' on' : '') }, sel ? icon('check', 14, 3) : null)
         : h('span', { class: 'ic', style: 'color:var(--accent)' }, icon('clock', 20, 2.2)),
      h('span', { class: 'grow', style: 'min-width:0' }, h('span', { class: 'name' }, title),
        h('span', { class: 'dom' }, ok ? `${phone} · ${ago(issue.created_at)}` : `${phone} · open to answer`)),
      ok ? null : icon('chev', 16));
  }
  return h('button', { type: 'button', class: 'row tap', 'data-n': issue.number, onclick: () => open({ name: 'request', number: issue.number }) },
    h('span', { class: 'ic', style: 'color:var(--accent)' }, icon('clock', 20, 2.2)),
    h('span', { class: 'grow', style: 'min-width:0' }, h('span', { class: 'name' }, title),
      h('span', { class: 'dom' }, `${phone} · ${ago(issue.created_at)}`)),
    chip('Waiting', 'amber'),
    icon('chev', 16));
}
function requestCard(issue) {
  const req = marker(issue.body);
  if (req.type === 'mediaDefault' || req.type === 'search') return settingRequestCard(issue, req);
  if (req.type === 'timer') return timerRequestCard(issue, req);
  if (req.type === 'browser') return browserRequestCard(issue, req);
  if (req.type === 'unprotect' || req.type === 'uncoverlists' || req.type === 'unrecovery') return protectRequestCard(issue, req);
  const { title, page } = describe(req);
  const phone = field(issue.body, 'Phone').replace(/`/g, '').replace(/\s*\([A-Z0-9-]+\)\s*$/, '') || 'A phone';
  const note = field(issue.body, 'Note');
  const asked = Number(req.minutes) || 0;
  const allow = req.action !== 'block';
  // On a content filter's list: approving needs a confirmation, and is sent as "… anyway".
  const FNAMES = { adult: 'adult content', gambling: 'gambling', malware: 'malware and scams' };
  const filtered = allow && req.media !== 'on' ? (Array.isArray(req.filtered) ? req.filtered : []).filter(f => FNAMES[f]) : [];
  const filteredText = filtered.map(f => FNAMES[f]).join(' and ') + (filtered.length > 1 ? ' lists' : ' list');
  const confirmFiltered = async () => !filtered.length ||
    uiConfirm(`${req.domain} is on the ${filteredText}`, 'It\'s blocked by that filter even if a list allows it. Open it anyway?', 'Open anyway', { icon: 'warn', red: true });
  const anyway = filtered.length ? ' anyway' : '';
  const hops = Array.isArray(req.hops) ? req.hops : [];
  const frames = Array.isArray(req.frames) ? req.frames : [];   // embedded content blocked on req.domain
  const card = h('article', { class: 'card', 'data-n': issue.number });
  // "Add it to": the phone's own list (or wherever its approvals usually go) and every public list.
  const devId = String(req.device || '').toUpperCase(), dev = S.D.devices[devId];
  const phoneLists = dev ? (dev.lists || []) : S.D.default;
  const usual = dev ? (dev.requestsTo || S.D.requestsTo || 'own') : 'public';
  const targets = [];
  if (dev) targets.push({ word: 'own', name: devId.toLowerCase(), label: `${dev.name || devId} (own list)`, on: usual === 'own' || !S.lists.includes(usual) });
  if (dev && usual !== 'own' && S.lists.includes(usual) && !isPublicList(usual)) targets.push({ word: usual, name: usual, label: listLabel(usual), on: true });
  // (Public lists only for those who manage every phone's settings: a mini admin's approvals go to their phone's own list.)
  if (fullAdmin()) publicListNames().forEach(n => targets.push({ word: n, name: n, label: listLabel(n), pub: true, on: n === usual }));
  if (!fullAdmin() && targets.length && !targets.some(t => t.on)) targets[0].on = true;
  targets.forEach((t, i) => { t.box = h('input', { type: 'checkbox', class: 'target', id: `tg${issue.number}-${i}`, checked: t.on }); });
  const listWords = () => {
    const ticked = targets.filter(t => t.box.checked);
    if (!ticked.length) return '';
    const words = ticked.map(t => t.word);
    // The person who asked always gets it: if none of the ticked lists is one their phone uses, their own list too.
    if (dev && !ticked.some(t => t.word === 'own' || phoneLists.includes(t.name))) words.push('own');
    return ' ' + words.join(' ');
  };
  // Photos, videos and sound (opening a site): "Block" for kinds this phone opens by default, "Open" for kinds it
  // blocks by default. As the phone asked, changeable here.
  const KINDS = MKINDS;
  const askedKinds = req.media === 'off' ? (String(req.mediaKind || '').split(',').filter(k => KINDS.some(x => x[0] === k)).length
    ? String(req.mediaKind).split(',') : ['photos', 'videos', 'sound']) : [];
  const askedOpen = String(req.mediaOpen || '').split(',').filter(k => KINDS.some(x => x[0] === k));
  const openByDef = KINDS.filter(([k]) => !defBlocks(dev, k)), blockedByDef = KINDS.filter(([k]) => defBlocks(dev, k));
  const without = new Set(askedKinds.filter(k => !defBlocks(dev, k)));
  const opens = new Set(askedOpen.filter(k => defBlocks(dev, k)));
  const chipsOf = (list, set) => list.map(([k, t]) => h('button', { type: 'button', class: 'kc', 'data-k': k, 'aria-pressed': String(set.has(k)),
    onclick: e => { if (set.has(k)) set.delete(k); else set.add(k); e.currentTarget.setAttribute('aria-pressed', String(set.has(k))); } }, t));
  const kindChips = chipsOf(openByDef, without), openChips = chipsOf(blockedByDef, opens);
  const whose = possessive(firstName(dev));
  const defTag = (list, word) => h('span', { class: 'mtag' }, `${whose} default: ${list.length === 3 ? 'all ' + word : joinWords(list.map(([k]) => k)) + ' ' + word}`);
  const kindWords = () => (without.size ? ' no ' + ['photos', 'videos', 'sound'].filter(k => without.has(k)).join(' and ')
    : askedKinds.length ? ' with media' : '') + (opens.size ? ' with ' + ['photos', 'videos', 'sound'].filter(k => opens.has(k)).join(' and ') : '');
  const actions = h('div', { class: 'acts' });
  const panels = h('div');
  const send = async (text, label) => {
    actions.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      // Approving: the ticked lists, and without what's chosen (not added to a deny reason).
      const approving = text.startsWith('approve');
      const lw = approving ? listWords() : '';
      const kw = approving && allow && req.media !== 'on' && !frames.length ? kindWords() : '';
      await reply(issue.number, text + lw + kw, issue._again);
      if (issue._again) {
        // Approved after all: shown at once on the answered request.
        const x = (S.answeredList || []).find(i => i.number === issue.number);
        if (x) x.answer = { ...x.answer, verdict: 'approved', undone: false, at: new Date().toISOString(), by: ME.name || ME.email, how: 'page', message: '', undoable: false, changed: [] };
        render();
        return say(`${label}. ${phone}'s phone is told within a few minutes.`);
      }
      S.answeredNumbers = [...(S.answeredNumbers || []), issue.number];
      S.requests = S.requests.filter(i => i.number !== issue.number);
      const where = approving ? targets.filter(t => t.box.checked).map(t => t.label) : [];
      S.answered.unshift({ title, label: `${label}${where.length ? ', in ' + where.join(', ') : ''}` });
      backOrRender();
      say(`${label}. GitHub does it within a minute, and ${phone} is told a few minutes after.`);
    } catch (e) {
      actions.querySelectorAll('button').forEach(b => b.disabled = false);
      say(e.message === 'NO_ISSUES' ? NO_ISSUES_MSG : e.message, true);
    }
  };
  // "For a while": the hour and minute wheels.
  let whilePanel = null;
  const openWhile = () => {
    if (whilePanel) { whilePanel.hidden = !whilePanel.hidden; if (!whilePanel.hidden) whilePanel._picker.sync(); return; }
    const label = h('div', { class: 'flabel' });
    const host = h('div');
    const use = h('input', { type: 'checkbox', class: 'use' });
    const goBtn = h('button', { type: 'button', class: 'btn p grow approveFor' });
    const setLabels = m => { label.textContent = `How long: ${fmtMin(m)}`; goBtn.textContent = `Approve for ${fmtMin(m)}`; goBtn.disabled = !m; };
    whilePanel = h('div', { class: 'panel', 'data-sync': '' }, label, host,
      h('label', { class: 'check' }, use, 'Only count time while it\'s open on the phone'),
      h('div', { class: 'acts' }, goBtn));
    panels.append(whilePanel);
    const picker = makePicker(host, asked || 30, setLabels);
    whilePanel._picker = picker;
    goBtn.onclick = async () => {
      const m = picker.get(); if (!m) return;
      if (!(await confirmFiltered())) return;
      send(`approve for ${Math.floor(m / 60) ? Math.floor(m / 60) + 'h' : ''}${m % 60 ? m % 60 + 'm' : ''}${use.checked ? ' use' : ''}${anyway}`,
        `Approved for ${fmtMin(m)}${use.checked ? ' of use' : ''}`);
    };
    picker.sync();
  };
  // "Deny", with an optional reason shown on the phone.
  let denyPanel = null;
  const openDeny = () => {
    if (denyPanel) { denyPanel.hidden = !denyPanel.hidden; return; }
    const reason = h('input', { class: 'inp reason', type: 'text', placeholder: 'e.g. too distracting in class', 'aria-label': 'Reason' });
    denyPanel = h('div', { class: 'panel' }, h('div', { class: 'flabel' }, 'Why not? (optional, shown on their phone)'), reason,
      h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn dline grow denySend', onclick: () => send(('deny ' + reason.value.trim()).trim(), 'Denied') }, 'Deny')));
    panels.append(denyPanel);
    reason.focus();
  };
  if (!allow) {
    actions.append(h('button', { type: 'button', class: 'btn p grow approve', onclick: () => send('approve', req.media === 'off' ? 'Photos turned off' : 'Blocked') }, req.media === 'off' ? 'Turn them off' : 'Block it'));
  } else {
    actions.append(h('button', { type: 'button', class: 'btn p grow approve', onclick: async () => { if (await confirmFiltered()) send('approve' + anyway, asked ? `Approved for ${fmtMin(asked)}` : 'Approved'); } },
      (asked ? `Approve for ${fmtMin(asked)}` : 'Approve') + (filtered.length ? ' anyway' : '')));
    if (!frames.length) actions.append(h('button', { type: 'button', class: 'btn s while', onclick: openWhile }, asked ? 'Other time' : 'Temporary'));
  }
  if (!issue._again) actions.append(h('button', { type: 'button', class: 'btn d deny', onclick: openDeny }, 'Deny'));
  card.append(...[
    h('div', { class: 'who' }, h('span', null, h('span', { class: 'av' }, phone[0].toUpperCase()), h('b', null, phone), h('span', { class: 'muted small' }, '· ' + ago(issue.created_at))),
      asked ? chip(fmtMin(asked), 'amber', 'clock') : !allow ? chip(req.media === 'off' ? 'Only some' : 'Block', 'red', 'ban')
        : req.media === 'on' ? chip(req.item ? 'One item' : 'Media', 'teal', 'photooff') : null),
    h('h3', null, title),
    page ? h('p', { class: 'mono muted', style: 'margin:0' }, page) : null,
    siteAbout(req, issue._site),
    allow && req.media === 'off' ? h('p', { class: 'line' }, icon('photooff', 16), `Asked without ${mediaWords(req.mediaKind)}`) : null,
    allow && req.media !== 'on' && askedOpen.length ? h('p', { class: 'line' }, icon('photo', 16), `Asked for ${mediaWords(askedOpen.join(','))} too`) : null,
    hops.length ? h('p', { class: 'line' }, icon('link', 16), `Goes through ${plural(hops.length, 'other address')} first, allowed too when you approve`) : null,
    frames.length ? h('p', { class: 'line', style: 'align-items:flex-start' }, icon('link', 16),
      h('span', null, 'Content from ', h('b', null, frames.join(', ')), ` (like a video or a map) was blocked on this site. Approving lets it show inside ${req.domain}'s pages only.`)) : null,
    req.unverified ? h('p', { class: 'warn' }, 'The phone couldn\'t find this site when asking. It may be a typo: check it before approving.') : null,
    filtered.length ? h('p', { class: 'warn', style: 'background:var(--red-soft);color:#7A2A1D' },
      `⚠️ On the ${filteredText}. The phone blocks it even if a list allows it, unless you approve it anyway.`) : null,
    note ? h('p', { class: 'quote' }, `“${note}”`) : null,
    targets.length ? h('div', { class: 'flabel', style: 'margin-top:4px' }, 'Add it to') : null,
    targets.length ? h('div', { class: 'targets' }, targets.map(t => h('label', { class: 'check', for: t.box.id }, t.box,
      h('span', { class: 'grow' }, t.label), t.pub ? h('span', { class: 'pubtag' }, icon('globe', 13), 'Public') : null))) : null,
    allow && req.media !== 'on' && !frames.length && blockedByDef.length ? h('div', { class: 'flabel klabel' }, 'Open', defTag(blockedByDef, 'blocked')) : null,
    allow && req.media !== 'on' && !frames.length && blockedByDef.length ? h('div', { class: 'kinds', 'data-group': 'open' }, openChips) : null,
    allow && req.media !== 'on' && !frames.length && openByDef.length ? h('div', { class: 'flabel klabel' }, 'Block', defTag(openByDef, 'open')) : null,
    allow && req.media !== 'on' && !frames.length && openByDef.length ? h('div', { class: 'kinds', 'data-group': 'block' }, kindChips) : null,
    actions, panels].filter(Boolean)); // (the "All the details" button was removed — the request row opens its details)
  return card;
}
// ---------- an answered request: all the details, and changing the answer ----------
const whenText = t => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function answeredBy(a) {
  const me = a.by === (ME.name || ME.email) || (isOwner() && a.by === 'the main admin');
  return a.how === 'pin' ? `On the phone with ${me ? 'your' : possessive(a.by)} PIN` : `${a.how === 'page' ? 'On the admin page' : 'On GitHub'} by ${me ? 'you' : a.by}`;
}
function answeredDetailsScreen() {
  const x = (S.answeredList || []).find(i => i.number === S.sub.number);
  if (!x) return h('main', { class: 'stack' }, backLink(reqBackLabel(), reqBack), h('div', { class: 'card empty' }, h('b', null, 'Not found'), 'It may be more than 30 days old.'));
  const req = x.request || {}, a = x.answer || {};
  const { title, page } = describe(req);
  const dev = S.D.devices[x.phone] || (S.D.archived || {})[x.phone];
  const kv = (k, v) => v == null || v === '' ? null : h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  const denied = a.verdict === 'denied';
  const isSet = req.type === 'mediaDefault' || req.type === 'search';
  const noSite = isSet || req.type === 'timer' || req.type === 'browser';
  const asked = Number(req.minutes) || 0;
  const changed = (a.changed || []).map(c => `${c.text}${c.list ? ` (${c.list === x.phone.toLowerCase() ? (dev && dev.name ? dev.name + '\'s own list' : 'own list') : /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c.list) ? 'phone' : listLabel(c.list)})` : ''}`);
  const status = a.undone ? 'Approval undone' : denied ? 'Denied' : 'Approved';
  const kids = [backLink(reqBackLabel(), reqBack), screenTitle(title, `Request #${x.number} · ${status}`),
    h('section', { class: 'card kvs' },
      kv('Phone', dev ? `${dev.name || x.phone} (${x.phone})` : x.phone),
      x.asked ? kv('Date asked', whenText(x.asked)) : null,
      noSite ? null : kv('What', req.action === 'block' ? (req.media === 'off' ? `Block only the ${mediaWords(req.mediaKind)}` : 'Block it')
        : req.media === 'on' ? (req.item ? 'One photo or video' : `Turn ${mediaWords(req.mediaKind)} back on`)
        : Array.isArray(req.frames) && req.frames.length ? 'Embedded content' : 'Open it'),
      noSite ? null : kv('Where', page ? `Just this page: ${page}` : `The whole site: ${req.domain || '?'}`),
      kv('One item', req.item || null),
      isSet || req.action === 'block' ? null : kv(req.type === 'timer' ? 'Asked for' : 'How long', asked ? `${fmtMin(asked)}${req.timeMode === 'use' ? ', time on the site only' : ', from when it\'s approved'}` : 'Always'),
      kv('Note', req.note ? `“${req.note}”` : null),
      kv('Answered', `${answeredBy(a)}, ${whenText(a.at)}`),
      kv('Reason', a.reason ? `“${a.reason}”` : (a.message ? `“${a.message}”` : null)),
      kv('Before that', (x.earlier || []).length ? x.earlier.map(e => `${e.verdict === 'denied' ? 'Denied' : 'Approved'} ${answeredBy(e).replace(/^On/, 'on')}, ${whenText(e.at)}`).join('\n') : null))];
  const mayAnswer = isSet ? (canDo('manage') || fullAdmin()) : canDo('requests');
  if (mayAnswer && req.type !== 'register') {
    if (!denied && a.undoable) {
      kids.push(h('div', { class: 'flabel', style: 'margin-top:8px' }, 'Change the answer'),
        h('button', { type: 'button', class: 'btn dline', id: 'undoAnswer', onclick: () => undoApproval(x, changed) }, icon('undo', 18), 'Undo the approval'),
        h('p', { class: 'hint', style: 'margin:0' }, 'Takes back exactly what it changed, and tells the phone. Anything changed since stays as it is.'));
    } else if (!denied) {
      kids.push(h('p', { class: 'hint' }, 'This approval can\'t be undone here (it was made before undoing was possible, or changed nothing). Change it on the Sites tab instead.'));
    } else {
      kids.push(h('div', { class: 'flabel', style: 'margin-top:8px' }, 'Approve after all'));
      // The same card as a waiting request (lists, Open/Block, Temporary): answered again.
      const issue = { number: x.number, created_at: x.asked || a.at, _log: x.log || [], _again: 'approve',
        body: (dev ? `**Phone:** ${dev.name || x.phone} (\`${x.phone}\`)\n` : '') + (req.note ? `**Note:** ${String(req.note).replace(/\n/g, ' ')}\n` : '') + `<!-- whitelist-request\n${JSON.stringify(req)}\n-->` };
      kids.push(requestCard(issue));
    }
  }
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, kids);
}
async function undoApproval(x, changed) {
  const dev = S.D.devices[x.phone];
  const who = dev && dev.name ? dev.name : 'the phone';
  const reason = h('input', { class: 'inp', id: 'undoReason', type: 'text', placeholder: 'e.g. only for the project, which is done', 'aria-label': 'Why? (optional)' });
  const ok = await uiDialog({ title: 'Undo the approval?', icon: 'undo', red: true, danger: true, ok: 'Undo it',
    text: `${changed.length ? changed.slice(0, 4).join('; ') + ' — taken back.' : 'What it changed is taken back.'} ${who}'s phone is told within a few minutes.`,
    body: [h('div', { class: 'flabel' }, 'Why? (optional, shown on their phone)'), reason,
      h('p', { class: 'hint', style: 'margin:6px 0 0' }, `They see in My requests: "Changed to denied" (and the reason).`)] });
  if (!ok) return;
  await reply(x.number, ('undo ' + reason.value.trim()).trim(), 'undo');
  // (Shown at once; GitHub's version follows.)
  x.answer = { ...x.answer, verdict: 'denied', undone: true, at: new Date().toISOString(), by: ME.name || ME.email, how: 'page', reason: reason.value.trim() || undefined,
    message: 'Changed to denied' + (reason.value.trim() ? ': ' + reason.value.trim() : '.'), undoable: false };
  render();
  say(`Undone. ${who}'s phone is told within a few minutes.`);
}
// "Ask for time": time off a timer, or more of a daily allowance today. Approve (as asked, or another time) or deny.
// A newly found browser on a phone: Allow it, or keep it blocked.
function browserRequestCard(issue, req) {
  const phone = field(issue.body, 'Phone').replace(/`/g, '').replace(/\s*\([A-Z0-9-]+\)\s*$/, '') || 'A phone';
  const label = req.label || req.pkg || 'an app';
  const blocked = req.blocked !== false;
  const card = h('article', { class: 'card', 'data-n': issue.number });
  const actions = h('div', { class: 'acts' });
  const send = async (text, labelTxt) => {
    actions.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await reply(issue.number, text, issue._again);
      if (issue._again) { const x = (S.answeredList || []).find(i => i.number === issue.number);
        if (x) x.answer = { ...x.answer, verdict: text.startsWith('allow') ? 'approved' : 'denied', at: new Date().toISOString(), by: ME.name || ME.email, how: 'page', message: '', undoable: false, changed: [] };
        render(); return say(`${labelTxt}. ${phone}'s phone is told within a few minutes.`); }
      S.answeredNumbers = [...(S.answeredNumbers || []), issue.number];
      S.requests = S.requests.filter(i => i.number !== issue.number);
      S.answered.unshift({ title: `A new browser: ${label}`, label: `${labelTxt} for ${phone}` });
      backOrRender();
      say(`${labelTxt}. GitHub does it within a minute, and ${phone} is told a few minutes after.`);
    } catch (e) { actions.querySelectorAll('button').forEach(b => b.disabled = false); say(e.message === 'NO_ISSUES' ? NO_ISSUES_MSG : e.message, true); }
  };
  actions.append(
    h('button', { type: 'button', class: 'btn p grow approve', onclick: () => send('allow', 'Allowed') }, 'Allow it'),
    h('button', { type: 'button', class: 'btn d deny', onclick: () => send('block keep it blocked', 'Kept blocked') }, 'Keep it blocked'));
  card.append(...[
    h('div', { class: 'who' }, h('span', null, h('span', { class: 'av' }, phone[0].toUpperCase()), h('b', null, phone), h('span', { class: 'muted small' }, '· ' + ago(issue.created_at))),
      chip(blocked ? 'Blocked' : 'Found', blocked ? 'red' : 'teal', 'globe')),
    h('h3', null, `A new browser: ${label}`),
    req.pkg ? h('p', { class: 'mono muted', style: 'margin:0' }, req.pkg) : null,
    h('p', { class: 'hint', style: 'margin:0' }, blocked
      ? `It was blocked straight away. Allow it to let ${phone} use it, or keep it blocked.`
      : `Not blocked yet. Block it, or allow it.`),
    actions].filter(Boolean));
  return card;
}

// A phone asking to turn protection (or the stronger lists cover) off: clear wording, and the reply is relevant —
// Approving turns it off; Keep it on is the safe default (shown as the primary button).
function protectRequestCard(issue, req) {
  const lists = req.type === 'uncoverlists';
  const recov = req.type === 'unrecovery';
  const title = recov ? 'Turn off guard-recovery' : lists ? 'Turn off the stronger lists cover' : 'Turn off phone protection';
  const phone = field(issue.body, 'Phone').replace(/`/g, '').replace(/\s*\([A-Z0-9-]+\)\s*$/, '') || 'A phone';
  const card = h('article', { class: 'card', 'data-n': issue.number });
  const actions = h('div', { class: 'acts' });
  const send = async (text, labelTxt) => {
    actions.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await reply(issue.number, text, issue._again);
      S.answeredNumbers = [...(S.answeredNumbers || []), issue.number];
      S.requests = (S.requests || []).filter(i => i.number !== issue.number);
      S.answered.unshift({ title, label: `${labelTxt} for ${phone}` });
      backOrRender();
      say(`${labelTxt}. ${phone} picks it up within a few minutes.`);
    } catch (e) { actions.querySelectorAll('button').forEach(b => b.disabled = false); say(e.message === 'NO_ISSUES' ? NO_ISSUES_MSG : e.message, true); }
  };
  actions.append(
    h('button', { type: 'button', class: 'btn p grow', onclick: () => send('deny keep it on', 'Kept on') }, 'Keep it on'),
    h('button', { type: 'button', class: 'btn dline', onclick: () => send('approve', recov ? 'Guard-recovery turned off' : lists ? 'Stronger cover turned off' : 'Protection turned off') }, recov ? 'Turn recovery off' : lists ? 'Turn the cover off' : 'Turn protection off'));
  card.append(...[
    h('div', { class: 'who' }, h('span', null, h('span', { class: 'av' }, phone[0].toUpperCase()), h('b', null, phone), h('span', { class: 'muted small' }, '· ' + ago(issue.created_at))),
      chip('Protection', 'amber', 'shield')),
    h('h3', null, title),
    h('p', { class: 'hint', style: 'margin:0' }, recov
      ? `${phone} asked to turn off guard-recovery — the watchdog that switches the screen guard back on if it's turned off. Approving turns the watchdog off; "Keep it on" leaves it running.`
      : lists
      ? `${phone} asked to stop covering the whole Accessibility and Device admin lists. The app's own screens stay covered either way. Approving turns the stronger cover off.`
      : `${phone} asked to switch off all protection — blocking other browsers, the uninstall lock and the screen guard. Approving turns it all off; "Keep it on" leaves everything as it is.`),
    actions].filter(Boolean));
  return card;
}

function timerRequestCard(issue, req) {
  const { title } = describe(req);
  const phone = field(issue.body, 'Phone').replace(/`/g, '').replace(/\s*\([A-Z0-9-]+\)\s*$/, '') || 'A phone';
  const note = field(issue.body, 'Note');
  const asked = Number(req.minutes) || 30;
  const t = timerDefs()[req.timer];
  const card = h('article', { class: 'card', 'data-n': issue.number });
  const actions = h('div', { class: 'acts' }), panels = h('div');
  const send = async (text, label) => {
    actions.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await reply(issue.number, text, issue._again);
      if (issue._again) { const x = (S.answeredList || []).find(i => i.number === issue.number);
        if (x) x.answer = { ...x.answer, verdict: 'approved', undone: false, at: new Date().toISOString(), by: ME.name || ME.email, how: 'page', message: '', undoable: false, changed: [] };
        render(); return say(`${label}. ${phone}'s phone is told within a few minutes.`); }
      S.answeredNumbers = [...(S.answeredNumbers || []), issue.number];
      S.requests = S.requests.filter(i => i.number !== issue.number);
      S.answered.unshift({ title, label: `${label} for ${phone}` });
      backOrRender();
      say(`${label}. GitHub does it within a minute, and ${phone} is told a few minutes after.`);
    } catch (e) { actions.querySelectorAll('button').forEach(b => b.disabled = false); say(e.message === 'NO_ISSUES' ? NO_ISSUES_MSG : e.message, true); }
  };
  const dur = m => `${Math.floor(m / 60) ? Math.floor(m / 60) + 'h' : ''}${m % 60 ? m % 60 + 'm' : ''}`;
  let whilePanel = null;
  const openWhile = () => {
    if (whilePanel) { whilePanel.hidden = !whilePanel.hidden; if (!whilePanel.hidden) whilePanel._picker.sync(); return; }
    const label = h('div', { class: 'flabel' }), host = h('div');
    const goBtn = h('button', { type: 'button', class: 'btn p grow approveFor' });
    whilePanel = h('div', { class: 'panel', 'data-sync': '' }, label, host, h('div', { class: 'acts' }, goBtn));
    panels.append(whilePanel);
    const picker = makePicker(host, asked, m => { label.textContent = `How long: ${fmtMin(m)}`; goBtn.textContent = `Approve ${fmtMin(m)}`; goBtn.disabled = !m; });
    whilePanel._picker = picker;
    goBtn.onclick = () => { const m = picker.get(); if (m) send(`approve for ${dur(m)}`, `Approved ${fmtMin(m)}`); };
    picker.sync();
  };
  let denyPanel = null;
  const openDeny = () => {
    if (denyPanel) { denyPanel.hidden = !denyPanel.hidden; return; }
    const reason = h('input', { class: 'inp reason', type: 'text', placeholder: 'e.g. finish your homework first', 'aria-label': 'Reason' });
    denyPanel = h('div', { class: 'panel' }, h('div', { class: 'flabel' }, 'Why not? (optional, shown on their phone)'), reason,
      h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn dline grow denySend', onclick: () => send(('deny ' + reason.value.trim()).trim(), 'Denied') }, 'Deny')));
    panels.append(denyPanel); reason.focus();
  };
  actions.append(h('button', { type: 'button', class: 'btn p grow approve', onclick: () => send(`approve for ${dur(asked)}`, `Approved ${fmtMin(asked)}`) }, `Approve ${fmtMin(asked)}`),
    h('button', { type: 'button', class: 'btn s while', onclick: openWhile }, 'Other time'));
  if (!issue._again) actions.append(h('button', { type: 'button', class: 'btn d deny', onclick: openDeny }, 'Deny'));
  card.append(...[
    h('div', { class: 'who' }, h('span', null, h('span', { class: 'av' }, phone[0].toUpperCase()), h('b', null, phone), h('span', { class: 'muted small' }, '· ' + ago(issue.created_at))),
      chip(fmtMin(asked), 'amber', 'clock')),
    h('h3', null, title),
    t ? h('p', { class: 'line' }, icon('clock', 16), `${t.name}: ${timerWhen(t)} · ${timerWhat(t)}`) : null,
    h('p', { class: 'hint', style: 'margin:0' }, req.ask === 'more' ? 'Approving adds that much to today\'s allowance.' : 'Approving switches the timer off on this phone for that long, from now.'),
    note ? h('p', { class: 'quote' }, `“${note}”`) : null,
    actions, panels].filter(Boolean));
  return card;
}
// What the site says it is, and a link to look at it first (in a new tab).
function siteAbout(req, site) {
  if (!req.domain || (Array.isArray(req.frames) && req.frames.length)) return null;
  const url = req.url && /^https?:\/\//i.test(req.url) ? req.url : `https://${req.domain}/`;
  return h('div', { class: 'siteabout' },
    site && (site.title || site.description) ? h('div', { class: 'sa' }, h('span', { class: 'sal' }, (site.title || req.domain)[0].toUpperCase()),
      h('span', { class: 'grow', style: 'min-width:0;display:flex;flex-direction:column;gap:1px' },
        site.title ? h('b', { class: 'sat' }, site.title) : null, site.description ? h('span', { class: 'small muted' }, site.description) : null)) : null,
    h('a', { class: 'lookfirst', href: INAPP ? `wladmin://look?u=${encodeURIComponent(url)}` : url, target: INAPP ? null : '_blank', rel: 'noopener noreferrer' }, 'Look at the site first', icon('ext', 16)));
}
// ---------- a request: all the details ----------
function requestDetailsScreen() {
  const issue = S.requests.find(i => i.number === S.sub.number);
  if (!issue) return h('main', { class: 'stack' }, backLink(reqBackLabel(), reqBack), h('div', { class: 'card empty' }, h('b', null, 'Already answered'), 'This request isn\'t waiting any more.'));
  const req = marker(issue.body);
  const { title, page } = describe(req);
  const devId = String(req.device || '').toUpperCase(), dev = S.D.devices[devId];
  const kv = (k, v) => v == null || v === '' ? null : h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
  const asked = Number(req.minutes) || 0;
  const hops = Array.isArray(req.hops) ? req.hops : [];
  const hopText = hops.map(x => typeof x === 'string' ? x : `${x.url} (${x.scope === 'site' ? 'whole site' : 'this page'}${x.tile ? ', with a tile' : ', no tile'})`);
  const when = new Date(issue.created_at);
  // Requests that aren't about a site (a setting, protection, …): a simple details card, then the (relevant) answer card.
  if (req.type === 'mediaDefault' || req.type === 'search' || req.type === 'unprotect' || req.type === 'uncoverlists' || req.type === 'unrecovery') return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink(reqBackLabel(), reqBack),
    screenTitle(title, `Request #${issue.number}`),
    h('section', { class: 'card kvs' },
      kv('Phone', dev ? `${dev.name || devId} (${devId})${dev.model ? ', ' + dev.model : ''}` : (devId || 'Unknown')),
      kv('Date asked', when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
      kv('Asking to', req.type === 'unprotect' ? 'Turn off all phone protection' : req.type === 'uncoverlists' ? 'Turn off the stronger lists cover' : req.type === 'unrecovery' ? 'Turn off guard-recovery' : null),
      kv('Note', field(issue.body, 'Note') ? `“${field(issue.body, 'Note')}”` : null),
      null),
    h('div', { class: 'flabel', style: 'margin-top:8px' }, 'Answer it'),
    requestCard(issue));
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink(reqBackLabel(), reqBack),
    screenTitle(title, `Request #${issue.number}`),
    h('section', { class: 'card kvs' },
      kv('Phone', dev ? `${dev.name || devId} (${devId})${dev.model ? ', ' + dev.model : ''}` : (devId || 'Unknown')),
      kv('Date asked', when.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
      kv('What', req.action === 'block' ? (req.media === 'off' ? `Block only the ${mediaWords(req.mediaKind)}` : 'Block it')
        : req.media === 'on' ? (req.item ? 'One photo or video' : `Turn ${mediaWords(req.mediaKind)} back on`)
        : Array.isArray(req.frames) && req.frames.length ? 'Embedded content' : 'Open it'),
      kv('Where', page ? `Just this page: ${page}` : `The whole site: ${req.domain || '?'}`),
      kv('From the page', req.url && pageKey(req.url) !== page ? pageKey(req.url) : null),
      kv('One item', req.item || null),
      kv('Embedded from', Array.isArray(req.frames) && req.frames.length ? req.frames.join(', ') : null),
      kv('Home page tile', req.action !== 'block' && req.media !== 'on' && !(req.frames || []).length ? (req.tile === false ? 'No' : 'Yes') : null),
      kv('How long', asked ? `${fmtMin(asked)}${req.timeMode === 'use' ? ', time on the site only' : ', from when it\'s approved'}` : req.action === 'block' ? null : 'Always'),
      kv('Block', req.media === 'off' ? mediaWords(req.mediaKind) : null),
      kv('Note', field(issue.body, 'Note') ? `“${field(issue.body, 'Note')}”` : null),
      kv('Passes through', hopText.length ? hopText.join('\n') : null),
      kv('On a filter list', Array.isArray(req.filtered) && req.filtered.length ? req.filtered.join(', ') : null),
      kv('Unverified', req.unverified ? 'The phone couldn\'t find this site when asking: check for a typo' : null)),
    h('div', { class: 'flabel', style: 'margin-top:8px' }, 'Answer it'),
    requestCard(issue));
}

// A phone asking to change its default for photos, videos and sound, or to turn on search. Answered by someone who
// manages that phone (or with an approval PIN on the phone, like any request).
function settingRequestCard(issue, req) {
  const { title } = describe(req);
  const devId = String(req.device || '').toUpperCase(), dev = S.D.devices[devId];
  const phone = (dev && dev.name) || req.name || 'A phone';
  const fname = firstName(dev || { name: phone });
  const note = field(issue.body, 'Note');
  const card = h('article', { class: 'card', 'data-n': issue.number, 'data-type': req.type });
  const actions = h('div', { class: 'acts' }), panels = h('div');
  const may = fullAdmin() || canDo('manage');
  let onlyBox = null;
  const send = async (text, label) => {
    actions.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      await reply(issue.number, text, issue._again);
      if (issue._again) {
        const x = (S.answeredList || []).find(i => i.number === issue.number);
        if (x) x.answer = { ...x.answer, verdict: 'approved', undone: false, at: new Date().toISOString(), by: ME.name || ME.email, how: 'page', message: '', undoable: false, changed: [] };
        render();
        return say(`${label}. ${phone}'s phone is told within a few minutes.`);
      }
      S.answeredNumbers = [...(S.answeredNumbers || []), issue.number];
      S.requests = S.requests.filter(i => i.number !== issue.number);
      S.answered.unshift({ title, label: `${label} for ${phone}` });
      backOrRender();
      say(`${label}. GitHub does it within a minute, and ${phone} is told a few minutes after.`);
    } catch (e) {
      actions.querySelectorAll('button').forEach(b => b.disabled = false);
      say(e.message === 'NO_ISSUES' ? NO_ISSUES_MSG : e.message, true);
    }
  };
  let denyPanel = null;
  const openDeny = () => {
    if (denyPanel) { denyPanel.hidden = !denyPanel.hidden; return; }
    const reason = h('input', { class: 'inp reason', type: 'text', placeholder: 'e.g. not for now', 'aria-label': 'Reason' });
    denyPanel = h('div', { class: 'panel' }, h('div', { class: 'flabel' }, 'Why not? (optional, shown on their phone)'), reason,
      h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn dline grow denySend', onclick: () => send(('deny ' + reason.value.trim()).trim(), 'Denied') }, 'Deny')));
    panels.append(denyPanel); reason.focus();
  };
  const body = [];
  if (req.type === 'mediaDefault') {
    const want = req.want || {};
    body.push(h('div', { class: 'mrows', style: 'padding:2px 12px' }, MKINDS.map(([k, t]) => {
      const was = defBlocks(dev, k) ? 'blocked' : 'open', to = want[k] === 'open' || want[k] === 'blocked' ? want[k] : was;
      return h('div', { class: 'fromto' }, h('b', null, t), h('span', { class: 'was' }, capFirst(was)), h('span', { class: 'was' }, '→'),
        h('span', { class: 'now', style: `color:${to === was ? 'var(--muted)' : 'var(--accent)'}` }, capFirst(to) + (to === was ? ' (no change)' : '')));
    })));
    body.push(h('p', { class: 'hint', style: 'margin:0' }, `Approving changes it on every site on ${possessive(fname)} phone that's on Default.`));
  } else if (req.off === true) {
    body.push(h('p', { class: 'hint', style: 'margin:0' }, `Approving takes the search box off ${possessive(fname)} phone. You can turn it on again any time: Phones → ${phone} → Text search.`));
  } else {
    body.push(h('p', { class: 'hint', style: 'margin:0' }, `A search box on ${possessive(fname)} phone: words only, safe search on, nothing the filters block. Opening a result follows ${dev && dev.first ? 'their' : 'its'} lists as usual.`));
    // (Kept while the page redraws, e.g. after another answer.)
    const draft = (S.cardDrafts = S.cardDrafts || {})[issue.number] = (S.cardDrafts || {})[issue.number] || { only: req.approvedOnly === true };
    onlyBox = h('input', { type: 'checkbox', class: 'onlyApproved', id: `oa${issue.number}`, checked: draft.only, onchange: e => { draft.only = e.target.checked; } });
    body.push(h('div', { class: 'stack', style: 'gap:2px' }, h('label', { class: 'check', for: onlyBox.id }, onlyBox, h('span', { class: 'grow' }, 'Only show results already approved')),
      h('span', { class: 'small muted' }, `As ${fname} asked: ${req.approvedOnly ? 'only approved results' : 'all results (new sites too)'}. ${req.approvedOnly ? 'Untick' : 'Tick'} it to change that.`)));
  }
  if (may) {
    actions.append(h('button', { type: 'button', class: 'btn p grow approve', onclick: () => send(req.type === 'search' && onlyBox ? (onlyBox.checked ? 'approve approved-only' : 'approve all-results') : 'approve',
      req.type === 'search' ? (req.off === true ? 'Search turned off' : 'Search changed') : 'Default changed') }, 'Approve'));
    if (!issue._again) actions.append(h('button', { type: 'button', class: 'btn d deny', onclick: openDeny }, 'Deny'));
  }
  card.append(...[
    h('div', { class: 'who' }, h('span', null, h('span', { class: 'av' }, phone[0].toUpperCase()), h('b', null, phone), h('span', { class: 'muted small' }, '· ' + ago(issue.created_at)))),
    h('h3', null, title),
    note ? h('p', { class: 'quote' }, `“${note}”`) : null,
    ...body,
    may ? null : h('p', { class: 'hint', style: 'margin:0' }, `Only someone who manages ${possessive(fname)} phone can answer this.`),
    may ? actions : null, panels,
    req.type === 'search' && req.off !== true ? h('p', { class: 'hint', style: 'margin:0' }, `You can turn it off again any time: Phones → ${phone} → Text search.`) : null].filter(Boolean));
  return card;
}

function newPhoneCard(issue) {
  const r = marker(issue.body);
  const name = h('input', { class: 'inp', type: 'text', placeholder: 'Their name, e.g. Leo', 'aria-label': 'Name', id: `npName${issue.number}` });
  const save = h('button', { type: 'button', class: 'btn p wide npSave' }, 'Save');
  // This phone's default for photos, videos and sound: what Settings → New phones says, changeable here.
  const pid = String(r.id || '').toUpperCase();
  // (Kept while the page redraws, e.g. after another answer.)
  const draft = (S.cardDrafts = S.cardDrafts || {})[issue.number] = (S.cardDrafts || {})[issue.number] ||
    { name: '', md: { ...(((S.D.devices[pid] || {}).mediaDefault) || (S.D.newPhoneMedia || {})) } };
  const md = { mediaDefault: draft.md };
  const mdBox = () => h('div', { class: 'dash' },
    h('div', { class: 'klabel' }, h('span', { class: 'flabel' }, 'This phone\'s default'), h('span', { class: 'mtag' }, 'From Settings → New phones')),
    defaultRows(k => defBlocks(md, k) ? 'blocked' : 'open', (k, v) => { setDefault(md, k, v); draft.md = md.mediaDefault || {}; md.mediaDefault = draft.md; render(); }, false, `np${issue.number}_`),
    h('span', { class: 'small muted' }, `You can change these any time: Phones → ${name.value.trim() || 'the phone'}.`));
  save.onclick = async () => {
    const n = name.value.trim();
    if (!n) return say('Type a name first.', true);
    save.disabled = true;
    try {
      const blocked = MKINDS.map(([k]) => k).filter(k => defBlocks(md, k));
      await reply(issue.number, `name ${n} | blocked: ${blocked.join(',')}`);
      S.answeredNumbers = [...(S.answeredNumbers || []), issue.number];
      S.newPhones = S.newPhones.filter(i => i.number !== issue.number);
      S.answered.unshift({ title: `${r.model || 'Phone'} (${r.id})`, label: `Named ${n}` });
      render(); say(`Named ${n}. It shows under Phones in a minute or two.`);
    } catch (e) { save.disabled = false; say(e.message === 'NO_ISSUES' ? NO_ISSUES_MSG : e.message, true); }
  };
  if (draft.name) name.value = draft.name;
  name.addEventListener('input', () => { draft.name = name.value; });
  return h('article', { class: 'card', 'data-newphone': issue.number },
    h('div', { class: 'who' }, h('span', null, h('span', { class: 'av grey' }, icon('phone', 18)),
      h('span', { style: 'display:flex;flex-direction:column' }, h('b', null, r.model || 'Phone'), h('span', { class: 'muted small' }, `Registered ${ago(issue.created_at)}, no name yet`)))),
    h('div', { class: 'field' }, h('label', { for: name.id }, 'Name'), name),
    mdBox(), save);
}

