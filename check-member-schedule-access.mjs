import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, pbkdf2Sync, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { memberAccessEndpoint, MEMBER_COOKIE } from './dist/server/member-access.js';
import { memberScheduleAccessEndpoint, readMemberScheduleAccess, kstToday } from './dist/server/member-schedule-access.js';

export async function runMemberScheduleAccessChecks() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0015_member_access.sql', '0021_member_schedule_access.sql']) {
    sqlite.exec(readFileSync(new URL('./drizzle/' + name, import.meta.url), 'utf8'));
  }
  const DB = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async first() { return statement.get(...params) || null; },
      async run() { return { meta: statement.run(...params) }; }
    };
  } };
  // Every credential is generated for this in-memory test run; no production configuration is used.
  const env = { DB, EDITOR_KEY: randomUUID() };
  const password = randomUUID().slice(0, 4), memberPassword = randomUUID();
  const origin = 'https://schedule.test', scheduleName = '__Host-kokkiri_schedule';
  const configPath = '/api/member-schedule-access/config';
  const loginPath = '/api/member-schedule-login', sessionPath = '/api/member-schedule-session';
  const operator = { 'x-kokkiri-editor': env.EDITOR_KEY };
  const realNow = Date.now;
  let now = Date.parse('2026-11-01T03:00:00.000Z'), ip = 0, checks = 0;
  Date.now = () => now;
  const request = (path, method = 'GET', body, headers = {}) => new Request(origin + path, {
    method,
    headers: { ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  });
  const call = (path, method = 'GET', body, headers = {}, customEnv = env) =>
    memberScheduleAccessEndpoint(request(path, method, body, headers), customEnv);
  const configure = (version, pw = password, headers = operator, customEnv = env) =>
    call(configPath, 'POST', { version, password: pw }, headers, customEnv);
  const login = (member, pw = password, headers = {}, customEnv = env) =>
    call(loginPath, 'POST', { password: pw }, { cookie: member, 'cf-connecting-ip': 'fixture-' + ++ip, ...headers }, customEnv);
  const read = (cookie = '', customEnv = env, extraHeaders = {}) =>
    readMemberScheduleAccess(request(sessionPath, 'GET', undefined, { cookie, ...extraHeaders }), customEnv);
  const state = (allowed = false, expiresAt = 0) => ({ allowed, today: kstToday(now), expiresAt });
  const takeCookie = response => response.headers.get('set-cookie')?.split(';')[0];
  const join = (...cookies) => cookies.filter(Boolean).join('; ');
  const ok = description => { checks++; console.log('PASS: ' + description); };
  const normalLogin = async () => {
    const response = await memberAccessEndpoint(request('/api/member-login', 'POST', { password: memberPassword }, {
      'cf-connecting-ip': 'normal-' + ++ip
    }), env);
    assert.equal(response.status, 200);
    return takeCookie(response);
  };
  const signMember = expires => {
    const version = sqlite.prepare('SELECT version FROM member_access_config').get().version;
    const base = ['v1', version, expires, randomUUID().replaceAll('-', '')].join('.');
    return MEMBER_COOKIE + '=' + base + '.' + createHmac('sha256', env.EDITOR_KEY).update('kokkiri-member-v1:session:' + base).digest('hex');
  };
  const signSchedule = (cookie, changes) => {
    const parts = cookie.slice(scheduleName.length + 1).split('.');
    for (const [index, value] of Object.entries(changes)) parts[index] = String(value);
    const base = parts.slice(0, 6).join('.');
    return scheduleName + '=' + base + '.' + createHmac('sha256', env.EDITOR_KEY).update('kokkiri-member-schedule-v1:session:' + base).digest('hex');
  };
  const hookDB = callback => ({ prepare(sql) {
    const statement = DB.prepare(sql), original = statement.first;
    statement.first = async () => { await callback(sql); return original(); };
    return statement;
  } });
  try {
    assert.equal(kstToday(Date.parse('2026-10-31T14:59:59.999Z')), '2026-10-31');
    assert.equal(kstToday(Date.parse('2026-10-31T15:00:00.000Z')), '2026-11-01');
    assert.equal(kstToday(Date.parse('2026-12-31T15:00:00.000Z')), '2027-01-01');
    assert.deepEqual(await read(), state());
    assert.deepEqual(await (await call(sessionPath + '?today=2099-01-01&expiresAt=9999999999999')).json(), state());
    assert.equal((await login('')).status, 401);
    assert.equal((await login('', password, operator)).status, 401, 'operator header is not a member cookie');
    assert.deepEqual(await read('', env, operator), state());
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM member_schedule_login_limits').get().n, 0);
    assert.equal((await call(configPath)).status, 403);
    assert.deepEqual(await (await call(configPath, 'GET', undefined, operator)).json(), { configured: false, version: 0 });
    ok('server-clock KST date, missing member and operator-only bypass rejection');

    assert.equal((await memberAccessEndpoint(request('/api/member-access/config', 'POST', {
      version: 0, password: memberPassword
    }, operator), env)).status, 200);
    let member = await normalLogin();
    assert.equal((await login(member)).status, 503, 'no initial schedule password');
    assert.equal((await configure(0, password, { cookie: member })).status, 403);
    assert.equal((await configure(0, password, { 'x-kokkiri-editor': randomUUID() })).status, 403);
    for (const headers of [{ origin: 'https://foreign.test' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }]) {
      assert.equal((await configure(0, password, { ...operator, ...headers })).status, 403);
      assert.equal((await login(member, password, headers)).status, 403);
    }
    for (const path of [configPath, sessionPath]) {
      assert.equal((await call(path, 'GET', undefined, { ...operator, cookie: member, origin: 'https://foreign.test' })).status, 403);
    }
    for (const path of [configPath, loginPath]) {
      const headers = { ...operator, cookie: member };
      assert.equal((await call(path, 'POST', {}, { ...headers, 'content-type': 'text/plain' })).status, 415);
      for (const body of ['{invalid', 'null', '[]']) assert.equal((await call(path, 'POST', body, headers)).status, 400);
      assert.equal((await call(path, 'POST', {}, { ...headers, 'content-length': '1025' })).status, 413);
      assert.equal((await call(path, 'POST', { password: 'a'.repeat(1100) }, headers)).status, 413);
      assert.equal((await call(path, 'POST', { password: '한'.repeat(400) }, { ...headers, 'content-length': '1' })).status, 413, 'byte limit, not character limit');
    }
    for (const pw of ['', 'abc', 'a'.repeat(129), 'abc\n']) assert.equal((await configure(0, pw)).status, 400);
    for (const version of [-1, 0.1, '0', Number.MAX_SAFE_INTEGER]) assert.equal((await configure(version)).status, 400);
    assert.equal((await configure(0)).status, 200, 'four-character password accepted');
    assert.equal((await configure(0)).status, 409);
    assert.deepEqual(await (await call(configPath, 'GET', undefined, operator)).json(), { configured: true, version: 1 });
    const stored = sqlite.prepare('SELECT * FROM member_schedule_access_config').get();
    const derived = pbkdf2Sync(password, 'kokkiri-member-schedule-v1:password:' + stored.salt, 100000, 32, 'sha256').toString('hex');
    assert.equal(stored.verifier, createHmac('sha256', env.EDITOR_KEY).update('kokkiri-member-schedule-v1:password:' + stored.salt + ':' + derived).digest('hex'));
    assert.notEqual(stored.verifier, derived, 'stored verifier is peppered');
    sqlite.exec(readFileSync(new URL('./drizzle/0021_member_schedule_access.sql', import.meta.url), 'utf8'));
    assert.deepEqual(sqlite.prepare('SELECT * FROM member_schedule_access_config').get(), stored, 'migration rerun preserves configuration');
    ok('operator configuration, CSRF, bounded JSON bytes, min4, PBKDF2+HMAC, CAS and migration idempotence');

    const granted = await login(member);
    assert.equal(granted.status, 200);
    let schedule = takeCookie(granted), full = join(member, schedule);
    const expiry = Date.parse('2026-11-01T15:00:00.000Z');
    assert.deepEqual(await granted.json(), state(true, expiry));
    for (const flag of ['__Host-kokkiri_schedule=', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200']) {
      assert.ok(granted.headers.get('set-cookie').includes(flag), flag);
    }
    assert.ok(!granted.headers.get('set-cookie').includes('Domain='));
    assert.equal(Date.parse(granted.headers.get('set-cookie').match(/Expires=([^;]+)/)[1]), expiry);
    assert.equal(schedule.split('.')[4], createHash('sha256').update(member.slice(MEMBER_COOKIE.length + 1)).digest('hex'));
    assert.deepEqual(await read(full), state(true, expiry));
    const session = await call(sessionPath, 'GET', undefined, { cookie: full });
    assert.equal(session.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await session.json(), state(true, expiry));
    assert.equal((await configure(1, password, { cookie: full })).status, 403, 'capability is not operator authority');
    assert.equal((await call(configPath, 'GET', undefined, { cookie: full })).status, 403);
    ok('secure bound cookie, session/read interface, midnight expiry and operator separation');

    for (const invalid of [
      schedule.slice(0, -1) + (schedule.endsWith('0') ? '1' : '0'),
      schedule.replace('v1.1.', 'v1.2.'), scheduleName + '=bad', scheduleName + '=' + 'x'.repeat(321),
      signSchedule(schedule, { 1: 2 }), signSchedule(schedule, { 2: '2026-10-31' }),
      signSchedule(schedule, { 3: now }), signSchedule(schedule, { 3: expiry + 1 }),
      signSchedule(schedule, { 4: '0'.repeat(64) }), join(schedule, schedule)
    ]) assert.deepEqual(await read(join(member, invalid)), state());
    assert.deepEqual(await read(schedule), state());
    assert.deepEqual(await read(schedule, env, operator), state());
    assert.deepEqual(await read(join(member, member, schedule)), state());
    assert.deepEqual(await read(join(MEMBER_COOKIE + '=bad', schedule), env, operator), state());
    const anotherMember = await normalLogin();
    assert.notEqual(member, anotherMember);
    assert.deepEqual(await read(join(anotherMember, schedule)), state(), 'different valid member session');
    const logout = await memberAccessEndpoint(request('/api/member-logout', 'POST', {}, { cookie: full }), env);
    assert.equal(logout.status, 200);
    assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
    assert.deepEqual(await read(schedule), state(), 'browser removes normal member cookie on logout');
    member = await normalLogin();
    assert.deepEqual(await read(join(member, schedule)), state(), 'persistent schedule cookie invalid after relogin');
    schedule = takeCookie(await login(member));
    full = join(member, schedule);
    assert.deepEqual(await read(full), state(true, expiry));
    ok('signature/value tampering, duplicate cookies, binding, logout and relogin');

    const parallel = await Promise.all(Array.from({ length: 12 }, () => login(member, randomUUID(), { 'cf-connecting-ip': 'parallel' })));
    assert.equal(parallel.filter(r => r.status === 401).length, 5);
    assert.equal(parallel.filter(r => r.status === 429).length, 7);
    for (const response of parallel.filter(r => r.status === 429)) assert.equal(response.headers.get('retry-after'), '900');
    assert.equal((await login(member, password, { 'cf-connecting-ip': 'parallel' })).status, 429);
    for (let i = 0; i < 5; i++) assert.equal((await login(member, password, { 'cf-connecting-ip': 'success-limit' })).status, 200);
    assert.equal((await login(member, password, { 'cf-connecting-ip': 'success-limit' })).status, 429, 'success cannot erase concurrent reservations');
    for (const row of sqlite.prepare('SELECT bucket FROM member_schedule_login_limits').all()) assert.match(row.bucket, /^[a-f0-9]{64}$/);
    now += 15 * 60 * 1000 - 1;
    assert.equal((await login(member, password, { 'cf-connecting-ip': 'parallel' })).status, 429);
    now++;
    assert.equal((await login(member, password, { 'cf-connecting-ip': 'parallel' })).status, 200);
    ok('atomic concurrent 5/15m IP limiter, successful-attempt accounting and window boundary');

    const shortMember = signMember(now + 60000);
    const shortLogin = await login(shortMember);
    assert.equal(shortLogin.status, 200);
    const shortSchedule = takeCookie(shortLogin);
    assert.deepEqual(await shortLogin.json(), state(true, now + 60000));
    assert.deepEqual(await read(join(shortMember, signSchedule(shortSchedule, { 3: expiry }))), state(), 'grant cannot outlive normal session');
    now += 60000;
    assert.deepEqual(await read(join(shortMember, shortSchedule)), state(), 'normal expiry required even with valid schedule signature');
    now = expiry - 1;
    assert.deepEqual(await read(full), state(true, expiry));
    now = expiry;
    assert.deepEqual(await read(full), state());
    assert.equal(kstToday(), '2026-11-02');
    const nextDay = await login(member);
    assert.equal(nextDay.status, 200);
    assert.deepEqual(await nextDay.json(), state(true, expiry + 86400000));
    now = expiry - 1;
    const crossingDB = hookDB(sql => { if (sql.includes('FROM member_schedule_access_config')) now = expiry; });
    assert.deepEqual(await read(full, { ...env, DB: crossingDB }), state(), 'midnight while awaiting DB');
    const expiredAt = (await read(full)).expiresAt;
    assert.equal(expiredAt, 0);
    ok('normal-session expiry cap, exact KST midnight, next-day grant and async midnight crossing');

    schedule = takeCookie(await login(member)); full = join(member, schedule);
    const race = await Promise.all([configure(1), configure(1)]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    assert.deepEqual(await read(full), state(), 'schedule config rotation invalidates existing grant');
    schedule = takeCookie(await login(member)); full = join(member, schedule);
    assert.equal((await read(full)).allowed, true);
    let configReads = 0;
    const rotatingDB = hookDB(sql => {
      if (sql.includes('FROM member_schedule_access_config') && ++configReads === 2) {
        sqlite.prepare('UPDATE member_schedule_access_config SET version=version+1').run();
      }
    });
    const racingLogin = await login(member, password, {}, { ...env, DB: rotatingDB });
    assert.equal(racingLogin.status, 409);
    assert.equal(racingLogin.headers.get('set-cookie'), null);
    schedule = takeCookie(await login(member)); full = join(member, schedule);
    let memberReads = 0;
    const memberRotatingDB = hookDB(sql => {
      if (sql.includes('FROM member_access_config') && ++memberReads === 2) {
        sqlite.prepare('UPDATE member_access_config SET version=version+1').run();
      }
    });
    const memberRace = await login(member, password, {}, { ...env, DB: memberRotatingDB });
    assert.equal(memberRace.status, 401);
    assert.equal(memberRace.headers.get('set-cookie'), null);
    assert.deepEqual(await read(full), state(), 'normal config rotation checked on every read');
    member = await normalLogin();
    assert.deepEqual(await read(join(member, schedule)), state());
    schedule = takeCookie(await login(member)); full = join(member, schedule);
    ok('concurrent config CAS, both config rotations and in-flight login revalidation');

    for (const badEnv of [{ ...env, DB: null }, { ...env, EDITOR_KEY: '' }, { ...env, EDITOR_KEY: randomUUID() }, undefined,
      { ...env, DB: { prepare() { throw new Error('synthetic unavailable DB'); } } }]) {
      // Pass directly: the read helper's default parameter intentionally substitutes env for undefined.
      assert.deepEqual(await readMemberScheduleAccess(request(sessionPath, 'GET', undefined, { cookie: full }), badEnv), state());
    }
    const scheduleBrokenDB = hookDB(sql => { if (sql.includes('FROM member_schedule_access_config')) throw new Error('synthetic schedule failure'); });
    assert.deepEqual(await read(full, { ...env, DB: scheduleBrokenDB }), state());
    assert.equal((await login(member, password, {}, { ...env, DB: scheduleBrokenDB })).status, 503);
    const snapshot = sqlite.prepare('SELECT * FROM member_schedule_access_config').get();
    sqlite.prepare("UPDATE member_schedule_access_config SET verifier='broken'").run();
    assert.deepEqual(await read(full), state());
    assert.equal((await login(member)).status, 503);
    sqlite.prepare('UPDATE member_schedule_access_config SET verifier=?').run(snapshot.verifier);
    assert.equal((await call('/api/not-a-schedule-auth-route', 'POST', {}, { cookie: full })).status, 404);
    assert.equal((await call(loginPath)).status, 405);
    assert.equal((await call(sessionPath, 'POST', {}, { cookie: full })).status, 405);
    assert.equal((await call(configPath, 'PUT', {}, operator)).status, 405);
    ok('missing secrets/DB, malformed configuration, storage failures and exact routing fail closed');
    console.log(`PASS: member schedule access standalone suite (${checks} groups); real crypto, real in-memory SQLite, synthetic credentials only.`);
  } finally {
    Date.now = realNow;
    sqlite.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runMemberScheduleAccessChecks();
