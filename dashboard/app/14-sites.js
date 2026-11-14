// ============================================================================================
// Sites
// ============================================================================================
function siteChips(s) {
  const c = [];
  c.push(s.home ? chip('On home page', 'teal') : chip('No tile'));
  if (s.pages.length) c.push(chip(s.pages.length === 1 ? '1 page only' : `${s.pages.length} pages only`));
  if (!s.subdomains) c.push(chip('Exact address'));
  const offK = ['photos', 'videos', 'sound'].filter(k => s['no' + capFirst(k)]);
  if (offK.length) c.push(chip(offK.length === 3 ? 'Photos, videos and sound blocked' : capFirst(joinWords(offK)) + ' blocked', '', 'photooff'));
  const onK = ['photos', 'videos', 'sound'].filter(k => s['on' + capFirst(k)]);
  if (onK.length) c.push(chip(onK.length === 3 ? 'Photos, videos and sound open' : capFirst(joinWords(onK)) + ' open', 'teal', 'photo'));
  if (s.passThrough) c.push(chip('Added automatically', '', 'link'));
  if (s.frames) c.push(chip('Embeds from anywhere', 'amber'));
  if (s.unfiltered) c.push(chip('Not filtered', 'red'));
  return c;
}
// ---------- search every list (Sites) ----------
// The other lists are fetched once, the first time the search is used; the open list is always as on screen.
async function searchIndex() {
  // Fetched once; every search waits for the same fetch (so none sees it half done).
  if (!S.otherLists) S.otherLists = (async () => {
    const got = {};
    await Promise.all(S.lists.map(async n => {
      try { const f = await getJson(listPathOf(n)); got[n] = f ? toModel(f.data).sites : []; } catch { got[n] = []; }
    }));
    return got;
  })();
  const others = await S.otherLists;
  const all = [];
  for (const n of S.lists) (n === S.current ? S.L.sites : (others[n] || [])).forEach(x => all.push({ list: n, site: x }));
  return all;
}
let suggestionTurn = 0;        // only the latest search's results are shown (an earlier one may finish later)
async function showSiteSuggestions(q, box) {
  const turn = ++suggestionTurn;
  q = q.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!q) { box.hidden = true; box.replaceChildren(); return; }
  const all = await searchIndex();
  if (turn !== suggestionTurn) return;
  // One suggestion per site: its name, address, and which lists it's in.
  const bySite = new Map();
  all.filter(({ site }) => (site.name || '').toLowerCase().includes(q) || (site.domain || '').toLowerCase().includes(q)).forEach(({ list, site }) => {
    const key = (site.domain || '').replace(/^www\./, '');
    if (!bySite.has(key)) bySite.set(key, { site, lists: [] });
    bySite.get(key).lists.push(list);
  });
  const hits = [...bySite.values()].slice(0, 8);
  box.replaceChildren(...(hits.length ? hits.map(({ site, lists }) => h('button', { type: 'button', class: 'sugg', role: 'option', onclick: async () => {
      const where = lists.includes(S.current) ? S.current : lists[0];
      if (where !== S.current) { await switchList(where); if (S.current !== where) return; }
      const i = S.L.sites.findIndex(x => (x.domain || '').replace(/^www\./, '') === (site.domain || '').replace(/^www\./, ''));
      S.siteQuery = ''; if (i >= 0) open({ name: 'site', index: i });
    } },
    h('span', { class: 'tile', style: `color:${tileColor(site.domain)}` }, (site.name || site.domain || '?').replace(/^www\./, '')[0].toUpperCase()),
    h('span', { class: 'grow', style: 'min-width:0;display:flex;flex-direction:column' }, h('b', null, site.name || site.domain),
      h('span', { class: 'muted small' }, `${site.domain} · in ${lists.map(listLabel).join(', ')}`))))
    : [h('div', { class: 'muted small', style: 'padding:12px 14px' }, 'No site matches.')]));
  box.hidden = false;
}

