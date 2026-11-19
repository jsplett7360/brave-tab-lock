import { send, $, applyBrowserText, show, setMsg, failureText, configureSecretInput, backoffCountdown, CATEGORY_LABELS,
  showRecoveryCode, RECOVERY_PANEL_HTML } from './common.js';

applyBrowserText();

const params = new URLSearchParams(location.search);
const gateToken = params.get('gate');
// Default mode: a hidden tab is this page with a random token as its #fragment. The token
// says nothing about the page that was here; the worker keeps that, encrypted.
const hideToken = /^#[0-9a-f]{32}$/.test(location.hash) ? location.hash.slice(1) : null;

let st = null;
$('code-panel').innerHTML = RECOVERY_PANEL_HTML; // static markup, no data

async function refresh() {
  st = await send({ type: 'status', gate: gateToken || undefined, token: hideToken || undefined });
  // A hidden tab whose lock is over (e.g. reached with Forward later): go back to the page.
  if (hideToken && st.phase === 'unlocked' && !st.tokenPending) {
    document.title = 'Tab Lock';
    $('title').textContent = 'Unlocked';
    $('subtitle').textContent = 'Going back…';
    show($('form'), false);
    await send({ type: 'leaveStale', token: hideToken });
    return;
  }
  render();
}

function word() {
  return st.kind === 'passphrase' ? 'passphrase' : 'PIN';
}

function render() {
  const form = $('form');
  const input = $('secret');
  show($('setup'), !st.configured);
  if (!st.configured) {
    show(form, false);
    $('title').textContent = 'Tab Lock';
    $('subtitle').textContent = '';
    return;
  }
  $('secret-label').textContent = st.kind === 'passphrase' ? 'Passphrase' : 'PIN';
  $('recover-label').textContent = $('secret-label').textContent;
  $('forgot').textContent = `Forgot your ${word()}?`;
  $('forgot-title').textContent = `Reset your ${word()} with your recovery code`;
  $('rc-submit').textContent = `Reset ${word()} and unlock`;
  $('new-code-title').textContent = `Your ${word()} was reset`;
  configureSecretInput(input, st.kind);
  configureSecretInput($('recover-secret'), st.kind);
  show($('forgot'), true);

  if (gateToken) {
    document.title = 'PIN required — Tab Lock';
    if (!st.gate) {
      $('title').textContent = 'Request expired';
      $('subtitle').textContent = 'Open the page again.';
      show(form, false);
      return;
    }
    $('title').textContent = `${word() === 'PIN' ? 'PIN' : 'Passphrase'} required`;
    $('subtitle').textContent = `Enter your ${word()} to open ${CATEGORY_LABELS[st.gate.cat] || 'this page'}.`;
    $('submit').textContent = 'Open';
    show(form, true);
  } else if (st.phase !== 'unlocked') {
    document.title = 'Locked — Tab Lock';
    $('title').textContent = hideToken && st.lockScope === 'sites' ? 'Site locked' : 'Browser locked';
    $('subtitle').textContent = st.lockMode === 'hide'
      ? `Enter your ${word()} to show your tabs.`
      : `Enter your ${word()} to reopen your tabs.`;
    $('submit').textContent = 'Unlock';
    show(form, true);
  } else {
    document.title = 'Tab Lock';
    $('title').textContent = 'Unlocked';
    $('subtitle').textContent = '';
    show(form, false);
    show($('forgot'), false);
  }
  renderProblems();
  renderNewCodeOffer();
  if (!form.classList.contains('hidden')) {
    input.focus();
    backoffCountdown(st.waitMs, input, $('submit'), $('msg'));
  }
}

function renderProblems(lastResult) {
  if (gateToken || st.phase !== 'unlocked') { show($('problems'), false); return; }
  const parts = [];
  const failed = lastResult?.failedTabs || st.failedTabs || [];
  if (st.notice === 'restore-failed' || (st.savedChunks > 0 && st.oldChunks === 0 && st.lostChunks === 0)) {
    parts.push(`${st.savedTabs} saved tab(s) are still waiting to be reopened. Enter your ${word()} and choose Retry restore.`);
  }
  if (st.oldChunks > 0) parts.push(`Your ${word()} was changed by the installer. Tabs saved or hidden before the change need the previous ${word()}.`);
  if (st.lostChunks > 0) parts.push('Some saved tabs were locked with a temporary key that was lost when the browser restarted. They cannot be recovered.');
  if (st.orphanTabs > 0) parts.push(`${st.orphanTabs} tab(s) Tab Lock was hiding are no longer open (they were closed while locked, or the browser didn’t restore them after a restart). Enter your ${word()} to reopen them as new tabs, or discard them.`);
  if (st.notice === 'wiped') parts.push('Saved tabs were erased after too many wrong attempts.');
  if (st.notice === 'save-failed') parts.push('Tab Lock could not save your tabs at the last lock, so they were left open.');
  const list = $('failed-list');
  list.replaceChildren();
  for (const t of failed) {
    const li = document.createElement('li');
    li.textContent = t.url || t.title || '(unknown)';
    list.append(li);
  }
  if (failed.length) parts.push(`${failed.length} tab(s) could not be reopened by the browser. Their addresses are listed below.`);
  const any = parts.length > 0;
  show($('problems'), any);
  $('problems-text').textContent = parts.join(' ');
  show($('recover-old'), st.oldChunks > 0);
  show($('retry'), st.savedChunks > st.oldChunks + st.lostChunks || st.notice === 'restore-failed');
  show($('discard'), st.oldChunks + st.lostChunks > 0);
  show($('reopen-hidden'), st.orphanTabs > 0);
  show($('discard-hidden'), st.orphanTabs > 0);
  if (st.orphanTabs > 0) $('reopen-hidden').textContent = `Reopen ${st.orphanTabs} tab(s)`;
  if (!any && !st.recoveryUsed) {
    $('title').textContent = 'Unlocked';
    $('subtitle').textContent = 'You can close this tab.';
  }
}

