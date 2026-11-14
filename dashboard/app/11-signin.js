// ============================================================================================
// Signing in (email and password; a new device is confirmed by email), and the emailed links
// ============================================================================================
const PW_RULES = [
  [p => p.length >= 8, 'At least 8 characters'],
  [p => /[a-z]/i.test(p) && /[0-9]/.test(p), 'A letter and a number'],
];
const pwProblem = p => p.length < 8 ? 'The password needs at least 8 characters.' : !/[a-z]/i.test(p) || !/[0-9]/.test(p) ? 'The password needs at least one letter and one number.' : null;
const waitNote = text => h('div', { class: 'card', style: 'flex-direction:row;align-items:center;gap:12px' }, h('span', { class: 'spin', 'aria-hidden': 'true' }), h('span', null, text));
const pwField = (id, label, autocomplete) => h('div', { class: 'field' }, h('label', { for: id }, label),
  h('div', { class: 'pwbox' }, h('input', { class: 'inp', id, type: 'password', autocomplete, spellcheck: 'false', autocapitalize: 'off' }),
    h('button', { type: 'button', class: 'pwshow', 'aria-label': 'Show the password', onclick: e => {
      const i = $(id); i.type = i.type === 'password' ? 'text' : 'password';
      e.currentTarget.textContent = i.type === 'password' ? 'Show' : 'Hide'; } }, 'Show')));

// Already signed in on this browser (another tab did it): open the admin. False if that didn't work.
async function openSignedIn() {
  S.signin = null; S.starting = true; render();
  try { const ok = await openData(); S.starting = false; if (ok) { render(); return true; } }
  catch (e) { S.starting = false; say(e.message, true); }
  S.starting = false; render();
  return false;
}
// Signed in on this device: its session, and the signing key (kept here).
async function finishSignIn(r, macKey) {
  if (!macKey) { const p = await idb.get('macPending').catch(() => null); if (p && p.did === r.did) macKey = p.key; }
  if (macKey) await idb.set('mac', macKey);
  await idb.del('macPending').catch(e => console.log(`(carried on, line 1665) ${e && e.message}`));
  setSession({ aid: r.aid, did: r.did, ah: r.ah, dh: r.dh, n: Number(r.seq) || 0 });
  S.signin = null;
  try {
    await openData(r.sha);                                     // (just published)
    if (!getPin() && !getBio() && (INAPP || !noLockOffer())) { S.sub = { name: 'pin', first: true }; }   // (a lock for next time: needed in the app, offered elsewhere)
    render();
    say(`Signed in as ${ME.email}.`);
  } catch (e) { S.connected = false; render(); say(e.message, true); }
}

