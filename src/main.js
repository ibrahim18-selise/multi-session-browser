'use strict';

const {
  app, BrowserWindow, BrowserView, WebContentsView, ipcMain, session, Menu, dialog, clipboard, screen,
  nativeImage, nativeTheme, safeStorage, systemPreferences
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const COLORS = ['#2563EB', '#0E8A7E', '#3F8A2A', '#B7791F', '#D23B3B', '#B23A82', '#6D4AD8', '#56657A'];
const HOME_URL = 'https://www.google.com';
const NEWTAB = 'msb:newtab';
const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' }
};
const THEMES = ['system', 'arctic', 'ocean', 'minimal', 'galaxy'];
const AI_SITES = {
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' }
};
const DEFAULT_SETTINGS = { searchEngine: 'google', theme: 'system', bookmarksBar: true, offerPasswords: true, aiProvider: 'claude' };
const isMac = process.platform === 'darwin';

// Electron 30+ has WebContentsView. The Windows 7 build runs on Electron 22,
// which only has BrowserView, so all view handling goes through these helpers.
const modernViews = parseInt(process.versions.electron, 10) >= 30 && typeof WebContentsView === 'function';
const HIDDEN = { x: 0, y: 0, width: 0, height: 0 };

function makeView(webPreferences) {
  return modernViews ? new WebContentsView({ webPreferences }) : new BrowserView({ webPreferences });
}

function attachView(view) {
  if (modernViews) win.contentView.addChildView(view); else win.addBrowserView(view);
}

function detachView(view) {
  if (modernViews) win.contentView.removeChildView(view); else win.removeBrowserView(view);
}

function showView(view, bounds) {
  if (modernViews) {
    view.setVisible(!!bounds);
    if (bounds) view.setBounds(bounds);
  } else {
    view.setBounds(bounds || HIDDEN);
  }
}

function destroyContents(wc) {
  if (typeof wc.close === 'function') wc.close();
  else if (typeof wc.destroy === 'function') wc.destroy();
}

let win = null;
let chromeHeight = 97;
let overlay = false;
let panelWidth = 0;
const views = new Map();   // tabId -> WebContentsView
const live = new Map();    // tabId -> { title, favicon, loading, canGoBack, canGoForward }
const loaded = new Set();  // tabIds whose page has been requested
const hardened = new WeakSet();
const permissionDecisions = new Map();

let state = { tabs: [], activeId: null, workspaces: [], bounds: null, bookmarks: [], folders: [], lastFolder: null, settings: Object.assign({}, DEFAULT_SETTINGS) };

/* ---------- helpers ---------- */

const uid = () => crypto.randomUUID();
const statePath = () => path.join(app.getPath('userData'), 'state.json');
const getTab = (id) => state.tabs.find((t) => t.id === id) || null;
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
const validColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const partitionOf = (sessionId) => 'persist:' + sessionId;

function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s || s === NEWTAB) return NEWTAB;
  if (/^(https?|file|about):/i.test(s)) return s;
  if (/^localhost(:\d+)?([/?#]|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^/]+\.[a-z][a-z0-9-]*(:\d+)?([/?#]|$)/i.test(s)) return 'https://' + s;
  return searchUrl(s);
}

function httpOnly(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : HOME_URL;
  } catch { return HOME_URL; }
}

function shareableUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return HOME_URL;
    return u.origin + u.pathname;
  } catch { return HOME_URL; }
}

function nav(wc) {
  const h = wc.navigationHistory;
  return {
    canBack: () => (h ? h.canGoBack() : wc.canGoBack()),
    canForward: () => (h ? h.canGoForward() : wc.canGoForward()),
    back: () => (h ? h.goBack() : wc.goBack()),
    forward: () => (h ? h.goForward() : wc.goForward())
  };
}

function toast(message) {
  if (win && !win.isDestroyed()) win.webContents.send('toast', message);
}

function ui(action, arg) {
  if (!win || win.isDestroyed()) return;
  win.webContents.focus();
  win.webContents.send('ui', action, arg);
}

/* ---------- persistence ---------- */

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    state.tabs = (Array.isArray(raw.tabs) ? raw.tabs : [])
      .filter((t) => t && typeof t.id === 'string' && typeof t.sessionId === 'string')
      .map((t) => ({
        id: t.id, sessionId: t.sessionId, name: cleanName(t.name) || 'Session',
        color: validColor(t.color) ? t.color : COLORS[0], url: t.url || HOME_URL
      }));
    state.activeId = typeof raw.activeId === 'string' ? raw.activeId : null;
    state.workspaces = Array.isArray(raw.workspaces) ? raw.workspaces : [];
    state.bounds = raw.bounds || null;
    state.bookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : [])
      .filter((b) => b && typeof b.url === 'string' && /^https?:/i.test(b.url))
      .map((b) => ({
        id: typeof b.id === 'string' ? b.id : uid(), url: b.url, title: String(b.title || b.url).slice(0, 300),
        favicon: typeof b.favicon === 'string' ? b.favicon : null, created: Number(b.created) || Date.now(),
        folderId: typeof b.folderId === 'string' ? b.folderId : null
      }));
    state.folders = (Array.isArray(raw.folders) ? raw.folders : [])
      .filter((f) => f && typeof f.id === 'string')
      .map((f) => ({ id: f.id, name: cleanFolderName(f.name), created: Number(f.created) || Date.now() }));
    const folderIds = new Set(state.folders.map((f) => f.id));
    state.bookmarks.forEach((b) => { if (b.folderId && !folderIds.has(b.folderId)) b.folderId = null; });
    state.lastFolder = folderIds.has(raw.lastFolder) ? raw.lastFolder : null;
    state.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings && typeof raw.settings === 'object' ? raw.settings : {});
    if (!SEARCH_ENGINES[state.settings.searchEngine]) state.settings.searchEngine = 'google';
    if (THEMES.indexOf(state.settings.theme) < 0) state.settings.theme = 'system';
    if (!AI_SITES[state.settings.aiProvider]) state.settings.aiProvider = 'claude';
  } catch { /* first run or unreadable file: start fresh */ }
}

let saveTimer = null;
function saveState(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    const data = {
      tabs: state.tabs.map(({ id, sessionId, name, color, url }) => ({ id, sessionId, name, color, url })),
      activeId: state.activeId,
      workspaces: state.workspaces,
      bounds: state.bounds,
      bookmarks: state.bookmarks,
      folders: state.folders,
      lastFolder: state.lastFolder,
      settings: state.settings
    };
    try {
      const tmp = statePath() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, statePath());
    } catch (err) { console.error('Could not save state', err); }
  };
  if (now) write(); else saveTimer = setTimeout(write, 300);
}

function push() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('state', {
    tabs: state.tabs.map((t) => ({ ...t, ...(live.get(t.id) || {}) })),
    activeId: state.activeId,
    workspaces: state.workspaces.map((w) => ({ name: w.name, count: w.tabs.length, savedAt: w.savedAt })),
    colors: COLORS,
    bookmarks: state.bookmarks,
    folders: state.folders,
    settings: state.settings,
    engines: engineNames(),
    auth: authInfo()
  });
}

/* ---------- sessions ---------- */

const PERMISSION_LABELS = {
  media: 'your camera or microphone', geolocation: 'your location', notifications: 'notifications',
  'clipboard-read': 'your clipboard', 'display-capture': 'screen sharing', midi: 'MIDI devices',
  midiSysex: 'MIDI devices', 'idle-detection': 'idle detection', 'window-management': 'window management'
};
const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

function hardenSession(ses, sessionId) {
  if (hardened.has(ses)) return;
  hardened.add(ses);

  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (AUTO_ALLOW.has(permission)) return callback(true);
    if (!PERMISSION_LABELS[permission]) return callback(false);
    let origin = 'This site';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch { /* keep default */ }
    const key = `${sessionId}|${origin}|${permission}`;
    if (permissionDecisions.has(key)) return callback(permissionDecisions.get(key));
    const tab = state.tabs.find((t) => t.sessionId === sessionId);
    const { response, checkboxChecked } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      message: `${origin} wants to use ${PERMISSION_LABELS[permission]}.`,
      detail: tab ? `Asked in the "${tab.name}" session.` : undefined,
      checkboxLabel: 'Remember my choice until the app closes',
      checkboxChecked: true
    });
    const allowed = response === 0;
    if (checkboxChecked) permissionDecisions.set(key, allowed);
    callback(allowed);
  });

  ses.on('will-download', (_e, item) => {
    item.once('done', (_ev, result) => {
      if (result === 'completed') toast(`Downloaded ${item.getFilename()}`);
      else if (result === 'interrupted') toast(`Download stopped: ${item.getFilename()}`);
    });
  });
}

