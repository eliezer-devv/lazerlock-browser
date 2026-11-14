// ---------- dialogs (in place of the browser's own confirm / prompt pop-ups) ----------
// uiDialog({ title, icon, red, text, body: [nodes], ok, cancel, danger, onOk }) -> Promise<boolean>.
// onOk() may return false (e.g. a field isn't right) to keep the dialog open.
function uiDialog({ title, icon: ic = 'info', red = false, text, body = [], ok = 'OK', cancel = 'Cancel', danger = false, onOk }) {
  return new Promise(resolve => {
    const before = document.activeElement;
    const close = v => { shade.remove(); document.removeEventListener('keydown', keys, true); if (before && before.focus) before.focus(); resolve(v); };
    const okBtn = h('button', { type: 'button', class: 'btn ' + (danger ? 'dd' : 'p'), id: 'dlgOk' }, ok);
    const noBtn = cancel ? h('button', { type: 'button', class: 'btn d', id: 'dlgCancel', onclick: () => close(false) }, cancel) : null;
    okBtn.onclick = () => { if (onOk && onOk() === false) return; close(true); };
    const dlg = h('section', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'dhead' }, h('span', { class: 'dicon' + (red ? ' red' : '') }, icon(ic, 22)), h('h2', null, title)),
      text ? h('p', null, text) : null, ...body, h('div', { class: 'dacts' }, noBtn, okBtn));
    const shade = h('div', { class: 'dlg-shade', onclick: e => { if (e.target === shade && cancel) close(false); } }, dlg);
    const keys = e => {
      if (e.key === 'Escape' && cancel) { e.preventDefault(); close(false); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); okBtn.click(); }
    };
    document.addEventListener('keydown', keys, true);
    document.body.append(shade);
    (dlg.querySelector('input, textarea') || okBtn).focus();
  });
}
// A yes/no question.
const uiConfirm = (title, text, ok = 'OK', opts = {}) => uiDialog({ title, text, ok, ...opts });
// A question that throws something away.
const uiConfirmDanger = (title, text, ok, ic = 'trash') => uiDialog({ title, text, ok, danger: true, red: true, icon: ic });