function sitesScreen() {
  const L = S.L;
  const suggBox = h('div', { class: 'suggs', role: 'listbox', id: 'siteSuggestions', hidden: true });
  const siteSearch = h('div', { class: 'searchbox', style: 'position:relative' }, icon('search', 18),
    h('input', { class: 'inp', id: 'siteSearch', type: 'search', placeholder: 'Search sites in every list', 'aria-label': 'Search sites in every list',
      value: S.siteQuery || '', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'off',
      oninput: e => { S.siteQuery = e.target.value; showSiteSuggestions(S.siteQuery, suggBox); },
      onblur: () => setTimeout(() => { suggBox.hidden = true; }, 200),
      onfocus: e => { if (e.target.value.trim()) showSiteSuggestions(e.target.value, suggBox); } }), suggBox);
  const users = phonesUsing(S.current);
  const info = S.current === 'public'
    ? `The general list${users.length ? `, used by ${users.join(', ')}` : ''}.`
    : users.length ? `${users.join(', ')}'s list. It adds to their other lists.` : 'Not given to any phone yet (see Phones).';
  const live = L.temporary.filter(t => tempEnd(t) > Date.now());
  const temps = live.map(t => h('div', { class: 'tempcard' }, icon('clock', 22),
    h('span', { class: 'grow' }, h('b', null, t.entry), h('span', { class: 'small' }, `${t.what === 'media' ? 'Photos, videos and sound on' : t.what === 'photos' ? 'Photos on' : t.what === 'videos' ? 'Videos on' : t.what === 'sound' ? 'Sound on' : 'Open'} ${tempLeft(t)}${t.unfiltered ? ', despite a filter' : ''}`)),
    h('button', { type: 'button', onclick: () => { L.temporary = L.temporary.filter(x => x !== t); markList(); render(); say(`${t.entry} will close in a few minutes.`); } }, 'End now')));
  const rows = L.sites.map((s, i) => h('button', { type: 'button', class: 'row siterow', onclick: () => open({ name: 'site', index: i }) },
    h('span', { class: 'tile', style: `color:${tileColor(s.domain)}` }, (s.name || s.domain || '?').replace(/^www\./, '')[0].toUpperCase()),
    h('span', { class: 'grow' }, h('span', { style: 'display:flex;align-items:baseline;gap:6px;min-width:0' },
      h('span', { class: 'name' }, s.name || s.domain.replace(/^www\./, '')), s.name ? h('span', { class: 'dom' }, s.domain) : null),
      h('span', { class: 'chips' }, siteChips(s))),
    h('span', { class: 'chev' }, icon('chev', 18))));
  const moreRow = (ic, label, count, onclick, id) => h('button', { type: 'button', class: 'row', onclick, id },
    h('span', { class: 'ic' }, icon(ic, 20)), h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, label)),
    count != null ? h('span', { class: 'count' }, count) : null, h('span', { class: 'chev' }, icon('chev', 18)));
  return h('main', { class: 'stack' },
    screenTitle('Sites', 'What each list lets phones open'),
    siteSearch,
    h('div', { class: 'listrow' },
      h('div', { class: 'listchips', role: 'group', 'aria-label': 'Lists' },
        [...publicListNames(), ...S.lists.filter(n => !isPublicList(n))].map(n => h('button', { type: 'button', class: 'lc', 'aria-pressed': String(n === S.current),
          title: isPublicList(n) ? 'Public list' : null, onclick: () => switchList(n) }, isPublicList(n) ? icon('globe', 14) : null, listLabel(n)))),
      h('button', { type: 'button', class: 'lc add', 'aria-label': 'New list', title: 'New list', onclick: newList }, icon('plus', 18))),
    h('p', { class: 'hint', style: 'margin-top:-4px' }, info),
    temps,
    h('div', { class: 'h2row' }, h('h2', { class: 'sec' }, 'Allowed ', h('span', { class: 'muted', style: 'font-weight:500' }, `· ${L.sites.length}`)),
      h('button', { type: 'button', class: 'btn p sm', id: 'addSite', onclick: () => open({ name: 'site', index: -1 }) }, icon('plus', 18, 2.2), 'Add site')),
    L.sites.length ? h('div', { class: 'group', id: 'siteList' }, rows)
      : h('div', { class: 'card empty' }, h('b', null, 'No sites yet'), 'Tap Add site, or import a spreadsheet (List settings).'),
    // (Pages without photos, videos or sound, and embedded content allowed, are in each site's settings; import and
    // the list-wide overviews in List settings.)
    h('div', { class: 'group' },
      moreRow('clock', 'Open something temporarily', null, () => open({ name: 'temp' }), 'openTemp'),
      moreRow('ban', 'Blocked & limited pages', new Set([...L.block, ...L.noPhotoPages, ...L.noVideoPages, ...L.noSoundPages, ...(L.photosOn || []), ...(L.videosOn || []), ...(L.soundOn || []), ...(L.mediaAllow || [])]).size || null, () => open({ name: 'nomedia' }), 'openBlock'),
      moreRow('gear', 'List settings', null, () => open({ name: 'listsettings' }), 'openListSettings')));
}