function signInScreen() {
  const st = S.signin || (S.signin = { step: 'form' });
  if (st.step === 'wait') {
    const codeIn = h('input', { class: 'inp', id: 'siCode', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code',
      maxlength: '7', placeholder: '6-digit code', value: st.codeVal || '', oninput: e => { st.codeVal = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter') confirmCode(); } });
    const codeGo = h('button', { type: 'button', class: 'btn p wide', id: 'siCodeGo' }, 'Confirm');
    const confirmCode = async () => {
      const code = (codeIn.value || '').replace(/\s+/g, '');
      if (!/^\d{6}$/.test(code)) return say('Type the 6-digit code from the email.', true);
      if (!st.aid) return say('Sign in again to get a fresh code.', true);
      codeGo.disabled = true; codeGo.textContent = 'Confirming…';
      try {
        const dev = await deviceKeys();
        const r = await command({ op: 'confirm', aid: st.aid, did: dev.did, code }, { signed: false, minutes: 4 });
        if (!r.ok) { codeGo.disabled = false; codeGo.textContent = 'Confirm'; return say(r.error, true); }
        say('Confirmed — signing you in…');          // the wait below finishes the sign-in on this device
      } catch (e) { codeGo.disabled = false; codeGo.textContent = 'Confirm'; say(e.message, true); }
    };
    codeGo.onclick = confirmCode;
    return h('main', { class: 'stack' }, screenTitle('Check your email', `We sent a link and code to ${st.email}`),
      h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'This device is new, so we\'ve emailed you to make sure it\'s you. Open the email and tap ',
        h('b', null, 'Yes, it\'s me'), ' (on any device) — or type the code from the email here.'),
        h('p', { class: 'hint', style: 'margin:0' }, 'The link and code work for 30 minutes. No email? Check your spam folder.')),
      st.aid ? h('div', { class: 'field' }, h('label', { for: 'siCode' }, 'Code from the email'), codeIn, codeGo) : null,
      waitNote('Waiting for you to tap the link or enter the code…'),
      h('button', { type: 'button', class: 'btn d', onclick: () => { S.signin = null; render(); } }, 'Start again'));
  }
  if (st.step === 'forgot') return forgotScreen();
  const email = h('input', { class: 'inp', id: 'siEmail', type: 'email', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', value: st.email || '' });
  const go1 = h('button', { type: 'button', class: 'btn p wide', id: 'siGo' }, 'Sign in');
  const run = async () => {
    const em = email.value.trim(), pw = $('siPw').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return say('Type your email address.', true);
    if (!pw) return say('Type your password.', true);
    go1.disabled = true; go1.textContent = 'Signing in… (up to a minute)';
    st.email = em;
    try {
      // Signed in meanwhile, in another tab of this browser (say, by the emailed link): just open the admin.
      if (getSession() && await openSignedIn()) return;
      let dev = await deviceKeys();
      const mac = await newMacSecret();
      // (Kept here meanwhile: if the email link is tapped in another tab of this browser, that tab can finish signing in.)
      await idb.set('macPending', { did: dev.did, key: mac.key });
      const number = await postCommand({ p: JSON.stringify({ op: 'signin', email: em, password: pw, did: dev.did, enc: dev.enc, mac: mac.b64, name: deviceName(), rk: dev.enc, at: Date.now(), tz: localTz() }) });
      const seen = new Set();
      const first = await awaitAnswers(number, () => true, { seen });
      if (!first) throw new Error('No answer from GitHub yet. Its automation may be busy or switched off (private repository → Actions). Try again in a minute.');
      if (first.code === 'DEVICE_ACTIVE') {
        // This browser is signed in already (in another tab). Open it; or, if this tab lost track, start afresh.
        if (getSession() && await openSignedIn()) return;
        await forgetDevice();
        go1.disabled = false; go1.textContent = 'Sign in';
        return say('Something went wrong on this device, so it was reset. Tap Sign in again.', true);
      }
      if (!first.ok) throw new Error(first.error);
      if (first.active) return finishSignIn(first, mac.key);
      // A new device: waiting for the emailed link, or the code typed here (the answer comes on the same issue).
      S.signin = { step: 'wait', email: first.email || em, aid: first.aid };
      $('toast').hidden = true;
      render();
      const done = await awaitAnswers(number, r => r.active || !r.ok, { minutes: 32, seen });
      if (!done || !done.ok) { S.signin = { step: 'form', email: em }; render(); return say(done ? done.error : 'The link wasn\'t tapped in time. Sign in again to get a new one.', true); }
      return finishSignIn(done, mac.key);
    } catch (e) { go1.disabled = false; go1.textContent = 'Sign in'; say(e.message, true); }
  };
  go1.onclick = run;
  const form = h('main', { class: 'stack' }, screenTitle('Admin', 'Sign in to manage LazerLock'),
    h('div', { class: 'field' }, h('label', { for: 'siEmail' }, 'Email'), email),
    pwField('siPw', 'Password', 'current-password'),
    go1,
    h('button', { type: 'button', class: 'btn d', id: 'siForgot', onclick: () => { st.step = 'forgot'; st.email = email.value.trim(); render(); } }, 'Forgot password?'),
    h('details', { class: 'more' }, h('summary', null, 'Setting up for the first time?'),
      h('p', { class: 'hint', style: 'margin:8px 0 0' }, `On GitHub, open your private repository (${C.repo || 'lazerlock-browser-private'}) → Actions → `,
        h('b', null, 'Set up admin sign-in'), ' → Run workflow, and type your email. You\'ll get an email with a link to choose your password.')));
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') run(); });
  setTimeout(() => (email.value ? $('siPw') : email).focus(), 50);
  return form;
}

function forgotScreen() {
  const st = S.signin;
  if (st.sent) return h('main', { class: 'stack' }, screenTitle('Check your email', ''),
    h('div', { class: 'card' }, h('p', { style: 'margin:0' }, `If ${st.email} is an admin's email, it has a link to choose a new password now. It works for 30 minutes.`),
      h('p', { class: 'hint', style: 'margin:0' }, 'Choosing a new password also signs you out on your other devices.')),
    h('button', { type: 'button', class: 'btn s', onclick: () => { S.signin = { step: 'form', email: st.email }; render(); } }, 'Back to sign in'));
  const email = h('input', { class: 'inp', id: 'fgEmail', type: 'email', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', value: st.email || '' });
  const go1 = h('button', { type: 'button', class: 'btn p wide', id: 'fgGo' }, 'Email me a link');
  go1.onclick = async () => {
    const em = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return say('Type your email address.', true);
    go1.disabled = true; go1.textContent = 'Sending… (up to a minute)';
    try {
      const r = await command({ op: 'forgot', email: em }, { signed: false });
      if (!r.ok) throw new Error(r.error);
      Object.assign(st, { sent: true, email: em }); render();
    } catch (e) { go1.disabled = false; go1.textContent = 'Email me a link'; say(e.message, true); }
  };
  setTimeout(() => email.focus(), 50);
  return h('main', { class: 'stack' }, backLink('Sign in', () => { S.signin = { step: 'form', email: email.value.trim() }; render(); }),
    screenTitle('Forgot password', 'We\'ll email you a link to choose a new one.'),
    h('div', { class: 'field' }, h('label', { for: 'fgEmail' }, 'Email'), email), go1);
}

// The links in emails: #invite=…, #reset=… (choose a password), #confirm=… (yes, it's me).
const LINK = (() => {
  const m = location.hash.match(/^#(invite|reset|confirm)=([A-Za-z0-9_.-]+)$/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);       // (not left in the address bar)
  const parts = m[2].split('.');
  return m[1] === 'confirm' ? { kind: 'confirm', aid: parts[0], did: parts[1], code: parts.slice(2).join('.') }
    : { kind: m[1], aid: parts[0], code: parts.slice(1).join('.') };
})();
function linkScreen() {
  const L = LINK;
  if (L.kind === 'confirm') {
    if (!L.started) {
      L.started = true;
      command({ op: 'confirm', aid: L.aid, did: L.did, code: L.code }, { signed: false, minutes: 4 })
        .then(async r => {
          // The link was tapped on the device that's signing in: it opens right here.
          if (r.ok && r.active && DEV && r.did === DEV.did) { LINK.kind = 'done'; return finishSignIn(r); }
          L.result = r; render();
        }).catch(e => { L.result = { ok: false, error: e.message }; render(); });
    }
    const r = L.result;
    return h('main', { class: 'stack' }, screenTitle(r ? (r.ok ? 'Confirmed' : 'Not confirmed') : 'Confirming…', ''),
      r ? h('div', { class: 'card' }, h('p', { style: 'margin:0' }, r.ok ? r.msg : r.error)) : waitNote('Confirming it\'s you… (up to a minute)'),
      r ? (getSession()
        ? h('button', { type: 'button', class: 'btn p', onclick: () => { LINK.kind = 'done'; openSignedIn(); } }, 'Open the admin here')
        : h('button', { type: 'button', class: 'btn s', onclick: () => { LINK.kind = 'done'; render(); } }, 'Sign in on this device too')) : null);
  }
  const invite = L.kind === 'invite';
  const rules = h('ul', { class: 'rules' });
  const check = () => { const p = $('lkPw').value; rules.replaceChildren(...PW_RULES.map(([t, label]) => h('li', { class: t(p) ? 'ok' : '' }, icon(t(p) ? 'check' : 'x', 15, 2.4), label))); };
  const go1 = h('button', { type: 'button', class: 'btn p wide', id: 'lkGo' }, invite ? 'Save and sign in' : 'Save the new password');
  go1.onclick = async () => {
    const a = $('lkPw').value, b = $('lkPw2').value;
    const bad = pwProblem(a);
    if (bad) return say(bad, true);
    if (a !== b) { $('lkPw2').value = ''; return say('The two passwords don\'t match. Type it again.', true); }
    go1.disabled = true; go1.textContent = 'Saving… (up to a minute)';
    try {
      const dev = await deviceKeys();
      const mac = await newMacSecret();
      const r = await command({ op: L.kind === 'invite' ? 'accept' : 'reset', aid: L.aid, code: L.code, password: a, did: dev.did, enc: dev.enc, mac: mac.b64, name: deviceName() }, { signed: false });
      if (!r.ok) throw new Error(r.error);
      LINK.kind = 'done';
      await finishSignIn(r, mac.key);
    } catch (e) { go1.disabled = false; go1.textContent = invite ? 'Save and sign in' : 'Save the new password'; say(e.message, true); }
  };
  const node = h('main', { class: 'stack' }, screenTitle(invite ? 'Welcome' : 'Choose a new password', invite ? 'Choose the password you\'ll sign in with.' : 'Your other devices will be signed out.'),
    pwField('lkPw', 'New password', 'new-password'), rules, pwField('lkPw2', 'The same password again', 'new-password'), go1,
    h('p', { class: 'hint' }, 'Don\'t use a password you use anywhere else.'));
  setTimeout(() => { const i = $('lkPw'); if (i) { i.addEventListener('input', check); check(); i.focus(); } }, 30);
  return node;
}

// ---------- In the app: a PIN for this phone (a quick lock: the admin is on a phone others may use) ----------
const PIN_KEY = 'wl-admin-pin';
const getPin = () => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || 'null'); } catch { return null; } };
async function pinHash(pin, salt) {
  const base = await crypto.subtle.importKey('raw', enc8(pin), 'PBKDF2', false, ['deriveBits']);
  return u8b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, 256));
}
async function setPin(pin) { const salt = crypto.getRandomValues(new Uint8Array(16)); localStorage.setItem(PIN_KEY, JSON.stringify({ salt: u8b64(salt), hash: await pinHash(pin, salt), tries: 0 })); }
async function pinOk(pin) {
  const P = getPin();
  if (!P) return true;
  if (await pinHash(pin, b64u8(P.salt)) === P.hash) { P.tries = 0; localStorage.setItem(PIN_KEY, JSON.stringify(P)); return true; }
  P.tries = (P.tries || 0) + 1;
  localStorage.setItem(PIN_KEY, JSON.stringify(P));
  if (P.tries >= 5) {                       // 5 wrong: this phone is signed out (sign in again with the password)
    localStorage.removeItem(PIN_KEY);
    command({ op: 'signout' }).catch(e => console.log(`(carried on, line 1832) ${e && e.message}`));
    await sleep(300);
    await forgetDevice();
  }
  return false;
}
// ---------- Fingerprint (or face): a lock for this device, like the PIN ----------
// In the app: Android's own fingerprint prompt. On the web: the device's own (Windows Hello, Touch ID, a phone's
// fingerprint), through the browser's passkey support. Either way only this device checks it, like the PIN.
const BIO_KEY = 'wl-admin-bio', NOLOCK_KEY = 'wl-admin-nolock';
const getBio = () => { try { return JSON.parse(localStorage.getItem(BIO_KEY) || 'null'); } catch { return null; } };
const noLockOffer = () => { try { return localStorage.getItem(NOLOCK_KEY) === '1'; } catch { return false; } };
async function bioAvailable() {
  try {
    if (INAPP) return !!(window.WLBAdmin && WLBAdmin.canBiometric && WLBAdmin.canBiometric());
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}
let bioWait = null;
window.wlBioDone = (ok, cancelled) => { if (bioWait) { const w = bioWait; bioWait = null; w(ok ? 'ok' : cancelled ? 'cancel' : 'fail'); } };
// Asks for the fingerprint now. True if it matched.
// Returns 'ok' (verified), 'cancel' (the person dismissed the prompt — not a failure), or 'fail' (a real problem).
async function bioCheck(b = getBio()) {
  if (!b) return 'fail';
  if (b.kind === 'app') return new Promise(res => { bioWait = res; try { WLBAdmin.biometric(); } catch { bioWait = null; res('fail'); } });
  try {
    const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: b64u8(b.id) }], userVerification: 'required', timeout: 60000 } });
    const flags = new Uint8Array(a.response.authenticatorData)[32];
    return (flags & 0x04) ? 'ok' : 'fail';        // (the device checked the person, not just that it's there)
  } catch (e) { return (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) ? 'cancel' : 'fail'; }
}
// Sets it up for this device (asking for the fingerprint once). True if it worked.
async function bioSetup() {
  if (INAPP) { if ((await bioCheck({ kind: 'app' })) !== 'ok') return false; localStorage.setItem(BIO_KEY, JSON.stringify({ kind: 'app' })); return true; }
  try {
    const c = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Whitelist admin' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: (ME && ME.email) || 'admin', displayName: (ME && (ME.name || ME.email)) || 'Admin' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000 } });
    localStorage.setItem(BIO_KEY, JSON.stringify({ kind: 'web', id: u8b64(c.rawId) }));
    return true;
  } catch { return false; }
}

