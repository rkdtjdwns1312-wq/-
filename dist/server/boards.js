import people from './roster.js';
import images from './images.js';
import { client } from './boards-client.js';
import { css } from './boards-style.js';
import { operatorLogin } from './operator-login.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const unpack=row=>({...JSON.parse(row.payload),id:row.id,kind:row.kind,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
const defaultTitle=()=>new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});

// Backfill the old singleton as one permanent post, without changing its source row.
async function preserveLegacy(db){
  await db.prepare("INSERT OR IGNORE INTO board_posts (id,kind,payload,version,last_operation,created_at,updated_at) SELECT 'legacy-schedule','schedule',payload,1,'legacy',updated_at,updated_at FROM schedules WHERE id=1").run();
}
function validate(d,kind){
  if(!d||typeof d!=='object')throw Error('내용을 확인해주세요.');
  const title=typeof d.title==='string'?d.title.trim():'';
  if(title.length>120)throw Error('제목은 120자 이내로 입력해주세요.');
  if(kind==='notice'){
    if(typeof d.body!=='string'||!d.body.trim()||d.body.length>20000)throw Error('공지 내용을 1~20,000자로 입력해주세요.');
    return {title:title||defaultTitle(),body:d.body.trim()};
  }
  if(!Array.isArray(d.names)||d.names.length<4||d.names.length>200||d.names.some(n=>typeof n!=='string'||!n.trim()||n.length>100)||new Set(d.names).size!==d.names.length)throw Error('참가자 명단을 확인해주세요.');
  if(!Number.isInteger(d.courts)||d.courts<1||d.courts>20||!Number.isInteger(d.rounds)||d.rounds<1||d.rounds>20||!Array.isArray(d.schedule)||d.schedule.length!==d.rounds)throw Error('코트와 라운드 수를 확인해주세요.');
  const schedule=d.schedule.map((r,i)=>{
    if(!Array.isArray(r.g)||r.g.length!==Math.min(d.courts,Math.floor(d.names.length/4))||r.g.some(m=>!Array.isArray(m)||m.length!==4))throw Error('대진 구성을 확인해주세요.');
    const playing=r.g.flat();
    if(playing.some(n=>!d.names.includes(n))||new Set(playing).size!==playing.length)throw Error('같은 라운드에 한 참가자가 중복 배치되었습니다.');
    return {round:i+1,g:r.g,rest:d.names.filter(n=>!playing.includes(n))};
  });
  return {title:title||defaultTitle(),names:d.names,participantIds:Array.isArray(d.participantIds)?d.participantIds.filter(x=>typeof x==='string').slice(0,200):[],courts:d.courts,rounds:d.rounds,schedule};
}
function page(editor){
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>콕끼리 · 콕하나로 우리끼리</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Do+Hyeon&family=Noto+Sans+KR:wght@400;500;600;700&display=swap"><style>${css}</style></head><body><header><a class="brand" href="#home"><span class="brand-name">콕<span class="shuttle" aria-hidden="true">🏸</span>끼리</span><span class="tagline">콕하나로 우리끼리</span></a><span class="access">${editor?'운영진':'회원 게시판'}</span></header><main><div id="message" role="status" aria-live="polite"></div><div id="app"></div></main><footer class="days-together">콕끼리 Since 2026.05.08. 우리가 함께한지 <strong id="daysTogether">-</strong>일</footer><dialog id="picker" aria-labelledby="pickerTitle"></dialog><script>(${client.toString()})(${JSON.stringify(editor).replaceAll('<','\\u003c')});</script></body></html>`;
}
export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname,key=env.EDITOR_KEY;
  const editor=Boolean(key)&&path==='/operate-'+key?key:'';
  if(path==='/api/operator-login')return operatorLogin(request,env);
  if(images[path])return new Response(Uint8Array.from(atob(images[path]),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png','cache-control':'public,max-age=86400'}});
  if(path==='/api/people'&&request.method==='GET')return json({people});
  if(path.startsWith('/api/')){
    try{
      if(!env.DB)throw Error('Storage unavailable');
      // Old tabs must reload rather than overwrite the new archive.
      if(path==='/api/schedule'){
        if(request.method!=='GET')return json({error:'홈을 새로고침한 뒤 게시판에서 저장해주세요.'},409);
        const row=await env.DB.prepare('SELECT payload,updated_at FROM schedules WHERE id=1').first();
        return json({data:row?{...JSON.parse(row.payload),updatedAt:row.updated_at}:null});
      }
      if(path==='/api/posts'&&request.method==='GET'){
        const kind=url.searchParams.get('kind');
        if(!['schedule','notice'].includes(kind))return json({error:'게시판을 확인해주세요.'},400);
        await preserveLegacy(env.DB);
        const offset=Math.max(0,Math.min(1000000,Math.floor(Number(url.searchParams.get('offset')))||0));
        const {results}=await env.DB.prepare('SELECT id,kind,json_extract(payload,\'$.title\') AS title,created_at,updated_at,version FROM board_posts WHERE kind=? ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?').bind(kind,offset).all();
        return json({items:results.slice(0,30),hasMore:results.length>30});
      }
      const match=path.match(/^\/api\/posts\/([a-zA-Z0-9-]{1,80})$/);
      if(!match)return json({error:'찾을 수 없는 요청입니다.'},404);
      const id=match[1];
      if(request.method==='GET'){
        await preserveLegacy(env.DB);
        const row=await env.DB.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
        return row?json({data:unpack(row)}):json({error:'게시글을 찾을 수 없습니다.'},404);
      }
      if(request.method!=='PUT')return json({error:'허용되지 않은 요청입니다.'},405);
      if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 저장할 수 있습니다.'},403);
      const raw=await request.text();if(raw.length>200000)return json({error:'내용이 너무 큽니다.'},413);
      let input,payload;
      try{
        input=JSON.parse(raw);
        if(!['schedule','notice'].includes(input.kind)||!Number.isInteger(input.version)||input.version<0||typeof input.operation!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(input.operation))throw Error('저장 요청을 확인해주세요.');
        payload=validate(input.data,input.kind);
      }catch(e){return json({error:e.message||'입력 내용을 확인해주세요.'},400);}
      const at=new Date().toISOString();
      const result=input.version===0
        ?await env.DB.prepare('INSERT OR IGNORE INTO board_posts (id,kind,payload,version,last_operation,created_at,updated_at) VALUES (?,?,?,1,?,?,?)').bind(id,input.kind,JSON.stringify(payload),input.operation,at,at).run()
        :await env.DB.prepare('UPDATE board_posts SET payload=?,version=version+1,last_operation=?,updated_at=? WHERE id=? AND kind=? AND version=?').bind(JSON.stringify(payload),input.operation,at,id,input.kind,input.version).run();
      const row=await env.DB.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
      if(!row)return json({error:'수정할 게시글이 없습니다.'},404);
      if(!result.meta.changes&&row.last_operation!==input.operation)return json({error:'다른 운영진이 먼저 수정했습니다. 입력 내용은 유지됩니다. 새 탭에서 최신 글을 확인한 뒤 다시 수정해주세요.'},409);
      return json({data:unpack(row)});
    }catch(error){console.error('Board request failed',error);return json({error:'저장소에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);}
  }
  if(path!=='/'&&!editor)return new Response('페이지를 찾을 수 없습니다.',{status:404});
  return new Response(page(editor),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'}});
}};
