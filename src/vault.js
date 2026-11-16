// Tab Lock — capture and restore windows/tabs/tab groups. `api` is `chrome` (or a test
// fake with the same shape). Nothing here touches storage or crypto.

const GROUP_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

/**
 * Snapshot every normal window of the given kind (incognito or not).
 * `isOwnUrl(url)` filters out Tab Lock's own pages; optional `include(tab)` keeps only
 * matching tabs (sites mode).
 */
export async function captureWindows(api, { incognito, isOwnUrl, include = () => true }) {
  const wins = await api.windows.getAll({ populate: true, windowTypes: ['normal'] });
  const out = [];
  for (const w of wins) {
    if (!!w.incognito !== !!incognito) continue;
    const tabs = (w.tabs || [])
      .filter((t) => !isOwnUrl(t.pendingUrl || t.url || '') && include(t))
      .sort((a, b) => a.index - b.index);
    if (tabs.length === 0) continue;
    const groups = {};
    for (const gid of new Set(tabs.map((t) => t.groupId).filter((g) => Number.isInteger(g) && g >= 0))) {
      try {
        const g = await api.tabGroups.get(gid);
        groups[String(gid)] = { title: g.title || '', color: g.color, collapsed: !!g.collapsed };
      } catch {
        // group vanished between query and get — tabs restore ungrouped
      }
    }
    out.push({
      incognito: !!w.incognito,
      state: w.state,
      bounds: { left: w.left, top: w.top, width: w.width, height: w.height },
      focused: !!w.focused,
      groups,
      tabs: tabs.map((t) => ({
        url: t.pendingUrl || t.url || '',
        title: t.title || '',
        pinned: !!t.pinned,
        active: !!t.active,
        group: Number.isInteger(t.groupId) && t.groupId >= 0 && groups[String(t.groupId)] ? String(t.groupId) : null,
      })),
    });
  }
  return out;
}

/** Count of tabs in a snapshot (for UI). */
export function tabCount(windows) {
  return (windows || []).reduce((n, w) => n + (w.tabs?.length || 0), 0);
}

/** URLs we never try to reopen (they can't be opened by an extension or are empty). */
export function restorableUrl(url) {
  if (typeof url !== 'string' || url === '' || url === 'about:blank') return undefined; // → new tab page
  if (/^(javascript|data):/i.test(url)) return undefined;
  return url;
}

function windowCreateProps(w) {
  const p = { incognito: !!w.incognito, focused: false };
  if (w.state === 'maximized' || w.state === 'fullscreen') {
    p.state = w.state;
  } else {
    const b = w.bounds || {};
    for (const k of ['left', 'top', 'width', 'height']) if (Number.isInteger(b[k])) p[k] = b[k];
  }
  return p;
}

/**
 * Recreate windows from a snapshot. Throws if a WINDOW can't be created (caller keeps
 * the vault record and offers retry). Individual tabs that fail are reported in
 * `failedTabs` rather than aborting. Returns { windowIds, failedTabs }.
 */
export async function restoreWindows(api, windows) {
  const windowIds = [];
  const failedTabs = [];
  for (const w of windows) {
    if (!w.tabs?.length) continue;
    const [first, ...rest] = w.tabs;
    let win;
    try {
      win = await api.windows.create({ ...windowCreateProps(w), url: restorableUrl(first.url) });
    } catch (e) {
      if (restorableUrl(first.url) === undefined) throw e;
      // first URL refused — open a blank window and report that tab
      win = await api.windows.create(windowCreateProps(w));
      failedTabs.push({ url: first.url, title: first.title });
    }
    windowIds.push(win.id);
    const ids = [win.tabs?.[0]?.id];
    for (const t of rest) {
      try {
        const nt = await api.tabs.create({ windowId: win.id, url: restorableUrl(t.url), active: false });
        ids.push(nt.id);
      } catch {
        ids.push(null);
        failedTabs.push({ url: t.url, title: t.title });
      }
    }
    // pinned state (pinned tabs come first in the original order, so order is preserved)
    for (let i = 0; i < w.tabs.length; i++) {
      if (w.tabs[i].pinned && ids[i] != null) {
        try { await api.tabs.update(ids[i], { pinned: true }); } catch { /* non-fatal */ }
      }
    }
    // tab groups
    const byGroup = new Map();
    w.tabs.forEach((t, i) => {
      if (t.group && ids[i] != null && !t.pinned) {
        if (!byGroup.has(t.group)) byGroup.set(t.group, []);
        byGroup.get(t.group).push(ids[i]);
      }
    });
    for (const [key, tabIds] of byGroup) {
      try {
        const gid = await api.tabs.group({ tabIds, createProperties: { windowId: win.id } });
        const g = w.groups?.[key] || {};
        const upd = { title: typeof g.title === 'string' ? g.title : '', collapsed: !!g.collapsed };
        if (GROUP_COLORS.has(g.color)) upd.color = g.color;
        await api.tabGroups.update(gid, upd);
      } catch { /* grouping is cosmetic — never fail the restore over it */ }
    }
    const activeIdx = w.tabs.findIndex((t) => t.active);
    if (activeIdx >= 0 && ids[activeIdx] != null) {
      try { await api.tabs.update(ids[activeIdx], { active: true }); } catch { /* non-fatal */ }
    }
  }
  return { windowIds, failedTabs };
}
