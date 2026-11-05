'use strict';

// Screenshot editor: draw, highlight, add arrows, boxes and text, then copy,
// keep in the Clipboard panel or save as a PNG file.
(function () {
  const COLORS = ['#E5484D', '#F5A524', '#30A46C', '#3E63DD', '#8E4EC6', '#111827', '#FFFFFF'];
  const TOOLS = [
    ['pen', 'Pen', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3l2.5 2.5L6 12.5 3 13l.5-3z"/></svg>'],
    ['highlight', 'Highlight', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13h10M5 10.5l5.5-7 2 1.6-5.5 7H5z"/></svg>'],
    ['arrow', 'Arrow', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13L13 3M7 3h6v6"/></svg>'],
    ['box', 'Box', '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/></svg>'],
    ['text', 'Text', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10M8 3.5v9.5M6 13h4"/></svg>']
  ];
  const SIZES = [['S', 2], ['M', 4], ['L', 8]];

  let root = null;
  let stage = null;
  let canvas = null;
  let ctx = null;
  let base = null;
  let ops = [];
  let drawing = null;
  let tool = 'pen';
  let color = COLORS[0];
  let size = 4;
  let source = null;
  let textBox = null;
  let resizeObs = null;

  function el(tag, props, kids) { return window.h(tag, props, kids); }

  function build() {
    root = document.getElementById('editor');
    const toolGroup = el('div', { class: 'ed-group', role: 'group', 'aria-label': 'Tools' }, TOOLS.map((t) => {
      const b = el('button', { class: 'ed-tool', type: 'button', 'data-tool': t[0], 'aria-pressed': String(t[0] === tool), title: t[1], html: t[2] + '<span>' + t[1] + '</span>' });
      b.addEventListener('click', () => setTool(t[0]));
      return b;
    }));
    const colorGroup = el('div', { class: 'ed-group', role: 'group', 'aria-label': 'Color' }, COLORS.map((c) => {
      const b = el('button', { class: 'ed-color', type: 'button', 'data-color': c, 'aria-pressed': String(c === color), title: c, 'aria-label': 'Color ' + c });
      b.style.setProperty('--sw', c);
      b.addEventListener('click', () => { color = c; mark('.ed-color', 'data-color', c); if (textBox) textBox.style.color = c; });
      return b;
    }));
    const sizeGroup = el('div', { class: 'ed-group', role: 'group', 'aria-label': 'Size' }, SIZES.map((s) => {
      const b = el('button', { class: 'ed-tool', type: 'button', 'data-size': String(s[1]), 'aria-pressed': String(s[1] === size), title: 'Size ' + s[0], text: s[0] });
      b.addEventListener('click', () => { size = s[1]; mark('[data-size]', 'data-size', String(s[1])); });
      return b;
    }));
    const undo = el('button', { class: 'ghost small', type: 'button', text: 'Undo', title: 'Undo (' + (window.msb.platform === 'darwin' ? 'Cmd' : 'Ctrl') + '+Z)' });
    undo.addEventListener('click', undoLast);
    const clear = el('button', { class: 'ghost small', type: 'button', text: 'Clear' });
    clear.addEventListener('click', () => { commitText(); ops = []; redraw(); });

    const copy = el('button', { class: 'ghost small', type: 'button', text: 'Copy image' });
    copy.addEventListener('click', () => { window.run('copy-image', exportImage()); });
    const keep = el('button', { class: 'ghost small', type: 'button', text: 'Add to Clipboard' });
    keep.addEventListener('click', async () => {
      if (await window.run('clip-add-image', exportImage(), source)) {
        window.toast('Added to your Clipboard');
        close(true);
        window.openPanel('clipboard');
      }
    });
    const save = el('button', { class: 'ghost small', type: 'button', text: 'Save as PNG' });
    save.addEventListener('click', () => window.run('save-image', exportImage()));
    const done = el('button', { class: 'primary small', type: 'button', text: 'Close' });
    done.addEventListener('click', () => close(false));

    const bar = el('div', { class: 'ed-bar' }, [toolGroup, colorGroup, sizeGroup, undo, clear, el('span', { class: 'ed-spacer' }), copy, keep, save, done]);
    canvas = el('canvas', { 'aria-label': 'Screenshot. Drag to draw with the selected tool.' });
    ctx = canvas.getContext('2d');
    stage = el('div', { class: 'ed-stage', 'data-tool': tool }, canvas);
    root.replaceChildren(bar, stage);

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    document.addEventListener('keydown', onKey, true);
    resizeObs = new ResizeObserver(fit);
    resizeObs.observe(stage);
  }

  function mark(selector, attr, value) {
    root.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value)));
  }

  function setTool(t) {
    commitText();
    tool = t;
    stage.dataset.tool = t;
    mark('[data-tool]', 'data-tool', t);
  }

  function fit() {
    if (!base) return;
    const dpr = window.devicePixelRatio || 1;
    const maxW = Math.max(100, stage.clientWidth - 48);
    const maxH = Math.max(100, stage.clientHeight - 48);
    const natW = base.width / dpr;
    const natH = base.height / dpr;
    const k = Math.min(1, maxW / natW, maxH / natH);
    canvas.style.width = Math.round(natW * k) + 'px';
    canvas.style.height = Math.round(natH * k) + 'px';
  }

  // Image pixels per on-screen pixel, so strokes look the same size at any zoom.
  function ratio() {
    const r = canvas.getBoundingClientRect();
    return r.width ? canvas.width / r.width : 1;
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  }

  function onDown(e) {
    if (e.button !== 0) return;
    if (tool === 'text') { e.preventDefault(); startText(e); return; }
    commitText();
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);
    const w = size * ratio();
    drawing = { tool, color, width: tool === 'highlight' ? w * 4 : w, points: [p], from: p, to: p };
  }

  function onMove(e) {
    if (!drawing) return;
    const p = point(e);
    if (drawing.tool === 'pen' || drawing.tool === 'highlight') drawing.points.push(p);
    else drawing.to = p;
    redraw();
    paint(drawing);
  }

  function onUp() {
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    const moved = d.points.length > 1 || Math.abs(d.to.x - d.from.x) + Math.abs(d.to.y - d.from.y) > 3;
    if (moved || d.tool === 'pen') ops.push(d);
    redraw();
  }

  function paint(op) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = op.color;
    ctx.fillStyle = op.color;
    ctx.lineWidth = op.width;
    if (op.tool === 'pen' || op.tool === 'highlight') {
      if (op.tool === 'highlight') { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply'; }
      const pts = op.points;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
    } else if (op.tool === 'arrow') {
      const a = op.from;
      const b = op.to;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(10, op.width * 4);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
      ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
    } else if (op.tool === 'box') {
      const x = Math.min(op.from.x, op.to.x);
      const y = Math.min(op.from.y, op.to.y);
      const w = Math.abs(op.to.x - op.from.x);
      const hgt = Math.abs(op.to.y - op.from.y);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, hgt, Math.min(8 * (op.width / 4), w / 2, hgt / 2));
      else ctx.rect(x, y, w, hgt);
      ctx.stroke();
    } else if (op.tool === 'text') {
      ctx.font = '700 ' + op.fontPx + 'px ' + getComputedStyle(document.body).fontFamily;
      ctx.textBaseline = 'top';
      const light = isLight(op.color);
      ctx.lineWidth = Math.max(2, op.fontPx / 7);
      ctx.strokeStyle = light ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.9)';
      op.text.split('\n').forEach((line, i) => {
        const y = op.at.y + i * op.fontPx * 1.2;
        ctx.strokeText(line, op.at.x, y);
        ctx.fillText(line, op.at.x, y);
      });
    }
    ctx.restore();
  }

  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 160;
  }

  function redraw() {
    if (!base) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ops.forEach(paint);
  }

  function startText(e) {
    commitText();
    const r = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const cssPx = [16, 22, 32][SIZES.findIndex((s) => s[1] === size)] || 22;
    const ta = el('textarea', { class: 'ed-text', rows: '1', 'aria-label': 'Text to add' });
    ta.style.left = (e.clientX - sr.left) + 'px';
    ta.style.top = (e.clientY - sr.top - cssPx * 0.2) + 'px';
    ta.style.fontSize = cssPx + 'px';
    ta.style.color = color;
    ta.style.fontFamily = getComputedStyle(document.body).fontFamily;
    const k = canvas.width / r.width;
    textBox = { ta, at: { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }, fontPx: cssPx * k };
    const grow = () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
      ta.style.width = 'auto';
      ta.style.width = Math.max(120, ta.scrollWidth + 8) + 'px';
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commitText(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cancelText(); }
    });
    ta.addEventListener('blur', () => setTimeout(commitText, 0));
    stage.append(ta);
    grow();
    setTimeout(() => ta.focus(), 0);
  }

  function commitText() {
    if (!textBox) return;
    const tb = textBox;
    textBox = null;
    const text = tb.ta.value.replace(/\s+$/, '');
    tb.ta.remove();
    if (text) { ops.push({ tool: 'text', color: tb.ta.style.color ? rgbToHex(tb.ta.style.color) : color, text, at: tb.at, fontPx: tb.fontPx }); redraw(); }
  }

  function cancelText() {
    if (!textBox) return;
    textBox.ta.remove();
    textBox = null;
  }

  function rgbToHex(rgb) {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
    if (!m) return rgb;
    return '#' + [m[1], m[2], m[3]].map((v) => ('0' + Number(v).toString(16)).slice(-2)).join('').toUpperCase();
  }

  function undoLast() {
    if (textBox) { cancelText(); return; }
    ops.pop();
    redraw();
  }

  function exportImage() {
    commitText();
    redraw();
    return canvas.toDataURL('image/png');
  }

  function onKey(e) {
    if (!root || root.hidden) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z' && !textBox) { e.preventDefault(); undoLast(); }
    else if (e.key === 'Escape' && !textBox && !document.querySelector('dialog[open]')) { e.preventDefault(); close(false); }
  }

  function close(force) {
    if (!root || root.hidden) return;
    commitText();
    if (!force && ops.length && !confirm('Close the editor? Your markup is not saved anywhere yet.')) return;
    root.hidden = true;
    ops = [];
    base = null;
    window.overlayOff('editor');
  }

  async function open(opts) {
    if (!opts || !opts.dataUrl) return;
    if (!root) build();
    source = opts.source || null;
    ops = [];
    const img = new Image();
    img.onload = async () => {
      base = img;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      await window.overlayOn('editor');
      root.hidden = false;
      fit();
      redraw();
    };
    img.onerror = () => window.toast('That screenshot could not be opened.');
    img.src = opts.dataUrl;
  }

  window.MSBEditor = { open, close };
})();
