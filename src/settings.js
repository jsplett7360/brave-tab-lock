// Tab Lock — settings defaults and validation (pure).

export const CATEGORIES = ['history', 'settings', 'passwords', 'extensions', 'downloads'];
export const MODES = ['hide', 'lockdown'];
export const SCOPES = ['all', 'sites'];
export const MAX_SITES = 200;

export const DEFAULTS = Object.freeze({
  timeoutMin: 5,          // inactivity (system idle OR Brave unfocused) before locking
  lockOnStartup: true,
  lockOnUnfocus: true,    // count "Brave not focused" as inactivity
  graceMin: 2,            // protected-page grace window after a correct PIN
  protect: Object.freeze({ history: true, settings: true, passwords: true, extensions: true, downloads: true }),
  wipeAfter: Object.freeze({ enabled: false, n: 20 }),
  // 'hide' (default): each tab shows the lock page in place, so it keeps its container,
  // logins, group, pin and position. 'lockdown': close + encrypt + reopen (the Vault).
  mode: 'hide',
  // Only for 'hide' mode: lock every tab, or only tabs on the listed sites.
  scope: 'all',
  sites: Object.freeze([]),
});

const clampInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

/**
 * Parse one site pattern. Accepts `mail.proton.me`, `*.bank.com` or a pasted address
 * (`https://mail.proton.me/u/0` → `mail.proton.me`). Returns { pattern } or { error }.
 * `example.com` matches only that host; `*.example.com` matches it and every subdomain.
 */
export function parseSitePattern(input) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return { error: 'empty' };
  let wildcard = false;
  if (s.startsWith('*.')) { wildcard = true; s = s.slice(2); }
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    if (wildcard) return { error: 'Use either *.example.com or a full address, not both.' };
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Only web addresses (http or https) can be listed.' };
      s = u.hostname;
    } catch {
      return { error: 'Not a valid address.' };
    }
  } else {
    s = s.replace(/[/?#].*$/, '');
  }
  if (!s || s.includes('*')) return { error: 'A * is only allowed at the start, as in *.example.com.' };
  let host;
  try {
    host = new URL(`https://${s}/`).hostname; // lower-cases, punycodes IDNs, drops a port
  } catch {
    return { error: 'Not a valid site name.' };
  }
  if (!host || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return { error: 'Not a valid site name.' };
  if (wildcard && !host.includes('.')) return { error: 'Add a domain after *., as in *.example.com.' };
  return { pattern: wildcard ? `*.${host}` : host };
}

/** Parse a textarea (one pattern per line). Returns { sites, errors: [{ line, text, error }] }. */
export function parseSiteList(text) {
  const sites = [];
  const errors = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const r = parseSitePattern(raw);
    if (r.error) errors.push({ line: i + 1, text: raw.trim(), error: r.error });
    else if (!sites.includes(r.pattern)) sites.push(r.pattern);
  });
  if (sites.length > MAX_SITES) errors.push({ line: 0, text: '', error: `At most ${MAX_SITES} sites.` });
  return { sites: sites.slice(0, MAX_SITES), errors };
}

/** Does `url` (http/https only) belong to one of `sites` (normalized patterns)? */
export function matchesSite(url, sites) {
  if (!Array.isArray(sites) || sites.length === 0) return false;
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname;
  } catch {
    return false;
  }
  return sites.some((p) => {
    if (p.startsWith('*.')) {
      const base = p.slice(2);
      return host === base || host.endsWith(`.${base}`);
    }
    return host === p;
  });
}

/** Merge untrusted input over defaults, keeping only known keys with sane values. */
export function sanitize(input) {
  const i = input && typeof input === 'object' ? input : {};
  const protect = {};
  for (const c of CATEGORIES) {
    protect[c] = typeof i.protect?.[c] === 'boolean' ? i.protect[c] : DEFAULTS.protect[c];
  }
  const sites = [];
  if (Array.isArray(i.sites)) {
    for (const s of i.sites) {
      const r = parseSitePattern(s);
      if (r.pattern && !sites.includes(r.pattern) && sites.length < MAX_SITES) sites.push(r.pattern);
    }
  }
  const mode = MODES.includes(i.mode) ? i.mode : DEFAULTS.mode;
  let scope = SCOPES.includes(i.scope) ? i.scope : DEFAULTS.scope;
  if (scope === 'sites' && sites.length === 0) scope = 'all'; // an empty list would lock nothing
  return {
    timeoutMin: clampInt(i.timeoutMin, 1, 240, DEFAULTS.timeoutMin),
    lockOnStartup: typeof i.lockOnStartup === 'boolean' ? i.lockOnStartup : DEFAULTS.lockOnStartup,
    lockOnUnfocus: typeof i.lockOnUnfocus === 'boolean' ? i.lockOnUnfocus : DEFAULTS.lockOnUnfocus,
    graceMin: clampInt(i.graceMin, 1, 30, DEFAULTS.graceMin),
    protect,
    wipeAfter: {
      enabled: typeof i.wipeAfter?.enabled === 'boolean' ? i.wipeAfter.enabled : DEFAULTS.wipeAfter.enabled,
      n: clampInt(i.wipeAfter?.n, 6, 1000, DEFAULTS.wipeAfter.n),
    },
    mode,
    scope,
    sites,
  };
}

/** The scope that actually applies: Lockdown mode always locks every tab. */
export function effectiveScope(s) {
  return s.mode === 'lockdown' ? 'all' : s.scope;
}