// ---------- saving ----------
async function saveAll(auto = false) {
  $('saveBtn').disabled = true;
  const did = S.listDirty || S.devDirty;   // was there anything to commit? (feeds the adaptive-batching counter)
  try {
    if (S.listDirty) {
      const out = fromModel(S.L);
      if (out.error) {               // the list isn't valid yet (e.g. a half-typed entry): hold the changes rather than nag on every keystroke
        S.saveError = out.error; S.saveBlocked = true;
        if (!auto) say(out.error, true);
        return;
      }
      S.listSha = await putJson(listPathOf(S.current), out.data, S.listSha, `Update ${S.current} list from admin page`);
      S.L = toModel(out.data);
      S.listDirty = false;
      S.otherLists = null;      // the search fetches the lists afresh
    }
    if (S.devDirty) {
      S.devicesSha = await putJson('devices.json', S.D, S.devicesSha, 'Update phones and settings');
      S.devDirty = false;
    }
    S.saveError = null; S.saveBlocked = false;
    if (!S.listDirty && !S.devDirty) { dirtySince = null; clearOutbox(); cancelNativeSave(); }   // all pending changes committed: clear the pending-clock, the on-close fallback, and any queued native background save
    if (did) noteSave();
    if (!auto) say('Saved ✓ · phones pick it up within a few minutes.');   // only a manual Save/Retry says so — auto-saves stay silent (the bar is the only sign)
    render();
  } catch (e) { S.saveError = e.message; S.saveBlocked = false; if (!auto) say(e.message, true); }
  finally { $('saveBtn').disabled = false; renderSaveBar(); }
}
// Saving: prompt but quiet. A change commits a short moment after you make it — no pop-up, no Save button. This matters
// most in the admin APP, whose WebView is re-locked, reloaded, or killed whenever it goes to the background: a change has
// to reach GitHub while the app is still alive, or the reload-on-unlock drops it. The pop-ups that used to appear were the
// real annoyance, and they're gone; the bar at the bottom is the only sign. The leave/minimize/close + worker paths below
// are extra safety nets on top of this.
let autoSaving = false, autoSaveTimer = null, safetyTimer = null, dirtySince = null, UNLOAD = false;
const DEBOUNCE = 1800, MAX_PENDING = 7000, SAFETY = 45000;   // commit ~2s after the last edit; never later than MAX_PENDING; 45s backstop
function noteSave() {}
function scheduleAutoSave(reset = true) {
  if (!S.connected || S.saveBlocked || !(S.listDirty || S.devDirty)) return;
  startSafety();
  let delay = DEBOUNCE;
  if (dirtySince != null) delay = Math.min(delay, Math.max(0, dirtySince + MAX_PENDING - Date.now()));   // a long editing spell still commits on a cadence
  if (autoSaveTimer != null) { if (!reset) return; clearTimeout(autoSaveTimer); }
  autoSaveTimer = setTimeout(() => { autoSaveTimer = null; runAutoSave(); }, delay);
}
function startSafety() {
  if (safetyTimer != null) return;
  safetyTimer = setInterval(() => {
    if (!(S.listDirty || S.devDirty)) { clearInterval(safetyTimer); safetyTimer = null; return; }
    if (S.connected && !S.saveBlocked && !autoSaving && !editingField()) runAutoSave();
  }, SAFETY);
}
// You're still typing in a field: a real text box (not a toggle/checkbox) has focus and isn't read-only. Don't commit
// mid-word — wait until you leave the field (focusout re-schedules) or a short poll catches the pause.
function editingField() {
  const el = document.activeElement;
  if (!el) return false;
  const t = el.tagName;
  if (t === 'TEXTAREA') return !el.readOnly;
  if (t === 'INPUT') return !el.readOnly && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(el.type);
  return el.isContentEditable === true;
}
async function runAutoSave() {
  if (autoSaving || !S.connected || !(S.listDirty || S.devDirty) || S.saveBlocked) return;
  if (editingField()) { if (autoSaveTimer != null) clearTimeout(autoSaveTimer); autoSaveTimer = setTimeout(() => { autoSaveTimer = null; runAutoSave(); }, 1200); return; }
  autoSaving = true; renderSaveBar();
  try { await saveAll(true); }
  finally {
    autoSaving = false;
    dirtySince = (S.listDirty || S.devDirty) ? Date.now() : null;
    renderSaveBar();
    if ((S.listDirty || S.devDirty) && !S.saveBlocked && !S.saveError) scheduleAutoSave(true);   // edits landed during the save: catch them
    else if (S.saveError && !S.saveBlocked) setTimeout(() => runAutoSave(), 5000);               // a transient send problem: try again shortly
  }
}
async function undoAll() {
  if (!(await uiConfirm('Undo all unsaved changes?', 'Everything since your last Save goes back to how it was.', 'Undo', { icon: 'warn' }))) return;
  try {
    if (S.listDirty) await openList(S.current);
    if (S.devDirty) await loadDevices();
    say('Changes undone.');
    render();
  } catch (e) { say(e.message, true); }
}
function renderSaveBar() {
  const pending = !!(S.listDirty || S.devDirty);
  const show = (pending || S.saveError) && S.connected && !S.locked;   // don't show the save bar over the lock screen (saving still runs underneath)
  $('savebar').hidden = !show;
  document.body.classList.toggle('unsaved', show);
  if (!show) return;
  if (S.saveError) {                         // a save that didn't go through: say so, and offer to try again
    $('saveText').textContent = 'Couldn’t save — ' + S.saveError;
    $('undoBtn').hidden = true;
    $('saveBtn').hidden = false; $('saveBtn').textContent = 'Retry'; $('saveBtn').disabled = false;
  } else {                                   // changes save themselves once you pause — no button, and no "Saving…" flash per keystroke
    $('saveText').textContent = autoSaving ? 'Saving…' : 'Unsaved changes — saving…';
    $('undoBtn').hidden = true; $('saveBtn').hidden = true;
    scheduleAutoSave(false);
  }
}
$('saveBtn').onclick = () => { S.saveBlocked = false; S.saveError = null; saveAll(false); };
$('undoBtn').onclick = undoAll;
// Left a text field: now it can save (while the cursor was in it, autosave held off).
document.addEventListener('focusout', e => {
  const t = e.target && e.target.tagName;
  if ((t === 'INPUT' || t === 'TEXTAREA') && (S.listDirty || S.devDirty) && !S.saveBlocked) scheduleAutoSave(true);
});
// Switching away from / minimizing / locking the screen (and the first step of closing) all fire 'hidden' while the page
// is still alive — so commit pending changes now, in the background (the main "save on minimize/close"). We also arm the
// worker outbox as a guarantee in case this page is killed before the commit lands; a successful commit clears it.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (S.connected && (S.listDirty || S.devDirty) && !S.saveBlocked) { armOutbox(); flushSave(); } }
  else if (document.visibilityState === 'visible') { ensureSW().then(reg => { const w = reg && (reg.active || navigator.serviceWorker.controller); if (w) w.postMessage({ type: 'wl-drain' }); }); }  // send anything a prior close left behind
});
// A hard close: arm the outbox (the worker finishes it after we're gone) and fire the commit with keepalive as well.
window.addEventListener('pagehide', () => {
  if (S.connected && (S.listDirty || S.devDirty) && !S.saveBlocked) { armOutbox(); if (!autoSaving) { UNLOAD = true; runAutoSave(); } }
});
// Only a change that genuinely can't be saved yet (an invalid, half-typed entry) is worth warning about on close now —
// everything else has already been committed by the handlers above.
if (!INAPP) window.addEventListener('beforeunload', e => { if (S.saveBlocked || QUEUE.sending || QUEUE.ops.length || CMDQ.sending) { e.preventDefault(); e.returnValue = ''; } });

