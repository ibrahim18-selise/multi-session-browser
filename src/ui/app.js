'use strict';

const api = window.msb;
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
const mod = api.platform === 'darwin' ? 'Cmd' : 'Ctrl';
const NEWTAB = 'msb:newtab';

let S = {
  tabs: [], activeId: null, workspaces: [], colors: [], bookmarks: [], folders: [],
  settings: {}, engines: {}, auth: { method: 'pin', label: 'your PIN', pinSet: false, available: true }
};
let lastActiveId = null;
let dragId = null;
let panel = null;
const pwOffers = new Map();
const pwAvail = new Map();

const ICONS = {
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  link: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1"/></svg>',
  search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/></svg>',
  globe: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c1.7 1.6 2.5 3.4 2.5 5.5S9.7 11.9 8 13.5C6.3 11.9 5.5 10.1 5.5 8S6.3 4.1 8 2.5z"/></svg>',
  clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>',
  star: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z"/></svg>',
  key: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="10.5" r="2.5"/><path d="M7.3 8.7L13 3M11 5l1.6 1.6M9.4 6.6l1.1 1.1"/></svg>',
  lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="6.5" rx="1.6"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>',
  trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3l2.5 2.5L6 12.5 3 13l.5-3z"/></svg>',
  save: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M5 7l3 3 3-3M3 12.5h10"/></svg>',
  eye: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  open: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5"/></svg>',
  camera: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.5h2.2l1.1-1.7h4.4l1.1 1.7h2.2v7.2h-11z"/><circle cx="8" cy="9" r="2.2"/></svg>',
  paste: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3" width="9" height="11" rx="1.6"/><path d="M6 3V2h4v1M8 6.5v5M5.8 9.3L8 11.5l2.2-2.2"/></svg>',
  folder: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.6H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>',
  folderPlus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.6H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M8 7.5v3.5M6.25 9.25h3.5"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>',
  bar: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h7v11L8 11l-3.5 2.5z"/></svg>',
  move: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.6H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><path d="M6.5 9.25h3.5M8.5 7.5l1.75 1.75L8.5 11"/></svg>',
  markup: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5c2-1 2.5-3 4.5-3s1.5 2 3.5 2 2-2 3-2.5"/><path d="M9.5 2.5l2 2-4.5 4.5-2.5.5.5-2.5z"/></svg>'
};

/* ---------- small helpers ---------- */

function h(tag, props, kids) {
  const e = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  if (kids !== undefined && kids !== null) {
    [].concat(kids).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      e.append(c.nodeType ? c : String(c));
    });
  }
  return e;
}

function miniBtn(icon, label, onClick, cls) {
  return h('button', { class: 'mini' + (cls ? ' ' + cls : ''), type: 'button', title: label, 'aria-label': label, html: ICONS[icon], onclick: (e) => { e.stopPropagation(); onClick(e); } });
}

async function run(name) {
  const args = Array.prototype.slice.call(arguments, 1);
  try {
    return await api.cmd.apply(null, [name].concat(args));
  } catch (err) {
    const msg = cleanError(err);
    if (msg !== 'PIN_SETUP') toast(msg);
    return undefined;
  }
}

function cleanError(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function call(name) {
  // Like run(), but throws so callers can react (used for PIN prompts).
  const args = Array.prototype.slice.call(arguments, 1);
  try {
    return await api.cmd.apply(null, [name].concat(args));
  } catch (err) {
    throw new Error(cleanError(err));
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
  const n = parseInt(String(hex).slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? '#10161C' : '#FFFFFF';
}

function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
}

const activeTab = () => S.tabs.find((t) => t.id === S.activeId) || null;
const isNewTabUrl = (url) => url === NEWTAB;
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; } };
const originOf = (url) => { try { return new URL(url).origin; } catch { return ''; } };
const engineName = () => (S.engines && S.engines[S.settings.searchEngine]) || 'Google';

function displayUrl(url) {
  if (!url || isNewTabUrl(url)) return '';
  return url.replace(/^https:\/\//, '').replace(/\/$/, '');
}

function sessionCounts() {
  const m = new Map();
  for (const t of S.tabs) m.set(t.sessionId, (m.get(t.sessionId) || 0) + 1);
  return m;
}

function letterColor(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) n = (n * 31 + text.charCodeAt(i)) >>> 0;
  const palette = ['#4A6FA5', '#2D8B8B', '#6D4AD8', '#B23A82', '#3F8A2A', '#B7791F', '#D23B3B', '#56657A'];
  return palette[n % palette.length];
}

