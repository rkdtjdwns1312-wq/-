import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import worker from './test-member-worker.mjs';
import { createScheduleTools } from './dist/server/schedule-tools.js';

export async function runMatchProgressChecks(){
  const sqlite=new DatabaseSync(':memory:'),dir=new URL('./drizzle/',import.meta.url);
  for(const file of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(file,dir),'utf8'));
  const DB={prepare(sql){const s=sqlite.prepare(sql);let p=[];return {bind(...v){p=v;return this;},async first(){return s.get(...p)||null;},async all(){return {results:s.all(...p)};},async run(){return {meta:s.run(...p)};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,EDITOR_KEY:crypto.randomUUID()},origin='https://match-progress.test',t=createScheduleTools();
  const call=(path,method='GET',body,editor=false)=>worker.fetch(new Request(origin+path,{method,headers:{'content-type':'application/json',...(editor?{'x-kokkiri-editor':env.EDITOR_KEY}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  async function data(path,method,body,editor=false){const r=await call(path,method,body,editor),x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x.data||x;}
  const get=id=>data('/api/posts/'+id);
  const save=(id,p,v=0)=>data('/api/posts/'+id,'PUT',{kind:'schedule',version:v,operation:crypto.randomUUID(),data:p},true);
  const progress=async(id,key,state)=>{const p=await get(id);return data('/api/posts/'+id+'/progress','POST',{key,state,version:p.version});};
  const score=(id,key,winner)=>data('/api/posts/'+id+'/result','POST',{key,winner});
  const rankingSnapshot=()=>JSON.stringify({members:sqlite.prepare('SELECT * FROM ranking_members ORDER BY member_id').all(),guests:sqlite.prepare('SELECT * FROM guests ORDER BY guest_id').all(),events:sqlite.prepare('SELECT * FROM ranking_events').all(),settlements:sqlite.prepare('SELECT * FROM ranking_settlements').all()});
  try{
    const people=(await data('/api/rankings')).items.slice(0,8),names=people.map(p=>p.name);
    const p={title:'진행 상태 검사',names,participantIds:people.map(p=>p.member_id),courts:2,rounds:2,schedule:[{method:'same',g:[names.slice(0,4),names.slice(4,8)]},{method:'random',g:[names.slice(0,4)]}],results:{}};
    const id='match-progress';let d=await save(id,p);assert.deepEqual(d.matchProgress,{});assert.equal(t.matchState(d,0,0),'waiting');
    const baseline=rankingSnapshot();
    // Simulate a progress write after settlement reads but before its atomic batch.
    const racePost=await save('settle-progress-race',{...p,results:{'0-0':'a','0-1':'b'}});
    const originalBatch=DB.batch;
    DB.batch=async statements=>{
      DB.batch=originalBatch;
      const update=await call('/api/posts/settle-progress-race/progress','POST',{key:'1-0',state:'playing',version:racePost.version});
      assert.equal(update.status,200);
      return originalBatch(statements);
    };
    const failedSettle=await call('/api/posts/settle-progress-race/settle','POST',{version:racePost.version,operation:crypto.randomUUID()},true);
    assert.equal(failedSettle.status,409,'concurrent progress must abort the entire settlement');
    assert.equal(rankingSnapshot(),baseline,'failed settlement writes no points, events or settlement record');
    assert.equal((await get('settle-progress-race')).settledAt,null);
    assert.equal((await call('/api/posts/'+id+'/progress')).status,405);
    for(const body of [null,{}, {key:'00-0',state:'playing',version:1},{key:'0-0',state:'bad',version:1},{key:'0-0',state:'playing'},{key:'4-0',state:'playing',version:1}])assert.equal((await call('/api/posts/'+id+'/progress','POST',body)).status,400);
    assert.equal((await call('/api/posts/missing/progress','POST',{key:'0-0',state:'playing',version:1})).status,404);
    const race=await Promise.all([call('/api/posts/'+id+'/progress','POST',{key:'0-0',state:'playing',version:1}),call('/api/posts/'+id+'/progress','POST',{key:'0-1',state:'playing',version:1})]);
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409],'two stale writers cannot overwrite each other');
    await progress(id,'0-0','playing');await progress(id,'0-1','playing');
    d=await get(id);assert.equal(t.matchState(d,0,0),'playing');assert.equal(t.matchState(d,0,1),'playing');
    const same=await progress(id,'0-0','playing');assert.equal(same.version,d.version,'same-state retry is idempotent');
    assert.equal((await call('/api/posts/'+id+'/progress','POST',{key:'0-0',state:'finished',version:d.version})).status,400);
    await score(id,'0-0','a');d=await get(id);
    assert.equal(t.matchState(d,0,0),'finished');assert.equal(d.matchProgress['0-0'],undefined);assert.equal(t.matchState(d,0,1),'playing');
    assert.equal((await call('/api/posts/'+id+'/progress','POST',{key:'0-0',state:'waiting',version:d.version})).status,409);
    assert.equal((await call('/api/posts/'+id+'/progress','POST',{key:'1-0',state:'finished',version:d.version})).status,400);
    await progress(id,'1-0','playing');await progress(id,'1-0','finished');d=await get(id);
    assert.equal(t.matchState(d,1,0),'finished');assert.equal(d.results['1-0'],undefined);
    await progress(id,'1-0','waiting');assert.equal(t.matchState(await get(id),1,0),'waiting');
    assert.equal(rankingSnapshot(),baseline,'progress and result clicks never settle or change points');
    d=await get(id);let edited=await save(id,{...d,title:'제목만 변경',matchProgress:{}},d.version);
    assert.equal(edited.matchProgress['0-1'],'playing','old editor preserving same game cannot erase status');
    const copied=await save('match-copy',edited);assert.deepEqual(copied.matchProgress,{},'new schedule never inherits playing markers');
    const changed=structuredClone(edited);t.replacePlayer(changed,0,1,0,names[0]);
    assert.equal(changed.matchProgress['0-1'],undefined);
    edited=await save(id,changed,edited.version);assert.equal(t.matchState(edited,0,1),'waiting');
    await progress(id,'0-1','playing');edited=await get(id);
    edited=await save(id,{...edited,absent:[names[5]]},edited.version);
    assert.equal(t.matchState(edited,0,1),'void');assert.equal(edited.matchProgress['0-1'],undefined);
    assert.equal((await call('/api/posts/'+id+'/progress','POST',{key:'0-1',state:'playing',version:edited.version})).status,400);
    edited=await save(id,{...edited,absent:[]},edited.version);
    assert.equal(t.matchState(edited,0,1),'waiting');
    await progress(id,'0-1','playing');await progress(id,'1-0','playing');edited=await get(id);
    const removed={...edited,schedule:[{...edited.schedule[0],g:[edited.schedule[0].g[1]]},edited.schedule[1]],results:{}};
    edited=await save(id,removed,edited.version);
    assert.equal(t.matchState(edited,0,0),'waiting','reindexed court does not inherit different-game status');
    assert.equal(edited.matchProgress['0-1'],undefined);assert.equal(t.matchState(edited,1,0),'playing');
    await score(id,'0-0','b');edited=await get(id);
    await data('/api/posts/'+id+'/settle','POST',{version:edited.version,operation:crypto.randomUUID()},true);
    edited=await get(id);assert.equal(t.matchState(edited,0,0),'finished');assert.equal(t.matchState(edited,1,0),'finished');
    assert.equal((await call('/api/posts/'+id+'/progress','POST',{key:'1-0',state:'waiting',version:edited.version})).status,409);
    const browserTools=(new Function('return ('+createScheduleTools.toString()+')'))()();
    assert.equal(browserTools.matchState(edited,1,0),'finished','serialized browser factory stays self-contained');
    console.log('PASS: shared match progress, optimistic conflicts, auto finish, random manual finish, locked/void guards, edit/reset safety and no scoring side effects.');
  }finally{sqlite.close();}
}
