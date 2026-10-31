'use strict';

const {
  app, BrowserWindow, BrowserView, WebContentsView, ipcMain, session, Menu, dialog, clipboard, screen
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const COLORS = ['#2563EB', '#0E8A7E', '#3F8A2A', '#B7791F', '#D23B3B', '#B23A82', '#6D4AD8', '#56657A'];
const HOME_URL = 'https://www.google.com';
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
const views = new Map();   // tabId -> WebContentsView
const live = new Map();    // tabId -> { title, favicon, loading, canGoBack, canGoForward }
const loaded = new Set();  // tabIds whose page has been requested
const hardened = new WeakSet();
const permissionDecisions = new Map();

let state = { tabs: [], activeId: null, workspaces: [], bounds: null };

/* ---------- helpers ---------- */

const uid = () => crypto.randomUUID();
const statePath = () => path.join(app.getPath('userData'), 'state.json');
const getTab = (id) => state.tabs.find((t) => t.id === id) || null;
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
const validColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const partitionOf = (sessionId) => 'persist:' + sessionId;

function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return HOME_URL;
  if (/^(https?|file|about):/i.test(s)) return s;
  if (/^localhost(:\d+)?([/?#]|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^/]+\.[a-z][a-z0-9-]*(:\d+)?([/?#]|$)/i.test(s)) return 'https://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
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
      bounds: state.bounds
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
    colors: COLORS
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
    spellcheck: true
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
    setLive(tab.id, { canGoBack: n.canBack(), canGoForward: n.canForward() });
  };

  wc.on('did-start-loading', () => setLive(tab.id, { loading: true }));
  wc.on('did-stop-loading', () => setLive(tab.id, { loading: false }));
  wc.on('did-navigate', onNavigate);
  wc.on('did-navigate-in-page', onNavigate);
  wc.on('page-title-updated', (_e, title) => setLive(tab.id, { title }));
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
  view.webContents.loadURL(tab.url || HOME_URL).catch(() => { /* reported via did-fail-load */ });
}

function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  for (const [id, view] of views) {
    const show = id === state.activeId && !overlay;
    showView(view, show ? { x: 0, y: chromeHeight, width, height: Math.max(0, height - chromeHeight) } : null);
  }
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
  const url = (view && view.webContents.getURL()) || t.url;
  openTab({ url, name: t.name, color: t.color, sessionId: t.sessionId }, true);
}

function navigate(id, input) {
  const t = getTab(id);
  const view = views.get(id);
  if (!t || !view) return;
  t.url = normalizeUrl(input);
  loaded.add(id);
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
  if (overlay && loaded.has(state.activeId)) {
    const view = views.get(state.activeId);
    try {
      const img = await view.webContents.capturePage();
      const size = img.getSize();
      if (size.width > 0) {
        const small = img.resize({ width: Math.min(size.width, 900) });
        shot = 'data:image/jpeg;base64,' + small.toJPEG(70).toString('base64');
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
  'ws-import': wsImport
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
    backgroundColor: '#E3E8ED',
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
    buildMenu();
    createWindow();

    app.on('activate', () => { if (!win) createWindow(); });
  });

  app.on('window-all-closed', () => {
    saveState(true);
    if (!isMac) app.quit();
  });
}
