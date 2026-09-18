const { app, BrowserWindow, ipcMain, safeStorage, shell, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const { makeRequest, redirectCode, microsoft, minecraft } = require('./auth.cjs');
const { atomicJson, readJson, recover } = require('./files.cjs');
const { prepare, startGame } = require('./installer.cjs');
const config = require('../config/launcher.json');
const smoke = process.argv.includes('--smoke-test');
// The launcher needs no 3D acceleration; software rendering also works over Remote Desktop.
app.disableHardwareAcceleration();
const root = process.env.SOOLYN_TEST_ROOT || path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'SoolynLauncher');
if (process.env.SOOLYN_TEST_ROOT) app.setPath('userData', path.join(root, 'electron'));
const bundled = app.isPackaged ? path.join(process.resourcesPath, 'bundled') : path.join(__dirname, '..', 'bundled');
const maxMemory = Math.max(2, Math.min(16, Math.floor(os.totalmem() / 1073741824) - 2));
let win, busy = false, child, authWindow;
let state = { busy: false, running: false, account: null, phase: '플레이할 준비', detail: '본섭 전용 클라이언트', progress: null, notice: '', error: '', installed: false, memory: Math.min(4, maxMemory), maxMemory, server: '확인 중', address: config.serverAddress, version: '0.1.0' };
function update(patch) { state = { ...state, ...patch }; if (win && !win.isDestroyed()) win.webContents.send('state', state); }
async function running() {
  if (child && child.exitCode === null) return true;
  const saved = await readJson(path.join(root, 'game-process.json'), null);
  if (!saved?.pid) return false;
  try { process.kill(saved.pid, 0); return true; } catch { await fs.rm(path.join(root, 'game-process.json'), { force: true }); return false; }
}
async function saveTokens(value) {
  if (!safeStorage.isEncryptionAvailable()) throw Error('Windows 보안 저장소를 사용할 수 없습니다.');
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  const p = path.join(root, 'account.bin');
  await fs.writeFile(p + '.tmp', encrypted); await fs.rename(p + '.tmp', p);
}
async function loadTokens() {
  try { return JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(root, 'account.bin')))); }
  catch (e) { if (e.code === 'ENOENT') return null; throw Error('저장된 로그인을 읽을 수 없습니다. 다시 로그인해 주십시오.'); }
}
function showAuth() {
  const request = makeRequest(config);
  return new Promise((resolve, reject) => {
    let settled = false;
    const w = new BrowserWindow({ width: 520, height: 730, title: 'Microsoft 로그인', parent: win, autoHideMenuBar: true, webPreferences: { partition: 'soolyn-login', nodeIntegration: false, contextIsolation: true, sandbox: true } });
    authWindow = w;
    const timer = setTimeout(() => finish(Error('로그인 시간이 만료되었습니다. 다시 시도해 주십시오.')), 10 * 60 * 1000);
    function finish(error, code) {
      if (settled) return; settled = true; clearTimeout(timer); authWindow = null;
      if (!w.isDestroyed()) w.close();
      if (error) reject(error); else resolve({ code, verifier: request.verifier });
    }
    function navigate(event, url) {
      try {
        const code = redirectCode(url, config, request.state);
        if (code) { event.preventDefault(); finish(null, code); return; }
        if (new URL(url).protocol !== 'https:') { event.preventDefault(); finish(Error('지원하지 않는 로그인 이동입니다.')); }
      } catch (e) { event.preventDefault(); finish(e); }
    }
    w.webContents.on('will-redirect', navigate);
    w.webContents.on('will-navigate', navigate);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
    w.on('closed', () => finish(Error('로그인이 취소되었습니다.')));
    w.loadURL(request.url).catch(() => finish(Error('Microsoft 로그인 페이지에 연결할 수 없습니다.')));
  });
}
async function authenticate(interactive) {
  const stored = interactive ? null : await loadTokens();
  let token;
  if (stored?.refreshToken) token = await microsoft(config, { grant_type: 'refresh_token', refresh_token: stored.refreshToken });
  else {
    const { code, verifier } = await showAuth();
    token = await microsoft(config, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: config.redirectUri });
  }
  // Save rotated refresh tokens before Minecraft exchange, including API approval failures.
  await saveTokens({ refreshToken: token.refresh_token || stored?.refreshToken, profile: stored?.profile || null });
  const account = await minecraft(token.access_token);
  await saveTokens({ refreshToken: token.refresh_token || stored?.refreshToken, profile: account.profile });
  update({ account: account.profile.name });
  return account;
}
function friendlyError(e) {
  const text = e?.message || '작업을 완료하지 못했습니다.';
  // Never relay URLs, request payloads, command lines, or tokens from library errors.
  if (/[가-힣]/.test(text) && !/access_token|refresh_token|Bearer |https?:|--accessToken/i.test(text)) return text.slice(0, 260);
  return `설치 또는 연결에 실패했습니다. 인터넷 연결과 디스크 공간을 확인한 뒤 다시 시도해 주십시오. (${e?.code && /^[A-Z_0-9]+$/.test(e.code) ? e.code : '작업 실패'})`;
}
async function job(fn) {
  if (busy) return { ok: false };
  busy = true; update({ busy: true, error: '', notice: '' });
  try { await fn(); return { ok: true }; }
  catch (e) { update({ error: friendlyError(e), phase: '확인이 필요합니다', progress: null }); return { ok: false }; }
  finally { busy = false; update({ busy: false, running: await running() }); }
}
async function install() {
  if (await running()) throw Error('게임을 종료한 뒤 업데이트해 주십시오.');
  const key = await fs.readFile(path.join(__dirname, '..', 'config', 'update-public.pem'), 'utf8');
  const result = await prepare(config, root, bundled, key, update, () => state.running);
  update({ installed: true });
  return result;
}
async function ping() {
  const [host, port] = config.serverAddress.split(':');
  const result = await new Promise(resolve => {
    const socket = net.connect({ host, port: Number(port) });
    let done = false;
    const finish = value => { if (!done) { done = true; socket.destroy(); resolve(value); } };
    socket.setTimeout(3500, () => finish('응답 없음'));
    socket.on('connect', () => finish('접속 포트 응답'));
    socket.on('error', () => finish('응답 없음'));
  });
  update({ server: result });
}
const rendererUrl = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
function handle(name, fn) {
  ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win?.webContents || event.senderFrame?.url !== rendererUrl) throw Error('허용되지 않은 요청입니다.');
    return fn(...args);
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(async () => {
    await fs.mkdir(root, { recursive: true });
    state.running = await running();
    if (!state.running) await recover(root);
    const settings = await readJson(path.join(root, 'settings.json'), {});
    state.memory = Math.max(2, Math.min(maxMemory, Number(settings.memory) || state.memory));
    state.installed = !!await readJson(path.join(root, 'runtime-state.json'), null);
    try { state.account = (await loadTokens())?.profile?.name || null; } catch { state.error = '저장된 로그인을 읽을 수 없습니다. 다시 로그인해 주십시오.'; }
    win = new BrowserWindow({ width: 1080, height: 730, minWidth: 850, minHeight: 650, backgroundColor: '#101915', title: 'SoolynLauncher', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
    handle('state', () => state);
    handle('login', () => job(async () => { update({ phase: 'Microsoft 로그인' }); await authenticate(true); update({ phase: '로그인 완료', detail: state.account }); }));
    handle('logout', () => job(async () => { await fs.rm(path.join(root, 'account.bin'), { force: true }); await session.fromPartition('soolyn-login').clearStorageData(); update({ account: null, phase: '로그아웃했습니다' }); }));
    handle('install', () => job(install));
    handle('play', () => job(async () => {
      if (await running()) throw Error('게임이 이미 실행 중입니다.');
      update({ phase: '계정 확인', progress: null });
      const account = await authenticate(false);
      const { runtime } = await install();
      update({ phase: '게임 실행 중', detail: config.serverAddress });
      child = await startGame(root, runtime, account, config.serverAddress, state.memory * 1024);
      if (!child.pid) throw Error('게임 프로세스를 시작하지 못했습니다.');
      await atomicJson(path.join(root, 'game-process.json'), { pid: child.pid, startedAt: Date.now() });
      update({ running: true });
      // Drain game pipes without persisting launch arguments or credentials.
      child.stdout?.resume(); child.stderr?.resume();
      child.on('error', () => update({ error: '게임 프로세스 실행에 실패했습니다.' }));
      child.on('exit', async code => { child = null; await fs.rm(path.join(root, 'game-process.json'), { force: true }); update({ running: false, phase: code === 0 ? '플레이할 준비' : '게임이 종료되었습니다', detail: '', error: code === 0 ? '' : '게임 로그는 게임 폴더의 logs/latest.log에서 확인할 수 있습니다.' }); });
    }));
    handle('memory', async value => {
      if (busy || !Number.isInteger(value) || value < 2 || value > maxMemory) return;
      await atomicJson(path.join(root, 'settings.json'), { memory: value }); update({ memory: value });
    });
    handle('folder', () => shell.openPath(root));
    handle('releases', () => shell.openExternal(config.repository + '/releases'));
    win.on('close', event => { if (busy) { event.preventDefault(); update({ notice: '진행 중인 작업이 끝난 뒤 닫을 수 있습니다.' }); } });
    await win.loadFile(path.join(__dirname, 'ui', 'index.html'));
    if (smoke) {
      win.show();
      await new Promise(resolve => setTimeout(resolve, 1200));
      const ui = await win.webContents.executeJavaScript('({title:document.title,account:document.getElementById("account").textContent,bridge:typeof window.launcher,play:document.getElementById("play").disabled})');
      await atomicJson(path.join(root, 'smoke.json'), { ready: true, packaged: app.isPackaged, state, ui, electron: process.versions.electron });
      try { await fs.writeFile(path.join(root, 'smoke.png'), (await win.webContents.capturePage()).toPNG()); } catch { /* UI readiness is also verified by the renderer probe. */ }
      app.quit();
    } else { ping(); setInterval(ping, 60000).unref(); }
  }).catch(async e => { await fs.mkdir(root, { recursive: true }); await fs.writeFile(path.join(root, 'startup-error.txt'), smoke ? String(e.stack) : friendlyError(e)); app.quit(); });
  app.on('window-all-closed', () => { if (!busy) app.quit(); });
}
