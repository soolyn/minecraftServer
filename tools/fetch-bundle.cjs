const path = require('node:path');
const fs = require('node:fs/promises');
const config = require('../config/launcher.json');
const { jsonUrl, verifyEnvelope, atomicJson, download } = require('../src/files.cjs');
(async () => {
  const root = path.resolve(__dirname, '..');
  const envelope = await jsonUrl(config.updateManifestUrl);
  const manifest = verifyEnvelope(envelope, await fs.readFile(path.join(root, 'config/update-public.pem'), 'utf8'));
  for (const file of manifest.files.filter(f => f.name.startsWith('sooly-ui-'))) await download(file.url, path.join(root, 'bundled', file.name), file.sha256, file.size);
  await atomicJson(path.join(root, 'bundled/manifest.json'), envelope);
  console.log('Verified production bundle ready.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
