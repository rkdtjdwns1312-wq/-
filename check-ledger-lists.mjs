import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ledgerLists } from './dist/server/ledger-lists.js';
import { memberAccessEndpoint } from './dist/server/member-access.js';
import rawWorker from './dist/server/index.js';

const migration=readFileSync(new URL('./drizzle/0019_ledger_lists.sql',import.meta.url),'utf8');
const localWorker={fetch:(request,env)=>ledgerLists(request,env,new URL(request.url).pathname.split('/').at(-1))};
function fixture(migrate=true){
  const db=new DatabaseSync(':memory:');
  const DB={prepare(sql){let params=[];const statement=db.prepare(sql);return {
    bind(...values){params=values;return this;},async first(){return statement.get(...params)||null;},
    async run(){return {meta:statement.run(...params)};},async all(){return {results:statement.all(...params)};},
    execute(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:statement.all(...params)}:{meta:statement.run(...params)};}
  };},async batch(statements){db.exec('BEGIN');try{const out=statements.map(s=>s.execute());db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}};
  if(migrate)for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'));
  return {db,env:{DB,EDITOR_KEY:crypto.randomUUID()},origin:'https://ledger-lists.test',worker:rawWorker};
}
function caller(worker,env,origin,kind='prepaid'){
  return (body,headers={},customEnv=env,method=body===undefined?'GET':'PUT')=>worker.fetch(new Request(origin+'/api/ledger-lists/'+kind,{
    method,headers:{origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY,...headers},
    ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})
  }),customEnv);
}
const entry=(extra={})=>({id:crypto.randomUUID(),name:'시험 회원',amount:10000,date:'2026-10-25',...extra});
const write=(version,extra={})=>({entries:[],version,operation:crypto.randomUUID(),...extra});
const snapshot=db=>JSON.stringify([db.prepare('SELECT * FROM ledger_list_state ORDER BY kind').all(),db.prepare('SELECT * FROM ledger_list_revisions ORDER BY kind,version').all()]);
async function success(response){
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(Object.keys(body),['data']);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Object.keys(body.data).sort(),['entries','version','updatedAt'].sort());return body.data;
}

