// ---------- state ----------
const S = {
  connected: false,
  lists: ['public'], current: 'public',
  L: null, listSha: null, listDirty: false,       // the open list (editable model)
  D: null, devicesSha: null, devDirty: false,      // devices.json
  requests: null, newPhones: [], inboxError: null, answered: [],
  tab: 'requests', sub: null, focusRequest: new URLSearchParams(location.search).get('request'),
  // Opened from an admin phone's notification about a phone (a message, a log, a crash): that screen, once connected.
  pendingSub: (() => { const q = new URLSearchParams(location.search), id = q.get('phone'), log = q.get('log');
    return id && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(id) ? (log && /^[\w.-]+\.txt$/.test(log) ? { name: 'log', id, file: log } : { name: 'phone', id }) : null; })()
};

// The open list, as an editable model. Unknown keys in the file are kept as they are.
const KNOWN = ['sites', 'block', 'noMedia', 'noPhotos', 'noVideos', 'noSound', 'mediaAllow', 'photosOn', 'videosOn', 'soundOn', 'temporary', 'homepage', 'refreshMinutes'];
function toModel(data) {
  const sites = (data.sites || []).map(s => ({ domain: s.domain || '', name: s.name || '', url: s.url || '',
    home: s.home !== false, subdomains: s.subdomains !== false, pages: Array.isArray(s.pages) ? [...s.pages] : [],
    passThrough: !!s.passThrough, frames: !!s.frames, unfiltered: !!s.unfiltered, noPhotos: false, noVideos: false, noSound: false,
    onPhotos: false, onVideos: false, onSound: false,
    filtersOff: Array.isArray(s.filtersOff) ? s.filtersOff.filter(x => ['ads', 'trackers', 'annoyances'].includes(x)) : [] }));
  // "No photos" entries for a whole site show as that site's switch. www./m. don't matter
  // (a request may have been approved as www.example.com for the site example.com).
  const bareOf = d => (normalize(d) || '').replace(/^(www|m|mobile)\./, '');
  const domains = new Set(sites.map(s => bareOf(s.domain)).filter(Boolean));
  // "noMedia": photos, videos and sound all off; "noPhotos" / "noVideos" / "noSound": just that one.
  const nm = (data.noMedia || []).map(String), np = (data.noPhotos || []).map(String), nv = (data.noVideos || []).map(String),
    ns = (data.noSound || []).map(String);
  const isSiteEntry = e => !hasPath(e) && domains.has(bareOf(e));
  const siteIn = (list, s) => list.some(e => !hasPath(e) && bareOf(e) === bareOf(s.domain));
  sites.forEach(s => { const all = siteIn(nm, s); s.noPhotos = all || siteIn(np, s); s.noVideos = all || siteIn(nv, s); s.noSound = all || siteIn(ns, s); });
  // Set to Open on a whole site ("photosOn" etc.): that site's own setting (over every phone's default). (Blocked wins.)
  const onP = (data.photosOn || []).map(String), onV = (data.videosOn || []).map(String), onS = (data.soundOn || []).map(String);
  sites.forEach(s => { s.onPhotos = !s.noPhotos && siteIn(onP, s); s.onVideos = !s.noVideos && siteIn(onV, s); s.onSound = !s.noSound && siteIn(onS, s); });
  const extra = {}; Object.keys(data).forEach(k => { if (!KNOWN.includes(k)) extra[k] = data[k]; });
  return { sites, block: [...(data.block || [])],
    noPhotoPages: [...new Set([...nm, ...np].filter(e => !isSiteEntry(e)))],
    noVideoPages: [...new Set([...nm, ...nv].filter(e => !isSiteEntry(e)))],
    noSoundPages: [...new Set([...nm, ...ns].filter(e => !isSiteEntry(e)))],
    mediaAllow: [...(data.mediaAllow || [])].map(String),
    // "Back on": turned back on whatever other lists say (and, for a page, over its whole site's "off").
    photosOn: onP.filter(e => !isSiteEntry(e)), videosOn: onV.filter(e => !isSiteEntry(e)), soundOn: onS.filter(e => !isSiteEntry(e)),
    temporary: Array.isArray(data.temporary) ? data.temporary.map(t => ({ ...t })) : [],
    homepage: data.homepage || '', refreshMinutes: Number(data.refreshMinutes) || 5, extra };
}
// Back to the file format. Returns { data } or { error }.
function fromModel(L) {
  const sites = [], seen = new Set(), bad = [], mediaOff = [], photosOff = [], videosOff = [], soundOff = [];
  for (const s of L.sites) {
    // The site itself: www.example.com and m.example.com are saved as example.com (which covers them).
    const domain = (normalize(s.domain) || '').replace(/^(www|m|mobile)\.(?=[^.]+\.[^.]+)/, '') || undefined;
    if (!domain) { bad.push(s.domain || '(empty)'); continue; }
    if (seen.has(domain)) continue;
    seen.add(domain);
    const site = { domain, home: s.home };
    if (!s.subdomains) site.subdomains = false;
    if (s.name.trim()) site.name = s.name.trim();
    let url = s.url.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (url) site.url = url;
    const pages = [];
    for (const p of s.pages) {
      const k = pageKey(p);
      if (!k) continue;
      if (!pageOnSite(k, domain, s.subdomains)) return { error: `The page ${p} isn't on ${domain}.` };
      pages.push(k);
    }
    if (pages.length) site.pages = [...new Set(pages)];
    if (s.passThrough) site.passThrough = true;
    if (s.frames) site.frames = true;
    if (s.unfiltered) site.unfiltered = true;
    if (s.filtersOff && s.filtersOff.length) site.filtersOff = [...s.filtersOff];   // AdGuard's groups switched off on its pages
    if (s.noPhotos && s.noVideos && s.noSound) mediaOff.push(domain);
    else {
      if (s.noPhotos) photosOff.push(domain);
      if (s.noVideos) videosOff.push(domain);
      if (s.noSound) soundOff.push(domain);
    }
    sites.push(site);
  }
  const badBlock = [...L.block, ...L.noPhotoPages, ...L.noVideoPages, ...L.noSoundPages].filter(l => !blockEntry(l));
  if (bad.length || badBlock.length) return { error: `These don't look like website addresses: ${bad.concat(badBlock).join(', ')}` };
  let homepage = L.homepage.trim();
  if (homepage && !/^https?:\/\//i.test(homepage)) homepage = 'https://' + homepage;
  const data = { ...L.extra, refreshMinutes: Math.max(1, Math.round(L.refreshMinutes) || 5), sites, block: [...new Set(L.block.map(blockEntry))] };
  // Pages in all three boxes: "noMedia"; otherwise in the box's own section.
  const P = new Set(L.noPhotoPages.map(blockEntry)), V = new Set(L.noVideoPages.map(blockEntry)), A = new Set(L.noSoundPages.map(blockEntry));
  const inAll = x => P.has(x) && V.has(x) && A.has(x);
  const noMedia = [...new Set([...mediaOff, ...[...P].filter(inAll)])];
  const noPhotos = [...new Set([...photosOff, ...[...P].filter(x => !inAll(x))])];
  const noVideos = [...new Set([...videosOff, ...[...V].filter(x => !inAll(x))])];
  const noSound = [...new Set([...soundOff, ...[...A].filter(x => !inAll(x))])];
  if (noMedia.length) data.noMedia = noMedia;
  if (noPhotos.length) data.noPhotos = noPhotos;
  if (noVideos.length) data.noVideos = noVideos;
  if (noSound.length) data.noSound = noSound;
  // Single photos or videos allowed where they're otherwise off: host + path, no "?...".
  const allowItems = [...new Set(L.mediaAllow.map(x => String(x).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('?')[0].split('#')[0]).filter(Boolean))];
  if (allowItems.length) data.mediaAllow = allowItems;
  // "Back on" entries; a site switched to "No photos" (etc.) here loses its own "back on", so the switch works.
  for (const [k, field] of [['Photos', 'photosOn'], ['Videos', 'videosOn'], ['Sound', 'soundOn']]) {
    const siteKey = x => (normalize(x.domain) || '').replace(/^(www|m|mobile)\.(?=[^.]+\.[^.]+)/, '');
    const offHere = new Set(L.sites.filter(x => x['no' + k]).map(siteKey));
    const onHere = L.sites.filter(x => x['on' + k] && !x['no' + k]).map(siteKey).filter(Boolean);
    const list = [...new Set([...(L[field] || []).map(x => hasPath(x) ? blockEntry(x) : (normalize(x) || '').replace(/^www\./, '')).filter(Boolean), ...onHere])]
      .filter(x => hasPath(x) || !offHere.has(x));
    if (list.length) data[field] = list;
  }
  const live = L.temporary.filter(t => tempEnd(t) > Date.now());
  if (live.length) data.temporary = live;
  if (homepage) data.homepage = homepage;
  return { data };
}
const tempEnd = t => (Date.parse(t.from) || 0) + (t.mode === 'use' ? 7 * 1440 : Number(t.minutes) || 0) * 60000;
function tempLeft(t) {
  if (t.mode === 'use') return `${fmtMin(t.minutes)} of use, until ${new Date(tempEnd(t)).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
  const m = Math.max(1, Math.round((tempEnd(t) - Date.now()) / 60000));
  return m >= 90 ? `until ${new Date(tempEnd(t)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : `for ${fmtMin(m)} more`;
}
function phonesUsing(name) {
  return Object.entries(S.D.devices).filter(([, d]) => (d.lists || []).includes(name)).map(([id, d]) => d.name || id);
}
// A mini admin can look at the public lists, but only change their phones' own lists.
const canEditList = n => fullAdmin() || (canDo('edit') && !isPublicList(n) && !(S.D.default || []).includes(n));
function markList() {
  if (!canEditList(S.current)) { say(`You can look at ${listLabel(S.current)}, but not change it.`, true); openList(S.current).then(render); return; }
  S.listDirty = true; S.saveError = null; S.saveBlocked = false; if (dirtySince == null) dirtySince = Date.now(); scheduleAutoSave(true); scheduleStash(); renderSaveBar();
}
function markDevices() { S.devDirty = true; S.saveError = null; S.saveBlocked = false; if (dirtySince == null) dirtySince = Date.now(); scheduleAutoSave(true); scheduleStash(); renderSaveBar(); }

// ---------- loading ----------
// Everything this admin sees, at the newest version (or [sha]). False: this device is signed out.
async function loadAll(sha, opts) {
  if (!(await loadData(sha, opts))) return false;
  const folder = await getRaw('docs/lists');
  S.lists = ['public', ...(Array.isArray(folder) ? folder.filter(f => f.type === 'file' && f.name.endsWith('.json')).map(f => f.name.slice(0, -5)).sort() : [])];
  await loadDevices();
  await openList(S.lists.includes(S.current) ? S.current : 'public');
  S.connected = true;
  getRequestKey().catch(() => {});   // prefetch + cache the (public) request key while online, so a later offline save can still be sealed
  if (INAPP) idb.del('outbox').catch(() => {});   // in the app, native WorkManager delivers the on-close save, not the service-worker outbox; drop any stale relic that would otherwise retry forever
  ensureSW().then(reg => { const w = reg && (reg.active || navigator.serviceWorker.controller); if (w) w.postMessage({ type: 'wl-drain' }); });   // ready the background-save worker; send anything a previous session left unsent
  // Signed in on this phone: it may act as an admin phone again (clears the signed-out flag the app keeps).
  if (INAPP && window.WLBAdmin && WLBAdmin.adminSignedIn) try { WLBAdmin.adminSignedIn(); } catch {}
  registerAdminPush();   // admin app: register its push token so phone→admin messages wake it instantly
  if (!canDo('requests') && S.tab === 'requests') S.tab = canDo('edit') ? 'sites' : seesPhones() ? 'phones' : 'settings';
  loadInbox();   // in the background; the Requests tab fills in when it arrives
  return true;
}
async function loadDevices() {
  const d = await getJson('devices.json');
  S.D = d ? d.data : { default: ['public'], devices: {} };
  if (!Array.isArray(S.D.default)) S.D.default = ['public'];
  if (!S.D.devices) S.D.devices = {};
  if (!S.D.archived) S.D.archived = {};
  S.devicesSha = d ? d.sha : null;
  S.devDirty = false;
}
async function openList(name) {
  const f = await getJson(listPathOf(name));
  S.current = name;
  S.L = toModel(f ? f.data : { sites: [], block: [] });
  S.listSha = f ? f.sha : null;
  S.listDirty = false;
}

