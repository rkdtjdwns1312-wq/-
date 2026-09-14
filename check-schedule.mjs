import assert from 'node:assert/strict';
import { createScheduleTools } from './dist/server/schedule-tools.js';

export async function runScheduleChecks({worker,env,origin}){
  // Recreate the serialized factory too: browser code cannot rely on module scope.
  const t=(new Function('return ('+createScheduleTools.toString()+')'))()();
  const players=n=>Array.from({length:n},(_,i)=>({id:'p'+i,name:String(i+1),points:160-i*5,type:'member',operator:false,lateRounds:0,lateRegistration:false}));
  const p=players(8);
  assert.deepEqual(t.generate(p,2,1,['same'])[0].g,[['1','4','2','3'],['5','8','6','7']]);
  assert.deepEqual(t.generate(p,2,1,['balanced'])[0].g,[['1','6','2','5'],['3','8','4','7']]);
  assert.deepEqual(t.generate(players(12),3,1,['balanced'])[0].g[2],['9','12','10','11']);
  const roles=players(9);roles[0].lateRegistration=true;roles[1].type='guest';roles[2].operator=true;
  const rests=t.generate(roles,2,5,Array(5).fill('same')).map(r=>r.rest);
  assert.deepEqual(rests.slice(0,3),[['1'],['2'],['3']]);
  assert.equal(new Set(rests.flat()).size,5);
  const repeated=players(10);repeated[0].lateRegistration=true;repeated[1].type='guest';repeated[2].operator=true;
  const long=t.generate(repeated,1,5,Array(5).fill('random'));
  const counts=repeated.map(p=>long.filter(r=>r.rest.includes(p.name)).length);
  assert.deepEqual(counts.slice(0,3),[1,1,1]);
  assert.ok(Math.max(...counts.slice(3))-Math.min(...counts.slice(3))<=1);
  const late=players(9);late[0].lateRounds=2;late[0].lateRegistration=true;
  const arrivals=t.generate(late,2,5,Array(5).fill('balanced'));
  for(const r of arrivals.slice(0,2)){assert.deepEqual(r.late,['1']);assert.ok(!r.g.flat().includes('1'));assert.ok(!r.rest.includes('1'));}
  assert.deepEqual(arrivals[2].rest,['1']);assert.ok(arrivals[3].g.flat().includes('1'));assert.ok(arrivals[4].g.flat().includes('1'));
  assert.equal(t.generate(players(4).map(p=>({...p,lateRounds:2})),1,3,['same','balanced','random'])[0].g.length,0);
  const onlyPriority=players(5).map(p=>({...p,type:'guest'}));
  assert.throws(()=>t.generate(onlyPriority,1,6,Array(6).fill('same')),/휴식 1회 제한/);
  for(const n of [8,9,13,28,33])for(let trial=0;trial<12;trial++){
    const roster=players(n);roster[0].lateRounds=2;roster[1].type='guest';roster[2].operator=true;roster[3].lateRegistration=true;
    const rounds=t.generate(roster,Math.max(1,Math.floor(n/4)-1),5,['same','balanced','random','same','balanced']);
    for(const r of rounds){
      const playing=r.g.flat();assert.equal(new Set(playing).size,playing.length);
      assert.equal(new Set([...playing,...r.rest,...r.late]).size,n);
      assert.equal(playing.length+r.rest.length+r.late.length,n);
      assert.ok(r.g.every(g=>g.length===4));
      for(const match of r.g){if(r.method==='random')continue;
        const points=match.map(name=>roster.find(p=>p.name===name).points),sorted=[...points].sort((a,b)=>b-a);
        const best=Math.min(Math.abs(sorted[0]+sorted[3]-sorted[1]-sorted[2]),Math.abs(sorted[0]+sorted[2]-sorted[1]-sorted[3]));
        assert.equal(Math.abs(points[0]+points[1]-points[2]-points[3]),best);
      }
    }
    for(const special of roster.slice(1,4))assert.ok(rounds.filter(r=>r.rest.includes(special.name)).length<=1);
  }
  const edit={names:players(9).map(p=>p.name),lateRounds:{'9':1},schedule:[{g:[['1','2','3','4'],['5','6','7','8']],rest:[]}],results:{'0-0':'a','0-1':'b'}};
  t.replacePlayer(edit,0,0,0,'5');
  assert.deepEqual(edit.schedule[0].g,[['5','2','3','4'],['5','6','7','8']]);
  assert.deepEqual(edit.schedule[0].rest,['1']);assert.deepEqual(edit.schedule[0].late,['9']);
  assert.deepEqual(edit.results,{'0-1':'b'});
  assert.throws(()=>t.replacePlayer(edit,0,0,0,'2'),/같은 경기/);
  assert.throws(()=>t.replacePlayer(edit,0,0,0,'9'),/아직 도착/);

  const call=(path,method='GET',body)=>worker.fetch(new Request(origin+path,{method,headers:{'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},...(body?{body:JSON.stringify(body)}:{})}),env);
  const members=(await (await call('/api/rankings')).json()).items.slice(0,13);
  const roster=members.map((m,i)=>({id:m.member_id,name:m.name,points:150-i*7,type:'member',lateRounds:i===0?2:0,lateRegistration:i===0}));
  const data={kind:'schedule',title:'늦참·대진 편집 검증',names:roster.map(p=>p.name),participantIds:roster.map(p=>p.id),courts:3,rounds:5,lateRounds:{[roster[0].name]:2},lateRegistration:[roster[0].name],schedule:t.generate(roster,3,5,['same','balanced','random','same','balanced']),results:{}};
  const put=d=>call('/api/posts/schedule-ui-test','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:d});
  assert.equal((await put({...data,lateRounds:{[roster[0].name]:1.5}})).status,400);
  const bad=structuredClone(data);bad.schedule[0].g[0][0]=roster[0].name;
  assert.equal((await put(bad)).status,400);
  const empty=structuredClone(data);empty.schedule[0].g=[];
  assert.equal((await put(empty)).status,400);
  assert.equal((await put(data)).status,200);
  const saved=(await (await call('/api/posts/schedule-ui-test')).json()).data;
  assert.deepEqual(saved.lateRounds,data.lateRounds);assert.deepEqual(saved.lateRegistration,data.lateRegistration);
  assert.deepEqual(saved.schedule.map(r=>r.method),['same','balanced','random','same','balanced']);
  assert.ok(saved.schedule.slice(0,2).every(r=>r.late.includes(roster[0].name)&&!r.rest.includes(roster[0].name)));
  const edited=structuredClone(saved),other=[...edited.schedule[0].g[1]];
  t.replacePlayer(edited,0,0,0,other[0]);
  assert.equal((await call('/api/posts/schedule-ui-test','PUT',{kind:'schedule',version:edited.version,operation:crypto.randomUUID(),data:edited})).status,200);
  const reloaded=(await (await call('/api/posts/schedule-ui-test')).json()).data;
  assert.deepEqual(reloaded.schedule[0].g[1],other);assert.equal(reloaded.schedule[0].g[0][0],other[0]);
  // All-round late participants receive neither attendance nor match points.
  const names=roster.slice(0,5).map(p=>p.name),alwaysLate=names[0];
  const noArrival={kind:'schedule',title:'늦참 출석 검사',names,participantIds:roster.slice(0,5).map(p=>p.id),courts:1,rounds:1,lateRounds:{[alwaysLate]:1},schedule:[{g:[names.slice(1)],method:'same'}],results:{'0-0':'a'}};
  assert.equal((await call('/api/posts/late-attendance-test','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:noArrival})).status,200);
  assert.equal((await call('/api/posts/late-attendance-test/settle','POST',{version:1,operation:crypto.randomUUID()})).status,200);
  const scored=(await (await call('/api/rankings')).json()).items;
  assert.equal(scored.find(p=>p.name===alwaysLate).attendance,0);
  assert.equal(scored.find(p=>p.name===names[1]).attendance,1);
  const noGames={...noArrival,rounds:2,names:names.slice(0,4),participantIds:roster.slice(0,4).map(p=>p.id),lateRounds:Object.fromEntries(names.slice(0,4).map(n=>[n,1])),schedule:[{g:[],method:'same'},{g:[names.slice(0,4)],method:'balanced'}],results:{}};
  assert.equal((await call('/api/posts/late-empty-test','PUT',{kind:'schedule',version:0,operation:crypto.randomUUID(),data:noGames})).status,200);
  console.log('PASS: late arrival persistence/exclusion, rest priority and limits, balanced teams, single-slot edits, duplicate games and late attendance.');
}
