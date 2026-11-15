// Tab Lock — settings defaults and validation (pure).

export const CATEGORIES = ['history', 'settings', 'passwords', 'extensions', 'downloads'];

export const DEFAULTS = Object.freeze({
  timeoutMin: 5,          // inactivity (system idle OR Brave unfocused) before locking
  lockOnStartup: true,
  lockOnUnfocus: true,    // count "Brave not focused" as inactivity
  graceMin: 2,            // protected-page grace window after a correct PIN
  protect: Object.freeze({ history: true, settings: true, passwords: true, extensions: true, downloads: true }),
  wipeAfter: Object.freeze({ enabled: false, n: 20 }),
});

const clampInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

/** Merge untrusted input over defaults, keeping only known keys with sane values. */
export function sanitize(input) {
  const i = input && typeof input === 'object' ? input : {};
  const protect = {};
  for (const c of CATEGORIES) {
    protect[c] = typeof i.protect?.[c] === 'boolean' ? i.protect[c] : DEFAULTS.protect[c];
  }
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
  };
}
