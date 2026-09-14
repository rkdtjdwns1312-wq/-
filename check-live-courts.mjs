import assert from 'node:assert/strict';

export async function runLiveCourtsChecks({worker,env,origin,db}){
  const path=origin+'/api/live-courts';
  const call=(body,editor=false)=>worker.fetch(new Request(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(editor?{'x-kokkiri-editor':env.EDITOR_KEY}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  async function read(editor=false){return (await (await call(undefined,editor)).json()).data;}
  async function act(action,values={},editor=false){const before=await read(),r=await call({action,version:before.version,...values},editor),x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x.data;}
  async function rejectCourtDuplicate(court,name){
    const before=await read(true),r=await call({action:'join',version:before.version,court,name});
    assert.equal(r.status,409);
    assert.equal((await r.json()).error,'현재 게임중인 회원입니다. 등록할 수 없습니다.');
    assert.deepEqual(await read(true),before,'duplicate rejection must leave names, queue and version unchanged');
  }
  const snapshot=()=>JSON.stringify(['board_posts','ranking_members','guests','ranking_settlements','ranking_events','guest_events','people_changes'].map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));
  const original=snapshot();
  assert.deepEqual(await read(),{version:0,courts:[],queue:[],isOpen:false,updatedAt:null});
  for(const b of [null,{}, {version:0,action:'result',winner:'a'},{version:-1,action:'create'}])assert.equal((await call(b)).status,400);
  assert.equal((await worker.fetch(new Request(path,{method:'DELETE'}),env)).status,405);
  assert.equal((await call({version:0,action:'create',count:2})).status,403);
  for(const action of ['open','close'])assert.equal((await call({version:0,action})).status,403,'only operators control the whole session');
  for(const count of [0,21,1.5,'2'])assert.equal((await call({version:0,action:'create',count},true)).status,400);
  const first=await Promise.all([call({version:0,action:'create',count:2},true),call({version:0,action:'create',count:3},true)]);
  assert.deepEqual(first.map(r=>r.status).sort(),[200,409]);
  let d=await act('create',{count:2},true);assert.equal(d.courts.length,2);
  assert.equal(d.isOpen,false,'creating courts must not open member access');
  assert.deepEqual((await read()).courts,[],'closed courts are hidden from public reads');
  assert.equal((await read(true)).courts.length,2,'operators can prepare closed courts');
  // Existing payloads missing the gate are closed without erasing any courts.
  db.prepare('UPDATE live_courts SET payload=? WHERE id=1').run(JSON.stringify({courts:d.courts,queue:[]}));
  assert.equal((await read()).isOpen,false);
  assert.equal((await call({action:'join',version:d.version,court:0,name:'우회',isOpen:true})).status,409);
  d=await act('open',{},true);assert.equal(d.isOpen,true);assert.equal((await read()).courts.length,2);
  assert.equal((await act('open',{},true)).version,d.version,'repeating the same open is idempotent');
  assert.deepEqual(d.courts[0],{names:['','','',''],state:'waiting'});
  assert.equal((await call({action:'end',version:d.version,court:0})).status,409);
  for(const values of [{court:-1,name:'가'},{court:0,name:''},{court:0,name:'가\n나'},{court:0,name:'가'.repeat(41)}])assert.equal((await call({version:d.version,action:'join',...values})).status,400);
  assert.equal((await call({version:d.version,action:'join',court:'queue',name:'먼저 대기'})).status,409);
  d=await act('join',{court:0,name:'  자유 참가  '});assert.equal(d.courts[0].names[0],'자유 참가');
  await rejectCourtDuplicate(1,'  자유 참가  ');
  await rejectCourtDuplicate('queue','자유 참가');
  d=await act('leave',{court:0,slot:0});assert.equal(d.courts[0].names[0],'');
  await act('join',{court:0,name:'자유 참가'});d=await act('join',{court:0,name:'다른 참가'});
  const race=await Promise.all([call({version:d.version,action:'join',court:0,name:'셋'}),call({version:d.version,action:'join',court:0,name:'넷'})]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  d=await read();await act('join',{court:0,name:d.courts[0].names.includes('셋')?'넷':'셋'});
  d=await read();assert.equal(d.courts[0].state,'playing');
  await rejectCourtDuplicate(0,'자유 참가');
  await rejectCourtDuplicate(1,'자유 참가');
  await rejectCourtDuplicate('queue','자유 참가');
  assert.equal((await call({version:d.version,action:'leave',court:0,slot:0})).status,409);
  for(let i=0;i<4;i++)await act('join',{court:1,name:'두번째'+i});
  for(let i=0;i<9;i++)await act('join',{court:'queue',name:'대기'+i});
  d=await read();assert.equal(d.queue.length,3);assert.deepEqual(d.queue[0].names,['대기0','대기1','대기2','대기3']);
  assert.deepEqual(d.queue[2].names,['대기8','','','']);
  const retained=JSON.stringify({courts:d.courts,queue:d.queue}),openVersion=d.version;
  d=await act('close',{},true);assert.equal(d.isOpen,false);
  assert.equal(JSON.stringify({courts:d.courts,queue:d.queue}),retained,'closing does not erase names or queued games');
  const closedPublic=await read();assert.deepEqual(closedPublic.courts,[]);assert.deepEqual(closedPublic.queue,[]);
  for(const values of [{action:'join',court:0,name:'잠긴 입장'},{action:'join',court:'queue',name:'잠긴 대기'},{action:'leave',court:'queue',group:0,slot:0},{action:'end',court:0}])assert.equal((await call({version:d.version,...values})).status,409);
  assert.equal((await call({version:openVersion,action:'end',court:0})).status,409,'old open tabs cannot act after closure');
  assert.equal((await read(true)).version,d.version,'denied actions must not mutate the closed session');
  d=await act('open',{},true);assert.equal(JSON.stringify({courts:d.courts,queue:d.queue}),retained);
  const queueDuplicate=await call({version:d.version,action:'join',court:'queue',name:'대기0'});
  assert.equal(queueDuplicate.status,409);assert.equal((await queueDuplicate.json()).error,'이미 다음 대진에 등록된 이름입니다.');
  await act('leave',{court:'queue',group:2,slot:0});d=await read();assert.equal(d.queue.length,2);
  d=await act('end',{court:0});assert.deepEqual(d.courts[0].names,['대기0','대기1','대기2','대기3']);assert.equal(d.queue.length,1);
  assert.equal(d.courts[0].state,'playing');
  assert.ok(!('winner' in d.courts[0]),'free play must not store winners');
  const oldVersion=d.version;
  d=await act('end',{court:1});assert.deepEqual(d.courts[1].names,['대기4','대기5','대기6','대기7']);assert.equal(d.queue.length,0);
  assert.equal((await call({version:oldVersion,action:'end',court:0})).status,409);
  d=await act('end',{court:0});assert.deepEqual(d.courts[0],{names:['','','',''],state:'waiting'});
  assert.equal((await call({version:d.version,action:'end',court:0})).status,409);
  d=await act('join',{court:0,name:'자유 참가'});assert.equal(d.courts[0].names[0],'자유 참가','finished players may join again');
  await act('leave',{court:0,slot:0});
  d=await act('create',{count:2},true);
  const duplicateRace=await Promise.all([call({version:d.version,action:'join',court:0,name:'동시 이름'}),call({version:d.version,action:'join',court:1,name:'동시 이름'})]);
  assert.deepEqual(duplicateRace.map(r=>r.status).sort(),[200,409]);
  assert.equal((await read()).courts.flatMap(c=>c.names).filter(n=>n==='동시 이름').length,1);
  await rejectCourtDuplicate('queue','동시 이름');
  await act('join',{court:0,name:'다음 생성 때 초기화'});
  d=await act('create',{count:1},true);assert.equal(d.courts.length,1);assert.ok(d.courts[0].names.every(n=>n===''));
  const closeRace=await Promise.all([call({version:d.version,action:'close'},true),call({version:d.version,action:'join',court:0,name:'닫힘 경합'})]);
  assert.deepEqual(closeRace.map(r=>r.status).sort(),[200,409],'closing and joining cannot overwrite each other');
  await act('close',{},true);d=await read(true);assert.equal(d.isOpen,false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM live_courts').get().n,1,'only current state, no match history');
  assert.equal(snapshot(),original,'free courts must never change saved schedules, people, points or histories');
  console.log('PASS: free courts operator-only open/close, closed gate, retained names, duplicate-name message/races/re-entry, FIFO and zero scoring effects.');
}
