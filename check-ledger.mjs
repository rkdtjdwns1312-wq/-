import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ledger } from './dist/server/ledger.js';
import { memberAccessEndpoint } from './dist/server/member-access.js';
import rawWorker from './dist/server/index.js';
import { runLedgerLinkedChecks } from './check-ledger-linked.mjs';

const migration=readFileSync(new URL('./drizzle/0017_ledger.sql',import.meta.url),'utf8');
const localWorker={fetch:ledger};
function fixture(migrate=true){
  const db=new DatabaseSync(':memory:');
  const DB={prepare(sql){let params=[];const statement=db.prepare(sql);return {
    bind(...values){params=values;return this;},async first(){return statement.get(...params)||null;},
    async run(){return {meta:statement.run(...params)};},async all(){return {results:statement.all(...params)};},
    execute(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:statement.all(...params)}:{meta:statement.run(...params)};}
  };},async batch(statements){db.exec('BEGIN');try{const out=statements.map(s=>s.execute());db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}};
  if(migrate){db.exec(migration);db.exec(readFileSync(new URL('./drizzle/0019_ledger_lists.sql',import.meta.url),'utf8'));}
  // The editor fixture is generated at runtime; no production credentials exist here.
  return {db,env:{DB,EDITOR_KEY:crypto.randomUUID()},origin:'https://ledger.test',worker:rawWorker};
}
function caller(worker,env,origin){
  return (body,headers={},customEnv=env,method=body===undefined?'GET':'PUT')=>worker.fetch(new Request(origin+'/api/ledger',{
    method,headers:{origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY,...headers},
    ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})
  }),customEnv);
}
const entry=(id='row-1',extra={})=>({id,date:'2026-10-25',description:'회비',income:10000,expense:0,note:'',...extra});
const write=(version,extra={})=>({version,operation:crypto.randomUUID(),openingBalance:0,entries:[],...extra});
const snapshot=db=>JSON.stringify([db.prepare('SELECT * FROM ledger_state ORDER BY id').all(),db.prepare('SELECT * FROM ledger_revisions ORDER BY version').all()]);
async function success(response){
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(Object.keys(body),['data']);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(Object.keys(body.data).sort(),['openingBalance','entries','version','updatedAt','linkedEntries'].sort());
  // This suite checks the original manual-only audit/receipt contract with empty
  // source lists; the linked suite below tests live sources and combined totals.
  const {linkedEntries,...manual}=body.data;assert.deepEqual(linkedEntries,[]);return manual;
}

