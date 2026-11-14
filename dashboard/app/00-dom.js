
(() => {
'use strict';
// ============================================================================================
// Whitelist admin page. Four tabs (Requests, Sites, Phones, Settings) plus sub-screens.
// It reads and writes the private repository: docs/whitelist.json, docs/lists/*.json and
// devices.json, and answers requests (issues there) by posting the same replies you could type on GitHub.
// ============================================================================================
const $ = id => document.getElementById(id);

// ---------- tiny DOM helper ----------
// h('button', { class: 'btn p', onclick: fn }, 'Save') ; props with value null/false are skipped.
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'open']);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const ICONS = {
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13"/><path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5h-5l-1.5 2h-3L9 13z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chev: '<path d="M9 6l6 6-6 6"/>', back: '<path d="M15 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  shield: '<path d="M12 3.5l7 3v5c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9v-5z"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M10 10v9"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  ext: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-8 8"/>',
  photooff: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3 3l18 18"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/><g transform="translate(12 12.6) scale(0.55) translate(-12 -12.65)"><path stroke-width="3.09" d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6-1.6A4 4 0 0 0 6 19z"/></g>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
  pencil: '<path d="M4 20h4L18.5 9.5a2 2 0 0 0-3-3L5 17z"/><path d="M14 7l3 3"/>'
};
function icon(name, size = 20, sw = 1.8) {
  return h('span', { class: 'icwrap', style: 'display:inline-flex', 'aria-hidden': 'true',
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>` });
}
const chip = (text, kind = '', ic) => h('span', { class: `chip ${kind}` }, ic ? icon(ic, 14, 2) : null, text);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtMin = m => [Math.floor(m / 60) && `${Math.floor(m / 60)} h`, m % 60 && `${m % 60} min`].filter(Boolean).join(' ') || '0 min';
const ago = iso => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
// A phone's own list is named after its ID ("k7m4-q2xp"), since list names are public: show the person's name.
const ID_LIST = /^[2-9a-hj-np-z]{4}-[2-9a-hj-np-z]{4}$/;
function listLabel(n) {
  if (n === 'public') return 'Default public list';
  if (ID_LIST.test(n) && typeof S !== 'undefined' && S.D) {
    const id = n.toUpperCase(), d = S.D.devices[id] || (S.D.archived || {})[id];
    if (d) return d.name || id;
  }
  return cap(n.replace(/-/g, ' '));        // year-5 -> Year 5 (the list keeps its name)
}
// Public lists: the default one ("public"), and any list marked public (devices.json "publicLists"). They can
// be ticked on any request, and given to groups of phones. A phone's own list is never public.
const isPublicList = n => n === 'public' || (typeof S !== 'undefined' && S.D && (S.D.publicLists || []).includes(n) && !ID_LIST.test(n));
const publicListNames = () => S.lists.filter(isPublicList).sort((a, b) => (a === 'public' ? -1 : b === 'public' ? 1 : a.localeCompare(b)));
const tileColor = s => ['#3C3489', '#B4492F', '#6A4FB0', '#1F5F55', '#185FA5', '#854F0B', '#8E3322'][[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % 7];