/* ---------- tab views ---------- */

function setLive(id, patch) {
  live.set(id, { ...(live.get(id) || {}), ...patch });
  push();
}

function createView(tab) {
  const ses = session.fromPartition(partitionOf(tab.sessionId));
  hardenSession(ses, tab.sessionId);

  const view = makeView({
    session: ses,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: true,
    preload: path.join(__dirname, 'page-preload.js')
  });
  view.setBackgroundColor('#FFFFFF');
  attachView(view);
  showView(view, null);

  const wc = view.webContents;
  const n = nav(wc);
  const current = () => getTab(tab.id) || tab;

  const onNavigate = () => {
    const t = getTab(tab.id);
    if (!t) return;
    t.url = wc.getURL();
    saveState();
    recordVisit(t.url, wc.getTitle());
    setLive(tab.id, { canGoBack: n.canBack(), canGoForward: n.canForward() });
  };

  wc.on('did-start-loading', () => setLive(tab.id, { loading: true }));
  wc.on('did-stop-loading', () => setLive(tab.id, { loading: false }));
  wc.on('did-navigate', onNavigate);
  wc.on('did-navigate-in-page', onNavigate);
  wc.on('page-title-updated', (_e, title) => { updateTitle(wc.getURL(), title); setLive(tab.id, { title }); });
  wc.on('page-favicon-updated', (_e, icons) => setLive(tab.id, { favicon: (icons && icons[0]) || null }));
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) toast(`Could not open ${url || 'the page'} (${desc})`);
  });
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') toast(`The page in "${current().name}" stopped working. Reload to try again.`);
  });

  wc.setWindowOpenHandler(({ url, disposition }) => {
    const t = current();
    if (disposition === 'new-window') {
      // Real popups (sign-in windows, payment flows) keep the opener's session.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { session: session.fromPartition(partitionOf(t.sessionId)), sandbox: true }
        }
      };
    }
    openTab({ url, sessionId: t.sessionId, name: t.name, color: t.color }, disposition !== 'background-tab');
    return { action: 'deny' };
  });

  wc.on('context-menu', (_e, p) => {
    const t = current();
    const items = [];
    if (p.linkURL) {
      items.push(
        { label: 'Open link in new tab (same sign-in)', click: () => openTab({ url: p.linkURL, sessionId: t.sessionId, name: t.name, color: t.color }, false) },
        { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' }
      );
    }
    if (p.mediaType === 'image') {
      items.push({ label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) }, { type: 'separator' });
    }
    if (p.isEditable) {
      items.push(
        { label: 'Cut', enabled: p.editFlags.canCut, click: () => wc.cut() },
        { label: 'Copy', enabled: p.editFlags.canCopy, click: () => wc.copy() },
        { label: 'Paste', enabled: p.editFlags.canPaste, click: () => wc.paste() },
        { label: 'Select all', click: () => wc.selectAll() },
        { type: 'separator' }
      );
    } else if (p.selectionText) {
      items.push({ label: 'Copy', click: () => wc.copy() }, { type: 'separator' });
    }
    if (p.selectionText && p.selectionText.trim()) {
      const ai = AI_SITES[state.settings.aiProvider] || AI_SITES.claude;
      items.push({ label: 'Ask ' + ai.name + ' about this', click: () => ui('ai-ask', p.selectionText.slice(0, 20000)) }, { type: 'separator' });
    }
    items.push(
      { label: 'Back', enabled: n.canBack(), click: () => n.back() },
      { label: 'Forward', enabled: n.canForward(), click: () => n.forward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      {
        label: 'Inspect element',
        click: () => {
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach', title: `DevTools: ${t.name}` });
          wc.inspectElement(p.x, p.y);
        }
      }
    );
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  return view;
}

function mountTab(tab) {
  views.set(tab.id, createView(tab));
}

function ensureLoaded(id) {
  const tab = getTab(id);
  const view = views.get(id);
  if (!tab || !view || loaded.has(id)) return;
  loaded.add(id);
  if (tab.url === NEWTAB) return;
  view.webContents.loadURL(tab.url || HOME_URL).catch(() => { /* reported via did-fail-load */ });
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  for (const [id, view] of views) {
    const show = id === state.activeId && !overlay && !isNewTab(id);
    showView(view, show ? { x: 0, y: chromeHeight, width: Math.max(0, width - panelWidth), height: Math.max(0, height - chromeHeight) } : null);
  }
  layoutAI();
}

function unmount(id) {
  const view = views.get(id);
  if (view) {
    if (win && !win.isDestroyed()) detachView(view);
    try { destroyContents(view.webContents); } catch { /* already gone */ }
  }
  views.delete(id);
  live.delete(id);
  loaded.delete(id);
}

/* ---------- tab commands ---------- */

function openTab({ url, name, color, sessionId } = {}, activate = true) {
  const tab = {
    id: uid(),
    sessionId: typeof sessionId === 'string' && sessionId ? sessionId : uid(),
    name: cleanName(name) || `Session ${state.tabs.length + 1}`,
    color: validColor(color) ? color : COLORS[state.tabs.length % COLORS.length],
    url: normalizeUrl(url)
  };
  state.tabs.push(tab);
  mountTab(tab);
  if (activate || !state.activeId) {
    state.activeId = tab.id;
    ensureLoaded(tab.id);
  } else {
    ensureLoaded(tab.id);
  }
  layout();
  push();
  saveState();
  if (activate) views.get(tab.id).webContents.focus();
  return tab.id;
}

function activateTab(id) {
  if (!getTab(id)) return;
  state.activeId = id;
  ensureLoaded(id);
  layout();
  push();
  saveState();
  const view = views.get(id);
  if (view && !overlay) view.webContents.focus();
}

function closeTab(id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  unmount(id);
  state.tabs.splice(i, 1);
  if (state.activeId === id) {
    const next = state.tabs[i] || state.tabs[i - 1] || null;
    state.activeId = next ? next.id : null;
    if (next) ensureLoaded(next.id);
  }
  layout();
  push();
  saveState();
}

function closeOthers(id) {
  for (const t of [...state.tabs]) if (t.id !== id) closeTab(t.id);
  activateTab(id);
}

function updateTab(id, patch = {}) {
  const t = getTab(id);
  if (!t) return;
  if (patch.name !== undefined) t.name = cleanName(patch.name) || t.name;
  if (validColor(patch.color)) t.color = patch.color;
  push();
  saveState();
}

function moveTab(id, toIndex) {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from < 0) return;
  let to = Math.max(0, Math.min(state.tabs.length, Number(toIndex) || 0));
  const [tab] = state.tabs.splice(from, 1);
  if (from < to) to -= 1;
  state.tabs.splice(to, 0, tab);
  push();
  saveState();
}

function duplicateTab(id) {
  const t = getTab(id);
  if (!t) return;
  const view = views.get(id);
  const url = isNewTab(id) ? NEWTAB : (view && view.webContents.getURL()) || t.url;
  openTab({ url, name: t.name, color: t.color, sessionId: t.sessionId }, true);
}

function navigate(id, input) {
  const t = getTab(id);
  const view = views.get(id);
  if (!t || !view) return;
  t.url = normalizeUrl(input);
  loaded.add(id);
  layout();
  push();
  if (t.url === NEWTAB) { saveState(); return; }
  view.webContents.loadURL(t.url).catch(() => { /* reported via did-fail-load */ });
  view.webContents.focus();
  saveState();
}

function withActive(fn) {
  const view = views.get(state.activeId);
  if (view) fn(view.webContents);
}

function toggleDevTools(id) {
  const t = getTab(id);
  const view = views.get(id);
  if (!t || !view) return;
  ensureLoaded(id);
  const wc = view.webContents;
  if (wc.isDevToolsOpened()) wc.closeDevTools();
  else wc.openDevTools({ mode: 'detach', title: `DevTools: ${t.name}` });
}

async function clearSession(id) {
  const t = getTab(id);
  if (!t) return;
  const sharing = state.tabs.filter((x) => x.sessionId === t.sessionId);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Clear and reload', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Sign "${t.name}" out of every site?`,
    detail: 'This removes the cookies, site storage and cache for this session.' +
      (sharing.length > 1 ? ` ${sharing.length} tabs share this session and will all reload.` : '')
  });
  if (response !== 0) return;
  const ses = session.fromPartition(partitionOf(t.sessionId));
  await ses.clearStorageData();
  await ses.clearCache();
  for (const x of sharing) if (loaded.has(x.id)) views.get(x.id)?.webContents.reload();
  toast(`Signed "${t.name}" out of every site`);
}

