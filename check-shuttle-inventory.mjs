import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './test-member-worker.mjs';
import rawWorker from './dist/server/index.js';

function fixture(){
  const db=new DatabaseSync(':memory:');
  for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'));
  const DB={prepare(sql){let params=[];const statement=db.prepare(sql);return {bind(...values){params=values;return this;},async first(){return statement.get(...params)||null;},async all(){return {results:statement.all(...params)};},async run(){return {meta:statement.run(...params)};},execute(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:statement.all(...params)}:{meta:statement.run(...params)};}};},async batch(statements){db.exec('BEGIN');try{const result=statements.map(statement=>statement.execute());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return {db,env:{DB,EDITOR_KEY:crypto.randomUUID()},origin:'https://shuttle-inventory.test',worker};
}
const entry=(date,change,id=crypto.randomUUID(),note='')=>({id,date,change,note});
const write=(version,entries=[],operation=crypto.randomUUID())=>({entries,version,operation});
const state=db=>JSON.stringify([db.prepare('SELECT * FROM shuttle_inventory_state').all(),db.prepare('SELECT * FROM shuttle_inventory_revisions ORDER BY version').all()]);
async function success(response){const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(response.headers.get('cache-control'),'no-store');return body.data;}

export async function runShuttleInventoryChecks(options){
  const owned=!options,{db,env,origin}=options||fixture();
  const call=(body,headers={'x-kokkiri-editor':env.EDITOR_KEY},target=worker)=>target.fetch(new Request(origin+'/api/shuttle-inventory',{method:body===undefined?'GET':'PUT',headers:{origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env);
  const unrelated=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ledger_state','ledger_revisions','ledger_list_state','ledger_list_revisions','ranking_members','guests','board_posts') ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM '+name).all()]));
  try{
    const untouched=unrelated(),initial={entries:[],version:0,updatedAt:null};assert.deepEqual(await success(await call()),initial);
    const original=write(0,[entry('2026-11-02',-3,crypto.randomUUID(),'정모에서 3개 사용'),entry('2026-11-01',12,crypto.randomUUID(),'운영진 구매\n한 타')]);let current=await success(await call(original));
    assert.equal(current.version,1);assert.deepEqual(current.entries,original.entries);assert.equal(current.entries[1].note,'운영진 구매\n한 타');assert.ok(Number.isFinite(Date.parse(current.updatedAt)));
    const receipt=current,beforeRetry=state(db);assert.deepEqual(await success(await call(original)),receipt);assert.equal(state(db),beforeRetry,'identical retry adds no revision');
    const oldClientOperation=crypto.randomUUID(),oldClientEntries=current.entries.map(({id,date,change})=>({id,date,change}));oldClientEntries[0].change=-2;
    current=await success(await call({entries:oldClientEntries,version:current.version,operation:oldClientOperation}));
    assert.equal(current.entries.find(row=>row.id===oldClientEntries[0].id).note,'정모에서 3개 사용','old clients preserve a newer memo when saving quantities');
    const oldClientReceipt=current;assert.deepEqual(await success(await call({entries:oldClientEntries,version:1,operation:oldClientOperation})),oldClientReceipt,'old-client retry replays the same receipt');
    const storedRevision=db.prepare('SELECT request_payload FROM shuttle_inventory_revisions WHERE operation=?').get(oldClientOperation),storedPayload=JSON.parse(storedRevision.request_payload);storedPayload.entries=storedPayload.entries.map(({id,date,change})=>({id,date,change}));db.prepare('UPDATE shuttle_inventory_revisions SET request_payload=? WHERE operation=?').run(JSON.stringify(storedPayload),oldClientOperation);
    assert.deepEqual(await success(await call({entries:oldClientEntries,version:1,operation:oldClientOperation})),oldClientReceipt,'pre-deploy receipt without memo keys remains replayable');
    assert.equal((await call({...original,entries:[entry('2026-11-01',8)]})).status,409);
    assert.equal((await call(write(0,[entry('2026-11-03',1)]))).status,409,'stale version cannot overwrite');
    current=await success(await call(write(current.version,[entry('2026-11-01',20),entry('2026-11-02',-4),entry('2026-11-02',2)])));
    assert.equal(current.entries.reduce((sum,row)=>sum+row.change,0),18);
    const duplicate=crypto.randomUUID(),beforeInvalid=state(db);
    const invalid=[null,[],{},write(current.version,[entry('2026-11-01',0)]),write(current.version,[entry('2026-11-01',-1)]),write(current.version,[entry('2026-02-29',1)]),write(current.version,[entry('2026-11-01',1000001)]),write(current.version,[entry('2026-11-01',1,crypto.randomUUID(),'x'.repeat(5001))]),write(current.version,[entry('2026-11-01',1,crypto.randomUUID(),'잘못된\u0000메모')]),write(current.version,[entry('2026-11-01',1,duplicate),entry('2026-11-02',1,duplicate.toUpperCase())]),write(current.version,Array.from({length:1001},()=>entry('2026-11-01',1))),{...write(current.version),extra:true}];
    for(const body of invalid)assert.equal((await call(body)).status,400,'invalid inventory contract rejected');
    assert.equal(state(db),beforeInvalid);assert.equal((await call('{bad')).status,400);
    assert.equal((await call(write(current.version),{})).status,403,'members cannot write inventory');
    assert.equal((await call(undefined,{},rawWorker)).status,401,'anonymous users cannot read inventory');
    assert.equal((await call(write(current.version),{},rawWorker)).status,401,'anonymous users cannot write inventory');
    assert.equal((await call({}, {},worker)).status,403,'member write remains forbidden through router');
    assert.equal((await call(undefined,{'x-kokkiri-editor':env.EDITOR_KEY},worker)).status,200,'operator read works through router');
    assert.equal(unrelated(),untouched,'inventory writes do not affect accounting, people, notices or games');
    const largeEntries=Array.from({length:16},(_,index)=>entry('2026-11-04',1,crypto.randomUUID(),'한'.repeat(5000)));current=await success(await call(write(current.version,largeEntries)));
    const beforeInheritedOversize=state(db),oldLarge=largeEntries.map(({id,date,change})=>({id,date,change}));for(let index=0;index<300;index++)oldLarge.push({id:crypto.randomUUID(),date:'2026-11-05',change:1});
    assert.equal((await call({entries:oldLarge,version:current.version,operation:crypto.randomUUID()})).status,413,'inherited notes cannot create an oversized effective payload');assert.equal(state(db),beforeInheritedOversize,'oversized inherited payload changes no state or revision');
    const beforeReplay=state(db);db.exec(readFileSync(new URL('./drizzle/0022_shuttle_inventory.sql',import.meta.url),'utf8'));assert.equal(state(db),beforeReplay,'migration replay preserves inventory');
    const saved=db.prepare('SELECT * FROM shuttle_inventory_state WHERE id=1').get();db.exec("UPDATE shuttle_inventory_state SET payload='{}' WHERE id=1");assert.equal((await call()).status,503);assert.equal((await call(write(current.version))).status,503);db.prepare('UPDATE shuttle_inventory_state SET payload=?,version=?,updated_at=? WHERE id=1').run(saved.payload,saved.version,saved.updated_at);
    const revisions=db.prepare('SELECT * FROM shuttle_inventory_revisions ORDER BY version').all();let previous=initial;for(const revision of revisions){assert.deepEqual(JSON.parse(revision.previous_snapshot),previous);previous=JSON.parse(revision.new_snapshot);}assert.deepEqual(previous,current);
    assert.ok(!state(db).includes(env.EDITOR_KEY),'credentials are never persisted');
  }finally{if(owned)db.close();}
  console.log('PASS: shuttle inventory date/change/cumulative contract, member/operator permissions, durable retries, conflicts, audit and data isolation.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runShuttleInventoryChecks();
