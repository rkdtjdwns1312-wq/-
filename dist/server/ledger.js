import { requireMember } from './member-access.js';
import { unpackLedgerList } from './ledger-lists.js';

const MAX_BYTES=512*1024,MAX_AMOUNT=1e12,MAX_ENTRIES=500;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const conflict=()=>json({error:'장부가 변경되었거나 이미 사용한 저장 번호입니다. 최신 내용을 확인해주세요.',conflict:true},409);
const unavailable=()=>json({error:'회계장부를 불러오거나 저장하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);
const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const amount=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_AMOUNT;
const description=value=>typeof value==='string'&&value.trim().length>0&&value.length<=120&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);
const note=value=>typeof value==='string'&&value.length<=5000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);
function calendarDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
  const time=Date.parse(value+'T00:00:00.000Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
function validLedger(value){
  if(!Number.isSafeInteger(value.openingBalance)||Math.abs(value.openingBalance)>MAX_AMOUNT||!Array.isArray(value.entries)||value.entries.length>MAX_ENTRIES)return false;
  const ids=new Set();let income=0,expense=0,balance=value.openingBalance;
  for(const entry of value.entries){
    if(!exactKeys(entry,['id','date','description','income','expense','note'])||typeof entry.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(entry.id)||ids.has(entry.id)||!calendarDate(entry.date)||!description(entry.description)||!note(entry.note)||!amount(entry.income)||!amount(entry.expense)||(entry.income>0)===(entry.expense>0))return false;
    ids.add(entry.id);income+=entry.income;expense+=entry.expense;balance+=entry.income-entry.expense;
    if(![income,expense,balance,value.openingBalance+income,value.openingBalance-expense].every(Number.isSafeInteger))return false;
  }
  return true;
}
// Copy only contract fields in fixed key order. Array order is significant, even
// for equal dates; a retry with different JSON object key order is still identical.
const payloadOf=value=>({openingBalance:value.openingBalance,entries:value.entries.map(entry=>({id:entry.id,date:entry.date,description:entry.description,income:entry.income,expense:entry.expense,note:entry.note}))});
function unpack(row){
  if(!row||!Number.isSafeInteger(row.version)||row.version<0)throw new Error('Missing ledger state');
  const payload=JSON.parse(row.payload);
  if(!exactKeys(payload,['openingBalance','entries'])||!validLedger(payload))throw new Error('Invalid ledger state');
  return {...payloadOf(payload),version:row.version,updatedAt:row.updated_at};
}
// One SQL snapshot reads manual state and BOTH source lists consistently. LEFT
// JOIN deliberately retains missing sources so validation fails closed (503).
async function readLedger(db){
  const row=await db.prepare(`SELECT m.payload,m.version,m.updated_at,
    p.payload AS prepaid_payload,p.version AS prepaid_version,p.updated_at AS prepaid_updated_at,
    s.payload AS sponsors_payload,s.version AS sponsors_version,s.updated_at AS sponsors_updated_at
    FROM ledger_state m
    LEFT JOIN ledger_list_state p ON p.kind='prepaid'
    LEFT JOIN ledger_list_state s ON s.kind='sponsors'
    WHERE m.id=1`).first();
  const manual=unpack(row);
  const linkedEntries=['prepaid','sponsors'].flatMap(kind=>{
    const list=unpackLedgerList({payload:row[kind+'_payload'],version:row[kind+'_version'],updated_at:row[kind+'_updated_at']});
    return list.entries.map(entry=>({id:'linked:'+kind+':'+entry.id,date:entry.date,
      description:(kind==='prepaid'?'선납 회비 · ':'찬조 · ')+entry.name,
      income:entry.amount,expense:0,note:'',sourceKind:kind,sourceId:entry.id}));
  });
  return withLinkedEntries(manual,linkedEntries);
}
function withLinkedEntries(manual,linkedEntries){
  // 500 manual + 500 per list, each <= 1e12: even the largest total/running
  // balance is <= 1501e12, below MAX_SAFE_INTEGER, in any display sort order.
  let income=0,expense=0;
  for(const entry of [...manual.entries,...linkedEntries]){income+=entry.income;expense+=entry.expense;}
  if(![income,expense,manual.openingBalance+income,manual.openingBalance-expense].every(Number.isSafeInteger))throw new Error('Unsafe ledger totals');
  return {...manual,linkedEntries};
}
async function readInput(request){
  if(Number(request.headers.get('content-length'))>MAX_BYTES)return {error:json({error:'입력 내용은 512 KiB 이하여야 합니다.'},413)};
  // Count streamed bytes before decoding, including chunked requests with no
  // Content-Length. Never buffer an unbounded body via request.text()/json().
  const reader=request.body?.getReader(),chunks=[];let size=0;
  try{
    if(reader)while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();return {error:json({error:'입력 내용은 512 KiB 이하여야 합니다.'},413)};}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
  }catch{return {error:json({error:'입력 내용을 확인해주세요.'},400)};}
  finally{reader?.releaseLock();}
}