function favicon(url, src, big) {
  const host = hostOf(url) || '?';
  const letter = h('span', { class: 'fav-letter', text: host.charAt(0).toUpperCase() });
  letter.style.background = letterColor(host);
  const icon = src || (originOf(url) ? originOf(url) + '/favicon.ico' : null);
  if (!icon) return letter;
  const img = h('img', { class: big ? '' : 'fav', alt: '', src: icon, referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(letter));
  return img;
}

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function looksLikeUrl(s) {
  const v = String(s || '').trim();
  if (!v || /\s/.test(v)) return false;
  return /^(https?|file|about):/i.test(v) || /^localhost(:\d+)?([/?#]|$)/i.test(v) || /^[^/]+\.[a-z][a-z0-9-]*(:\d+)?([/?#]|$)/i.test(v);
}

/* ---------- overlay: hide the live page while something covers it ---------- */

const overlayReasons = new Set();

async function overlayOn(reason) {
  const first = overlayReasons.size === 0;
  overlayReasons.add(reason);
  if (!first) return;
  const shot = await run('overlay', true);
  if (!overlayReasons.size) { run('overlay', false); return; }
  if (shot) {
    $('#shot').src = shot;
    $('#backdrop').hidden = false;
  }
}

function overlayOff(reason) {
  if (!overlayReasons.delete(reason) || overlayReasons.size) return;
  $('#backdrop').hidden = true;
  $('#shot').removeAttribute('src');
  run('overlay', false);
}

/* ---------- rendering ---------- */

function render() {
  document.documentElement.dataset.theme = S.settings.theme || 'system';
  renderTabs();
  renderToolbar();
  renderBookmarksBar();
  renderInfobar();
  renderContent();
  if (panel === 'bookmarks') renderBookmarksList();
}

function renderTabs() {
  const counts = sessionCounts();
  $('#tabs').replaceChildren.apply($('#tabs'), S.tabs.map((t) => tabElement(t, counts.get(t.sessionId) || 1)));
}

function tabElement(t, shareCount) {
  const isActive = t.id === S.activeId;
  const el = h('div', {
    class: 'tab' + (isActive ? ' active' : '') + (t.loading ? ' loading' : ''),
    'data-id': t.id, draggable: 'true', tabindex: isActive ? '0' : '-1', role: 'tab',
    'aria-selected': String(isActive), title: t.name + '\n' + (isNewTabUrl(t.url) ? 'New tab' : (t.title || displayUrl(t.url)))
  });
  el.style.setProperty('--c', t.color);

  const mark = h('span', { class: 'mark' });
  if (t.favicon && !isNewTabUrl(t.url)) {
    const img = h('img', { alt: '', src: t.favicon });
    img.addEventListener('error', () => img.replaceWith(h('span', { class: 'dot' })));
    mark.append(img);
  } else {
    mark.append(h('span', { class: 'dot' }));
  }

  const title = isNewTabUrl(t.url) ? 'New tab' : (t.title || displayUrl(t.url) || 'Loading');
  el.append(mark, h('span', { class: 'labels' }, [h('span', { class: 'role', text: t.name }), h('span', { class: 'title', text: title })]));

  if (shareCount > 1) {
    const shared = h('span', {
      class: 'shared', html: ICONS.link,
      title: 'Shares its sign-in with ' + (shareCount - 1) + ' other tab' + (shareCount > 2 ? 's' : '')
    });
    shared.append(String(shareCount));
    el.append(shared);
  }
  el.append(h('button', { class: 'close', type: 'button', tabindex: '-1', 'aria-label': 'Close ' + t.name, html: ICONS.close }));
  return el;
}

function renderToolbar() {
  const t = activeTab();
  const addr = $('#address');
  const root = document.documentElement.style;
  ['back', 'forward', 'reload', 'devtools', 'shot-btn', 'star'].forEach((id) => { $('#' + id).disabled = !t; });
  addr.disabled = !t;

  if (!t) {
    addr.value = '';
    $('#role-chip').textContent = '';
    root.removeProperty('--role');
    root.removeProperty('--on-role');
    root.removeProperty('--role-soft');
    document.title = 'Multi-Session Browser';
    $('#pw-key').hidden = true;
    lastActiveId = null;
    return;
  }

  const ntp = isNewTabUrl(t.url);
  $('#back').disabled = !t.canGoBack;
  $('#forward').disabled = !t.canGoForward;
  $('#devtools').disabled = ntp;
  $('#shot-btn').disabled = ntp;
  const reload = $('#reload');
  reload.dataset.mode = t.loading ? 'stop' : 'reload';
  reload.title = t.loading ? 'Stop' : 'Reload';
  reload.setAttribute('aria-label', reload.title);

  if (document.activeElement !== addr || lastActiveId !== t.id) addr.value = ntp ? '' : (t.url || '');
  addr.placeholder = 'Search ' + engineName() + ' or type a web address';
  lastActiveId = t.id;

  const bookmarked = !ntp && S.bookmarks.some((b) => b.url === t.url);
  const star = $('#star');
  star.disabled = ntp;
  star.setAttribute('aria-pressed', String(bookmarked));
  star.title = bookmarked ? 'Edit bookmark (' + mod + '+D)' : 'Bookmark this page (' + mod + '+D)';

  const avail = pwAvail.get(t.id);
  $('#pw-key').hidden = !(avail && originOf(t.url) === avail.origin);

  $('#role-chip').textContent = t.name;
  root.setProperty('--role', t.color);
  root.setProperty('--on-role', onColor(t.color));
  root.setProperty('--role-soft', rgba(t.color, 0.24));
  document.title = t.name + ': ' + (ntp ? 'New tab' : (t.title || displayUrl(t.url)));
}

const folderName = (fid) => { const f = S.folders.find((x) => x.id === fid); return f ? f.name : 'Bookmarks bar'; };
const rootBookmarks = () => S.bookmarks.filter((b) => !b.folderId);

function acceptsBookmark(el, onDrop) {
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.indexOf('text/msb-bookmark') < 0) return;
    e.preventDefault();
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop-target');
    const id = e.dataTransfer.getData('text/msb-bookmark');
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    onDrop(id, e);
  });
}

function folderMenuAt(fid, el) {
  const r = el.getBoundingClientRect();
  run('folder-menu', fid, r.left, r.bottom + 2);
}

function renderBookmarksBar() {
  const bar = $('#bookmarks-bar');
  const show = !!S.settings.bookmarksBar && S.tabs.length > 0;
  bar.hidden = !show;
  if (!show) return;
  const key = JSON.stringify([S.folders.map((f) => [f.id, f.name]), S.bookmarks.map((b) => [b.id, b.title, b.favicon, b.folderId])]);
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  const roots = rootBookmarks();
  if (!roots.length && !S.folders.length) {
    bar.replaceChildren(h('span', { class: 'bm-empty', text: 'Bookmark pages with the star in the address bar, or press ' + mod + '+D.' }));
    return;
  }
  const folderChips = S.folders.map((f) => {
    const n = S.bookmarks.filter((b) => b.folderId === f.id).length;
    const chip = h('button', { class: 'bm-chip folder', type: 'button', title: f.name + ' (' + n + ' bookmark' + (n === 1 ? '' : 's') + ')', html: ICONS.folder }, h('span', { text: f.name }));
    chip.addEventListener('click', () => folderMenuAt(f.id, chip));
    chip.addEventListener('contextmenu', (e) => { e.preventDefault(); folderMenuAt(f.id, chip); });
    acceptsBookmark(chip, (id) => run('bm-update', id, { folderId: f.id }).then(() => toast('Moved to ' + f.name)));
    return chip;
  });
  const chips = roots.slice(0, 40).map((b) => {
    const chip = h('button', { class: 'bm-chip', type: 'button', title: b.title + '\n' + b.url, draggable: 'true', 'data-id': b.id }, [favicon(b.url, b.favicon), h('span', { text: b.title || hostOf(b.url) })]);
    chip.addEventListener('click', (e) => openBookmark(b, e.ctrlKey || e.metaKey ? 'new' : 'current'));
    chip.addEventListener('auxclick', (e) => { if (e.button === 1) openBookmark(b, 'new'); });
    chip.addEventListener('contextmenu', (e) => { e.preventDefault(); run('bm-menu', b.id); });
    chip.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/msb-bookmark', b.id); e.dataTransfer.effectAllowed = 'move'; });
    chip.addEventListener('dragover', (e) => { if (e.dataTransfer.types.indexOf('text/msb-bookmark') >= 0) e.preventDefault(); });
    chip.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('text/msb-bookmark');
      if (!id || id === b.id) return;
      e.preventDefault();
      const moved = S.bookmarks.find((x) => x.id === id);
      if (moved && moved.folderId) run('bm-update', id, { folderId: null });
      const r = chip.getBoundingClientRect();
      let index = S.bookmarks.findIndex((x) => x.id === b.id);
      if (e.clientX > r.left + r.width / 2) index += 1;
      run('bm-move', id, index);
    });
    return chip;
  });
  const all = folderChips.concat(folderChips.length && chips.length ? [h('span', { class: 'bm-sep', 'aria-hidden': 'true' })] : []).concat(chips);
  bar.replaceChildren.apply(bar, all);
}

function openBookmark(b, where) {
  if (!S.activeId) { run('open-url', b.url, 'new'); return; }
  run('open-url', b.url, where);
}

function renderContent() {
  const none = S.tabs.length === 0;
  document.body.classList.toggle('no-tabs', none);
  $('#empty').hidden = !none;
  const t = activeTab();
  const ntp = !!t && isNewTabUrl(t.url);
  const wasHidden = $('#ntp').hidden;
  $('#ntp').hidden = !ntp;
  if (ntp) renderNewTab(t, wasHidden);
}

