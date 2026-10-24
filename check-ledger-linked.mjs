import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ledger } from './dist/server/ledger.js';
import { ledgerLists } from './dist/server/ledger-lists.js';
import { memberAccessEndpoint } from './dist/server/member-access.js';
import worker from './dist/server/index.js';

const origin='https://ledger-linked.test';
const listEntry=(extra={})=>({id:crypto.randomUUID(),name:'회원',amount:10000,date:'2026-10-25',...extra});
const manualEntry=(extra={})=>({id:crypto.randomUUID(),description:'수동 회비',income:7000,expense:0,date:'2026-10-25',note:'수동 메모',...extra});
const write=(version,entries=[],openingBalance=0)=>({version,operation:crypto.randomUUID(),entries,openingBalance});
const manualOf=({linkedEntries,...manual})=>manual;
const totals=data=>[...data.entries,...data.linkedEntries].reduce((sum,e)=>({income:sum.income+e.income,expense:sum.expense+e.expense,balance:sum.balance+e.income-e.expense}),{income:0,expense:0,balance:data.openingBalance});
async function success(response){
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(response.headers.get('cache-control'),'no-store');return body.data;
}
function fixture(){
  const db=new DatabaseSync(':memory:');
  for(const name of ['0015_member_access','0017_ledger','0019_ledger_lists'])db.exec(readFileSync(new URL('./drizzle/'+name+'.sql',import.meta.url),'utf8'));
  const DB={prepare(sql){const stmt=db.prepare(sql);let args=[];return {
    bind(...values){args=values;return this;},async first(){return stmt.get(...args)||null;},
    async all(){return {results:stmt.all(...args)};},async run(){return {meta:stmt.run(...args)};},
    execute(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:stmt.all(...args)}:{meta:stmt.run(...args)};}
  };},async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>s.execute());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return {db,env:{DB,EDITOR_KEY:crypto.randomUUID()}};
}

