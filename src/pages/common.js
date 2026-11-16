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
    let t = res.code ? 'That recovery code is not correct.' : 'That PIN or passphrase is not correct.';
    if (res.waitMs > 0) t += ` Next try in ${formatWait(res.waitMs)}.`;
    if (res.wiped) t += ' Saved tabs were erased after too many wrong attempts.';
    return t;
  }
  if (res?.error === 'managed') return 'The PIN is managed by your Mac — rerun the installer to change it.';
  if (res?.error === 'invalid') return res.message;
  if (res?.error === 'expired') return 'This request expired. Open the page again.';
  if (res?.error === 'not-configured') return 'Tab Lock is not set up yet.';
  if (res?.error === 'no-recovery') return 'No recovery code is set up for this profile.';
  if (res?.error === 'recovery-managed') return 'Recovery codes are off because your PIN is managed by your Mac. Run the installer again to change it.';
  if (res?.error === 'recovery-stale') return 'This recovery code belongs to an older key and no longer works.';
  if (res?.error === 'locked') return 'Unlock first.';
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

// ---- recovery code texts (one place, so every screen says the same thing) ----------
export const RECOVERY_TEXT = {
  warning: 'Anyone with this code can reset your PIN. Store it somewhere safe, like a password manager.',
  once: 'This is the only time it is shown. If you forget your PIN, this code resets it and still opens your hidden tabs.',
  lost: 'If you lose both your PIN and this code, Tab Lock can’t be unlocked. To use this browser profile again you would have to remove Tab Lock or delete the profile, and you would lose the tabs Tab Lock is hiding (removing Tab Lock closes them).',
  skip: 'Without a recovery code, forgetting your PIN means removing Tab Lock or deleting this profile, and losing the hidden tabs.',
};

/**
 * Fill a recovery-code panel: the code, the warnings, and a Done button that stays
 * disabled until "I saved my recovery code" is ticked. Calls onDone() when clicked.
 */
export function showRecoveryCode(root, code, onDone) {
  root.querySelector('[data-rc="code"]').textContent = code;
  root.querySelector('[data-rc="warning"]').textContent = RECOVERY_TEXT.warning;
  root.querySelector('[data-rc="once"]').textContent = RECOVERY_TEXT.once;
  root.querySelector('[data-rc="lost"]').textContent = RECOVERY_TEXT.lost;
  const box = root.querySelector('[data-rc="saved"]');
  const done = root.querySelector('[data-rc="done"]');
  box.checked = false;
  done.disabled = true;
  box.onchange = () => { done.disabled = !box.checked; };
  done.onclick = () => {
    root.querySelector('[data-rc="code"]').textContent = '';
    onDone?.();
  };
  show(root, true);
  root.querySelector('[data-rc="code"]').focus?.();
}

/** The same panel's markup, for pages to include once. */
export const RECOVERY_PANEL_HTML = `
  <h2 class="first">Your recovery code</h2>
  <p class="code" data-rc="code" tabindex="0" aria-label="Recovery code"></p>
  <p class="warn" data-rc="warning"></p>
  <p data-rc="once"></p>
  <p class="muted" data-rc="lost"></p>
  <label class="check"><input type="checkbox" data-rc="saved"> I saved my recovery code</label>
  <button type="button" data-rc="done">Done</button>`;
