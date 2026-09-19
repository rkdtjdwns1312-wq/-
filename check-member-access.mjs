import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import worker from './dist/server/index.js';
import { MEMBER_COOKIE } from './dist/server/member-access.js';

export async function runMemberAccessChecks(){
  const sqlite=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'));
  const DB={prepare(sql){const statement=sqlite.prepare(sql);let params=[];return {bind(...v){params=v;return this;},async first(){return statement.get(...params)||null;},async all(){return {results:statement.all(...params)};},async run(){return {meta:statement.run(...params)};}};}};
  const env={DB,EDITOR_KEY:'member-test-editor',OPERATOR_PASSWORD:'member-test-operator'},origin='https://member.test';
  const password='synthetic-member-password';
  const call=(path,method='GET',body,headers={},customEnv=env)=>worker.fetch(new Request(origin+path,{method,headers:{...(method==='GET'?{}:{origin,'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),customEnv);
  const operator={'x-kokkiri-editor':env.EDITOR_KEY};
  const config=(version,pw=password,headers=operator)=>call('/api/member-access/config','POST',{version,password:pw},headers);
  const login=(pw=password,headers={})=>call('/api/member-login','POST',{password:pw},headers);
  const snapshot=()=>JSON.stringify(['board_posts','ranking_members','guests','ranking_settlements'].map(t=>sqlite.prepare('SELECT * FROM '+t).all()));
  const privatePaths=['/api/people','/api/rankings','/api/mvp','/api/schedule','/api/posts?kind=schedule','/api/live-courts','/api/posts/member-private','/api/posts/member-private?kind=notice'];
  try{
    const now=new Date().toISOString();
    for(const [id,kind] of [['member-private','schedule'],['member-public','notice']])sqlite.prepare("INSERT INTO board_posts(id,kind,payload,version,created_at,updated_at,last_operation) VALUES(?,?,?,1,?,?,'fixture')").run(id,kind,JSON.stringify({title:kind==='schedule'?'private-title':'public-title',names:['private-name'],schedule:[],rounds:0}),now,now);
    const before=snapshot();
    assert.equal((await call('/')).status,200);
    assert.equal((await call('/api/posts?kind=notice')).status,200);
    assert.equal((await call('/api/posts/member-public')).status,200);
    for(const path of privatePaths){
      const r=await call(path);assert.equal(r.status,401,path);assert.equal(r.headers.get('cache-control'),'no-store');
      assert.deepEqual(await r.json(),{error:'회원만 볼 수 있는 메뉴입니다',code:'MEMBERS_ONLY'});
    }
    for(const path of ['/api/live-courts','/api/posts/member-private/result','/api/posts/member-private/progress'])assert.equal((await call(path,'POST',{})).status,401,path);
    assert.deepEqual(await (await call('/api/member-session')).json(),{member:false});
    assert.equal((await login()).status,503,'unconfigured fails closed');
    assert.equal((await config(0,password,{})).status,403,'public cannot configure');
    assert.equal((await config(0,password,{...operator,origin:'https://other.test'})).status,403);
    assert.equal((await config(0,password,{...operator,'content-type':'text/plain'})).status,415);
    assert.equal((await config(0,'short')).status,400);
    const setup=await config(0);assert.equal(setup.status,200);assert.deepEqual(await setup.json(),{configured:true,version:1});
    assert.equal((await config(0)).status,409,'compare-and-set configuration');
    const stored=sqlite.prepare('SELECT * FROM member_access_config').get();assert.notEqual(stored.verifier,password);assert.equal(stored.verifier.length,64);assert.ok(!JSON.stringify(stored).includes(password));
    assert.deepEqual(await (await call('/api/member-access/config','GET',undefined,operator)).json(),{configured:true,version:1});
    assert.equal((await call('/api/member-login')).status,405);
    assert.equal((await login(password,{origin:'https://other.test'})).status,403);
    assert.equal((await login(password,{origin:''})).status,403);
    assert.equal((await login(password,{'content-type':'text/plain'})).status,415);
    assert.equal((await call('/api/member-login','POST','{bad')).status,400);
    assert.equal((await call('/api/member-login','POST',{password:'x'.repeat(1100)})).status,413);
    assert.equal((await login('wrong-password')).status,401);
    const good=await login();assert.equal(good.status,200);assert.deepEqual(await good.json(),{member:true});
    const setCookie=good.headers.get('set-cookie');
    for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=604800'])assert.ok(setCookie.includes(flag));
    const cookie=setCookie.split(';')[0],member={cookie};
    assert.ok(!cookie.includes(password)&&!cookie.includes(env.EDITOR_KEY));
    for(const path of privatePaths)assert.equal((await call(path,'GET',undefined,member)).status,200,path);
    assert.deepEqual(await (await call('/api/member-session','GET',undefined,member)).json(),{member:true});
    assert.ok((await (await call('/','GET',undefined,member)).text()).includes(',true);</script>'));
    for(const path of ['/api/live-courts','/api/posts/member-private/result','/api/posts/member-private/progress']){
      assert.equal((await call(path,'POST',{},{...member,origin:'https://other.test'})).status,403,'cross-origin member write');
      assert.equal((await call(path,'POST',{},{...member,'content-type':'text/plain'})).status,415,'simple request content type');
    }
    for(const path of ['/api/people','/api/people/hide','/api/people/promote','/api/operator-role','/api/backups','/api/posts/member-private/settle','/api/posts/member-private/unsettle','/api/posts/member-private/substitute','/api/member-access/config'])assert.equal((await call(path,'POST',{},member)).status,403,'member not operator: '+path);
    assert.equal((await call('/api/posts/member-private','PUT',{},member)).status,403);
    assert.equal((await call('/api/live-courts','POST',{action:'close',version:0},member)).status,403);
    assert.equal((await call('/api/backups','GET',undefined,member)).status,403);
    const forged=[cookie.slice(0,-1)+(cookie.endsWith('0')?'1':'0'),cookie.replace('v1.1.','v1.2.'),MEMBER_COOKIE+'=bad',cookie+'; '+cookie];
    for(const c of forged)assert.equal((await call('/api/rankings','GET',undefined,{cookie:c})).status,401);
    const sign=(expires,version=1)=>{
      const base=['v1',version,expires,'a'.repeat(32)].join('.');
      return MEMBER_COOKIE+'='+base+'.'+createHmac('sha256',env.EDITOR_KEY).update('kokkiri-member-v1:session:'+base).digest('hex');
    };
    for(const expires of [Date.now()-1,Date.now()+8*86400000])assert.equal((await call('/api/rankings','GET',undefined,{cookie:sign(expires)})).status,401);
    assert.equal((await call('/api/rankings','GET',undefined,member,{...env,EDITOR_KEY:''})).status,401);
    assert.equal((await call('/api/rankings','GET',undefined,member,{...env,DB:null})).status,401);
    assert.equal((await call('/api/rankings','GET',undefined,member,{...env,EDITOR_KEY:'rotated-test-editor'})).status,401);
    const statuses=await Promise.all(Array.from({length:10},()=>login('wrong-password',{'cf-connecting-ip':'parallel-failures'})));
    assert.equal(statuses.filter(r=>r.status===401).length,5);assert.equal(statuses.filter(r=>r.status===429).length,5);
    assert.ok(statuses.filter(r=>r.status===429).every(r=>Number(r.headers.get('retry-after'))>0));
    assert.equal((await login(password,{'cf-connecting-ip':'parallel-failures'})).status,429);
    sqlite.prepare('UPDATE member_login_limits SET expires_at=?').run(Date.now()-1);
    assert.equal((await login(password,{'cf-connecting-ip':'parallel-failures'})).status,200,'expired throttle resets');
    const race=await Promise.all([config(1,'synthetic-new-password'),config(1,'synthetic-other-password')]);
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    assert.equal((await call('/api/rankings','GET',undefined,member)).status,401,'rotation immediately invalidates old cookies');
    assert.deepEqual(await (await call('/api/member-session','GET',undefined,member)).json(),{member:false});
    assert.equal((await config(2)).status,200);
    let refreshed=(await login()).headers.get('set-cookie').split(';')[0];
    // An in-flight login cannot mint a usable cookie after the password is rotated.
    let configReads=0;
    const rotatingDB={prepare(sql){const statement=DB.prepare(sql);if(sql==='SELECT version,salt,verifier FROM member_access_config WHERE id=1'){
      const original=statement.first;statement.first=async()=>{const row=await original();if(++configReads===2)sqlite.prepare('UPDATE member_access_config SET version=version+1').run();return configReads===2?DB.prepare(sql).first():row;};
    }return statement;}};
    const rotatedDuringLogin=await call('/api/member-login','POST',{password},{'cf-connecting-ip':'rotation-race'},{...env,DB:rotatingDB});
    assert.equal(rotatedDuringLogin.status,409);assert.equal(rotatedDuringLogin.headers.get('set-cookie'),null);
    refreshed=(await login()).headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/rankings','GET',undefined,{cookie:refreshed})).status,200);
    assert.equal((await call('/api/member-logout','POST',{},{cookie:refreshed,origin:'https://other.test'})).status,403);
    assert.equal((await call('/api/member-logout','POST',{},{cookie:refreshed,'content-type':'text/plain'})).status,415);
    const out=await call('/api/member-logout','POST',{},{cookie:refreshed});assert.equal(out.status,200);assert.ok(out.headers.get('set-cookie').includes('Max-Age=0'));
    assert.equal((await call('/api/rankings')).status,401,'after browser removes logout cookie');
    sqlite.prepare("UPDATE member_access_config SET verifier='broken'").run();
    assert.equal((await call('/api/rankings','GET',undefined,{cookie:refreshed})).status,401,'invalid stored config fails closed');
    assert.equal((await login()).status,503);
    assert.equal((await call('/api/rankings','GET',undefined,operator)).status,200,'operator bypass remains available');
    assert.equal(snapshot(),before,'authentication does not mutate schedules, results, roster or scores');
  }finally{sqlite.close();}
  console.log('PASS: raw-worker member access, public notices, private read/write gates, operator separation, secure cookie, CSRF, KDF configuration CAS, throttle concurrency, rotation and fail-closed checks.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runMemberAccessChecks();
