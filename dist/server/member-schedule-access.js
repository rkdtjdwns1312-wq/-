import { hasMemberAccess, MEMBER_COOKIE } from './member-access.js';

const encoder = new TextEncoder();
const COOKIE = '__Host-kokkiri_schedule';
const DAY = 86400000;
const KST = 9 * 60 * 60 * 1000;
const WINDOW = 15 * 60 * 1000;
const BODY_LIMIT = 1024;
const PREFIX = 'kokkiri-member-schedule-v1:';
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g), b => parseInt(b, 16));
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});
const error = (message, status) => json({ error: message }, status);
const unavailable = () => error('대진 편집 권한을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.', 503);
const denied = () => error('먼저 회원 로그인을 해주세요.', 401);
const config = env => env.DB.prepare('SELECT version,salt,verifier FROM member_schedule_access_config WHERE id=1').first();
const configured = row => Boolean(row && Number.isSafeInteger(row.version) && row.version > 0 &&
  /^[a-f0-9-]{36}$/.test(row.salt) && /^[a-f0-9]{64}$/.test(row.verifier));

export const kstToday = (now = Date.now()) => new Date(now + KST).toISOString().slice(0, 10);
const midnight = now => (Math.floor((now + KST) / DAY) + 1) * DAY - KST;
const noAccess = () => ({ allowed: false, today: kstToday(), expiresAt: 0 });
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacKey(key, usage) {
  return crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
async function mac(key, value) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(key, 'sign'), encoder.encode(PREFIX + value)));
}
async function verifyMac(key, value, signature) {
  return crypto.subtle.verify('HMAC', await hmacKey(key, 'verify'), unhex(signature), encoder.encode(PREFIX + value));
}
async function passwordVerifier(key, salt, password) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  // Match the existing member KDF's Workers-compatible iteration count, with a separate domain.
  const derived = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', iterations: 100000,
    salt: encoder.encode(PREFIX + 'password:' + salt)
  }, material, 256);
  return mac(key, 'password:' + salt + ':' + hex(derived));
}
async function operator(request, env) {
  const provided = request.headers.get('x-kokkiri-editor');
  if (!env?.EDITOR_KEY || !provided) return false;
  // Hash first so secret comparison always has the same length.
  return equal(await digest(provided), await digest(env.EDITOR_KEY));
}
function cookie(request, name) {
  const values = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : '';
}
async function memberValue(request, env) {
  // hasMemberAccess normally lets operators bypass member login. This capability never does.
  const headers = new Headers(request.headers);
  headers.delete('x-kokkiri-editor');
  if (!await hasMemberAccess(new Request(request.url, { headers }), env)) return '';
  return cookie(request, MEMBER_COOKIE);
}
function crossOrigin(request, requireOrigin = false) {
  const origin = request.headers.get('origin');
  return request.headers.get('sec-fetch-site') === 'cross-site' ||
    (requireOrigin || origin !== null) && origin !== new URL(request.url).origin;
}
async function input(request) {
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    return { error: error('JSON 형식으로 요청해주세요.', 415) };
  }
  if (Number(request.headers.get('content-length')) > BODY_LIMIT) return { error: error('입력 내용이 너무 큽니다.', 413) };
  // Bound actual streamed bytes as well as Content-Length (which can be absent or dishonest).
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > BODY_LIMIT) {
          await reader.cancel();
          return { error: error('입력 내용이 너무 큽니다.', 413) };
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('object required');
    return { data };
  } catch { return { error: error('입력 내용을 확인해주세요.', 400) }; }
}
const validPassword = password => typeof password === 'string' && password.length >= 4 && password.length <= 128 &&
  !/[\u0000-\u001f\u007f]/.test(password);

// Authentication only: the caller must enforce today-only create/edit and all other write restrictions.
// expiresAt is epoch milliseconds; a denied capability always has expiresAt=0.
export async function readMemberScheduleAccess(request, env) {
  try {
    const member = await memberValue(request, env);
    if (!member || !env?.EDITOR_KEY || !env.DB) return noAccess();
    const value = cookie(request, COOKIE), parts = value.split('.');
    if (value.length > 320 || parts.length !== 7 || parts[0] !== 'v1' ||
      !/^[1-9]\d{0,15}$/.test(parts[1]) || !/^\d{4}-\d{2}-\d{2}$/.test(parts[2]) ||
      !/^\d{13}$/.test(parts[3]) || !/^[a-f0-9]{64}$/.test(parts[4]) ||
      !/^[a-f0-9]{32}$/.test(parts[5]) || !/^[a-f0-9]{64}$/.test(parts[6])) return noAccess();
    const version = Number(parts[1]), expiresAt = Number(parts[3]);
    if (!Number.isSafeInteger(version) || !equal(parts[4], await digest(member))) return noAccess();
    if (!await verifyMac(env.EDITOR_KEY, 'session:' + parts.slice(0, 6).join('.'), parts[6])) return noAccess();
    const row = await config(env);
    const now = Date.now(), today = kstToday(now);
    // Re-evaluate time after asynchronous work, including the underlying member session's expiry.
    if (!configured(row) || row.version !== version || parts[2] !== today || expiresAt <= now ||
      expiresAt > midnight(now) || expiresAt > Number(member.split('.')[2])) return noAccess();
    return { allowed: true, today, expiresAt };
  } catch { return noAccess(); }
}

