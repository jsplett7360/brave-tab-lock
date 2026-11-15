import { send, $, show, setMsg, failureText, configureSecretInput } from './common.js';

let st = null;

async function refresh() {
  st = await send({ type: 'status', options: true });
  show($('setup-needed'), !st.configured);
  if (!st.configured) { show($('auth'), false); show($('settings'), false); return; }
  const needAuth = !st.optionsAuthorized;
  show($('auth'), needAuth);
  show($('settings'), !needAuth);
  if (needAuth) {
    $('auth-label').textContent = st.kind === 'passphrase' ? 'Passphrase' : 'PIN';
    configureSecretInput($('auth-secret'), st.kind);
    $('auth-secret').focus();
    return;
  }
  fill(st.settings);
  show($('managed-note'), st.managed);
  show($('pin-form'), !st.managed);
  $('incog-status').textContent = st.incognitoAllowed
    ? 'Tab Lock is allowed in private windows.'
    : 'Tab Lock is NOT allowed in private windows yet, so private windows stay open when the browser locks.';
}

function fill(s) {
  $('timeout').value = s.timeoutMin;
  $('unfocus').checked = s.lockOnUnfocus;
  $('startup').checked = s.lockOnStartup;
  $('grace').value = s.graceMin;
  for (const el of document.querySelectorAll('[data-cat]')) el.checked = !!s.protect[el.dataset.cat];
  $('wipe').checked = s.wipeAfter.enabled;
  $('wipe-n').value = s.wipeAfter.n;
}

function read() {
  const protect = {};
  for (const el of document.querySelectorAll('[data-cat]')) protect[el.dataset.cat] = el.checked;
  return {
    timeoutMin: parseInt($('timeout').value, 10),
    lockOnUnfocus: $('unfocus').checked,
    lockOnStartup: $('startup').checked,
    graceMin: parseInt($('grace').value, 10),
    protect,
    wipeAfter: { enabled: $('wipe').checked, n: parseInt($('wipe-n').value, 10) },
  };
}

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const secret = $('auth-secret').value;
  $('auth-secret').value = '';
  setMsg($('auth-msg'), 'Checking…');
  const res = await send({ type: 'authOptions', secret });
  if (!res?.ok) { setMsg($('auth-msg'), failureText(res), 'error'); return; }
  setMsg($('auth-msg'), '');
  refresh();
});

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await send({ type: 'saveSettings', settings: read() });
  if (res?.error === 'auth') { setMsg($('settings-msg'), 'Your settings session expired. Enter your PIN again.', 'error'); refresh(); return; }
  if (!res?.ok) { setMsg($('settings-msg'), failureText(res), 'error'); return; }
  fill(res.settings);
  setMsg($('settings-msg'), 'Saved.', 'ok');
});

$('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = $('next').value;
  if (next !== $('next2').value) { setMsg($('pin-msg'), 'The two new entries don’t match.', 'error'); return; }
  setMsg($('pin-msg'), 'Saving… (this takes a moment)');
  const res = await send({ type: 'setSecret', current: $('cur').value, next, kind: $('kind').value });
  for (const id of ['cur', 'next', 'next2']) $(id).value = '';
  if (!res?.ok) { setMsg($('pin-msg'), failureText(res), 'error'); return; }
  setMsg($('pin-msg'), 'Changed.', 'ok');
});

$('lock-now').addEventListener('click', () => send({ type: 'lockNow' }));

refresh();
