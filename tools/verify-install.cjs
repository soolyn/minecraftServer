const path = require('node:path');
const fs = require('node:fs/promises');
const { prepare } = require('../src/installer.cjs');
const config = require('../config/launcher.json');
const project = path.resolve(__dirname, '..');
let last = '';
(async () => {
  const result = await prepare(config, path.join(project, 'qa-instance'), path.join(project, 'bundled'), await fs.readFile(path.join(project, 'config/update-public.pem'), 'utf8'), s => { const text = s.phase || s.notice; if (text && text !== last) { console.log(text); last = text; } });
  console.log(JSON.stringify(result.runtime));
  await fs.writeFile(path.join(project, 'qa-instance/install-verified.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), ...result.runtime, revision: result.manifest.revision }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