// ---------- lists ----------
// Unsaved changes to the open list: ask before leaving them.
// Changes save themselves, so before leaving we just flush whatever's still pending. Only changes that can't be
// saved yet (an invalid entry) still ask, since leaving really would drop them.
async function flushSave() { if (autoSaving) return; if ((S.listDirty || S.devDirty) && !S.saveBlocked) await runAutoSave(); }
async function flushAndClose() {
  await flushSave();
  for (let i = 0; i < 50 && (QUEUE.busy || QUEUE.ops.length || (typeof CMDQ !== 'undefined' && CMDQ.sending)); i++) await new Promise(r => setTimeout(r, 100));
  closeAdmin();
}
const discardListChanges = async () => {
  if (!S.listDirty) return true;
  if (S.saveBlocked) return uiConfirmDanger('Discard unsaved changes?', `Your changes to ${listLabel(S.current)} can’t be saved yet (${S.saveError || 'check the entries'}). Leave and discard them?`, 'Discard', 'warn');
  await flushSave(); return true;
};
async function switchList(name) {
  if (name === S.current) return;
  if (!(await discardListChanges())) return;
  try { await openList(name); render(); } catch (e) { say(e.message, true); }
}
async function newList() {
  if (!(await discardListChanges())) return;
  const nameIn = h('input', { class: 'inp', id: 'nlName', type: 'text', placeholder: 'e.g. year-6', autocapitalize: 'off', spellcheck: 'false' });
  const pub = h('input', { type: 'checkbox', id: 'nlPublic', checked: true });
  let name = '';
  const ok = await uiDialog({ title: 'New list', icon: 'list', ok: 'Create', body: [
    h('div', { class: 'field' }, h('label', { for: 'nlName' }, 'Name'), nameIn,
      h('span', { class: 'hint' }, 'List names can be seen publicly, so don\'t use full names.')),
    h('label', { class: 'check' }, pub, h('span', null, h('b', null, 'Public list'), h('br'),
      h('span', { class: 'muted small' }, 'Can be ticked on any request, and given to groups of phones')))],
    onOk: () => {
      name = nameIn.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
      if (!name) { say('Use letters and numbers for the list name.', true); return false; }
      if (S.lists.includes(name)) { say(`There's already a list called ${name}.`, true); return false; }
    } });
  if (!ok) return;
  if (pub.checked) { S.D.publicLists = [...new Set([...(S.D.publicLists || []), name])]; markDevices(); }
  S.lists.push(name);
  S.current = name; S.listSha = null;
  S.L = toModel({ sites: [], block: [] });
  markList();
  render();
  say(`New list "${listLabel(name)}". Add sites, then give it to phones under Phones.`);
}
// Rename a custom list (not the public list, not a phone's own id-named list). Moves the list file and points every
// phone and setting that used the old name at the new one, so nothing loses its list.
async function renameList() {
  const old = S.current;
  if (old === 'public' || ID_LIST.test(old)) return;
  if (!(await discardListChanges())) return;
  const nameIn = h('input', { class: 'inp', id: 'rnName', type: 'text', value: old, autocapitalize: 'off', spellcheck: 'false' });
  let name = '';
  const ok = await uiDialog({ title: 'Rename list', icon: 'list', ok: 'Rename', body: [
    h('div', { class: 'field' }, h('label', { for: 'rnName' }, 'Name'), nameIn,
      h('span', { class: 'hint' }, 'List names can be seen publicly, so don\'t use full names.'))],
    onOk: () => {
      name = nameIn.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
      if (!name) { say('Use letters and numbers for the list name.', true); return false; }
      if (name !== old && S.lists.includes(name)) { say(`There's already a list called ${name}.`, true); return false; }
    } });
  if (!ok || name === old) return;
  try {
    if (!(await moveFile(listPathOf(old), listPathOf(name), `Rename list ${old} to ${name}`))) { say('Couldn\'t rename that list.', true); return; }
    // Point every phone and setting that used the old name at the new one.
    Object.values(S.D.devices).forEach(d => {
      if (Array.isArray(d.lists)) d.lists = d.lists.map(l => l === old ? name : l);
      if (Array.isArray(d.blockedLists)) d.blockedLists = d.blockedLists.map(l => l === old ? name : l);
      if (d.requestsTo === old) d.requestsTo = name;
    });
    if (Array.isArray(S.D.default)) S.D.default = S.D.default.map(l => l === old ? name : l);
    if (Array.isArray(S.D.publicLists)) S.D.publicLists = S.D.publicLists.map(l => l === old ? name : l);
    Object.values(S.D.timers || {}).forEach(t => ['during', 'on'].forEach(k => { if (t[k] && Array.isArray(t[k].lists)) t[k].lists = t[k].lists.map(l => l === old ? name : l); }));
    S.devicesSha = await putJson('devices.json', S.D, S.devicesSha, `Rename list ${old} to ${name} on phones`);
    S.devDirty = false;
    S.lists = [...new Set(S.lists.map(l => l === old ? name : l))].sort();
    S.current = name; S.listSha = null;
    await openList(name);
    S.sub = null; render();
    say(`Renamed to the ${listLabel(name)} list.`);
  } catch (e) { say(e.message, true); }
}
async function deleteList() {
  const name = S.current;
  if (name === 'public') return;
  const users = phonesUsing(name);
  if (!(await uiConfirmDanger(`Delete the ${listLabel(name)} list?`,
    (users.length ? `${users.join(', ')} will stop using it. ` : '') + 'Its sites are deleted with it.', 'Delete'))) return;
  try {
    if (S.listSha) await deleteFile(listPathOf(name), S.listSha, `Delete list ${name}`);
    Object.values(S.D.devices).forEach(d => { d.lists = (d.lists || []).filter(l => l !== name); if (d.requestsTo === name) delete d.requestsTo; });
    S.D.default = S.D.default.filter(l => l !== name);
    if (S.D.publicLists) S.D.publicLists = S.D.publicLists.filter(l => l !== name);
    S.devicesSha = await putJson('devices.json', S.D, S.devicesSha, `Remove list ${name} from phones`);
    S.devDirty = false;
    S.lists = S.lists.filter(l => l !== name);
    await openList('public');
    S.sub = null; render();
    say(`Deleted the ${listLabel(name)} list.`);
  } catch (e) { say(e.message, true); }
}

