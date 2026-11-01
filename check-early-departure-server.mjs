import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './test-member-worker.mjs';

function harness(){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL('./drizzle/'+file,import.meta.url),'utf8'));
  const DB={prepare(sql){const statement=sqlite.prepare(sql);let params=[];return {
    bind(...values){params=values;return this;},
    async first(){return statement.get(...params)||null;},
    async all(){return {results:statement.all(...params)};},
    async run(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:statement.all(...params)}:{meta:statement.run(...params)};}
  };},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const env={DB,EDITOR_KEY:crypto.randomUUID()},origin='https://early-departure.test';
  const call=(path,method='GET',body,editor=true)=>worker.fetch(new Request(origin+path,{method,
    headers:{'content-type':'application/json',...(editor?{'x-kokkiri-editor':env.EDITOR_KEY}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  async function data(path,method='GET',body){
    const response=await call(path,method,body),json=await response.json();
    assert.equal(response.status,200,JSON.stringify(json));return json.data||json;
  }
  const scores=()=>JSON.stringify({
    members:sqlite.prepare('SELECT member_id,points,seed,rank,attendance,wins,losses,rank_movement,rank_protected,floor_protected_at FROM ranking_members ORDER BY member_id').all(),
    guests:sqlite.prepare('SELECT guest_id,points,attendance,wins,losses,rank_protected,floor_protected_at FROM guests ORDER BY guest_id').all()
  });
  const history=()=>JSON.stringify(['ranking_settlements','ranking_events','guest_events'].map(table=>
    sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()));
  return {sqlite,call,data,scores,history};
}

export async function runEarlyDepartureServerChecks(){
  const h=harness(),id='early-departure-server',path='/api/posts/'+id;
  try{
    const people=[];
    for(let i=0;i<16;i++)people.push(await h.data('/api/people','POST',{
      name:'조퇴 서버검사 '+i,type:'member',points:60+i
    }));
    const names=people.map(p=>p.name),participantIds=people.map(p=>p.id);
    const groups=[
      [[names[2],names[3],names[4],names[5]],[names[6],names[7],names[8],names[9]],[names[10],names[11],names[12],names[13]]],
      [[names[2],names[3],names[4],names[5]],[names[6],names[7],names[8],names[9]],[names[10],names[11],names[12],names[13]]],
      [[names[2],names[3],names[5],names[6]],[names[7],names[8],names[9],names[10]],[names[11],names[12],names[13],names[14]]],
      [[names[2],names[3],names[5],names[6]],[names[7],names[8],names[9],names[10]],[names[11],names[12],names[13],names[14]]]
    ];
    const payload={title:'조퇴 서버 통합검사',names,participantIds,courts:3,rounds:4,
      lateRounds:{[names[0]]:2},earlyFromRounds:{[names[0]]:3,[names[1]]:1,[names[4]]:3,[names[15]]:0},
      schedule:groups.map((g,ri)=>({round:ri+1,method:'same',g,rest:[]})),
      results:{'0-0':'b','0-1':'b','0-2':'a','1-0':'a','1-1':'b','1-2':'a','2-0':'b','2-1':'a','2-2':'b','3-0':'a','3-1':'b','3-2':'a'}};

    for(const invalid of ['2',-1,5,1.5,null]){
      const response=await h.call(path+'-invalid','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:{...payload,earlyFromRounds:{[names[4]]:invalid}}});
      assert.equal(response.status,400,'invalid earlyFromRounds values must be rejected: '+String(invalid));
    }
    const badEarly=structuredClone(payload);badEarly.schedule[0].g[0][0]=names[1];
    assert.equal((await h.call(path+'-bad-early','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:badEarly})).status,400,'a player departing in round 1 cannot be placed in that round');
    const badLate=structuredClone(payload);badLate.schedule[0].g[0][0]=names[0];
    assert.equal((await h.call(path+'-bad-late','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:badLate})).status,400,'a player arriving after round 1 cannot be placed in that round');

    const saved=await h.data(path,'PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:payload});
    const reloaded=await h.data(path);
    assert.deepEqual(reloaded.earlyFromRounds,{[names[0]]:3,[names[1]]:1,[names[4]]:3},'saved map keeps configured starts and omits zero/no-op entries');
    assert.deepEqual(reloaded.schedule[0].early,[names[1]],'round 1 carries its early departures separately');
    assert.ok(reloaded.schedule[0].late.includes(names[0]));
    assert.ok(reloaded.schedule[2].early.includes(names[0])&&reloaded.schedule[2].early.includes(names[4]));
    assert.ok(!reloaded.schedule[2].late.includes(names[0]),'late and early labels do not overlap after departure');
    assert.equal(saved.version,reloaded.version);

    // A departing player can be substituted while present, then is rejected
    // starting with their configured departure round.
    const sub=await h.data(path+'-substitute','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:payload});
    const before=await h.call(path+'-substitute/substitute','POST',{version:sub.version,round:2,court:2,oldName:names[6],newName:names[4]});
    assert.equal(before.status,200,'early departure does not block a replacement before the departure round');
    const changed=await before.json();
    assert.equal(changed.data.schedule[1].g[1][0],names[4]);
    assert.equal((await h.call(path+'-substitute/substitute','POST',{version:changed.data.version,round:3,court:1,oldName:names[2],newName:names[4]})).status,400,
      'early-departure replacement is rejected from the configured round onward');

    const scorePath=path+'/settle';
    const scoresBefore=h.scores(),historyBefore=h.history();
    const closed=await h.data(scorePath,'POST',{version:reloaded.version,operation:crypto.randomUUID()});
    const partial=people[4],partialRow=()=>h.sqlite.prepare('SELECT points,attendance,wins,losses FROM ranking_members WHERE member_id=?').get(partial.id);
    assert.deepEqual({...partialRow()},{points:partial.points+1,attendance:1,wins:1,losses:1},'participant playing before departure gets one attendance, one win and one loss');
    const neverAvailable=[people[0],people[1]];
    for(const person of neverAvailable){
      const row=h.sqlite.prepare('SELECT points,attendance,wins,losses FROM ranking_members WHERE member_id=?').get(person.id);
      assert.deepEqual({...row},{points:person.points,attendance:0,wins:0,losses:0},person.name+' has no attendance or result points without any available round');
    }
    assert.ok(closed.settledAt);
    const reopened=await h.data(path+'/unsettle','POST',{version:closed.version});
    assert.equal(reopened.settledAt,null);
    assert.equal(h.scores(),scoresBefore,'unsettle restores all scores, ranks, attendance and win/loss totals');
    assert.equal(h.history(),historyBefore,'unsettle removes settlement and event history completely');
    assert.deepEqual(reopened.earlyFromRounds,reloaded.earlyFromRounds,'unsettle preserves the early-departure configuration');

    console.log('PASS: API save/reload and validation, late/early no-attendance overlap, round-1 departure, partial attendance and exact win/loss, full settlement undo, and before/after-departure substitution.');
  }finally{h.sqlite.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runEarlyDepartureServerChecks();
