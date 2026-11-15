// Minimal in-memory fake of the chrome.* APIs Tab Lock uses. Test-only.

function area(name, log) {
  let data = {};
  const pick = (keys) => {
    if (keys == null) return structuredClone(data);
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out = {};
    for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
    return out;
  };
  return {
    async get(keys) { return pick(keys); },
    async set(obj) { log.push({ area: name, op: 'set', json: JSON.stringify(obj) }); Object.assign(data, structuredClone(obj)); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
    _dump() { return structuredClone(data); },
    _replace(d) { data = structuredClone(d); },
  };
}

export function createFakeChrome({ incognitoAllowed = true } = {}) {
  const writes = [];
  let nextWin = 1;
  let nextTab = 100;
  let nextGroup = 500;
  const wins = new Map();
  const tabs = new Map();
  const groups = new Map();
  const failUrls = new Set();
  let failWindowCreate = 0;
  let managed = {};

  const winTabs = (wid) => [...tabs.values()].filter((t) => t.windowId === wid).sort((a, b) => a.index - b.index);
  const reindex = (wid) => winTabs(wid).forEach((t, i) => { t.index = i; });
  const snapshotTab = (t) => ({ ...t });
  const snapshotWin = (w, populate) => ({ ...w, tabs: populate ? winTabs(w.id).map(snapshotTab) : undefined });

  function makeTab(windowId, url, extra = {}) {
    if (url && failUrls.has(url)) throw new Error(`cannot open ${url}`);
    const w = wins.get(windowId);
    const t = {
      id: nextTab++, windowId, index: winTabs(windowId).length, url: url || 'chrome://newtab/', title: extra.title || url || 'New Tab',
      pinned: false, active: false, groupId: -1, incognito: w.incognito, ...extra,
    };
    tabs.set(t.id, t);
    return t;
  }

  const api = {
    runtime: { id: 'testid', getURL: (p) => `chrome-extension://testid/${p}` },
    extension: { isAllowedIncognitoAccess: async () => incognitoAllowed },
    storage: {
      local: area('local', writes),
      session: area('session', writes),
      managed: { async get(k) { return k in managed ? { [k]: structuredClone(managed[k]) } : {}; } },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      async getAll({ populate } = {}) { return [...wins.values()].map((w) => snapshotWin(w, populate)); },
      async get(id, { populate } = {}) { const w = wins.get(id); if (!w) throw new Error('no window'); return snapshotWin(w, populate); },
      async getLastFocused() { const w = [...wins.values()].find((x) => x.focused) || [...wins.values()][0]; if (!w) throw new Error('none'); return snapshotWin(w); },
      async create(props = {}) {
        if (failWindowCreate > 0) { failWindowCreate--; throw new Error('window create failed'); }
        if (props.incognito && !incognitoAllowed) throw new Error('incognito not allowed');
        if (props.url && failUrls.has(props.url)) throw new Error(`cannot open ${props.url}`);
        const w = { id: nextWin++, incognito: !!props.incognito, state: props.state || 'normal', focused: !!props.focused,
          left: props.left ?? 0, top: props.top ?? 0, width: props.width ?? 1200, height: props.height ?? 800, type: 'normal' };
        wins.set(w.id, w);
        makeTab(w.id, props.url, { active: true });
        return snapshotWin(w, true);
      },
      async update(id, props) { const w = wins.get(id); if (!w) throw new Error('no window'); Object.assign(w, props); return snapshotWin(w); },
      async remove(id) { if (!wins.has(id)) throw new Error('no window'); for (const t of winTabs(id)) tabs.delete(t.id); wins.delete(id); },
    },
    tabs: {
      async create({ windowId, url, active } = {}) {
        const wid = windowId ?? [...wins.keys()][0];
        if (!wins.has(wid)) throw new Error('no window');
        return snapshotTab(makeTab(wid, url, { active: !!active }));
      },
      async get(id) { const t = tabs.get(id); if (!t) throw new Error('no tab'); return snapshotTab(t); },
      async query() { return [...tabs.values()].map(snapshotTab); },
      async update(id, props) {
        const t = tabs.get(id); if (!t) throw new Error('no tab');
        if (props.url !== undefined) t.url = props.url;
        if (props.pinned !== undefined) t.pinned = props.pinned;
        if (props.active) { for (const o of winTabs(t.windowId)) o.active = false; t.active = true; }
        return snapshotTab(t);
      },
      async remove(ids) {
        for (const id of [].concat(ids)) {
          const t = tabs.get(id); if (!t) continue;
          tabs.delete(id);
          if (winTabs(t.windowId).length === 0) wins.delete(t.windowId); else reindex(t.windowId);
        }
      },
      async group({ tabIds, createProperties }) {
        const gid = nextGroup++;
        groups.set(gid, { id: gid, windowId: createProperties.windowId, title: '', color: 'grey', collapsed: false });
        for (const id of tabIds) tabs.get(id).groupId = gid;
        return gid;
      },
    },
    tabGroups: {
      async get(gid) { const g = groups.get(gid); if (!g) throw new Error('no group'); return { ...g }; },
      async update(gid, props) { Object.assign(groups.get(gid), props); return { ...groups.get(gid) }; },
    },
    idle: { interval: 60, setDetectionInterval(n) { if (n < 15) throw new TypeError('Value must be at least 15.'); this.interval = n; } },
    alarms: { _a: new Map(), async get(n) { return this._a.get(n); }, async create(n, info) { this._a.set(n, { name: n, ...info }); } },
    action: { badge: '', async setBadgeText({ text }) { this.badge = text; }, async setBadgeBackgroundColor() {} },
  };

  const fake = {
    api,
    writes,
    wins,
    tabs,
    groups,
    /** Open a window with given tab specs [{url,title,pinned,group:'a'}], optional groups {a:{title,color}}. */
    openWindow(specs, { incognito = false, groupDefs = {}, focused = false } = {}) {
      const w = { id: nextWin++, incognito, state: 'normal', focused, left: 10, top: 20, width: 1000, height: 700, type: 'normal' };
      wins.set(w.id, w);
      const gidFor = {};
      for (const [k, g] of Object.entries(groupDefs)) {
        const gid = nextGroup++;
        groups.set(gid, { id: gid, windowId: w.id, title: g.title, color: g.color, collapsed: !!g.collapsed });
        gidFor[k] = gid;
      }
      specs.forEach((s, i) => makeTab(w.id, s.url, { title: s.title || s.url, pinned: !!s.pinned, active: i === 0, groupId: s.group ? gidFor[s.group] : -1 }));
      return w.id;
    },
    setManaged(v) { managed = v; },
    failUrl(u) { failUrls.add(u); },
    failNextWindowCreates(n) { failWindowCreate = n; },
    allTabs() { return [...tabs.values()].map(snapshotTab); },
    sender: (page = 'src/pages/lock.html') => ({ id: 'testid', url: `chrome-extension://testid/${page}` }),
  };
  return fake;
}
