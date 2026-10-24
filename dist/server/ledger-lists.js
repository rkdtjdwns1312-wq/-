import { requireMember } from './member-access.js';

const MAX_BYTES=256*1024,MAX_ENTRIES=500,MAX_AMOUNT=1e12;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds=new Set(['prepaid','sponsors']);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const conflict=()=>json({error:'명단이 변경되었거나 이미 사용한 저장 번호입니다. 최신 내용을 확인해주세요.',conflict:true},409);
const unavailable=()=>json({error:'명단을 불러오거나 저장하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);
const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function calendarDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
  const time=Date.parse(value+'T00:00:00.000Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
function validEntries(entries){
  if(!Array.isArray(entries)||entries.length>MAX_ENTRIES)return false;
  const ids=new Set();
  for(const entry of entries){
    if(!exactKeys(entry,['id','name','amount','date'])||typeof entry.id!=='string'||!uuid.test(entry.id)||ids.has(entry.id.toLowerCase())||typeof entry.name!=='string'||!entry.name.trim()||entry.name.trim().length>80||/[\u0000-\u001f\u007f-\u009f]/.test(entry.name)||!Number.isSafeInteger(entry.amount)||entry.amount<1||entry.amount>MAX_AMOUNT||!calendarDate(entry.date))return false;
    ids.add(entry.id.toLowerCase());
  }
  return true;
}
// Stable order and normalization make equivalent retries identical. These
// lists are authoritative records. Ledger GET derives income from them; list
// writes never copy rows into ledger_state or change manual revisions/people.
const payloadOf=value=>({entries:value.entries.map(entry=>({id:entry.id.toLowerCase(),name:entry.name.trim(),amount:entry.amount,date:entry.date}))});
export function unpackLedgerList(row){
  if(!row||!Number.isSafeInteger(row.version)||row.version<0)throw new Error('Missing list state');
  const payload=JSON.parse(row.payload);
  if(!exactKeys(payload,['entries'])||!validEntries(payload.entries))throw new Error('Invalid list state');
  return {...payloadOf(payload),version:row.version,updatedAt:row.updated_at};
}
const unpack=unpackLedgerList;
async function readInput(request){
  const oversized=()=>({error:json({error:'입력 내용은 256 KiB 이하여야 합니다.'},413)});
  if(Number(request.headers.get('content-length'))>MAX_BYTES)return oversized();
  const reader=request.body?.getReader(),chunks=[];let size=0;
  try{
    if(reader)while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();return oversized();}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
  }catch{return {error:json({error:'입력 내용을 확인해주세요.'},400)};}
  finally{reader?.releaseLock();}
}

// Authenticate even when called directly rather than through the Worker router.
export async function ledgerLists(request,env,kind){
  const blocked=await requireMember(request,env);if(blocked)return blocked;
  if(!kinds.has(kind))return json({error:'명단을 찾을 수 없습니다.'},404);
  if(!['GET','PUT'].includes(request.method))return json({error:'허용되지 않은 요청입니다.'},405);
  if(request.method==='PUT'&&!(env.EDITOR_KEY&&request.headers.get('x-kokkiri-editor')===env.EDITOR_KEY))return json({error:'명단은 운영진만 수정할 수 있습니다.'},403);
  if(!env.DB)return unavailable();
  try{
    const readState=()=>env.DB.prepare('SELECT payload,version,updated_at FROM ledger_list_state WHERE kind=?').bind(kind).first();
    if(request.method==='GET')return json({data:unpack(await readState())});
    const parsed=await readInput(request);if(parsed.error)return parsed.error;
    const input=parsed.data;
    if(!exactKeys(input,['entries','version','operation'])||!Number.isSafeInteger(input.version)||input.version<0||input.version>=Number.MAX_SAFE_INTEGER||typeof input.operation!=='string'||!uuid.test(input.operation)||!validEntries(input.entries))return json({error:'명단의 이름·금액·날짜와 저장 버전을 확인해주세요.'},400);
    const operation=input.operation.toLowerCase(),payload=payloadOf(input);
    const requestPayload=JSON.stringify({version:input.version,...payload});
    const previousOperation=()=>env.DB.prepare('SELECT request_payload,new_snapshot FROM ledger_list_revisions WHERE kind=? AND operation=?').bind(kind,operation).first();
    const replay=row=>row.request_payload===requestPayload?json({data:JSON.parse(row.new_snapshot)}):conflict();
    const prior=await previousOperation();if(prior)return replay(prior);
    const current=unpack(await readState());
    if(current.version!==input.version){
      const raced=await previousOperation();return raced?replay(raced):conflict();
    }
    const at=new Date().toISOString(),next={...payload,version:input.version+1,updatedAt:at};
    // D1 batch commits the audit and state atomically. The same kind/version
    // predicate on both statements means a losing CAS changes neither table.
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO ledger_list_revisions(kind,operation,version,request_payload,previous_snapshot,new_snapshot,created_at)
        SELECT kind,?,version+1,?,json_object('entries',json_extract(payload,'$.entries'),'version',version,'updatedAt',updated_at),?,?
        FROM ledger_list_state WHERE kind=? AND version=?
        AND NOT EXISTS(SELECT 1 FROM ledger_list_revisions WHERE kind=? AND operation=?)`)
        .bind(operation,requestPayload,JSON.stringify(next),at,kind,input.version,kind,operation),
      env.DB.prepare(`UPDATE ledger_list_state SET payload=?,version=version+1,updated_at=?
        WHERE kind=? AND version=? AND EXISTS(SELECT 1 FROM ledger_list_revisions WHERE kind=? AND operation=? AND version=? AND request_payload=?)`)
        .bind(JSON.stringify(payload),at,kind,input.version,kind,operation,next.version,requestPayload)
    ]);
    if(result[0]?.meta?.changes===1&&result[1]?.meta?.changes===1)return json({data:next});
    const raced=await previousOperation();return raced?replay(raced):conflict();
  }catch{return unavailable();}
}
