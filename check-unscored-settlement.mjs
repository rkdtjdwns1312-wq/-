import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './test-member-worker.mjs';

function harness(){
  const sqlite=new DatabaseSync(':memory:');
  const dir=new URL('./drizzle/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(name,dir),'utf8'));
  let beforeWrite=null,beforeBatch=null;
  const DB={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];
    const hook=async()=>{if(beforeWrite&&!/^\s*(SELECT|WITH)\b/i.test(sql)){const fn=beforeWrite;beforeWrite=null;await fn(sql);}};
    return {bind(...values){args=values;return this;},async first(){await hook();return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){await hook();return {meta:stmt.run(...args)};},execute(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:stmt.all(...args)}:{meta:stmt.run(...args)};}};},async batch(statements){if(beforeBatch){const fn=beforeBatch;beforeBatch=null;await fn();}sqlite.exec('BEGIN');try{const result=statements.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,EDITOR_KEY:'unscored-fixture'},origin='https://unscored.test';
  const call=(path,method='GET',body,editor=true)=>worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',...(editor?{'x-kokkiri-editor':env.EDITOR_KEY}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const data=async(...args)=>{const r=await call(...args),body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body;};
  const players=sqlite.prepare('SELECT member_id AS id,name FROM ranking_members ORDER BY rank LIMIT 3').all();
  players.push(sqlite.prepare('SELECT guest_id AS id,name FROM guests WHERE hidden=0 LIMIT 1').get());
  const resting=sqlite.prepare('SELECT member_id AS id,name FROM ranking_members ORDER BY rank LIMIT 12 OFFSET 3').all();
  const roster=[...players,...resting];
  const payload=complete=>({title:'미반영 로컬 검사',names:roster.map(p=>p.name),participantIds:roster.map(p=>p.id),courts:1,rounds:2,schedule:[1,2].map(round=>({round,method:'same',g:[players.map(p=>p.name)]})),results:complete?{'0-0':'a','1-0':'a'}:{'0-0':'a'}});
  const create=async(id,complete=true)=>(await data('/api/posts/'+id,'PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:payload(complete)})).data;
  const get=async id=>(await data('/api/posts/'+id)).data;
  const close=(id,mode,version=1,operation=crypto.randomUUID())=>call('/api/posts/'+id+'/settle','POST',{version,operation,...(mode===undefined?{}:{mode})});
  const scoringSnapshot=()=>JSON.stringify(['ranking_members','guests','ranking_settlements','ranking_events','guest_events','people_changes','score_point_history','roster_write_revision'].map(t=>sqlite.prepare('SELECT * FROM '+t).all()));
  // SQLite and JS clocks can differ by a few milliseconds on Windows. Supply
  // an accepted explicit bound so a just-written closure is always in view.
  const display=async()=>({rankings:await data('/api/rankings'),people:await data('/api/people'),mvp:await data('/api/mvp'),graph:(await data('/api/people/points-history?type=member&id='+players[0].id+'&before='+encodeURIComponent(new Date(Date.now()+500).toISOString()))).points});
  return {sqlite,call,data,players,payload,create,get,close,scoringSnapshot,display,set beforeWrite(fn){beforeWrite=fn;},set beforeBatch(fn){beforeBatch=fn;}};
}

export async function runUnscoredSettlementChecks(){
  const h=harness();
  try{
    await h.create('prior');assert.equal((await h.close('prior')).status,200,'legacy omitted mode still scores');
    const before=h.scoringSnapshot(),display=await h.display();
    assert.equal(display.rankings.displaySettlementId,'prior');
    assert.equal(display.rankings.items.find(p=>p.member_id===h.players[0].id).attendance,1);
    assert.equal(display.graph.length,1,'the preserved graph snapshot must include the scored closure');
    assert.ok(display.rankings.items.some(p=>p.wins===2));assert.ok(display.people.people.some(p=>p.type==='guest'&&p.losses===2));
    const draft=await h.create('unscored',false),operation=crypto.randomUUID();
    assert.equal((await h.close('unscored','scored')).status,400,'regular closure still needs all results');
    for(const mode of [null,false,0,'',{},'skip'])assert.equal((await h.close('unscored',mode)).status,400,'invalid mode fails closed');
    assert.equal((await h.call('/api/posts/unscored/settle','POST',{version:1,operation,mode:'unscored'},false)).status,403);
    assert.equal((await h.close('unscored','unscored',99)).status,409);
    let response=await h.close('unscored','unscored',1,operation);assert.equal(response.status,200);
    const closed=(await response.json()).data;assert.ok(closed.settledAt);assert.equal(closed.settlementMode,'unscored');assert.equal(closed.version,2);
    assert.deepEqual(closed.results,draft.results);assert.deepEqual(closed.schedule,draft.schedule);assert.deepEqual(closed.mvp,[]);
    assert.equal(h.scoringSnapshot(),before,'all scoring and roster tables byte-identical');assert.deepEqual(await h.display(),display,'all previous weekly indicators/MVP/graph remain');
    assert.equal((await h.close('unscored','unscored',1,operation)).status,200,'exact retry is idempotent');
    assert.equal((await h.close('unscored','unscored',1)).status,409,'stale unrelated retry rejected');
    assert.equal((await h.close('unscored','scored',2)).status,409,'cannot rescore an unscored closure without reopening');
    assert.equal((await h.close('prior','unscored',2)).status,409,'cannot silently downgrade a real settlement');
    const listed=(await h.data('/api/posts?kind=schedule')).items.find(p=>p.id==='unscored');assert.equal(listed.settlementMode,'unscored');
    assert.equal((await h.call('/api/posts/unscored/result','POST',{key:'1-0',winner:'b'})).status,409);
    assert.equal((await h.call('/api/posts/unscored/progress','POST',{key:'1-0',state:'playing',version:2})).status,409);
    assert.equal((await h.call('/api/posts/unscored','PUT',{kind:'schedule',version:2,operation:crypto.randomUUID(),data:h.payload(true)})).status,409);
    assert.equal((await h.call('/api/posts/unscored','DELETE')).status,409);
    assert.equal((await h.call('/api/posts/unscored/unsettle','POST',{version:1})).status,409);
    await h.create('later');assert.equal((await h.close('later')).status,200);
    const afterLater=h.scoringSnapshot(),displayLater=await h.display();
    const reopened=(await h.data('/api/posts/unscored/unsettle','POST',{version:2})).data;
    assert.equal(reopened.settledAt,null);assert.equal(reopened.settlementMode,undefined);assert.deepEqual(reopened.results,draft.results);
    assert.equal(h.scoringSnapshot(),afterLater,'nonlatest unscored reopening does not undo later scores');assert.deepEqual(await h.display(),displayLater);
    await h.data('/api/posts/unscored','PUT',{kind:'schedule',version:3,operation:crypto.randomUUID(),data:h.payload(true)});
    assert.equal((await h.close('unscored','scored',4)).status,200,'reopened unscored can be genuinely settled');
    assert.equal((await h.display()).rankings.displaySettlementId,'unscored');
    // Do not treat the unscored closure as the latest score settlement for normal undo.
    await h.create('other-unscored');assert.equal((await h.close('other-unscored','unscored')).status,200);
    await h.data('/api/posts/unscored/unsettle','POST',{version:5});
    assert.equal((await h.display()).rankings.displaySettlementId,'later');
    assert.equal((await h.get('other-unscored')).settlementMode,'unscored');
  }finally{h.sqlite.close();}
  // Race the two closure modes at their write boundaries, in both directions.
  for(const sameOperation of [false,true])for(const outer of ['unscored','scored']){
    const h=harness();try{
      await h.create('race');const before=h.scoringSnapshot();
      const inner=outer==='unscored'?'scored':'unscored';
      const operation=crypto.randomUUID();
      const hook=async()=>assert.equal((await h.close('race',inner,1,sameOperation?operation:crypto.randomUUID())).status,200);
      if(outer==='unscored')h.beforeWrite=hook;else h.beforeBatch=hook;
      assert.equal((await h.close('race',outer,1,operation)).status,409,'opposite-mode race must not report success, even with the same operation ID');
      assert.equal((await h.get('race')).settlementMode,inner);
      assert.equal(h.sqlite.prepare('SELECT count(*) n FROM ranking_settlements').get().n,inner==='scored'?1:0);
      if(inner==='unscored')assert.equal(h.scoringSnapshot(),before,'rolled-back scoring never changes history');
    }finally{h.sqlite.close();}
  }
  {
    const h=harness();try{
      await h.create('edit-race');const before=h.scoringSnapshot();
      h.beforeWrite=async()=>{await h.data('/api/posts/edit-race/result','POST',{key:'0-0',winner:'b'});};
      assert.equal((await h.close('edit-race','unscored')).status,409);assert.equal((await h.get('edit-race')).settledAt,null);assert.equal(h.scoringSnapshot(),before);
      const operation=crypto.randomUUID();h.beforeWrite=async()=>assert.equal((await h.close('edit-race','unscored',2,operation)).status,200);
      assert.equal((await h.close('edit-race','unscored',2,operation)).status,200,'same-operation race is safely idempotent');
      h.beforeWrite=async()=>{await h.data('/api/posts/edit-race/unsettle','POST',{version:3});};
      assert.equal((await h.call('/api/posts/edit-race/unsettle','POST',{version:3})).status,409,'concurrent undo cannot reopen twice');
      assert.equal(h.scoringSnapshot(),before);
      h.sqlite.exec("CREATE TRIGGER fail_unscored BEFORE UPDATE ON board_posts BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
      const original=console.error;console.error=()=>{};
      try{assert.equal((await h.close('edit-race','unscored',4)).status,503);}finally{console.error=original;}
      assert.equal((await h.get('edit-race')).settledAt,null);assert.equal(h.scoringSnapshot(),before);
    }finally{h.sqlite.close();}
  }
  console.log('PASS: unscored closure/reopen preserves all scores, weekly displays, MVP and graph; locks, auth, modes, retries and concurrent scoring/edit/undo are safe.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runUnscoredSettlementChecks();
