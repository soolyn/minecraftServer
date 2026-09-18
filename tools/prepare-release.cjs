// Run locally by the release operator. The signing key is never packaged or uploaded.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { hash, atomicJson } = require('../src/files.cjs');
async function main() {
  const project = path.resolve(__dirname, '..');
  const operator = path.join(process.env.LOCALAPPDATA, 'SoolynLauncherOperator');
  await fs.mkdir(operator, { recursive: true });
  const privateFile = path.join(operator, 'update-signing-private.pem');
  let privateKey;
  try { privateKey = await fs.readFile(privateFile, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const keys = crypto.generateKeyPairSync('ed25519');
    privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
    await fs.writeFile(privateFile, privateKey, { flag: 'wx', mode: 0o600 });
  }
  await fs.writeFile(path.join(project, 'config/update-public.pem'), crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }));
  const bundled = path.join(project, 'bundled');
  await fs.mkdir(bundled, { recursive: true });
  const own = path.resolve(project, '../production-1.2.0/release/sooly-ui-1.2.0-dragon3.jar');
  const expected = 'fcd2c61f5ce7669543715184835a8132a4fc825f0a66c773e07c1de941ab55c0';
  if (await hash(own) !== expected) throw Error('Production mod does not match approved release');
  const name = 'sooly-ui-1.2.0-dragon3.jar';
  await fs.copyFile(own, path.join(bundled, name));
  const files = [{ name, sha256: expected, size: (await fs.stat(own)).size, url: `https://github.com/soolyn/minecraftServer/releases/download/client-1.2.0-r1/${name}` }];
  const known = [
    ['fabric-api-0.159.0+26.2.jar', '3f3a5d96e6a8f554a72e71fb507d6a979ca16d9190c305ceb1300f1d01e733ee', 2535793, 'P7dR8mSH/versions/BgeCGgGZ/fabric-api-0.159.0%2B26.2.jar'],
    ['sodium-fabric-0.9.1+mc26.2.jar', 'de406c7a0ca5e748dfbe44740278400882a44e3109e2584b243ec02d4003344b', 1834384, 'AANobbMI/versions/2Yom1N68/sodium-fabric-0.9.1%2Bmc26.2.jar'],
    ['iris-fabric-1.11.2+mc26.2.jar', 'df0e2ccddaea17b191eda32b21c979e131bc9d4ef4f831113b50b461fc4a3804', 2820763, 'YL57xq9U/versions/oaD6KQls/iris-fabric-1.11.2%2Bmc26.2.jar']
  ];
  for (const [name, sha256, size, url] of known) files.push({ name, sha256, size, url: 'https://cdn.modrinth.com/data/' + url });
  const manifest = { schema: 1, revision: 1, version: '1.2.0-r1', minecraft: '26.2', fabric: '0.19.5', files };
  const payload = Buffer.from(JSON.stringify(manifest));
  const envelope = { payload: payload.toString('base64'), signature: crypto.sign(null, payload, privateKey).toString('base64') };
  await atomicJson(path.join(bundled, 'manifest.json'), envelope);
  await fs.mkdir(path.join(project, 'release-assets'), { recursive: true });
  await atomicJson(path.join(project, 'release-assets/manifest.json'), envelope);
  await fs.copyFile(own, path.join(project, 'release-assets', name));
  console.log('Signed production bundle prepared. Private signing key stays in the local operator directory.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
