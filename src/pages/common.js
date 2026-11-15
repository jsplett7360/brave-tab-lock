// Tab Lock — shared page helpers. Pages never verify the PIN themselves; they ask the
// service worker, which owns all state.

export function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

export const $ = (id) => document.getElementById(id);

export function show(el, on = true) {
  el.classList.toggle('hidden', !on);
}

export function setMsg(el, text, kind = '') {
  el.textContent = text || '';
  el.className = `msg ${kind}`;
}

export function formatWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

export const CATEGORY_LABELS = {
  history: 'History',
  settings: 'Settings',
  passwords: 'Passwords',
  extensions: 'Extensions',
  downloads: 'Downloads',
};

/** Human message for a failed verification response. */
export function failureText(res) {
  if (res?.error === 'backoff') return `Too many wrong attempts. Try again in ${formatWait(res.waitMs)}.`;
  if (res?.error === 'wrong') {
    let t = 'That PIN or passphrase is not correct.';
    if (res.waitMs > 0) t += ` Next try in ${formatWait(res.waitMs)}.`;
    if (res.wiped) t += ' Saved tabs were erased after too many wrong attempts.';
    return t;
  }
  if (res?.error === 'managed') return 'The PIN is managed by your Mac — rerun the installer to change it.';
  if (res?.error === 'invalid') return res.message;
  if (res?.error === 'expired') return 'This request expired. Open the page again.';
  if (res?.error === 'not-configured') return 'Tab Lock is not set up yet.';
  return res?.message || 'Something went wrong.';
}

/** Configure a secret input for the configured kind (numeric keypad for PINs). */
export function configureSecretInput(input, kind) {
  if (kind === 'pin') {
    input.inputMode = 'numeric';
    input.pattern = '[0-9]*';
  } else {
    input.removeAttribute('inputmode');
    input.removeAttribute('pattern');
  }
}

/** Disable a form while backoff is active, with a live countdown. */
export function backoffCountdown(waitMs, input, button, msgEl) {
  if (!(waitMs > 0)) return;
  const until = Date.now() + waitMs;
  input.disabled = true;
  button.disabled = true;
  const tick = () => {
    const left = until - Date.now();
    if (left <= 0) {
      input.disabled = false;
      button.disabled = false;
      setMsg(msgEl, '');
      input.focus();
      return;
    }
    setMsg(msgEl, `Too many wrong attempts. Try again in ${formatWait(left)}.`, 'error');
    setTimeout(tick, 1000);
  };
  tick();
}
