import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import worker from './test-member-worker.mjs';

export async function runWeeklyResultsChecks(){
  const sqlite=new DatabaseSync(':memory:');
  const dir=new URL('./drizzle/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(name,dir),'utf8'));
  const DB={prepare(sql){const s=sqlite.prepare(sql);let p=[];return {
    bind(...v){p=v;return this;},async first(){return s.get(...p)||null;},async all(){return {results:s.all(...p)};},async run(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:s.all(...p)}:{meta:s.run(...p)};}
  };},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={DB,EDITOR_KEY:crypto.randomUUID()},origin='https://weekly.test';
  const call=(path,method='GET',body)=>worker.fetch(new Request(origin+path,{method,headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  async function data(path,method,body){const response=await call(path,method,body),x=await response.json();assert.equal(response.status,200,JSON.stringify(x));return x;}
  const add=async(name,type,points)=>(await data('/api/people','POST',{name,type,points})).data;
  const save=(id,schedule,version=0)=>data('/api/posts/'+id,'PUT',{kind:'schedule',version,operation:crypto.randomUUID(),data:schedule});
  const settle=async id=>{const p=(await data('/api/posts/'+id)).data;return data('/api/posts/'+id+'/settle','POST',{version:p.version,operation:crypto.randomUUID()});};
  const display=async()=>{
    const r=await data('/api/rankings'),g=await data('/api/people');
    assert.equal(r.displaySettlementId,g.displaySettlementId);
    const fields=x=>({id:x.member_id||x.id,points:x.points,rank:x.rank,previous_rank:x.previous_rank,previous_points:x.previous_points,attendance:x.attendance,wins:x.wins,losses:x.losses,rank_movement:x.rank_movement,rank_protected:x.rank_protected});
    return {id:r.displaySettlementId,members:r.items.map(fields),guests:g.people.filter(p=>p.type==='guest').map(fields)};
  };
  const ledger=()=>JSON.stringify({m:sqlite.prepare('SELECT member_id,points,rank,seed,floor_protected_at FROM ranking_members ORDER BY member_id').all(),g:sqlite.prepare('SELECT guest_id,points,floor_protected_at FROM guests ORDER BY guest_id').all(),e:sqlite.prepare('SELECT * FROM ranking_events ORDER BY schedule_id,member_id').all(),ge:sqlite.prepare('SELECT * FROM guest_events ORDER BY schedule_id,guest_id').all()});
  try{
    assert.equal((await display()).id,null);
    const up=await add('주간 상승','member',29),high=await add('주간 상위','member',80),down=await add('주간 하락','member',30),floor=await add('주간 보호','member',20),guest=await add('주간 게스트','guest',20);
    const all=[up,high,down,floor,guest];
    const a={title:'확정 A',names:all.map(p=>p.name),participantIds:all.map(p=>p.id),courts:2,rounds:2,schedule:[0,1].map(()=>({method:'same',g:[[up.name,high.name,down.name,floor.name],[up.name,high.name,down.name,guest.name]]})),results:{'0-0':'a','0-1':'a','1-0':'a','1-1':'a'}};
    await save('weekly-a',a);await settle('weekly-a');
    const first=await display(),firstLedger=ledger();
    assert.equal(first.id,'weekly-a');
    assert.ok(first.members.find(p=>p.id===up.id).rank_movement>0);
    assert.equal(first.members.find(p=>p.id===up.id).wins,4);
    assert.equal(first.members.find(p=>p.id===up.id).points-first.members.find(p=>p.id===up.id).previous_points,5);
    assert.equal(first.members.find(p=>p.id===floor.id).rank_protected,1);
    assert.equal(first.guests.find(p=>p.id===guest.id).rank_protected,1);
    const draft={...a,title:'테스트용 임시 대진',results:{}};
    await save('weekly-draft',draft);await save('weekly-other-draft',draft);
    assert.deepEqual(await display(),first,'새 대진 생성은 확정 표시를 지우지 않음');
    assert.equal(ledger(),firstLedger,'draft creation must not update scores/order/events');
    await save('weekly-draft',{...draft,results:{'0-0':'b'}},1);
    assert.deepEqual(await display(),first,'editing a draft keeps weekly display');
    const partial=await call('/api/posts/weekly-draft/settle','POST',{version:2,operation:crypto.randomUUID()});
    assert.equal(partial.status,400);
    const stale=await call('/api/posts/weekly-a/settle','POST',{version:1,operation:crypto.randomUUID()});
    assert.equal(stale.status,409,'a different operation from a stale screen must require refresh');
    const applied=sqlite.prepare('SELECT operation FROM ranking_settlements WHERE schedule_id=?').get('weekly-a');
    assert.equal((await call('/api/posts/weekly-a/settle','POST',{version:1,operation:applied.operation})).status,200,'retrying the same applied operation remains idempotent');
    await data('/api/posts/weekly-other-draft','DELETE');
    assert.deepEqual(await display(),first);assert.equal(ledger(),firstLedger);

    // Reproduce the production bug without modifying any points or event records.
    sqlite.exec('UPDATE ranking_members SET attendance=0,wins=0,losses=0,previous_rank=rank,previous_points=points,rank_movement=0,rank_protected=0');
    sqlite.exec('UPDATE guests SET attendance=0,wins=0,losses=0,previous_points=points,rank_protected=0');
    assert.deepEqual(await display(),first,'zeroed legacy caches recover from settlement events');
    assert.equal(ledger(),firstLedger,'read-only recovery never reapplies points');

    await data('/api/people/promote','POST',{ids:[guest.id]});
    let people=(await data('/api/rankings')).items;
    const promoted=people.find(p=>p.name===guest.name);
    assert.equal(promoted.attendance,1);assert.equal(promoted.losses,2);assert.equal(promoted.rank_protected,1);assert.equal(promoted.rank_movement,0);
    for(const old of first.members){const now=people.find(p=>p.member_id===old.id);assert.equal(now.rank_movement,old.rank_movement);}
    const correct=async(id,type,points)=>{
      const row=type==='member'?(await data('/api/rankings')).items.find(p=>p.member_id===id):(await data('/api/people')).people.find(p=>p.id===id);
      return data('/api/people/update','POST',{id,type,name:row.name,points,expectedVersion:row.edit_version,reason:'로컬 수동 수정 검사'});
    };
    const highPoints=people.find(p=>p.member_id===high.id).points;
    await correct(high.id,'member',highPoints+10);
    let corrected=(await display()).members.find(p=>p.id===high.id);
    assert.equal(corrected.previous_points,corrected.points);assert.equal(corrected.rank_movement,0);assert.equal(corrected.wins,4);
    await correct(high.id,'member',highPoints);
    corrected=(await display()).members.find(p=>p.id===high.id);
    assert.equal(corrected.previous_points,corrected.points,'even a correction back to the event score stays intentionally cleared');
    assert.equal(corrected.rank_movement,0);
    await correct(promoted.member_id,'member',21);await correct(promoted.member_id,'member',20);
    assert.equal((await display()).members.find(p=>p.id===promoted.member_id).rank_protected,0,'manual score correction clears protection intentionally');
    await worker.scheduled({},env,{waitUntil(){}});
    const backup=JSON.parse(sqlite.prepare('SELECT data FROM backups ORDER BY created_at DESC LIMIT 1').get().data);
    assert.ok(backup.peopleChanges.some(p=>p.person_id===high.id&&p.action==='update'));
    assert.ok(backup.settlements.some(p=>p.schedule_id==='weekly-a'));
    assert.ok(backup.guestEvents.some(p=>p.guest_id===guest.id));
    const beforeB=await display();
    const bPlayers=[people.find(p=>p.member_id===high.id),...people.filter(p=>![up.id,high.id,down.id,floor.id,promoted.member_id].includes(p.member_id)).slice(0,2)];
    const bNames=[up.name,...bPlayers.map(p=>p.name)],bIds=[up.id,...bPlayers.map(p=>p.member_id)];
    const b={title:'확정 B',names:bNames,participantIds:bIds,courts:1,rounds:1,schedule:[{method:'same',g:[bNames]}],results:{'0-0':'b'}};
    await save('weekly-b',b);assert.deepEqual(await display(),beforeB);
    const wrongVersion=await call('/api/posts/weekly-b/settle','POST',{version:2,operation:crypto.randomUUID()});
    assert.equal(wrongVersion.status,409);assert.deepEqual(await display(),beforeB);
    await settle('weekly-b');
    const second=await display();assert.equal(second.id,'weekly-b');
    const nowUp=second.members.find(p=>p.id===up.id),oldUp=beforeB.members.find(p=>p.id===up.id);
    assert.equal(nowUp.attendance,1);assert.equal(nowUp.wins,0);assert.equal(nowUp.losses,1);assert.equal(nowUp.points,oldUp.points);
    assert.equal(sqlite.prepare('SELECT attendance,wins,losses FROM ranking_members WHERE member_id=?').get(up.id).wins,0,'cached counters replace rather than accumulate');
    for(const id of [down.id,floor.id,promoted.member_id]){
      const row=second.members.find(p=>p.id===id);assert.equal(row.attendance,0);assert.equal(row.wins,0);assert.equal(row.losses,0);assert.equal(row.rank_movement,0);assert.equal(row.rank_protected,0);assert.equal(row.previous_points,row.points);
    }
    assert.ok(second.guests.every(p=>p.attendance===0&&p.wins===0&&p.losses===0&&p.previous_points===p.points));
    const secondLedger=ledger();await settle('weekly-b');assert.equal(ledger(),secondLedger);assert.deepEqual(await display(),second);
    await data('/api/posts/weekly-b/unsettle','POST',{});
    assert.deepEqual(await display(),beforeB,'undo B restores confirmed A display, including promoted guest');
    await data('/api/posts/weekly-a/unsettle','POST',{});
    const empty=await display();assert.equal(empty.id,null);
    assert.ok([...empty.members,...empty.guests].every(p=>p.attendance===0&&p.wins===0&&p.losses===0&&p.previous_points===p.points&&p.rank_protected===0));
    // Pre-floor historical events retain their raw scores; 0011 clamped only current rows.
    sqlite.prepare('INSERT INTO ranking_settlements (schedule_id,settled_at,operation) VALUES (?,?,?)').run('weekly-legacy','2026-09-13T00:00:00.000Z','legacy');
    sqlite.prepare('INSERT INTO ranking_events (schedule_id,member_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,rank_before,rank_after,seed_before,seed_after,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('weekly-legacy',floor.id,1,1,1,1,17,18,61,60,'E-','E-','2026-09-13T00:00:00.000Z');
    const legacyBefore=ledger(),legacy=(await display()).members.find(p=>p.id===floor.id);
    assert.equal(legacy.points,20);assert.equal(legacy.previous_points,20);assert.equal(legacy.rank_protected,1);assert.equal(legacy.rank_movement,0);assert.equal(legacy.attendance,1);
    assert.equal(ledger(),legacyBefore,'legacy protection recovery does not rewrite raw event scores');
    const manualGuest=await add('주간 수동 게스트','guest',32);
    sqlite.prepare('INSERT INTO guest_events (schedule_id,guest_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('weekly-legacy',manualGuest.id,1,1,0,2,30,32,'2026-09-13T00:00:00.000Z');
    assert.equal((await display()).guests.find(p=>p.id===manualGuest.id).previous_points,30);
    await correct(manualGuest.id,'guest',42);await correct(manualGuest.id,'guest',32);
    const guestCorrected=(await display()).guests.find(p=>p.id===manualGuest.id);
    assert.equal(guestCorrected.previous_points,32);assert.equal(guestCorrected.wins,1);assert.equal(guestCorrected.attendance,1);
    console.log('PASS: weekly display survives drafts; legacy reset recovery without point writes; promoted guests; latest-only stats; failed/idempotent settlement and undo restoration.');
  }finally{sqlite.close();}
}
