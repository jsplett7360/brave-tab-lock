import { send, $, show, setMsg, failureText, configureSecretInput } from './common.js';

async function refresh() {
  const st = await send({ type: 'status' });
  const managedPending = st.managed && !st.managedSetupDone;
  show($('managed-setup'), managedPending);
  show($('local-setup'), !st.managed && !st.configured);
  show($('done'), st.configured && !managedPending);
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
  refresh();
});

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
