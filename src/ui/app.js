'use strict';

const api = window.msb;
const $ = (sel) => document.querySelector(sel);
const mod = api.platform === 'darwin' ? 'Cmd' : 'Ctrl';

let S = { tabs: [], activeId: null, workspaces: [], colors: [] };
let lastActiveId = null;
let dragId = null;

const ICON_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const ICON_LINK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/></svg>';

/* ---------- utilities ---------- */

async function run(name, ...args) {
  try {
    return await api.cmd(name, ...args);
  } catch (err) {
    const msg = String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    toast(msg);
    return undefined;
  }
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

function onColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? '#10161C' : '#FFFFFF';
}

const activeTab = () => S.tabs.find((t) => t.id === S.activeId) || null;

function sessionCounts() {
  const m = new Map();
  for (const t of S.tabs) m.set(t.sessionId, (m.get(t.sessionId) || 0) + 1);
  return m;
}

function displayUrl(url) {
  if (!url) return '';
  return url.replace(/^https:\/\//, '').replace(/\/$/, '');
}

/* ---------- rendering ---------- */

function render() {
  renderTabs();
  renderToolbar();
  const none = S.tabs.length === 0;
  document.body.classList.toggle('no-tabs', none);
  $('#empty').hidden = !none;
  if ($('#ws-dialog').open) renderWorkspaces();
}

function renderTabs() {
  const counts = sessionCounts();
  $('#tabs').replaceChildren(...S.tabs.map((t) => tabElement(t, counts.get(t.sessionId) || 1)));
}

function tabElement(t, shareCount) {
  const el = document.createElement('div');
  const isActive = t.id === S.activeId;
  el.className = 'tab' + (isActive ? ' active' : '') + (t.loading ? ' loading' : '');
  el.dataset.id = t.id;
  el.draggable = true;
  el.tabIndex = isActive ? 0 : -1;
  el.setAttribute('role', 'tab');
  el.setAttribute('aria-selected', String(isActive));
  el.style.setProperty('--c', t.color);
  el.title = `${t.name}\n${t.title || displayUrl(t.url)}`;

  const mark = document.createElement('span');
  mark.className = 'mark';
  if (t.favicon) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = t.favicon;
    img.addEventListener('error', () => { img.replaceWith(dot()); });
    mark.append(img);
  } else {
    mark.append(dot());
  }

  const labels = document.createElement('span');
  labels.className = 'labels';
  const role = document.createElement('span');
  role.className = 'role';
  role.textContent = t.name;
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = t.title || displayUrl(t.url) || 'New tab';
  labels.append(role, title);

  el.append(mark, labels);

  if (shareCount > 1) {
    const shared = document.createElement('span');
    shared.className = 'shared';
    shared.title = `Shares its sign-in with ${shareCount - 1} other tab${shareCount > 2 ? 's' : ''}`;
    shared.innerHTML = ICON_LINK;
    shared.append(String(shareCount));
    el.append(shared);
  }

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.tabIndex = -1;
  close.setAttribute('aria-label', `Close ${t.name}`);
  close.innerHTML = ICON_CLOSE;
  el.append(close);
  return el;
}

function dot() {
  const d = document.createElement('span');
  d.className = 'dot';
  return d;
}

function renderToolbar() {
  const t = activeTab();
  const addr = $('#address');
  const root = document.documentElement.style;
  ['back', 'forward', 'reload', 'devtools', 'tab-menu'].forEach((id) => { $('#' + id).disabled = !t; });
  addr.disabled = !t;

  if (!t) {
    addr.value = '';
    $('#role-chip').textContent = '';
    root.removeProperty('--role');
    root.removeProperty('--on-role');
    document.title = 'Multi-Session Browser';
    lastActiveId = null;
    return;
  }

  $('#back').disabled = !t.canGoBack;
  $('#forward').disabled = !t.canGoForward;
  const reload = $('#reload');
  reload.dataset.mode = t.loading ? 'stop' : 'reload';
  reload.title = t.loading ? 'Stop' : 'Reload';
  reload.setAttribute('aria-label', reload.title);

  if (document.activeElement !== addr || lastActiveId !== t.id) addr.value = t.url || '';
  lastActiveId = t.id;

  $('#role-chip').textContent = t.name;
  root.setProperty('--role', t.color);
  root.setProperty('--on-role', onColor(t.color));
  document.title = `${t.name}: ${t.title || displayUrl(t.url)}`;
}

