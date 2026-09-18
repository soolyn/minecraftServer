const fs = require('node:fs/promises');
const path = require('node:path');
const { Version, MinecraftFolder, launch } = require('@xmcl/core');
const installer = require('@xmcl/installer');
const { jsonUrl, download, verifyEnvelope, readJson, atomicJson, installMods } = require('./files.cjs');

async function selectManifest(config, root, bundled, publicKey, emit) {
  const localEnvelope = await readJson(path.join(bundled, 'manifest.json'));
  const local = verifyEnvelope(localEnvelope, publicKey);
  const cached = await readJson(path.join(root, 'verified-manifest.json'), null);
  let selected = local, envelope = localEnvelope;
  if (cached) { const m = verifyEnvelope(cached, publicKey); if (m.revision >= selected.revision) { selected = m; envelope = cached; } }
  try {
    const remoteEnvelope = await jsonUrl(config.updateManifestUrl);
    const remote = verifyEnvelope(remoteEnvelope, publicKey);
    if (remote.revision < selected.revision) throw Error('업데이트 서버의 버전이 설치 기준보다 이전입니다.');
    selected = remote; envelope = remoteEnvelope;
  } catch (e) {
    // Network unavailability is allowed only with a previously trusted or bundled release.
    if (e.status === 404 || e.name === 'TimeoutError' || e.name === 'TypeError' || e.name === 'AbortError') {
      emit({ notice: e.status === 404 ? '등록된 기본 배포본을 사용합니다.' : '업데이트 서버 연결 불가 · 확인된 배포본을 사용합니다.' });
    } else throw e;
  }
  await atomicJson(path.join(root, 'verified-manifest.json'), envelope);
  return selected;
}
async function installGame(root, manifest, emit = () => {}) {
  const resources = path.join(root, 'runtime'), folder = new MinecraftFolder(resources);
  const tracker = new installer.ProgressTrackerMultiple();
  const runtime = installer.createDefaultNodeInstallRuntime({ maxConcurrency: 8, tracker });
  let phase = 'Minecraft 설치';
  const timer = setInterval(() => emit({ phase, progress: tracker.total > 0 ? tracker.progress / tracker.total : null, detail: tracker.total > 0 ? `${Math.floor(tracker.progress / 1048576)} / ${Math.ceil(tracker.total / 1048576)} MB` : '파일 확인 중' }), 400);
  const executeFiles = async (id, files) => {
    if (files.length) await installer.executeInstallManifest({ schemaVersion: 1, tasks: [{ id, type: 'files', files }] }, runtime);
  };
  try {
    emit({ phase, detail: manifest.minecraft, progress: null });
    const list = await jsonUrl('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const version = list.versions.find(v => v.id === manifest.minecraft);
    if (!version) throw Error('공식 배포 목록에서 지정된 Minecraft 버전을 찾지 못했습니다.');
    const versionFile = path.join(resources, 'versions', version.id, version.id + '.json');
    await download(version.url, versionFile, version.sha1, undefined, 'sha1');
    let resolved = await Version.parse(resources, version.id);
    const client = installer.resolveMinecraftJarInstallFile(resolved);
    if (client) await executeFiles('client', [client]);
    phase = 'Fabric 설치';
    const fabricId = await installer.executeInstallWorkflow(installer.createFabricInstallWorkflow({ minecraftVersion: manifest.minecraft, version: manifest.fabric, minecraft: resources }), runtime);
    resolved = await Version.parse(resources, fabricId);
    phase = '게임 라이브러리 설치';
    await executeFiles('libraries', installer.resolveLibraryInstallFiles(resolved.libraries, folder));
    phase = '게임 리소스 설치';
    await executeFiles('asset-metadata', installer.resolveAssetMetadataInstallFiles(resolved, folder));
    await executeFiles('asset-objects', await installer.resolveAssetObjectInstallFiles(resolved, folder));
    phase = 'Java 설치';
    const javaIndex = await jsonUrl(installer.DEFAULT_RUNTIME_ALL_URL);
    const target = javaIndex['windows-x64']?.[resolved.javaVersion.component]?.[0];
    if (!target) throw Error('공식 Java 런타임을 찾을 수 없습니다.');
    const javaRoot = path.join(root, 'java', resolved.javaVersion.component);
    await installer.executeInstallWorkflow(installer.createJavaRuntimeInstallWorkflow({ target, destination: javaRoot }), runtime);
    const javaPath = path.join(javaRoot, 'bin', 'java.exe');
    const java = await installer.resolveJava(javaPath);
    if (!java || java.majorVersion !== resolved.javaVersion.majorVersion) throw Error('Java 버전 검증에 실패했습니다.');
    return { javaPath, version: fabricId, resources };
  } finally { clearInterval(timer); }
}
async function prepare(config, root, bundled, publicKey, emit, isRunning = () => false) {
  if (isRunning()) throw Error('게임을 종료한 뒤 설치해 주십시오.');
  const manifest = await selectManifest(config, root, bundled, publicKey, emit);
  const runtime = await installGame(root, manifest, emit);
  await installMods(root, manifest, bundled, emit, undefined, isRunning);
  await atomicJson(path.join(root, 'runtime-state.json'), runtime);
  emit({ phase: '설치 완료', progress: 1, detail: `본섭 ${manifest.version}`, notice: '' });
  return { manifest, runtime };
}
async function startGame(root, runtime, account, address, memoryMB) {
  if (!account?.accessToken || !account?.profile) throw Error('Microsoft 로그인이 필요합니다.');
  return launch({ gamePath: path.join(root, 'game'), resourcePath: runtime.resources, javaPath: runtime.javaPath, version: runtime.version, gameProfile: account.profile, accessToken: account.accessToken, minMemory: 1024, maxMemory: memoryMB, launcherName: 'SoolynLauncher', launcherBrand: 'Soolyn', quickPlayMultiplayer: address, extraExecOption: { windowsHide: true } });
}
module.exports = { selectManifest, installGame, prepare, startGame };