function showTabMenu(id) {
  const t = getTab(id);
  if (!t) return;
  const others = state.tabs.length > 1;
  Menu.buildFromTemplate([
    { label: 'Rename or recolor', click: () => ui('edit-tab', id) },
    { label: 'Duplicate (same sign-in)', click: () => duplicateTab(id) },
    { type: 'separator' },
    { label: 'Developer tools', click: () => toggleDevTools(id) },
    { label: 'Sign out of every site in this session', click: () => clearSession(id) },
    { type: 'separator' },
    { label: 'Close other tabs', enabled: others, click: () => closeOthers(id) },
    { label: 'Close tab', click: () => closeTab(id) }
  ]).popup({ window: win });
}

async function setOverlay(on) {
  overlay = !!on;
  let shot = null;
  if (overlay && loaded.has(state.activeId) && !isNewTab(state.activeId)) {
    const view = views.get(state.activeId);
    try {
      const img = await view.webContents.capturePage();
      const size = img.getSize();
      if (size.width > 0) {
        const small = size.width > 1600 ? img.resize({ width: 1600 }) : img;
        shot = 'data:image/jpeg;base64,' + small.toJPEG(82).toString('base64');
      }
    } catch { /* no snapshot, the dialog still works */ }
  }
  layout();
  if (!overlay) withActive((wc) => wc.focus());
  return shot;
}

/* ---------- workspaces ---------- */

const findWorkspace = (name) =>
  state.workspaces.find((w) => w.name.toLowerCase() === String(name || '').toLowerCase()) || null;

function wsSave(name) {
  const clean = cleanName(name);
  if (!clean) throw new Error('Give the workspace a name.');
  if (!state.tabs.length) throw new Error('Open at least one tab before saving a workspace.');
  const entry = {
    name: clean,
    savedAt: Date.now(),
    activeIndex: Math.max(0, state.tabs.findIndex((t) => t.id === state.activeId)),
    tabs: state.tabs.map(({ sessionId, name: n, color, url }) => ({ sessionId, name: n, color, url }))
  };
  const existing = findWorkspace(clean);
  if (existing) Object.assign(existing, entry); else state.workspaces.push(entry);
  saveState();
  push();
  toast(`Saved "${clean}"`);
  return true;
}

function wsOpen(name) {
  const ws = findWorkspace(name);
  if (!ws) throw new Error('That workspace no longer exists.');
  for (const t of [...state.tabs]) unmount(t.id);
  state.tabs = ws.tabs.map((t) => ({
    id: uid(), sessionId: t.sessionId, name: cleanName(t.name) || 'Session',
    color: validColor(t.color) ? t.color : COLORS[0], url: t.url || HOME_URL
  }));
  for (const t of state.tabs) mountTab(t);
  const active = state.tabs[ws.activeIndex] || state.tabs[0] || null;
  state.activeId = active ? active.id : null;
  if (active) ensureLoaded(active.id);
  layout();
  push();
  saveState();
  return true;
}

function wsDelete(name) {
  state.workspaces = state.workspaces.filter((w) => w.name.toLowerCase() !== String(name).toLowerCase());
  saveState();
  push();
  return true;
}

async function wsExport(name) {
  const ws = findWorkspace(name);
  if (!ws) throw new Error('That workspace no longer exists.');
  const safe = ws.name.replace(/[^\w\- ]+/g, '').trim() || 'workspace';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export workspace',
    defaultPath: path.join(app.getPath('documents'), `${safe}.msb.json`),
    filters: [{ name: 'Multi-Session Browser workspace', extensions: ['json'] }]
  });
  if (canceled || !filePath) return false;
  // Sessions are renumbered so tabs that share a sign-in stay grouped
  // without exposing local storage ids. Query strings are dropped because
  // they often carry tokens.
  const keys = new Map();
  const tabs = ws.tabs.map((t) => {
    if (!keys.has(t.sessionId)) keys.set(t.sessionId, `s${keys.size + 1}`);
    return { name: t.name, color: t.color, url: shareableUrl(t.url), session: keys.get(t.sessionId) };
  });
  const file = { format: 'multi-session-browser/workspace', version: 1, name: ws.name, activeIndex: ws.activeIndex || 0, tabs };
  fs.writeFileSync(filePath, JSON.stringify(file, null, 2));
  toast(`Exported "${ws.name}"`);
  return true;
}

async function wsImport() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import workspace',
    properties: ['openFile'],
    filters: [{ name: 'Multi-Session Browser workspace', extensions: ['json'] }]
  });
  if (canceled || !filePaths || !filePaths[0]) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); } catch {
    throw new Error('That file could not be read as a workspace.');
  }
  if (!data || data.format !== 'multi-session-browser/workspace' || !Array.isArray(data.tabs) || !data.tabs.length) {
    throw new Error('That file is not a Multi-Session Browser workspace.');
  }
  const groups = new Map();
  const tabs = data.tabs.slice(0, 50).map((t) => {
    const key = String((t && t.session) || uid());
    if (!groups.has(key)) groups.set(key, uid());
    return {
      sessionId: groups.get(key),
      name: cleanName(t && t.name) || 'Session',
      color: validColor(t && t.color) ? t.color : COLORS[0],
      url: httpOnly(t && t.url)
    };
  });
  const base = cleanName(data.name) || 'Imported workspace';
  let name = base;
  for (let n = 2; findWorkspace(name); n++) name = `${base} (${n})`;
  state.workspaces.push({ name, savedAt: Date.now(), activeIndex: Number(data.activeIndex) || 0, tabs });
  saveState();
  push();
  toast(`Imported "${name}". Open it to sign in to each session.`);
  return name;
}

/* ---------- settings, search and the new tab page ---------- */

const isNewTab = (id) => { const t = getTab(id); return !!t && t.url === NEWTAB; };
const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url || ''); } };
const originOf = (url) => { try { return new URL(url).origin; } catch { return ''; } };
const bare = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

function searchUrl(q) {
  return (SEARCH_ENGINES[state.settings.searchEngine] || SEARCH_ENGINES.google).url + encodeURIComponent(q);
}

function engineNames() {
  const out = {};
  for (const k of Object.keys(SEARCH_ENGINES)) out[k] = SEARCH_ENGINES[k].name;
  return out;
}

function applyTheme() {
  const t = state.settings.theme;
  nativeTheme.themeSource = t === 'system' ? 'system' : (t === 'ocean' || t === 'galaxy' ? 'dark' : 'light');
}

function setSetting(key, value) {
  const s = state.settings;
  if (key === 'searchEngine' && SEARCH_ENGINES[value]) s.searchEngine = value;
  else if (key === 'theme' && THEMES.indexOf(value) >= 0) { s.theme = value; applyTheme(); }
  else if (key === 'bookmarksBar' || key === 'offerPasswords') s[key] = !!value;
  else if (key === 'aiProvider' && AI_SITES[value]) s.aiProvider = value;
  else return false;
  saveState();
  push();
  buildMenu();
  return true;
}

function writeJson(file, data) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch (err) { console.error('Could not save ' + file, err); }
}

/* ---------- history and suggestions ---------- */

let history = new Map(); // url -> { url, title, visits, last }
let historyTimer = null;
const historyPath = () => path.join(app.getPath('userData'), 'history.json');

function loadHistory() {
  try {
    const arr = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
    if (!Array.isArray(arr)) return;
    for (const h of arr) {
      if (h && typeof h.url === 'string') {
        history.set(h.url, { url: h.url, title: String(h.title || ''), visits: Number(h.visits) || 1, last: Number(h.last) || 0 });
      }
    }
  } catch { /* no history yet */ }
}

function saveHistory() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(flushHistory, 1000);
}

function flushHistory() {
  clearTimeout(historyTimer);
  writeJson(historyPath(), Array.from(history.values()));
}

function recordVisit(url, title) {
  if (!/^https?:/i.test(url)) return;
  const h = history.get(url);
  if (h) {
    h.visits += 1;
    h.last = Date.now();
    if (title) h.title = title;
  } else {
    history.set(url, { url, title: title || '', visits: 1, last: Date.now() });
  }
  if (history.size > 4000) {
    const keep = Array.from(history.values()).sort((a, b) => b.last - a.last).slice(0, 3000);
    history = new Map(keep.map((x) => [x.url, x]));
  }
  saveHistory();
}

function updateTitle(url, title) {
  const h = history.get(url);
  if (h && title && h.title !== title) { h.title = title; saveHistory(); }
}