/* ---------- tab strip events ---------- */

const tabsBox = $('#tabs');

tabsBox.addEventListener('click', (e) => {
  const el = e.target.closest('.tab');
  if (!el) return;
  if (e.target.closest('.close')) run('close', el.dataset.id);
  else run('activate', el.dataset.id);
});
tabsBox.addEventListener('auxclick', (e) => {
  const el = e.target.closest('.tab');
  if (el && e.button === 1) run('close', el.dataset.id);
});
tabsBox.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.tab');
  if (el && !e.target.closest('.close')) openTabDialog(el.dataset.id);
});
tabsBox.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.tab');
  if (!el) return;
  e.preventDefault();
  run('tab-menu', el.dataset.id);
});
tabsBox.addEventListener('keydown', (e) => {
  const el = e.target.closest('.tab');
  if (!el) return;
  const i = S.tabs.findIndex((t) => t.id === el.dataset.id);
  let next = null;
  if (e.key === 'ArrowRight') next = S.tabs[(i + 1) % S.tabs.length];
  if (e.key === 'ArrowLeft') next = S.tabs[(i - 1 + S.tabs.length) % S.tabs.length];
  if (e.key === 'Delete') { run('close', el.dataset.id); return; }
  if (next) {
    e.preventDefault();
    run('activate', next.id).then(() => tabsBox.querySelector(`[data-id="${next.id}"]`)?.focus());
  }
});

tabsBox.addEventListener('dragstart', (e) => {
  const el = e.target.closest('.tab');
  if (!el) return;
  dragId = el.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  requestAnimationFrame(() => el.classList.add('dragging'));
});
tabsBox.addEventListener('dragover', (e) => {
  if (!dragId) return;
  e.preventDefault();
  clearDropMarks();
  const el = e.target.closest('.tab');
  if (!el || el.dataset.id === dragId) return;
  const r = el.getBoundingClientRect();
  el.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
});
tabsBox.addEventListener('drop', (e) => {
  e.preventDefault();
  const el = e.target.closest('.tab');
  if (dragId && el && el.dataset.id !== dragId) {
    const r = el.getBoundingClientRect();
    let index = S.tabs.findIndex((t) => t.id === el.dataset.id);
    if (e.clientX >= r.left + r.width / 2) index += 1;
    run('move', dragId, index);
  }
  endDrag();
});
tabsBox.addEventListener('dragend', endDrag);
function clearDropMarks() {
  tabsBox.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
}
function endDrag() {
  clearDropMarks();
  tabsBox.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
  dragId = null;
}

/* ---------- toolbar events ---------- */

$('#new-tab').addEventListener('click', () => openTabDialog());
$('#empty-open').addEventListener('click', () => openTabDialog());
$('#ws-btn').addEventListener('click', openWorkspaces);
$('#back').addEventListener('click', () => run('back', S.activeId));
$('#forward').addEventListener('click', () => run('forward', S.activeId));
$('#reload').addEventListener('click', () => {
  const t = activeTab();
  if (t) run(t.loading ? 'stop' : 'reload', t.id);
});
$('#devtools').addEventListener('click', () => run('devtools', S.activeId));
$('#tab-menu').addEventListener('click', () => run('tab-menu', S.activeId));
$('#role-chip').addEventListener('click', () => S.activeId && openTabDialog(S.activeId));

const address = $('#address');
address.addEventListener('focus', () => address.select());
address.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const value = address.value.trim();
    if (value && S.activeId) run('navigate', S.activeId, value);
  } else if (e.key === 'Escape') {
    const t = activeTab();
    address.value = t ? t.url || '' : '';
    address.blur();
    run('activate', S.activeId);
  }
});