/* ---------- new tab page ---------- */

let topCache = { at: 0, items: [] };

async function renderNewTab(t, justOpened) {
  const counts = sessionCounts();
  const n = counts.get(t.sessionId) || 1;
  const role = $('#ntp-role');
  role.replaceChildren(
    h('span', { class: 'chip', text: t.name }),
    h('span', { text: n > 1 ? 'Shares its sign-in with ' + (n - 1) + ' other tab' + (n > 2 ? 's' : '') : 'This tab has its own sign-in' })
  );
  $('#ntp-input').placeholder = 'Search ' + engineName() + ' or type a web address';
  if (justOpened) $('#ntp-input').value = '';

  const bmBox = $('#ntp-bookmarks');
  bmBox.hidden = !S.bookmarks.length && !S.folders.length;
  const folderTiles = S.folders.slice(0, 8).map((f) => {
    const b = h('button', { class: 'tile', type: 'button', title: f.name }, [h('span', { class: 'tile-icon folder-tile', html: ICONS.folder }), h('span', { text: f.name })]);
    b.addEventListener('click', () => folderMenuAt(f.id, b));
    return b;
  });
  const bookmarkTiles = rootBookmarks().slice(0, Math.max(4, 12 - folderTiles.length)).map((b) => tile(b.url, b.title || hostOf(b.url), b.favicon));
  $('.tiles', bmBox).replaceChildren.apply($('.tiles', bmBox), folderTiles.concat(bookmarkTiles));

  if (justOpened || Date.now() - topCache.at > 15000) {
    topCache = { at: Date.now(), items: (await run('top-sites')) || [] };
  }
  const topBox = $('#ntp-top');
  topBox.hidden = !topCache.items.length;
  $('.tiles', topBox).replaceChildren.apply($('.tiles', topBox), topCache.items.map((s) => tile(s.url, s.host, null)));

  if (justOpened && !overlayReasons.size && !document.querySelector('dialog[open]')) {
    setTimeout(() => { if (!$('#ntp').hidden) $('#ntp-input').focus(); }, 30);
  }
}

function tile(url, label, icon) {
  const b = h('button', { class: 'tile', type: 'button', title: url }, [h('span', { class: 'tile-icon' }, favicon(url, icon, true)), h('span', { text: label })]);
  b.addEventListener('click', (e) => run('open-url', url, e.ctrlKey || e.metaKey ? 'new' : 'current'));
  b.addEventListener('auxclick', (e) => { if (e.button === 1) run('open-url', url, 'new'); });
  return b;
}

/* ---------- suggestions for the address bar and new tab search ---------- */

const SG = { input: null, anchor: null, items: [], index: -1, inline: null, seq: 0, open: false, covering: false };

function sgPosition() {
  if (!SG.anchor) return;
  const r = SG.anchor.getBoundingClientRect();
  const box = $('#suggest');
  box.style.left = Math.round(r.left) + 'px';
  box.style.top = Math.round(r.bottom + 6) + 'px';
  box.style.width = Math.round(r.width) + 'px';
}

async function sgQuery(input, anchor, allowInline) {
  SG.input = input;
  SG.anchor = anchor;
  SG.inline = null;
  const typed = input.value;
  const q = typed.trim();
  if (!q) { sgClose(); return; }
  const my = ++SG.seq;
  const res = (await run('suggest', q)) || { items: [], inline: null };
  if (my !== SG.seq || document.activeElement !== input || input.value !== typed) return;

  const first = looksLikeUrl(q)
    ? { kind: 'go', title: q, url: q }
    : { kind: 'search', title: q, url: q };
  let items = [first].concat(res.items);

  const inline = res.inline;
  if (allowInline && inline && !/\s/.test(typed) && inline.text.toLowerCase().indexOf(typed.toLowerCase()) === 0 && inline.text.length > typed.length) {
    input.value = typed + inline.text.slice(typed.length);
    input.setSelectionRange(typed.length, input.value.length);
    SG.inline = inline;
    items = [{ kind: 'history', title: inline.title || inline.text, url: inline.url }].concat(items.filter((i) => i.url !== inline.url));
  }
  SG.items = items.slice(0, 7);
  SG.index = 0;
  sgShow();
}

function sgShow() {
  const box = $('#suggest');
  box.replaceChildren.apply(box, SG.items.map((it, i) => {
    const icon = it.kind === 'search' ? ICONS.search : it.kind === 'go' ? ICONS.globe : it.kind === 'bookmark' ? ICONS.star : ICONS.clock;
    const text = h('span', { class: 'sg-text' });
    if (it.kind === 'search') {
      text.append(h('span', { class: 'sg-title', text: it.title }), h('span', { class: 'sg-kind', text: 'Search ' + engineName() }));
    } else if (it.kind === 'go') {
      text.append(h('span', { class: 'sg-title', text: it.title }), h('span', { class: 'sg-kind', text: 'Go to site' }));
    } else {
      text.append(h('span', { class: 'sg-title', text: it.title || displayUrl(it.url) }), h('span', { class: 'sg-url', text: displayUrl(it.url) }));
    }
    const row = h('div', { class: 'sg-item' + (i === SG.index ? ' active' : ''), role: 'option', 'aria-selected': String(i === SG.index) }, [h('span', { class: 'sg-icon', html: icon }), text]);
    row.addEventListener('mousedown', (e) => { e.preventDefault(); sgChoose(it, e.ctrlKey || e.metaKey || e.button === 1); });
    row.addEventListener('mousemove', () => { if (SG.index !== i) { SG.index = i; sgMark(); } });
    return row;
  }));
  sgPosition();
  box.hidden = false;
  SG.open = true;
  if (SG.input === $('#address') && !SG.covering) {
    SG.covering = true;
    overlayOn('suggest');
  }
}

function sgMark() {
  $$('#suggest .sg-item').forEach((el, i) => {
    el.classList.toggle('active', i === SG.index);
    el.setAttribute('aria-selected', String(i === SG.index));
  });
}

function sgClose() {
  SG.seq++;
  SG.open = false;
  SG.items = [];
  SG.inline = null;
  $('#suggest').hidden = true;
  if (SG.covering) { SG.covering = false; overlayOff('suggest'); }
}

function sgChoose(item, newTab) {
  sgClose();
  if (item.kind === 'search') go(item.url, newTab, true);
  else go(item.url, newTab, false);
}

function go(value, newTab, forceSearch) {
  sgClose();
  const v = String(value || '').trim();
  if (!v) return;
  const target = forceSearch && looksLikeUrl(v) ? v : v;
  if (newTab || !S.activeId) run('open-url', target, 'new');
  else run('navigate', S.activeId, target);
  $('#address').blur();
  $('#ntp-input').value = '';
}

