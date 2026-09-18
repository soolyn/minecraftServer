const path = require('node:path');
const fs = require('node:fs/promises');
const { exists } = require('../src/files.cjs');
const { prepare } = require('../src/installer.cjs');
const config = require('../config/launcher.json');
(async () => {
  const project = path.resolve(__dirname, '..'), root = path.join(process.env.LOCALAPPDATA, 'SoolynLauncher');
  const running = require('../src/files.cjs').readJson;
  const proc = await running(path.join(root, 'game-process.json'), null);
  if (proc?.pid) { try { process.kill(proc.pid, 0); throw Error('Game still running'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
  for (const name of ['runtime', 'java']) if (!await exists(path.join(root, name)) && await exists(path.join(project, 'qa-instance', name))) await fs.cp(path.join(project, 'qa-instance', name), path.join(root, name), { recursive: true });
  let last = '';
  await prepare(config, root, path.join(project, 'bundled'), await fs.readFile(path.join(project, 'config/update-public.pem'), 'utf8'), s => { if (s.phase && last !== s.phase) { console.log(s.phase); last = s.phase; } });
  console.log('Local isolated launcher instance prepared.');
})().catch(e => { console.error(e.message); process.exitCode = 1; });
