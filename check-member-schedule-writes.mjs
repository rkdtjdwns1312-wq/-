import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import worker from './dist/server/index.js';
import {resolveScheduleDate,validScheduleDate,memberMayEditSchedule} from './dist/server/member-schedule-policy.js';

export async function runMemberScheduleWriteChecks(){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL('./drizzle/'+file,import.meta.url),'utf8'));
  let beforeWrite=null;
  const DB={prepare(sql){const stmt=db.prepare(sql);let args=[];return {bind(...v){args=v;return this;},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){if(beforeWrite&&/^(INSERT OR IGNORE INTO board_posts|UPDATE board_posts)/.test(sql)){const fn=beforeWrite;beforeWrite=null;fn();}return {meta:stmt.run(...args)};}};}};
  const origin='https://member-schedule-write.test',env={DB,EDITOR_KEY:crypto.randomUUID()};
  const op={'x-kokkiri-editor':env.EDITOR_KEY};
  const call=(path,method='GET',body,headers={})=>worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const ok=async r=>{const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const shift=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const title=day=>{const [,m,d]=day.split('-').map(Number);return m+'월 '+d+'일('+['일','월','화','수','목','금','토'][new Date(day+'T00:00:00Z').getUTCDay()]+') 테스트 체육관 13시';};
  const players=db.prepare('SELECT member_id AS id,name FROM ranking_members WHERE hidden=0 ORDER BY rank LIMIT 4').all();
  const draft=(day=today)=>({title:title(day),scheduleDate:day,names:players.map(p=>p.name),participantIds:players.map(p=>p.id),courts:1,rounds:1,schedule:[{round:1,method:'same',g:[players.map(p=>p.name)],rest:[]}],results:{}});
  const put=(id,data,version=0,headers={},operation=crypto.randomUUID())=>call('/api/posts/'+id,'PUT',{kind:'schedule',version,operation,data},headers);
  const row=id=>db.prepare('SELECT * FROM board_posts WHERE id=?').get(id);
  const stored=id=>JSON.parse(row(id).payload);
  const roster=()=>JSON.stringify(['ranking_members','guests','ranking_events','guest_events','ranking_settlements','ledger_state','ledger_list_state'].map(table=>db.prepare('SELECT * FROM '+table).all()));
  try{
    const initialRoster=roster();
    assert.equal(validScheduleDate('2026-02-29'),false);
    assert.equal(validScheduleDate('2028-02-29'),true);
    assert.equal(resolveScheduleDate({title:'1월 1일(금) 행사',createdAt:'2026-12-31T05:00:00Z'}),'2027-01-01');
    assert.equal(resolveScheduleDate({title:'11월 1일(토) 행사',createdAt:'2025-11-01T05:00:00Z'}),'2025-11-01');
    assert.equal(resolveScheduleDate({title:'날짜 없는 대진',createdAt:new Date().toISOString()}),'');
    assert.equal(memberMayEditSchedule({...draft(),kind:'schedule',settledAt:'closed'},{allowed:true,today}),false);
    await ok(await call('/api/member-access/config','POST',{version:0,password:'synthetic-member-password'},op));
    await ok(await call('/api/member-schedule-access/config','POST',{version:0,password:'synthetic-schedule-password'},op));
    const login=await call('/api/member-login','POST',{password:'synthetic-member-password'});await ok(login.clone());
    const normal={cookie:login.headers.get('set-cookie').split(';')[0]};
    assert.equal((await put('no-grant',draft(),0,normal)).status,403);
    assert.equal((await put('no-login',draft())).status,403);
    const grant=await call('/api/member-schedule-login','POST',{password:'synthetic-schedule-password'},normal);await ok(grant.clone());
    const member={cookie:normal.cookie+'; '+grant.headers.get('set-cookie').split(';')[0]};
    const access=await ok(await call('/api/member-schedule-session','GET',undefined,member));assert.equal(access.allowed,true);assert.equal(access.today,today);
    for(const day of [shift(-1),shift(1),'2025-11-01'])assert.equal((await put('wrong-'+day,draft(day),0,member)).status,403);
    assert.equal((await put('missing-date',{...draft(),scheduleDate:undefined},0,member)).status,403);
    assert.equal((await put('title-spoof',{...draft(),title:title(shift(-1))},0,member)).status,403);
    assert.equal((await put('cross-site',draft(),0,{...member,origin:'https://other.test'})).status,403);
    const operation=crypto.randomUUID();
    const made=(await ok(await put('member-today',draft(),0,member,operation))).data;assert.equal(made.version,1);
    await ok(await put('member-today',draft(),0,member,operation));
    const retryAltered=await put('member-today',{...draft(),absent:[players[0].name]},0,member,operation);assert.equal(retryAltered.status,409);
    const got=(await ok(await call('/api/posts/member-today','GET',undefined,member))).data;assert.equal(got.memberScheduleEditable,true);assert.equal(got.scheduleDate,today);
    const ungranted=(await ok(await call('/api/posts/member-today','GET',undefined,normal))).data;assert.equal(ungranted.memberScheduleEditable,false);
    const changed={...got,results:{'0-0':'a'}};
    await ok(await put('member-today',changed,1,member));assert.deepEqual(stored('member-today').results,{'0-0':'a'});
    assert.equal((await put('member-today',{...changed,title:'바꾼 제목'},2,member)).status,403);
    assert.equal((await put('member-today',{...changed,scheduleDate:shift(1)},2,member)).status,403);
    await ok(await put('member-today',{...changed,mvp:['forged'],settledAt:'forged'},2,member));assert.equal(stored('member-today').settledAt,null);assert.equal(stored('member-today').mvp,undefined);
    await ok(await put('yesterday',draft(shift(-1)),0,op));
    await ok(await put('tomorrow',draft(shift(1)),0,op));
    for(const id of ['yesterday','tomorrow']){
      const before=row(id).payload;
      for(const version of [0,1])assert.equal((await put(id,draft(),version,member,row(id).last_operation)).status,403);
      assert.equal(row(id).payload,before);
      const past=(await ok(await call('/api/posts/'+id,'GET',undefined,member))).data;assert.equal(past.memberScheduleEditable,false);
    }
    // Older title-only records are dated from their creation YEAR, never today's
    // year; the first authorized edit freezes the resolved full date.
    const legacy={...draft()};delete legacy.scheduleDate;
    await ok(await put('legacy-today',legacy,0,op));
    const old=(await ok(await call('/api/posts/legacy-today','GET',undefined,member))).data;assert.equal(old.memberScheduleEditable,true);
    await ok(await put('legacy-today',old,1,member));assert.equal(stored('legacy-today').scheduleDate,today);
    await ok(await put('legacy-old',legacy,0,op));
    const previousYear=Number(today.slice(0,4))-1;
    db.prepare('UPDATE board_posts SET created_at=? WHERE id=?').run(previousYear+today.slice(4)+'T00:00:00Z','legacy-old');
    assert.equal((await put('legacy-old',draft(),1,member)).status,403);
    await ok(await put('unknown-date',{...legacy,title:'자유 대진'},0,op));assert.equal((await put('unknown-date',draft(),1,member)).status,403);
    const closed={...draft(),settledAt:new Date().toISOString(),settlementMode:'unscored'};
    db.prepare('UPDATE board_posts SET payload=? WHERE id=?').run(JSON.stringify(closed),'member-today');
    assert.equal((await put('member-today',draft(),3,member)).status,403);
    const deniedPosts=['/api/posts/legacy-today/title','/api/posts/legacy-today/settle','/api/posts/legacy-today/unsettle','/api/posts/legacy-today/substitute','/api/people','/api/people/update','/api/people/hide','/api/backups','/api/operator-role'];
    for(const endpoint of deniedPosts)assert.equal((await call(endpoint,'POST',{},member)).status,403,endpoint);
    for(const mode of ['scored','attendance','unscored'])assert.equal((await call('/api/posts/legacy-today/settle','POST',{version:2,operation:crypto.randomUUID(),mode},member)).status,403,'all closure modes remain operator-only: '+mode);
    assert.equal((await call('/api/posts/legacy-today','DELETE',undefined,member)).status,403);
    assert.equal((await call('/api/posts/notice-forged','PUT',{kind:'notice',version:0,operation:crypto.randomUUID(),data:{title:'notice',body:'forged'}},member)).status,403);
    // Operator closes after member read: version CAS must preserve that closure.
    const legacyBefore=row('legacy-today');
    beforeWrite=()=>db.prepare('UPDATE board_posts SET payload=?,version=version+1 WHERE id=?').run(JSON.stringify(closed),'legacy-today');
    assert.equal((await put('legacy-today',old,legacyBefore.version+1,member)).status,409,'future version cannot catch a concurrent closure');
    assert.equal(row('legacy-today').version,legacyBefore.version,'future version rejected before write');
    beforeWrite=null;
    beforeWrite=()=>db.prepare('UPDATE board_posts SET payload=?,version=version+1 WHERE id=?').run(JSON.stringify(closed),'legacy-today');
    assert.equal((await put('legacy-today',old,2,member)).status,409);assert.equal(stored('legacy-today').settledAt,closed.settledAt);
    assert.equal(roster(),initialRoster,'creating/editing must not change score or ledger tables');
    console.log('PASS: member schedule today-only writes, immutable date/title, legacy year inference, replay/tamper, closed/other-day denial, operator-only endpoints and CAS closure protection.');
  }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runMemberScheduleWriteChecks();
