// Tab Lock — "hide in place" helpers (pure; no chrome.* calls).
//
// In the default mode a locked tab is navigated to lock.html#<token> in the same tab, so
// it keeps its Brave Container, cookies/logins, group, pin and position. The token is 128
// random bits and says nothing about the page. What the tab was showing ({url, title}) is
// sealed (same envelope encryption as the Vault) in a chunk in storage.local.hidden:
//   { ...sealedFor({ tabs: { <token>: { url, title } } }), at, toks: [<token>…], orphan? }
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