function wireSearchInput(input, anchor) {
  input.addEventListener('input', (e) => {
    const atEnd = input.selectionStart === input.value.length;
    const inserting = !e.inputType || e.inputType.indexOf('insert') === 0;
    sgQuery(input, anchor, atEnd && inserting);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!SG.open || SG.input !== input) return;
      e.preventDefault();
      const n = SG.items.length;
      SG.index = (SG.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      const it = SG.items[SG.index];
      if (it && it.kind !== 'search' && it.kind !== 'go') input.value = it.url;
      else if (it) input.value = it.title;
      SG.inline = null;
      sgMark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const newTab = e.altKey || e.metaKey || e.ctrlKey;
      if (SG.open && SG.input === input && SG.items[SG.index] && SG.index > 0 && !SG.inline) { sgChoose(SG.items[SG.index], newTab); return; }
      if (SG.inline && input.selectionStart !== input.selectionEnd) { go(SG.inline.url, newTab, false); return; }
      go(input.value, newTab, false);
    } else if (e.key === 'Escape') {
      if (SG.open) { e.preventDefault(); sgClose(); if (input === $('#address')) { const t = activeTab(); input.value = t && !isNewTabUrl(t.url) ? t.url : ''; input.select(); } return; }
      if (input === $('#address')) { input.blur(); run('activate', S.activeId); }
    } else if (e.key === 'Delete' && SG.open && SG.index > 0) {
      const it = SG.items[SG.index];
      if (it && it.kind === 'history' && e.shiftKey) {
        e.preventDefault();
        run('history-delete', it.url).then(() => sgQuery(input, anchor, false));
      }
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (SG.input === input && document.activeElement !== input) sgClose(); }, 120));
}

/* ---------- password infobar ---------- */

function authLabel() {
  return S.auth.method === 'touchid' ? 'Touch ID' : S.auth.method === 'hello' ? 'Windows Hello' : 'PIN';
}

function renderInfobar() {
  const bar = $('#infobar');
  const t = activeTab();
  const offer = t && pwOffers.get(t.id);
  const avail = t && pwAvail.get(t.id);
  const availShown = avail && !avail.dismissed && originOf(t.url) === avail.origin;
  const key = offer ? 'offer:' + offer.id : availShown ? 'avail:' + t.id + ':' + avail.accounts.map((a) => a.id).join(',') + ':' + S.auth.method : '';
  if (!key) { bar.hidden = true; bar.dataset.key = ''; return; }
  bar.hidden = false;
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;

  if (offer) {
    const user = h('input', { type: 'text', value: offer.username, placeholder: 'Username or email', 'aria-label': 'Username for this password', spellcheck: 'false' });
    bar.replaceChildren(
      h('span', { class: 'ib-icon', html: ICONS.key }),
      h('span', { class: 'ib-text' }, [
        h('strong', { text: offer.update ? 'Update your saved password for ' + offer.host + '?' : 'Save your password for ' + offer.host + '?' }),
        h('small', { text: 'It stays encrypted on this computer and is filled after you confirm with ' + (S.auth.method === 'pin' ? 'your PIN' : authLabel()) + '.' })
      ]),
      user,
      h('span', { class: 'ib-actions' }, [
        h('button', { class: 'primary small', type: 'button', text: offer.update ? 'Update' : 'Save', onclick: () => savePassword(t.id, offer, user.value) }),
        h('button', { class: 'ghost small', type: 'button', text: 'Never for this site', onclick: () => { run('pw-never', offer.id); pwOffers.delete(t.id); renderInfobar(); } }),
        h('button', { class: 'mini', type: 'button', title: 'Not now', 'aria-label': 'Not now', html: ICONS.close, onclick: () => { run('pw-dismiss', offer.id); pwOffers.delete(t.id); renderInfobar(); } })
      ])
    );
    return;
  }

  let picker = null;
  if (avail.accounts.length > 1) {
    picker = h('select', { 'aria-label': 'Account' }, avail.accounts.map((a) => h('option', { value: a.id, text: a.username || '(no username)' })));
  }
  const account = avail.accounts[0];
  bar.replaceChildren(
    h('span', { class: 'ib-icon', html: ICONS.key }),
    h('span', { class: 'ib-text' }, [
      h('strong', { text: picker ? 'Sign in to ' + avail.host + ' with a saved password' : 'Sign in to ' + avail.host + ' as ' + (account.username || 'your saved account') }),
      h('small', { text: 'Confirm with ' + (S.auth.method === 'pin' ? 'your PIN' : authLabel()) + ' to fill the form.' })
    ]),
    picker,
    h('span', { class: 'ib-actions' }, [
      h('button', { class: 'primary small', type: 'button', html: ICONS.lock + '<span>Fill with ' + authLabel() + '</span>', onclick: () => fillPassword(t.id, picker ? picker.value : account.id) }),
      h('button', { class: 'mini', type: 'button', title: 'Hide', 'aria-label': 'Hide', html: ICONS.close, onclick: () => { avail.dismissed = true; renderInfobar(); renderToolbar(); } })
    ])
  );
}

async function ensurePin(reasonText) {
  if (S.auth.method !== 'pin') return null;
  if (!S.auth.pinSet) {
    const pin = await askPin({ mode: 'create', title: 'Create a PIN for saved passwords', text: 'This computer has no Touch ID or Windows Hello the browser can use, so a PIN protects your saved passwords. Use 4 to 12 digits.' });
    if (!pin) return false;
    try { await call('pin-set', pin); } catch (err) { toast(err.message); return false; }
    S.auth.pinSet = true;
    return pin;
  }
  const pin = await askPin({ mode: 'enter', title: 'Enter your PIN', text: reasonText });
  return pin || false;
}

async function savePassword(tabId, offer, username) {
  if (S.auth.method === 'pin' && !S.auth.pinSet) {
    const pin = await ensurePin('');
    if (pin === false) return;
  }
  const ok = await run('pw-save', offer.id, username);
  if (ok) { pwOffers.delete(tabId); renderInfobar(); }
}

async function withAuth(reasonText, fn) {
  const pin = await ensurePin(reasonText);
  if (pin === false) return undefined;
  try {
    return await fn(pin || undefined);
  } catch (err) {
    if (err.message === 'PIN_SETUP') {
      S.auth.pinSet = false;
      return withAuth(reasonText, fn);
    }
    toast(err.message);
    return undefined;
  }
}

async function fillPassword(tabId, entryId) {
  const t = S.tabs.find((x) => x.id === tabId);
  const host = t ? hostOf(t.url) : 'this site';
  const ok = await withAuth('Enter your PIN to fill your saved password for ' + host + '.', (pin) => call('pw-fill', tabId, entryId, pin));
  if (ok) {
    const avail = pwAvail.get(tabId);
    if (avail) avail.dismissed = true;
    renderInfobar();
    renderToolbar();
  }
}

/* ---------- PIN and text dialogs ---------- */

