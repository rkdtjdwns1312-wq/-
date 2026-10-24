import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './dist/server/index.js';
import { client } from './dist/server/boards-client.js';
import { createScheduleInfo } from './dist/server/schedule-info-client.js';
import { scheduleInfoCss } from './dist/server/schedule-info-style.js';

function fixture(){
  const db=new DatabaseSync(':memory:');
  const dir=new URL('./drizzle/',import.meta.url);
  for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL(name,dir),'utf8'));
  let beforeWrite=null,beforeBatch=null;
  const writes=[];
  const DB={prepare(sql){const stmt=db.prepare(sql);let args=[];
    const hook=async()=>{if(!/^\s*(SELECT|WITH)\b/i.test(sql)){
      if(beforeWrite){const fn=beforeWrite;beforeWrite=null;await fn();}
      writes.push(sql);
    }};
    return {bind(...values){args=values;return this;},async first(){await hook();return stmt.get(...args)||null;},async all(){return {results:stmt.all(...args)};},async run(){await hook();return {meta:stmt.run(...args)};},execute(){writes.push(sql);return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:stmt.all(...args)}:{meta:stmt.run(...args)};}};
  },async batch(statements){if(beforeBatch){const fn=beforeBatch;beforeBatch=null;await fn();}db.exec('BEGIN');try{const out=statements.map(s=>s.execute());db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const env={DB,EDITOR_KEY:crypto.randomUUID()},origin='https://schedule-title.test';
  const call=(path,body,options={})=>{
    const headers=new Headers({origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY});
    for(const [key,value] of Object.entries(options.headers||{})){if(value===null)headers.delete(key);else headers.set(key,value);}
    const method=options.method||(body===undefined?'GET':'POST');
    return worker.fetch(new Request(origin+path,{method,headers,...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),options.env||env);
  };
  const row=id=>db.prepare('SELECT * FROM board_posts WHERE id=?').get(id);
  const payload=id=>JSON.parse(row(id).payload);
  const snapshot=(exclude=[])=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(r=>!exclude.includes(r.name)).map(r=>[r.name,db.prepare('SELECT * FROM "'+r.name+'" ORDER BY rowid').all()]));
  const players=db.prepare('SELECT member_id AS id,name FROM ranking_members WHERE hidden=0 ORDER BY rank LIMIT 3').all();
  players.push(db.prepare('SELECT guest_id AS id,name FROM guests WHERE hidden=0 LIMIT 1').get());
  const draft={title:'원래 제목',names:players.map(p=>p.name),participantIds:players.map(p=>p.id),courts:1,rounds:1,schedule:[{round:1,method:'balanced',g:[players.map(p=>p.name)],rest:[]}],results:{'0-0':'a'}};
  const create=async id=>success(await call('/api/posts/'+id,{kind:'schedule',version:0,operation:crypto.randomUUID(),data:draft},{method:'PUT'}));
  const title=(id,body,options)=>call('/api/posts/'+id+'/title',body,options);
  return {db,env,origin,call,row,payload,snapshot,draft,create,title,writes,set beforeWrite(fn){beforeWrite=fn;},set beforeBatch(fn){beforeBatch=fn;}};
}
const input=(title='새 제목',version=1)=>({title,version,operation:crypto.randomUUID()});
async function success(response){const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Object.keys(body),['data']);return body.data;}
async function renamed(h,id,body){
  const before=h.row(id),old=JSON.parse(before.payload),other=h.snapshot(['board_posts']);
  const otherPosts=h.db.prepare('SELECT * FROM board_posts WHERE id<>? ORDER BY id').all(id);
  h.writes.length=0;
  const data=await success(await h.title(id,body)),after=h.row(id);
  const expected={...old,title:body.title.trim()};
  if(Object.hasOwn(old,'preTitle'))expected.preTitle=body.title.trim();
  assert.deepEqual(JSON.parse(after.payload),expected,'only title and existing preTitle may change inside stored payload');
  assert.equal(after.created_at,before.created_at);assert.equal(after.version,before.version+1);
  assert.equal(after.last_operation,'title-'+body.operation.toLowerCase());
  assert.equal(data.title,body.title.trim());assert.equal(data.createdAt,before.created_at);assert.equal(data.version,after.version);assert.equal(data.updatedAt,after.updated_at);
  assert.equal(h.snapshot(['board_posts']),other,'all scoring, history, roster, ledger and other tables remain byte-for-byte equivalent');
  assert.deepEqual(h.db.prepare('SELECT * FROM board_posts WHERE id<>? ORDER BY id').all(id),otherPosts,'other posts remain identical');
  assert.equal(h.writes.length,1);assert.match(h.writes[0],/^UPDATE board_posts\s+SET payload=CASE/,'the endpoint executes only its one atomic title update');
  return data;
}