// ---------- one site ----------
function siteScreen() {
  const sub = S.sub;
  const isNew = sub.index < 0;
  if (!sub.draft) {
    const s = isNew ? { domain: '', name: '', url: '', home: true, subdomains: true, pages: [], noPhotos: false, noVideos: false, noSound: false, onPhotos: false, onVideos: false, onSound: false, passThrough: false, frames: false, unfiltered: false, filtersOff: [] } : S.L.sites[sub.index];
    sub.draft = { ...s, pages: [...s.pages], only: s.pages.length > 0, filtersOff: [...(s.filtersOff || [])] };
  }
  const d = sub.draft;
  const name = h('input', { class: 'inp', id: 'sName', value: d.name, placeholder: 'e.g. Wikipedia', oninput: e => { d.name = e.target.value; } });
  const addr = h('input', { class: 'inp', id: 'sDomain', value: d.domain, placeholder: 'e.g. wikipedia.org', autocapitalize: 'off', spellcheck: 'false', inputmode: 'url',
    oninput: e => { d.domain = e.target.value; e.target.classList.remove('bad'); } });
  const url = h('input', { class: 'inp', id: 'sUrl', value: d.url, placeholder: 'e.g. https://www.bbc.co.uk/bitesize', autocapitalize: 'off', spellcheck: 'false', oninput: e => { d.url = e.target.value; } });
  const toggle = (id, title, hint, key) => h('label', { class: 'tg', for: id },
    h('span', { class: 'grow' }, h('span', { class: 't' }, title), hint ? h('span', { class: 's' }, hint) : null),
    h('input', { type: 'checkbox', class: 'sw', id, checked: !!d[key], onchange: e => { d[key] = e.target.checked; if (key === 'only' || key === 'frames' || key === 'unfiltered') render(); } }));
  const bare = (normalize(d.domain) || 'the site').replace(/^www\./, '');
  const pageInput = h('input', { class: 'inp', id: 'sPageNew', placeholder: `e.g. ${bare}/some-page`, autocapitalize: 'off', spellcheck: 'false' });
  const addPage = () => {
    const k = pageKey(pageInput.value);
    const dom = normalize(d.domain);
    if (!k) return say('Type a page address, e.g. youtube.com/watch?v=abc', true);
    if (dom && !pageOnSite(k, dom, d.subdomains)) return say(`That page isn't on ${dom}.`, true);
    if (!d.pages.includes(k)) d.pages.push(k);
    render();
  };
  const pages = d.only ? h('div', { class: 'group' },
    d.pages.map((p, i) => h('div', { class: 'row' }, h('span', { class: 'grow mono' }, p),
      h('button', { type: 'button', class: 'btn s sm', 'aria-label': `Remove ${p}`, style: 'min-height:36px;padding:0 10px', onclick: () => { d.pages.splice(i, 1); render(); } }, icon('x', 16, 2)))),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, h('div', { class: 'inrow' }, pageInput, h('button', { type: 'button', class: 'btn s', id: 'sAddPage', onclick: addPage }, 'Add')))))
    : null;
  pageInput.addEventListener('keydown', e => { if (e.key === 'Enter') addPage(); });
  // Build + validate the entry and write it into the list. Returns true if it saved. silent=true (used when you just
  // leave the screen) skips the error messages and simply declines to save an incomplete entry — so you don't have to
  // remember the Done button on a long screen; finishing and navigating away saves it for you.
  const commit = (silent) => {
    if (sub.committed) return true;
    const dom = (normalize(d.domain) || '').replace(/^(www|m|mobile)\.(?=[^.]+\.[^.]+)/, '') || undefined;
    if (!dom) { if (!silent) { addr.classList.add('bad'); addr.focus(); say(d.domain.trim() ? `"${d.domain}" doesn't look like a website address.` : 'Type the site\'s address.', true); } return false; }
    if (S.L.sites.some((s, i) => i !== sub.index && (normalize(s.domain) || '').replace(/^(www|m|mobile)\.(?=[^.]+\.[^.]+)/, '') === dom)) { if (!silent) say(`${dom} is already on this list.`, true); return false; }
    for (const p of d.pages) if (!pageOnSite(p, dom, d.subdomains)) { if (!silent) say(`The page ${p} isn't on ${dom}.`, true); return false; }
    const site = { domain: dom, name: d.name.trim(), url: d.url.trim(), home: d.home, subdomains: d.subdomains,
      pages: d.only ? [...d.pages] : [], noPhotos: d.noPhotos, noVideos: d.noVideos, noSound: d.noSound,
      onPhotos: !!d.onPhotos && !d.noPhotos, onVideos: !!d.onVideos && !d.noVideos, onSound: !!d.onSound && !d.noSound, passThrough: d.passThrough, frames: d.frames, unfiltered: d.unfiltered,
      filtersOff: [...d.filtersOff] };
    // Only treat it as a change (and save) if something actually differs — leaving a site you merely opened and looked
    // at should not mark anything dirty or kick off a save. Field order doesn't matter; compare by key.
    const sameSite = (a, b) => { const ks = Object.keys(a); return a && b && ks.length === Object.keys(b).length && ks.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k])); };
    sub.committed = true;
    if (sub.index >= 0 && sameSite(S.L.sites[sub.index], site)) return true;   // nothing changed → no dirty, no save
    if (sub.index < 0) { S.L.sites.push(site); sub.index = S.L.sites.length - 1; } else S.L.sites[sub.index] = site;
    markList();
    return true;
  };
  sub.commit = () => commit(true);      // leaving the screen saves what's there, as if Done was tapped
  const done = () => { const nm = d.name.trim() || (normalize(d.domain) || '').replace(/^www\./, ''); if (commit(false)) { back(); say(`${isNew ? 'Added' : 'Updated'} ${nm}. It saves automatically.`); } };
  const remove = async () => {
    if (!(await uiConfirmDanger(`Remove ${d.name || d.domain}?`, `It comes off ${listLabel(S.current)} in a few minutes.`, 'Remove'))) return;
    S.L.sites.splice(sub.index, 1); sub.committed = true; markList(); back();   // committed: stop leave-save re-adding it
  };
  const letter = (d.name || d.domain || '?').replace(/^www\./, '')[0] || '?';
  return h('main', { class: 'stack', style: 'padding-bottom:24px' },
    backLink('Sites'),
    h('div', { style: 'display:flex;align-items:center;gap:14px;padding:0 4px' },
      h('span', { class: 'tile big', style: `color:${tileColor(d.domain)}` }, letter.toUpperCase()),
      h('div', { style: 'min-width:0' }, h('h1', { style: 'margin:0;font:700 28px/1.15 var(--display);overflow-wrap:anywhere' }, isNew ? 'Add a site' : (d.name || d.domain)),
        h('span', { class: 'muted small' }, `In ${listLabel(S.current)}`))),
    d.passThrough ? h('p', { class: 'warn' }, 'Added automatically: a link passes through this address on its way to an approved site.') : null,
    h('div', { class: 'field' }, h('label', { for: 'sDomain' }, 'Address'), addr),
    h('div', { class: 'field' }, h('label', { for: 'sName' }, 'Name on the home page'), name),
    h('div', { class: 'group' },
      toggle('sHome', 'Show on the home page', 'Gives it a tile', 'home'),
      toggle('sSubs', 'Include subdomains', `Also m.${bare}, and other addresses ending in ${bare}`, 'subdomains'),
      toggle('sOnly', 'Only some pages', 'Everything else on the site stays blocked', 'only')),
    pages,
    siteMediaCompact(d, isNew),
    h('div', { class: 'group' },
      toggle('sFrames', 'Allow content embedded from other sites', 'Embedded videos, maps and sign-in boxes work, from any site. Leaving this site is still blocked, and the ad and adult filters still apply.', 'frames')),
    d.frames ? h('p', { class: 'warn' }, 'Only for sites you trust: whatever this site chooses to embed will show, even from sites that aren\'t on your lists.') : null,
    !isNew && normalize(d.domain) ? siteEmbeds(normalize(d.domain).replace(/^www\./, ''), d.frames) : null,
    !isNew && normalize(d.domain) ? sitePagesMedia(normalize(d.domain).replace(/^www\./, '')) : null,
    h('div', { class: 'group' },
      toggle('sUnfiltered', 'Open even if a filter lists it', 'For a site the adult, gambling or malware filter blocks, that you\'ve checked and want to allow anyway.', 'unfiltered')),
    d.unfiltered ? h('p', { class: 'warn', style: 'background:var(--red-soft);color:#7A2A1D' }, 'The adult, gambling and malware filters don\'t apply to this site. Only for sites you\'ve checked yourself.') : null,
    // AdGuard's groups switched off on this site's pages (for the phones using this list).
    h('div', { class: 'card', style: 'gap:10px' },
      h('span', { style: 'font-weight:700' }, 'Filters off on this site\'s pages'),
      h('span', { class: 'small', style: 'color:var(--muted)' }, 'If it doesn\'t look or work right, switch off just the one causing it. Usually Annoyances.'),
      h('div', { class: 'chips', style: 'gap:8px' }, [['ads', 'Ads'], ['trackers', 'Trackers'], ['annoyances', 'Annoyances']].map(([k, t]) => {
        const off = d.filtersOff.includes(k);
        return h('button', { type: 'button', class: 'lc pick', id: 'sOff_' + k, 'aria-pressed': String(off), onclick: () => {
          d.filtersOff = off ? d.filtersOff.filter(x => x !== k) : [...d.filtersOff, k]; render(); } }, off ? icon('check', 15, 2.4) : null, t);
      }))),
    !isNew && normalize(d.domain) ? h('a', { href: '#', class: 'tempcard', onclick: e => { e.preventDefault(); open({ name: 'temp', entry: normalize(d.domain), what: 'site' }); } },
      icon('clock', 20), h('span', { class: 'grow' }, 'Open it temporarily instead'), icon('chev', 18)) : null,
    h('button', { type: 'button', class: 'btn p wide', id: 'sDone', onclick: done }, isNew ? 'Add site' : 'Done'),
    !isNew ? h('button', { type: 'button', class: 'btn d', id: 'sRemove', onclick: remove }, 'Remove this site') : null);
}