function suggest(input) {
  const q = String(input || '').trim().toLowerCase();
  if (!q) return { items: [], inline: null };
  const words = q.split(/\s+/).filter(Boolean);
  const now = Date.now();
  const scored = new Map();
  const consider = (url, title, base, kind) => {
    const b = bare(url).toLowerCase();
    const t = String(title || '').toLowerCase();
    let score;
    if (b.startsWith(q)) score = 120;
    else if (b.split('/')[0].indexOf(q) >= 0) score = 70;
    else if (words.every((w) => b.indexOf(w) >= 0 || t.indexOf(w) >= 0)) score = 40;
    else return;
    score += base;
    const prev = scored.get(url);
    if (!prev || prev.score < score) scored.set(url, { url, title: title || bare(url), kind, score });
  };
  for (const bm of state.bookmarks) consider(bm.url, bm.title, 35, 'bookmark');
  for (const h of history.values()) {
    const days = (now - h.last) / 86400000;
    consider(h.url, h.title, Math.min(h.visits, 30) * 2 + Math.max(0, 20 - days), 'history');
  }
  const items = Array.from(scored.values()).sort((a, b) => b.score - a.score).slice(0, 6);
  let inline = null;
  if (!/\s/.test(q)) {
    for (const it of items) {
      const b = bare(it.url);
      const host = b.split('/')[0];
      if (host.toLowerCase().startsWith(q)) { inline = { text: host, url: originOf(it.url) + '/', title: it.title }; break; }
      if (b.toLowerCase().startsWith(q)) { inline = { text: b, url: it.url, title: it.title }; break; }
    }
  }
  return { items: items.map((i) => ({ url: i.url, title: i.title, kind: i.kind })), inline };
}

function topSites() {
  const byHost = new Map();
  for (const h of history.values()) {
    let u;
    try { u = new URL(h.url); } catch { continue; }
    const e = byHost.get(u.host) || { host: u.host, origin: u.origin, title: '', visits: 0, best: 0 };
    e.visits += h.visits;
    if (h.visits > e.best) { e.best = h.visits; e.title = h.title; }
    byHost.set(u.host, e);
  }
  return Array.from(byHost.values())
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8)
    .map((e) => ({ url: e.origin + '/', host: e.host.replace(/^www\./, ''), title: e.title }));
}

function historyList(query) {
  const q = String(query || '').trim().toLowerCase();
  let arr = Array.from(history.values());
  if (q) arr = arr.filter((x) => (x.url + ' ' + x.title).toLowerCase().indexOf(q) >= 0);
  arr.sort((a, b) => b.last - a.last);
  return arr.slice(0, 300);
}

function deleteHistory(url) {
  history.delete(url);
  saveHistory();
  return true;
}

async function clearHistory() {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Clear history', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Clear your browsing history?',
    detail: 'Address bar suggestions and Most visited start over. Bookmarks, sign-ins and saved passwords stay.'
  });
  if (response !== 0) return false;
  history.clear();
  flushHistory();
  toast('History cleared');
  if (win && !win.isDestroyed()) win.webContents.send('ui', 'history-cleared');
  return true;
}

/* ---------- bookmarks ---------- */

function toggleBookmark(id) {
  // Bookmarks the page, or opens the existing bookmark for editing.
  const t = getTab(id);
  const v = views.get(id);
  if (!t || !v || isNewTab(id)) return null;
  const url = v.webContents.getURL() || t.url;
  if (!/^https?:/i.test(url)) { toast('Only web pages can be bookmarked'); return null; }
  let b = state.bookmarks.find((x) => x.url === url);
  const added = !b;
  if (!b) {
    b = {
      id: uid(), url, title: v.webContents.getTitle() || bare(url),
      favicon: (live.get(id) || {}).favicon || null, created: Date.now(),
      folderId: state.folders.some((f) => f.id === state.lastFolder) ? state.lastFolder : null
    };
    state.bookmarks.unshift(b);
    push();
    saveState();
  }
  ui('edit-bookmark', { id: b.id, added });
  return { id: b.id, added };
}

function removeBookmark(bid) {
  state.bookmarks = state.bookmarks.filter((b) => b.id !== bid);
  push();
  saveState();
  return true;
}

function renameBookmark(bid, title) {
  const b = state.bookmarks.find((x) => x.id === bid);
  const clean = String(title || '').trim().slice(0, 300);
  if (!b || !clean) return false;
  b.title = clean;
  push();
  saveState();
  return true;
}

function moveBookmark(bid, toIndex) {
  const from = state.bookmarks.findIndex((b) => b.id === bid);
  if (from < 0) return false;
  let to = Math.max(0, Math.min(state.bookmarks.length, Number(toIndex) || 0));
  const [b] = state.bookmarks.splice(from, 1);
  if (from < to) to -= 1;
  state.bookmarks.splice(to, 0, b);
  push();
  saveState();
  return true;
}

function openUrl(url, where) {
  const t = getTab(state.activeId);
  if (where === 'new' || !t) {
    return openTab(t ? { url, sessionId: t.sessionId, name: t.name, color: t.color } : { url }, true);
  }
  navigate(t.id, url);
  return t.id;
}

const menuLabel = (text) => {
  let t = String(text || '');
  if (t.length > 60) t = t.slice(0, 57) + '...';
  return isMac ? t : t.replace(/&/g, '&&');
};

function cleanFolderName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New folder';
}

function updateBookmark(bid, patch) {
  const b = state.bookmarks.find((x) => x.id === bid);
  if (!b) return false;
  if (patch && patch.title !== undefined) {
    const t = String(patch.title || '').trim().slice(0, 300);
    if (t) b.title = t;
  }
  if (patch && patch.folderId !== undefined) {
    const fid = patch.folderId && state.folders.some((f) => f.id === patch.folderId) ? patch.folderId : null;
    b.folderId = fid;
    state.lastFolder = fid;
  }
  push();
  saveState();
  return true;
}

function createFolder(name) {
  const f = { id: uid(), name: cleanFolderName(name), created: Date.now() };
  state.folders.push(f);
  push();
  saveState();
  return f.id;
}

function renameFolder(fid, name) {
  const f = state.folders.find((x) => x.id === fid);
  if (!f || !String(name || '').trim()) return false;
  f.name = cleanFolderName(name);
  push();
  saveState();
  return true;
}

function moveFolder(fid, toIndex) {
  const from = state.folders.findIndex((f) => f.id === fid);
  if (from < 0) return false;
  let to = Math.max(0, Math.min(state.folders.length, Number(toIndex) || 0));
  const [f] = state.folders.splice(from, 1);
  if (from < to) to -= 1;
  state.folders.splice(to, 0, f);
  push();
  saveState();
  return true;
}

async function deleteFolder(fid) {
  const f = state.folders.find((x) => x.id === fid);
  if (!f) return false;
  const inside = state.bookmarks.filter((b) => b.folderId === fid);
  let keep = true;
  if (inside.length) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Keep the bookmarks', 'Delete them too', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Delete the folder "' + f.name + '"?',
      detail: 'It holds ' + inside.length + ' bookmark' + (inside.length === 1 ? '' : 's') + '. "Keep the bookmarks" moves them to the bookmarks bar.'
    });
    if (response === 2) return false;
    keep = response === 0;
  }
  state.folders = state.folders.filter((x) => x !== f);
  if (keep) inside.forEach((b) => { b.folderId = null; });
  else state.bookmarks = state.bookmarks.filter((b) => b.folderId !== fid);
  if (state.lastFolder === fid) state.lastFolder = null;
  push();
  saveState();
  toast('Folder deleted');
  return true;
}

function openFolder(fid) {
  const items = state.bookmarks.filter((b) => b.folderId === fid).slice(0, 20);
  const t = getTab(state.activeId);
  items.forEach((b, i) => openTab(t ? { url: b.url, sessionId: t.sessionId, name: t.name, color: t.color } : { url: b.url }, i === 0));
  return items.length;
}

function folderMenu(fid, x, y) {
  const f = state.folders.find((z) => z.id === fid);
  if (!f) return;
  const items = state.bookmarks.filter((b) => b.folderId === fid);
  const template = items.length
    ? items.slice(0, 80).map((b) => ({ label: menuLabel(b.title || bare(b.url)), click: () => openUrl(b.url, 'current') }))
    : [{ label: 'This folder is empty', enabled: false }];
  template.push(
    { type: 'separator' },
    { label: 'Open all in new tabs (same sign-in)', enabled: items.length > 0, click: () => openFolder(fid) },
    { label: 'Rename folder', click: () => ui('rename-folder', fid) },
    { label: 'Delete folder', click: () => deleteFolder(fid) }
  );
  const opts = { window: win };
  if (Number.isFinite(x) && Number.isFinite(y)) { opts.x = Math.round(x); opts.y = Math.round(y); }
  Menu.buildFromTemplate(template).popup(opts);
}