async function renderedIntegration(h){
  for(const operator of [false,true]){
    const path=operator?'/operate-'+h.env.EDITOR_KEY:'/';
    const response=await worker.fetch(new Request(h.origin+path),h.env);
    assert.equal(response.status,200);
    const html=await response.text();
    const script=html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    const style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert.ok(script&&style);assert.ok(style.includes(scheduleInfoCss),'real page includes the complete calendar and title-list CSS');
    assert.ok(script.includes('('+client.toString()+')'),'real page includes the current complete client');
    assert.doesNotThrow(()=>new Function(script),'serialized page script parses');
    // Evaluate the actual invocation while replacing only the DOM-booting client
    // with a collector, so missing or misordered serialized dependencies fail.
    const args=new Function('return '+script.replace('('+client.toString()+')','((...args)=>args)'))();
    assert.equal(args.length,9);assert.equal(args[0],operator?h.env.EDITOR_KEY:'');assert.equal(args[4],operator);
    assert.equal(typeof args[8],'function');assert.equal(args[8].toString(),createScheduleInfo.toString());
    assert.ok(args[8].toString().includes('textContent=date&&venue&&hour'),'generated title preview uses text, not HTML');
    if(!operator)assert.ok(!html.includes(h.env.EDITOR_KEY),'public page never exposes the runtime operator key');
  }
}

