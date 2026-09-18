const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function hash(p, algorithm = 'sha256') {
  const h = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(p)) h.update(chunk);
  return h.digest('hex');
}
async function atomicJson(p, value) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const temp = p + '.tmp-' + crypto.randomUUID();
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, p);
}
async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
function httpsUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password) throw Error('HTTPS 다운로드 주소가 필요합니다.');
  return u;
}
async function response(url, options = {}) {
  httpsUrl(url);
  const r = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(120000) });
  if (!r.ok) { const e = Error(`다운로드 서버 응답: HTTP ${r.status}`); e.status = r.status; throw e; }
  httpsUrl(r.url || url);
  return r;
}
async function jsonUrl(url) { return (await response(url)).json(); }
async function valid(p, checksum, size, algorithm = 'sha256') {
  try {
    const st = await fs.lstat(p);
    return st.isFile() && !st.isSymbolicLink() && (size === undefined || st.size === size) && (!checksum || await hash(p, algorithm) === checksum);
  } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
async function download(url, p, checksum, size, algorithm = 'sha256', progress = () => {}) {
  if (await valid(p, checksum, size, algorithm)) return;
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.part-' + crypto.randomUUID();
  try {
    const r = await response(url);
    const handle = await fs.open(tmp, 'wx');
    let bytes = 0;
    try {
      for await (const chunk of r.body) {
        bytes += chunk.length;
        if (size !== undefined && bytes > size) throw Error('파일 크기가 배포 정보와 다릅니다.');
        await handle.writeFile(chunk);
        progress(bytes, size || Number(r.headers.get('content-length')) || 0);
      }
    } finally { await handle.close(); }
    if (!await valid(tmp, checksum, size, algorithm)) throw Error('파일 무결성 검증에 실패했습니다.');
    await fs.rename(tmp, p);
  } finally { await fs.rm(tmp, { force: true }); }
}
function verifyEnvelope(envelope, publicKey) {
  if (typeof envelope?.payload !== 'string' || typeof envelope?.signature !== 'string') throw Error('업데이트 서명이 없습니다.');
  const payload = Buffer.from(envelope.payload, 'base64');
  if (payload.length > 1024 * 1024 || !crypto.verify(null, payload, publicKey, Buffer.from(envelope.signature, 'base64'))) throw Error('업데이트 서명이 올바르지 않습니다.');
  const m = JSON.parse(payload.toString('utf8'));
  if (m.schema !== 1 || !Number.isSafeInteger(m.revision) || m.revision < 1 || !Array.isArray(m.files) || !m.files.length || m.files.length > 100) throw Error('배포 정보 형식이 올바르지 않습니다.');
  for (const key of ['minecraft', 'fabric', 'version']) if (typeof m[key] !== 'string' || !/^[a-zA-Z0-9._+-]{1,80}$/.test(m[key])) throw Error('잘못된 버전입니다.');
  const seen = new Set();
  for (const f of m.files) {
    if (typeof f.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,150}\.jar$/.test(f.name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(f.name) || seen.has(f.name.toLowerCase())) throw Error('잘못된 모드 파일 경로입니다.');
    seen.add(f.name.toLowerCase());
    if (!/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 1 || f.size > 512 * 1024 * 1024) throw Error('잘못된 파일 검증 정보입니다.');
    httpsUrl(f.url);
  }
  return m;
}
async function plainDirectory(dir) {
  const s = await fs.lstat(dir);
  if (s.isSymbolicLink() || !s.isDirectory()) throw Error('설치 폴더에 링크가 있어 작업을 중단했습니다.');
  for (const entry of await fs.readdir(dir)) {
    const p = path.join(dir, entry), st = await fs.lstat(p);
    if (st.isSymbolicLink()) throw Error('모드 폴더에 링크가 있어 작업을 중단했습니다.');
    if (st.isDirectory()) await plainDirectory(p);
  }
}
async function recover(root) {
  const journal = await readJson(path.join(root, 'update-journal.json'), null);
  if (!journal) return;
  const game = path.join(root, 'game'), backup = path.join(root, 'mods-backup');
  if (await exists(backup)) {
    await fs.rm(path.join(game, 'mods'), { recursive: true, force: true });
    await fs.rename(backup, path.join(game, 'mods'));
  } else if (!journal.hadMods) await fs.rm(path.join(game, 'mods'), { recursive: true, force: true });
  await atomicJson(path.join(root, 'installed.json'), journal.oldState);
  await fs.rm(path.join(root, 'update-journal.json'), { force: true });
}
async function installMods(root, manifest, bundled, emit = () => {}, fetchFile = download, isRunning = () => false) {
  if (isRunning()) throw Error('게임을 종료한 뒤 업데이트해 주십시오.');
  await fs.mkdir(root, { recursive: true });
  await recover(root);
  const game = path.join(root, 'game'), mods = path.join(game, 'mods');
  await fs.mkdir(game, { recursive: true });
  const oldState = await readJson(path.join(root, 'installed.json'), null);
  if (oldState && manifest.revision < oldState.revision) throw Error('이전 배포 버전으로의 자동 변경을 차단했습니다.');
  const stage = path.join(root, 'mods-staging'), backup = path.join(root, 'mods-backup');
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage);
  const hadMods = await exists(mods);
  if (hadMods) {
    await plainDirectory(mods);
    await fs.cp(mods, stage, { recursive: true });
    for (const name of oldState?.managed || []) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*\.jar$/.test(name)) throw Error('기존 설치 기록이 손상되었습니다.');
      await fs.rm(path.join(stage, name), { force: true });
    }
  }
  for (let i = 0; i < manifest.files.length; i++) {
    const f = manifest.files[i], dest = path.join(stage, f.name);
    emit({ phase: '서버 모드 설치', detail: f.name, progress: i / manifest.files.length });
    const candidates = [path.join(mods, f.name), path.join(bundled, f.name)];
    let copied = false;
    for (const source of candidates) if (await valid(source, f.sha256, f.size)) { await fs.copyFile(source, dest); copied = true; break; }
    if (!copied) await fetchFile(f.url, dest, f.sha256, f.size);
    if (!await valid(dest, f.sha256, f.size)) throw Error('모드 검증 실패: ' + f.name);
  }
  if (isRunning()) throw Error('게임 실행 중에는 파일을 변경할 수 없습니다.');
  await fs.rm(backup, { recursive: true, force: true });
  await atomicJson(path.join(root, 'update-journal.json'), { oldState, hadMods });
  try {
    if (hadMods) await fs.rename(mods, backup);
    await fs.rename(stage, mods);
    await atomicJson(path.join(root, 'installed.json'), { ...manifest, managed: manifest.files.map(f => f.name) });
    await fs.rm(path.join(root, 'update-journal.json'));
  } catch (e) { await recover(root); throw e; }
  // Keep the previous directory until the next successful update for manual recovery.
  return manifest;
}
module.exports = { exists, hash, atomicJson, readJson, httpsUrl, response, jsonUrl, valid, download, verifyEnvelope, recover, installMods };