function bookmarkMenu(bid) {
  const b = state.bookmarks.find((x) => x.id === bid);
  if (!b) return;
  const moveTo = [{ label: 'Bookmarks bar', type: 'radio', checked: !b.folderId, click: () => updateBookmark(bid, { folderId: null }) }]
    .concat(state.folders.map((f) => ({ label: menuLabel(f.name), type: 'radio', checked: b.folderId === f.id, click: () => updateBookmark(bid, { folderId: f.id }) })))
    .concat([{ type: 'separator' }, { label: 'New folder', click: () => ui('new-folder', bid) }]);
  Menu.buildFromTemplate([
    { label: 'Open', click: () => openUrl(b.url, 'current') },
    { label: 'Open in new tab (same sign-in)', click: () => openUrl(b.url, 'new') },
    { label: 'Open in new tab with a new sign-in', click: () => openTab({ url: b.url }, true) },
    { type: 'separator' },
    { label: 'Edit', click: () => ui('edit-bookmark', { id: bid, added: false }) },
    { label: 'Move to folder', submenu: moveTo },
    { label: 'Copy address', click: () => clipboard.writeText(b.url) },
    { label: 'Delete', click: () => removeBookmark(bid) }
  ]).popup({ window: win });
}

/* ---------- clipboard: notes and screenshots ---------- */

let clips = [];
const thumbs = new Map();
const clipsDir = () => path.join(app.getPath('userData'), 'clips');
const clipsIndex = () => path.join(clipsDir(), 'index.json');

function loadClips() {
  try {
    const arr = JSON.parse(fs.readFileSync(clipsIndex(), 'utf8'));
    if (Array.isArray(arr)) clips = arr.filter((c) => c && c.id && (c.type === 'note' || c.type === 'image'));
  } catch { /* no clips yet */ }
}

function saveClips() {
  try { fs.mkdirSync(clipsDir(), { recursive: true }); } catch { /* exists */ }
  writeJson(clipsIndex(), clips);
}

function currentSource() {
  const t = getTab(state.activeId);
  if (!t || isNewTab(t.id)) return null;
  const v = views.get(t.id);
  return { url: v ? v.webContents.getURL() : t.url, title: v ? v.webContents.getTitle() : '', tab: t.name };
}

function clipView(c) {
  const out = { id: c.id, type: c.type, text: c.text || '', created: c.created, source: c.source || null };
  if (c.type === 'image') {
    if (!thumbs.has(c.id)) {
      try {
        const img = nativeImage.createFromPath(path.join(clipsDir(), c.file));
        const size = img.getSize();
        const small = size.width > 640 ? img.resize({ width: 640 }) : img;
        thumbs.set(c.id, 'data:image/jpeg;base64,' + small.toJPEG(80).toString('base64'));
      } catch { thumbs.set(c.id, null); }
    }
    out.thumb = thumbs.get(c.id);
  }
  return out;
}

function listClips() { return clips.map(clipView); }

function findClip(id) {
  const c = clips.find((x) => x.id === id);
  if (!c) throw new Error('That item is no longer in your Clipboard.');
  return c;
}

function trimClips() {
  while (clips.length > 300) {
    const old = clips.pop();
    if (old.type === 'image') { try { fs.unlinkSync(path.join(clipsDir(), old.file)); } catch { /* gone */ } thumbs.delete(old.id); }
  }
}

function addNote(text) {
  const t = String(text || '').slice(0, 20000);
  if (!t.trim()) throw new Error('Write something first.');
  clips.unshift({ id: uid(), type: 'note', text: t, created: Date.now(), source: currentSource() });
  trimClips();
  saveClips();
  return true;
}

function updateNote(id, text) {
  const c = findClip(id);
  const t = String(text || '').slice(0, 20000);
  if (c.type !== 'note' || !t.trim()) return false;
  c.text = t;
  saveClips();
  return true;
}

function addImage(dataUrl, source) {
  const img = nativeImage.createFromDataURL(String(dataUrl || ''));
  if (img.isEmpty()) throw new Error('That image could not be read.');
  fs.mkdirSync(clipsDir(), { recursive: true });
  const id = uid();
  const file = id + '.png';
  fs.writeFileSync(path.join(clipsDir(), file), img.toPNG());
  clips.unshift({ id, type: 'image', file, text: '', created: Date.now(), source: source || currentSource() });
  trimClips();
  saveClips();
  return true;
}

function clipImage(id) {
  const c = findClip(id);
  if (c.type !== 'image') return null;
  return { dataUrl: 'data:image/png;base64,' + fs.readFileSync(path.join(clipsDir(), c.file)).toString('base64'), source: c.source };
}

function copyClip(id) {
  const c = findClip(id);
  if (c.type === 'note') clipboard.writeText(c.text);
  else clipboard.writeImage(nativeImage.createFromPath(path.join(clipsDir(), c.file)));
  toast(c.type === 'note' ? 'Note copied' : 'Image copied');
  return true;
}

async function saveClipAs(id) {
  const c = findClip(id);
  const stamp = new Date(c.created || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const isNote = c.type === 'note';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: isNote ? 'Save note' : 'Save screenshot',
    defaultPath: path.join(app.getPath(isNote ? 'documents' : 'pictures'), (isNote ? 'Note ' : 'Screenshot ') + stamp + (isNote ? '.txt' : '.png')),
    filters: isNote ? [{ name: 'Text', extensions: ['txt'] }] : [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (canceled || !filePath) return false;
  if (isNote) fs.writeFileSync(filePath, c.text, 'utf8');
  else fs.copyFileSync(path.join(clipsDir(), c.file), filePath);
  toast('Saved to ' + path.basename(filePath));
  return true;
}

function deleteClip(id) {
  const c = findClip(id);
  if (c.type === 'image') { try { fs.unlinkSync(path.join(clipsDir(), c.file)); } catch { /* gone */ } thumbs.delete(c.id); }
  clips = clips.filter((x) => x !== c);
  saveClips();
  return true;
}

function clipFromSystem() {
  const img = clipboard.readImage();
  if (!img.isEmpty()) { addImage(img.toDataURL(), null); toast('Image added to your Clipboard'); return true; }
  const text = clipboard.readText();
  if (text && text.trim()) { addNote(text); toast('Text added to your Clipboard'); return true; }
  throw new Error('Your computer clipboard is empty.');
}

/* ---------- screenshots ---------- */

async function captureTab(id) {
  const tabId = id || state.activeId;
  const v = views.get(tabId);
  if (!v || isNewTab(tabId) || !loaded.has(tabId)) throw new Error('Open a web page first, then take a screenshot.');
  const img = await v.webContents.capturePage();
  if (img.isEmpty()) throw new Error('The page could not be captured. Try again once it has loaded.');
  return { dataUrl: img.toDataURL(), source: currentSource() };
}

function copyImage(dataUrl) {
  const img = nativeImage.createFromDataURL(String(dataUrl || ''));
  if (img.isEmpty()) throw new Error('That image could not be read.');
  clipboard.writeImage(img);
  toast('Image copied');
  return true;
}

async function saveImageFile(dataUrl) {
  const img = nativeImage.createFromDataURL(String(dataUrl || ''));
  if (img.isEmpty()) throw new Error('That image could not be read.');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save screenshot',
    defaultPath: path.join(app.getPath('pictures'), 'Screenshot ' + stamp + '.png'),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, img.toPNG());
  toast('Saved to ' + path.basename(filePath));
  return true;
}

/* ---------- saved passwords ---------- */
// Passwords are encrypted with the operating system's own key store
// (Keychain on Mac, DPAPI on Windows), so the file only works on this
// computer for this user. Using a saved password needs Touch ID or
// Windows Hello where available, and an app PIN everywhere else.

let vault = { entries: [], never: [], pin: null };
let authCache = 'pin';
let helloAvailable = null;
let pinFails = 0;
let pinLockedUntil = 0;
const pendingOffers = new Map();
const vaultPath = () => path.join(app.getPath('userData'), 'passwords.json');

function loadVault() {
  try {
    const v = JSON.parse(fs.readFileSync(vaultPath(), 'utf8'));
    vault.entries = Array.isArray(v.entries) ? v.entries.filter((e) => e && e.id && e.origin && typeof e.secret === 'string') : [];
    vault.never = Array.isArray(v.never) ? v.never.filter((o) => typeof o === 'string') : [];
    vault.pin = v.pin && v.pin.salt && v.pin.hash ? v.pin : null;
  } catch { /* nothing saved yet */ }
}

function saveVault() { writeJson(vaultPath(), vault); }

function canEncrypt() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}
const encrypt = (s) => safeStorage.encryptString(s).toString('base64');
const decrypt = (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'));

function methodLabel(m) {
  if (m === 'touchid') return 'Touch ID';
  if (m === 'hello') return 'Windows Hello';
  return 'your PIN';
}

function authInfo() {
  return { method: authCache, label: methodLabel(authCache), pinSet: !!vault.pin, available: canEncrypt() };
}

function runHello(mode, reason) {
  return new Promise((resolve) => {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      'try {',
      '  Add-Type -AssemblyName System.Runtime.WindowsRuntime',
      '  $null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]',
      "  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1') } | Select-Object -First 1",
      '  function Wait-Op($op, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$task.Wait(-1); return $task.Result }',
      "  if ($env:MSB_MODE -eq 'check') {",
      '    $r = Wait-Op ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])',
      '  } else {',
      '    $r = Wait-Op ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:MSB_REASON)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])',
      '  }',
      "  Write-Output ('RESULT:' + $r)",
      "} catch { Write-Output ('ERROR:' + $_.Exception.Message) }"
    ].join('\n');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      env: Object.assign({}, process.env, { MSB_MODE: mode, MSB_REASON: reason || 'Multi-Session Browser' }),
      windowsHide: true,
      timeout: 120000
    }, (_err, stdout) => {
      const m = /RESULT:(\w+)/.exec(String(stdout || ''));
      resolve(m ? m[1] : null);
    });
  });
}

