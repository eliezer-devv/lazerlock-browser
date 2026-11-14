// ---------- Sealing (the same as phones: AES-256-GCM, its key locked with RSA-OAEP SHA-1) ----------
let requestKey = null;
async function getRequestKey() {
  if (requestKey) return requestKey;
  // The request key is a PUBLIC key, so we can keep the last fetched copy in IndexedDB and fall back to it when the
  // network is down — this is what lets a background/on-close save be prepared offline (delivered later by WorkManager).
  let pem;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${C.owner}/${publicRepoName()}/${branch()}/request-key.pem`, { cache: 'no-store' });
    if (!res.ok) throw new Error('status ' + res.status);
    pem = (await res.text()).replace(/-----[^-]+-----|\s/g, '');
    idb.set('reqKeyPem', pem).catch(() => {});
  } catch (e) {
    pem = await idb.get('reqKeyPem').catch(() => null);
    if (!pem) throw new Error('Couldn\'t get the request key. Check this device is online (and that Publish lists has run once in the private repository).');
  }
  requestKey = await crypto.subtle.importKey('spki', b64u8(pem), { name: 'RSA-OAEP', hash: 'SHA-1' }, false, ['encrypt']);
  return requestKey;
}
async function seal(obj) {
  const aes = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', aes, 'AES-GCM', false, ['encrypt']);
  const d = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc8(JSON.stringify(obj)));
  const kk = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, await getRequestKey(), aes);
  return { v: 1, k: u8b64(kk), iv: u8b64(iv), d: u8b64(d) };
}
async function unseal(s) {
  const aes = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, (await deviceKeys()).encKey, b64u8(s.k));
  const k = await crypto.subtle.importKey('raw', aes, 'AES-GCM', false, ['decrypt']);
  return JSON.parse(dec8(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u8(s.iv) }, k, b64u8(s.d))));
}

// ---------- Commands: a sealed issue in the private repository, answered by its automation ----------
const API = 'https://api.github.com';
const ghHeaders = () => ({ Authorization: `Bearer ${ghToken()}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function postCommand(sealed) {
  if (!ghToken()) throw new Error('This copy of the admin page can\'t send anything: the REQUESTS_TOKEN secret was missing when it was published. Add it in the public repository, then run Publish list.');
  const body = `🔒 Admin\n<!-- whitelist-admin-cmd\n${JSON.stringify(await seal(sealed))}\n-->`;
  // keepalive lets the request finish in the background even if the page is closing (the on-exit flush), as long as the
  // body is small enough (~64KB); for normal saves it's off. The command carries the whole changed file, so a very large
  // list may exceed that on exit — but the backstop and leave-screen saves will have committed it already by then.
  const res = await fetch(`${API}/repos/${C.owner}/${C.repo}/issues`, { method: 'POST', headers: ghHeaders(), body: JSON.stringify({ title: '🔒 Admin', body }), keepalive: UNLOAD });
  if (res.status === 401) throw new Error('GitHub turned the requests token down: it may have expired. Renew REQUESTS_TOKEN (README, section 6).');
  if (!res.ok) {
    // Record GitHub's real reason in the app's log (the on-screen message stays short). This turns an opaque "422"
    // into e.g. "Validation Failed — body is too long (maximum is 65536 characters)", and shows the payload size.
    let detail = '';
    try { const j = JSON.parse(await res.text()); detail = [j.message, ...(Array.isArray(j.errors) ? j.errors.map(x => x.message || `${x.field || ''} ${x.code || ''}`.trim()) : [])].filter(Boolean).join(' — '); } catch {}
    appLog(`Save POST rejected: GitHub ${res.status}${detail ? ' — ' + detail : ''} (request body ${body.length} chars; GitHub's issue limit is 65536).`);
    throw new Error(`GitHub returned ${res.status}. Check this device is online, then try again.`);
  }
  return (await res.json()).number;
}