function askPin(opts) {
  return new Promise((resolve) => {
    const d = $('#pin-dialog');
    const mode = opts.mode;
    $('#pin-title').textContent = opts.title;
    $('#pin-text').textContent = opts.text || '';
    $('#pin-text').hidden = !opts.text;
    $('#pin-old-row').hidden = mode !== 'change';
    $('#pin-confirm-row').hidden = mode === 'enter';
    $('#pin-label').textContent = mode === 'enter' ? 'PIN' : 'New PIN';
    $('#pin-submit').textContent = mode === 'enter' ? 'Unlock' : 'Save PIN';
    ['#pin-old', '#pin-input', '#pin-confirm'].forEach((s) => { $(s).value = ''; });
    $('#pin-error').hidden = true;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      $('#pin-form').removeEventListener('submit', onSubmit);
      d.removeEventListener('close', onClose);
      if (d.open) d.close();
      resolve(value);
    };
    const fail = (msg) => { $('#pin-error').textContent = msg; $('#pin-error').hidden = false; };
    const onSubmit = (e) => {
      e.preventDefault();
      const pin = $('#pin-input').value.trim();
      if (!/^\d{4,12}$/.test(pin)) { fail('Use 4 to 12 digits.'); return; }
      if (mode !== 'enter' && pin !== $('#pin-confirm').value.trim()) { fail('The two PINs do not match.'); return; }
      finish(mode === 'change' ? { pin, old: $('#pin-old').value.trim() } : pin);
    };
    const onClose = () => finish(null);
    $('#pin-form').addEventListener('submit', onSubmit);
    d.addEventListener('close', onClose);
    openModal(d).then(() => $(mode === 'change' ? '#pin-old' : '#pin-input').focus());
  });
}

function askText(title, label, value) {
  return new Promise((resolve) => {
    const d = $('#text-dialog');
    $('#txt-title').textContent = title;
    $('#txt-label').textContent = label;
    $('#txt-input').value = value || '';
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      $('#txt-form').removeEventListener('submit', onSubmit);
      d.removeEventListener('close', onClose);
      if (d.open) d.close();
      resolve(v);
    };
    const onSubmit = (e) => { e.preventDefault(); finish($('#txt-input').value.trim()); };
    const onClose = () => finish(null);
    $('#txt-form').addEventListener('submit', onSubmit);
    d.addEventListener('close', onClose);
    openModal(d).then(() => { $('#txt-input').focus(); $('#txt-input').select(); });
  });
}

/* ---------- side panel ---------- */

function openPanel(name) {
  panel = name;
  const el = $('#panel');
  el.hidden = false;
  $$('.seg button', el).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.seg === name)));
  $$('[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === name));
  const w = el.offsetWidth;
  document.documentElement.style.setProperty('--panel-w', w + 'px');
  run('panel-width', w);
  renderPanel();
}

function closePanel() {
  panel = null;
  $('#panel').hidden = true;
  $$('[data-panel]').forEach((b) => b.classList.remove('on'));
  document.documentElement.style.setProperty('--panel-w', '0px');
  run('panel-width', 0);
}

function togglePanel(name) {
  if (panel === name) closePanel(); else openPanel(name);
}

function renderPanel() {
  const body = $('#panel-body');
  body.replaceChildren();
  body.scrollTop = 0;
  if (panel === 'clipboard') renderClipboard(body);
  else if (panel === 'bookmarks') renderBookmarksPanel(body);
  else if (panel === 'history') renderHistory(body);
  else if (panel === 'passwords') renderPasswords(body);
}

/* Clipboard */

async function renderClipboard(body) {
  const area = h('textarea', { placeholder: 'Write a note to keep for later', 'aria-label': 'New note' });
  const saveNote = async () => {
    if (!area.value.trim()) { area.focus(); return; }
    const ok = await run('clip-note', area.value);
    if (ok) { area.value = ''; loadClips(); }
  };
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); } });
  body.append(
    h('div', { class: 'compose' }, [area, h('div', { class: 'p-row' }, [h('button', { class: 'primary small', type: 'button', text: 'Save note', onclick: saveNote })])]),
    h('div', { class: 'p-row' }, [
      h('button', { class: 'ghost small', type: 'button', html: ICONS.camera + '<span>Screenshot page</span>', onclick: takeScreenshot, disabled: !activeTab() || isNewTabUrl(activeTab().url) }),
      h('button', { class: 'ghost small', type: 'button', html: ICONS.paste + '<span>Paste from computer</span>', title: 'Add the image or text on your computer clipboard', onclick: async () => { if (await run('clip-from-system')) loadClips(); } })
    ]),
    h('div', { id: 'clip-list', class: 'list' })
  );
  loadClips();
}

async function loadClips() {
  const list = $('#clip-list');
  if (!list) return;
  const items = (await run('clip-list')) || [];
  if (panel !== 'clipboard') return;
  if (!items.length) {
    list.replaceChildren(h('p', { class: 'p-empty', text: 'Notes and screenshots you keep show up here. They stay on this computer.' }));
    return;
  }
  list.replaceChildren.apply(list, items.map(clipCard));
}

function clipCard(c) {
  const where = c.source && c.source.url ? hostOf(c.source.url) : '';
  const when = timeAgo(c.created) + (where ? ', from ' + where : '');
  const card = h('div', { class: 'clip' });
  if (c.type === 'image') {
    const img = h('img', { class: 'clip-img', alt: 'Screenshot' + (where ? ' of ' + where : ''), src: c.thumb || '' });
    img.addEventListener('click', () => editClip(c.id));
    card.append(img, h('div', { class: 'clip-foot' }, [
      h('span', { class: 'when', text: when }),
      miniBtn('markup', 'Mark up', () => editClip(c.id)),
      miniBtn('copy', 'Copy image', () => run('clip-copy', c.id)),
      miniBtn('save', 'Save as file', () => run('clip-save', c.id)),
      miniBtn('trash', 'Delete', async () => { if (await run('clip-delete', c.id)) loadClips(); }, 'warn')
    ]));
  } else {
    const text = h('div', { class: 'clip-note', text: c.text });
    card.append(text, h('div', { class: 'clip-foot' }, [
      h('span', { class: 'when', text: when }),
      miniBtn('edit', 'Edit', () => editNote(card, c)),
      miniBtn('copy', 'Copy text', () => run('clip-copy', c.id)),
      miniBtn('save', 'Save as file', () => run('clip-save', c.id)),
      miniBtn('trash', 'Delete', async () => { if (await run('clip-delete', c.id)) loadClips(); }, 'warn')
    ]));
  }
  return card;
}

function editNote(card, c) {
  const area = h('textarea', { class: 'note-edit', 'aria-label': 'Edit note' });
  area.value = c.text;
  const save = async () => { if (await run('clip-update', c.id, area.value)) loadClips(); };
  card.replaceChildren(area, h('div', { class: 'clip-foot' }, [
    h('span', { class: 'when', text: 'Editing' }),
    h('button', { class: 'ghost small', type: 'button', text: 'Cancel', onclick: loadClips }),
    h('button', { class: 'primary small', type: 'button', text: 'Save', onclick: save })
  ]));
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
  area.focus();
}

async function editClip(id) {
  const res = await run('clip-image', id);
  if (res && window.MSBEditor) window.MSBEditor.open(res);
}

async function takeScreenshot() {
  const t = activeTab();
  if (!t || isNewTabUrl(t.url)) { toast('Open a web page first, then take a screenshot.'); return; }
  if (SG.open) sgClose();
  const res = await run('capture', t.id);
  if (res && window.MSBEditor) window.MSBEditor.open(res);
}

/* Bookmarks */

const collapsed = new Set();