/* ---------- dialogs ---------- */

async function openModal(dlg) {
  if (dlg.open) return;
  const shot = await run('overlay', true);
  if (shot) {
    $('#shot').src = shot;
    $('#backdrop').hidden = false;
  }
  dlg.showModal();
}

for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('close', () => {
    $('#backdrop').hidden = true;
    $('#shot').removeAttribute('src');
    run('overlay', false);
  });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
  });
}

/* New / edit tab */

let editingId = null;

function nextColor() {
  const used = new Set(S.tabs.map((t) => t.color.toLowerCase()));
  return S.colors.find((c) => !used.has(c.toLowerCase())) || S.colors[S.tabs.length % S.colors.length] || '#2563EB';
}

function renderSwatches(selected) {
  const box = $('#td-swatches');
  box.replaceChildren();
  const isPreset = S.colors.some((c) => c.toLowerCase() === selected.toLowerCase());
  for (const c of S.colors) {
    box.append(swatch(c, c.toLowerCase() === selected.toLowerCase()));
  }
  const custom = document.createElement('label');
  custom.className = 'swatch custom';
  custom.title = 'Pick any color';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = isPreset ? '#888888' : selected;
  input.setAttribute('aria-label', 'Custom color');
  const face = document.createElement('span');
  face.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
  if (!isPreset) { face.style.background = selected; face.replaceChildren(); face.dataset.picked = '1'; }
  input.addEventListener('input', () => {
    box.querySelectorAll('input[type="radio"]').forEach((r) => { r.checked = false; });
    face.style.background = input.value;
    face.replaceChildren();
    face.dataset.picked = '1';
    setDialogRole(input.value);
  });
  custom.append(input, face);
  box.append(custom);
  setDialogRole(selected);
}

function swatch(color, checked) {
  const label = document.createElement('label');
  label.className = 'swatch';
  label.style.setProperty('--sw', color);
  label.title = color;
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'td-color';
  input.value = color;
  input.checked = checked;
  input.setAttribute('aria-label', `Color ${color}`);
  input.addEventListener('change', () => {
    const face = $('#td-swatches .custom span');
    face.style.background = '';
    delete face.dataset.picked;
    face.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
    setDialogRole(color);
  });
  label.append(input, document.createElement('span'));
  return label;
}

function setDialogRole(color) {
  const d = $('#tab-dialog');
  d.style.setProperty('--role', color);
  d.style.setProperty('--on-role', onColor(color));
}

function selectedColor() {
  const radio = document.querySelector('#td-swatches input[type="radio"]:checked');
  if (radio) return radio.value;
  const face = $('#td-swatches .custom span');
  if (face && face.dataset.picked) return $('#td-swatches input[type="color"]').value;
  return nextColor();
}

function sessionOptions() {
  const groups = new Map();
  for (const t of S.tabs) {
    if (!groups.has(t.sessionId)) groups.set(t.sessionId, []);
    groups.get(t.sessionId).push(t.name);
  }
  const sel = $('#td-session');
  sel.replaceChildren(new Option('New sign-in (starts logged out)', 'new'));
  for (const [id, names] of groups) {
    const unique = [...new Set(names)];
    sel.append(new Option(`Same as ${unique.join(', ')}`, id));
  }
  sel.value = 'new';
}

function defaultStartUrl() {
  const t = activeTab();
  if (!t || !t.url) return '';
  try {
    const u = new URL(t.url);
    if (/google\.[a-z.]+$/.test(u.hostname)) return '';
    return u.protocol.startsWith('http') ? u.origin : '';
  } catch { return ''; }
}

