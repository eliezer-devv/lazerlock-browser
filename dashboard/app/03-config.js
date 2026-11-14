// ---------- Where everything is ----------
// C.repo is the PRIVATE repository (lists, phones, requests, accounts); its automation does every change. The page
// never holds a GitHub token of its own: it sends sealed commands as issues there (with the requests token, the same
// one the app uses, which can only make issues), and reads what it shows from the PUBLIC repository, encrypted so
// only this signed-in device can open it.
const publicRepoName = () => C.repo.replace(/-private$/, '');
const C = { owner: '', repo: '', branch: 'main' };
// Inside the phone app (opened from the hidden button) the app passes ?inapp=1&owner=…&repo=….
const Q = new URLSearchParams(location.search);
const INAPP = Q.get('inapp') === '1';
// The separate admin app (LazerLock Admin): the same page, but there's no browser to go back to.
const ADMINAPP = INAPP && Q.get('app') === 'admin';
(() => {
  // On GitHub Pages (OWNER.github.io/REPO/admin.html): REPO-private holds everything.
  if (location.hostname.endsWith('.github.io')) {
    C.owner = location.hostname.split('.')[0];
    C.repo = (location.pathname.split('/')[1] || 'lazerlock-browser') + '-private';
  }
  if (Q.get('owner')) C.owner = Q.get('owner');
  if (Q.get('repo')) C.repo = Q.get('repo');
})();
// The requests token (filled in when the page is published, and when it's packed into the app). Stored reversed.
const TOKEN_REV = '__REQUESTS_TOKEN_REV__';
const ghToken = () => /^__/.test(TOKEN_REV) ? '' : TOKEN_REV.split('').reverse().join('');

const u8b64 = u => { let s = ''; new Uint8Array(u).forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const b64u8 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
const enc8 = s => new TextEncoder().encode(s);
const dec8 = b => new TextDecoder().decode(b);
// The phone's back button (the app asks this first): go back a screen if there is one.
window.wlBack = () => {
  // An open popup (our themed dialog) takes the back press first — close it instead of navigating.
  const shade = document.querySelector('.dlg-shade');
  if (shade) { const cancel = shade.querySelector('#dlgCancel'); if (cancel) cancel.click(); else shade.remove(); return true; }
  if (S.connected && S.sub) { back(); return true; }
  // Back on the top screen with unsaved changes: our own themed dialog (not the system one), then close if confirmed.
  if (S.connected && S.saveBlocked) {     // changes that can't be saved yet (an invalid entry): closing would lose them
    uiConfirmDanger('Leave without saving?', `Some changes can’t be saved yet (${S.saveError || 'check the entries'}).`, 'Leave', 'warn').then(ok => { if (ok) closeAdmin(); });
    return true;
  }
  if (S.connected && (S.listDirty || S.devDirty || QUEUE.busy || QUEUE.ops.length)) {   // changes save themselves: flush, let the queue finish, then close
    flushAndClose();
    return true;
  }
  return false;
};
const closeAdmin = () => { location.href = 'wladmin://close'; };
const branch = () => C.branch || 'main';

// ---------- This device's keys (made here, kept here: the private halves can't be read out, even by this page) ----------
// enc: RSA-OAEP, for answers and this admin's data key. mac: HMAC, to sign commands (its secret is sent once, at sign-in).
const idb = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, no) => {
    const r = indexedDB.open('wl-admin', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); }); };
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
})();
const SESSION = 'wl-admin-session';
const getSession = () => { try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { return null; } };
const setSession = s => s ? localStorage.setItem(SESSION, JSON.stringify(s)) : localStorage.removeItem(SESSION);
let DEV = null;          // { did, enc (public, base64), encKey (private CryptoKey), macKey? }
async function deviceKeys(fresh = false) {
  if (DEV && !fresh) return DEV;
  let d = fresh ? null : await idb.get('device').catch(() => null);
  if (!d) {
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, false, ['encrypt', 'decrypt']);
    const did = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
    d = { did, enc: u8b64(await crypto.subtle.exportKey('spki', pair.publicKey)), encKey: pair.privateKey };
    await idb.set('device', d);
  }
  DEV = d;
  return d;
}
// A new signing secret, for a sign-in: sent once (sealed), then kept here only as a key that can't be read out.
async function newMacSecret() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return { b64: u8b64(raw), key };
}
async function forgetDevice() {
  DEV = null; setSession(null);
  try { localStorage.removeItem('wl-admin-pin'); localStorage.removeItem('wl-admin-bio'); } catch {}   // (its locks go with it)
  await idb.del('device').catch(e => console.log(`(carried on, line 636) ${e && e.message}`)); await idb.del('mac').catch(e => console.log(`(carried on, line 636) ${e && e.message}`));
}
// This device's time zone (emails give times in it).
const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'a computer';
  const br = ADMINAPP ? 'LazerLock Admin app' : INAPP ? 'LazerLock app' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  return `${br} on ${os}`;
};