// The small photos/videos/sound row on the site screen: one Open/Blocked/Default choice for all three at once, with a
// "Set each" disclosure that opens the full per-part control. Stays on this one screen (no navigating away) so a
// half-typed new site is never lost. (Always-blocked pages live together on one page — Sites → Blocked & limited pages.)
function siteMediaCompact(d, isNew) {
  const agg = MKINDS.map(([k]) => { const K = capFirst(k); return d['no' + K] ? 'blocked' : d['on' + K] ? 'open' : 'default'; });
  const uniform = agg.every(v => v === agg[0]) ? agg[0] : 'mixed';
  const setAll = nv => { MKINDS.forEach(([k]) => { const K = capFirst(k); d['no' + K] = nv === 'blocked'; d['on' + K] = nv === 'open'; }); render(); };
  return h('div', { class: 'stack', style: 'gap:8px' },
    // Label and note on their own lines (full width), the segment below — so the text isn't squeezed next to the buttons.
    h('div', { class: 'mrow' },
      h('b', null, 'Photos, videos and sound'),
      h('span', { class: 's' }, uniform === 'mixed' ? 'Set differently per part — open “Set each” below' : 'Tap “Set each” to split them'),
      h('div', { style: 'margin-top:4px' }, obSeg('Photos, videos and sound', uniform === 'mixed' ? '' : uniform, setAll,
        { opts: [['default', 'Default'], ['open', 'Open'], ['blocked', 'Blocked']], id: 'sMediaAll' }))),
    h('details', { class: 'more' }, h('summary', null, 'Set each (photos, videos, sound)'),
      h('div', { style: 'margin-top:10px' }, siteMedia(d))));
}
// A site's photos, videos and sound: Default (each phone's own default), Open or Blocked (for every phone using this list).
function siteMedia(d) {
  const users = Object.entries(S.D.devices).filter(([, x]) => (x.lists || []).includes(S.current)).map(([, x]) => x);
  const DESC = { photos: 'Pictures on the pages', videos: 'Moving pictures: a video\'s sound still plays if sound is open', sound: 'Music, podcasts, and videos\' sound' };
  const sub = (k, v) => {
    if (v === 'open') return 'Open on every phone using this list';
    if (v === 'blocked') return 'Blocked on every phone using this list';
    if (!users.length) return 'Each phone\'s own default';
    const open = users.filter(x => !defBlocks(x, k)), blocked = users.filter(x => defBlocks(x, k));
    // Many phones: show counts, not a long list of names, so the line stays short.
    if (users.length > 4) return 'Default now: ' + [open.length ? `open on ${open.length}` : '', blocked.length ? `blocked on ${blocked.length}` : ''].filter(Boolean).join(', ') + ` of ${users.length} phones`;
    return 'Default now: ' + [open.length ? `open for ${joinWords(open.map(firstName))}` : '', blocked.length ? `blocked for ${joinWords(blocked.map(firstName))}` : ''].filter(Boolean).join(', ');
  };
  return h('div', { class: 'stack', style: 'gap:8px' },
    h('span', { class: 'flabel', style: 'margin-top:4px' }, 'Photos, videos and sound on this site'),
    h('div', { class: 'mrows' }, MKINDS.map(([k, t]) => {
      const K = capFirst(k), v = d['no' + K] ? 'blocked' : d['on' + K] ? 'open' : 'default';
      // Short label beside the buttons; the longer description sits on its own full-width line below (so it doesn't
      // get squeezed into a tall, narrow column next to the three-wide segment).
      return h('div', { class: 'mrow' },
        h('div', { class: 'top' }, h('b', null, t),
          obSeg(t, v, nv => { d['no' + K] = nv === 'blocked'; d['on' + K] = nv === 'open'; render(); }, { opts: [['default', 'Default'], ['open', 'Open'], ['blocked', 'Blocked']], id: 'sMedia_' + k })),
        h('span', { class: 's' }, DESC[k]),
        h('span', { class: 's', 'data-sub': k }, sub(k, v)));
    })),
    h('div', { class: 'explain' },
      h('span', null, h('b', null, 'Default'), ': each phone\'s own default. Change a phone\'s default, and this site changes with it.'),
      h('span', null, h('b', null, 'Open'), ' or ', h('b', null, 'Blocked'), ': stays like this for every phone using this list, whatever their default.')));
}