export async function runLedgerLinkedChecks(){
  const {db,env}=fixture();
  const request=(path,body,headers={'x-kokkiri-editor':env.EDITOR_KEY})=>new Request(origin+path,{method:body===undefined?'GET':'PUT',headers:{origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const call=(body,customEnv=env)=>ledger(request('/api/ledger',body),customEnv);
  const list=async(kind,entries)=>{
    const version=db.prepare('SELECT version FROM ledger_list_state WHERE kind=?').get(kind).version;
    return success(await ledgerLists(request('/api/ledger-lists/'+kind,{version,operation:crypto.randomUUID(),entries}),env,kind));
  };
  const manualState=()=>JSON.stringify([db.prepare('SELECT * FROM ledger_state').all(),db.prepare('SELECT * FROM ledger_revisions ORDER BY version').all()]);
  const sourceState=()=>JSON.stringify([db.prepare('SELECT * FROM ledger_list_state ORDER BY kind').all(),db.prepare('SELECT * FROM ledger_list_revisions ORDER BY kind,version').all()]);
  const revisionCount=()=>db.prepare('SELECT count(*) AS n FROM ledger_revisions').get().n;
  try{
    const initialManual=manualState(),prepaid=listEntry({name:' 선납회원 ',amount:30000}),sponsor=listEntry({id:prepaid.id.toUpperCase(),name:'찬조회원',amount:50000});
    await list('prepaid',[prepaid]);await list('sponsors',[sponsor]);
    assert.equal(manualState(),initialManual,'existing lists produce no manual writes or synthetic revisions');
    let data=await success(await worker.fetch(request('/api/ledger'),env));
    assert.deepEqual(manualOf(data),{openingBalance:0,entries:[],version:0,updatedAt:null});
    assert.deepEqual(data.linkedEntries,[
      {id:'linked:prepaid:'+prepaid.id,date:prepaid.date,description:'선납 회비 · 선납회원',income:30000,expense:0,note:'',sourceKind:'prepaid',sourceId:prepaid.id},
      {id:'linked:sponsors:'+prepaid.id,date:sponsor.date,description:'찬조 · 찬조회원',income:50000,expense:0,note:'',sourceKind:'sponsors',sourceId:prepaid.id}
    ],'same UUID across kinds remains distinct and IDs are canonical');
    assert.deepEqual(totals(data),{income:80000,expense:0,balance:80000});
    const sourcesBefore=sourceState(),original=write(0,[manualEntry(),manualEntry({income:0,expense:2000})],-1000);
    const saved=await success(await call(original));assert.deepEqual(totals(saved),{income:87000,expense:2000,balance:84000});
    assert.equal(sourceState(),sourcesBefore,'manual save never updates sources or their audit');
    const firstAudit=db.prepare('SELECT * FROM ledger_revisions').get();
    assert.deepEqual(JSON.parse(firstAudit.new_snapshot),manualOf(saved));
    assert.deepEqual(JSON.parse(firstAudit.request_payload),{version:0,openingBalance:-1000,entries:original.entries});
    assert.ok(!manualState().includes('linked:'),'derived rows never enter manual storage/backup');
    const manualBefore=manualState();
    await list('prepaid',[{...prepaid,name:'수정회원',amount:45000,date:'2026-10-24'},listEntry({amount:1000})]);
    await list('sponsors',[]);
    data=await success(await call());
    assert.equal(manualState(),manualBefore,'list add/edit/delete preserves manual state/version/audit');
    assert.deepEqual(manualOf(data),manualOf(saved));assert.deepEqual(totals(data),{income:53000,expense:2000,balance:50000});
    assert.equal(data.linkedEntries[0].id,saved.linkedEntries[0].id);assert.equal(data.linkedEntries[0].date,'2026-10-24');assert.equal(data.linkedEntries[0].description,'선납 회비 · 수정회원');
    const retry=await success(await call(original));
    assert.deepEqual(manualOf(retry),manualOf(saved));assert.deepEqual(retry.linkedEntries,data.linkedEntries);
    assert.equal(manualState(),manualBefore,'retry with changed sources adds no revision');
    const newer=await success(await call(write(saved.version,[manualEntry({income:99})],42)));
    await list('prepaid',[]);await list('sponsors',[sponsor]);
    const late=await success(await call(original));
    assert.deepEqual(manualOf(late),manualOf(saved),'late retry preserves original manual receipt');assert.equal(late.linkedEntries.length,1);assert.equal(late.linkedEntries[0].sourceKind,'sponsors');
    assert.deepEqual(manualOf(await success(await call())),manualOf(newer),'late retry cannot overwrite newer manual entries');
    const beforeRejected=manualState();
    for(const entries of [[late.linkedEntries[0]],[manualEntry({id:late.linkedEntries[0].id})]])assert.equal((await call(write(newer.version,entries))).status,400);
    assert.equal((await call({...write(newer.version),linkedEntries:[]})).status,400,'PUT remains manual-only');
    assert.equal((await call({...original,entries:[]})).status,409,'same op still requires identical manual payload');
    assert.equal(manualState(),beforeRejected);

    // List edit between manual snapshot read and transaction must be retained,
    // and the successful PUT must attach sources read AFTER the commit.
    let intercepted=false;
    const concurrentEnv={...env,DB:{...env.DB,async batch(statements){
      assert.equal(intercepted,false);intercepted=true;await list('sponsors',[{...sponsor,amount:80000}]);
      const result=await env.DB.batch(statements);await list('prepaid',[prepaid]);return result;
    }}};
    const raced=await success(await call(write(newer.version,[manualEntry({income:123})]),concurrentEnv));
    assert.equal(intercepted,true);assert.deepEqual(totals(raced),{income:110123,expense:0,balance:110123});
    const both=await Promise.all([call(write(raced.version,[manualEntry({income:321})])),list('sponsors',[])]);
    await success(both[0]);data=await success(await call());assert.deepEqual(totals(data),{income:30321,expense:0,balance:30321});

    // A failed response read after a committed write is retriable with the same
    // operation. Missing/malformed sources must never masquerade as empty lists.
    const lost=write(data.version,[manualEntry({income:456})]),countBefore=revisionCount();
    const prepaidRow=db.prepare("SELECT * FROM ledger_list_state WHERE kind='prepaid'").get();
    const lostEnv={...env,DB:{...env.DB,async batch(statements){const result=await env.DB.batch(statements);db.exec("UPDATE ledger_list_state SET payload='{}' WHERE kind='prepaid'");return result;}}};
    assert.equal((await call(lost,lostEnv)).status,503);assert.equal(revisionCount(),countBefore+1);
    assert.equal((await call(lost)).status,503,'retry fails closed on broken sources too');
    db.prepare("UPDATE ledger_list_state SET payload=? WHERE kind='prepaid'").run(prepaidRow.payload);
    const recovered=await success(await call(lost));assert.equal(recovered.entries[0].income,456);assert.equal(revisionCount(),countBefore+1);
    for(const kind of ['prepaid','sponsors']){
      const savedSource=db.prepare('SELECT * FROM ledger_list_state WHERE kind=?').get(kind);
      for(const payload of ['{}','null','[]','{"entries":null}',JSON.stringify({entries:[listEntry({amount:0})]}),JSON.stringify({entries:[listEntry({date:'2026-02-29'})]}),JSON.stringify({entries:Array.from({length:501},()=>listEntry())}),JSON.stringify({entries:[prepaid,prepaid]})]){
        db.prepare('UPDATE ledger_list_state SET payload=? WHERE kind=?').run(payload,kind);
        const before=manualState();
        for(const body of [undefined,write(recovered.version),lost]){
          const response=await call(body);assert.equal(response.status,503,kind+' invalid source');assert.equal(response.headers.get('cache-control'),'no-store');
        }
        assert.equal(manualState(),before,'unreadable sources block new manual saves');
      }
      db.prepare('DELETE FROM ledger_list_state WHERE kind=?').run(kind);
      assert.equal((await call()).status,503);assert.equal((await call(write(recovered.version))).status,503);assert.equal((await call(lost)).status,503);
      db.prepare('INSERT INTO ledger_list_state(kind,payload,version,updated_at) VALUES(?,?,?,?)').run(savedSource.kind,savedSource.payload,savedSource.version,savedSource.updated_at);
    }

    // Both totals and any sorted prefix fit exact JS integers at full capacity.
    const maximal=Array.from({length:500},()=>listEntry({amount:1e12}));
    await list('prepaid',maximal);await list('sponsors',maximal);
    data=await success(await call(write(recovered.version,Array.from({length:500},()=>manualEntry({income:1e12})),1e12)));
    assert.equal(data.entries.length,500);assert.equal(data.linkedEntries.length,1000);assert.equal(new Set(data.linkedEntries.map(e=>e.id)).size,1000);
    assert.deepEqual(totals(data),{income:1500e12,expense:0,balance:1501e12});assert.ok(Number.isSafeInteger(totals(data).balance));
    data=await success(await call(write(data.version,Array.from({length:500},()=>manualEntry({income:0,expense:1e12})),-1e12)));
    assert.deepEqual(totals(data),{income:1000e12,expense:500e12,balance:499e12});
    for(const ordered of [[...data.entries,...data.linkedEntries],[...data.linkedEntries,...data.entries]]){
      let balance=data.openingBalance;for(const e of ordered){balance+=e.income-e.expense;assert.ok(Number.isSafeInteger(balance));}
    }
    assert.ok(!manualState().includes('linked:'),'all manual snapshots remain free of derived rows');

    const password=crypto.randomUUID();
    const authHeaders={origin,'content-type':'application/json','x-kokkiri-editor':env.EDITOR_KEY};
    assert.equal((await memberAccessEndpoint(new Request(origin+'/api/member-access/config',{method:'POST',headers:authHeaders,body:JSON.stringify({version:0,password})}),env)).status,200);
    const login=await memberAccessEndpoint(new Request(origin+'/api/member-login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({password})}),env);
    assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
    const beforeAuth=manualState(),sourcesBeforeAuth=sourceState();
    for(const endpoint of [ledger,worker.fetch.bind(worker)]){
      assert.equal((await endpoint(request('/api/ledger',undefined,{}),env)).status,401);
      assert.equal((await endpoint(request('/api/ledger',write(data.version),{}),env)).status,401);
      assert.equal((await endpoint(request('/api/ledger',write(data.version),{cookie}),env)).status,403);
      const memberData=await success(await endpoint(request('/api/ledger',undefined,{cookie}),env));assert.deepEqual(memberData,data);
    }
    assert.equal(manualState(),beforeAuth);assert.equal(sourceState(),sourcesBeforeAuth);
    // A missing source table also fails closed, without recreating it.
    db.exec('DROP TABLE ledger_list_state');
    assert.equal((await call()).status,503);assert.equal((await call(write(data.version))).status,503);assert.equal((await call(lost)).status,503);
    assert.equal(manualState(),beforeAuth);
  }finally{db.close();}
  console.log('PASS: derived ledger income for existing/add/edit/delete lists, current linked PUT/retry receipts, manual-only audit, reserved IDs, independent concurrent writes, fail-closed sources, 1500-row safe totals and member/operator permissions.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runLedgerLinkedChecks();