async function configure(request, env) {
  if (!await operator(request, env)) return error('운영진만 설정할 수 있습니다.', 403);
  if (!['GET', 'POST'].includes(request.method)) return error('허용되지 않은 요청입니다.', 405);
  if (crossOrigin(request, request.method === 'POST')) return error('홈페이지에서 다시 시도해주세요.', 403);
  if (request.method === 'GET') {
    const row = await config(env);
    return json({ configured: configured(row), version: Number.isSafeInteger(row?.version) ? row.version : 0 });
  }
  const parsed = await input(request);
  if (parsed.error) return parsed.error;
  const { password, version } = parsed.data;
  if (!validPassword(password) || !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) {
    return error('암호와 설정 버전을 확인해주세요.', 400);
  }
  const salt = crypto.randomUUID(), verifier = await passwordVerifier(env.EDITOR_KEY, salt, password);
  const saved = await env.DB.prepare(`UPDATE member_schedule_access_config
    SET version=version+1,salt=?,verifier=?,updated_at=? WHERE id=1 AND version=?`)
    .bind(salt, verifier, new Date(Date.now()).toISOString(), version).run();
  if (saved.meta.changes !== 1) return error('설정이 변경되었습니다. 최신 설정을 확인해주세요.', 409);
  return json({ configured: true, version: version + 1 });
}

export async function memberScheduleAccessEndpoint(request, env) {
  const path = new URL(request.url).pathname;
  try {
    if (path === '/api/member-schedule-access/config') return await configure(request, env);
    if (path === '/api/member-schedule-session') {
      if (request.method !== 'GET') return error('허용되지 않은 요청입니다.', 405);
      if (crossOrigin(request)) return error('홈페이지에서 다시 시도해주세요.', 403);
      return json(await readMemberScheduleAccess(request, env));
    }
    if (path !== '/api/member-schedule-login') return error('요청을 찾을 수 없습니다.', 404);
    if (request.method !== 'POST') return error('허용되지 않은 요청입니다.', 405);
    if (crossOrigin(request, true)) return error('홈페이지에서 다시 시도해주세요.', 403);
    const member = await memberValue(request, env);
    if (!member) return denied();
    const parsed = await input(request);
    if (parsed.error) return parsed.error;
    const { password } = parsed.data;
    if (!validPassword(password)) return error('대진 편집 비밀번호를 입력해주세요.', 400);
    const row = await config(env);
    if (!configured(row)) return unavailable();
    const now = Date.now();
    await env.DB.prepare('DELETE FROM member_schedule_login_limits WHERE expires_at<=?').bind(now).run();
    const bucket = await mac(env.EDITOR_KEY, 'limit:' + (request.headers.get('cf-connecting-ip') || 'unknown'));
    // Reserve before KDF verification in one atomic statement; successful attempts count too.
    const attempts = await env.DB.prepare(`INSERT INTO member_schedule_login_limits (bucket,attempts,expires_at) VALUES (?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE MIN(attempts+1,6) END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts,expires_at`)
      .bind(bucket, now + WINDOW, now, now).first();
    if (!attempts || !Number.isSafeInteger(attempts.attempts) || attempts.attempts < 1 ||
      !Number.isSafeInteger(attempts.expires_at) || attempts.expires_at <= now) return unavailable();
    if (attempts.attempts > 5) return json({ error: '시도 횟수를 초과했습니다. 15분 후 다시 시도해주세요.' }, 429, {
      'retry-after': String(Math.max(1, Math.ceil((attempts.expires_at - now) / 1000)))
    });
    if (!equal(await passwordVerifier(env.EDITOR_KEY, row.salt, password), row.verifier)) {
      return error('비밀번호가 올바르지 않습니다.', 401);
    }
    const latest = await config(env);
    if (!configured(latest) || latest.version !== row.version) return error('암호가 변경되었습니다. 다시 시도해주세요.', 409);
    if (await memberValue(request, env) !== member) return denied();
    const issuedAt = Date.now(), today = kstToday(issuedAt);
    const expiresAt = Math.min(midnight(issuedAt), Number(member.split('.')[2]));
    if (expiresAt <= issuedAt) return denied();
    const base = ['v1', row.version, today, expiresAt, await digest(member), crypto.randomUUID().replaceAll('-', '')].join('.');
    const value = base + '.' + await mac(env.EDITOR_KEY, 'session:' + base);
    const finishedAt = Date.now();
    if (finishedAt >= expiresAt || kstToday(finishedAt) !== today) return error('날짜 또는 회원 세션이 변경되었습니다. 다시 시도해주세요.', 409);
    return json({ allowed: true, today, expiresAt }, 200, {
      'set-cookie': COOKIE + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' +
        Math.floor((expiresAt - finishedAt) / 1000) + '; Expires=' + new Date(expiresAt).toUTCString()
    });
  } catch { return unavailable(); }
}
