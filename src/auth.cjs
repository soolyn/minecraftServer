const crypto = require('node:crypto');
const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
function makeRequest(config) {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  const query = new URLSearchParams({ client_id: config.microsoftClientId, response_type: 'code', redirect_uri: config.redirectUri, scope: SCOPE, response_mode: 'query', state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), prompt: 'select_account' });
  return { verifier, state, url: `${AUTHORITY}/authorize?${query}` };
}
function redirectCode(url, config, state) {
  const u = new URL(url), redirect = new URL(config.redirectUri);
  if (u.origin !== redirect.origin || u.pathname !== redirect.pathname) return null;
  if (u.searchParams.get('state') !== state) throw Error('로그인 응답 검증에 실패했습니다. 다시 로그인해 주십시오.');
  if (u.searchParams.has('error')) throw Error('Microsoft 로그인이 취소되었거나 거부되었습니다.');
  const code = u.searchParams.get('code');
  if (!code) throw Error('로그인 인증 코드가 없습니다.');
  return code;
}
async function api(url, options = {}, fetcher = fetch) {
  const r = await fetcher(url, { ...options, signal: AbortSignal.timeout(45000) });
  let data; try { data = await r.json(); } catch { throw Error('인증 서버에서 잘못된 응답을 받았습니다.'); }
  if (!r.ok) {
    if (data.XErr === 2148916233) throw Error('이 Microsoft 계정에서 Xbox 프로필을 먼저 만들어 주십시오.');
    if (data.XErr === 2148916238) throw Error('Xbox 가족 계정 설정을 확인해 주십시오.');
    if (url.includes('minecraftservices.com') && r.status === 403) throw Error('Minecraft API 접근이 거부되었습니다. 앱 승인 또는 계정 접근 권한을 확인해야 합니다. (HTTP 403)');
    if (url.endsWith('/minecraft/profile') && r.status === 404) throw Error('이 계정에서 Minecraft Java 프로필을 찾을 수 없습니다. 게임 소유권과 프로필 생성을 확인해 주십시오.');
    const code = typeof data.error === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(data.error) ? ` / ${data.error}` : '';
    throw Error(`로그인 처리 실패: HTTP ${r.status}${code}`);
  }
  return data;
}
async function microsoft(config, grant, fetcher) {
  const data = await api(`${AUTHORITY}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.microsoftClientId, scope: SCOPE, ...grant }) }, fetcher);
  if (!data.access_token) throw Error('Microsoft 인증 토큰이 없습니다.');
  return data;
}
async function minecraft(accessToken, fetcher) {
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }, fetcher);
  const xbox = await post('https://user.auth.xboxlive.com/user/authenticate', { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${accessToken}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' });
  const xsts = await post('https://xsts.auth.xboxlive.com/xsts/authorize', { Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' });
  const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs;
  if (!xsts.Token || !uhs) throw Error('Xbox 인증 응답이 올바르지 않습니다.');
  const mc = await post('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
  if (!mc.access_token) throw Error('Minecraft 인증 토큰이 없습니다.');
  const profile = await api('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${mc.access_token}` } }, fetcher);
  if (!/^[a-f0-9]{32}$/i.test(profile.id) || !/^[a-zA-Z0-9_]{1,16}$/.test(profile.name)) throw Error('Minecraft 프로필이 올바르지 않습니다.');
  return { accessToken: mc.access_token, profile: { id: profile.id, name: profile.name }, expiresAt: Date.now() + mc.expires_in * 1000 };
}
module.exports = { makeRequest, redirectCode, microsoft, minecraft };
