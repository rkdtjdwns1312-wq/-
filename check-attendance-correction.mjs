import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './dist/server/index.js';
import { orderRankingRows,seedForPoints } from './dist/server/rankings.js';

function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sql.exec(readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'));
  let beforeWrite=null,failWrite=false;
  const DB={prepare(q){const stmt=sql.prepare(q);let args=[];return {bind(...a){args=a;return this;},async first(){return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){return {meta:stmt.run(...args)};},execute(){return /^\s*(SELECT|WITH)/i.test(q)?{results:stmt.all(...args)}:{meta:stmt.run(...args)};}};},async batch(stmts){if(stmts.length&&beforeWrite&&failWrite===false){const isRead=stmts.length===9; if(!isRead){const f=beforeWrite;beforeWrite=null;f();}}sql.exec('BEGIN');try{const out=stmts.map(x=>x.execute());if(failWrite&&stmts.length!==9)throw Error('injected write failure');sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const env={DB,EDITOR_KEY:'attendance-test'},origin='https://attendance.test';
  const call=(method='GET',body,auth=true,requestOrigin=origin)=>worker.fetch(new Request(origin+'/api/attendance-correction',{method,headers:{...(auth?{'x-kokkiri-editor':env.EDITOR_KEY}:{}),origin:requestOrigin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
  const run=async(...args)=>{const r=await call(...args),j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j;};
  const players=sql.prepare('SELECT * FROM ranking_members ORDER BY rank LIMIT 4').all();
  players.forEach((p,i)=>sql.prepare('UPDATE ranking_members SET points=?,seed=?,previous_points=?,floor_protected_at=NULL WHERE member_id=?').run(i===3?20:90-i*5,seedForPoints(i===3?20:90-i*5),i===3?20:90-i*5,p.member_id));
  for(const r of orderRankingRows(sql.prepare('SELECT * FROM ranking_members WHERE hidden=0').all()))sql.prepare('UPDATE ranking_members SET rank=?,previous_rank=? WHERE member_id=?').run(r.rank,r.rank,r.member_id);
  const guest=sql.prepare('SELECT * FROM guests WHERE hidden=0 LIMIT 1').get();sql.prepare('UPDATE guests SET points=65,previous_points=65 WHERE guest_id=?').run(guest.guest_id);
  const ids=players.map(p=>p.member_id);
  function manual(id,points,at){
    const before=sql.prepare('SELECT * FROM ranking_members WHERE member_id=?').get(id);
    sql.prepare('UPDATE ranking_members SET points=?,seed=?,floor_protected_at=NULL WHERE member_id=?').run(points,seedForPoints(points),id);
    for(const r of orderRankingRows(sql.prepare('SELECT * FROM ranking_members WHERE hidden=0').all()))sql.prepare('UPDATE ranking_members SET rank=? WHERE member_id=?').run(r.rank,r.member_id);
    sql.prepare('INSERT INTO people_changes(id,person_type,person_id,action,before_points,after_points,reason,created_at) VALUES (?,?,?,?,?,?,?,?)').run('manual-'+crypto.randomUUID(),'member',id,'update',before.points,points,'manual test',at);
  }
  function legacyClose(id,at,deltas,guestDeltas=[],randomOnly=true){
    const before=sql.prepare('SELECT * FROM ranking_members WHERE hidden=0 ORDER BY rank').all();
    const map=new Map(deltas.map(x=>[x.id,x]));
    const rows=orderRankingRows(before.map(r=>{const d=map.get(r.member_id)||{a:0,w:0,l:0},raw=r.points+d.a+d.w-d.l,p=Math.max(20,raw);return {...r,points:p,attendance:d.a,wins:d.w,losses:d.l,floor_protected_at:p>20?null:d.w+d.l>0&&raw<=20?at:r.floor_protected_at};}));
    const names=randomOnly?[...players.map(p=>p.name),guest.name]:before.slice(0,20).map(p=>p.name);
    const payload={title:id,names,rounds:1,schedule:[{round:1,method:randomOnly?'random':'same',g:[names.slice(0,4)]}],settledAt:at,results:randomOnly?{}:{'0-0':'a'}};
    sql.prepare('INSERT INTO board_posts(id,kind,payload,version,last_operation,created_at,updated_at) VALUES (?,?,?,2,?,?,?)').run(id,'schedule',JSON.stringify(payload),'settle-'+id,at,at);
    sql.prepare('INSERT INTO ranking_settlements(schedule_id,settled_at,operation,rank_order_before) VALUES (?,?,?,?)').run(id,at,id,JSON.stringify(before.map(r=>r.member_id)));
    for(const r of rows){const b=before.find(b=>b.member_id===r.member_id);sql.prepare('UPDATE ranking_members SET points=?,seed=?,rank=?,previous_rank=?,previous_points=?,attendance=?,wins=?,losses=?,floor_protected_at=? WHERE member_id=?').run(r.points,r.seed,r.rank,b.rank,b.points,r.attendance,r.wins,r.losses,r.floor_protected_at,r.member_id);const d=map.get(r.member_id);if(!d)continue;sql.prepare('INSERT INTO ranking_events(schedule_id,member_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,rank_before,rank_after,seed_before,seed_after,created_at,floor_protected_before) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,r.member_id,d.a,d.w,d.l,r.points-b.points,b.points,r.points,b.rank,r.rank,b.seed,r.seed,at,b.floor_protected_at);}
    for(const d of guestDeltas){const b=sql.prepare('SELECT * FROM guests WHERE guest_id=?').get(d.id),p=Math.max(20,b.points+d.a+d.w-d.l);sql.prepare('UPDATE guests SET points=?,previous_points=?,attendance=?,wins=?,losses=? WHERE guest_id=?').run(p,b.points,d.a,d.w,d.l,d.id);sql.prepare('INSERT INTO guest_events(schedule_id,guest_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,created_at,floor_protected_before) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,d.id,d.a,d.w,d.l,p-b.points,b.points,p,at,b.floor_protected_at);}
  }
  const snapshot=()=>JSON.stringify(['ranking_members','guests','ranking_events','guest_events','ranking_settlements','people_changes','score_point_history','backups','roster_write_revision','board_posts'].map(t=>sql.prepare('SELECT * FROM '+t).all()));
  return {sql,call,run,ids,guest,legacyClose,manual,snapshot,env,set beforeWrite(fn){beforeWrite=fn;},set failWrite(value){failWrite=value;}};
}

export async function runAttendanceCorrectionChecks(){
  // Independent oracle: a clean history that never awarded the invalid credits.
  const actual=fixture(),expected=fixture();
  try{
    for(const [f,a] of [[actual,1],[expected,0]]){
      f.legacyClose('bad-one','2026-09-21T01:00:00.000Z',f.ids.map(id=>({id,a,w:0,l:0})),[{id:f.guest.guest_id,a,w:0,l:0}]);
      f.legacyClose('bad-two','2026-09-21T02:00:00.000Z',f.ids.slice(0,2).map(id=>({id,a,w:0,l:0})));
      f.legacyClose('good','2026-09-22T01:00:00.000Z',f.ids.map((id,i)=>({id,a:1,w:i===3?0:2,l:i===3?3:0})),[{id:f.guest.guest_id,a:1,w:1,l:0}],false);
    }
    const p=await actual.run();await actual.run('POST',{fingerprint:p.fingerprint});
    for(const query of [
      'SELECT member_id,points,seed,rank,floor_protected_at FROM ranking_members ORDER BY member_id',
      'SELECT guest_id,points FROM guests ORDER BY guest_id',
      'SELECT schedule_id,member_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,rank_before,rank_after,seed_before,seed_after,floor_protected_before FROM ranking_events ORDER BY schedule_id,member_id',
      'SELECT schedule_id,guest_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,floor_protected_before FROM guest_events ORDER BY schedule_id,guest_id',
      'SELECT schedule_id,rank_order_before FROM ranking_settlements ORDER BY schedule_id'
    ])assert.deepEqual(actual.sql.prepare(query).all(),expected.sql.prepare(query).all(),'corrected history equals a clean replay: '+query);
  }finally{actual.sql.close();expected.sql.close();}
  for(const scenario of ['manual-tie','manual-floor']){
    const real=fixture(),clean=fixture();try{
      for(const [f,a] of [[real,1],[clean,0]]){
        if(scenario==='manual-floor'){f.manual(f.ids[0],20,'2026-09-20T01:00:00.000Z');f.manual(f.ids[1],20,'2026-09-20T02:00:00.000Z');}
        f.legacyClose('bad','2026-09-21T01:00:00.000Z',[{id:f.ids[2],a,w:0,l:0}]);
        if(scenario==='manual-tie'){
          f.manual(f.ids[0],84,'2026-09-21T02:00:00.000Z');f.manual(f.ids[0],85,'2026-09-21T03:00:00.000Z');
          f.legacyClose('good','2026-09-22T01:00:00.000Z',f.ids.slice(0,2).map(id=>({id,a:1,w:1,l:2})),[],false);
        }else{
          f.legacyClose('good','2026-09-22T01:00:00.000Z',[{id:f.ids[0],a:1,w:0,l:2}],[],false);
          f.manual(f.ids[0],25,'2026-09-22T02:00:00.000Z');
        }
      }
      const p=await real.run();await real.run('POST',{fingerprint:p.fingerprint});
      for(const q of ['SELECT member_id,points,rank,floor_protected_at FROM ranking_members ORDER BY member_id','SELECT schedule_id,member_id,rank_before,rank_after FROM ranking_events ORDER BY schedule_id,member_id','SELECT schedule_id,rank_order_before FROM ranking_settlements ORDER BY schedule_id'])assert.deepEqual(real.sql.prepare(q).all(),clean.sql.prepare(q).all(),scenario+' must equal clean history: '+q);
    }finally{real.sql.close();clean.sql.close();}
  }
  const h=fixture();
  try{
    h.legacyClose('bad','2026-09-21T01:00:00.000Z',h.ids.map(id=>({id,a:1,w:0,l:0})),[{id:h.guest.guest_id,a:1,w:0,l:0}]);
    const manualId=h.ids[2],old=h.sql.prepare('SELECT * FROM ranking_members WHERE member_id=?').get(manualId);
    h.sql.prepare('UPDATE ranking_members SET points=77 WHERE member_id=?').run(manualId);
    h.sql.prepare('INSERT INTO people_changes(id,person_type,person_id,action,before_points,after_points,reason,created_at) VALUES (?,?,?,?,?,?,?,?)').run('manual-test','member',manualId,'update',old.points,77,'manual','2026-09-21T02:00:00.000Z');
    h.legacyClose('good','2026-09-22T01:00:00.000Z',h.ids.map((id,i)=>({id,a:1,w:i===3?0:2,l:i===3?3:0})),[{id:h.guest.guest_id,a:1,w:1,l:0}],false);
    const before=h.snapshot(),postBefore=JSON.stringify(h.sql.prepare('SELECT * FROM board_posts').all());
    const ledgerBefore=h.sql.prepare('SELECT * FROM score_point_history').all();
    assert.equal((await h.call('GET',null,false)).status,403);
    let plan=await h.run();assert.equal(h.snapshot(),before,'preview is read-only');
    assert.equal(plan.candidates.length,1);assert.equal(plan.credits,5);assert.equal(plan.pointsRemoved,3);
    assert.equal(plan.people.find(p=>p.id===manualId).pointsRemoved,0,'later absolute manual score is preserved');
    assert.equal(plan.people.find(p=>p.id===h.ids[3]).pointsRemoved,0,'later floor absorbs the erroneous credit');
    assert.equal((await h.call('POST',{fingerprint:plan.fingerprint},true,'https://evil.test')).status,403);
    assert.equal((await h.call('POST',{fingerprint:'0'.repeat(64)})).status,409);
    const fixed=await h.run('POST',{fingerprint:plan.fingerprint});assert.equal(fixed.applied,true);assert.equal(fixed.pointsRemoved,3);
    assert.ok(h.sql.prepare('SELECT data FROM backups WHERE id=?').get(fixed.backupId));
    assert.equal(JSON.stringify(h.sql.prepare('SELECT * FROM board_posts').all()),postBefore,'do not reopen or edit schedules');
    assert.deepEqual(h.sql.prepare('SELECT * FROM score_point_history ORDER BY id LIMIT ?').all(ledgerBefore.length),ledgerBefore,'original observed ledger retained');
    assert.equal(h.sql.prepare("SELECT SUM(attendance_points) n FROM ranking_events WHERE schedule_id='bad'").get().n,0);
    assert.equal(h.sql.prepare("SELECT SUM(attendance_points) n FROM ranking_events WHERE schedule_id='good'").get().n,4,'eligible later attendance kept');
    assert.equal(h.sql.prepare("SELECT SUM(win_points) w,SUM(loss_points) l FROM ranking_events WHERE schedule_id='good'").get().w,6);
    assert.equal(h.sql.prepare('SELECT points FROM ranking_members WHERE member_id=?').get(h.ids[3]).points,20);
    const second=await h.run();assert.equal(second.candidates.length,0);const once=h.snapshot();await h.run('POST',{fingerprint:second.fingerprint});assert.equal(h.snapshot(),once,'retry cannot debit twice');
    const current=h.sql.prepare('SELECT points FROM ranking_members WHERE member_id=?').get(h.ids[0]).points;
    const undo=await worker.fetch(new Request('https://attendance.test/api/posts/good/unsettle',{method:'POST',headers:{origin:'https://attendance.test','content-type':'application/json','x-kokkiri-editor':'attendance-test'},body:JSON.stringify({version:2})}),h.env);
    assert.equal(undo.status,200);assert.equal(h.sql.prepare('SELECT points FROM ranking_members WHERE member_id=?').get(h.ids[0]).points,current-3,'latest undo uses corrected delta, not double correction');
  }finally{h.sql.close();}
  for(const scenario of ['gap','failure','race','promoted','small-scored']){
    const f=fixture();try{
      f.legacyClose('bad','2026-09-21T01:00:00.000Z',f.ids.map(id=>({id,a:1,w:scenario==='small-scored'?1:0,l:0})),[{id:f.guest.guest_id,a:1,w:0,l:0}]);
      if(scenario==='small-scored'){
        const row=f.sql.prepare("SELECT payload FROM board_posts WHERE id='bad'").get(),p=JSON.parse(row.payload);p.schedule[0].method='same';f.sql.prepare("UPDATE board_posts SET payload=? WHERE id='bad'").run(JSON.stringify(p));
      }
      if(scenario==='gap'){f.sql.prepare('UPDATE ranking_members SET points=points+2 WHERE member_id=?').run(f.ids[0]);assert.equal((await f.call()).status,409);continue;}
      if(scenario==='promoted'){
        const g=f.sql.prepare('SELECT * FROM guests WHERE guest_id=?').get(f.guest.guest_id);
        f.sql.prepare('INSERT INTO ranking_members(member_id,name,points,seed,rank,previous_rank,previous_points,updated_at,promoted_guest_id) VALUES (?,?,?,?,999,999,?,?,?)').run('promoted-test','promoted test',g.points,seedForPoints(g.points),g.points,'2026-09-21T02:00:00.000Z',g.guest_id);f.sql.prepare('UPDATE guests SET hidden=1 WHERE guest_id=?').run(g.guest_id);
      }
      const p=await f.run(),before=f.snapshot();
      if(scenario==='failure'){f.failWrite=true;const error=console.error;let response;try{console.error=()=>{};response=await f.call('POST',{fingerprint:p.fingerprint});}finally{console.error=error;}assert.equal(response.status,503);assert.equal(f.snapshot(),before,'failed transaction rolls back backup and all rows');}
      else if(scenario==='race'){f.beforeWrite=()=>f.sql.exec('UPDATE roster_write_revision SET revision=revision+1');assert.equal((await f.call('POST',{fingerprint:p.fingerprint})).status,409);assert.equal(f.sql.prepare('SELECT count(*) n FROM backups').get().n,0);}
      else{const applied=await f.run('POST',{fingerprint:p.fingerprint});assert.equal(applied.pointsRemoved,5);if(scenario==='promoted'){assert.equal(f.sql.prepare("SELECT points FROM ranking_members WHERE member_id='promoted-test'").get().points,65);assert.equal(f.sql.prepare('SELECT points FROM guests WHERE guest_id=?').get(f.guest.guest_id).points,66,'do not debit a promoted guest twice');}else{assert.equal(f.sql.prepare("SELECT win_points FROM ranking_events WHERE schedule_id='bad' LIMIT 1").get().win_points,1);}}
    }finally{f.sql.close();}
  }
  console.log('PASS: attendance correction preview/backup, floor absorption, manual edits, promotion, legacy small scored games, preserved wins, corrected undo, idempotency, auth, failure and race guards.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runAttendanceCorrectionChecks();