// Defense in depth: callers may route straight here, without a boards.js gate.
export async function ledger(request,env){
  const blocked=await requireMember(request,env);if(blocked)return blocked;
  if(!['GET','PUT'].includes(request.method))return json({error:'허용되지 않은 요청입니다.'},405);
  if(request.method==='PUT'&&!(env.EDITOR_KEY&&request.headers.get('x-kokkiri-editor')===env.EDITOR_KEY))return json({error:'회계장부는 운영진만 수정할 수 있습니다.'},403);
  if(!env.DB)return unavailable();
  try{
    if(request.method==='GET')return json({data:await readLedger(env.DB)});
    const parsed=await readInput(request);if(parsed.error)return parsed.error;
    const input=parsed.data;
    if(!exactKeys(input,['version','operation','openingBalance','entries'])||!Number.isSafeInteger(input.version)||input.version<0||input.version>=Number.MAX_SAFE_INTEGER||typeof input.operation!=='string'||!uuid.test(input.operation)||!validLedger(input))return json({error:'장부의 날짜·금액·항목과 저장 버전을 확인해주세요.'},400);
    const operation=input.operation.toLowerCase(),payload=payloadOf(input);
    const requestPayload=JSON.stringify({version:input.version,...payload});
    const previousOperation=()=>env.DB.prepare('SELECT request_payload,new_snapshot FROM ledger_revisions WHERE operation=?').bind(operation).first();
    // Receipts/audit/request identity remain MANUAL ONLY. Every successful PUT,
    // including a late retry, attaches currently read sources without replaying
    // old list data or persisting derived entries. ':' in linked IDs is rejected
    // by validLedger, so copying the rendered rows back into PUT fails with 400.
    const receipt=async manual=>json({data:withLinkedEntries(manual,(await readLedger(env.DB)).linkedEntries)});
    const replay=async row=>row.request_payload===requestPayload?await receipt(JSON.parse(row.new_snapshot)):conflict();
    const prior=await previousOperation();if(prior)return await replay(prior);
    const current=await readLedger(env.DB);
    if(current.version!==input.version){
      // Another copy can commit after the operation lookup and before this read.
      const raced=await previousOperation();return raced?await replay(raced):conflict();
    }
    const at=new Date().toISOString(),next={...payload,version:input.version+1,updatedAt:at};
    // D1 batch is a transaction. Both statements use the SAME version predicate;
    // the audit SELECT captures the authoritative prior state inside that batch.
    // A losing CAS inserts zero revisions and updates zero rows. A failed second
    // statement rolls the audit insert back. No lazy CREATE/INSERT state fallback.
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO ledger_revisions(operation,version,request_payload,previous_snapshot,new_snapshot,created_at)
        SELECT ?,version+1,?,json_object('openingBalance',json_extract(payload,'$.openingBalance'),'entries',json_extract(payload,'$.entries'),'version',version,'updatedAt',updated_at),?,?
        FROM ledger_state WHERE id=1 AND version=?
        AND NOT EXISTS(SELECT 1 FROM ledger_revisions WHERE operation=?)`)
        .bind(operation,requestPayload,JSON.stringify(next),at,input.version,operation),
      env.DB.prepare(`UPDATE ledger_state SET payload=?,version=version+1,updated_at=?
        WHERE id=1 AND version=? AND EXISTS(SELECT 1 FROM ledger_revisions WHERE operation=? AND version=? AND request_payload=?)`)
        .bind(JSON.stringify(payload),at,input.version,operation,next.version,requestPayload)
    ]);
    if(result[0]?.meta?.changes===1&&result[1]?.meta?.changes===1)return await receipt(next);
    const raced=await previousOperation();return raced?await replay(raced):conflict();
  }catch{return unavailable();}
}
