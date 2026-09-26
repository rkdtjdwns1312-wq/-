import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './test-member-worker.mjs';
import { attendancePolicy } from './dist/server/attendance-policy.js';

function pureChecks(){
  for(const count of [15,16])for(const methods of [['random','random'],['same','random'],['random','balanced'],['same'],['balanced']]){
    const names=Array.from({length:count},(_,i)=>'참가 '+i);
    const post=Object.freeze({names:Object.freeze(names),schedule:Object.freeze(methods.map(method=>Object.freeze({method}))),absent:[names[0]],lateRounds:{[names[1]]:2}});
    const before=JSON.stringify(post),randomOnly=methods.every(m=>m==='random');
    assert.deepEqual(attendancePolicy(post),{eligible:count>15&&!randomOnly,participantCount:count,randomOnly,reasons:[...(randomOnly?['random-only']:[]),...(count<=15?['participants-at-most-15']:[])]});
    assert.equal(JSON.stringify(post),before,'policy must not mutate the post');
    assert.deepEqual(attendancePolicy({...post,names:[...names,...names]}),attendancePolicy(post),'duplicate configured names do not inflate attendance eligibility');
  }
  assert.deepEqual(attendancePolicy(),{eligible:false,participantCount:0,randomOnly:false,reasons:['participants-at-most-15']});
  assert.equal(attendancePolicy({names:['one'],schedule:[]}).randomOnly,false,'empty schedule is not an all-random meeting');
  assert.equal(attendancePolicy({names:Array.from({length:16},(_,i)=>String(i)),schedule:[{}]}).eligible,true,'legacy missing method remains scored, as in settlement');
}

function harness(){
  const sqlite=new DatabaseSync(':memory:');
  const dir=new URL('./drizzle/',import.meta.url);
  for(const file of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(file,dir),'utf8'));
  const DB={prepare(sql){const s=sqlite.prepare(sql);let args=[];return {
    bind(...values){args=values;return this;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},
    async run(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:s.all(...args)}:{meta:s.run(...args)};}
  };},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const env={DB,EDITOR_KEY:crypto.randomUUID()};
  async function data(path,method='GET',body){
    const response=await worker.fetch(new Request('https://attendance.test'+path,{method,headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result.data||result;
  }
  const scores=()=>JSON.stringify({members:sqlite.prepare('SELECT member_id,points,seed,rank,floor_protected_at FROM ranking_members ORDER BY member_id').all(),guests:sqlite.prepare('SELECT guest_id,points,floor_protected_at FROM guests ORDER BY guest_id').all()});
  const ledger=()=>JSON.stringify(['ranking_members','guests','ranking_settlements','ranking_events','guest_events','score_point_history','roster_write_revision'].map(table=>sqlite.prepare('SELECT * FROM '+table).all()));
  return {sqlite,data,scores,ledger};
}

async function settlementChecks(count,randomOnly,unscored){
  const h=harness();
  try{
    const players=[];
    for(let i=0;i<count;i++)players.push(await h.data('/api/people','POST',{name:'출석 검사 '+i,type:[1,3,5,9,11,15].includes(i)?'guest':'member',points:[2,3].includes(i)?20:i===6?21:50}));
    const names=players.map(p=>p.name),id='attendance-policy-test';
    const post={title:'출석 정책 검사',names,participantIds:players.map(p=>p.id),rounds:2,courts:3,
      absent:[names[8],names[9]],lateRounds:{[names[10]]:2,[names[11]]:2},
      schedule:[{method:randomOnly?'random':'same',g:[names.slice(0,4),names.slice(4,8),[names[8],names[9],names[12],names[13]]]},{method:'random',g:[[names[0],names[1],names[13],names[14]]]}],
      results:unscored?{}:{'0-0':'a','0-1':'a','0-2':'a','1-0':'b'}};
    assert.equal(attendancePolicy(post).participantCount,count,'guests, absent and all-round late people count in the configured roster');
    assert.ok(players.filter(p=>p.type==='member').length<=15,'16-person eligibility requires including guests');
    const saved=await h.data('/api/posts/'+id,'PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:post});
    const before=h.scores(),ledgerBefore=h.ledger(),operation=crypto.randomUUID();
    const closed=await h.data('/api/posts/'+id+'/settle','POST',{version:saved.version,operation,mode:unscored?'unscored':'scored'});
    assert.ok(closed.settledAt);
    if(unscored){
      assert.equal(h.ledger(),ledgerBefore,'unscored close writes zero attendance, points, events or roster revisions even with an eligible 16-person roster');
      assert.deepEqual(closed.mvp,[]);
    }else{
      const eligible=count>15&&!randomOnly;
      const expectedMvp=randomOnly?[]:[players[0].name,players[4].name];
      assert.deepEqual([...closed.mvp].sort(),expectedMvp.sort(),'attendance eligibility never changes member-only MVP');
      for(const [i,p] of players.entries()){
        const guest=p.type==='guest',table=guest?'guests':'ranking_members',key=guest?'guest_id':'member_id';
        const row=h.sqlite.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(p.id);
        const attendance=Number(eligible&&![8,9,10,11].includes(i));
        const wins=Number(!randomOnly&&[0,1,4,5].includes(i)),losses=Number(!randomOnly&&[2,3,6,7].includes(i));
        const points=Math.max(20,p.points+attendance+wins-losses);
        assert.equal(row.attendance,attendance,p.name+' attendance');assert.equal(row.wins,wins,p.name+' wins');assert.equal(row.losses,losses,p.name+' losses');
        assert.equal(row.points,points,p.name+' points');
        assert.equal(row.rank_protected,Number(wins+losses>0&&p.points+attendance+wins-losses<=20),p.name+' floor protection');
        const event=h.sqlite.prepare(`SELECT * FROM ${guest?'guest_events':'ranking_events'} WHERE schedule_id=? AND ${key}=?`).get(id,p.id);
        if(attendance+wins+losses===0)assert.equal(event,undefined,'no zero-only event for excluded or idle participant');
        else{
          assert.ok(event);assert.equal(event.attendance_points,attendance);assert.equal(event.win_points,wins);assert.equal(event.loss_points,losses);
          assert.equal(event.total_points,points-p.points,'ledger records actual floor-clamped change');assert.equal(event.points_before,p.points);assert.equal(event.points_after,points);
        }
      }
      const once=h.ledger();await h.data('/api/posts/'+id+'/settle','POST',{version:saved.version,operation,mode:'scored'});assert.equal(h.ledger(),once,'exact retry never adds attendance twice');
    }
    const reopened=await h.data('/api/posts/'+id+'/unsettle','POST',{version:closed.version});
    assert.equal(reopened.settledAt,null);assert.deepEqual(reopened.mvp,[]);assert.equal(h.scores(),before,'undo restores every score, seed, rank and floor marker');
    if(unscored)assert.equal(h.ledger(),ledgerBefore,'unscored reopening also changes no score data');
    for(const table of ['ranking_events','guest_events','ranking_settlements'])assert.equal(h.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  }finally{h.sqlite.close();}
}

export async function runAttendancePolicyChecks(){
  pureChecks();
  for(const count of [15,16])for(const randomOnly of [false,true])for(const unscored of [false,true])await settlementChecks(count,randomOnly,unscored);
  console.log('PASS: attendance 15/16 unique-name boundaries, all-random/mixed rounds, guests, configured absences/late/rest, wins/losses/MVP, 20-point floor, exact retry/undo and unscored zero writes.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runAttendancePolicyChecks();
