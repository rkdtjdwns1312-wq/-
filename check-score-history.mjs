import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './dist/server/index.js';
import memberWorker from './test-member-worker.mjs';
import { SCORE_WINDOW_MS } from './dist/server/score-history.js';

const migrationDir=new URL('./drizzle/',import.meta.url);
const migrations=readdirSync(migrationDir).filter(n=>n.endsWith('.sql')).sort();
const migration=readFileSync(new URL('0016_score_point_history.sql',migrationDir),'utf8');
function database(){
  const sqlite=new DatabaseSync(':memory:');
  const DB={prepare(sql){const statement=sqlite.prepare(sql);let params=[];return {
    bind(...values){params=values;return this;},async first(){return statement.get(...params)||null;},
    async all(){return {results:statement.all(...params)};},async run(){return {meta:statement.run(...params)};},
    execute(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:statement.all(...params)}:{meta:statement.run(...params)};}
  };},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  for(const name of migrations.filter(n=>n<'0016_'))sqlite.exec(readFileSync(new URL(name,migrationDir),'utf8'));
  return {sqlite,DB};
}

export async function runScoreHistoryChecks(){
  const {sqlite,DB}=database();
  const env={DB,EDITOR_KEY:'score-history-fixture'},origin='https://score-history.test';
  const call=(path,method='GET',body,auth='operator')=>{
    const headers={origin,'content-type':'application/json',...(auth==='operator'?{'x-kokkiri-editor':env.EDITOR_KEY}:{})};
    return (auth==='member'?memberWorker:worker).fetch(new Request(origin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  };
  const data=async(path,method='GET',body,auth='operator')=>{const response=await call(path,method,body,auth);const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const path=(id,type='member',before)=>'/api/people/points-history?type='+type+'&id='+id+(before?'&before='+encodeURIComponent(before):'');
  const count=()=>sqlite.prepare('SELECT count(*) AS n FROM score_point_history').get().n;
  const actual=()=>JSON.stringify(['ranking_members','guests','ranking_events','guest_events','ranking_settlements','board_posts'].map(t=>sqlite.prepare('SELECT * FROM '+t).all()));
  const insertMember=sqlite.prepare('INSERT INTO ranking_members(member_id,name,points,seed,rank,previous_rank,updated_at,promoted_guest_id) VALUES(?,?,?,?,?,?,?,?)');
  const at=new Date(Date.now()-50*86400000).toISOString(),oldAt=new Date(Date.now()-700*86400000).toISOString();
  try{
    insertMember.run('history-member','이력 회원',63,'C',100,100,at,'history-guest');
    insertMember.run('history-baseline','이력 기준',29,'E+',101,101,at,null);
    insertMember.run('history-current','이력 현재만',40,'D',102,102,at,null);
    sqlite.prepare('INSERT INTO guests(guest_id,name,points,hidden,created_at) VALUES(?,?,?,?,?)').run('history-guest','이력 회원',55,1,oldAt);
    sqlite.prepare('INSERT INTO guests(guest_id,name,points,hidden,created_at) VALUES(?,?,?,?,?)').run('history-other','동명이인',31,0,at);
    const guestEvent=sqlite.prepare('INSERT INTO guest_events(schedule_id,guest_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,created_at) VALUES(?,?,1,1,0,2,?,?,?)');
    guestEvent.run('history-old','history-guest',17,19,oldAt);
    guestEvent.run('history-null-date','history-guest',19,21,null);
    const event=sqlite.prepare('INSERT INTO ranking_events(schedule_id,member_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,rank_before,rank_after,seed_before,seed_after,created_at) VALUES(?,?,1,1,0,2,?,?,1,1,?,?,?)');
    event.run('history-recent','history-member',60,62,'C','C',at);
    event.run('history-baseline-event','history-baseline',27,29,'E+','E+',at);
    sqlite.prepare('INSERT INTO people_changes(id,person_type,person_id,action,before_points,after_points,reason,created_at) VALUES(?,?,?,?,?,?,?,?)').run('history-edit','member','history-member','update',62,63,'private operator reason',new Date(Date.parse(at)+1).toISOString());
    const beforeMigration=actual();
    sqlite.exec(migration);
    assert.equal(actual(),beforeMigration,'migration never modifies scores/ranks/results/roster');
    const firstCount=count();sqlite.exec(migration);assert.equal(count(),firstCount,'immediate migration replay has no duplicate observations');
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM score_point_history WHERE person_id='history-guest' AND kind='snapshot'").get().n,0,'hidden promoted guest has no stale snapshot');
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM score_point_history WHERE person_id='history-guest'").get().n,1,'unrecoverable dates not invented');
    assert.equal((await call(path('history-member'),'GET',undefined,'public')).status,401);
    assert.equal((await call(path('history-member'),'POST',{},'member')).status,405);
    const beforeRead=actual(),beforeReadCount=count();
    const recent=await data(path('history-member'),'GET',undefined,'member');
    assert.equal(Date.parse(recent.range.to)-Date.parse(recent.range.from),SCORE_WINDOW_MS);
    assert.equal(SCORE_WINDOW_MS,140*86400000);
    assert.equal(recent.person.points,63);assert.equal(recent.person.name,'이력 회원');
    assert.equal(recent.points.at(-1).kind,'current');assert.equal(recent.points.at(-1).points,63);
    assert.ok(recent.points.some(p=>p.kind==='manual'&&p.before===62&&p.points===63));
    assert.equal(recent.carry.points,19,'promoted member includes guest record');assert.equal(recent.hasOlder,true);
    assert.ok(!JSON.stringify(recent).includes('private operator reason'));
    assert.equal(actual(),beforeRead);assert.equal(count(),beforeReadCount,'GET never creates history');
    let page=recent,all=[...recent.points],pages=0;
    while(page.hasOlder){const prior=page;page=await data(path('history-member','member',prior.nextBefore));assert.equal(page.range.to,prior.range.from);assert.equal(Date.parse(page.range.to)-Date.parse(page.range.from),SCORE_WINDOW_MS);assert.ok(!page.points.some(p=>p.kind==='current'));all.push(...page.points);assert.ok(++pages<10);}
    assert.ok(pages>=4,'sparse multiyear history pages across 20-week windows');
    assert.ok(all.some(p=>p.points===17&&p.kind==='baseline'),'historical below-floor values retained');
    const baseline=await data(path('history-baseline'));
    assert.equal(baseline.points[0].kind,'baseline');assert.equal(baseline.points[0].points,27);assert.equal(baseline.points[0].at,at,'baseline does not invent an earlier date');
    const current=await data(path('history-current'));assert.deepEqual(current.points.map(p=>p.kind),['snapshot','current']);assert.equal(current.hasOlder,false);
    for(const query of ['type=admin&id=history-member','type=member&id=%27OR1','type=member&id=history-member&before=bad','type=member&id=history-member&before=9999-01-01T00:00:00.000Z','type=member&id=history-member&before=2026-02-30T00:00:00.000Z'])assert.equal((await call('/api/people/points-history?'+query)).status,400,query);
    assert.equal((await call(path('missing'))).status,404);assert.equal((await call(path('history-guest','guest'))).status,404);
    const initialCount=count();
    sqlite.exec("UPDATE ranking_members SET name='이력 개명',points=63,rank=99 WHERE member_id='history-member'");assert.equal(count(),initialCount,'rename, rank and unchanged points do not add events');
    sqlite.exec("UPDATE ranking_members SET points=64 WHERE member_id='history-member'");assert.equal(count(),initialCount+1);
    sqlite.exec("BEGIN; UPDATE ranking_members SET points=65 WHERE member_id='history-member'; ROLLBACK;");assert.equal(count(),initialCount+1,'rollback cancels trigger append');
    const renamed=await data(path('history-member'));assert.equal(renamed.person.name,'이력 개명');assert.ok(renamed.points.some(p=>p.before===63&&p.points===64));
    const realNow=Date.now;
    try{Date.now=()=>realNow()-5000;const skewed=await data(path('history-member'));assert.ok(skewed.points.some(p=>p.before===63&&p.points===64),'DB clock, not lagging worker clock, bounds the current snapshot');assert.equal(Date.parse(skewed.range.to)-Date.parse(skewed.range.from),SCORE_WINDOW_MS);}finally{Date.now=realNow;}
    const boundary=new Date(Date.now()-250*86400000).toISOString();
    sqlite.prepare('INSERT INTO score_point_history(person_type,person_id,recorded_at,points_before,points_after,kind) VALUES(?,?,?,?,?,?)').run('member','history-member',boundary,54,55,'change');
    const ending=await data(path('history-member','member',boundary));assert.ok(!ending.points.some(p=>p.at===boundary));
    const starting=await data(path('history-member','member',new Date(Date.parse(boundary)+SCORE_WINDOW_MS).toISOString()));assert.ok(starting.points.some(p=>p.at===boundary),'half-open ranges include each boundary record once');
    // Full real workflow: create -> settle -> promote -> unsettle must retain every actual change.
    const add=async(name,type,points)=>(await data('/api/people','POST',{name,type,points})).data;
    const a=await add('점수검사 A','member',50),b=await add('점수검사 B','guest',40),c=await add('점수검사 C','member',50),d=await add('점수검사 D','member',40);
    const names=[a.name,b.name,c.name,d.name],id='history-settlement';
    await data('/api/posts/'+id,'PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:{title:'점수 이력 검사',names,participantIds:[a.id,b.id,c.id,d.id],courts:1,rounds:1,schedule:[{round:1,method:'same',g:[names]}],results:{'0-0':'a'}}});
    const post=(await data('/api/posts/'+id)).data;
    await data('/api/posts/'+id+'/settle','POST',{version:post.version,operation:crypto.randomUUID()});
    assert.equal((await data(path(a.id))).person.points,52);
    assert.ok((await data(path(b.id,'guest'))).points.some(p=>p.before===40&&p.points===42));
    await data('/api/people/promote','POST',{ids:[b.id]});
    const promoted=(await data('/api/people')).people.find(p=>p.name===b.name&&p.type==='member');assert.ok(promoted);
    const promotedHistory=await data(path(promoted.id));assert.ok(promotedHistory.points.some(p=>p.before===40&&p.points===42));
    await data('/api/posts/'+id+'/unsettle','POST',{});
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM ranking_events WHERE schedule_id=?').get(id).n,0);
    const undone=await data(path(a.id));assert.equal(undone.person.points,50);assert.ok(undone.points.some(p=>p.before===50&&p.points===52));assert.ok(undone.points.some(p=>p.before===52&&p.points===50));
    const promotedUndo=await data(path(promoted.id));assert.equal(promotedUndo.person.points,40);assert.ok(promotedUndo.points.some(p=>p.before===42&&p.points===40));
    console.log('PASS: score history migration/backfill, 140-day pages, auth, stable IDs/promotion, readonly retrieval, rollback, settlement and cancellation ledger.');
  }finally{sqlite.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runScoreHistoryChecks();
