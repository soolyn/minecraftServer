const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { hash, atomicJson, readJson, verifyEnvelope, installMods, recover, download } = require('../src/files.cjs');
const { makeRequest, redirectCode, microsoft, minecraft } = require('../src/auth.cjs');
const config = require('../config/launcher.json');
const keys = crypto.generateKeyPairSync('ed25519');
const sign = m => { const b = Buffer.from(JSON.stringify(m)); return { payload: b.toString('base64'), signature: crypto.sign(null, b, keys.privateKey).toString('base64') }; };
function manifest(files, revision = 1) { return { schema: 1, revision, version: '1.2.0', minecraft: '26.2', fabric: '0.19.5', files }; }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soolyn-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundled = path.join(root, 'bundle'); await fs.mkdir(bundled);
  const bytes = Buffer.from('verified mod bytes'); const name = 'mod-1.jar';
  await fs.writeFile(path.join(bundled, name), bytes);
  const file = { name, sha256: await hash(path.join(bundled, name)), size: bytes.length, url: 'https://example.com/mod.jar' };
  return { root, bundled, file, bytes };
}
test('signed manifest verifies and rejects tampering, duplicate names and Windows path escapes', () => {
  const f = { name: 'a.jar', sha256: 'a'.repeat(64), size: 9, url: 'https://example.com/a.jar' };
  assert.equal(verifyEnvelope(sign(manifest([f])), keys.publicKey).revision, 1);
  const bad = sign(manifest([f])); bad.payload = Buffer.from('{}').toString('base64');
  assert.throws(() => verifyEnvelope(bad, keys.publicKey));
  for (const name of ['../evil.jar', 'C:evil.jar', 'a/b.jar', 'a\\b.jar', 'NUL.jar']) assert.throws(() => verifyEnvelope(sign(manifest([{ ...f, name }])), keys.publicKey));
  assert.throws(() => verifyEnvelope(sign(manifest([f, { ...f, name: 'A.jar' }])), keys.publicKey));
  assert.throws(() => verifyEnvelope(sign(manifest([{ ...f, url: 'http://example.com/a' }])), keys.publicKey));
});
test('update replaces old managed files, preserves personal settings and unrelated mods', async t => {
  const { root, bundled, file } = await fixture(t);
  await fs.mkdir(path.join(root, 'game/mods'), { recursive: true });
  await fs.writeFile(path.join(root, 'game/mods/old.jar'), 'old');
  await fs.writeFile(path.join(root, 'game/mods/personal.jar'), 'personal');
  await fs.writeFile(path.join(root, 'game/options.txt'), 'fov:90');
  await atomicJson(path.join(root, 'installed.json'), { revision: 1, managed: ['old.jar'] });
  await installMods(root, manifest([file], 2), bundled);
  assert.equal(await fs.readFile(path.join(root, 'game/options.txt'), 'utf8'), 'fov:90');
  assert.equal(await fs.readFile(path.join(root, 'game/mods/personal.jar'), 'utf8'), 'personal');
  assert.equal(await hash(path.join(root, 'game/mods', file.name)), file.sha256);
  await assert.rejects(fs.access(path.join(root, 'game/mods/old.jar')));
  await assert.rejects(installMods(root, manifest([file], 1), bundled), /이전 배포/);
});
test('failed or corrupt download does not replace working mods', async t => {
  const { root, bundled, file } = await fixture(t);
  await installMods(root, manifest([file]), bundled);
  const next = { ...file, name: 'next.jar' };
  await assert.rejects(installMods(root, manifest([next], 2), bundled, undefined, async (_, dest) => fs.writeFile(dest, 'corrupt')), /검증 실패/);
  assert.equal(await hash(path.join(root, 'game/mods', file.name)), file.sha256);
  assert.equal((await readJson(path.join(root, 'installed.json'))).revision, 1);
});
test('repair restores a modified managed file and running game blocks updates', async t => {
  const { root, bundled, file } = await fixture(t);
  await installMods(root, manifest([file]), bundled);
  await fs.writeFile(path.join(root, 'game/mods', file.name), 'corrupt');
  await assert.rejects(installMods(root, manifest([file]), bundled, undefined, undefined, () => true), /종료/);
  await installMods(root, manifest([file]), bundled);
  assert.equal(await hash(path.join(root, 'game/mods', file.name)), file.sha256);
});
test('interrupted swap rolls back old mods and old installation metadata', async t => {
  const { root, bundled, file } = await fixture(t);
  await installMods(root, manifest([file]), bundled);
  const oldState = await readJson(path.join(root, 'installed.json'));
  await fs.rename(path.join(root, 'game/mods'), path.join(root, 'mods-backup'));
  await fs.mkdir(path.join(root, 'game/mods')); await fs.writeFile(path.join(root, 'game/mods/bad.jar'), 'incomplete');
  await atomicJson(path.join(root, 'installed.json'), { revision: 2 });
  await atomicJson(path.join(root, 'update-journal.json'), { oldState, hadMods: true });
  await recover(root);
  assert.equal(await hash(path.join(root, 'game/mods', file.name)), file.sha256);
  assert.equal((await readJson(path.join(root, 'installed.json'))).revision, 1);
  await assert.rejects(fs.access(path.join(root, 'game/mods/bad.jar')));
});
test('PKCE request is unique and only exact redirect/state returns an authorization code', () => {
  const req = makeRequest(config), second = makeRequest(config), u = new URL(req.url);
  assert.notEqual(req.state, second.state);
  assert.equal(u.searchParams.get('code_challenge'), crypto.createHash('sha256').update(req.verifier).digest('base64url'));
  assert.equal(redirectCode(config.redirectUri + '?code=test&state=' + req.state, config, req.state), 'test');
  assert.equal(redirectCode('https://example.com/?code=test&state=' + req.state, config, req.state), null);
  assert.throws(() => redirectCode(config.redirectUri + '?code=test&state=wrong', config, req.state));
});
test('Microsoft -> Xbox -> XSTS -> Minecraft profile uses our public client and token chain', async () => {
  let step = 0;
  const fetcher = async (url, opts) => {
    const bodies = [ { access_token: 'msa', refresh_token: 'refresh' }, { Token: 'xbox' }, { Token: 'xsts', DisplayClaims: { xui: [{ uhs: '123' }] } }, { access_token: 'mc', expires_in: 3600 }, { id: 'a'.repeat(32), name: 'Player' } ];
    if (step === 0) { assert.equal(opts.body.get('client_id'), config.microsoftClientId); assert.equal(opts.body.has('client_secret'), false); }
    if (step === 1) assert.equal(JSON.parse(opts.body).Properties.RpsTicket, 'd=msa');
    if (step === 3) assert.equal(JSON.parse(opts.body).identityToken, 'XBL3.0 x=123;xsts');
    if (step === 4) assert.equal(opts.headers.Authorization, 'Bearer mc');
    return { ok: true, json: async () => bodies[step++] };
  };
  const ms = await microsoft(config, { grant_type: 'authorization_code', code: 'one-time' }, fetcher);
  const mc = await minecraft(ms.access_token, fetcher);
  assert.equal(mc.profile.name, 'Player'); assert.equal(step, 5);
});
test('API rejection is actionable and never echoes token response details', async () => {
  await assert.rejects(minecraft('secret', async url => ({ ok: false, status: 403, json: async () => ({ error: 'secret-request-token' }) })), /HTTP 403/);
});
test('download interruption leaves destination untouched and removes partial file', async t => {
  const { root } = await fixture(t), dest = path.join(root, 'file.jar');
  await fs.writeFile(dest, 'original');
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => ({ ok: true, url: 'https://example.com/test', headers: new Headers(), body: (async function* () { yield Buffer.from('part'); throw Error('network lost'); })() });
  await assert.rejects(download('https://example.com/test', dest, '0'.repeat(64), 12), /network lost/);
  assert.equal(await fs.readFile(dest, 'utf8'), 'original');
  assert.equal((await fs.readdir(root)).some(n => n.includes('.part-')), false);
});