export async function runScheduleTitleChecks(){
  const h=fixture();
  try{
    await renderedIntegration(h);
    await h.create('open');
    // Use a real signed member session to prove membership does not grant edits.
    const password=crypto.randomUUID();
    assert.equal((await h.call('/api/member-access/config',{password,version:0})).status,200);
    const login=await h.call('/api/member-login',{password},{headers:{'x-kokkiri-editor':null}});
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await h.call('/api/posts/open',undefined,{headers:{'x-kokkiri-editor':null,cookie}})).status,200);
    const baseline=h.snapshot(),valid=input();h.writes.length=0;
    for(const headers of [
      {'x-kokkiri-editor':null},{'x-kokkiri-editor':'wrong'},{'x-kokkiri-editor':null,cookie},
      {origin:null},{origin:'null'},{origin:'https://evil.test'},{origin:h.origin+'.evil.test'}
    ])assert.equal((await h.title('open',valid,{headers})).status,403);
    assert.equal((await h.title('open',valid,{env:{DB:h.env.DB}})).status,403,'missing operator configuration fails closed');
    for(const type of [null,'text/plain','application/jsonp','application/x-www-form-urlencoded'])assert.equal((await h.title('open',valid,{headers:{'content-type':type}})).status,415);
    for(const method of ['GET','PUT','PATCH','DELETE'])assert.equal((await h.title('open',['GET'].includes(method)?undefined:valid,{method})).status,405);
    const malformed=[null,[],true,42,'{','{}',JSON.stringify({title:'x',version:1}),
      {...valid,title:42},{...valid,title:''},{...valid,title:' \t\n '},{...valid,title:'가'.repeat(121)},{...valid,title:'😀'.repeat(61)},
      ...[0,-1,1.5,'1',null,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1].map(version=>({...valid,version})),
      ...['',null,1,'abc','../x',crypto.randomUUID()+'x','00000000-0000-0000-0000-000000000000'].map(operation=>({...valid,operation})),
      ...['data','kind','schedule','names','participantIds','results','settledAt','preTitle','createdAt','matchProgress','__proto__'].map(key=>({...valid,[key]:{}}))];
    for(const body of malformed)assert.equal((await h.title('open',typeof body==='string'?body:JSON.stringify(body))).status,400,'malformed title-only input must fail');
    assert.equal((await h.title('open',' '.repeat(4001))).status,413);
    assert.equal((await h.title('open','가'.repeat(1400))).status,413,'size limit counts UTF-8 bytes');
    assert.equal((await h.title('open',valid,{headers:{'content-length':'4001'}})).status,413);
    assert.equal((await h.title('missing',valid)).status,404);
    const notice=h.db.prepare("SELECT id FROM board_posts WHERE kind='notice' LIMIT 1").get();
    assert.equal((await h.title(notice.id,valid)).status,400);
    assert.equal(h.snapshot(),baseline);assert.equal(h.writes.length,0,'rejected requests issue no DB writes');

    // Old, irregular payloads must not be regenerated or silently normalized.
    const legacy={...h.payload('open'),participantIds:[],lateRounds:{'보관 이름':5},lateRegistration:['보관 이름'],absent:['옛 이름'],mvp:['옛 MVP'],matchProgress:{'0-0':'playing'},unknown:{nested:['유지',null,{flag:true}]},version:777,createdAt:'legacy embedded date',updatedAt:'legacy embedded time'};
    h.db.prepare('UPDATE board_posts SET payload=? WHERE id=?').run(JSON.stringify(legacy),'open');
    const exact='10월 25일(일) <체육관> "A&B" \'코트\' \\ 00:05 </script> 😀';
    const request=input(' \n'+exact+'\t ');
    const saved=await renamed(h,'open',request);
    assert.equal(saved.title,exact,'API stores raw text, never HTML-escapes or interprets it');
    const list=await (await h.call('/api/posts?kind=schedule')).json();assert.equal(list.items.find(p=>p.id==='open').title,exact);
    assert.equal((await success(await h.call('/api/posts/open'))).title,exact);
    const retrySnapshot=h.snapshot();h.writes.length=0;
    assert.deepEqual(await success(await h.title('open',request)),saved);
    assert.deepEqual(await success(await h.title('open',{...request,operation:request.operation.toUpperCase()})),saved);
    assert.equal((await h.title('open',{...request,title:'다른 제목'})).status,409);
    assert.equal((await h.title('open',{...request,version:2})).status,409,'same operation cannot be repurposed at the current version');
    assert.equal((await h.title('open',input('오래된 버전',1))).status,409);
    assert.equal(h.snapshot(),retrySnapshot);assert.equal(h.writes.length,0,'immediate replay never writes twice');
    await renamed(h,'open',input('가'.repeat(120),2));
    assert.equal((await h.title('open',request)).status,409,'old retry after another edit cannot overwrite it');
    await renamed(h,'open',input('😀'.repeat(60),3));

    // Actual worker settlement creates nonempty member/guest events and history.
    // Rename every closure type, including a non-latest scored archive.
    for(const mode of ['scored','attendance','unscored']){
      const id='closed-'+mode;await h.create(id);
      const closed=await success(await h.call('/api/posts/'+id+'/settle',{version:1,operation:crypto.randomUUID(),mode}));
      if(mode!=='unscored')assert.ok(h.db.prepare('SELECT count(*) n FROM ranking_events WHERE schedule_id=?').get(id).n>0);
      const renamedData=await renamed(h,id,input('수정 '+mode,closed.version));
      assert.equal(renamedData.settledAt,closed.settledAt);assert.deepEqual(renamedData.mvp,closed.mvp);
      const items=(await (await h.call('/api/posts?kind=schedule')).json()).items;
      assert.equal(items.find(p=>p.id===id).title,'수정 '+mode);
      const beforeLocked=h.snapshot();
      assert.equal((await h.call('/api/posts/'+id,{kind:'schedule',version:3,operation:crypto.randomUUID(),data:h.draft},{method:'PUT'})).status,409,'general closed editing remains forbidden');
      assert.equal((await h.call('/api/posts/'+id+'/result',{key:'0-0',winner:'b'})).status,409);
      assert.equal((await h.call('/api/posts/'+id+'/substitute',{version:3,round:1,court:1,oldName:h.draft.names[0],newName:'다른 회원'})).status,409);
      assert.equal(h.snapshot(),beforeLocked);
      if(mode==='unscored')assert.ok(!Object.hasOwn(h.payload(id),'preTitle'),'do not invent preTitle on unscored archives');
    }
    await renamed(h,'closed-scored',input('더 오래된 마감 제목',3));
    for(const mode of ['unscored','attendance','scored']){
      const id='closed-'+mode;
      const title=h.payload(id).title;
      const reopened=await success(await h.call('/api/posts/'+id+'/unsettle',{version:h.row(id).version}));
      assert.equal(reopened.title,title,'undo must retain the edited title');assert.equal(reopened.settledAt,null);
    }
  }finally{h.db.close();}

  // Interleave real worker operations exactly after the read and before CAS.
  for(const rival of ['title','same-retry','same-operation-different-title','result','progress','settle','delete','unsettle-unscored','unsettle-scored','unsettle-attendance']){
    const h=fixture();try{
      await h.create('race');
      if(rival==='progress')h.db.prepare('UPDATE board_posts SET payload=json_set(payload,\'$.results\',json(\'{}\')) WHERE id=?').run('race');
      if(rival.startsWith('unsettle-')){
        await success(await h.call('/api/posts/race/settle',{version:1,operation:crypto.randomUUID(),mode:rival.slice(9)}));
        await renamed(h,'race',input('이전에 저장한 제목',2));
      }
      const request=input('외부 요청',h.row('race').version);let innerSnapshot;
      h.beforeWrite=async()=>{
        let response;
        if(rival==='title')response=await h.title('race',input('먼저 저장',request.version));
        if(rival==='same-retry')response=await h.title('race',request);
        if(rival==='same-operation-different-title')response=await h.title('race',{...request,title:'다른 내용'});
        if(rival==='result')response=await h.call('/api/posts/race/result',{key:'0-0',winner:'b'});
        if(rival==='progress')response=await h.call('/api/posts/race/progress',{key:'0-0',state:'playing',version:request.version});
        if(rival==='settle')response=await h.call('/api/posts/race/settle',{version:request.version,operation:crypto.randomUUID(),mode:'scored'});
        if(rival==='delete')response=await h.call('/api/posts/race',undefined,{method:'DELETE'});
        if(rival.startsWith('unsettle-'))response=await h.call('/api/posts/race/unsettle',{version:request.version});
        await success(response);innerSnapshot=h.snapshot();
      };
      const response=await h.title('race',request);assert.equal(response.status,rival==='same-retry'?200:409,rival+' race');
      if(response.status===409)assert.equal((await response.json()).conflict,true);
      assert.equal(h.snapshot(),innerSnapshot,'losing title CAS preserves all winning operation data');
      if(rival.startsWith('unsettle-')){
        assert.equal(h.payload('race').title,'이전에 저장한 제목');assert.equal(h.payload('race').settledAt,null);
        await renamed(h,'race',{...request,version:h.row('race').version});
        assert.equal(h.payload('race').title,request.title,'after refetch, rename also works on the reopened schedule');
      }
    }finally{h.db.close();}
  }
  // Reverse the ordering: title wins while another operation holds a stale read.
  for(const rival of ['result','progress','settle','unsettle-unscored','unsettle-scored','unsettle-attendance']){
    const h=fixture();try{
      await h.create('title-wins');
      if(rival==='progress')h.db.prepare('UPDATE board_posts SET payload=json_set(payload,\'$.results\',json(\'{}\')) WHERE id=?').run('title-wins');
      if(rival.startsWith('unsettle-'))await success(await h.call('/api/posts/title-wins/settle',{version:1,operation:crypto.randomUUID(),mode:rival.slice(9)}));
      const version=h.row('title-wins').version;let afterTitle;
      const hook=async()=>{await renamed(h,'title-wins',input('동시에 저장한 새 제목',version));afterTitle=h.snapshot();};
      if(['settle','unsettle-scored','unsettle-attendance'].includes(rival))h.beforeBatch=hook;else h.beforeWrite=hook;
      let response;
      if(rival==='result')response=await h.call('/api/posts/title-wins/result',{key:'0-0',winner:'b'});
      if(rival==='progress')response=await h.call('/api/posts/title-wins/progress',{key:'0-0',state:'playing',version});
      if(rival==='settle')response=await h.call('/api/posts/title-wins/settle',{version,operation:crypto.randomUUID(),mode:'scored'});
      if(rival.startsWith('unsettle-'))response=await h.call('/api/posts/title-wins/unsettle',{version});
      assert.equal(response.status,409,rival+' must reject its stale snapshot after title wins');
      assert.equal(h.snapshot(),afterTitle,rival+' rollback must preserve the title AND all scoring data');
      if(rival.startsWith('unsettle-')){
        assert.ok(h.payload('title-wins').settledAt,'failed undo leaves the archive closed');
        assert.equal((await response.json()).conflict,true);
        const undone=await success(await h.call('/api/posts/title-wins/unsettle',{version:h.row('title-wins').version}));
        assert.equal(undone.title,'동시에 저장한 새 제목');assert.equal(undone.settledAt,null,'fresh undo can safely complete');
      }
    }finally{h.db.close();}
  }
  // A late undo failure (after board/event writes) must roll everything back,
  // not merely preserve the title in the early-version-conflict case.
  for(const mode of ['scored','attendance']){
    const h=fixture();try{
      await h.create('undo-failure');
      const points=()=>JSON.stringify([
        h.db.prepare('SELECT member_id,points FROM ranking_members ORDER BY member_id').all(),
        h.db.prepare('SELECT guest_id,points FROM guests ORDER BY guest_id').all()
      ]),beforePoints=points();
      await success(await h.call('/api/posts/undo-failure/settle',{version:1,operation:crypto.randomUUID(),mode}));
      await renamed(h,'undo-failure',input('실패해도 유지할 제목',2));
      const before=h.snapshot();
      h.db.exec("CREATE TRIGGER fail_undo AFTER UPDATE ON ranking_members BEGIN SELECT RAISE(ABORT,'late undo fixture failure'); END");
      const original=console.error;console.error=()=>{};
      try{assert.equal((await h.call('/api/posts/undo-failure/unsettle',{version:3})).status,503);}finally{console.error=original;}
      assert.equal(h.snapshot(),before,'late undo failure restores board, all events/history, scores and roster revision');
      h.db.exec('DROP TRIGGER fail_undo');
      const reopened=await success(await h.call('/api/posts/undo-failure/unsettle',{version:3}));
      assert.equal(reopened.title,'실패해도 유지할 제목');assert.equal(reopened.settledAt,null);assert.equal(points(),beforePoints);
      for(const table of ['ranking_settlements','ranking_events','guest_events'])assert.equal(h.db.prepare('SELECT count(*) n FROM '+table+' WHERE schedule_id=?').get('undo-failure').n,0);
    }finally{h.db.close();}
  }
  {
    const h=fixture();try{
      await h.create('failure');const before=h.snapshot();
      h.db.exec("CREATE TRIGGER fail_title BEFORE UPDATE ON board_posts BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
      const original=console.error;console.error=()=>{};
      try{assert.equal((await h.title('failure',input())).status,503);}finally{console.error=original;}
      assert.equal(h.snapshot(),before,'failed write cannot partially update title or metadata');
    }finally{h.db.close();}
  }
  console.log('schedule title checks: PASS');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runScheduleTitleChecks();