// An on-screen numeric keypad matching the phone app's PIN screen, driving the page's PIN inputs by id (so each
// screen's existing validation keeps working). The inputs become read-only (the keypad is the only way to type);
// tapping a field makes it the active one. ⌫ is bottom-left, → (the primary action) bottom-right.
// On the phone (INAPP) this IS the whole PIN entry: it creates the hidden PIN input(s), shows its own dots, and the
// keypad types into them — so the caller does NOT render a visible field. In a browser it's not used (the caller
// renders a normal field + button). `fields` is an id string or {id, label}; many fields for enter-then-confirm.
function pinKeypad(fields, onEnter) {
  const list = (Array.isArray(fields) ? fields : [fields]).map(f => typeof f === 'string' ? { id: f } : f);
  let activeId = list[0].id;
  const rows = {};
  const renderDots = () => list.forEach(f => {
    const inp = $(f.id), row = rows[f.id]; if (!row) return;
    const n = inp ? inp.value.length : 0;
    row.replaceChildren();
    const count = Math.max(4, n);   // at least four dots (the minimum), filling as you type and growing past four
    for (let i = 0; i < count; i++) { const d = document.createElement('span'); d.className = 'pindot' + (i < n ? ' on' : ''); row.appendChild(d); }
    if (row.parentNode) row.parentNode.classList.toggle('active', f.id === activeId && list.length > 1);
  });
  setTimeout(renderDots, 0);
  const type = v => {
    const f = $(activeId) || $(list[0].id); if (!f) return;
    const max = Number(f.getAttribute('maxlength')) || 8;
    if (v === 'del') f.value = f.value.slice(0, -1); else if (f.value.length < max) f.value += v;
    f.dispatchEvent(new Event('input', { bubbles: true })); renderDots();
  };
  const key = (label, cls, fn) => h('button', { type: 'button', class: 'pinkey' + (cls ? ' ' + cls : ''), tabindex: '-1',
    'aria-label': label === '⌫' ? 'Delete' : label === '→' ? 'Enter' : label, onclick: fn }, label);
  const display = h('div', { class: 'pindisplay' }, list.map(f => {
    const inp = h('input', { type: 'password', id: f.id, inputmode: 'numeric', maxlength: '8', autocomplete: 'off', readonly: true, class: 'pinhidden' });
    const row = h('div', { class: 'pindots' }); rows[f.id] = row;
    return h('div', { class: 'pinfield', onclick: () => { activeId = f.id; renderDots(); } },
      f.label ? h('div', { class: 'pinflabel' }, f.label) : null, row, inp);
  }));
  const note = h('div', { class: 'pinflabel', style: 'opacity:.8' }, 'At least 4 digits');
  const grid = h('div', { class: 'pingrid' }, [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['⌫', '0', '→']].map(r =>
    h('div', { class: 'pinrow' }, r.map(k =>
      k === '⌫' ? key('⌫', '', () => type('del'))
        : k === '→' ? key('→', 'go', () => onEnter && onEnter())
          : key(k, '', () => type(k))))));
  return h('div', { class: 'pinpad' }, display, note, grid);
}