// ---------- open something for a while ----------
const MEDIA_T = ['media', 'photos', 'videos', 'sound'];   // temporary access that turns photos, videos or sound on
function tempScreen() {
  const sub = S.sub;
  sub.what = sub.what || 'site'; sub.mode = sub.mode || 'clock';
  const addr = h('input', { class: 'inp', id: 'tAddr', value: sub.entry || '', placeholder: 'e.g. coolmathgames.com', autocapitalize: 'off', spellcheck: 'false', oninput: e => { sub.entry = e.target.value; } });
  const len = h('div', { class: 'flabel', id: 'tLen' });
  const host = h('div', { 'data-sync': '' });
  const picker = makePicker(host, sub.minutes || 30, m => { sub.minutes = m; len.textContent = `How long: ${fmtMin(m)}`; });
  host._picker = picker;
  if (sub.what === 'media' && !sub.mediaSel) sub.mediaSel = [];   // nothing picked by default — you choose
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'What to open' },
    [['site', 'Whole site'], ['page', 'One page'], ['media', 'Photos/videos/sound']].map(([v, t]) =>
      h('button', { type: 'button', 'aria-pressed': String(sub.what === v), onclick: () => { if (sub.what !== v) { sub.what = v; render(); } } }, t)));
  // Photos, videos and sound: pick any (more than one is fine) — no "All".
  const toggleMedia = v => { const s = new Set(sub.mediaSel || []); if (s.has(v)) s.delete(v); else s.add(v); sub.mediaSel = [...s]; render(); };
  const seg2 = sub.what === 'media' ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Which' },
    [['photos', 'Photos'], ['videos', 'Videos'], ['sound', 'Sound']].map(([v, t]) =>
      h('button', { type: 'button', 'aria-pressed': String((sub.mediaSel || []).includes(v)), onclick: () => toggleMedia(v) }, t))) : null;
  const radio = (v, t, s) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'tMode', value: v, checked: sub.mode === v, onchange: () => { sub.mode = v; } }),
    h('span', null, h('b', { style: 'font-weight:600' }, t), h('span', { class: 'small muted', style: 'display:block' }, s)));
  const add = () => {
    const raw = (sub.entry || '').trim();
    const isMedia = sub.what === 'media';
    const entry = sub.what === 'page' || (isMedia && hasPath(raw)) ? pageKey(raw) : normalize(raw);
    if (!entry) return say(sub.what === 'page' ? 'Type the page address, e.g. youtube.com/watch?v=abc' : 'Type a website address.', true);
    if (sub.what === 'page' && !hasPath(raw)) return say('For One page, type the full page address.', true);
    const kinds = isMedia ? (sub.mediaSel || []) : [sub.what];
    if (isMedia && !kinds.length) return say('Pick at least one of photos, videos or sound.', true);
    const minutes = picker.get();
    if (!minutes) return say('Choose how long on the wheels.', true);
    kinds.forEach(k => {
      S.L.temporary = S.L.temporary.filter(t => !(t.what === k && t.entry === entry));
      S.L.temporary.push({ id: 't' + Date.now().toString(36) + k, what: k, entry, mode: sub.mode, minutes, from: new Date().toISOString() });
    });
    markList(); back();
    say(`${entry}: ${fmtMin(minutes)}${sub.mode === 'use' ? ' of use' : ''}. It saves automatically.`);
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' },
    backLink('Sites'),
    screenTitle('Open temporarily', `In ${listLabel(S.current)}. Even if it's otherwise blocked, and it closes by itself.`),
    h('p', { class: 'hint' }, 'To answer a phone\'s request, use Temporary on the request instead, so the phone is told.'),
    h('div', { class: 'field' }, h('label', { for: 'tAddr' }, sub.what === 'page' ? 'Page address' : 'Site or page'), addr),
    h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'What to open'), seg, seg2),
    h('div', { class: 'card', style: 'padding:12px 16px 4px' }, len, host),
    h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'Count the time'),
      h('div', { class: 'group' }, radio('clock', 'From now', 'Ends at a set time.'), radio('use', 'Only while it\'s open on the phone', 'Time on the site, to use within 7 days.'))),
    h('button', { type: 'button', class: 'btn p wide', id: 'tAdd', onclick: add }, 'Add'));
}