async function authMethod() {
  if (process.platform === 'darwin') {
    try { if (systemPreferences.canPromptTouchID()) return 'touchid'; } catch { /* no Touch ID */ }
  }
  if (process.platform === 'win32' && (parseInt(os.release().split('.')[0], 10) || 0) >= 10) {
    if (helloAvailable === null) helloAvailable = (await runHello('check')) === 'Available';
    if (helloAvailable) return 'hello';
  }
  return 'pin';
}

function detectAuth() {
  authMethod().then((m) => { authCache = m; push(); }).catch(() => { /* stay on PIN */ });
}

const hashPin = (pin, salt) => crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), 32).toString('hex');

function checkPin(pin) {
  if (!vault.pin || typeof pin !== 'string' || !pin) return false;
  const a = Buffer.from(hashPin(pin, vault.pin.salt), 'hex');
  const b = Buffer.from(vault.pin.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setPin(pin, oldPin) {
  if (!/^\d{4,12}$/.test(String(pin || ''))) throw new Error('Use 4 to 12 digits.');
  if (vault.pin && !checkPin(oldPin)) throw new Error('Your current PIN is not right.');
  const salt = crypto.randomBytes(16).toString('hex');
  vault.pin = { salt, hash: hashPin(pin, salt) };
  saveVault();
  push();
  toast('PIN saved');
  return true;
}

async function authenticate(reason, pin) {
  const method = await authMethod();
  authCache = method;
  if (method === 'touchid') {
    try { await systemPreferences.promptTouchID(reason); return true; } catch { throw new Error('Touch ID did not confirm it was you.'); }
  }
  if (method === 'hello') {
    if (win && !win.isDestroyed()) win.focus();
    const r = await runHello('verify', 'Multi-Session Browser wants to ' + reason);
    if (r === 'Verified') return true;
    if (r === 'Canceled') throw new Error('Windows Hello was cancelled.');
    if (r === 'RetriesExhausted') throw new Error('Too many tries. Wait a moment and try again.');
    if (r === null || r === 'DeviceNotPresent' || r === 'NotConfiguredForUser' || r === 'DisabledByPolicy') {
      helloAvailable = false;
      authCache = 'pin';
      push();
      throw new Error('Windows Hello is not set up on this PC, so the browser will use a PIN instead. Try again.');
    }
    throw new Error('Windows Hello did not confirm it was you.');
  }
  if (!vault.pin) throw new Error('PIN_SETUP');
  if (Date.now() < pinLockedUntil) throw new Error('Too many wrong PINs. Wait 30 seconds and try again.');
  if (!checkPin(pin)) {
    pinFails += 1;
    if (pinFails >= 5) { pinFails = 0; pinLockedUntil = Date.now() + 30000; }
    throw new Error('That PIN is not right.');
  }
  pinFails = 0;
  return true;
}

function tabIdFor(wc) {
  for (const [id, v] of views) if (v.webContents === wc) return id;
  return null;
}

ipcMain.on('pw:submit', (event, data) => {
  const tabId = tabIdFor(event.sender);
  if (!tabId || !data || !win) return;
  const origin = originOf(event.sender.getURL());
  if (!origin || origin !== data.origin || !/^https?:/.test(origin)) return;
  const password = String(data.password || '');
  const username = String(data.username || '').slice(0, 200);
  if (!password || password.length > 500) return;
  if (!state.settings.offerPasswords || vault.never.indexOf(origin) >= 0 || !canEncrypt()) return;
  const same = vault.entries.find((e) => e.origin === origin && e.username === username);
  if (same) {
    try { if (decrypt(same.secret) === password) { same.used = Date.now(); saveVault(); return; } } catch { /* re-save */ }
  }
  const offerId = uid();
  pendingOffers.set(offerId, { origin, username, password, tabId, at: Date.now() });
  if (pendingOffers.size > 10) pendingOffers.delete(pendingOffers.keys().next().value);
  win.webContents.send('pw-offer', { id: offerId, tabId, origin, host: hostOf(origin), username, update: !!same });
});

ipcMain.on('pw:form', (event) => {
  const tabId = tabIdFor(event.sender);
  if (!tabId || !win) return;
  const origin = originOf(event.sender.getURL());
  const accounts = vault.entries.filter((e) => e.origin === origin).map((e) => ({ id: e.id, username: e.username }));
  if (accounts.length) win.webContents.send('pw-available', { tabId, origin, host: hostOf(origin), accounts });
});

function pwSave(offerId, username) {
  const o = pendingOffers.get(offerId);
  if (!o) throw new Error('That sign-in is no longer available to save. Sign in again to save it.');
  if (!canEncrypt()) throw new Error('This computer cannot encrypt saved passwords.');
  pendingOffers.delete(offerId);
  const user = String(username === undefined || username === null ? o.username : username).trim().slice(0, 200);
  const existing = vault.entries.find((e) => e.origin === o.origin && e.username === user);
  if (existing) { existing.secret = encrypt(o.password); existing.updated = Date.now(); }
  else vault.entries.push({ id: uid(), origin: o.origin, username: user, secret: encrypt(o.password), created: Date.now(), used: 0 });
  saveVault();
  toast('Password saved for ' + hostOf(o.origin));
  return true;
}

function pwNever(offerId) {
  const o = pendingOffers.get(offerId);
  pendingOffers.delete(offerId);
  if (o && vault.never.indexOf(o.origin) < 0) { vault.never.push(o.origin); saveVault(); }
  return true;
}

function pwDismiss(offerId) { pendingOffers.delete(offerId); return true; }

function findEntry(entryId) {
  const e = vault.entries.find((x) => x.id === entryId);
  if (!e) throw new Error('That saved password no longer exists.');
  return e;
}

async function pwFill(tabId, entryId, pin) {
  const v = views.get(tabId);
  const e = findEntry(entryId);
  if (!v) throw new Error('That tab is closed.');
  if (originOf(v.webContents.getURL()) !== e.origin) throw new Error('This tab is no longer on ' + hostOf(e.origin) + '.');
  await authenticate('fill your saved password for ' + hostOf(e.origin), pin);
  v.webContents.send('pw:fill', { origin: e.origin, username: e.username, password: decrypt(e.secret) });
  e.used = Date.now();
  saveVault();
  v.webContents.focus();
  return true;
}

function pwList() {
  return {
    entries: vault.entries
      .map((e) => ({ id: e.id, origin: e.origin, host: hostOf(e.origin), username: e.username, created: e.created, used: e.used || 0 }))
      .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username)),
    never: vault.never.slice().sort()
  };
}

async function pwReveal(entryId, pin) {
  const e = findEntry(entryId);
  await authenticate('show a saved password', pin);
  return decrypt(e.secret);
}

async function pwCopy(entryId, pin) {
  const e = findEntry(entryId);
  await authenticate('copy a saved password', pin);
  const pw = decrypt(e.secret);
  clipboard.writeText(pw);
  setTimeout(() => { if (clipboard.readText() === pw) clipboard.writeText(''); }, 30000);
  toast('Password copied. It is cleared from your clipboard in 30 seconds.');
  return true;
}

function pwDelete(entryId) {
  vault.entries = vault.entries.filter((e) => e.id !== entryId);
  saveVault();
  return true;
}

function pwUnblock(origin) {
  vault.never = vault.never.filter((o) => o !== origin);
  saveVault();
  return true;
}

/* ---------- settings menu ---------- */

function showAbout() {
  dialog.showMessageBox(win, {
    type: 'info',
    buttons: ['OK'],
    message: 'Multi-Session Browser ' + app.getVersion(),
    detail: 'Chromium ' + process.versions.chrome + ', Electron ' + process.versions.electron +
      '\nSaved passwords on this computer are unlocked with ' + methodLabel(authCache) + '.'
  });
}