// ---------- scroll wheels (hours 0-24, minutes 0-55 in steps of 5) ----------
// makePicker(host, minutes, onChange) -> { get(), set(min), sync() }. Wheels only scroll while visible.
const ROW = 36;
function makePicker(host, startMinutes, onChange) {
  host.innerHTML = '<div class="wheels"><div class="wheel-band"></div>' +
    '<div class="wheel-col"><div class="wheel" tabindex="0" role="listbox" aria-label="Hours"></div><span>hours</span></div>' +
    '<div class="wheel-col"><div class="wheel" tabindex="0" role="listbox" aria-label="Minutes"></div><span>min</span></div></div>';
  const [hEl, mEl] = host.querySelectorAll('.wheel');
  const cols = [{ el: hEl, values: Array.from({ length: 25 }, (_, i) => i), value: 0 },
                { el: mEl, values: Array.from({ length: 12 }, (_, i) => i * 5), value: 0 }];
  const total = () => cols[0].value * 60 + cols[1].value;
  const changed = () => onChange && onChange(total());
  const mark = (c, idx) => c.el.querySelectorAll('[data-v]').forEach((d, i) => { d.classList.toggle('sel', i === idx); d.setAttribute('aria-selected', i === idx); });
  function setCol(c, v, smooth) {
    let idx = c.values.indexOf(v);
    if (idx < 0) idx = c.values.reduce((b, x, i) => Math.abs(x - v) < Math.abs(c.values[b] - v) ? i : b, 0);
    c.value = c.values[idx];
    c.el.scrollTo({ top: idx * ROW, behavior: smooth ? 'smooth' : 'auto' });
    mark(c, idx);
  }
  cols.forEach(c => {
    c.el.innerHTML = '<div class="pad"></div>' + c.values.map(v => `<div data-v="${v}" role="option">${String(v).padStart(2, '0')}</div>`).join('') + '<div class="pad"></div>';
    let settle;
    c.el.addEventListener('scroll', () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const idx = Math.max(0, Math.min(c.values.length - 1, Math.round(c.el.scrollTop / ROW)));
        const moved = c.values[idx] !== c.value;
        c.value = c.values[idx]; mark(c, idx);
        if (moved) changed();
      }, 90);
    });
    c.el.addEventListener('click', e => { const d = e.target.closest('[data-v]'); if (d) { setCol(c, Number(d.dataset.v), true); changed(); } });
    c.el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const idx = c.values.indexOf(c.value) + (e.key === 'ArrowDown' ? 1 : -1);
      setCol(c, c.values[Math.max(0, Math.min(c.values.length - 1, idx))], true); changed();
    });
  });
  const picker = {
    get: total,
    set(min, smooth) {
      min = Math.max(0, Math.min(24 * 60 + 55, Math.round(min)));
      setCol(cols[0], Math.floor(min / 60), smooth);
      setCol(cols[1], Math.min(55, Math.round((min % 60) / 5) * 5), smooth);
      changed();
    },
    sync() { setCol(cols[0], cols[0].value, false); setCol(cols[1], cols[1].value, false); }
  };
  picker.set(startMinutes);
  requestAnimationFrame(() => picker.sync());
  return picker;
}

