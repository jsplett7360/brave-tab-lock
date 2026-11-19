// Tab Lock — "hide in place" helpers (pure; no chrome.* calls).
//
// In the default mode a locked tab is navigated to lock.html#<token> in the same tab, so
// it keeps its Brave Container, cookies/logins, group, pin and position. The token is 128
// random bits and says nothing about the page. What the tab was showing ({url, title}) is
// sealed (same envelope encryption as the Vault) in a chunk in storage.local.hidden:
//   { ...sealedFor({ tabs: { <token>: { url, title, at? } } }), at, toks: [<token>…], orphan? }
// `at` (0.1.4+) is where the tab was: { win, index, pinned, group?, state?, bounds? }, so a
// tab the browser didn't bring back after a restart can be reopened in its window, pin
// and group. Records from 0.1.2/0.1.3 have no `at` and reopen as plain tabs.
// `toks` lists the chunk's tokens in clear (random, non-secret) so a tab can be matched
// to its chunk without the PIN. Tab IDs change across restarts and discards, so
// everything is keyed by token.

export const TOKEN_RE = /^[0-9a-f]{32}$/;

/** 16 random bytes as 32 lowercase hex characters. */
export function newToken(randomBytes) {
  return [...randomBytes(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hideUrl(lockUrl, token) {
  return `${lockUrl}#${token}`;
}

/** Token of a hidden-tab lock URL, else null (plain lock page, gate page, other URL). */
export function tokenFromUrl(url, lockUrl) {
  if (typeof url !== 'string' || !url.startsWith(`${lockUrl}#`)) return null;
  const t = url.slice(lockUrl.length + 1);
  return TOKEN_RE.test(t) ? t : null;
}

/** All tokens listed (in clear) by a set of chunks. */
export function chunkTokens(chunks) {
  const s = new Set();
  for (const c of chunks || []) for (const t of c.toks || []) s.add(t);
  return s;
}

/** Same page for the purpose of "did Back land where we expected" (ignores the #hash). */
export function samePage(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = '';
    y.hash = '';
    return x.href === y.href;
  } catch {
    return a === b;
  }
}

/** Where a tab sits, for reopening it later. `groups` maps groupId → {title,color,collapsed}; `wins` maps windowId → window. */
export function tabPlace(t, groups = {}, wins = {}) {
  const at = { win: Number.isInteger(t.windowId) ? t.windowId : -1, index: Number.isInteger(t.index) ? t.index : 0, pinned: !!t.pinned };
  const g = Number.isInteger(t.groupId) && t.groupId >= 0 ? groups[t.groupId] : null;
  if (g) at.group = { key: String(t.groupId), title: g.title || '', color: g.color, collapsed: !!g.collapsed };
  const w = wins[t.windowId];
  if (w) {
    if (w.state === 'maximized' || w.state === 'fullscreen') at.state = w.state;
    else at.bounds = { left: w.left, top: w.top, width: w.width, height: w.height };
  }
  return at;
}

/**
 * Turn sealed hidden-tab entries ({ token: { url, title, at? } }) into the window snapshot
 * shape restoreWindows() takes: one window per original window, tabs in their old order,
 * pinned state and named groups kept. Entries without `at` share one window. Each tab
 * carries its `token`.
 */
export function placesToWindows(entries) {
  const byWin = new Map();
  for (const [token, e] of Object.entries(entries || {})) {
    const key = Number.isInteger(e?.at?.win) ? e.at.win : 'none';
    if (!byWin.has(key)) byWin.set(key, []);
    byWin.get(key).push({ ...e, token });
  }
  const out = [];
  for (const list of byWin.values()) {
    list.sort((a, b) => (b.at?.pinned ? 1 : 0) - (a.at?.pinned ? 1 : 0) || (a.at?.index ?? 0) - (b.at?.index ?? 0));
    const groups = {};
    for (const e of list) if (e.at?.group?.key) groups[e.at.group.key] = { title: e.at.group.title, color: e.at.group.color, collapsed: !!e.at.group.collapsed };
    const w = list.find((e) => e.at?.state || e.at?.bounds)?.at || {};
    out.push({
      incognito: false,
      state: w.state,
      bounds: w.bounds,
      groups,
      tabs: list.map((e) => ({ url: e.url, title: e.title || '', pinned: !!e.at?.pinned, active: false, group: e.at?.group?.key ?? null, token: e.token })),
    });
  }
  return out;
}