// ---------- always blocked / no photos on pages / never block (one address per line) ----------
// Embedded content allowed on a site (the list's "embeds"): content from these sites may show inside that
// site's pages, like a video or a map. Usually approved from a request; can be added or removed here.
function embedsScreen() {
  const L = S.L;
  const E = (L.extra && L.extra.embeds && typeof L.extra.embeds === 'object') ? L.extra.embeds : {};
  const save = next => {
    const clean = {};
    Object.keys(next).sort().forEach(k => { if (next[k] && next[k].length) clean[k] = [...new Set(next[k])].sort(); });
    L.extra = { ...(L.extra || {}) };
    if (Object.keys(clean).length) L.extra.embeds = clean; else delete L.extra.embeds;
    markList(); render();
  };
  const rows = [];
  Object.keys(E).sort().forEach(site => (E[site] || []).forEach(from => rows.push(
    h('div', { class: 'row' }, h('span', { class: 'ic' }, icon('link', 20)),
      h('span', { class: 'grow' }, h('span', { style: 'font-weight:600' }, from), h('span', { class: 'dom' }, `inside ${site}`)),
      h('button', { type: 'button', class: 'btn d sm', 'aria-label': `Remove ${from} on ${site}`, onclick: () => {
        const next = { ...E, [site]: (E[site] || []).filter(x => x !== from) };
        save(next); say(`Removed ${from} on ${site}. It saves automatically.`);
      } }, 'Remove')))));
  const site = h('input', { class: 'inp', id: 'emSite', placeholder: 'Site, e.g. bbc.co.uk', autocomplete: 'off' });
  const from = h('input', { class: 'inp', id: 'emFrom', placeholder: 'Content from: a site, or one part (youtube.com/embed/abc)', autocomplete: 'off' });
  const add = () => {
    // The site, and what may show inside it: a whole site, or one exact part (host + path, no "?...").
    const s1 = (normalize(site.value) || '').replace(/^(www|m)\./, '');
    const raw = from.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('?')[0].split('#')[0].replace(/\/+$/, '');
    const f1 = raw.includes('/') ? (/^[a-z0-9.-]+\.[a-z]{2,}\//.test(raw) ? raw : '') : (normalize(raw) || '').replace(/^www\./, '');
    if (!s1 || !f1 || hasPath(s1)) return say('Type a site, e.g. bbc.co.uk, and what may show in it: a site like player.vimeo.com, or one part like youtube.com/embed/abc.', true);
    save({ ...E, [s1]: [...(E[s1] || []), f1] }); say(`Content from ${f1} can show on ${s1} in a few minutes.`);
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Sites'),
    screenTitle('Embedded content allowed', `In ${listLabel(S.current)}`),
    h('p', { class: 'hint' }, 'Content from these sites (like a video or a map) may show inside the site named under it, but only there: the site itself doesn\'t open. ' +
      'An entry with a path, like youtube.com/embed/abc, is one exact part only. ' +
      'Phones ask for this when part of a page was blocked. For a site you trust completely, use its Allow content embedded from other sites switch instead.'),
    rows.length ? h('div', { class: 'group' }, rows) : h('div', { class: 'card empty' }, h('b', null, 'Nothing yet'), 'Approved requests for blocked parts of pages appear here.'),
    h('div', { class: 'card stack', style: 'gap:10px' }, h('b', null, 'Add one'), site, from,
      h('button', { type: 'button', class: 'btn s', id: 'emAdd', onclick: add }, 'Add')));
}

function linesScreen({ backTo, title, sub, hint, value, placeholder, check, apply, id }) {
  const ta = h('textarea', { class: 'inp', id, spellcheck: 'false', autocapitalize: 'off', placeholder, value });
  const done = () => {
    const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
    const bad = lines.filter(l => !check(l));
    if (bad.length) { ta.classList.add('bad'); return say(`These don't look like website addresses: ${bad.join(', ')}`, true); }
    apply(lines); back();
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink(backTo), screenTitle(title, sub),
    h('p', { class: 'hint' }, hint), ta, h('button', { type: 'button', class: 'btn p wide', id: id + 'Done', onclick: done }, 'Done'));
}
const blockScreen = () => linesScreen({ backTo: 'Sites', title: 'Always blocked', sub: `In ${listLabel(S.current)}`, id: 'blockText',
  hint: 'Parts of allowed sites to keep blocked, one per line: a site like maps.google.com, or a single page like en.wikipedia.org/wiki/Fortnite.',
  value: S.L.block.join('\n'), placeholder: 'maps.google.com', check: blockEntry,
  apply: lines => { if (lines.join('\n') !== S.L.block.join('\n')) { S.L.block = lines; markList(); } } });
// Single pages without photos, videos and/or sound: one box each (a page in all three has them all off).
// And single photos or videos allowed where they're otherwise off.
// One page for everything done per-page: always-blocked pages, turning photos/videos/sound off on some pages, and
// turning single ones back on. (Always blocked used to be its own screen — it lives here now, grouped with the rest.)
function noMediaScreen() {
  const L = S.L;
  const box = (id, label, value, ph = 'en.wikipedia.org/wiki/Shark') => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('textarea', { class: 'inp', id, rows: 4, placeholder: ph, autocapitalize: 'off', spellcheck: 'false',
      style: 'min-height:92px;padding-top:12px;font-family:ui-monospace,Menlo,monospace;font-size:14px' }, value.join('\n')));
  const apply = () => {
    const read = id => [...new Set(($(id) ? $(id).value : '').split('\n').map(x => x.trim()).filter(Boolean))];
    const block = read('blkText'), photos = read('npText'), videos = read('nvText'), sound = read('nsText'), items = read('maText');
    const onP = read('onpText'), onV = read('onvText'), onS = read('onsText');
    const bad = [...block, ...photos, ...videos, ...sound].filter(l => !blockEntry(l));
    const badOn = [...onP, ...onV, ...onS].filter(l => !(hasPath(l) ? blockEntry(l) : normalize(l)));
    if (badOn.length) return say(`These don't look like site or page addresses: ${badOn.join(', ')}`, true);
    if (bad.length) return say(`These don't look like page addresses: ${bad.join(', ')}`, true);
    const same = (a, b) => a.join('\n') === b.join('\n');
    if (!same(block, L.block) || !same(photos, L.noPhotoPages) || !same(videos, L.noVideoPages) || !same(sound, L.noSoundPages) || !same(items, L.mediaAllow) ||
        !same(onP, L.photosOn) || !same(onV, L.videosOn) || !same(onS, L.soundOn)) {
      L.block = block; L.noPhotoPages = photos; L.noVideoPages = videos; L.noSoundPages = sound; L.mediaAllow = items;
      L.photosOn = onP; L.videosOn = onV; L.soundOn = onS; markList();
    }
    back();
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Sites', apply),
    screenTitle('Blocked & limited pages', `In ${listLabel(S.current)}`),
    h('h2', { class: 'sec' }, 'Always blocked'),
    h('p', { class: 'hint' }, 'Parts of an otherwise-open site to keep blocked, one per line — a single page like en.wikipedia.org/wiki/Fortnite, or a part like maps.google.com.'),
    box('blkText', 'Always blocked', L.block, 'maps.google.com'),
    h('h2', { class: 'sec' }, 'Photos, videos or sound off'),
    h('p', { class: 'hint' }, 'Single pages that open normally but with one kind off, one per line. Put a page in all three to turn them all off. For a whole site, use its switches instead.'),
    box('npText', 'No photos on these pages', L.noPhotoPages), box('nvText', 'No videos on these pages', L.noVideoPages),
    box('nsText', 'No sound on these pages', L.noSoundPages),
    h('h2', { class: 'sec' }, 'Turned back on'),
    h('p', { class: 'hint' }, 'Single photos or videos to show where they\'re otherwise off — phones ask for these by tapping a blocked photo or video.'),
    box('maText', 'Single photos and videos allowed', L.mediaAllow, 'ichef.bbci.co.uk/news/976/shark.jpg'),
    h('p', { class: 'hint' }, 'Sites or pages where photos, videos or sound show for the phones using this list, whatever other lists say.'),
    box('onpText', 'Photos back on for', L.photosOn || [], 'nasa.gov  or  nasa.gov/moon'),
    box('onvText', 'Videos back on for', L.videosOn || []), box('onsText', 'Sound back on for', L.soundOn || []),
    h('button', { type: 'button', class: 'btn p wide', id: 'npDone', onclick: apply }, 'Done'));
}
const neverBlockScreen = () => linesScreen({ backTo: 'Settings', title: 'Never block these addresses', sub: 'Wherever they\'re loaded, for every phone', id: 'neverText',
  hint: 'If a site breaks because something it loads from another address is blocked, add that address here, one per line. ' +
    '(To switch filters off on a whole site\'s pages, open the site in Sites: "Filters off on this site\'s pages".)',
  value: (S.D.adblockExceptions || []).join('\n'), placeholder: 'googletagmanager.com', check: normalize,
  apply: lines => { S.D.adblockExceptions = [...new Set(lines.map(normalize))]; markDevices(); } });

