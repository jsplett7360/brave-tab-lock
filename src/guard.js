// Tab Lock — protected-page classification (pure).
//
// Brave reports brave:// pages to extensions as chrome:// URLs (observed in Brave
// 1.99.57). We normalise both spellings anyway.

const RULES = [
  // order matters: passwords before settings so settings/passwords → passwords
  { cat: 'passwords', hosts: ['password-manager'], settingsPaths: ['passwords', 'autofill', 'passkeys'] },
  { cat: 'history', hosts: ['history', 'history-clusters'] },
  { cat: 'extensions', hosts: ['extensions', 'extensions-internals'] },
  { cat: 'downloads', hosts: ['downloads'] },
  { cat: 'settings', hosts: ['settings'] },
];

/** Parse a chrome://, brave:// or edge-style internal URL into {host, path} or null. */
export function parseInternal(url) {
  if (typeof url !== 'string') return null;
  const m = /^(?:chrome|brave):\/\/([^/?#]+)\/?([^?#]*)/i.exec(url.trim());
  if (!m) return null;
  return { host: m[1].toLowerCase(), path: m[2].toLowerCase() };
}

/** The protected category a URL belongs to, or null. */
export function classify(url) {
  const p = parseInternal(url);
  if (!p) return null;
  for (const r of RULES) {
    if (r.hosts.includes(p.host)) return r.cat;
    if (p.host === 'settings' && r.settingsPaths?.some((s) => p.path === s || p.path.startsWith(s + '/'))) return r.cat;
  }
  return null;
}

/** Whether the URL needs the PIN right now. */
export function needsGate(url, protect, graces, now) {
  const cat = classify(url);
  if (!cat || !protect?.[cat]) return null;
  if ((graces?.[cat] ?? 0) > now) return null;
  return cat;
}
