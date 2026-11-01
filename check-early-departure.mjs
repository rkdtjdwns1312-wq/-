import assert from 'node:assert/strict';
import { createScheduleTools } from './dist/server/schedule-tools.js';

const tools=(new Function('return ('+createScheduleTools.toString()+')'))()();
const players=(n)=>Array.from({length:n},(_,i)=>({id:'early-'+i,name:'참가'+i,points:160-i,type:'member',operator:false,lateRounds:0,lateRegistration:false}));
const seeded=(seed,fn)=>{const original=Math.random;let state=seed>>>0;Math.random=()=>{state=(state*1664525+1013904223)>>>0;return state/0x100000000;};try{return fn();}finally{Math.random=original;}};

for(const method of ['same','balanced','random'])for(const seed of [3,27,912])seeded(seed,()=>{
  const roster=players(13),earlyFromRounds={'참가0':3,'참가1':5},rounds=5;
  roster[0].type='guest';roster[0].lateRegistration=true;
  roster[1].operator=true;roster[1].lateRegistration=true;roster[1].lateRounds=1;
  roster[2].lateRounds=2; // arrives at round 3, leaving only the final round available
  const made=tools.generate(roster,3,rounds,Array(rounds).fill(method),earlyFromRounds);
  for(let ri=0;ri<rounds;ri++){
    const r=made[ri],playing=r.g.flat();
    assert.deepEqual(r.early,roster.filter(p=>earlyFromRounds[p.name]>0&&earlyFromRounds[p.name]<=ri+1).map(p=>p.name));
    assert.deepEqual(r.late,roster.filter(p=>p.lateRounds>ri&&!r.early.includes(p.name)).map(p=>p.name));
    assert.ok(!playing.some(name=>r.early.includes(name)));
    assert.equal(playing.length+r.rest.length+r.late.length+r.early.length,roster.length);
    assert.equal(new Set([...playing,...r.rest,...r.late,...r.early]).size,roster.length);
    for(const name of ['참가0','참가1'])if(!r.early.includes(name))assert.ok(!r.rest.includes(name),name+' must not rest while present');
  }
  assert.ok(!made[0].early.includes('참가0'));
  assert.ok(made[2].early.includes('참가0'));
  assert.ok(made[4].early.includes('참가1'));
  assert.equal(made[2].late.includes('참가1'),false,'early departure takes precedence over late classification');
  assert.ok(made[1].late.includes('참가2'));
  assert.ok(!made[2].late.includes('참가2'),'late arrival is no longer classified late once present');
});

// Legacy rounds keep their historical shape; an explicitly configured empty map
// adds an empty early list so editors can distinguish configured from legacy data.
const legacy=tools.generate(players(8),2,2,['random','same']);
assert.ok(legacy.every(r=>!Object.hasOwn(r,'early')));
const configured=tools.generate(players(8),2,2,['random','same'],{});
assert.ok(configured.every(r=>Array.isArray(r.early)&&r.early.length===0));

for(const bad of ['3',-1,4,1.5,null])assert.throws(
  ()=>tools.generate(players(8),2,3,['random','same','balanced'],{'참가0':bad}),/조퇴 라운드는 0~3 사이의 정수/);
for(const bad of ['2',-1,3,1.25])assert.throws(
  ()=>tools.generate(players(8).map((p,i)=>i? p:{...p,earlyFromRound:bad}),2,2,['random','same']),/조퇴 라운드는 0~2 사이의 정수/);

// A guest/operator selected for early departure remains protected from rest
// until the departure round, including people marked late-registration.
for(const method of ['same','balanced','random'])for(const role of ['guest','operator']){
  const roster=players(5),special=roster[0];special.type=role==='guest'?'guest':'member';special.operator=role==='operator';special.lateRegistration=true;
  const made=tools.generate(roster,1,2,[method,method],{[special.name]:2});
  assert.ok(!made[0].rest.includes(special.name));
  assert.ok(made[0].g.flat().includes(special.name));
  assert.ok(made[1].early.includes(special.name));
}