// ---------- import ----------
function importScreen() {
  const ta = h('textarea', { class: 'inp', id: 'bulkText', spellcheck: 'false', autocapitalize: 'off', placeholder: 'domain\tname\twikipedia.org\tWikipedia' });
  const file = h('input', { type: 'file', id: 'bulkFile', accept: '.csv,.tsv,.txt,.xlsx,.xls,.ods' });
  const mode = v => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'bulkMode', value: v, checked: v === 'merge' }),
    h('span', null, h('b', { style: 'font-weight:600' }, v === 'merge' ? 'Add to the list' : 'Replace the list'),
      h('span', { class: 'small muted', style: 'display:block' }, v === 'merge' ? 'Sites already on it are updated.' : 'Sites not in the spreadsheet are removed.')));
  const run = async () => {
    try {
      let rows;
      const f = file.files[0];
      if (f && /\.(xlsx|xls|ods)$/i.test(f.name)) {
        await loadSheetJs();
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      } else if (f) rows = parseDelimited((await f.text()).replace(/^\ufeff/, ''));
      else rows = parseDelimited(ta.value);
      const { sites, bad } = rowsToSites(rows);
      if (!sites.length) return say(bad.length ? `No website addresses found. Not understood: ${bad.slice(0, 5).join(', ')}` : 'Paste some rows or choose a file first.', true);
      const replace = document.querySelector('input[name=bulkMode]:checked').value === 'replace';
      if (replace) S.L.sites = [];
      let added = 0, updated = 0;
      for (const s of sites) {
        const i = S.L.sites.findIndex(x => normalize(x.domain) === s.domain);
        if (i >= 0) { S.L.sites[i] = { ...S.L.sites[i], ...s, passThrough: S.L.sites[i].passThrough }; updated++; } else { S.L.sites.push(s); added++; }
      }
      markList(); back();
      say(`${plural(added, 'site')} added${updated ? `, ${updated} updated` : ''}${bad.length ? `. Skipped: ${bad.slice(0, 5).join(', ')}` : ''}. They save automatically.`);
    } catch (e) { say(e.message, true); }
  };
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Sites'),
    screenTitle('Import or download a spreadsheet', `Into ${listLabel(S.current)}`),
    h('p', { class: 'hint' }, 'Paste cells from Excel or Google Sheets, or choose a file. Columns: domain, name, home page, tile opens, subdomains, only these pages, no photos or videos. Only the domain is needed.'),
    ta, h('div', { class: 'field' }, h('label', { for: 'bulkFile' }, 'Or choose a file (.csv, .xlsx)'), file),
    h('div', { class: 'group' }, mode('merge'), mode('replace')),
    h('button', { type: 'button', class: 'btn p wide', id: 'bulkImport', onclick: run }, 'Import'),
    h('div', { class: 'acts', style: 'justify-content:center' },
      h('button', { type: 'button', class: 'btn s sm', onclick: exportCsv }, 'Download this list as a spreadsheet'),
      h('button', { type: 'button', class: 'btn s sm', id: 'exportAll', onclick: exportAll }, 'Download everything (all lists and phones)'),
      INAPP ? null : h('a', { class: 'btn s sm', href: 'sites-template.csv', download: '' }, 'Download a template')));
}

// ---------- list settings ----------
function listSettingsScreen() {
  const L = S.L;
  const users = phonesUsing(S.current);
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, backLink('Sites'),
    screenTitle(S.current === 'public' ? listLabel(S.current) : `${listLabel(S.current)} list`,
      S.current === 'public' ? 'The general list, for every phone that uses it' : users.length ? `Used by ${users.join(', ')}` : 'Not given to any phone yet'),
    // Public: can be ticked on any request, and given to groups of phones (not for a phone's own list).
    S.current !== 'public' && !ID_LIST.test(S.current) ? h('div', { class: 'group' }, h('label', { class: 'tg', for: 'lPublic' },
      h('span', { class: 'grow' }, h('span', { class: 't' }, 'Public list'), h('span', { class: 's' }, 'Can be ticked on any request, and given to groups of phones')),
      h('input', { type: 'checkbox', class: 'sw', id: 'lPublic', checked: isPublicList(S.current), onchange: e => {
        const on = e.target.checked, set = new Set(S.D.publicLists || []);
        if (on) set.add(S.current); else set.delete(S.current);
        S.D.publicLists = [...set]; markDevices();
      } }))) : null,
    // Import, and the list-wide overviews (each site's own are in its settings).
    h('div', { class: 'group' },
      settingsRow('table', 'Import or download a spreadsheet', null, () => open({ name: 'import' }), 'openImport'),
      settingsRow('link', 'Embedded content allowed (all sites)', Object.values((L.extra && L.extra.embeds) || {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0),
        () => open({ name: 'embeds' }), 'openEmbeds')),
    // Rename: custom lists only (not the public list, and not a phone's own id-named list).
    S.current !== 'public' && !ID_LIST.test(S.current) ? h('div', { class: 'group' },
      settingsRow('pencil', 'Rename this list', null, renameList, 'renameList')) : null,
    S.current !== 'public' ? h('button', { type: 'button', class: 'btn dline wide', id: 'delList', onclick: deleteList }, `Delete the ${listLabel(S.current)} list`) : null);
}
function settingsRow(ic, label, count, onclick, id) {
  return h('button', { type: 'button', class: 'row', onclick, id },
    h('span', { class: 'ic' }, icon(ic, 20)), h('span', { class: 'grow' }, h('span', { style: 'font-weight:500' }, label)),
    count != null ? h('span', { class: 'count' }, count) : null, h('span', { class: 'chev' }, icon('chev', 18)));
}