async function renderedPageChecks(env,origin){
  // Check the actual public HTML response: factory/unit tests alone cannot
  // detect a missing serialized dependency or omitted stylesheet in page().
  const response=await rawWorker.fetch(new Request(origin+'/'),env);
  assert.equal(response.status,200);
  const html=await response.text(),script=html.match(/<script>([\s\S]*)<\/script>/)?.[1],style=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(script,'public page includes the client script');
  assert.match(script,/function\s+createLedgerLists\s*\(/,'public page serializes the list factory for ledger navigation');
  assert.ok(style,'public page includes its styles');
  assert.match(style,/\.ledger-list-scroll\s*\{/,'public page includes list scrolling CSS');
  assert.match(style,/\.excellent-member-badge\s*\{/,'public page includes the green excellent-member badge CSS');
  assert.doesNotThrow(()=>new Function(script),'serialized client dependencies form valid JavaScript');
  assert.ok(!html.includes(env.EDITOR_KEY),'public page never embeds the editor credential');
}

async function authenticationChecks(integratedWorker){
  const {db,env,origin}=fixture();
  db.exec(readFileSync(new URL('./drizzle/0015_member_access.sql',import.meta.url),'utf8'));
  const request=(kind,method='GET',headers={},body)=>new Request(origin+'/api/ledger-lists/'+kind,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    const before=snapshot(db);
    const password=crypto.randomUUID(),headers={origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY};
    assert.equal((await memberAccessEndpoint(new Request(origin+'/api/member-access/config',{method:'POST',headers,body:JSON.stringify({version:0,password})}),env)).status,200);
    const login=await memberAccessEndpoint(new Request(origin+'/api/member-login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password})}),env);
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    for(const kind of ['prepaid','sponsors']){
      // Authentication boundaries must bypass check-login's automatic member
      // cookie wrapper; exercise that supplied worker separately below.
      for(const worker of [localWorker,rawWorker]){
        for(const method of ['GET','PUT']){
          const body=method==='PUT'?write(0):undefined;
          for(const auth of [{},{'x-kokkiri-editor':'invalid'},{cookie:cookie+'; '+cookie},{cookie:cookie+'z'}]){
            const denied=await worker.fetch(request(kind,method,{origin,'content-type':'application/json',...auth},body),env);
            assert.equal(denied.status,401);assert.equal(denied.headers.get('cache-control'),'no-store');assert.equal((await denied.json()).code,'MEMBERS_ONLY');
          }
        }
        const member={cookie,origin,'content-type':'application/json'};
        assert.equal((await worker.fetch(request(kind,'GET',member),env)).status,200);
        assert.equal((await worker.fetch(request(kind,'PUT',member,write(0)),env)).status,403);
        const call=caller(worker,env,origin,kind);
        for(const override of [{origin:''},{origin:'https://hostile.test'},{'content-type':'text/plain'}])assert.equal((await call(write(0),override)).status,override['content-type']?415:403);
        assert.equal((await worker.fetch(request(kind,'PUT',{'x-kokkiri-editor':env.EDITOR_KEY,'content-type':'application/json'},write(0)),env)).status,403);
        assert.equal((await call({}, {},env,'POST')).status,405);
        assert.equal((await call(undefined,{}, {...env,DB:null})).status,503);
        assert.equal((await call(write(0),{}, {...env,DB:null})).status,503);
        assert.equal((await call(undefined,{}, {...env,EDITOR_KEY:''})).status,401);
      }
      const member={cookie,origin,'content-type':'application/json'};
      assert.equal((await integratedWorker.fetch(request(kind,'GET',member),env)).status,200);
      assert.equal((await integratedWorker.fetch(request(kind,'PUT',member,write(0)),env)).status,403);
    }
    assert.equal((await localWorker.fetch(request('unknown','GET',headers),env)).status,404);
    assert.equal(snapshot(db),before,'permission and read checks never change list/audit');
  }finally{db.close();}
}

// Optional {worker,env,origin,db} is the existing check-login SQLite fixture.
// Standalone also exercises the real Worker router; no production requests.
export async function runLedgerListChecks(options){
  const owned=!options,{worker,env,origin,db}=options||fixture(),call=caller(worker,env,origin),sponsor=caller(worker,env,origin,'sponsors');
  const revisions=kind=>db.prepare('SELECT * FROM ledger_list_revisions WHERE kind=? ORDER BY version').all(kind);
  const unrelated=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ledger_state','ledger_revisions','board_posts','ranking_members','guests','ranking_settlements','ranking_events','guest_events','people_changes','score_point_history','live_courts_state') ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM '+name).all()]));
  const untouched=unrelated();
  try{
    await renderedPageChecks(env,origin);
    const initial={entries:[],version:0,updatedAt:null};
    assert.deepEqual(await success(await call()),initial);assert.deepEqual(await success(await sponsor()),initial);
    const beforeRead=snapshot(db);await success(await call());assert.equal(snapshot(db),beforeRead);
    const original=write(0,{entries:[entry({name:'  첫 회원  '}),entry({date:'2000-02-29'}),entry({date:'0001-01-01',amount:1})]});
    const normalized=original.entries.map(e=>({...e,name:e.name.trim()}));
    let current=await success(await call(original));const receipt=current;
    assert.equal(current.version,1);assert.deepEqual(current.entries,normalized);assert.ok(Number.isFinite(Date.parse(current.updatedAt)));
    assert.deepEqual(JSON.parse(revisions('prepaid')[0].previous_snapshot),initial);
    assert.deepEqual(JSON.parse(revisions('prepaid')[0].new_snapshot),current);
    assert.deepEqual(await success(await sponsor()),initial,'prepaid never changes sponsors');
    const sponsorOriginal=write(0,{operation:original.operation,entries:[entry({name:'찬조 회원'})]});
    let sponsorCurrent=await success(await sponsor(sponsorOriginal));assert.equal(sponsorCurrent.version,1,'same operation is independent per list');
    const beforeRetry=snapshot(db);
    assert.deepEqual(await success(await call(original)),receipt);
    const reordered={operation:original.operation.toUpperCase(),version:0,entries:normalized.map(e=>({date:e.date,amount:e.amount,name:e.name,id:e.id.toUpperCase()}))};
    assert.deepEqual(await success(await call(reordered)),receipt,'normalization and key order preserve retry identity');
    for(const patch of [{entries:[]},{version:1}])assert.equal((await call({...original,...patch})).status,409);
    assert.equal(snapshot(db),beforeRetry);
    current=await success(await call(write(current.version,{entries:[{...normalized[0],amount:20000},entry()]})));
    assert.deepEqual(JSON.parse(revisions('prepaid').at(-1).previous_snapshot),receipt,'edit/delete keeps authoritative prior state');
    const afterEdit=snapshot(db);
    assert.deepEqual(await success(await call(original)),receipt,'late retry returns original receipt');
    assert.equal((await call(write(receipt.version))).status,409);assert.equal(snapshot(db),afterEdit);
    assert.deepEqual(await success(await call()),current,'late retry never rewinds newer edits');

    const duplicate=entry();
    const invalid=[null,[],{},true,write(-1),write(.5),write(Number.MAX_SAFE_INTEGER),write(current.version,{operation:12}),write(current.version,{operation:'invalid'}),write(current.version,{unknown:true}),write(current.version,{entries:null}),write(current.version,{entries:Array.from({length:501},()=>entry())}),write(current.version,{entries:[duplicate,{...duplicate,id:duplicate.id.toUpperCase()}]}),
      ...['','not-a-uuid','한글',"x';DROP TABLE ledger_list_state;--",'__proto__',null,12].map(id=>write(current.version,{entries:[entry({id})]})),
      ...['','  ','가'.repeat(81),'이름\n','\t이름','이름\u0000','이름\u007f','이름\u0085',null,123].map(name=>write(current.version,{entries:[entry({name})]})),
      ...[-1,0,.5,1e12+1,Number.MAX_SAFE_INTEGER+1,'100',null,true].map(amount=>write(current.version,{entries:[entry({amount})]})),
      ...['2026-02-29','1900-02-29','2026-04-31','2026-00-10','2026-13-01','2026-01-00','0000-01-01','2026-1-01','2026-01-01T00:00:00Z',null].map(date=>write(current.version,{entries:[entry({date})]})),
      write(current.version,{entries:[null]}),write(current.version,{entries:[{...entry(),unknown:true}]}),
      JSON.stringify(write(current.version)).replace('{','{"__proto__":{"polluted":true},'),
      JSON.stringify(write(current.version,{entries:[entry()]})).replace('"id":','"constructor":{"prototype":{"polluted":true}},"id":')
    ];
    for(const body of invalid){assert.equal((await call(body)).status,400,'invalid contract rejected');assert.equal(snapshot(db),afterEdit);}
    assert.equal({}.polluted,undefined);
    for(const body of ['{bad','', '{"version":1e999}',JSON.stringify(write(current.version,{entries:[entry()]})).replace('"amount":10000','"amount":1e999')])assert.equal((await call(body)).status,400);
    const huge=JSON.stringify(write(current.version,{entries:[entry({name:'한'.repeat(90000)})]}));
    assert.ok(huge.length<256*1024&&Buffer.byteLength(huge)>256*1024);
    assert.equal((await call(huge)).status,413);assert.equal((await call(write(current.version),{'content-length':String(256*1024+1)})).status,413);
    assert.equal(snapshot(db),afterEdit);
    // Verify chunked bodies are byte-bounded without trusting Content-Length.
    const headers={origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY};
    const bytes=new TextEncoder().encode(huge);let offset=0,cancelled=false;
    const stream=new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+4096));offset=Math.min(bytes.length,offset+4096);},cancel(){cancelled=true;}});
    assert.equal((await ledgerLists(new Request(origin+'/api/ledger-lists/prepaid',{method:'PUT',headers,body:stream,duplex:'half'}),env,'prepaid')).status,413);assert.equal(cancelled,true);
    assert.equal((await ledgerLists(new Request(origin+'/api/ledger-lists/prepaid',{method:'PUT',headers,body:new Uint8Array([0xff])}),env,'prepaid')).status,400);
    const edge=JSON.stringify(write(current.version));
    current=await success(await call(edge+' '.repeat(256*1024-Buffer.byteLength(edge))));
    assert.equal((await call(edge+' '.repeat(256*1024-Buffer.byteLength(edge)+1))).status,413);
    // Maximum persisted rows exercise both old/new snapshots and serialized backup size.
    const maximal=Array.from({length:500},()=>entry({name:'가'.repeat(80),amount:1e12,date:'9999-12-31'}));
    current=await success(await call(write(current.version,{entries:maximal})));
    current=await success(await call(write(current.version,{entries:maximal.map(e=>({...e,name:'나'.repeat(80)}))})));
    assert.equal(current.entries.length,500);
    const largest=revisions('prepaid').at(-1);
    assert.ok(Buffer.byteLength(JSON.stringify(largest))<2*1024*1024,'full serialized audit row fits D1 2MiB row/backup chunk limit');
    assert.ok(Object.values(largest).reduce((n,v)=>n+Buffer.byteLength(String(v)),0)<2*1024*1024,'raw audit columns fit D1 row limit');
    const priorCount=revisions('prepaid').length;
    const race=await Promise.all([call(write(current.version,{entries:[entry()]})),call(write(current.version,{entries:[entry()]}))]);
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal(revisions('prepaid').length,priorCount+1);current=await success(await call());
    const same=write(current.version,{entries:[entry()]}),sameCount=revisions('prepaid').length;
    const duplicates=await Promise.all([call(same),call(same)]);
    const duplicateData=await Promise.all(duplicates.map(success));assert.deepEqual(duplicateData[0],duplicateData[1]);assert.equal(revisions('prepaid').length,sameCount+1);current=duplicateData[0];
    const reused=write(current.version,{entries:[entry()]}),reusedCount=revisions('prepaid').length;
    const reusedRace=await Promise.all([call(reused),call({...reused,entries:[]})]);
    assert.deepEqual(reusedRace.map(r=>r.status).sort(),[200,409]);assert.equal(revisions('prepaid').length,reusedCount+1);current=await success(await call());
    // Different kinds may concurrently advance from different versions.
    const both=await Promise.all([call(write(current.version,{entries:[entry()]})),sponsor(write(sponsorCurrent.version,{entries:[]}))]);
    [current,sponsorCurrent]=await Promise.all(both.map(success));

    let winnerSnapshot,intercepted=false;
    const raceDB={...env.DB,async batch(statements){
      assert.equal(intercepted,false);intercepted=true;
      await success(await caller(localWorker,env,origin)(write(current.version,{entries:[entry()]})));
      winnerSnapshot=snapshot(db);return env.DB.batch(statements);
    }};
    assert.equal((await call(write(current.version),{}, {...env,DB:raceDB})).status,409);
    assert.equal(intercepted,true);assert.equal(snapshot(db),winnerSnapshot,'CAS loss inserts no audit');current=await success(await call());

    const delayed=write(current.version,{entries:[entry()]});let originalReceipt,delayedSnapshot;
    const delayedDB={...env.DB,prepare(sql){
      const statement=env.DB.prepare(sql);
      if(sql==='SELECT payload,version,updated_at FROM ledger_list_state WHERE kind=?'){
        const first=statement.first;
        statement.first=async()=>{originalReceipt=await success(await call(delayed));delayedSnapshot=snapshot(db);return first();};
      }
      return statement;
    }};
    assert.deepEqual(await success(await call(delayed,{}, {...env,DB:delayedDB})),originalReceipt,'commit between operation lookup and state read replays');
    assert.equal(snapshot(db),delayedSnapshot);current=originalReceipt;

    for(const table of ['ledger_list_state','ledger_list_revisions']){
      const beforeFailure=snapshot(db),attempt=write(current.version,{entries:[entry()]});
      db.exec(`CREATE TEMP TRIGGER ledger_list_test_failure BEFORE ${table==='ledger_list_state'?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'injected list failure'); END`);
      try{assert.equal((await call(attempt)).status,503);assert.equal(snapshot(db),beforeFailure,'atomic rollback at '+table);}
      finally{db.exec('DROP TRIGGER ledger_list_test_failure');}
      current=await success(await call(attempt));
    }
    // Simulate commit success followed by a lost response; next retry must deduplicate.
    const lost=write(current.version,{entries:[entry()]}),lostCount=revisions('prepaid').length;
    const lostDB={...env.DB,async batch(statements){await env.DB.batch(statements);throw new Error('lost acknowledgement');}};
    assert.equal((await call(lost,{}, {...env,DB:lostDB})).status,503);
    current=await success(await call(lost));assert.equal(revisions('prepaid').length,lostCount+1);
    for(const [kind,latest] of [['prepaid',current],['sponsors',sponsorCurrent]]){
      let previous=initial;
      for(const revision of revisions(kind)){assert.deepEqual(JSON.parse(revision.previous_snapshot),previous);previous=JSON.parse(revision.new_snapshot);assert.equal(previous.version,revision.version);assert.equal(previous.updatedAt,revision.created_at);}
      assert.deepEqual(previous,latest,'complete independent audit chain for '+kind);
    }
    assert.ok(!snapshot(db).includes(env.EDITOR_KEY),'no auth secrets persisted');
    const beforeMigration=snapshot(db);db.exec(migration);assert.equal(snapshot(db),beforeMigration,'migration replay preserves lists/audit');
    const emptied=await success(await call(write(current.version)));assert.deepEqual(emptied.entries,[]);assert.deepEqual(JSON.parse(revisions('prepaid').at(-1).previous_snapshot),current);
    assert.deepEqual(await success(await sponsor()),sponsorCurrent);
    assert.equal(unrelated(),untouched,'lists never write manual accounting storage, seed scores, people, notices or games');
    await authenticationChecks(worker);await unavailableChecks();
  }finally{if(owned)db.close();}
  console.log('PASS: rendered public list factory/CSS, ledger lists member/operator permissions, list isolation, strict validation/256KiB/500 rows, D1 row bounds, durable retries, CAS races, full audit and atomic rollback; existing accounting/seed/notice data unchanged.');
}

async function unavailableChecks(){
  const {db,env,origin}=fixture(false),call=caller(localWorker,env,origin);
  try{
    const schema=()=>JSON.stringify(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all());const before=schema();
    assert.equal((await call()).status,503);assert.equal((await call(write(0))).status,503);assert.equal(schema(),before);
    db.exec(migration);db.exec("DELETE FROM ledger_list_state WHERE kind='prepaid'");
    assert.equal((await call()).status,503);assert.equal((await call(write(0))).status,503);assert.equal(db.prepare('SELECT count(*) AS n FROM ledger_list_state').get().n,1,'no lazy recreation');
    db.exec(migration);db.exec('DROP TABLE ledger_list_revisions');const beforeState=db.prepare('SELECT * FROM ledger_list_state ORDER BY kind').all();
    assert.equal((await call(write(0))).status,503);assert.deepEqual(db.prepare('SELECT * FROM ledger_list_state ORDER BY kind').all(),beforeState);
    db.exec(migration);db.exec("UPDATE ledger_list_state SET payload='{}' WHERE kind='prepaid'");
    assert.equal((await call()).status,503);assert.equal((await call(write(0))).status,503);
  }finally{db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runLedgerListChecks();