function openTabDialog(id) {
  const t = id ? S.tabs.find((x) => x.id === id) : null;
  editingId = t ? t.id : null;
  $('#td-title').textContent = t ? 'Edit tab' : 'New tab';
  $('#td-submit').textContent = t ? 'Save changes' : 'Open tab';
  $('#td-name').value = t ? t.name : '';
  $('#td-url-row').hidden = !!t;
  $('#td-session-row').hidden = !!t;
  const note = $('#td-shared-note');
  if (t) {
    const n = sessionCounts().get(t.sessionId) || 1;
    note.hidden = n < 2;
    note.textContent = n > 1 ? `This tab shares its sign-in with ${n - 1} other tab${n > 2 ? 's' : ''}. Renaming only changes this tab.` : '';
  } else {
    note.hidden = true;
    $('#td-url').value = defaultStartUrl();
    sessionOptions();
  }
  renderSwatches(t ? t.color : nextColor());
  openModal($('#tab-dialog')).then(() => { $('#td-name').focus(); $('#td-name').select(); });
}

$('#td-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#td-name').value.trim();
  if (!name) { $('#td-name').focus(); return; }
  const color = selectedColor();
  const d = $('#tab-dialog');
  if (editingId) {
    await run('update-tab', editingId, { name, color });
    d.close();
  } else {
    const session = $('#td-session').value;
    d.close();
    await run('open-tab', {
      name,
      color,
      url: $('#td-url').value.trim(),
      sessionId: session === 'new' ? undefined : session
    });
  }
});

/* Workspaces */

function openWorkspaces() {
  renderWorkspaces();
  $('#ws-name').value = '';
  openModal($('#ws-dialog')).then(() => $('#ws-name').focus());
}

function renderWorkspaces() {
  const list = $('#ws-list');
  if (!S.workspaces.length) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = 'No saved workspaces yet. Name your open tabs above to keep them.';
    list.replaceChildren(p);
    return;
  }
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  list.replaceChildren(...S.workspaces.map((w) => {
    const row = document.createElement('div');
    row.className = 'ws-row';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = w.name;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `${w.count} tab${w.count === 1 ? '' : 's'}, saved ${fmt.format(new Date(w.savedAt || Date.now()))}`;
    meta.append(name, sub);
    row.append(meta, wsButton('Open', 'open', () => wsOpen(w.name)), wsButton('Export', 'export', () => run('ws-export', w.name)), wsButton('Delete', 'danger', () => wsDelete(w.name)));
    return row;
  }));
}

function wsButton(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function wsOpen(name) {
  if (S.tabs.length && !confirm(`Replace your open tabs with "${name}"? Sign-ins saved with the workspace come back with it.`)) return;
  const ok = await run('ws-open', name);
  if (ok) $('#ws-dialog').close();
}

async function wsDelete(name) {
  if (!confirm(`Delete the workspace "${name}"? Open tabs are not affected.`)) return;
  await run('ws-delete', name);
}

$('#ws-save-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#ws-name').value.trim();
  if (!name) { $('#ws-name').focus(); return; }
  const exists = S.workspaces.some((w) => w.name.toLowerCase() === name.toLowerCase());
  if (exists && !confirm(`Replace the saved workspace "${name}" with your open tabs?`)) return;
  const ok = await run('ws-save', name);
  if (ok) $('#ws-name').value = '';
});

$('#ws-import').addEventListener('click', () => run('ws-import'));

/* ---------- main process events ---------- */

api.on('state', (next) => { S = next; render(); });
api.on('toast', toast);
api.on('ui', (action, arg) => {
  if (action === 'new-tab') openTabDialog();
  else if (action === 'edit-tab') openTabDialog(arg);
  else if (action === 'workspaces') openWorkspaces();
  else if (action === 'focus-address' && S.activeId) { address.focus(); address.select(); }
});

/* ---------- layout sync ---------- */

const chrome = $('#chrome');
new ResizeObserver(() => {
  const h = chrome.offsetHeight;
  document.documentElement.style.setProperty('--chrome-h', h + 'px');
  run('chrome-height', h);
}).observe(chrome);

$('#empty-hint').textContent = `Or press ${mod}+T anywhere.`;
run('ready');
