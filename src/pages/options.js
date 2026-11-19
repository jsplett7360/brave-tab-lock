import { send, $, applyBrowserText, show, setMsg, failureText, configureSecretInput, showRecoveryCode, RECOVERY_PANEL_HTML } from './common.js';
import { parseSiteList } from '../settings.js';

applyBrowserText();

$('code-panel').innerHTML = RECOVERY_PANEL_HTML; // static markup, no data

let st = null;

async function refresh() {
  st = await send({ type: 'status', options: true });
  show($('setup-needed'), !st.configured);
  show($('update-note'), !!st.updatePending);
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
  renderRecovery();
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
  $('lockdown').checked = s.mode === 'lockdown';
  $(s.scope === 'sites' ? 'scope-sites' : s.scope === 'except' ? 'scope-except' : 'scope-all').checked = true;
  $('sites').value = s.sites.join('\n');
  $('except-sites').value = (s.exceptSites || []).join('\n');
  if (s.mode === 'lockdown') $('advanced').open = true;
  syncScope();
}

function syncScope() {
  const lockdown = $('lockdown').checked;
  for (const id of ['scope-all', 'scope-sites', 'scope-except']) $(id).disabled = lockdown;
  $('sites').disabled = lockdown || !$('scope-sites').checked;
  $('except-sites').disabled = lockdown || !$('scope-except').checked;
  show($('except-warn'), !lockdown && $('scope-except').checked);
  show($('scope-lockdown-note'), lockdown);
}
for (const id of ['lockdown', 'scope-all', 'scope-sites', 'scope-except']) $(id).addEventListener('change', syncScope);

function renderRecovery() {
  const r = st.recovery || {};
  show($('rc-managed'), r.available === false);
  show($('rc-area'), r.available !== false);
  if (r.available === false) return;
  $('rc-status').textContent = !r.set
    ? 'No recovery code is set up. If you forget your PIN, you would have to remove Tab Lock or delete this profile, and lose the hidden tabs.'
    : r.valid
      ? `A recovery code is set up (created ${new Date(r.created).toLocaleDateString()}).`
      : 'Your recovery code no longer works (the key it belonged to was replaced). Create a new one.';
  $('rc-create').textContent = r.set ? 'Create a new recovery code' : 'Create recovery code';
  show($('rc-remove'), !!r.set);
  $('rc-secret-label').textContent = st.kind === 'passphrase' ? 'Current passphrase' : 'Current PIN';
  configureSecretInput($('rc-secret'), st.kind);
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
    mode: $('lockdown').checked ? 'lockdown' : 'hide',
    scope: $('scope-sites').checked ? 'sites' : $('scope-except').checked ? 'except' : 'all',
    sites: parseSiteList($('sites').value).sites,
    exceptSites: parseSiteList($('except-sites').value).sites,
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
  setMsg($('sites-msg'), '', 'error');
  setMsg($('except-msg'), '', 'error');
  for (const [radio, box, msg] of [['scope-sites', 'sites', 'sites-msg'], ['scope-except', 'except-sites', 'except-msg']]) {
    if ($('lockdown').checked || !$(radio).checked) continue;
    const { sites, errors } = parseSiteList($(box).value);
    if (errors.length) {
      setMsg($(msg), errors.map((x) => (x.line ? `Line ${x.line} (${x.text}): ${x.error}` : x.error)).join(' '), 'error');
      $(box).focus();
      return;
    }
    if (!sites.length) { setMsg($(msg), 'Add at least one site, or choose All tabs.', 'error'); $(box).focus(); return; }
  }
  const res = await send({ type: 'saveSettings', settings: read() });
  if (res?.error === 'auth') { setMsg($('settings-msg'), 'Your settings session expired. Enter your PIN again.', 'error'); refresh(); return; }
  if (!res?.ok) { setMsg($('settings-msg'), failureText(res), 'error'); return; }
  fill(res.settings);
  setMsg($('settings-msg'), 'Saved.', 'ok');
});

$('kind').addEventListener('change', () => { configureSecretInput($('next'), $('kind').value); configureSecretInput($('next2'), $('kind').value); });
configureSecretInput($('next'), $('kind').value); // PIN is the default
configureSecretInput($('next2'), $('kind').value);

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

$('rc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const secret = $('rc-secret').value;
  $('rc-secret').value = '';
  if (st.recovery?.set && !confirm('Create a new recovery code? Your current recovery code will stop working.')) return;
  setMsg($('rc-msg'), 'Creating… (this takes a moment)');
  const res = await send({ type: 'createRecovery', secret });
  if (!res?.ok) { setMsg($('rc-msg'), failureText(res), 'error'); return; }
  setMsg($('rc-msg'), '');
  show($('rc-form'), false);
  showRecoveryCode($('code-panel'), res.code, async () => {
    show($('code-panel'), false);
    show($('rc-form'), true);
    st = await send({ type: 'status', options: true });
    renderRecovery();
  });
});

$('rc-remove').addEventListener('click', async () => {
  const secret = $('rc-secret').value;
  if (!secret) { setMsg($('rc-msg'), `Enter your current ${st.kind === 'passphrase' ? 'passphrase' : 'PIN'} first.`, 'error'); $('rc-secret').focus(); return; }
  if (!confirm('Remove your recovery code? If you then forget your PIN, you would have to remove Tab Lock or delete this profile, and lose the hidden tabs.')) return;
  $('rc-secret').value = '';
  const res = await send({ type: 'removeRecovery', secret });
  if (!res?.ok) { setMsg($('rc-msg'), failureText(res), 'error'); return; }
  setMsg($('rc-msg'), 'Removed.', 'ok');
  st = await send({ type: 'status', options: true });
  renderRecovery();
});

$('lock-now').addEventListener('click', () => send({ type: 'lockNow' }));

refresh();
