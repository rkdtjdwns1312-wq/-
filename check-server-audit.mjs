import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './test-member-worker.mjs';
import { adminKeyFor } from './dist/server/admin-login.js';

function harness(){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('./drizzle/'+file,import.meta.url),'utf8'));
  let beforeBatch=null,beforeRun=null,queryCount=0;
  const DB={prepare(sql){assert.ok(Buffer.byteLength(sql)<100000);const statement=sqlite.prepare(sql);let args=[];const execute=()=>{queryCount++;return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:statement.all(...args)}:{meta:statement.run(...args)};};return {
    sql,bind(...values){assert.ok(values.length<=100,'D1 parameter limit');args=values;return this;},async first(){queryCount++;return statement.get(...args)||null;},async all(){queryCount++;return {results:statement.all(...args)};},
    async run(){if(beforeRun){const hook=beforeRun;beforeRun=null;await hook(sql);}return execute();},execute
  };},async batch(statements){if(beforeBatch){const hook=beforeBatch;beforeBatch=null;await hook(statements);}sqlite.exec('BEGIN');try{const out=statements.map(s=>s.execute());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,EDITOR_KEY:'audit-editor',ADMIN_PASSWORD:'audit-admin',OPERATOR_PASSWORD:'audit-login'},origin='https://audit.test';
  const call=(path,method='GET',body,editor=true,extra={})=>worker.fetch(new Request(origin+path,{method,headers:{'content-type':'application/json',...(editor?{'x-kokkiri-editor':env.EDITOR_KEY}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  async function data(path,method,body){const r=await call(path,method,body),j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j.data||j;}
  const people=()=>sqlite.prepare('SELECT * FROM ranking_members WHERE hidden=0 ORDER BY rank').all();
  const person=()=>people()[0];
  const payload=()=>{const p=people().slice(0,16),names=p.map(x=>x.name);return {title:'감사 시험',names,participantIds:p.map(x=>x.member_id),courts:1,rounds:1,schedule:[{method:'same',g:[names.slice(0,4)]}],results:{'0-0':'a'}};};
  const create=id=>data('/api/posts/'+id,'PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:payload()});
  const settle=id=>data('/api/posts/'+id).then(p=>call('/api/posts/'+id+'/settle','POST',{version:p.version,operation:crypto.randomUUID()}));
  return {sqlite,DB,env,call,data,people,person,payload,create,settle,get queryCount(){return queryCount;},resetCount(){queryCount=0;},set beforeBatch(fn){beforeBatch=fn;},set beforeRun(fn){beforeRun=fn;}};
}
export async function runServerAuditChecks(){
  {
    const h=harness();try{
      await h.create('race-a');await h.create('race-b');const before=h.person();
      h.beforeBatch=async()=>assert.equal((await h.settle('race-b')).status,200);
      const r=await h.settle('race-a');
      assert.equal(r.status,409,'different schedule settlements based on the same roster must not overwrite each other');
      assert.equal(h.person().points,before.points+2);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM ranking_settlements').get().n,1);
      assert.equal((await h.settle('race-a')).status,200);assert.equal(h.person().points,before.points+4);
      const completed=await h.data('/api/posts/race-a');
      assert.equal((await h.call('/api/posts/race-a/settle','POST',{version:completed.version-1,operation:crypto.randomUUID()})).status,409,'stale confirmation cannot report another operator settlement as its own');
      assert.equal((await h.call('/api/posts/race-a/settle','POST',{version:completed.version,operation:crypto.randomUUID()})).status,200,'current completed snapshot remains idempotent');
      assert.equal(h.person().points,before.points+4);
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      await h.create('score-edit-race');const before=h.person();
      const edit={id:before.member_id,type:'member',name:before.name,points:before.points+10,reason:'경합 검사',expectedVersion:before.edit_version};
      h.beforeBatch=async()=>await h.data('/api/people/update','POST',edit);
      assert.equal((await h.settle('score-edit-race')).status,409);assert.equal(h.person().points,edit.points);
      assert.equal((await h.settle('score-edit-race')).status,200);assert.equal(h.person().points,edit.points+2);
      assert.equal((await h.call('/api/people/update','POST',{...edit,expectedVersion:before.edit_version+1})).status,409,'pre-settlement editor version must be invalidated');
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      await h.create('undo-race-a');await h.create('undo-race-b');const before=h.person();assert.equal((await h.settle('undo-race-a')).status,200);
      h.beforeBatch=async()=>assert.equal((await h.settle('undo-race-b')).status,200);
      assert.equal((await h.call('/api/posts/undo-race-a/unsettle','POST')).status,409,'a newer settlement must prevent stale undo');
      assert.equal(h.person().points,before.points+4);assert.equal(h.sqlite.prepare('SELECT COUNT(*) n FROM ranking_settlements').get().n,2);
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      await h.create('delete-race');h.beforeRun=async sql=>{assert.match(sql,/DELETE FROM board_posts/);assert.equal((await h.settle('delete-race')).status,200);};
      assert.equal((await h.call('/api/posts/delete-race','DELETE')).status,409,'delete cannot erase a newly settled post');
      assert.ok((await h.data('/api/posts/delete-race')).settledAt);
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      const before=JSON.stringify(h.people()),p=h.person(),revision=h.sqlite.prepare('SELECT revision FROM roster_write_revision').get().revision;
      h.sqlite.exec("CREATE TRIGGER audit_fail_history BEFORE INSERT ON people_changes BEGIN SELECT RAISE(ABORT,'injected history failure'); END");
      const originalError=console.error;console.error=()=>{};
      try{assert.equal((await h.call('/api/people/update','POST',{id:p.member_id,type:'member',name:p.name,points:p.points+1,reason:'실패 검사',expectedVersion:p.edit_version})).status,503);}finally{console.error=originalError;}
      assert.equal(JSON.stringify(h.people()),before,'failed history insert must roll back score, rank and edit version');assert.equal(h.sqlite.prepare('SELECT revision FROM roster_write_revision').get().revision,revision);
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      h.beforeBatch=async()=>await h.data('/api/people','POST',{name:'동시 명단',type:'guest',points:50});
      assert.equal((await h.call('/api/people','POST',{name:'동시 명단',type:'member',points:50})).status,409);
      assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM guests WHERE name='동시 명단'").get().n,1);assert.equal(h.people().filter(x=>x.name==='동시 명단').length,0);
      const p=h.person();await h.data('/api/people/hide','POST',{ids:[p.member_id]});const other=h.person();
      assert.equal((await h.call('/api/people/update','POST',{id:other.member_id,type:'member',name:p.name,points:other.points,reason:'숨긴 이름 충돌',expectedVersion:other.edit_version})).status,409);
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      const guest=await h.data('/api/people','POST',{name:'이관 전 닉네임',type:'guest',points:50}),p=h.payload();p.names[0]=guest.name;p.participantIds[0]=guest.id;p.schedule[0].g[0]=p.names.slice(0,4);
      await h.data('/api/posts/promoted-name','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:p});
      await h.data('/api/people/promote','POST',{ids:[guest.id]});
      let promoted=h.people().find(x=>x.promoted_guest_id===guest.id);
      await h.data('/api/people/update','POST',{id:promoted.member_id,type:'member',name:promoted.name,points:50,reason:'이관 후 수정',expectedVersion:promoted.edit_version});
      promoted=h.people().find(x=>x.member_id===promoted.member_id);
      await h.data('/api/people/update','POST',{id:promoted.member_id,type:'member',name:'변경된 닉네임',points:50,reason:'닉네임 수정',expectedVersion:promoted.edit_version});
      assert.equal((await h.settle('promoted-name')).status,200);
      assert.equal(h.people().find(x=>x.member_id===promoted.member_id).points,52,'old guest ID must resolve to renamed promoted member');
      await h.data('/api/posts/promoted-name/unsettle','POST');assert.equal(h.people().find(x=>x.member_id===promoted.member_id).points,50);
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      const before=h.person(),p=h.payload();p.participantIds[0]='adhoc-unknown';
      await h.data('/api/posts/adhoc-collision','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:p});
      assert.equal((await h.settle('adhoc-collision')).status,200);assert.equal(h.people().find(x=>x.member_id===before.member_id).points,before.points,'unknown explicit ID cannot accidentally credit a namesake');
      for(const ids of [[null,...p.participantIds.slice(1)],[p.participantIds[0]],p.participantIds.map(()=>p.participantIds[0]),'bad'])assert.equal((await h.call('/api/posts/bad-ids','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:{...p,participantIds:ids}})).status,400);
      const legacy={...p,participantIds:[]};await h.data('/api/posts/name-legacy','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:legacy});assert.equal((await h.settle('name-legacy')).status,200);
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      const adminKey=await adminKeyFor(h.env),adminHeaders={'x-kokkiri-admin':adminKey};
      for(const path of ['/api/people','/api/people/update','/api/people/hide','/api/people/promote','/api/posts/missing/result','/api/operator-role']){
        for(const body of [null,[],1,'bad'])assert.equal((await h.call(path,'POST',body,true,adminHeaders)).status,400,path+' malformed body');
      }
      await h.create('invalid-result');assert.equal((await h.call('/api/posts/invalid-result/result','POST',{key:'00-0',winner:'a'},false)).status,400);
      assert.equal((await h.call('/api/people','POST',{name:'소수 점수',type:'member',points:20.5})).status,400);
      for(const path of ['/api/people','/api/people/update','/api/people/hide','/api/people/promote','/api/posts/x/settle','/api/posts/x/unsettle','/api/operator-role','/api/backups'])assert.equal((await h.call(path,'POST',{},false)).status,403,path+' requires privilege');
      for(const path of ['/api/backups','/api/backups/missing','/api/people/history?type=member&id=member-1'])assert.equal((await h.call(path,'GET',undefined,false)).status,403);
      const originalError=console.error;console.error=()=>{};try{
        const r=await worker.fetch(new Request('https://audit.test/api/people',{headers:{'x-kokkiri-editor':h.env.EDITOR_KEY}}),{...h.env,DB:{prepare(){throw Error('injected DB failure');}}});assert.equal(r.status,503);assert.equal(typeof(await r.json()).error,'string');
      }finally{console.error=originalError;}
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      await h.create('backup-race');const before=h.person();
      const key=await adminKeyFor(h.env);h.beforeBatch=async()=>assert.equal((await h.settle('backup-race')).status,200);
      const r=await h.call('/api/backups','POST',undefined,false,{'x-kokkiri-admin':key});assert.equal(r.status,200);const {data}=await r.json();
      const backup=JSON.parse(h.sqlite.prepare('SELECT data FROM backups WHERE id=?').get(data.id).data);
      assert.equal(backup.members.find(x=>x.member_id===before.member_id).points,before.points+2);assert.ok(backup.settlements.find(x=>x.schedule_id==='backup-race'));assert.ok(JSON.parse(backup.posts.find(x=>x.id==='backup-race').payload).settledAt);
      h.sqlite.prepare('INSERT INTO backups VALUES (?,?,?,?)').run('expired-test','2020-01-01T00:00:00.000Z','auto','{}');
      await worker.scheduled({},h.env,{});assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM backups WHERE id='expired-test'").get().n,0);assert.ok(h.sqlite.prepare('SELECT id FROM backups WHERE id=?').get(data.id));
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      for(let i=h.people().length;i<200;i++)h.sqlite.prepare('INSERT INTO ranking_members (member_id,name,points,seed,rank,previous_rank,previous_points,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('load-'+i,'부하검사'+i,80,'B',i+1,i+1,80,'2026-09-15T00:00:00Z');
      const members=h.people(),names=members.map(p=>p.name),g=Array.from({length:50},(_,i)=>names.slice(i*4,i*4+4));
      const schedule=Array.from({length:20},()=>({method:'same',g})),results=Object.fromEntries(schedule.flatMap((r,ri)=>r.g.map((_,mi)=>[ri+'-'+mi,'a'])));
      await h.data('/api/posts/large-roster','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:{title:'대규모 로컬 검사',names,participantIds:members.map(p=>p.member_id),courts:20,rounds:20,schedule,results}});
      h.resetCount();assert.equal((await h.settle('large-roster')).status,200);const settleQueries=h.queryCount;assert.ok(settleQueries<=50,'200-person settlement stays below 50-query bound');
      const post=await h.data('/api/posts/large-roster');assert.equal((await h.call('/api/posts/large-roster/unsettle','POST',{version:post.version-1})).status,409);
      h.resetCount();await h.data('/api/posts/large-roster/unsettle','POST',{version:post.version});const undoQueries=h.queryCount;assert.ok(undoQueries<=50);
      assert.deepEqual(new Map(h.people().map(p=>[p.member_id,p.points])),new Map(members.map(p=>[p.member_id,p.points])),'large settlement undo preserves every original score');
      h.resetCount();await h.data('/api/people/hide','POST',{ids:members.slice(50).map(p=>p.member_id)});const hideQueries=h.queryCount;assert.ok(hideQueries<=50);assert.equal(h.sqlite.prepare("SELECT COUNT(*) n FROM people_changes WHERE action='hide'").get().n,150);
      const guestIds=h.sqlite.prepare('SELECT guest_id FROM guests WHERE hidden=0').all().map(g=>g.guest_id);h.resetCount();await h.data('/api/people/promote','POST',{ids:guestIds});const promoteQueries=h.queryCount;assert.ok(promoteQueries<=50);
      console.log('PASS: 200-person/20-round settle '+settleQueries+' queries, undo '+undoQueries+', hide 150 people '+hideQueries+', promote '+guestIds.length+' guests '+promoteQueries+'; SQL/parameter limits respected.');
    }finally{h.sqlite.close();}
  }
  console.log('PASS: full server audit covers atomic scoring/roster changes, malformed requests, backup consistency and permissions.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runServerAuditChecks();
