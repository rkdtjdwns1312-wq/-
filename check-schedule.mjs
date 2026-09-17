import assert from 'node:assert/strict';
import { createScheduleTools } from './dist/server/schedule-tools.js';

export async function runScheduleChecks({worker,env,origin}){
  // Recreate the serialized factory too: browser code cannot rely on module scope.
  const t=(new Function('return ('+createScheduleTools.toString()+')'))()();
  const players=n=>Array.from({length:n},(_,i)=>({id:'p'+i,name:String(i+1),points:160-i*5,type:'member',operator:false,lateRounds:0,lateRegistration:false}));
  const allSplitGaps=points=>[
    Math.abs(points[0]+points[1]-points[2]-points[3]),
    Math.abs(points[0]+points[2]-points[1]-points[3]),
    Math.abs(points[0]+points[3]-points[1]-points[2])
  ];
  const assertOptimalTeams=(rounds,roster)=>{const byName=new Map(roster.map(p=>[p.name,p]));
    for(const round of rounds)if(round.method!=='random')for(const match of round.g){
      const points=match.map(name=>Number(byName.get(name).points));
      assert.equal(Math.abs(points[0]+points[1]-points[2]-points[3]),Math.min(...allSplitGaps(points)));
    }
  };
  const objective=(rounds,roster)=>{
    const counts=new Map(),byName=new Map(roster.map(p=>[p.name,Number(p.points)]));let gap=0;
    for(const r of rounds)if(r.method!=='random')for(const g of r.g){
      for(const team of [g.slice(0,2),g.slice(2)]){const key=JSON.stringify([...team].sort());counts.set(key,(counts.get(key)||0)+1);}
      gap+=Math.abs(byName.get(g[0])+byName.get(g[1])-byName.get(g[2])-byName.get(g[3]));
    }
    return [[...counts.values()].reduce((a,n)=>a+Math.max(0,n-1),0),[...counts.values()].reduce((a,n)=>a+n*(n-1)/2,0),gap];
  };
  const less=(a,b)=>a[0]<b[0]||a[0]===b[0]&&(a[1]<b[1]||a[1]===b[1]&&a[2]<b[2]);
  // Balance is now secondary to partner uniqueness across the entire draft.
  const assertNoBetterSingleSplit=(rounds,roster)=>{
    const baseline=objective(rounds,roster);
    for(const r of rounds)if(r.method!=='random')for(let mi=0;mi<r.g.length;mi++){
      const original=r.g[mi];
      for(const indices of [[0,2,1,3],[0,3,1,2]]){
        r.g[mi]=indices.map(i=>original[i]);
        assert.ok(!less(objective(rounds,roster),baseline),'a single team change cannot improve repeats, then balance');
      }
      r.g[mi]=original;
    }
  };
  const p=players(8);
  assert.deepEqual(t.generate(p,2,1,['same'])[0].g,[['1','4','2','3'],['5','8','6','7']]);
  assert.deepEqual(t.generate(p,2,1,['balanced'])[0].g,[['1','6','2','5'],['3','8','4','7']]);
  assert.deepEqual(t.generate(players(12),3,1,['balanced'])[0].g[2],['9','12','10','11']);
  const quartet=[
    {id:'jubam',name:'주밤',points:'116'},
    {id:'asics',name:'아식스',points:'110'},
    {id:'dujin',name:'두진',points:'97'},
    {id:'sio',name:'시오',points:'104'}
  ];
  const permutations=(items)=>items.length<2?[items]:items.flatMap((item,i)=>permutations(items.filter((_,j)=>j!==i)).map(rest=>[item,...rest]));
  for(const roster of permutations(quartet))for(const method of ['same','balanced']){
    const made=t.generate(roster,1,1,[method]);
    assert.deepEqual(made[0].g,[['주밤','두진','아식스','시오']]);
    assertOptimalTeams(made,roster);
  }
  for(const values of [[168,143,109,22],[116,110,110,97],[105,105,105,105]])for(const method of ['same','balanced']){
    const roster=values.map((points,i)=>({id:'irregular-'+i,name:'불규칙'+i,points}));
    assertOptimalTeams(t.generate(roster,1,1,[method]),roster);
  }
  const addedCourt=[
    {id:'ddugi',name:'뚜기',points:121},{id:'jubam',name:'주밤',points:116},
    {id:'roto',name:'로토',points:109},{id:'solchan',name:'솔찬',points:71}
  ];
  assert.deepEqual(t.balanceFour(addedCourt,'same').map(p=>p.name),['뚜기','솔찬','주밤','로토']);
  const addedCourt2=[
    {id:'sio',name:'시오',points:104},{id:'gureum',name:'구름',points:90},
    {id:'hooni',name:'후니',points:73},{id:'aman',name:'아만',points:70}
  ];
  assert.deepEqual(t.balanceFour(addedCourt2,'balanced').map(p=>p.name),['시오','아만','구름','후니']);
  const tied=addedCourt.map((p,i)=>({...p,id:'tied-'+i,name:'동점'+i,points:'100'}));
  assert.deepEqual(t.balanceFour(tied,'same',[tied]).map(p=>p.name),['동점0','동점2','동점1','동점3']);
  assert.deepEqual(t.balanceFour(addedCourt,'random').map(p=>p.name),addedCourt.map(p=>p.name));
  assert.throws(()=>t.balanceFour(addedCourt.slice(0,3),'same'),/4명 대진/);
  assert.throws(()=>t.balanceFour(addedCourt,'other'),/라운드 방식/);
  assert.throws(()=>t.balanceFour(addedCourt,'same',[addedCourt.slice(0,3)]),/이전 대진/);
  const quartetRounds=t.generate(players(4),1,3,['same','balanced','same']);
  assert.equal(t.partnerSummary(quartetRounds).duplicateTeams,0,'same and adjacent share a single partner history');
  assert.equal(new Set(quartetRounds.flatMap(r=>r.g.flatMap(g=>[g.slice(0,2),g.slice(2)].map(team=>JSON.stringify([...team].sort()))))).size,6);
  assert.equal(t.partnerSummary(t.generate(players(4),1,4,Array(4).fill('same'))).duplicateTeams,2,'four players in four rounds must repeat two teams');
  const cross=t.generate(players(8),2,7,Array(7).fill('same'));
  assert.equal(t.partnerSummary(cross).duplicateTeams,0,'cross-court search finds all seven different partners for eight players');
  assert.ok(cross.some(r=>r.g.some(g=>g.some(n=>Number(n)<=4)&&g.some(n=>Number(n)>4))),'cross-court exchange is actually exercised');
  for(const r of cross)assert.deepEqual([...r.g.flat()].sort(),players(8).map(p=>p.name).sort());
  assert.equal(t.partnerSummary(t.generate(players(8),2,8,Array(8).fill('same'))).duplicateTeams,4,'unavoidable eight-round repeats are reported honestly');
  assert.deepEqual(t.partnerSummary([{method:'same',g:[['a','b','c','d']]},{method:'random',g:[['a','b','c','d']]},{method:'balanced',g:[['b','a','d','c']]}]),{duplicateTeams:2,pairs:[{names:['a','b'],count:2},{names:['c','d'],count:2}]});
  const withRandom=t.generate(players(4),1,4,['random','same','balanced','same']);
  assert.deepEqual(withRandom.slice(1).map(r=>r.g),quartetRounds.map(r=>r.g),'random partners must never penalize later scored teams');
  assert.equal(t.partnerSummary(withRandom).duplicateTeams,0);
  assertNoBetterSingleSplit(cross,players(8));
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
  // Invalid generator settings previously reached group splitting and could make a
  // two-player match (for example, 8 players on 1.5 courts). Keep this helper
  // aligned with the server's schedule input limits instead.
  for(const courts of [0,-1,1.5,21,NaN])assert.throws(()=>t.generate(players(8),courts,1,['same']),/코트와 라운드/);
  for(const rounds of [0,-1,1.5,21,NaN])assert.throws(()=>t.generate(players(8),1,rounds,['same']),/코트와 라운드/);
  assert.throws(()=>t.generate(players(8),1,1,'same'),/라운드 방식/);
  assert.throws(()=>t.generate(players(8),1,1,['other']),/라운드 방식/);
  assert.throws(()=>t.generate(players(3),1,1,['same']),/참가자 명단/);
  assert.throws(()=>t.generate(players(201),20,1,['same']),/참가자 명단/);
  assert.throws(()=>t.generate([...players(7),{...players(1)[0]}],2,1,['same']),/참가자 명단/);
  assert.throws(()=>t.generate(players(8).map((p,i)=>({...p,lateRounds:i===0?6:0})),2,1,['same']),/늦참은 0~5/);
  assert.throws(()=>t.generate(players(8).map((p,i)=>({...p,lateRounds:i===0?1.5:0})),2,1,['same']),/늦참은 0~5/);
  assert.throws(()=>t.generate(players(8).map((p,i)=>({...p,lateRounds:i===0?'2':0})),2,1,['same']),/늦참은 0~5/);
  // Seeded randomized boundaries: every generated match remains four distinct
  // players, and late/rest/playing continue to partition the entire roster.
  const withSeed=(seed,run)=>{const original=Math.random;let state=seed>>>0;Math.random=()=>{state=(state*1664525+1013904223)>>>0;return state/0x100000000;};try{return run();}finally{Math.random=original;}};
  withSeed(0x5ced1234,()=>{for(let trial=0;trial<160;trial++){
    const n=4+(trial*37)%77,courts=1+(trial*11)%20,rounds=1+trial%5;
    const roster=players(n).map((p,i)=>({...p,lateRounds:i%11===0?i%6:0}));
    const methods=Array.from({length:rounds},(_,ri)=>['random','same','balanced'][(trial+ri)%3]);
    const made=t.generate(roster,courts,rounds,methods);
    assert.equal(made.length,rounds);
    for(const r of made){const playing=r.g.flat();
      assert.ok(r.g.every(match=>match.length===4&&new Set(match).size===4));
      assert.equal(new Set(playing).size,playing.length);
      assert.equal(new Set([...playing,...r.rest,...r.late]).size,n);
      assert.equal(playing.length+r.rest.length+r.late.length,n);
    }
  }});
  for(const n of [8,9,13,28,33])for(let trial=0;trial<12;trial++){
    const roster=players(n);roster[0].lateRounds=2;roster[1].type='guest';roster[2].operator=true;roster[3].lateRegistration=true;
    const rounds=t.generate(roster,Math.max(1,Math.floor(n/4)-1),5,['same','balanced','random','same','balanced']);
    for(const r of rounds){
      const playing=r.g.flat();assert.equal(new Set(playing).size,playing.length);
      assert.equal(new Set([...playing,...r.rest,...r.late]).size,n);
      assert.equal(playing.length+r.rest.length+r.late.length,n);
      assert.ok(r.g.every(g=>g.length===4));
    }
    assertNoBetterSingleSplit(rounds,roster);
    for(const special of roster.slice(1,4))assert.ok(rounds.filter(r=>r.rest.includes(special.name)).length<=1);
  }
  const afterRandomLate=players(9).map((p,i)=>({...p,points:[160,154,154,147,132,132,119,101,88][i],lateRounds:i===8?1:0,lateRegistration:i===8}));
  const afterRandomLateRounds=t.generate(afterRandomLate,2,3,['random','same','same']);
  assert.deepEqual(afterRandomLateRounds[0].late,['9']);
  assert.deepEqual(afterRandomLateRounds.slice(1).map(r=>r.method),['same','same']);
  assertNoBetterSingleSplit(afterRandomLateRounds,afterRandomLate);
  const edit={names:players(9).map(p=>p.name),lateRounds:{'9':1},schedule:[{g:[['1','2','3','4'],['5','6','7','8']],rest:[]}],results:{'0-0':'a','0-1':'b'},matchProgress:{'0-0':'playing','0-1':'playing'}};
  t.replacePlayer(edit,0,0,0,'5');
  assert.deepEqual(edit.schedule[0].g,[['5','2','3','4'],['5','6','7','8']]);
  assert.deepEqual(edit.schedule[0].rest,['1']);assert.deepEqual(edit.schedule[0].late,['9']);
  assert.deepEqual(edit.results,{'0-1':'b'});
  assert.deepEqual(edit.matchProgress,{'0-1':'playing'});
  assert.throws(()=>t.replacePlayer(edit,0,0,0,'2'),/같은 경기/);
  assert.throws(()=>t.replacePlayer(edit,0,0,0,'9'),/아직 도착/);
  const progress={schedule:[
    {method:'same',g:[['1','2','3','4'],['5','6','7','8']]},
    {method:'random',g:[['1','3','5','7']]},
    {method:'balanced',g:[['2','4','6','8']]}
  ],results:{'0-0':'a'},absent:['8'],matchProgress:{'0-0':'playing','0-1':'playing','1-0':'finished','2-0':'finished','2-1':'playing','bad':'playing'}};
  assert.deepEqual(t.cleanProgress(progress),{'1-0':'finished'});
  progress.schedule[1].g=[];progress.schedule.push({method:'random',g:[['1','2','3','4']]});
  progress.matchProgress={'1-0':'finished','3-0':'playing','3-1':'playing'};
  assert.deepEqual(t.cleanProgress(progress),{'3-0':'playing'});
  assert.equal(t.matchState({...progress,matchProgress:{'3-0':'playing'}},3,0),'playing');
  assert.equal(t.matchState({...progress,results:{'3-0':'a'}},3,0),'finished');
  assert.equal(t.matchState({...progress,settledAt:'done'},3,0),'finished');

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