function renderBookmarksPanel(body) {
  const search = h('input', { class: 'p-search', type: 'search', placeholder: 'Search bookmarks', 'aria-label': 'Search bookmarks' });
  search.addEventListener('input', renderBookmarksList);
  body.append(
    search,
    h('div', { class: 'p-row' }, h('button', { class: 'ghost small', type: 'button', html: ICONS.folderPlus + '<span>New folder</span>', onclick: () => newFolder(null) })),
    h('div', { id: 'bm-list', class: 'list' })
  );
  renderBookmarksList();
}

function renderBookmarksList() {
  const list = $('#bm-list');
  if (!list) return;
  const q = ($('#panel-body .p-search') || { value: '' }).value.trim().toLowerCase();
  if (q) {
    const items = S.bookmarks.filter((b) => (b.title + ' ' + b.url + ' ' + folderName(b.folderId)).toLowerCase().indexOf(q) >= 0);
    if (!items.length) { list.replaceChildren(h('p', { class: 'p-empty', text: 'No bookmarks match that search.' })); return; }
    list.replaceChildren.apply(list, items.map((b) => bookmarkRow(b, true)));
    return;
  }
  if (!S.bookmarks.length && !S.folders.length) {
    list.replaceChildren(h('p', { class: 'p-empty', text: 'Bookmark a page with the star in the address bar, or press ' + mod + '+D. Use New folder to group them.' }));
    return;
  }
  const groups = [{ id: null, name: 'Bookmarks bar' }].concat(S.folders);
  list.replaceChildren.apply(list, groups.map(folderSection));
}

function folderSection(f) {
  const isRoot = f.id === null;
  const key = f.id || 'root';
  const items = S.bookmarks.filter((b) => (b.folderId || null) === f.id);
  const open = !collapsed.has(key);
  const head = h('div', { class: 'folder-head', role: 'button', tabindex: '0', 'aria-expanded': String(open) }, [
    h('span', { class: 'chev', html: ICONS.chevron }),
    h('span', { class: 'folder-ico', html: isRoot ? ICONS.bar : ICONS.folder }),
    h('span', { class: 'folder-name', text: f.name }),
    isRoot ? null : h('span', { class: 'acts' }, [
      items.length ? miniBtn('open', 'Open all in new tabs', () => run('folder-open', f.id)) : null,
      miniBtn('edit', 'Rename folder', () => renameFolder(f)),
      miniBtn('trash', 'Delete folder', () => run('folder-delete', f.id), 'warn')
    ]),
    h('span', { class: 'count', text: String(items.length) })
  ]);
  const toggle = () => { if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key); renderBookmarksList(); };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  acceptsBookmark(head, (id) => run('bm-update', id, { folderId: f.id }));
  const body = h('div', { class: 'folder-body' }, items.length
    ? items.map((b) => bookmarkRow(b, false))
    : h('p', { class: 'folder-empty', text: isRoot ? 'Bookmarks go here unless you pick a folder.' : 'Empty. Drag bookmarks here, or choose Move to folder on a bookmark.' }));
  body.hidden = !open;
  const section = h('div', { class: 'folder' + (open ? ' open' : '') }, [head, body]);
  return section;
}

function bookmarkRow(b, showFolder) {
  const row = h('div', { class: 'item clickable', title: b.url, draggable: 'true' }, [
    favicon(b.url, b.favicon),
    h('div', { class: 'meta' }, [
      h('div', { class: 't', text: b.title || hostOf(b.url) }),
      h('div', { class: 's', text: (showFolder ? folderName(b.folderId) + ', ' : '') + displayUrl(b.url) })
    ]),
    h('div', { class: 'acts' }, [
      miniBtn('open', 'Open in new tab', () => openBookmark(b, 'new')),
      miniBtn('edit', 'Edit', () => openBookmarkDialog({ id: b.id, added: false })),
      miniBtn('move', 'Move to folder', () => run('bm-menu', b.id)),
      miniBtn('trash', 'Delete', () => run('bm-remove', b.id), 'warn')
    ])
  ]);
  row.addEventListener('click', (e) => openBookmark(b, e.ctrlKey || e.metaKey ? 'new' : 'current'));
  row.addEventListener('auxclick', (e) => { if (e.button === 1) openBookmark(b, 'new'); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); run('bm-menu', b.id); });
  row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/msb-bookmark', b.id); e.dataTransfer.effectAllowed = 'move'; });
  return row;
}

async function newFolder(moveBookmarkId) {
  const name = await askText('New folder', 'Folder name', '');
  if (!name) return null;
  const fid = await run('folder-create', name);
  if (fid && moveBookmarkId) await run('bm-update', moveBookmarkId, { folderId: fid });
  if (fid) toast('Folder "' + name + '" created');
  return fid;
}

async function renameFolder(f) {
  const name = await askText('Rename folder', 'Folder name', f.name);
  if (name) run('folder-rename', f.id, name);
}

/* Bookmark dialog */

let bmEditing = null;

function openBookmarkDialog(arg) {
  const id = typeof arg === 'string' ? arg : arg && arg.id;
  const b = S.bookmarks.find((x) => x.id === id);
  if (!b) return;
  bmEditing = b.id;
  $('#bmd-title').textContent = arg && arg.added ? 'Bookmark added' : 'Edit bookmark';
  $('#bmd-name').value = b.title || '';
  const sel = $('#bmd-folder');
  sel.replaceChildren.apply(sel, [new Option('Bookmarks bar', '')]
    .concat(S.folders.map((f) => new Option(f.name, f.id)))
    .concat([new Option('New folder', '__new')]));
  sel.value = b.folderId || '';
  $('#bmd-new-row').hidden = true;
  $('#bmd-new').value = '';
  openModal($('#bm-dialog')).then(() => { $('#bmd-name').focus(); $('#bmd-name').select(); });
}

$('#bmd-folder').addEventListener('change', () => {
  const isNew = $('#bmd-folder').value === '__new';
  $('#bmd-new-row').hidden = !isNew;
  if (isNew) $('#bmd-new').focus();
});

$('#bmd-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = bmEditing;
  let folderId = $('#bmd-folder').value;
  if (folderId === '__new') {
    const name = $('#bmd-new').value.trim();
    if (!name) { $('#bmd-new').focus(); return; }
    folderId = await run('folder-create', name);
    if (!folderId) return;
  }
  $('#bm-dialog').close();
  await run('bm-update', id, { title: $('#bmd-name').value, folderId: folderId || null });
});

$('#bmd-remove').addEventListener('click', async () => {
  const id = bmEditing;
  $('#bm-dialog').close();
  if (await run('bm-remove', id)) toast('Bookmark removed');
});

/* History */

function renderHistory(body) {
  const search = h('input', { class: 'p-search', type: 'search', placeholder: 'Search history', 'aria-label': 'Search history' });
  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadHistory(search.value), 150); });
  body.append(
    search,
    h('div', { id: 'hist-list', class: 'list' }),
    h('div', { class: 'p-row p-foot' }, [h('button', { class: 'danger-btn small', type: 'button', text: 'Clear browsing history', onclick: () => run('history-clear') })])
  );
  loadHistory('');
}

