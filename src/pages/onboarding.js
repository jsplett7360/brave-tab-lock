import { send, $, applyBrowserText, show, setMsg, failureText, configureSecretInput, showRecoveryCode, RECOVERY_PANEL_HTML, RECOVERY_TEXT } from './common.js';

applyBrowserText();

$('code-panel').innerHTML = RECOVERY_PANEL_HTML; // static markup, no data
$('rc-skip-text').textContent = RECOVERY_TEXT.skip;
// The PIN just chosen, kept in this page's memory only until the recovery step is done.
let justSet = null;
let recoveryStep = false;

async function refresh() {
  const st = await send({ type: 'status' });
  const managedPending = st.managed && !st.managedSetupDone;
  show($('managed-setup'), managedPending);
  show($('local-setup'), !st.managed && !st.configured);
  show($('recovery-step'), recoveryStep);
  show($('done'), st.configured && !managedPending && !recoveryStep);
  if (managedPending) {
    $('m1-label').textContent = st.kind === 'passphrase' ? 'Master passphrase' : 'Master PIN';
    configureSecretInput($('m1'), st.kind);
  }
  $('incog-status').textContent = st.incognitoAllowed ? '(Already on.)' : '(Currently off.)';
}

$('kind').addEventListener('change', () => configureSecretInput($('s1'), $('kind').value));

$('local-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = $('s1').value;
  if (next !== $('s2').value) { setMsg($('local-msg'), 'The two entries don’t match.', 'error'); return; }
  setMsg($('local-msg'), 'Saving… (this takes a moment)');
  const res = await send({ type: 'setSecret', next, kind: $('kind').value });
  $('s1').value = ''; $('s2').value = '';
  if (!res?.ok) { setMsg($('local-msg'), failureText(res), 'error'); return; }
  setMsg($('local-msg'), '');
  justSet = next;
  recoveryStep = true;
  refresh();
});

function finishRecoveryStep() {
  justSet = null;
  recoveryStep = false;
  refresh();
}

$('rc-create').addEventListener('click', async () => {
  setMsg($('rc-msg'), 'Creating… (this takes a moment)');
  const res = await send({ type: 'createRecovery', secret: justSet || '' });
  if (!res?.ok) { setMsg($('rc-msg'), failureText(res), 'error'); return; }
  setMsg($('rc-msg'), '');
  justSet = null;
  show($('recovery-choice'), false);
  showRecoveryCode($('code-panel'), res.code, finishRecoveryStep);
});
$('rc-skip').addEventListener('click', () => { show($('recovery-choice'), false); show($('rc-skip-confirm'), true); $('rc-skip-yes').focus(); });
$('rc-skip-back').addEventListener('click', () => { show($('rc-skip-confirm'), false); show($('recovery-choice'), true); $('rc-create').focus(); });
$('rc-skip-yes').addEventListener('click', finishRecoveryStep);

$('managed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const secret = $('m1').value;
  $('m1').value = '';
  setMsg($('managed-msg'), 'Checking… (this takes a moment)');
  const res = await send({ type: 'setupManaged', secret });
  if (!res?.ok) { setMsg($('managed-msg'), failureText(res), 'error'); return; }
  setMsg($('managed-msg'), '');
  refresh();
});

refresh();