// ---------- in a site's settings: its pages without photos, videos or sound, and its embedded content ----------
// (Kept in the list itself, like the list-wide screens: saved with Save.)
function sitePagesMedia(dom) {
  const L = S.L, sub = S.sub;
  const under = e => { const host = e.split('/')[0].replace(/^www\./, ''); return host === dom || host.endsWith('.' + dom); };
  const kinds = [['noPhotoPages', 'photos'], ['noVideoPages', 'videos'], ['noSoundPages', 'sound']];
  const pages = [...new Set(kinds.flatMap(([k]) => L[k].filter(under)))].sort();
  if (!sub.pmKinds) sub.pmKinds = ['photos'];
  const add = () => {
    const raw = $('sPageAdd').value.trim();
    const entry = blockEntry(raw);
    if (!entry || !hasPath(entry)) return say('Type a page address, e.g. ' + dom + '/some/page', true);
    if (!under(entry)) return say(`That page isn't on ${dom}.`, true);
    if (!sub.pmKinds.length) return say('Pick photos, videos or sound.', true);
    kinds.forEach(([k, w]) => { if (sub.pmKinds.includes(w) && !L[k].includes(entry)) L[k].push(entry); });
    sub.pmText = '';
    markList(); render();
  };
  return h('div', { class: 'card', style: 'gap:10px', id: 'sPageMedia' },
    h('span', { style: 'font-weight:700' }, 'Pages without photos, videos or sound'),
    h('span', { class: 'small', style: 'color:var(--muted)' }, 'Just these pages of the site (the switches above are for the whole site).'),
    pages.length ? h('div', { class: 'group' }, pages.map(p => h('div', { class: 'row' },
      h('span', { class: 'grow' }, h('span', { style: 'font-weight:600;overflow-wrap:anywhere' }, p),
        h('span', { class: 'dom' }, 'No ' + kinds.filter(([k]) => L[k].includes(p)).map(([, w]) => w).join(', '))),
      h('button', { type: 'button', class: 'btn d sm', 'aria-label': `Remove ${p}`, onclick: () => {
        kinds.forEach(([k]) => { L[k] = L[k].filter(x => x !== p); }); markList(); render(); } }, icon('trash', 18)))))
      : null,
    // (What's typed is kept when a chip is tapped: tapping redraws the screen.)
    h('input', { class: 'inp', id: 'sPageAdd', placeholder: `${dom}/some/page`, autocapitalize: 'off', spellcheck: 'false', value: sub.pmText || '',
      oninput: e => { sub.pmText = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') add(); } }),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' },
      ...kinds.map(([, w]) => { const on = sub.pmKinds.includes(w);
        return h('button', { type: 'button', class: 'lc pick', 'aria-pressed': String(on), onclick: () => {
          sub.pmKinds = on ? sub.pmKinds.filter(x => x !== w) : [...sub.pmKinds, w]; render(); } }, on ? icon('check', 15, 2.4) : null, w[0].toUpperCase() + w.slice(1)); }),
      h('button', { type: 'button', class: 'btn s sm', id: 'sPageAddBtn', onclick: add }, 'Add page')));
}
function siteEmbeds(dom, framesOn) {
  const L = S.L;
  const E = (L.extra && L.extra.embeds && typeof L.extra.embeds === 'object') ? L.extra.embeds : {};
  const mine = E[dom] || [];
  const save = list => {
    const next = { ...E };
    if (list.length) next[dom] = [...new Set(list)].sort(); else delete next[dom];
    L.extra = { ...(L.extra || {}) };
    if (Object.keys(next).length) L.extra.embeds = next; else delete L.extra.embeds;
    markList(); render();
  };
  const add = () => {
    const from = normalize($('sEmbedAdd').value.trim());
    if (!from) return say('Type the site the content comes from, e.g. youtube.com', true);
    S.sub.emText = '';
    save([...mine, from]);
  };
  return h('div', { class: 'card', style: 'gap:10px', id: 'sEmbeds' },
    h('span', { style: 'font-weight:700' }, 'Embedded content allowed'),
    framesOn ? h('span', { class: 'small', style: 'color:var(--muted)' }, 'All of it, from any site: "Allow content embedded from other sites" is on.')
      : h('span', { class: 'small', style: 'color:var(--muted)' }, 'Videos, maps and so on from these sites show inside its pages.'),
    mine.length ? h('div', { class: 'group' }, mine.map(f => h('div', { class: 'row' },
      h('span', { class: 'ic' }, icon('link', 20)), h('span', { class: 'grow' }, h('span', { style: 'font-weight:600' }, f)),
      h('button', { type: 'button', class: 'btn d sm', 'aria-label': `Remove ${f}`, onclick: () => save(mine.filter(x => x !== f)) }, icon('trash', 18)))))
      : null,
    framesOn ? null : h('div', { style: 'display:flex;gap:8px' },
      h('input', { class: 'inp', id: 'sEmbedAdd', placeholder: 'youtube.com', autocapitalize: 'off', spellcheck: 'false', style: 'flex:1;min-width:0',
        value: S.sub.emText || '', oninput: e => { S.sub.emText = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') add(); } }),
      h('button', { type: 'button', class: 'btn s sm', id: 'sEmbedAddBtn', onclick: add }, 'Add')));
}