function showAppMenu() {
  const s = state.settings;
  const id = state.activeId;
  const t = getTab(id);
  const engines = Object.keys(SEARCH_ENGINES).map((k) => ({
    label: SEARCH_ENGINES[k].name, type: 'radio', checked: s.searchEngine === k, click: () => setSetting('searchEngine', k)
  }));
  const themes = [
    ['system', 'Match my computer'], ['arctic', 'Arctic Frost'], ['ocean', 'Ocean Depths (dark)'],
    ['minimal', 'Modern Minimalist'], ['galaxy', 'Midnight Galaxy (dark)']
  ].map((p) => ({ label: p[1], type: 'radio', checked: s.theme === p[0], click: () => setSetting('theme', p[0]) }));
  const template = [];
  if (t) {
    template.push(
      { label: 'Rename or recolor this tab', click: () => ui('edit-tab', id) },
      { label: 'Duplicate tab (same sign-in)', click: () => duplicateTab(id) },
      { label: 'Sign this tab out of every site', click: () => clearSession(id) },
      { type: 'separator' }
    );
  }
  template.push(
    { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => ui('new-tab') },
    { label: 'Workspaces', click: () => ui('workspaces') },
    { type: 'separator' },
    { label: 'Search engine', submenu: engines },
    { label: 'Appearance', submenu: themes },
    { label: 'Show bookmarks bar', type: 'checkbox', checked: !!s.bookmarksBar, click: (item) => setSetting('bookmarksBar', item.checked) },
    { label: 'Offer to save passwords', type: 'checkbox', checked: !!s.offerPasswords, click: (item) => setSetting('offerPasswords', item.checked) },
    { type: 'separator' },
    { label: 'Clear browsing history', click: () => clearHistory() },
    { label: 'About Multi-Session Browser', click: () => showAbout() }
  );
  Menu.buildFromTemplate(template).popup({ window: win });
}

/* ---------- AI side panel ---------- */
// Claude, ChatGPT and Gemini load as their real websites in the side panel.
// Each has its own saved sign-in, separate from the tabs.

const aiViews = new Map();
let aiShown = null;
let aiRect = null;

const FOCUS_COMPOSER = [
  '(function () {',
  "  var picks = ['#prompt-textarea', 'div.ProseMirror[contenteditable=\"true\"]', 'rich-textarea [contenteditable=\"true\"]', '[contenteditable=\"true\"]', 'textarea', '[role=\"textbox\"]'];",
  '  var el = null;',
  '  for (var i = 0; i < picks.length && !el; i++) {',
  '    var list = Array.prototype.slice.call(document.querySelectorAll(picks[i])).filter(function (e) { var r = e.getBoundingClientRect(); return r.width > 40 && r.height > 8; });',
  '    if (list.length) el = list[list.length - 1];',
  '  }',
  '  if (!el) return false;',
  '  el.focus();',
  '  if (el.isContentEditable) { var range = document.createRange(); range.selectNodeContents(el); range.collapse(false); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }',
  '  else if (typeof el.selectionStart === "number") { el.selectionStart = el.selectionEnd = el.value.length; }',
  '  return true;',
  '})()'
].join('\n');

function aiView(key) {
  if (aiViews.has(key)) return aiViews.get(key);
  const site = AI_SITES[key];
  const ses = session.fromPartition('persist:ai-' + key);
  hardenSession(ses, 'ai-' + key);
  const view = makeView({ session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true });
  view.setBackgroundColor('#FFFFFF');
  attachView(view);
  showView(view, null);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window') {
      // Sign-in popups stay in the assistant's own session.
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { session: ses, sandbox: true } } };
    }
    openUrl(url, 'new');
    return { action: 'deny' };
  });
  wc.on('context-menu', (_e, p) => {
    const items = [];
    if (p.linkURL) items.push({ label: 'Open link in new tab', click: () => openUrl(p.linkURL, 'new') }, { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
    if (p.isEditable) {
      items.push(
        { label: 'Cut', enabled: p.editFlags.canCut, click: () => wc.cut() },
        { label: 'Copy', enabled: p.editFlags.canCopy, click: () => wc.copy() },
        { label: 'Paste', enabled: p.editFlags.canPaste, click: () => wc.paste() },
        { type: 'separator' }
      );
    } else if (p.selectionText) {
      items.push({ label: 'Copy', click: () => wc.copy() }, { type: 'separator' });
    }
    items.push({ label: 'Reload', click: () => wc.reload() }, { label: 'Inspect element', click: () => { if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' }); wc.inspectElement(p.x, p.y); } });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) toast(site.name + ' could not load (' + desc + '). Check your connection and reload.');
  });
  wc.loadURL(site.url).catch(() => { /* reported via did-fail-load */ });
  aiViews.set(key, view);
  return view;
}

function layoutAI() {
  for (const [key, view] of aiViews) {
    const show = key === aiShown && !overlay && !!aiRect && !!win && !win.isDestroyed();
    showView(view, show ? aiRect : null);
  }
}

function aiShow(key, rect) {
  if (!AI_SITES[key] || !rect) return false;
  const r = {
    x: Math.max(0, Math.round(Number(rect.x) || 0)), y: Math.max(0, Math.round(Number(rect.y) || 0)),
    width: Math.max(0, Math.round(Number(rect.width) || 0)), height: Math.max(0, Math.round(Number(rect.height) || 0))
  };
  aiShown = key;
  aiRect = r;
  aiView(key);
  layoutAI();
  if (state.settings.aiProvider !== key) { state.settings.aiProvider = key; saveState(); push(); }
  return true;
}

function aiHide() {
  aiShown = null;
  layoutAI();
  return true;
}

function waitLoaded(wc) {
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 15000);
    wc.once('did-stop-loading', done);
  });
}

async function aiInsert(key, text) {
  if (!AI_SITES[key]) return false;
  const value = String(text || '').slice(0, 30000);
  if (!value.trim()) return false;
  const wc = aiView(key).webContents;
  await waitLoaded(wc);
  wc.focus();
  let focused = false;
  try { focused = await wc.executeJavaScript(FOCUS_COMPOSER); } catch { /* page not ready */ }
  if (!focused) {
    clipboard.writeText(value);
    toast('Copied. Click the message box in ' + AI_SITES[key].name + ' and paste.');
    return false;
  }
  wc.insertText(value);
  return true;
}

async function aiSend(key, kind) {
  const t = getTab(state.activeId);
  const v = t && views.get(t.id);
  if (!t || !v || isNewTab(t.id)) throw new Error('Open a web page first.');
  const url = v.webContents.getURL();
  const title = v.webContents.getTitle();
  if (kind === 'selection') {
    let sel = '';
    try { sel = await v.webContents.executeJavaScript('window.getSelection ? String(window.getSelection()) : ""'); } catch { /* blocked page */ }
    sel = String(sel || '').trim().slice(0, 20000);
    if (!sel) throw new Error('Select some text on the page first.');
    return aiInsert(key, sel + '\n(From ' + (title ? title + ', ' : '') + url + ')\n');
  }
  return aiInsert(key, (title ? title + '\n' : '') + url + '\n');
}

async function aiImage(key, dataUrl) {
  if (!AI_SITES[key]) return false;
  const img = nativeImage.createFromDataURL(String(dataUrl || ''));
  if (img.isEmpty()) throw new Error('That image could not be read.');
  const wc = aiView(key).webContents;
  await waitLoaded(wc);
  clipboard.writeImage(img);
  wc.focus();
  let focused = false;
  try { focused = await wc.executeJavaScript(FOCUS_COMPOSER); } catch { /* page not ready */ }
  if (!focused) { toast('Image copied. Click the message box in ' + AI_SITES[key].name + ' and paste.'); return false; }
  wc.paste();
  return true;
}

async function aiSignOut(key) {
  const site = AI_SITES[key];
  if (!site) return false;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Sign out', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Sign out of ' + site.name + ' in the side panel?',
    detail: 'This clears its cookies and storage in this browser. Your tabs are not affected.'
  });
  if (response !== 0) return false;
  const ses = session.fromPartition('persist:ai-' + key);
  await ses.clearStorageData();
  await ses.clearCache();
  if (aiViews.has(key)) aiViews.get(key).webContents.loadURL(site.url).catch(() => {});
  toast('Signed out of ' + site.name);
  return true;
}

function aiMenu(key) {
  const site = AI_SITES[key];
  if (!site) return;
  const view = aiViews.get(key);
  Menu.buildFromTemplate([
    { label: 'Start a new chat', click: () => aiView(key).webContents.loadURL(site.url).catch(() => {}) },
    { label: 'Open in a tab', enabled: !!view, click: () => openUrl(view.webContents.getURL() || site.url, 'new') },
    { label: 'Copy page address', enabled: !!view, click: () => clipboard.writeText(view.webContents.getURL()) },
    { type: 'separator' },
    { label: 'Developer tools for ' + site.name, enabled: !!view, click: () => view.webContents.openDevTools({ mode: 'detach' }) },
    { label: 'Sign out of ' + site.name, click: () => aiSignOut(key) }
  ]).popup({ window: win });
}

