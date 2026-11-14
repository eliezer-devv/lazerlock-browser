// ============================================================================================
// Timers: changes that switch on at set times, for phones and groups (devices.json "timers")
// ============================================================================================
// kind: "schedule" (days and hours, every week), "once" (from a time, for so long), "allowance" (so much time a day on
// some sites or lists). "during": what changes while it's on (left out: no change). Each keeps its own time zone.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const timerDefs = () => (S.D && S.D.timers && typeof S.D.timers === 'object') ? S.D.timers : {};
const canTimers = () => fullAdmin() || canDo('manage');
// Which phones a timer reaches (its own, and its groups' phones).
const timerPhones = t => Object.entries(S.D.devices).filter(([id, d]) => (t.for && ((t.for.phones || []).includes(id) || (d.groups || []).some(g => (t.for.groups || []).includes(g))))).map(([id]) => id);
// May this admin change it? (Helpers: only timers just for their own phones.)
const timerMine = t => fullAdmin() || (canDo('manage') && !(t.for.groups || []).length && (t.for.phones || []).length && (t.for.phones || []).every(id => !!S.D.devices[id]));
// The day and minute of the day in a time zone.
function tzNow(tz, t = Date.now()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return { day: DAYS.indexOf(p.weekday), min: Number(p.hour) % 24 * 60 + Number(p.minute) };
  } catch { const d = new Date(t); return { day: d.getDay(), min: d.getHours() * 60 + d.getMinutes() }; }
}
const hm = s => { const [a, b] = String(s || '0:0').split(':').map(Number); return (a || 0) * 60 + (b || 0); };
// On right now? (A daily allowance: "on" on the days it applies.)
function timerOn(t, now = Date.now()) {
  if (t.paused) return false;
  if (t.kind === 'once') return now >= t.startAt && now < t.startAt + t.minutes * 60000;
  const { day, min } = tzNow(t.tz, now);
  const days = t.days || [];
  if (t.kind === 'allowance') return days.includes(day);
  const f = hm(t.from), to = hm(t.to);
  if (f === to) return days.includes(day);
  if (f < to) return days.includes(day) && min >= f && min < to;
  return (days.includes(day) && min >= f) || (days.includes((day + 6) % 7) && min < to);
}
const timerOver = t => t.kind === 'once' && Date.now() >= t.startAt + t.minutes * 60000;
function daysText(days) {
  const d = [...(days || [])].sort();
  if (d.length === 7) return 'Every day';
  if (!d.length) return 'No days';
  // Runs of days in a row: "Sun–Thu", "Mon, Wed, Fri".
  const runs = []; let s = d[0], p = d[0];
  for (const x of d.slice(1).concat(99)) { if (x === p + 1) { p = x; continue; } runs.push(s === p ? DAYS[s] : p === s + 1 ? `${DAYS[s]}, ${DAYS[p]}` : `${DAYS[s]}–${DAYS[p]}`); s = p = x; }
  return runs.join(', ');
}
function timerWhen(t) {
  if (t.kind === 'once') {
    const start = new Date(t.startAt).toLocaleString([], { timeZone: t.tz || undefined, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `${timerOver(t) ? 'Was ' : ''}${start}, for ${fmtMin(t.minutes)}`;
  }
  if (t.kind === 'allowance') return `${fmtMin(t.minutes)} a day · ${daysText(t.days)}`;
  return `${daysText(t.days)}, ${t.from} to ${t.to}`;
}
function timerWhat(t) {
  if (t.kind === 'allowance') {
    const on = [...((t.on || {}).sites || []), ...((t.on || {}).lists || []).map(l => `the ${listLabel(l)} list`)];
    return `On ${joinWords(on) || 'nothing yet'} · then ${t.usedUp === 'media' ? 'videos and sound blocked' : 'blocked until tomorrow'}`;
  }
  const d = t.during || {}, out = [];
  if (d.sites === 'none') out.push('Nothing opens');
  if (d.sites === 'only') out.push(`Only ${joinWords((d.lists || []).map(listLabel)) || 'no lists'}`);
  if (d.sites === 'also') out.push(`Also opens: ${joinWords((d.lists || []).map(listLabel)) || 'no lists'}`);
  const bl = MKINDS.filter(([k]) => d[k] === 'blocked').map(([k]) => k), op = MKINDS.filter(([k]) => d[k] === 'open').map(([k]) => k);
  if (bl.length) out.push(`${joinWords(bl)} blocked`);
  if (op.length) out.push(`${joinWords(op)} open`);
  if (d.search) out.push(`search ${d.search}`);
  if (d.ask === 'no') out.push('can\'t ask for sites');
  if (d.temporary === 'paused') out.push('temporary access paused');
  return out.length ? capFirst(out.join(' · ')) : 'No changes yet';
}
const timerFor = t => joinWords([...((t.for || {}).groups || []).map(g => `${groupName(g)} (group)`), ...((t.for || {}).phones || []).map(id => (S.D.devices[id] || {}).name || id)]) || 'Nobody yet';
function timerStatus(t) {
  if (t.paused) return ['Paused', 'amber'];
  if (timerOver(t)) return ['Over', ''];
  return timerOn(t) ? [t.kind === 'allowance' ? 'Today' : 'On now', 'teal'] : [t.kind === 'allowance' ? 'Not today' : 'Later', ''];
}
// A new timer (for [phone], if made from a phone's screen).
function newTimer(phone) {
  if (!S.D.timers) S.D.timers = {};
  const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tz = localTz() || 'UTC';
  S.D.timers[id] = { name: 'New timer', kind: 'schedule', tz, for: { groups: [], phones: phone ? [phone] : [] },
    days: /Jerusalem|Tel_Aviv|Hebron|Gaza/.test(tz) ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5], from: '16:00', to: '18:00', during: {}, created: new Date().toISOString() };
  markDevices();
  open({ name: 'timer', id, from: phone || null });
}
function timerRow(id, t) {
  const [st, kind] = timerStatus(t);
  const mine = timerMine(t);
  return h('div', { class: 'row timerrow', 'data-timer': id },
    h('button', { type: 'button', class: 'grow tbody', onclick: () => open({ name: 'timer', id, from: S.sub && S.sub.name === 'phone' ? S.sub.id : null }) },
      h('b', null, t.name || 'Timer'), h('span', { class: 'small muted' }, timerWhen(t)), h('span', { class: 'small muted' }, timerWhat(t))),
    h('span', { class: `chip ${kind}`, style: 'flex:none' }, st),
    h('input', { type: 'checkbox', class: 'sw', 'aria-label': `${t.name}: on`, checked: !t.paused, disabled: !mine || !canTimers(), onchange: e => {
      if (e.target.checked) delete t.paused; else t.paused = true; markDevices(); render(); } }));
}
// The Timers tab: every timer, by who it's for.
