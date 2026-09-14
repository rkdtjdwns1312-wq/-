import assert from 'node:assert/strict';

export async function runLiveCourtsChecks({worker,env,origin,db}){
  const path=origin+'/api/live-courts';
  const call=(body,editor=false)=>worker.fetch(new Request(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(editor?{'x-kokkiri-editor':env.EDITOR_KEY}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  async function read(){return (await (await call()).json()).data;}
  async function act(action,values={},editor=false){const before=await read(),r=await call({action,version:before.version,...values},editor),x=await r.json();assert.equal(r.status,200,JSON.stringify(x));return x.data;}
  const snapshot=()=>JSON.stringify(['board_posts','ranking_members','guests','ranking_settlements','ranking_events','guest_events','people_changes'].map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));
  const original=snapshot();
  assert.deepEqual(await read(),{version:0,courts:[],queue:[],updatedAt:null});
  for(const b of [null,{}, {version:0,action:'result',winner:'a'},{version:-1,action:'create'}])assert.equal((await call(b)).status,400);
  assert.equal((await worker.fetch(new Request(path,{method:'DELETE'}),env)).status,405);
  assert.equal((await call({version:0,action:'create',count:2})).status,403);
  for(const count of [0,21,1.5,'2'])assert.equal((await call({version:0,action:'create',count},true)).status,400);
  const first=await Promise.all([call({version:0,action:'create',count:2},true),call({version:0,action:'create',count:3},true)]);
  assert.deepEqual(first.map(r=>r.status).sort(),[200,409]);
  let d=await act('create',{count:2},true);assert.equal(d.courts.length,2);
  assert.deepEqual(d.courts[0],{names:['','','',''],state:'waiting'});
  assert.equal((await call({action:'end',version:d.version,court:0})).status,409);
  for(const values of [{court:-1,name:'가'},{court:0,name:''},{court:0,name:'가\n나'},{court:0,name:'가'.repeat(41)}])assert.equal((await call({version:d.version,action:'join',...values})).status,400);
  assert.equal((await call({version:d.version,action:'join',court:'queue',name:'먼저 대기'})).status,409);
  d=await act('join',{court:0,name:'  자유 참가  '});assert.equal(d.courts[0].names[0],'자유 참가');
  assert.equal((await call({version:d.version,action:'join',court:1,name:'자유 참가'})).status,409);
  d=await act('leave',{court:0,slot:0});assert.equal(d.courts[0].names[0],'');
  await act('join',{court:0,name:'자유 참가'});d=await act('join',{court:0,name:'다른 참가'});
  const race=await Promise.all([call({version:d.version,action:'join',court:0,name:'셋'}),call({version:d.version,action:'join',court:0,name:'넷'})]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  d=await read();await act('join',{court:0,name:d.courts[0].names.includes('셋')?'넷':'셋'});
  d=await read();assert.equal(d.courts[0].state,'playing');
  assert.equal((await call({version:d.version,action:'leave',court:0,slot:0})).status,409);
  for(let i=0;i<4;i++)await act('join',{court:1,name:'두번째'+i});
  for(let i=0;i<9;i++)await act('join',{court:'queue',name:'대기'+i});
  d=await read();assert.equal(d.queue.length,3);assert.deepEqual(d.queue[0].names,['대기0','대기1','대기2','대기3']);
  assert.deepEqual(d.queue[2].names,['대기8','','','']);
  assert.equal((await call({version:d.version,action:'join',court:'queue',name:'대기0'})).status,409);
  await act('leave',{court:'queue',group:2,slot:0});d=await read();assert.equal(d.queue.length,2);
  d=await act('end',{court:0});assert.deepEqual(d.courts[0].names,['대기0','대기1','대기2','대기3']);assert.equal(d.queue.length,1);
  assert.equal(d.courts[0].state,'playing');
  assert.ok(!('winner' in d.courts[0]),'free play must not store winners');
  const oldVersion=d.version;
  d=await act('end',{court:1});assert.deepEqual(d.courts[1].names,['대기4','대기5','대기6','대기7']);assert.equal(d.queue.length,0);
  assert.equal((await call({version:oldVersion,action:'end',court:0})).status,409);
  d=await act('end',{court:0});assert.deepEqual(d.courts[0],{names:['','','',''],state:'waiting'});
  assert.equal((await call({version:d.version,action:'end',court:0})).status,409);
  await act('join',{court:0,name:'다음 생성 때 초기화'});
  d=await act('create',{count:1},true);assert.equal(d.courts.length,1);assert.ok(d.courts[0].names.every(n=>n===''));
  assert.equal(db.prepare('SELECT count(*) AS n FROM live_courts').get().n,1,'only current state, no match history');
  assert.equal(snapshot(),original,'free courts must never change saved schedules, people, points or histories');
  console.log('PASS: free courts operator-only creation, public registration, FIFO queue/advance, no winner data, conflict safety and zero ranking/attendance effects.');
}
