import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import worker from './dist/server/index.js';
import { adminKeyFor } from './dist/server/admin-login.js';

const byteLength=value=>Buffer.byteLength(value,'utf8');
function fixture(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(new URL('./drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL('./drizzle/'+name,import.meta.url),'utf8'));
  let largestBound=0,largestRow=0;
  const checkedRow=row=>{
    if(!row)return row;
    const size=Object.values(row).reduce((total,value)=>total+(typeof value==='string'?byteLength(value):8),0);
    largestRow=Math.max(largestRow,size);assert.ok(size<2000000,'D1 row must stay below 2 MB');return row;
  };
  const DB={prepare(sql){const statement=db.prepare(sql);let params=[];return {
    bind(...values){for(const value of values)if(typeof value==='string'){const size=byteLength(value);largestBound=Math.max(largestBound,size);assert.ok(size<2000000,'D1 string bind must stay below 2 MB');}params=values;return this;},
    async first(){return checkedRow(statement.get(...params))||null;},
    async all(){return {results:statement.all(...params).map(checkedRow)};},
    async run(){return {meta:statement.run(...params)};},
    execute(){return /^\s*(SELECT|WITH)\b/i.test(sql)?{results:statement.all(...params).map(checkedRow)}:{meta:statement.run(...params)};}
  };},async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>s.execute());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  return {db,env:{DB,EDITOR_KEY:crypto.randomUUID(),ADMIN_PASSWORD:crypto.randomUUID()},limits:()=>({largestBound,largestRow})};
}

// Isolated in-memory D1 fixture: safe to call from check-login, never production.
export async function runBackupChunkChecks(){
  const {db,env,limits}=fixture(),origin='https://backup-chunks.test';
  const adminKey=await adminKeyFor(env);
  const call=(path,method='GET',body,headers={'x-kokkiri-admin':adminKey},customEnv=env)=>worker.fetch(new Request(origin+path,{method,headers:{origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),customEnv);
  const create=async()=>{const response=await call('/api/backups','POST');assert.equal(response.status,200,await response.clone().text());return (await response.json()).data;};
  const download=async id=>{const response=await call('/api/backups/'+id);assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition'),/attachment/);return response.text();};
  const stored=()=>JSON.stringify([db.prepare('SELECT * FROM backups ORDER BY id').all(),db.prepare('SELECT * FROM backup_chunks ORDER BY backup_id,chunk_index').all()]);
  const source=()=>JSON.stringify(['board_posts','ranking_members','guests','ranking_settlements','ranking_events','guest_events','people_changes','score_point_history','ledger_state','ledger_revisions'].map(t=>db.prepare('SELECT * FROM '+t).all()));
  async function expectUnavailable(action){const old=console.error;console.error=()=>{};try{assert.equal((await action()).status,503);}finally{console.error=old;}}
  try{
    for(const headers of [{},{'x-kokkiri-editor':env.EDITOR_KEY}]){
      assert.equal((await call('/api/backups','GET',undefined,headers)).status,403);
      assert.equal((await call('/api/backups','POST',undefined,headers)).status,403);
      assert.equal((await call('/api/backups/missing','GET',undefined,headers)).status,403);
    }
    assert.equal((await call('/api/backups/missing')).status,404);
    const legacy='{"legacy":true,"note":"옛 백업 🏸\\n그대로 유지"}';
    db.prepare('INSERT INTO backups VALUES(?,?,?,?)').run('legacy-inline',new Date().toISOString(),'manual',legacy);
    assert.equal(await download('legacy-inline'),legacy,'existing downloads retain byte-exact JSON');
    const originalSource=source(),small=await create();assert.equal(source(),originalSource,'backup is read-only for business data');
    const inline=db.prepare('SELECT data FROM backups WHERE id=?').get(small.id).data;
    assert.equal(await download(small.id),inline);assert.ok(Array.isArray(JSON.parse(inline).ledgerRevisions));
    assert.equal(db.prepare('SELECT count(*) AS n FROM backup_chunks WHERE backup_id=?').get(small.id).n,0,'small new backup stays backward-compatible inline');

    const entries=Array.from({length:35},(_,i)=>({id:'memo-'+i,date:'2026-10-25',description:'회비 '+i,income:1000,expense:0,note:'\ufeff'.repeat(4500)+'메모😀\n'}));
    for(let version=0;version<2;version++){
      const body={version,operation:crypto.randomUUID(),openingBalance:-version,entries};assert.ok(byteLength(JSON.stringify(body))<=512*1024);
      const response=await call('/api/ledger','PUT',body,{'x-kokkiri-editor':env.EDITOR_KEY});assert.equal(response.status,200,await response.clone().text());
    }
    const beforeLarge=source(),large=await create(),text=await download(large.id),decoded=JSON.parse(text);
    assert.ok(byteLength(text)>2000000,'reproduces a valid backup larger than D1 string/row limit');
    assert.equal(source(),beforeLarge);assert.deepEqual(decoded.ledgerState,db.prepare('SELECT * FROM ledger_state').all().map(row=>({...row})));
    assert.deepEqual(decoded.ledgerRevisions,db.prepare('SELECT * FROM ledger_revisions').all().map(row=>({...row})));
    assert.deepEqual(JSON.parse(decoded.ledgerState[0].payload).entries,entries,'Korean, emoji and multiline notes round-trip without corruption');
    assert.ok(!text.includes(env.EDITOR_KEY)&&!text.includes(env.ADMIN_PASSWORD),'no authentication secrets in backups');
    const manifest=JSON.parse(db.prepare('SELECT data FROM backups WHERE id=?').get(large.id).data);
    assert.equal(manifest.format,'kokkiri-backup-chunks-v1');assert.equal(manifest.bytes,byteLength(text));
    const chunks=db.prepare('SELECT * FROM backup_chunks WHERE backup_id=? ORDER BY chunk_index').all(large.id);
    assert.equal(chunks.length,manifest.chunks);assert.ok(chunks.length>3);
    chunks.forEach((chunk,index)=>{assert.equal(chunk.chunk_index,index);assert.ok(byteLength(chunk.data)<=512*1024);assert.ok(!chunk.data.includes('\ufffd'),'UTF-8 splitting never introduces replacements');});
    assert.ok(chunks.some(chunk=>chunk.data.startsWith('\ufeff')),'BOM-valued text at chunk boundaries is preserved, not silently stripped by TextDecoder');
    assert.equal(chunks.map(chunk=>chunk.data).join(''),text);
    const items=(await (await call('/api/backups')).json()).items;
    assert.equal(items.find(row=>row.id===large.id).size,byteLength(text));
    assert.equal(items.find(row=>row.id==='legacy-inline').size,byteLength(legacy),'list sizes are UTF-8 bytes for both formats');

    // Corrupt/missing pieces fail closed before any partial JSON is returned.
    const piece=chunks[1];
    db.prepare('DELETE FROM backup_chunks WHERE backup_id=? AND chunk_index=?').run(large.id,1);
    await expectUnavailable(()=>call('/api/backups/'+large.id));
    db.prepare('INSERT INTO backup_chunks VALUES(?,?,?)').run(large.id,1,piece.data);
    assert.equal(await download(large.id),text,'retrieval orders by chunk index, not insertion order');
    db.prepare('UPDATE backup_chunks SET data=? WHERE backup_id=? AND chunk_index=1').run('x'+piece.data.slice(1),large.id);
    await expectUnavailable(()=>call('/api/backups/'+large.id));
    db.prepare('UPDATE backup_chunks SET data=? WHERE backup_id=? AND chunk_index=1').run(piece.data,large.id);
    assert.equal(await download(large.id),text);
    db.prepare('UPDATE backups SET data=? WHERE id=?').run(JSON.stringify({...manifest,chunks:manifest.chunks+1}),large.id);
    await expectUnavailable(()=>call('/api/backups/'+large.id));
    db.prepare('UPDATE backups SET data=? WHERE id=?').run(JSON.stringify(manifest),large.id);

    // Chunk publication and expiration run in one transaction; either injected
    // failure must preserve the old backup and roll every new row back.
    db.prepare('INSERT INTO backups VALUES(?,?,?,?)').run('expired-chunks','2000-01-01T00:00:00.000Z','auto',JSON.stringify(manifest));
    for(const chunk of chunks)db.prepare('INSERT INTO backup_chunks VALUES(?,?,?)').run('expired-chunks',chunk.chunk_index,chunk.data);
    for(const trigger of [
      "CREATE TEMP TRIGGER backup_test_failure BEFORE INSERT ON backup_chunks WHEN NEW.chunk_index=1 BEGIN SELECT RAISE(ABORT,'injected chunk failure'); END",
      "CREATE TEMP TRIGGER backup_test_failure BEFORE DELETE ON backups WHEN OLD.id='expired-chunks' BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END"
    ]){
      const before=stored();db.exec(trigger);
      try{await expectUnavailable(()=>call('/api/backups','POST'));assert.equal(stored(),before,'failed backup fully rolls back manifest, chunks and cleanup');}
      finally{db.exec('DROP TRIGGER backup_test_failure');}
    }
    const recovered=await create();assert.equal(JSON.parse(await download(recovered.id)).ledgerState[0].version,2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM backups WHERE id='expired-chunks'").get().n,0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM backup_chunks WHERE backup_id='expired-chunks'").get().n,0,'retention removes every expired chunk');
    assert.equal(await download(large.id),text,'non-expired backups survive retention');

    // The download batch still returns a coherent snapshot if expiration runs
    // immediately after the read transaction returns its in-memory results.
    let removed=false;
    const deletingDB={...env.DB,async batch(statements){const result=await env.DB.batch(statements);if(!removed){removed=true;db.prepare('DELETE FROM backups WHERE id=?').run(recovered.id);}return result;}};
    const simultaneous=await call('/api/backups/'+recovered.id,'GET',undefined,{'x-kokkiri-admin':adminKey},{...env,DB:deletingDB});
    assert.equal(simultaneous.status,200);assert.equal(JSON.parse(await simultaneous.text()).ledgerState[0].version,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM backup_chunks WHERE backup_id=?').get(recovered.id).n,0,'foreign-key cascade also cleans independently deleted backups');

    const beforeAuto=db.prepare('SELECT count(*) AS n FROM backups').get().n;
    await worker.scheduled({},env,{});
    assert.equal(db.prepare('SELECT count(*) AS n FROM backups').get().n,beforeAuto+1,'scheduled backups use chunking too');
    const auto=db.prepare("SELECT id FROM backups WHERE kind='auto'").get();assert.equal(JSON.parse(await download(auto.id)).ledgerState[0].version,2);
    const beforeMigration=stored();db.exec(readFileSync(new URL('./drizzle/0018_backup_chunks.sql',import.meta.url),'utf8'));assert.equal(stored(),beforeMigration,'migration replay preserves old and new backups');
    assert.equal(source(),beforeLarge,'backup operations never modify ledger/audit or other business data');
    assert.ok(limits().largestBound<2000000&&limits().largestRow<2000000);
    const count=db.prepare('SELECT count(*) AS n FROM backups').get().n;
    db.exec('DROP TABLE backup_chunks');
    await expectUnavailable(()=>call('/api/backups','POST'));assert.equal(db.prepare('SELECT count(*) AS n FROM backups').get().n,count,'missing migration fails without publishing an incomplete backup');
  }finally{db.close();}
  console.log('PASS: UTF-8 backup chunks under D1 limits, legacy/new downloads, ledger audit preservation, byte sizes, corruption rejection, atomic rollback, retention and scheduled backups.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runBackupChunkChecks();
