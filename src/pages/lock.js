import { send, $, show, setMsg, failureText, configureSecretInput, backoffCountdown, CATEGORY_LABELS } from './common.js';

const params = new URLSearchParams(location.search);
const gateToken = params.get('gate');

let st = null;

async function refresh() {
  st = await send({ type: 'status', gate: gateToken || undefined });
  render();
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
  const word = st.kind === 'passphrase' ? 'passphrase' : 'PIN';
  $('secret-label').textContent = st.kind === 'passphrase' ? 'Passphrase' : 'PIN';
  $('recover-label').textContent = $('secret-label').textContent;
  configureSecretInput(input, st.kind);
  configureSecretInput($('recover-secret'), st.kind);

  if (gateToken) {
    document.title = 'PIN required — Tab Lock';
    if (!st.gate) {
      $('title').textContent = 'Request expired';
      $('subtitle').textContent = 'Open the page again.';
      show(form, false);
      return;
    }
    $('title').textContent = `${word === 'PIN' ? 'PIN' : 'Passphrase'} required`;
    $('subtitle').textContent = `Enter your ${word} to open ${CATEGORY_LABELS[st.gate.cat] || 'this page'}.`;
    $('submit').textContent = 'Open';
    show(form, true);
  } else if (st.phase !== 'unlocked') {
    document.title = 'Locked — Tab Lock';
    $('title').textContent = 'Browser locked';
    $('subtitle').textContent = `Enter your ${word} to reopen your tabs.`;
    $('submit').textContent = 'Unlock';
    show(form, true);
  } else {
    document.title = 'Tab Lock';
    $('title').textContent = 'Unlocked';
    $('subtitle').textContent = '';
    show(form, false);
  }
  renderProblems();
  if (!form.classList.contains('hidden')) {
    input.focus();
    backoffCountdown(st.waitMs, input, $('submit'), $('msg'));
  }
}

function renderProblems(lastResult) {
  if (gateToken || st.phase !== 'unlocked') { show($('problems'), false); return; }
  const parts = [];
  const failed = lastResult?.failedTabs || [];
  if (st.notice === 'restore-failed' || (st.savedChunks > 0 && st.oldChunks === 0 && st.lostChunks === 0)) {
    parts.push(`${st.savedTabs} saved tab(s) are still in the vault. Enter your PIN and choose Retry restore.`);
  }
  if (st.oldChunks > 0) parts.push('Your PIN was changed by the installer. Tabs saved before the change need the previous PIN.');
  if (st.lostChunks > 0) parts.push('Some saved tabs were locked with a temporary key that was lost when the browser restarted. They cannot be recovered.');
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
  show($('retry'), st.savedChunks > st.oldChunks + st.lostChunks);
  show($('discard'), st.oldChunks + st.lostChunks > 0);
  if (!any) {
    $('title').textContent = 'Unlocked';
    $('subtitle').textContent = 'You can close this tab.';
  }
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
$('discard').addEventListener('click', () => {
  if (confirm('Permanently discard the saved tabs that cannot be opened? This cannot be undone.')) recoverAction('discardUnopenable');
});

refresh();