/* ---------- IPC ---------- */

const commands = {
  ready: () => push(),
  'chrome-height': (h) => { chromeHeight = Math.max(0, Math.round(Number(h) || 0)); layout(); },
  overlay: setOverlay,
  'open-tab': (opts) => openTab(opts || {}, true),
  activate: activateTab,
  close: closeTab,
  'update-tab': updateTab,
  move: moveTab,
  duplicate: duplicateTab,
  navigate,
  back: (id) => { const v = views.get(id); if (v) nav(v.webContents).back(); },
  forward: (id) => { const v = views.get(id); if (v) nav(v.webContents).forward(); },
  reload: (id) => { const v = views.get(id); if (v) { ensureLoaded(id); v.webContents.reload(); } },
  stop: (id) => views.get(id)?.webContents.stop(),
  devtools: toggleDevTools,
  'clear-session': clearSession,
  'tab-menu': showTabMenu,
  'ws-save': wsSave,
  'ws-open': wsOpen,
  'ws-delete': wsDelete,
  'ws-export': wsExport,
  'ws-import': wsImport,
  'panel-width': (w) => { panelWidth = Math.max(0, Math.min(600, Math.round(Number(w) || 0))); layout(); },
  'app-menu': showAppMenu,
  'open-url': openUrl,
  'set-setting': setSetting,
  suggest,
  'top-sites': topSites,
  'history-list': historyList,
  'history-delete': deleteHistory,
  'history-clear': clearHistory,
  'bm-toggle': toggleBookmark,
  'bm-remove': removeBookmark,
  'bm-rename': renameBookmark,
  'bm-move': moveBookmark,
  'bm-menu': bookmarkMenu,
  'bm-update': updateBookmark,
  'folder-create': createFolder,
  'folder-rename': renameFolder,
  'folder-move': moveFolder,
  'folder-delete': deleteFolder,
  'folder-open': openFolder,
  'folder-menu': folderMenu,
  'clip-list': listClips,
  'clip-note': addNote,
  'clip-update': updateNote,
  'clip-image': clipImage,
  'clip-add-image': addImage,
  'clip-copy': copyClip,
  'clip-save': saveClipAs,
  'clip-delete': deleteClip,
  'clip-from-system': clipFromSystem,
  capture: captureTab,
  'copy-image': copyImage,
  'save-image': saveImageFile,
  'pw-save': pwSave,
  'pw-never': pwNever,
  'pw-dismiss': pwDismiss,
  'pw-fill': pwFill,
  'pw-list': pwList,
  'pw-reveal': pwReveal,
  'pw-copy': pwCopy,
  'pw-delete': pwDelete,
  'pw-unblock': pwUnblock,
  'pin-set': setPin,
  'ai-show': aiShow,
  'ai-hide': aiHide,
  'ai-insert': aiInsert,
  'ai-send': aiSend,
  'ai-image': aiImage,
  'ai-reload': (key) => { const v = aiViews.get(key); if (v) v.webContents.reload(); return true; },
  'ai-menu': aiMenu
};

ipcMain.handle('cmd', async (event, name, ...args) => {
  if (!win || event.sender !== win.webContents) throw new Error('Not allowed');
  const fn = commands[name];
  if (!fn) throw new Error(`Unknown command: ${name}`);
  return fn(...args);
});

/* ---------- menu ---------- */

function cycle(step) {
  if (state.tabs.length < 2) return;
  const i = state.tabs.findIndex((t) => t.id === state.activeId);
  const next = state.tabs[(i + step + state.tabs.length) % state.tabs.length];
  activateTab(next.id);
}

function zoomBy(delta) {
  withActive((wc) => wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta));
}

function buildMenu() {
  const jump = [];
  for (let n = 1; n <= 9; n++) {
    jump.push({
      label: n === 9 ? 'Last tab' : `Tab ${n}`,
      accelerator: `CmdOrCtrl+${n}`,
      click: () => {
        const t = n === 9 ? state.tabs[state.tabs.length - 1] : state.tabs[n - 1];
        if (t) activateTab(t.id);
      }
    });
  }

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => ui('new-tab') },
        { label: 'Duplicate tab (same sign-in)', accelerator: 'CmdOrCtrl+Shift+D', click: () => state.activeId && duplicateTab(state.activeId) },
        { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => state.activeId && closeTab(state.activeId) },
        { type: 'separator' },
        { label: 'Workspaces', accelerator: 'CmdOrCtrl+Shift+S', click: () => ui('workspaces') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Go to address bar', accelerator: 'CmdOrCtrl+L', click: () => ui('focus-address') },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => withActive((wc) => wc.reload()) },
        { label: 'Reload without cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => withActive((wc) => wc.reloadIgnoringCache()) },
        { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => withActive((wc) => nav(wc).back()) },
        { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => withActive((wc) => nav(wc).forward()) },
        { type: 'separator' },
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => zoomBy(0.5) },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => zoomBy(-0.5) },
        { label: 'Actual size', accelerator: 'CmdOrCtrl+0', click: () => zoomBy(0) },
        { type: 'separator' },
        { label: 'Developer tools for this tab', accelerator: isMac ? 'Alt+Cmd+I' : 'F12', click: () => state.activeId && toggleDevTools(state.activeId) },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        { label: 'Bookmark this page', accelerator: 'CmdOrCtrl+D', click: () => state.activeId && toggleBookmark(state.activeId) },
        { label: 'Show bookmarks bar', type: 'checkbox', checked: !!state.settings.bookmarksBar, accelerator: 'CmdOrCtrl+Shift+B', click: (item) => setSetting('bookmarksBar', item.checked) },
        { type: 'separator' },
        { label: 'Take a screenshot', accelerator: 'CmdOrCtrl+Shift+X', click: () => ui('screenshot') },
        { label: 'Clipboard', accelerator: 'CmdOrCtrl+Shift+Y', click: () => ui('panel', 'clipboard') },
        { label: 'Bookmarks', accelerator: 'CmdOrCtrl+Shift+O', click: () => ui('panel', 'bookmarks') },
        { label: 'History', accelerator: isMac ? 'Cmd+Y' : 'Ctrl+H', click: () => ui('panel', 'history') },
        { label: 'Passwords', click: () => ui('panel', 'passwords') },
        { label: 'AI assistant', accelerator: 'CmdOrCtrl+Shift+A', click: () => ui('panel', 'ai') }
      ]
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Next tab', accelerator: 'Ctrl+Tab', click: () => cycle(1) },
        { label: 'Previous tab', accelerator: 'Ctrl+Shift+Tab', click: () => cycle(-1) },
        { type: 'separator' },
        ...jump
      ]
    },
    ...(isMac ? [{ role: 'windowMenu' }] : [])
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- window ---------- */

function restoredBounds() {
  const b = state.bounds;
  const fallback = { width: 1360, height: 860 };
  if (!b || !b.width || !b.height) return fallback;
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
  return onScreen ? b : { width: b.width, height: b.height };
}

function createWindow() {
  win = new BrowserWindow({
    ...restoredBounds(),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Multi-Session Browser',
    autoHideMenuBar: true,
    backgroundColor: '#DCE7F5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());

  for (const evt of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) {
    win.on(evt, layout);
  }
  win.on('close', () => {
    state.bounds = win.getNormalBounds();
    saveState(true);
  });
  win.on('closed', () => {
    win = null;
    views.clear();
    aiViews.clear();
    loaded.clear();
  });

  for (const t of state.tabs) mountTab(t);
  if (!getTab(state.activeId)) state.activeId = state.tabs[0] ? state.tabs[0].id : null;
  if (state.activeId) ensureLoaded(state.activeId);
  layout();
}

/* ---------- app lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // Present as plain Chrome so sites that block embedded browsers still work.
    const platform = (app.userAgentFallback.match(/\(([^)]+)\)/) || [])[1] || 'Windows NT 10.0; Win64; x64';
    app.userAgentFallback = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

    if (process.platform === 'win32') app.setAppUserModelId('app.multisession.browser');
    loadState();
    loadHistory();
    loadClips();
    loadVault();
    applyTheme();
    buildMenu();
    createWindow();
    detectAuth();

    app.on('activate', () => { if (!win) createWindow(); });
  });

  app.on('window-all-closed', () => {
    saveState(true);
    flushHistory();
    if (!isMac) app.quit();
  });
}