// ---------- spreadsheets ----------
function parseDelimited(text) {
  const first = text.split('\n')[0];
  const delim = text.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}
const NO = ['no', 'n', 'false', '0', 'off', 'hidden', 'hide', 'nee', 'nein', 'non'];
function rowsToSites(rows) {
  rows = rows.map(r => r.map(c => String(c ?? '').trim())).filter(r => r.some(Boolean));
  if (!rows.length) return { sites: [], bad: [] };
  let col = { domain: 0, name: 1, home: 2, url: 3, subs: 4, pages: 5, media: 6 };
  const head = rows[0].map(x => x.toLowerCase());
  const find = (words, skip = []) => {
    for (const w of words) { const i = head.findIndex((x, n) => x.includes(w) && !skip.includes(n)); if (i >= 0) return i; }
    return -1;
  };
  const subCols = head.map((x, n) => x.includes('sub') || /photo|video|media/.test(x) ? n : -1).filter(n => n >= 0);
  const d = find(['domain', 'website', 'address', 'web', 'url', 'site'], subCols);
  if (d >= 0 && !normalize(rows[0][d])) {               // first row is a header
    const name = find(['name', 'title', 'label'], [d]);
    const subs = find(['subdomain', 'sub'], [d, name]);
    // "no photos or videos" (or "media"): both; "no photos": photos only; "no videos": videos only.
    const colWhere = test => head.findIndex((x, n) => test(x) && ![d, name, subs].includes(n));
    const both = colWhere(x => (/photo/.test(x) && /video/.test(x)) || /media/.test(x));
    const photoCol = colWhere(x => /photo/.test(x) && !/video/.test(x));
    const videoCol = colWhere(x => /video/.test(x) && !/photo/.test(x));
    const soundCol = colWhere(x => /sound|audio/.test(x));
    const media = [both, photoCol, videoCol, soundCol].find(n => n >= 0) ?? -1;
    const pages = find(['pages', 'page', 'only'], [d, name, subs, both, photoCol, videoCol, soundCol]);
    const home = find(['home', 'tile', 'show'], [d, name, subs, pages, both, photoCol, videoCol, soundCol]);
    const url = find(['opens', 'start', 'link', 'url'], [d, name, home, subs, pages, both, photoCol, videoCol, soundCol]);
    col = { domain: d, name, home, url, subs, pages, both, photoCol, videoCol, soundCol };
    rows = rows.slice(1);
  }
  const sites = [], bad = [];
  rows.forEach(r => {
    const raw = r[col.domain] || '';
    const domain = normalize(raw);
    if (!domain) { if (raw) bad.push(raw); return; }
    const homeCell = col.home >= 0 ? (r[col.home] || '').toLowerCase() : '';
    let url = col.url >= 0 ? (r[col.url] || '') : '';
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (!url && /^(https?:\/\/)?[^/\s]+\/[^\s]+/i.test(raw)) url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    const subsCell = col.subs >= 0 ? (r[col.subs] || '').toLowerCase() : '';
    const pages = col.pages >= 0 ? (r[col.pages] || '').split(/\s+/).filter(Boolean) : [];
    const yes = n => n !== undefined && n >= 0 && ['yes', 'y', 'true', '1', 'x', 'on'].includes((r[n] || '').toLowerCase().trim());
    sites.push({ domain, name: col.name >= 0 ? (r[col.name] || '') : '', url, home: !NO.includes(homeCell),
      subdomains: !NO.includes(subsCell), pages, noPhotos: yes(col.both) || yes(col.photoCol), noVideos: yes(col.both) || yes(col.videoCol), noSound: yes(col.both) || yes(col.soundCol), passThrough: false });
  });
  return { sites, bad };
}
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, fail) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = ok; sc.onerror = () => fail(new Error('Couldn\'t load the Excel reader. Save the sheet as CSV instead.'));
    document.head.append(sc);
  });
}
// Saves a file: in the app's admin screen, to the phone's Downloads (Android's browser ignores a page's own
// downloads there); elsewhere, the browser's usual download.
function saveFile(blob, name) {
  if (INAPP && window.WLBAdmin && window.WLBAdmin.save) {
    const r = new FileReader();
    r.onload = () => {
      const ok = window.WLBAdmin.save(name, blob.type || 'application/octet-stream', String(r.result).split(',')[1] || '');
      say(ok ? `Saved ${name} to the phone's Downloads.` : `Couldn't save ${name}.`, !ok);
    };
    r.readAsDataURL(blob);
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = ['domain,name,home page,tile opens,subdomains,only these pages,no photos,no videos,no sound'];
  S.L.sites.forEach(s => {
    if (!s.domain.trim()) return;
    lines.push([s.domain.trim(), s.name.trim(), s.home ? 'yes' : 'no', s.url.trim(), s.subdomains ? 'yes' : 'no', s.pages.join(' '),
      s.noPhotos ? 'yes' : 'no', s.noVideos ? 'yes' : 'no', s.noSound ? 'yes' : 'no'].map(q).join(','));
  });
  saveFile(new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' }), `${S.current}-sites.csv`);
}

// Everything in one spreadsheet: a tab for each list, and a Phones tab (with all their details).
const SITE_COLUMNS = ['domain', 'name', 'home page', 'tile opens', 'subdomains', 'only these pages', 'no photos', 'no videos', 'no sound'];
const siteRow = s => [s.domain.trim(), s.name.trim(), s.home ? 'yes' : 'no', s.url.trim(), s.subdomains ? 'yes' : 'no', s.pages.join(' '),
  s.noPhotos ? 'yes' : 'no', s.noVideos ? 'yes' : 'no', s.noSound ? 'yes' : 'no'];
async function exportAll() {
  try {
    say('Making the spreadsheet…');
    await loadSheetJs();
    const wb = XLSX.utils.book_new();
    const used = new Set();
    const tabName = t => {                     // a sheet's name: up to 31 characters, none of []:*?/\, each different
      let n = String(t).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31).trim() || 'List', k = n, i = 2;
      while (used.has(k.toLowerCase())) k = `${n.slice(0, 27)} (${i++})`;
      used.add(k.toLowerCase()); return k;
    };
    for (const n of [...publicListNames(), ...S.lists.filter(x => !isPublicList(x))]) {
      const L = n === S.current ? S.L : toModel(((await getJson(listPathOf(n))) || { data: { sites: [], block: [] } }).data);
      const rows = [SITE_COLUMNS, ...L.sites.filter(x => x.domain.trim()).map(siteRow)];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), tabName(listLabel(n)));
    }
    const yn = v => v === 'on' ? 'on' : v === 'off' ? 'off' : 'usual';
    const phones = [['first name', 'last name', 'name', 'phone ID', 'model', 'lists', 'blocked', 'ads', 'trackers', 'annoyances', 'adult filter', 'gambling filter',
      'malware filter', 'approval PIN', 'approvals go to', 'added']];
    Object.entries(S.D.devices).forEach(([id, d]) => phones.push([d.first || '', d.last || '', d.name || '', id, d.model || '',
      (d.blocked ? (d.blockedLists || []) : (d.lists || [])).map(listLabel).join(', '), d.blocked ? 'yes' : 'no',
      yn(d.adblock), yn(d.trackers), yn(d.annoyances), yn(d.adult), yn(d.gambling), yn(d.malware),
      d.approvalPin === 'none' ? 'none' : d.approvalPin ? 'own PIN' : 'usual', d.requestsTo ? listLabel(d.requestsTo) : 'usual', d.registered || '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(phones), tabName('Phones'));
    saveFile(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `lazerlock-${new Date().toISOString().slice(0, 10)}.xlsx`);
    say('Downloaded: a tab for each list, and one for the phones.');
  } catch (e) { say(`Couldn't make the spreadsheet: ${e.message}`, true); }
}

