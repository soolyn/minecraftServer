const $ = id => document.getElementById(id);
function render(s) {
  $('account').textContent = s.account || '로그인되지 않음';
  $('login').classList.toggle('hidden', !!s.account);
  $('logout').classList.toggle('hidden', !s.account);
  $('phase').textContent = s.phase;
  $('detail').textContent = s.detail || (s.running ? '게임이 실행 중입니다.' : '본섭 전용 클라이언트');
  $('server').textContent = s.server;
  $('address').textContent = s.address;
  $('percent').textContent = s.busy && s.progress !== null ? `${Math.round(Math.min(1, s.progress) * 100)}%` : '';
  $('bar').style.width = `${Math.min(1, s.progress || 0) * 100}%`;
  $('bar').classList.toggle('indeterminate', s.busy && s.progress === null);
  $('message').textContent = s.error || s.notice || '';
  $('message').classList.toggle('error', !!s.error);
  $('play').disabled = s.busy || s.running;
  $('play').firstChild.textContent = s.running ? '실행 중 ' : s.busy ? '준비 중 ' : '플레이 ';
  for (const id of ['install', 'login', 'logout', 'memory']) $(id).disabled = s.busy || (id === 'install' && s.running);
  if (!$('memory').options.length) for (let n = 2; n <= s.maxMemory; n++) { const o = document.createElement('option'); o.value = n; o.textContent = n + ' GB'; $('memory').append(o); }
  $('memory').value = s.memory;
}
for (const action of ['login', 'logout', 'install', 'play', 'folder', 'releases']) $(action).addEventListener('click', async () => {
  try { await window.launcher[action](); } catch { $('message').textContent = '요청을 완료하지 못했습니다. 다시 시도해 주십시오.'; }
});
$('memory').addEventListener('change', () => window.launcher.memory(Number($('memory').value)));
window.launcher.onState(render);
window.launcher.state().then(render);