async function authenticationChecks(integratedWorker){
  const {db,env,origin}=fixture();
  db.exec(readFileSync(new URL('./drizzle/0015_member_access.sql',import.meta.url),'utf8'));
  const request=(method='GET',headers={},body)=>new Request(origin+'/api/ledger',{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    const before=snapshot(db);
    for(const method of ['GET','PUT']){
      const denied=await ledger(request(method,{},method==='PUT'?write(0):undefined),env);
      assert.equal(denied.status,401);assert.equal(denied.headers.get('cache-control'),'no-store');assert.equal((await denied.json()).code,'MEMBERS_ONLY');
      assert.equal((await ledger(request(method,{'x-kokkiri-editor':'invalid'},method==='PUT'?write(0):undefined),env)).status,401);
    }
    const password=crypto.randomUUID(),headers={origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY};
    assert.equal((await memberAccessEndpoint(new Request(origin+'/api/member-access/config',{method:'POST',headers,body:JSON.stringify({version:0,password})}),env)).status,200);
    const login=await memberAccessEndpoint(new Request(origin+'/api/member-login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password})}),env);
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const member={cookie,origin,'content-type':'application/json'};
    assert.equal((await ledger(request('GET',member),env)).status,200,'real member cookie reads directly');
    assert.equal((await ledger(request('PUT',member,write(0)),env)).status,403,'member cannot write directly');
    assert.equal((await integratedWorker.fetch(request('GET',member),env)).status,200,'integrated member read');
    assert.equal((await integratedWorker.fetch(request('PUT',member,write(0)),env)).status,403,'integrated member write denied');
    assert.equal((await ledger(request('GET',{cookie:cookie+'; '+cookie}),env)).status,401,'ambiguous cookies denied');
    assert.equal((await ledger(request('GET',{cookie:cookie.slice(0,-1)+'z'}),env)).status,401,'forged cookie denied');
    const call=caller(localWorker,env,origin);
    for(const override of [{origin:''},{origin:'https://hostile.test'},{'content-type':'text/plain'}])assert.equal((await call(write(0),override)).status,override['content-type']?415:403);
    assert.equal((await ledger(request('PUT',{'x-kokkiri-editor':env.EDITOR_KEY,'content-type':'application/json'},write(0)),env)).status,403,'missing Origin denied');
    assert.equal((await call({}, {},env,'POST')).status,405);
    assert.equal((await call(undefined,{}, {...env,DB:null})).status,503);
    assert.equal((await call(write(0),{}, {...env,DB:null})).status,503);
    assert.equal((await call(undefined,{}, {...env,EDITOR_KEY:''})).status,401);
    assert.equal(snapshot(db),before,'permission and read checks cannot mutate ledger/audit');
  }finally{db.close();}
}

// Accept the check-login worker (including its authenticated member wrapper),
// synthetic env, origin and node:sqlite DatabaseSync. No arguments runs locally.
export async function runLedgerChecks(options){
  const owned=!options,context=options||fixture();
  const {worker,env,origin,db}=context,call=caller(worker,env,origin);
  const revisions=()=>db.prepare('SELECT * FROM ledger_revisions ORDER BY version').all();
  const unrelated=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('board_posts','ranking_members','guests','ranking_settlements','ranking_events','guest_events','people_changes','score_point_history') ORDER BY name").all().map(({name})=>db.prepare('SELECT * FROM '+name).all()));
  const untouched=unrelated();
  try{
    const initial=await success(await call());
    assert.deepEqual(initial,{openingBalance:0,entries:[],version:0,updatedAt:null});
    const beforeRead=snapshot(db);await success(await call());assert.equal(snapshot(db),beforeRead);
    let current=await success(await call(write(0)));
    assert.equal(current.version,1);assert.deepEqual(current.entries,[]);assert.ok(Number.isFinite(Date.parse(current.updatedAt)));
    assert.deepEqual(JSON.parse(revisions()[0].previous_snapshot),initial);
    assert.deepEqual(JSON.parse(revisions()[0].new_snapshot),current);

    const original=write(current.version,{openingBalance:-25000,entries:[entry('z-last'),entry(crypto.randomUUID(),{description:'셔틀콕',income:0,expense:30000}),entry('a-first',{date:'2024-02-29',note:'첫 줄\n둘째 줄\n'+'메'.repeat(4988)})]});
    const saved=await success(await call(original));current=saved;
    assert.deepEqual(saved.entries,original.entries,'input order and multiline notes preserved');
    assert.equal(saved.openingBalance,-25000);
    const beforeRetry=snapshot(db);
    assert.deepEqual(await success(await call(original)),saved);
    const reordered={entries:original.entries.map(e=>({note:e.note,expense:e.expense,income:e.income,description:e.description,date:e.date,id:e.id})),openingBalance:original.openingBalance,operation:original.operation.toUpperCase(),version:original.version};
    assert.deepEqual(await success(await call(reordered)),saved,'key order / UUID case do not change request identity');
    assert.equal(snapshot(db),beforeRetry,'same operation retry has no new mutation');
    for(const patch of [{openingBalance:1},{entries:[]},{version:saved.version}])assert.equal((await call({...original,...patch})).status,409,'operation reuse requires identical version and data');
    assert.equal(snapshot(db),beforeRetry);

    current=await success(await call(write(saved.version,{openingBalance:0,entries:[entry('z-last',{income:5000,note:'수정'}),entry('new-row',{income:0,expense:500})]})));
    const edited=revisions().at(-1);
    assert.deepEqual(JSON.parse(edited.previous_snapshot),saved,'edit/delete stores full original data');
    assert.deepEqual(JSON.parse(edited.new_snapshot),current,'edit/delete stores full replacement');
    const afterEdit=snapshot(db);
    assert.deepEqual(await success(await call(original)),saved,'late retry returns original receipt, not a new write');
    assert.equal((await call(write(saved.version))).status,409,'stale version conflict');assert.equal(snapshot(db),afterEdit);
    assert.deepEqual(await success(await call()),current,'late retry never rewinds state');
    const invalid=[
      null,[],{},true,write(-1),write(0.5),write(Number.MAX_SAFE_INTEGER),
      write(current.version,{operation:'not-a-uuid'}),write(current.version,{operation:12}),
      write(current.version,{openingBalance:1.5}),write(current.version,{openingBalance:-1e12-1}),write(current.version,{openingBalance:1e12+1}),
      write(current.version,{openingBalance:'0'}),write(current.version,{entries:null}),
      write(current.version,{entries:Array.from({length:501},(_,i)=>entry('row-'+i))}),
      write(current.version,{entries:[entry(),entry()]}),
      ...['',"x';DROP TABLE ledger_state;--",'한글','x'.repeat(65),'__proto__'].map(id=>write(current.version,{entries:[entry(id)]})),
      ...['2026-02-29','1900-02-29','2026-04-31','2026-00-10','2026-13-01','2026-01-00','0000-01-01','2026-1-01','2026-01-01T00:00:00Z',null].map(date=>write(current.version,{entries:[entry('date',{date})]})),
      ...[-1,0.5,1e12+1,Number.MAX_SAFE_INTEGER+1,'100',null,true].map(income=>write(current.version,{entries:[entry('amount',{income})]})),
      write(current.version,{entries:[entry('zero',{income:0})]}),write(current.version,{entries:[entry('both',{expense:1})]}),
      write(current.version,{entries:[entry('expense',{expense:-1})]}),
      write(current.version,{entries:[entry('description',{description:'가'.repeat(121)})]}),
      ...['','   ','\t','항목\n줄','항목\u0000','항목\u007f','항목\u0085'].map(description=>write(current.version,{entries:[entry('description',{description})]})),
      ...['\u0000','\u0008','\u000b','\u000c','\u001f','\u007f','\u0085'].map(note=>write(current.version,{entries:[entry('note',{note})]})),
      write(current.version,{entries:[entry('note',{note:'가'.repeat(5001)})]}),
      write(current.version,{entries:[entry('note',{note:null})]}),
      write(current.version,{entries:[{...entry(),unknown:true}]}),write(current.version,{unknown:true}),
      JSON.stringify(write(current.version)).replace('{','{"__proto__":{"polluted":true},'),
      JSON.stringify(write(current.version,{entries:[entry()]})).replace('"id":','"constructor":{"prototype":{"polluted":true}},"id":')
    ];
    for(const body of invalid){assert.equal((await call(body)).status,400,'invalid contract rejected');assert.equal(snapshot(db),afterEdit,'invalid input does not mutate');}
    assert.equal({}.polluted,undefined);
    for(const body of ['{bad','', '{"version":1e999}',JSON.stringify(write(current.version,{entries:[entry()]})).replace('"income":10000','"income":1e999')])assert.equal((await call(body)).status,400);
    const huge=JSON.stringify(write(current.version,{entries:Array.from({length:40},(_,i)=>entry('large-'+i,{note:'한'.repeat(5000)}))}));
    assert.ok(huge.length<512*1024&&Buffer.byteLength(huge)>512*1024,'multibyte body tests bytes, not characters');
    const tooLarge=await call(huge);assert.equal(tooLarge.status,413);assert.match((await tooLarge.json()).error,/512/);
    assert.equal((await call(write(current.version),{'content-length':String(512*1024+1)})).status,413);
    assert.equal(snapshot(db),afterEdit);

    // Exactly the byte bound is accepted (whitespace is valid JSON framing).
    const edge=JSON.stringify(write(current.version));
    current=await success(await call(edge+' '.repeat(512*1024-Buffer.byteLength(edge))));
    assert.equal((await call(edge+' '.repeat(512*1024-Buffer.byteLength(edge)+1))).status,413);
    current=await success(await call(write(current.version,{openingBalance:1e12,entries:Array.from({length:500},(_,i)=>entry('cap-'+i,{income:i%2?0:1e12,expense:i%2?1e12:0,description:'가'.repeat(120),date:i%2?'2000-02-29':'0001-01-01'}))})));
    assert.equal(current.entries.length,500);assert.equal(current.openingBalance,1e12);
    current=await success(await call(write(current.version,{openingBalance:-1e12,entries:[entry('long-note',{note:'줄\n\r\t'+'가'.repeat(4996)})]})));
    assert.equal(current.entries[0].note.length,5000);

    const raceVersion=current.version,priorCount=revisions().length;
    const race=await Promise.all([call(write(raceVersion,{openingBalance:100})),call(write(raceVersion,{openingBalance:200}))]);
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal(revisions().length,priorCount+1);
    current=await success(await call());
    const same=write(current.version,{openingBalance:300}),sameCount=revisions().length;
    const duplicates=await Promise.all([call(same),call(same)]);
    const duplicateData=await Promise.all(duplicates.map(success));assert.deepEqual(duplicateData[0],duplicateData[1]);assert.equal(revisions().length,sameCount+1);current=duplicateData[0];
    const reused=write(current.version,{openingBalance:400}),reusedCount=revisions().length;
    const reusedRace=await Promise.all([call(reused),call({...reused,openingBalance:500})]);
    assert.deepEqual(reusedRace.map(r=>r.status).sort(),[200,409]);assert.equal(revisions().length,reusedCount+1);current=await success(await call());

    // Force a competing commit between the endpoint's read and its atomic batch.
    let winnerSnapshot,intercepted=false;
    const raceDB={...env.DB,async batch(statements){
      assert.equal(intercepted,false);intercepted=true;
      await success(await ledger(new Request(origin+'/api/ledger',{method:'PUT',headers:{origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY},body:JSON.stringify(write(current.version,{openingBalance:600}))}),env));
      winnerSnapshot=snapshot(db);return env.DB.batch(statements);
    }};
    assert.equal((await call(write(current.version,{openingBalance:700}),{}, {...env,DB:raceDB})).status,409);
    assert.equal(intercepted,true);assert.equal(snapshot(db),winnerSnapshot,'failed CAS adds no audit or state change');current=await success(await call());

    const delayed=write(current.version,{openingBalance:750});let originalReceipt,delayedSnapshot;
    const delayedDB={...env.DB,prepare(sql){
      const statement=env.DB.prepare(sql);
      if(sql.includes('FROM ledger_state m')){
        const first=statement.first;
        statement.first=async()=>{
          if(!originalReceipt){originalReceipt=await success(await call(delayed));delayedSnapshot=snapshot(db);}
          return first();
        };
      }
      return statement;
    }};
    assert.deepEqual(await success(await call(delayed,{}, {...env,DB:delayedDB})),originalReceipt,'duplicate committing between operation lookup and state read is replayed');
    assert.equal(snapshot(db),delayedSnapshot);current=originalReceipt;

    // Real SQL failures in either statement must roll the entire D1 batch back.
    for(const table of ['ledger_state','ledger_revisions']){
      const beforeFailure=snapshot(db),attempt=write(current.version,{openingBalance:800});
      db.exec(`CREATE TEMP TRIGGER ledger_test_failure BEFORE ${table==='ledger_state'?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'injected ledger failure'); END`);
      try{assert.equal((await call(attempt)).status,503);assert.equal(snapshot(db),beforeFailure,'atomic rollback at '+table);}
      finally{db.exec('DROP TRIGGER ledger_test_failure');}
      current=await success(await call(attempt));assert.equal(current.openingBalance,800,'retry after transient failure succeeds');
    }
    const all=revisions();let previous=initial;
    for(const revision of all){assert.deepEqual(JSON.parse(revision.previous_snapshot),previous);previous=JSON.parse(revision.new_snapshot);assert.equal(previous.version,revision.version);assert.equal(previous.updatedAt,revision.created_at);}
    assert.deepEqual(previous,current,'audit is a complete chain');
    assert.ok(!snapshot(db).includes(env.EDITOR_KEY),'no auth secrets persisted');
    const beforeMigration=snapshot(db);db.exec(migration);assert.equal(snapshot(db),beforeMigration,'migration replay never resets the ledger');
    // End with an empty ledger, retaining its full prior snapshots.
    const emptied=await success(await call(write(current.version)));assert.deepEqual(emptied.entries,[]);assert.equal(emptied.openingBalance,0);assert.deepEqual(JSON.parse(revisions().at(-1).previous_snapshot),current);
    assert.equal(unrelated(),untouched,'ledger never changes scores, settlements, roster or boards');
    await authenticationChecks(worker);
    await unavailableChecks();
    await runLedgerLinkedChecks();
  }finally{if(owned)db.close();}
  console.log('PASS: ledger member/operator permissions, strict input/512KiB limit, 500 rows/5000-char multiline notes, signed balance, full snapshots, durable retries, concurrent CAS and atomic failure rollback.');
}

async function unavailableChecks(){
  const {db,env,origin}=fixture(false),call=caller(localWorker,env,origin);
  try{
    const schema=()=>JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all());
    const before=schema();
    assert.equal((await call()).status,503);assert.equal((await call(write(0))).status,503);assert.equal(schema(),before,'no runtime schema fallback');
    db.exec(migration);db.exec(readFileSync(new URL('./drizzle/0019_ledger_lists.sql',import.meta.url),'utf8'));db.exec('DELETE FROM ledger_state');
    assert.equal((await call()).status,503);assert.equal((await call(write(0))).status,503);assert.equal(db.prepare('SELECT count(*) AS n FROM ledger_state').get().n,0,'no runtime singleton fallback');
    db.exec(migration);db.exec('DROP TABLE ledger_revisions');
    const state=db.prepare('SELECT * FROM ledger_state').get();
    assert.equal((await call(write(0))).status,503);assert.deepEqual(db.prepare('SELECT * FROM ledger_state').get(),state,'missing audit cannot allow a write');
  }finally{db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runLedgerChecks();