async function loadHistory(q) {
  const list = $('#hist-list');
  if (!list) return;
  const items = (await run('history-list', q)) || [];
  if (panel !== 'history') return;
  if (!items.length) {
    list.replaceChildren(h('p', { class: 'p-empty', text: q ? 'Nothing in your history matches that search.' : 'Pages you visit show up here and in address bar suggestions.' }));
    return;
  }
  list.replaceChildren.apply(list, items.map((x) => {
    const row = h('div', { class: 'item clickable', title: x.url }, [
      favicon(x.url, null),
      h('div', { class: 'meta' }, [h('div', { class: 't', text: x.title || displayUrl(x.url) }), h('div', { class: 's', text: displayUrl(x.url) + ', ' + timeAgo(x.last) })]),
      h('div', { class: 'acts' }, [
        miniBtn('open', 'Open in new tab', () => run('open-url', x.url, 'new')),
        miniBtn('trash', 'Remove from history', async () => { if (await run('history-delete', x.url)) row.remove(); }, 'warn')
      ])
    ]);
    row.addEventListener('click', (e) => run('open-url', x.url, e.ctrlKey || e.metaKey ? 'new' : 'current'));
    row.addEventListener('auxclick', (e) => { if (e.button === 1) run('open-url', x.url, 'new'); });
    return row;
  }));
}

/* Passwords */

async function renderPasswords(body) {
  const data = (await run('pw-list')) || { entries: [], never: [] };
  if (panel !== 'passwords') return;
  const method = S.auth.method;
  body.replaceChildren();
  body.append(h('p', { class: 'p-row' }, [h('span', { class: 'badge', html: ICONS.lock + '<span>Protected by ' + (method === 'pin' ? 'your PIN' : authLabel()) + '</span>' })]));
  if (!S.auth.available) body.append(h('p', { class: 'note', text: 'This computer cannot encrypt passwords, so the browser will not offer to save them.' }));

  const search = h('input', { class: 'p-search', type: 'search', placeholder: 'Search saved passwords', 'aria-label': 'Search saved passwords' });
  const list = h('div', { class: 'list' });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const items = data.entries.filter((e) => !q || (e.host + ' ' + e.username).toLowerCase().indexOf(q) >= 0);
    if (!items.length) {
      list.replaceChildren(h('p', { class: 'p-empty', text: q ? 'No saved passwords match that search.' : 'When you sign in to a site, the browser offers to save the password here.' }));
      return;
    }
    list.replaceChildren.apply(list, items.map((e) => passwordRow(e, () => { data.entries = data.entries.filter((x) => x.id !== e.id); draw(); })));
  };
  search.addEventListener('input', draw);
  body.append(search, list);
  draw();

  const offer = h('input', { type: 'checkbox' });
  offer.checked = !!S.settings.offerPasswords;
  offer.addEventListener('change', () => run('set-setting', 'offerPasswords', offer.checked));
  body.append(h('label', { class: 'toggle' }, [h('span', { text: 'Offer to save passwords' }), offer]));

  if (method === 'pin') {
    body.append(h('div', { class: 'toggle' }, [
      h('span', { text: S.auth.pinSet ? 'Your PIN protects saved passwords' : 'No PIN yet. You will create one when you save a password.' }),
      S.auth.pinSet ? h('button', { class: 'ghost small', type: 'button', text: 'Change PIN', onclick: changePin }) : null
    ]));
  }

  if (data.never.length) {
    body.append(h('p', { class: 'p-heading', text: 'Never saved for these sites' }));
    const nl = h('div', { class: 'list' });
    data.never.forEach((origin) => {
      const row = h('div', { class: 'item' }, [
        favicon(origin, null),
        h('div', { class: 'meta' }, h('div', { class: 't', text: hostOf(origin) })),
        h('div', { class: 'acts' }, miniBtn('trash', 'Allow saving again', async () => { if (await run('pw-unblock', origin)) row.remove(); }))
      ]);
      nl.append(row);
    });
    body.append(nl);
  }
}

function passwordRow(e, onDeleted) {
  const secret = h('div', { class: 's secret', text: (e.username || '(no username)') + '  ' + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' });
  let hideTimer = null;
  const reveal = async () => {
    const pw = await withAuth('Enter your PIN to show this password.', (pin) => call('pw-reveal', e.id, pin));
    if (typeof pw !== 'string') return;
    secret.textContent = (e.username || '(no username)') + '  ' + pw;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { secret.textContent = (e.username || '(no username)') + '  ' + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'; }, 20000);
  };
  return h('div', { class: 'item' }, [
    favicon(e.origin, null),
    h('div', { class: 'meta' }, [h('div', { class: 't', text: e.host }), secret]),
    h('div', { class: 'acts' }, [
      miniBtn('eye', 'Show password', reveal),
      miniBtn('copy', 'Copy password', () => withAuth('Enter your PIN to copy this password.', (pin) => call('pw-copy', e.id, pin))),
      miniBtn('trash', 'Delete', async () => { if (await run('pw-delete', e.id)) onDeleted(); }, 'warn')
    ])
  ]);
}

async function changePin() {
  const res = await askPin({ mode: 'change', title: 'Change your PIN', text: 'Use 4 to 12 digits.' });
  if (!res) return;
  try { await call('pin-set', res.pin, res.old); } catch (err) { toast(err.message); }
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
    run('activate', next.id).then(() => { const n = tabsBox.querySelector('[data-id="' + next.id + '"]'); if (n) n.focus(); });
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
  $$('.drop-before, .drop-after', tabsBox).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
}
function endDrag() {
  clearDropMarks();
  $$('.dragging', tabsBox).forEach((x) => x.classList.remove('dragging'));
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
$('#menu-btn').addEventListener('click', () => run('app-menu'));
$('#role-chip').addEventListener('click', () => S.activeId && openTabDialog(S.activeId));
$('#star').addEventListener('click', () => S.activeId && run('bm-toggle', S.activeId));
$('#shot-btn').addEventListener('click', takeScreenshot);
$('#pw-key').addEventListener('click', () => {
  const t = activeTab();
  const avail = t && pwAvail.get(t.id);
  if (!avail) return;
  avail.dismissed = false;
  if (avail.accounts.length === 1) fillPassword(t.id, avail.accounts[0].id);
  else { $('#infobar').dataset.key = ''; renderInfobar(); }
});
$$('[data-panel]').forEach((b) => b.addEventListener('click', () => togglePanel(b.dataset.panel)));
$$('#panel .seg button').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.seg)));
$('#panel-close').addEventListener('click', closePanel);

const address = $('#address');
address.addEventListener('focus', () => address.select());
wireSearchInput(address, $('#omnibox'));
wireSearchInput($('#ntp-input'), $('#ntp-search'));

window.addEventListener('resize', () => {
  if (SG.open) sgPosition();
  if (panel) {
    const w = $('#panel').offsetWidth;
    document.documentElement.style.setProperty('--panel-w', w + 'px');
    run('panel-width', w);
  }
});

/* ---------- dialogs ---------- */

async function openModal(dlg) {
  if (dlg.open) return;
  if (SG.open) sgClose();
  await overlayOn('dialog:' + dlg.id);
  dlg.showModal();
}

$$('dialog').forEach((dlg) => {
  dlg.addEventListener('close', () => overlayOff('dialog:' + dlg.id));
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dlg.close(); });
});

