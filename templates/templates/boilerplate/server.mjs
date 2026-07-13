// ============================================================
// AJW App Hub 표준 앱 보일러플레이트 (의존성 0 — Node 빌트인만)
// ------------------------------------------------------------
// 포털 SSO(OAuth2 Authorization Code) 클라이언트 + /health 를 갖춘 최소 앱.
// 이 파일을 그대로 두고, 화면(renderHome)·로직만 채우면 된다.
//
// 계약(허브가 주입하는 환경변수):
//   PORT                  컨테이너 listen 포트
//   PORTAL_PUBLIC_URL     브라우저가 보는 포털 주소(로그인 리다이렉트 대상)
//   PORTAL_INTERNAL_URL   컨테이너→포털 서버호출(token/userinfo)
//   APP_PUBLIC_URL        이 앱의 공개 주소(redirect_uri 베이스)
//   OAUTH_CLIENT_ID/SECRET 포털이 발급(자동 주입)
//   SESSION_SECRET        세션 쿠키 서명(자동 주입)
// ============================================================
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PORTAL_PUBLIC = (process.env.PORTAL_PUBLIC_URL || '').replace(/\/$/, '');
const PORTAL_INTERNAL = (process.env.PORTAL_INTERNAL_URL || 'http://portal:3000').replace(/\/$/, '');
const APP_PUBLIC = (process.env.APP_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CLIENT_ID = process.env.OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || '';
const SECRET = process.env.SESSION_SECRET || 'dev-insecure-secret';
const REDIRECT_URI = `${APP_PUBLIC}/auth/callback`;

// ---------- 서명 쿠키 ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url').toString();
function sign(obj) {
  const data = b64u(JSON.stringify(obj));
  const mac = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [data, mac] = token.split('.');
  const exp = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (mac !== exp) return null;
  try { return JSON.parse(unb64u(data)); } catch { return null; }
}
function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
function setCookie(res, name, value, { maxAge = 28800 } = {}) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

// ---------- OAuth ----------
function authorizeUrl(state) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: 'openid profile email', state,
  });
  return `${PORTAL_PUBLIC}/api/oauth/authorize?${q}`;
}
async function exchangeToken(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  const r = await fetch(`${PORTAL_INTERNAL}/api/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return r.json();
}
async function fetchUserinfo(accessToken) {
  const r = await fetch(`${PORTAL_INTERNAL}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`userinfo ${r.status}`);
  return r.json();
}

// ---------- 화면 (여기를 채우세요) ----------
function renderHome(user) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>표준 앱</title><style>body{font-family:system-ui;max-width:640px;margin:60px auto;padding:0 20px;color:#1f2937}
.card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px}a{color:#2563eb}</style></head>
<body><h1>👋 ${user.name || user.email} 님, 환영합니다</h1>
<div class="card">
  <p>이 앱은 AJW App Hub SSO 로 보호됩니다.</p>
  <ul>
    <li>이메일: ${user.email || '-'}</li>
    <li>앱 권한(app_role): <b>${user.app_role || 'user'}</b></li>
  </ul>
  <p>여기에 당신의 앱 화면을 만드세요. (templates/boilerplate/server.mjs 의 renderHome)</p>
</div>
<p style="margin-top:20px"><a href="/auth/logout">로그아웃</a></p>
</body></html>`;
}

// ---------- 라우팅 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, APP_PUBLIC);
  const p = url.pathname;

  // 헬스체크는 인증 불필요(허브가 이걸로 기동 확인)
  if (p === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  // OAuth 시작
  if (p === '/auth/login') {
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'bp_state', sign({ state, ts: Date.now() }), { maxAge: 600 });
    res.writeHead(302, { Location: authorizeUrl(state) });
    return res.end();
  }

  // OAuth 콜백
  if (p === '/auth/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const saved = verify(getCookie(req, 'bp_state'));
    if (!code || !state || !saved || saved.state !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('로그인 검증 실패. 다시 시도하세요.');
    }
    try {
      const tok = await exchangeToken(code);
      const info = await fetchUserinfo(tok.access_token);
      setCookie(res, 'bp_session', sign({ sub: info.sub, email: info.email, name: info.name, app_role: info.app_role || 'user' }));
      res.writeHead(302, { Location: '/' });
      return res.end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('로그인 실패: ' + (e.message || e));
    }
  }

  if (p === '/auth/logout') {
    setCookie(res, 'bp_session', '', { maxAge: 0 });
    res.writeHead(302, { Location: PORTAL_PUBLIC || '/' });
    return res.end();
  }

  // 그 외 모든 경로: 인증 필요
  const user = verify(getCookie(req, 'bp_session'));
  if (!user) {
    res.writeHead(302, { Location: '/auth/login' });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderHome(user));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`표준 앱 listen :${PORT} (portal=${PORTAL_PUBLIC}, redirect_uri=${REDIRECT_URI})`);
});
