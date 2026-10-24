const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const unpack=row=>({...JSON.parse(row.payload),id:row.id,kind:row.kind,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
const conflict=()=>json({error:'다른 기기에서 대진표가 변경되었습니다. 최신 내용을 확인한 뒤 제목을 다시 수정해주세요.',conflict:true},409);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A separate, narrow endpoint also permits closed schedules. Never send these
// through the general schedule normalizer: archived participant data is sacred.
export async function scheduleTitle(request,env,id){
  if(request.method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405);
  if(!env.EDITOR_KEY||request.headers.get('x-kokkiri-editor')!==env.EDITOR_KEY)return json({error:'운영진만 제목을 수정할 수 있습니다.'},403);
  if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'홈페이지에서 다시 시도해주세요.'},403);
  if((request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'JSON 형식으로 요청해주세요.'},415);
  if(Number(request.headers.get('content-length'))>4000)return json({error:'입력 내용이 너무 큽니다.'},413);
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>4000)return json({error:'입력 내용이 너무 큽니다.'},413);
  let input;
  try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3||Object.keys(input).some(k=>!['title','version','operation'].includes(k))||typeof input.title!=='string'||!Number.isSafeInteger(input.version)||input.version<1||input.version>=Number.MAX_SAFE_INTEGER||typeof input.operation!=='string'||!uuid.test(input.operation))return json({error:'제목 수정 요청을 확인해주세요.'},400);
  // Match validate()'s trim and UTF-16 length rule, but require an explicit title.
  const title=input.title.trim();
  if(!title||title.length>120)return json({error:'제목은 1~120자로 입력해주세요.'},400);
  const operation='title-'+input.operation.toLowerCase();
  const read=()=>env.DB.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
  const replay=row=>row?.kind==='schedule'&&row.version===input.version+1&&row.last_operation===operation&&JSON.parse(row.payload).title===title;
  const row=await read();
  if(!row)return json({error:'대진표를 찾을 수 없습니다.'},404);
  if(row.kind!=='schedule')return json({error:'대진표 제목만 수정할 수 있습니다.'},400);
  if(replay(row))return json({data:unpack(row)});
  if(row.version!==input.version||row.last_operation===operation)return conflict();
  // json_set changes only title and an EXISTING preTitle. This also preserves
  // unknown legacy fields, embedded metadata, participant IDs and scoring state.
  // preTitle feeds list rendering and scored undo; it must not revive an old title.
  const saved=await env.DB.prepare(`UPDATE board_posts
    SET payload=CASE WHEN json_type(payload,'$.preTitle') IS NOT NULL
      THEN json_set(payload,'$.title',?,'$.preTitle',?)
      ELSE json_set(payload,'$.title',?) END,
      version=version+1,last_operation=?,updated_at=?
    WHERE id=? AND kind='schedule' AND version=? RETURNING *`)
    .bind(title,title,title,operation,new Date().toISOString(),id,input.version).first();
  if(saved)return json({data:unpack(saved)});
  // Another identical request may have won the CAS. A different title with the
  // same UUID, or a retry after intervening edits, must never report false success.
  const latest=await read();
  return replay(latest)?json({data:unpack(latest)}):conflict();
}