/* New / edit tab */

let editingId = null;

function nextColor() {
  const used = new Set(S.tabs.map((t) => t.color.toLowerCase()));
  return S.colors.find((c) => !used.has(c.toLowerCase())) || S.colors[S.tabs.length % S.colors.length] || '#2563EB';
}

const PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';

function renderSwatches(selected) {
  const box = $('#td-swatches');
  box.replaceChildren();
  const isPreset = S.colors.some((c) => c.toLowerCase() === selected.toLowerCase());
  S.colors.forEach((c) => box.append(swatch(c, c.toLowerCase() === selected.toLowerCase())));
  const input = h('input', { type: 'color', 'aria-label': 'Custom color' });
  input.value = isPreset ? '#888888' : selected;
  const face = h('span', { html: PLUS });
  if (!isPreset) { face.style.background = selected; face.replaceChildren(); face.dataset.picked = '1'; }
  input.addEventListener('input', () => {
    $$('#td-swatches input[type="radio"]').forEach((r) => { r.checked = false; });
    face.style.background = input.value;
    face.replaceChildren();
    face.dataset.picked = '1';
    setDialogRole(input.value);
  });
  box.append(h('label', { class: 'swatch custom', title: 'Pick any color' }, [input, face]));
  setDialogRole(selected);
}

function swatch(color, checked) {
  const input = h('input', { type: 'radio', name: 'td-color', value: color, 'aria-label': 'Color ' + color });
  input.checked = checked;
  input.addEventListener('change', () => {
    const face = $('#td-swatches .custom span');
    face.style.background = '';
    delete face.dataset.picked;
    face.innerHTML = PLUS;
    setDialogRole(color);
  });
  const label = h('label', { class: 'swatch', title: color }, [input, h('span')]);
  label.style.setProperty('--sw', color);
  return label;
}

function setDialogRole(color) {
  const d = $('#tab-dialog');
  d.style.setProperty('--role', color);
  d.style.setProperty('--on-role', onColor(color));
  d.style.setProperty('--role-soft', rgba(color, 0.24));
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
  groups.forEach((names, id) => {
    const unique = Array.from(new Set(names));
    sel.append(new Option('Same as ' + unique.join(', '), id));
  });
  sel.value = 'new';
}

function defaultStartUrl() {
  const t = activeTab();
  if (!t || !t.url || isNewTabUrl(t.url)) return '';
  try {
    const u = new URL(t.url);
    if (/(^|\.)(google|bing|duckduckgo|search\.brave)\.[a-z.]+$/.test(u.hostname)) return '';
    return u.protocol.indexOf('http') === 0 ? u.origin : '';
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
    note.textContent = n > 1 ? 'This tab shares its sign-in with ' + (n - 1) + ' other tab' + (n > 2 ? 's' : '') + '. Renaming only changes this tab.' : '';
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
    const url = $('#td-url').value.trim();
    d.close();
    await run('open-tab', { name, color, url, sessionId: session === 'new' ? undefined : session });
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
    list.replaceChildren(h('p', { class: 'empty-note', text: 'No saved workspaces yet. Name your open tabs above to keep them.' }));
    return;
  }
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  list.replaceChildren.apply(list, S.workspaces.map((w) => h('div', { class: 'ws-row' }, [
    h('div', { class: 'meta' }, [
      h('div', { class: 'name', text: w.name }),
      h('div', { class: 'sub', text: w.count + ' tab' + (w.count === 1 ? '' : 's') + ', saved ' + fmt.format(new Date(w.savedAt || Date.now())) })
    ]),
    h('button', { class: 'open', type: 'button', text: 'Open', onclick: () => wsOpen(w.name) }),
    h('button', { type: 'button', text: 'Export', onclick: () => run('ws-export', w.name) }),
    h('button', { class: 'danger', type: 'button', text: 'Delete', onclick: () => wsDelete(w.name) })
  ])));
}

async function wsOpen(name) {
  if (S.tabs.length && !confirm('Replace your open tabs with "' + name + '"? Sign-ins saved with the workspace come back with it.')) return;
  const ok = await run('ws-open', name);
  if (ok) $('#ws-dialog').close();
}

async function wsDelete(name) {
  if (!confirm('Delete the workspace "' + name + '"? Open tabs are not affected.')) return;
  await run('ws-delete', name);
}

$('#ws-save-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#ws-name').value.trim();
  if (!name) { $('#ws-name').focus(); return; }
  const exists = S.workspaces.some((w) => w.name.toLowerCase() === name.toLowerCase());
  if (exists && !confirm('Replace the saved workspace "' + name + '" with your open tabs?')) return;
  const ok = await run('ws-save', name);
  if (ok) $('#ws-name').value = '';
});

$('#ws-import').addEventListener('click', () => run('ws-import'));

/* ---------- main process events ---------- */

api.on('state', (next) => {
  const prevActive = S.activeId;
  S = next;
  for (const id of Array.from(pwOffers.keys())) if (!S.tabs.some((t) => t.id === id)) pwOffers.delete(id);
  for (const id of Array.from(pwAvail.keys())) if (!S.tabs.some((t) => t.id === id)) pwAvail.delete(id);
  render();
  if ($('#ws-dialog').open) renderWorkspaces();
  if (prevActive !== S.activeId && SG.open) sgClose();
});
api.on('toast', toast);
api.on('pw-offer', (offer) => { pwOffers.set(offer.tabId, offer); renderInfobar(); });
api.on('pw-available', (info) => {
  const prev = pwAvail.get(info.tabId);
  info.dismissed = !!(prev && prev.dismissed && prev.origin === info.origin);
  pwAvail.set(info.tabId, info);
  renderInfobar();
  renderToolbar();
});
api.on('ui', (action, arg) => {
  if (action === 'new-tab') openTabDialog();
  else if (action === 'edit-tab') openTabDialog(arg);
  else if (action === 'workspaces') openWorkspaces();
  else if (action === 'screenshot') takeScreenshot();
  else if (action === 'panel') togglePanel(arg);
  else if (action === 'rename-bookmark' || action === 'edit-bookmark') openBookmarkDialog(arg);
  else if (action === 'rename-folder') { const f = S.folders.find((x) => x.id === arg); if (f) renameFolder(f); }
  else if (action === 'new-folder') newFolder(arg || null);
  else if (action === 'history-cleared') { topCache = { at: 0, items: [] }; if (panel === 'history') renderPanel(); }
  else if (action === 'focus-address' && S.activeId) {
    const t = activeTab();
    if (t && isNewTabUrl(t.url)) $('#ntp-input').focus();
    else { address.focus(); address.select(); }
  }
});

/* ---------- layout sync ---------- */

const chrome = $('#chrome');
new ResizeObserver(() => {
  const hgt = chrome.offsetHeight;
  document.documentElement.style.setProperty('--chrome-h', hgt + 'px');
  run('chrome-height', hgt);
  if (SG.open) sgPosition();
}).observe(chrome);

$('#empty-hint').textContent = 'Or press ' + mod + '+T anywhere.';
run('ready');
