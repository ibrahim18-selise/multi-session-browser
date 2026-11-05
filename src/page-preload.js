'use strict';

// Runs inside every web page, isolated from the page's own scripts.
// It only reports sign-in forms to the browser and fills a saved password
// after you approve it with Touch ID, Windows Hello or your PIN.

const { ipcRenderer } = require('electron');

const SUBMIT_WORDS = /(sign|log)\s?(in|on)|continue|next|submit|anmelden|einloggen|connexion|entrar|login/i;
let lastSent = 0;
let formReported = false;

function visible(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function passwordFields(scope) {
  return Array.prototype.slice.call((scope || document).querySelectorAll('input[type="password"]'));
}

function usernameFor(pw) {
  const scope = pw.form || document;
  const inputs = Array.prototype.slice.call(scope.querySelectorAll('input'));
  const idx = inputs.indexOf(pw);
  for (let i = idx - 1; i >= 0; i--) {
    const type = (inputs[i].getAttribute('type') || 'text').toLowerCase();
    if ((type === 'text' || type === 'email' || type === 'tel') && visible(inputs[i])) return inputs[i];
  }
  return scope.querySelector('input[autocomplete="username"], input[type="email"]');
}

function capture(scope) {
  const filled = passwordFields(scope).filter((p) => p.value);
  if (!filled.length) return;
  const now = Date.now();
  if (now - lastSent < 1500) return;
  lastSent = now;
  // With a current and a new password (a change-password form), keep the new one.
  const pw = filled[filled.length - 1];
  const user = usernameFor(filled[0]);
  ipcRenderer.send('pw:submit', {
    origin: location.origin,
    username: user ? String(user.value || '') : '',
    password: String(pw.value)
  });
}

document.addEventListener('submit', (e) => capture(e.target), true);

document.addEventListener('click', (e) => {
  const target = e.target && e.target.closest ? e.target : null;
  if (!target) return;
  const b = target.closest('button, input[type="submit"], [role="button"]');
  if (!b) return;
  const type = (b.getAttribute('type') || '').toLowerCase();
  const label = (b.textContent || b.value || b.getAttribute('aria-label') || '').trim();
  if (type === 'submit' || (b.form && type !== 'button') || SUBMIT_WORDS.test(label)) capture(b.form || null);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') capture(e.target.form || null);
}, true);

function checkForForm() {
  if (formReported) return;
  if (passwordFields().some(visible)) {
    formReported = true;
    ipcRenderer.send('pw:form');
  }
}

let pending = null;
function schedule() {
  if (pending || formReported) return;
  pending = setTimeout(() => { pending = null; checkForForm(); }, 400);
}

window.addEventListener('DOMContentLoaded', () => {
  checkForForm();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
});

function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  el.focus();
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

ipcRenderer.on('pw:fill', (_e, data) => {
  if (!data || data.origin !== location.origin) return;
  const fields = passwordFields();
  const pw = fields.filter(visible)[0] || fields[0];
  const user = pw ? usernameFor(pw) : document.querySelector('input[autocomplete="username"], input[type="email"]');
  if (user && data.username) setValue(user, data.username);
  if (pw) setValue(pw, data.password);
  if (pw) pw.focus();
});
