import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './test-member-worker.mjs';

export async function runSubstitutionChecks(){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('./drizzle/'+file,import.meta.url),'utf8'));
  let beforeRun=null,beforeBatch=null;
  const DB={prepare(sql){const s=sqlite.prepare(sql);let p=[];const execute=()=>/^\s*(SELECT|WITH)\b/i.test(sql)?{results:s.all(...p)}:{meta:s.run(...p)};return {bind(...v){p=v;return this;},async first(){return s.get(...p)||null;},async all(){return {results:s.all(...p)};},async run(){if(beforeRun){const f=beforeRun;beforeRun=null;await f(sql);}return execute();},execute};},async batch(statements){if(beforeBatch){const f=beforeBatch;beforeBatch=null;await f();}sqlite.exec('BEGIN');try{const r=statements.map(s=>s.execute());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,EDITOR_KEY:crypto.randomUUID()},origin='https://substitution.test';
  const call=(path,method='GET',body,editor=true)=>worker.fetch(new Request(origin+path,{method,headers:{'content-type':'application/json',...(editor?{'x-kokkiri-editor':env.EDITOR_KEY}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  async function data(path,method,body){const r=await call(path,method,body),j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j.data||j;}
  const get=id=>data('/api/posts/'+id);
  const save=(id,p)=>data('/api/posts/'+id,'PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:p});
  const snapshot=()=>JSON.stringify(['ranking_members','guests','ranking_events','guest_events','ranking_settlements'].map(t=>sqlite.prepare('SELECT * FROM '+t).all()));
  try{
    const people=sqlite.prepare('SELECT * FROM ranking_members WHERE hidden=0 ORDER BY rank').all().slice(0,10),guest=sqlite.prepare('SELECT * FROM guests WHERE hidden=0 ORDER BY points DESC').get();
    const names=people.slice(0,8).map(p=>p.name),ids=people.slice(0,8).map(p=>p.member_id);
    const payload={title:'긴급교체 검사',names,participantIds:ids,courts:2,rounds:2,schedule:[{method:'same',g:[names.slice(0,4),names.slice(4,8)]},{method:'random',g:[names.slice(0,4),names.slice(4,8)]}],results:{'0-0':'a','0-1':'b'}};
    const id='sub-test',path='/api/posts/'+id+'/substitute';let post=await save(id,payload);
    await data('/api/posts/'+id+'/progress','POST',{key:'1-1',state:'playing',version:post.version});post=await get(id);
    const original=structuredClone(post),baseline=snapshot();
    const input=()=>({version:post.version,round:1,court:1,oldName:names[0],newName:people[8].name});
    assert.equal((await call(path)).status,405);
    assert.equal((await call(path,'POST',input(),false)).status,403);
    for(const extra of [null,{}, {...input(),round:0},{...input(),court:1.5},{...input(),oldName:''},{...input(),newName:'줄\n바꿈'}])assert.equal((await call(path,'POST',extra)).status,400);
    assert.equal((await call('/api/posts/missing/substitute','POST',input())).status,404);
    for(const extra of [{oldName:'없는 선수'},{newName:names[0]},{newName:names[1]},{newName:'시드에 미등록'},{court:3}])assert.equal((await call(path,'POST',{...input(),...extra})).status,400);
    assert.deepEqual(await get(id),post,'invalid replacement changes nothing');
    post=await data(path,'POST',{...input(),oldName:' '+names[0]+' ',newName:' '+people[8].name+' '});
    assert.equal(post.version,original.version+1);assert.equal(post.schedule[0].g[0][0],people[8].name);
    assert.deepEqual(post.schedule[0].g[1],original.schedule[0].g[1]);assert.deepEqual(post.schedule[1].g,original.schedule[1].g);
    assert.deepEqual(post.results,original.results,'already recorded wins survive');assert.deepEqual(post.matchProgress,original.matchProgress,'progress states survive');
    assert.equal(post.participantIds[post.names.indexOf(people[8].name)],people[8].member_id);assert.ok(post.names.includes(names[0]),'outgoing attendee remains on the attendance roster');
    assert.ok(post.schedule[0].rest.includes(names[0]));assert.equal(snapshot(),baseline,'replacement alone never changes points');
    assert.equal((await call(path,'POST',{...input(),version:original.version})).status,409);
    post=await data(path,'POST',{version:post.version,round:1,court:2,oldName:names[6],newName:guest.name});
    const beforeSettle=post;
    await data('/api/posts/'+id+'/settle','POST',{version:post.version,operation:crypto.randomUUID()});
    const updated=pid=>sqlite.prepare('SELECT * FROM ranking_members WHERE member_id=?').get(pid);
    assert.equal(updated(people[8].member_id).points,people[8].points+2,'new winning substitute gets attendance + win');
    assert.equal(updated(people[8].member_id).wins,1);assert.equal(updated(people[8].member_id).attendance,1);
    assert.equal(updated(people[0].member_id).points,people[0].points+1,'outgoing player no longer gets replaced win but keeps attendance');
    const updatedGuest=sqlite.prepare('SELECT * FROM guests WHERE guest_id=?').get(guest.guest_id);
    assert.equal(updatedGuest.points,guest.points+2,'guest substitute is scored by guest ID');assert.equal(updatedGuest.wins,1);
    post=await get(id);assert.equal((await call(path,'POST',input())).status,409,'settled games are locked');
    await data('/api/posts/'+id+'/unsettle','POST',{version:post.version});
    assert.equal(updated(people[8].member_id).points,people[8].points);assert.equal(sqlite.prepare('SELECT points FROM guests WHERE guest_id=?').get(guest.guest_id).points,guest.points,'undo restores substitute points');
    assert.deepEqual((await get(id)).schedule,beforeSettle.schedule);

    let loss=await save('sub-loss',payload);
    loss=await data('/api/posts/sub-loss/substitute','POST',{version:loss.version,round:1,court:1,oldName:names[2],newName:people[9].name});
    loss=await data('/api/posts/sub-loss/substitute','POST',{version:loss.version,round:1,court:1,oldName:names[0],newName:names[4]});
    assert.equal(loss.names.filter(n=>n===names[4]).length,1,'existing participant is reused without double attendance');
    await data('/api/posts/sub-loss/settle','POST',{version:loss.version,operation:crypto.randomUUID()});
    assert.equal(updated(people[9].member_id).points,people[9].points,'losing replacement gets attendance +1 and loss -1');
    assert.equal(updated(people[9].member_id).losses,1);assert.equal(updated(people[9].member_id).attendance,1);
    assert.equal(updated(people[4].member_id).attendance,1);assert.equal(updated(people[4].member_id).wins,1);assert.equal(updated(people[4].member_id).losses,1);
    await data('/api/posts/sub-loss/unsettle','POST',{version:(await get('sub-loss')).version});

    // ID-less legacy posts freeze the same resolution and preserve unregistered adhoc people.
    let legacy=await save('sub-legacy',{...payload,names:[...names,'임시 참가'],participantIds:[]});
    legacy=await data('/api/posts/sub-legacy/substitute','POST',{version:legacy.version,round:1,court:1,oldName:names[0],newName:people[8].name});
    assert.equal(legacy.participantIds[legacy.names.indexOf(people[8].name)],people[8].member_id);
    assert.equal(legacy.participantIds[1],ids[1]);assert.match(legacy.participantIds[8],/^adhoc-/);
    let guarded=await save('sub-guard',{...payload,absent:[names[4]],lateRounds:{[names[5]]:1},schedule:[{method:'same',g:[names.slice(0,4)]},payload.schedule[1]],results:{'0-0':'a'}});
    for(const newName of [names[4],names[5]])assert.equal((await call('/api/posts/sub-guard/substitute','POST',{version:guarded.version,round:1,court:1,oldName:names[0],newName})).status,400,'absent/late status is not silently changed');
    sqlite.prepare('UPDATE guests SET name=? WHERE guest_id=?').run(people[8].name,guest.guest_id);
    assert.equal((await call('/api/posts/sub-guard/substitute','POST',{version:guarded.version,round:1,court:1,oldName:names[0],newName:people[8].name})).status,400,'ambiguous names are never guessed');
    sqlite.prepare('UPDATE guests SET name=? WHERE guest_id=?').run(guest.name,guest.guest_id);

    // A promoted guest's historic ID/name and current member ID/name may coexist.
    // Compare every alias by the real member ID, not just the first display label.
    sqlite.prepare('UPDATE ranking_members SET promoted_guest_id=? WHERE member_id=?').run(guest.guest_id,people[8].member_id);
    sqlite.prepare('UPDATE guests SET hidden=1 WHERE guest_id=?').run(guest.guest_id);
    const aliasPayload={...payload,names:[...names,'이관 전 별칭',people[8].name],participantIds:[...ids,guest.guest_id,people[8].member_id],schedule:[{method:'same',g:[[names[0],people[8].name,names[2],names[3]],names.slice(4,8)]},payload.schedule[1]]};
    const aliasPost=await save('sub-alias',aliasPayload),aliasBefore=snapshot();
    assert.equal((await call('/api/posts/sub-alias/substitute','POST',{version:aliasPost.version,round:1,court:1,oldName:names[0],newName:people[8].name})).status,400,'different labels for one promoted member cannot fill two game slots');
    assert.deepEqual(await get('sub-alias'),aliasPost);assert.equal(snapshot(),aliasBefore,'alias rejection leaves points untouched');
    for(const status of [{absent:[people[8].name]},{lateRounds:{[people[8].name]:1}}]){
      const aliasGuard=await save('sub-alias-'+Object.keys(status)[0],{...aliasPayload,schedule:payload.schedule,...status});
      assert.equal((await call('/api/posts/'+aliasGuard.id+'/substitute','POST',{version:aliasGuard.version,round:1,court:1,oldName:names[0],newName:people[8].name})).status,400,'promoted aliases cannot bypass absence/late restrictions');
    }
    sqlite.prepare('UPDATE ranking_members SET promoted_guest_id=? WHERE member_id=?').run(people[8].promoted_guest_id,people[8].member_id);
    sqlite.prepare('UPDATE guests SET hidden=? WHERE guest_id=?').run(guest.hidden,guest.guest_id);

    const race=await save('sub-race',payload),raceInput={version:race.version,round:1,court:1,oldName:names[0],newName:people[8].name};
    beforeRun=async sql=>{assert.match(sql,/UPDATE board_posts/);await data('/api/posts/sub-race/result','POST',{key:'0-1',winner:'a',version:race.version});};
    assert.equal((await call('/api/posts/sub-race/substitute','POST',raceInput)).status,409,'a concurrent result is never overwritten');
    assert.deepEqual((await get('sub-race')).schedule,race.schedule);
    let next=await get('sub-race');
    beforeRun=async()=>{sqlite.exec('UPDATE roster_write_revision SET revision=revision+1 WHERE id=1');};
    assert.equal((await call('/api/posts/sub-race/substitute','POST',{...raceInput,version:next.version})).status,409,'roster changes during resolution invalidate replacement');
    assert.deepEqual(await get('sub-race'),next);
    const pointsBeforeRace=snapshot();
    beforeBatch=async()=>{next=await data('/api/posts/sub-race/substitute','POST',{...raceInput,version:next.version});};
    assert.equal((await call('/api/posts/sub-race/settle','POST',{version:next.version,operation:crypto.randomUUID()})).status,409,'replacement invalidates an in-flight settlement');
    assert.equal(snapshot(),pointsBeforeRace,'failed stale settlement writes no points or histories');
    console.log('PASS: emergency substitution preserves results/progress, verifies roster IDs, scores members/guests, exact undo, legacy IDs, stale/locked/ambiguous/late/absent guards and races.');
  }finally{sqlite.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runSubstitutionChecks();
