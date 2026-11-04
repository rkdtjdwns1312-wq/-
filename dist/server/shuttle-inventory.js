import { requireMember } from './member-access.js';

const MAX_BYTES=256*1024,MAX_ENTRIES=1000,MAX_CHANGE=1000000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const conflict=()=>json({error:'콕 재고 기록이 변경되었거나 이미 사용한 저장 번호입니다. 최신 내용을 확인해주세요.',conflict:true},409);
const unavailable=()=>json({error:'콕 재고 기록을 불러오거나 저장하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);
const exactKeys=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function calendarDate(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)||value.startsWith('0000'))return false;
  const time=Date.parse(value+'T00:00:00.000Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
function validEntries(entries){
  if(!Array.isArray(entries)||entries.length>MAX_ENTRIES)return false;
  const ids=new Set();
  for(const entry of entries){
    if(!exactKeys(entry,['id','date','change'])||typeof entry.id!=='string'||!uuid.test(entry.id)||ids.has(entry.id.toLowerCase())||!calendarDate(entry.date)||!Number.isSafeInteger(entry.change)||entry.change===0||Math.abs(entry.change)>MAX_CHANGE)return false;
    ids.add(entry.id.toLowerCase());
  }
  let cumulative=0;
  for(const entry of entries.map((entry,index)=>({...entry,index})).sort((a,b)=>a.date.localeCompare(b.date)||a.index-b.index)){
    cumulative+=entry.change;
    if(!Number.isSafeInteger(cumulative)||cumulative<0)return false;
  }
  return true;
}
const payloadOf=value=>({entries:value.entries.map(entry=>({id:entry.id.toLowerCase(),date:entry.date,change:entry.change}))});
function unpack(row){
  if(!row||!Number.isSafeInteger(row.version)||row.version<0)throw new Error('Missing shuttle inventory state');
  const payload=JSON.parse(row.payload);
  if(!exactKeys(payload,['entries'])||!validEntries(payload.entries))throw new Error('Invalid shuttle inventory state');
  return {...payloadOf(payload),version:row.version,updatedAt:row.updated_at};
}
async function readInput(request){
  const oversized=()=>({error:json({error:'입력 내용은 256 KiB 이하여야 합니다.'},413)});
  if(Number(request.headers.get('content-length'))>MAX_BYTES)return oversized();
  const reader=request.body?.getReader(),chunks=[];let size=0;
  try{
    if(reader)while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return oversized();}chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};
  }catch{return {error:json({error:'입력 내용을 확인해주세요.'},400)};}
  finally{reader?.releaseLock();}
}

export async function shuttleInventory(request,env){
  const blocked=await requireMember(request,env);if(blocked)return blocked;
  if(!['GET','PUT'].includes(request.method))return json({error:'허용되지 않은 요청입니다.'},405);
  if(request.method==='PUT'&&!(env.EDITOR_KEY&&request.headers.get('x-kokkiri-editor')===env.EDITOR_KEY))return json({error:'콕 재고는 운영진만 수정할 수 있습니다.'},403);
  if(!env.DB)return unavailable();
  try{
    const readState=()=>env.DB.prepare('SELECT payload,version,updated_at FROM shuttle_inventory_state WHERE id=1').first();
    if(request.method==='GET')return json({data:unpack(await readState())});
    const parsed=await readInput(request);if(parsed.error)return parsed.error;
    const input=parsed.data;
    if(!exactKeys(input,['entries','version','operation'])||!Number.isSafeInteger(input.version)||input.version<0||input.version>=Number.MAX_SAFE_INTEGER||typeof input.operation!=='string'||!uuid.test(input.operation)||!validEntries(input.entries))return json({error:'날짜와 콕 변동 개수를 확인해주세요. 누계는 0개보다 작아질 수 없습니다.'},400);
    const operation=input.operation.toLowerCase(),payload=payloadOf(input),requestPayload=JSON.stringify({version:input.version,...payload});
    const previousOperation=()=>env.DB.prepare('SELECT request_payload,new_snapshot FROM shuttle_inventory_revisions WHERE operation=?').bind(operation).first();
    const replay=row=>row.request_payload===requestPayload?json({data:JSON.parse(row.new_snapshot)}):conflict();
    const prior=await previousOperation();if(prior)return replay(prior);
    const current=unpack(await readState());
    if(current.version!==input.version){const raced=await previousOperation();return raced?replay(raced):conflict();}
    const at=new Date().toISOString(),next={...payload,version:input.version+1,updatedAt:at};
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO shuttle_inventory_revisions(operation,version,request_payload,previous_snapshot,new_snapshot,created_at)
        SELECT ?,version+1,?,json_object('entries',json_extract(payload,'$.entries'),'version',version,'updatedAt',updated_at),?,?
        FROM shuttle_inventory_state WHERE id=1 AND version=?
        AND NOT EXISTS(SELECT 1 FROM shuttle_inventory_revisions WHERE operation=?)`)
        .bind(operation,requestPayload,JSON.stringify(next),at,input.version,operation),
      env.DB.prepare(`UPDATE shuttle_inventory_state SET payload=?,version=version+1,updated_at=?
        WHERE id=1 AND version=? AND EXISTS(SELECT 1 FROM shuttle_inventory_revisions WHERE operation=? AND version=? AND request_payload=?)`)
        .bind(JSON.stringify(payload),at,input.version,operation,next.version,requestPayload)
    ]);
    if(result[0]?.meta?.changes===1&&result[1]?.meta?.changes===1)return json({data:next});
    const raced=await previousOperation();return raced?replay(raced):conflict();
  }catch{return unavailable();}
}