// Ordinary early-departure members retain the previous rest rotation rules.
const ordinary=players(9);ordinary[0].lateRegistration=true;
const ordinaryMade=tools.generate(ordinary,2,4,Array(4).fill('random'),{'참가0':4});
assert.equal(ordinaryMade.filter(r=>r.rest.includes('참가0')).length,1);
const ordinaryPlain=players(5);for(let i=1;i<5;i++){ordinaryPlain[i].type='guest';ordinaryPlain[i].operator=i===2;}
const ordinaryPlainMade=tools.generate(ordinaryPlain,1,5,Array(5).fill('random'),Object.fromEntries(ordinaryPlain.slice(1).map(p=>[p.name,5])));
assert.ok(ordinaryPlainMade[0].rest.includes('참가0'),'ordinary participants remain eligible for rest');

// If every available rest candidate is protected, generation reports the
// capacity conflict rather than silently resting a guest/operator.
for(const method of ['same','balanced','random'])assert.throws(()=>{
  const roster=players(5);roster[0].type='guest';roster[1].operator=true;
  roster[2].type='guest';roster[3].operator=true;roster[4].type='guest';
  tools.generate(roster,1,2,[method,method],Object.fromEntries(roster.map(p=>[p.name,2])));
},/휴식 1회 제한 대상.*대진을 채울 수 없어요/);

// A late arrival that reaches or passes the departure round has no playable
// rounds, while still remaining valid configuration for attendance handling.
const overlap=players(8);overlap[0].lateRounds=2;
const overlapMade=tools.generate(overlap,2,4,Array(4).fill('random'),{'참가0':3});
assert.deepEqual(overlapMade.map(r=>r.early.includes('참가0')),[false,false,true,true]);
assert.deepEqual(overlapMade.map(r=>r.late.includes('참가0')),[true,true,false,false]);
assert.ok(overlapMade.every(r=>!r.g.flat().includes('참가0')&&!r.rest.includes('참가0')));

const draft={names:players(7).map(p=>p.name),rounds:4,earlyFromRounds:{'참가4':3},lateRounds:{'참가6':2},schedule:[
  {g:[['참가0','참가1','참가2','참가3']],rest:[]},
  {g:[['참가0','참가1','참가2','참가3']],rest:[]},
  {g:[['참가0','참가1','참가2','참가3']],rest:[]},
  {g:[['참가0','참가1','참가2','참가3']],rest:[]}
]};
assert.deepEqual(tools.availableNames(draft,1),draft.names.filter(n=>n!=='참가6'));
assert.deepEqual(tools.availableNames(draft,2),draft.names.filter(n=>n!=='참가4'));
assert.deepEqual(tools.refreshRound(draft,2).early,['참가4']);
assert.ok(!draft.schedule[2].rest.includes('참가4'));
assert.throws(()=>tools.replacePlayer(draft,2,0,0,'참가4'),/조퇴 설정으로 이 라운드에는 참가할 수 없는 사람/);
assert.throws(()=>tools.replacePlayer(draft,0,0,0,'참가6'),/아직 도착하지 않은 참가자/);
const swapped={...draft,earlyFromRounds:{'참가6':4},schedule:[{g:[['참가0','참가1','참가2','참가3']],rest:['참가4','참가5'],late:[]}]};
tools.replacePlayer(swapped,0,0,0,'참가4');
assert.deepEqual(swapped.schedule[0].g[0],['참가4','참가1','참가2','참가3']);
assert.deepEqual(swapped.schedule[0].rest,['참가0','참가5']);
assert.deepEqual(swapped.schedule[0].early,[]);

console.log('PASS: early departure generation, late overlap, three methods and seeded rest rules, validation, capacity errors, availability, refresh, and swaps.');