function renderNewCodeOffer() {
  const offer = st.phase === 'unlocked' && st.recoveryUsed && st.recovery?.available && !st.recovery?.set;
  show($('new-code'), !!offer && $('code-panel').classList.contains('hidden'));
  $('nc-label').textContent = `Your new ${word()}`;
  configureSecretInput($('nc-secret'), st.kind);
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('secret');
  const secret = input.value;
  input.value = '';
  $('submit').disabled = true;
  setMsg($('msg'), gateToken ? 'Checking…' : 'Unlocking…');
  const res = gateToken
    ? await send({ type: 'openGate', token: gateToken, secret })
    : await send({ type: 'unlock', secret });
  $('submit').disabled = false;
  if (!res?.ok) {
    setMsg($('msg'), failureText(res), 'error');
    if (res?.waitMs > 0) backoffCountdown(res.waitMs, input, $('submit'), $('msg'));
    input.focus();
    return;
  }
  setMsg($('msg'), '', 'ok');
  if (gateToken) return; // the worker navigates this tab to the protected page
  // Default mode: this tab is normally already on its way back to its page.
  st = await send({ type: 'status' });
  render();
  renderProblems(res);
});

async function recoverAction(type) {
  const input = $('recover-secret');
  const secret = input.value;
  if (!secret) { input.focus(); return; }
  input.value = '';
  setMsg($('recover-msg'), 'Working…');
  const res = await send({ type, secret });
  if (!res?.ok) { setMsg($('recover-msg'), failureText(res), 'error'); return; }
  setMsg($('recover-msg'), 'Done.', 'ok');
  await send({ type: 'clearNotice' });
  st = await send({ type: 'status' });
  render();
  renderProblems(res);
}

$('recover-form').addEventListener('submit', (e) => { e.preventDefault(); recoverAction('retryRestore'); });
$('recover-old').addEventListener('click', () => recoverAction('recoverOld'));
$('reopen-hidden').addEventListener('click', () => recoverAction('reopenHidden'));
$('discard-hidden').addEventListener('click', () => {
  if (confirm('Discard the tabs that are no longer open? Tab Lock will forget their addresses. This cannot be undone.')) recoverAction('discardHidden');
});
$('discard').addEventListener('click', () => {
  if (confirm('Permanently discard the saved tabs that cannot be opened? This cannot be undone.')) recoverAction('discardUnopenable');
});

// ---- forgot PIN → recovery code ----------------------------------------------------------
$('forgot').addEventListener('click', () => {
  const r = st.recovery || {};
  show($('forgot-panel'), true);
  show($('forgot-managed'), r.available === false);
  show($('forgot-none'), r.available !== false && !r.set);
  show($('forgot-form'), r.available !== false && !!r.set);
  show($('form'), false);
  configureSecretInput($('rc-next'), $('rc-kind').value);
  if (r.set) $('rc-code').focus();
});
$('rc-kind').addEventListener('change', () => configureSecretInput($('rc-next'), $('rc-kind').value));
$('rc-cancel').addEventListener('click', () => {
  for (const id of ['rc-code', 'rc-next', 'rc-next2']) $(id).value = '';
  show($('forgot-panel'), false);
  render();
});
$('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = $('rc-next').value;
  if (next !== $('rc-next2').value) { setMsg($('rc-msg'), 'The two new entries don’t match.', 'error'); return; }
  setMsg($('rc-msg'), 'Checking… (this takes a moment)');
  $('rc-submit').disabled = true;
  const res = await send({ type: 'recoverWithCode', code: $('rc-code').value, next, kind: $('rc-kind').value });
  $('rc-submit').disabled = false;
  for (const id of ['rc-next', 'rc-next2']) $(id).value = '';
  if (!res?.ok) {
    setMsg($('rc-msg'), failureText(res?.error === 'wrong' ? { ...res, code: true } : res), 'error');
    if (res?.waitMs > 0) backoffCountdown(res.waitMs, $('rc-code'), $('rc-submit'), $('rc-msg'));
    return;
  }
  $('rc-code').value = '';
  setMsg($('rc-msg'), '', 'ok');
  show($('forgot-panel'), false);
  // If this tab was hidden it is now going back to its page; a Tab Lock tab opens to offer
  // a new recovery code. Otherwise (e.g. a PIN prompt for Settings) offer it right here.
  st = await send({ type: 'status' });
  render();
});

$('new-code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const secret = $('nc-secret').value;
  $('nc-secret').value = '';
  setMsg($('nc-msg'), 'Creating… (this takes a moment)');
  const res = await send({ type: 'createRecovery', secret });
  if (!res?.ok) { setMsg($('nc-msg'), failureText(res), 'error'); return; }
  setMsg($('nc-msg'), '');
  show($('new-code'), false);
  showRecoveryCode($('code-panel'), res.code, async () => {
    show($('code-panel'), false);
    await send({ type: 'clearNotice' });
    st = await send({ type: 'status' });
    render();
  });
});
$('nc-later').addEventListener('click', async () => {
  await send({ type: 'clearNotice' });
  st = await send({ type: 'status' });
  render();
});

refresh();