// Locking the admin on this device: offered after signing in (in the app, one of them is needed), and in Your account.
function pinScreen() {
  const first = S.sub && S.sub.first, had = !!getPin(), bio = !!getBio();
  const where = INAPP ? 'phone' : 'device';
  if (S.bioOk === undefined) { S.bioOk = null; bioAvailable().then(v => { S.bioOk = v; if (S.sub && S.sub.name === 'pin') render(); }); }
  const done = text => { S.sub = first ? null : { name: 'account' }; render(); if (text) say(text); };
  const field = (id, label) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('input', { class: 'inp', id, type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: '4 to 8 digits', style: 'max-width:12rem;font-size:20px;letter-spacing:.2em' }));
  const saveBtn = h('button', { type: 'button', class: 'btn p wide', id: 'pinSave' }, had ? 'Change the PIN' : 'Save the PIN');
  saveBtn.onclick = async () => {
    const a = $('pinNew').value, b = $('pinAgain').value;
    if (!/^\d{4,8}$/.test(a)) return say('The PIN needs 4 to 8 digits.', true);
    if (a !== b) { $('pinAgain').value = ''; return say('The two PINs don\'t match. Type it again.', true); }
    saveBtn.disabled = true;
    await setPin(a);
    done(had ? 'PIN changed. Use the new one next time.' : 'PIN saved. Next time, just type it to open the admin.');
  };
  const bioBtn = S.bioOk ? h('button', { type: 'button', class: 'btn s wide', id: 'bioSet', onclick: async e => {
    const btn = e.currentTarget;
    if (bio) { localStorage.removeItem(BIO_KEY); return done('Fingerprint unlock is off on this ' + where + '.'); }
    btn.disabled = true;
    if (await bioSetup()) done('Done. Next time, just use your fingerprint to open the admin.');
    else { btn.disabled = false; say('That didn\'t work. Try again, or choose a PIN.', true); }
  } }, icon('shield', 18), bio ? 'Turn off fingerprint unlock' : 'Use my fingerprint (or face)') : null;
  const never = !first || INAPP ? null : h('input', { type: 'checkbox', id: 'noLock' });
  const skip = first && !INAPP ? h('button', { type: 'button', class: 'btn d', id: 'pinSkip', onclick: () => {
    if (never && never.checked) { try { localStorage.setItem(NOLOCK_KEY, '1'); } catch {} }
    done(never && never.checked ? 'OK, it won\'t ask again on this device (Your account → Lock with a PIN, any time).' : '');
  } }, 'Not now') : null;
  const triesHint = h('p', { class: 'hint' }, `After 5 wrong PINs, this ${where} is signed out, and needs your email and password again.`);
  // In the app, make it a focused, phone-style PIN screen: the keypad is the whole screen, and it's entered in two
  // steps (type the PIN, then repeat it) instead of two fields crammed on one page. Fingerprint, when available, is
  // offered first. In a browser the original two-field form stays (a hardware keyboard, no keypad).
  if (INAPP) {
    const step = (S.sub && S.sub.pinStep) === 'confirm' ? 'confirm' : 'enter';
    if (step === 'confirm') {
      const confirm = async () => {
        const b = ($('pinAgain') || {}).value || '';
        if (b !== (S.sub.pin1 || '')) { S.sub.pinStep = 'enter'; S.sub.pin1 = ''; render(); return say('The two PINs don\'t match. Type it again.', true); }
        const a = S.sub.pin1; S.sub.pin1 = '';
        await setPin(a);
        done(had ? 'PIN changed. Use the new one next time.' : 'PIN saved. Next time, just type it to open the admin.');
      };
      return h('main', { class: 'stack', style: 'padding-bottom:24px' },
        backLink('Back', () => { S.sub.pinStep = 'enter'; S.sub.pin1 = ''; render(); }),
        screenTitle('Repeat the PIN', 'Type the same PIN again to confirm it.'),
        pinKeypad([{ id: 'pinAgain', label: 'Repeat PIN' }], confirm),
        triesHint);
    }
    const toConfirm = () => {
      const a = ($('pinNew') || {}).value || '';
      if (!/^\d{4,8}$/.test(a)) return say('The PIN needs 4 to 8 digits.', true);
      S.sub = { ...(S.sub || {}), name: 'pin', pinStep: 'confirm', pin1: a }; render();
    };
    return h('main', { class: 'stack', style: 'padding-bottom:24px' }, first ? null : backLink('Your account', () => open({ name: 'account' })),
      screenTitle(first ? `Lock the admin on this ${where}?` : had ? 'Change the PIN' : 'Lock with a PIN or fingerprint',
        first ? 'This phone stays signed in, so the admin needs a lock here: anyone who taps the title 7 times would get in otherwise.'
          : had ? 'The old PIN stops working straight away.' : 'You unlock it each time you open the admin here.'),
      bioBtn,
      bioBtn ? h('p', { class: 'hint', style: 'margin:0;text-align:center' }, 'or set a PIN') : null,
      pinKeypad([{ id: 'pinNew', label: had ? 'New PIN' : 'PIN' }], toConfirm),
      triesHint);
  }
  setTimeout(() => !S.bioOk && $('pinNew') && $('pinNew').focus(), 50);
  return h('main', { class: 'stack', style: 'padding-bottom:24px' }, first ? null : backLink('Your account', () => open({ name: 'account' })),
    screenTitle(first ? `Lock the admin on this ${where}?` : had ? 'Change the PIN' : 'Lock with a PIN or fingerprint', first
      ? 'This device stays signed in. If others use it, a lock keeps them out of the admin: you unlock it each time you open it.'
      : had ? 'The old PIN stops working straight away.' : 'You unlock it each time you open the admin here.'),
    bioBtn,
    bioBtn ? h('p', { class: 'hint', style: 'margin:0;text-align:center' }, 'or a PIN') : null,
    [field('pinNew', had ? 'New PIN' : 'PIN'), field('pinAgain', 'The same PIN again'), saveBtn],
    skip, never ? h('label', { class: 'check', for: 'noLock' }, never, 'Don\'t ask again on this device') : null,
    had ? h('button', { type: 'button', class: 'btn d', id: 'pinRemove', onclick: () => { localStorage.removeItem(PIN_KEY); done('PIN removed from this device.'); } }, 'Remove the PIN') : null,
    triesHint);
}
function unlockScreen() {
  const P = getPin(), B = getBio();
  const pin = P ? h('input', { class: 'inp', id: 'uPin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '8', placeholder: 'PIN', style: 'max-width:12rem;font-size:22px;letter-spacing:.2em' }) : null;
  const go1 = P ? h('button', { type: 'button', class: 'btn p wide', id: 'uGo' }, 'Unlock') : null;
  const open1 = async () => {
    S.locked = false;
    // The session is still live underneath (an ordinary re-lock): just reveal it — no reload, so nothing in flight or
    // unsaved is disturbed. Only when there's no session (a fresh start after the app was killed) do we load data.
    if (S.connected) { render(); if (S.listDirty || S.devDirty) flushSave(); return; }
    S.starting = true; render();
    try { await openData(); } catch (e) { say(e.message, true); }
    S.starting = false; render();
  };
  const tryIt = async () => {
    const uPin = $('uPin') || pin;   // on the phone the keypad owns the input; read it by id
    if (go1) go1.disabled = true;
    if (!(await pinOk(uPin.value))) {
      if (go1) go1.disabled = false; uPin.value = '';
      const now = getPin();
      if (!now) { say('Too many wrong PINs, so this device was signed out. Sign in again with your email and password.', true); S.locked = false; render(); }
      else { const n = 5 - now.tries; say(`Wrong PIN. ${n} ${n === 1 ? 'try' : 'tries'} left.`, true); }
      return;
    }
    open1();
  };
  const bioBtn = B ? h('button', { type: 'button', class: P ? 'btn s wide' : 'btn p wide', id: 'uBio', onclick: async e => {
    const btn = e.currentTarget; btn.disabled = true;
    const r = await bioCheck(B);
    if (r === 'ok') return open1();
    btn.disabled = false;
    if (r === 'fail') say(P ? 'Not recognised. Try again, or type your PIN.' : 'Not recognised. Try again.', true);   // (a cancel is silent)
  } }, icon('shield', 18), 'Unlock with fingerprint') : null;
  if (go1) { go1.onclick = tryIt; pin.addEventListener('keydown', e => { if (e.key === 'Enter') tryIt(); }); }
  // (In the app, the fingerprint prompt opens by itself; a browser needs a tap first.)
  setTimeout(() => { if (B && INAPP && !S.bioAsked) { S.bioAsked = true; bioBtn.click(); } else if (pin) pin.focus(); }, 80);
  return h('main', { class: 'stack' }, screenTitle('Admin', B && !P ? 'Unlock with your fingerprint' : B ? 'Your fingerprint or PIN' : 'Type your PIN'),
    bioBtn,
    P && !INAPP ? h('div', { class: 'field' }, h('label', { for: 'uPin' }, 'Your PIN'), pin) : null,
    P && INAPP ? pinKeypad([{ id: 'uPin', label: 'Your PIN' }], tryIt) : null,     // phone: keypad; browser: plain field + button
    INAPP ? null : go1,
    h('button', { type: 'button', class: 'btn d', onclick: async () => {
      if (!(await uiConfirm('Sign in with your password instead?', 'This device is signed out, then you sign in again with your email and password.', 'Sign out', { icon: 'warn' }))) return;
      command({ op: 'signout' }).catch(e => console.log(`(carried on, line 1952) ${e && e.message}`)); await sleep(300); localStorage.removeItem(PIN_KEY); localStorage.removeItem(BIO_KEY); S.locked = false; await signedOutHere(); } },
      P ? 'Forgot the PIN?' : 'Use my password instead'));
}

