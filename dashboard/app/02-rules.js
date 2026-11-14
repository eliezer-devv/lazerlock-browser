// ---------- address rules (the same as the app) ----------
function normalize(entry) {
  let s = String(entry || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '');
  s = s.split('/')[0].split('?')[0].split(':')[0].replace(/\.$/, '');
  return /^[a-z0-9.-]+$/.test(s) && s.includes('.') ? s : undefined;
}
// No scheme or #part, host without www./m./mobile., then path and query.
function pageKey(entry) {
  let s = String(entry || '').trim();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('#')[0];
  let cut = s.search(/[/?]/); if (cut < 0) cut = s.length;
  const host = s.slice(0, cut).toLowerCase().split(':')[0].replace(/\.$/, '').replace(/^(www|m|mobile)\./, '');
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) return undefined;
  let rest = s.slice(cut) || '/';
  if (rest.startsWith('?')) rest = '/' + rest;
  return host + rest;
}
function pageOnSite(key, domain, subdomains) {
  const host = key.split('/')[0];
  const d = domain.replace(/^(www|m|mobile)\./, '');
  return host === d || (subdomains && host.endsWith('.' + d));
}
const hasPath = l => /[/?]./.test(String(l).replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''));
const blockEntry = l => hasPath(l) ? pageKey(l) : normalize(l);   // a site, or a single page

