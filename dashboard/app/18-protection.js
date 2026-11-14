// ============================================================================================
// Other browsers: keeping the managed browser in place (supervised protection, set by the admin)
// ============================================================================================
// Each phone can have a "protect" block in devices.json: mode (owner/cover/off), the screen cover on/off,
// "block new browsers", and a per-app allow/block map. The phone reports which apps can open websites (seen.json).
const protectOf = d => (d.protect && typeof d.protect === 'object') ? d.protect : null;
function ensureProtect(d) { if (!d.protect || typeof d.protect !== 'object') d.protect = { mode: 'off', apps: {} }; if (!d.protect.apps) d.protect.apps = {}; return d.protect; }
// Lock a mode in as YOUR setting (used when you manage a sub-option on a phone that turned protection on itself).
function lockMode(d, m) { const pr = ensureProtect(d); pr.mode = m; delete pr.off; delete pr.offAt; return pr; }
const seenApps = id => { const p = S.seen && S.seen.phones && S.seen.phones[id]; return (p && Array.isArray(p.apps)) ? p.apps : []; };
const seenProtect = id => { const p = S.seen && S.seen.phones && S.seen.phones[id]; return (p && p.protect) || null; };
// The mode to SHOW for a phone: the admin's own setting when they've chosen one (or deliberately turned it off);
// otherwise what the phone reports it's actually doing — so a phone that turned protection on itself reads as
// "Screen cover", not "off". (Display only; it never changes the admin's saved setting.)
function effectiveMode(id, d) {
  const p = protectOf(d);
  if (p && (p.mode === 'owner' || p.mode === 'cover')) return p.mode;    // the admin chose a mode: that's the policy
  const sp = S.seen && S.seen.phones && S.seen.phones[id];
  const s = sp && sp.protect;
  // The admin turned protection off — that holds, UNLESS the phone has raised it again since (a check-in made after
  // the turn-off that reports protection on). Raising is free, so a later self-enable is honoured.
  if (p && p.off === true) {
    const seenAt = sp && sp.at ? Date.parse(sp.at) : 0;
    const raisedSince = s && (s.owner || s.intended === true) && seenAt && p.offAt && seenAt > Number(p.offAt);
    if (!raisedSince) return 'off';
  }
  if (s) { if (s.owner) return 'owner'; if (s.intended === true) return 'cover'; }   // else: what the phone reports
  return 'off';
}
// What's set up on the phone right now (from its check-in), in words.
function protectState(id) {
  const s = seenProtect(id);
  if (!s) return null;
  // Newer app: one master status (active / partial / off) with the list of lapsed means.
  const health = s.health || (s.intended !== undefined
    ? (s.intended ? ((s.cover && s.admin && s.battery) ? 'active' : 'partial') : 'off') : null);
  if (health) {
    if (health === 'active') return { label: 'Protected', tone: 'teal' };
    if (health === 'partial') {
      const m = Array.isArray(s.missing) && s.missing.length ? ' · ' + s.missing.join(', ') : '';
      return { label: 'Action needed' + m, tone: 'amber' };
    }
    return { label: 'Off', tone: 'amber' };
  }
  // Older app (no master status reported): describe the means it did report.
  if (s.admin && s.cover) return { label: 'Screen guard + uninstall protection', tone: 'teal' };
  if (s.cover) return { label: 'Screen guard', tone: 'teal' };
  if (s.admin) return { label: 'Uninstall protection only', tone: 'amber' };
  return { label: 'Not set up on the phone yet', tone: 'amber' };
}
// True when the phone is meant to be protected but a means has lapsed (for the alert banner).
function protectionLapsed(id) {
  const s = seenProtect(id);
  return !!(s && !s.owner && (s.health === 'partial'
    || (s.health === undefined && s.intended === true && !(s.cover && s.admin && s.battery))));
}
// The per-means breakdown the phone reports (newer app, non-owner), to mirror the phone's own checklist on the dashboard.
function protectMeans(id) {
  const s = seenProtect(id);
  if (!s || s.owner || s.intended === undefined) return null;
  return [['Screen guard', s.cover === true], ['Can’t be uninstalled', s.admin === true], ['Always running (battery)', s.battery === true]];
}
// How an app stands: explicit allow/block, or (a found browser) blocked by "block new".
function appDecision(d, app) {
  const p = protectOf(d);
  if (p && p.apps && p.apps[app.pkg]) return p.apps[app.pkg];
  if ((app.kind === 'browser') && p && p.blockNew !== false && p.mode !== 'off') return 'block';
  return 'allow';
}
// A short line for the phone screen's row.
function browsersSummary(id, d) {
  const apps = seenApps(id);
  const blocked = apps.filter(a => appDecision(d, a) === 'block').length;
  const m = effectiveMode(id, d);   // reflects the phone's own state when the admin hasn't set a mode
  if (m === 'off') return apps.length ? `${plural(apps.length, 'app')} found · not blocking` : 'Not set up';
  return `${m === 'owner' ? 'Device owner' : 'Device admin'} · ${blocked ? plural(blocked, 'app') + ' blocked' : 'nothing blocked yet'}`;
}
function phoneBrowsers(id, d, M) {
  return h('div', { class: 'field', id: 'pBrowsers' },
    h('button', { type: 'button', class: 'row tap', style: 'width:100%;text-align:left', onclick: () => open({ name: 'browsers', id }) },
      h('span', { class: 'ic' }, icon('globe', 20)),
      h('span', { class: 'grow', style: 'min-width:0' }, h('span', { class: 'name' }, 'Block other browsers'),
        h('span', { class: 'dom' }, browsersSummary(id, d))),
      icon('chev', 16)));
}
