import people from './roster.js';
import images from './images.js';
import { client } from './boards-client.js';
import { css } from './boards-style.js';
import { operatorLogin } from './operator-login.js';
import { ensureRankingMembers, orderRankingRows, rankingOnlyPeople, seedForPoints } from './rankings.js';

const appPeople=[...people,...rankingOnlyPeople(people)];

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const unpack=row=>({...JSON.parse(row.payload),id:row.id,kind:row.kind,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
const defaultTitle=()=>new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});

// Backfill the old singleton as one permanent post, without changing its source row.
async function preserveLegacy(db){
  await db.prepare("INSERT OR IGNORE INTO board_posts (id,kind,payload,version,last_operation,created_at,updated_at) SELECT 'legacy-schedule','schedule',payload,1,'legacy',updated_at,updated_at FROM schedules WHERE id=1").run();
}
const validResult=value=>value==='a'||value==='b';
function cleanResults(value,schedule){
  const results={};
  if(!value||typeof value!=='object'||Array.isArray(value))return results;
  for(const [key,result] of Object.entries(value)){
    const match=key.match(/^(\d+)-(\d+)$/);if(!match||!validResult(result))continue;
    const round=Number(match[1]),court=Number(match[2]);
    if(schedule[round]?.g?.[court]?.length===4)results[key]=result;
  }
  return results;
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
  return {title:title||defaultTitle(),names:d.names,participantIds:Array.isArray(d.participantIds)?d.participantIds.filter(x=>typeof x==='string').slice(0,200):[],courts:d.courts,rounds:d.rounds,schedule,results:cleanResults(d.results,schedule),settledAt:null};
}
async function settleSchedule(db,id,input){
  const row=await db.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
  if(!row)return json({error:'게시글을 찾을 수 없습니다.'},404);
  const post=unpack(row);
  if(post.kind!=='schedule')return json({error:'대진표만 점수 반영할 수 있습니다.'},400);
  if(post.settledAt)return json({data:post});
  if(row.version!==input.version)return json({error:'최신 대진표를 다시 불러온 뒤 점수를 반영해주세요.'},409);
  const results=cleanResults(post.results,post.schedule);
  const missing=[];
  for(let ri=0;ri<post.schedule.length;ri++)for(let mi=0;mi<post.schedule[ri].g.length;mi++)if(!validResult(results[`${ri}-${mi}`]))missing.push(`${ri+1}라운드 ${mi+1}번 코트`);
  if(missing.length)return json({error:`승패를 모두 입력해주세요. 미입력: ${missing.join(', ')}`},400);
  const rankingRows=(await db.prepare('SELECT * FROM ranking_members ORDER BY rank ASC').all()).results;
  if(!rankingRows.length)return json({error:'회원 점수표를 준비하지 못했습니다.'},503);
  const byId=new Map(rankingRows.map(row=>[row.member_id,row]));
  const byName=new Map(rankingRows.map(row=>[row.name,row.member_id]));
  const deltas=new Map();
  const add=(memberId,field)=>{if(!byId.has(memberId))return;const item=deltas.get(memberId)||{attendance:0,wins:0,losses:0,points:0};item[field]++;item.points+=field==='wins'?1:field==='losses'?-1:1;deltas.set(memberId,item);};
  const memberIdForName=(name,index)=>{const participantId=Array.isArray(post.participantIds)?post.participantIds[index]:'';return byId.has(participantId)?participantId:byName.get(name)||null;};
  const idsByName=new Map(post.names.map((name,index)=>[name,memberIdForName(name,index)]));
  for(const memberId of new Set(idsByName.values()))if(memberId)add(memberId,'attendance');
  for(let ri=0;ri<post.schedule.length;ri++)for(let mi=0;mi<post.schedule[ri].g.length;mi++){
    const match=post.schedule[ri].g[mi],winner=results[`${ri}-${mi}`];
    const winners=winner==='a'?match.slice(0,2):match.slice(2,4),losers=winner==='a'?match.slice(2,4):match.slice(0,2);
    for(const name of winners){const memberId=idsByName.get(name);if(memberId)add(memberId,'wins');}
    for(const name of losers){const memberId=idsByName.get(name);if(memberId)add(memberId,'losses');}
  }
  const nextRows=orderRankingRows(rankingRows.map(row=>{const delta=deltas.get(row.member_id)||{attendance:0,wins:0,losses:0,points:0};return {...row,points:row.points+delta.points,attendance:row.attendance+delta.attendance,wins:row.wins+delta.wins,losses:row.losses+delta.losses};}));
  const at=new Date().toISOString(),nextPayload={...post,results,settledAt:at};
  const statements=[
    db.prepare('INSERT INTO ranking_settlements (schedule_id,settled_at,operation) VALUES (?,?,?)').bind(id,at,input.operation),
    db.prepare("UPDATE board_posts SET payload=?,version=version+1,last_operation=?,updated_at=? WHERE id=? AND kind='schedule' AND version=?").bind(JSON.stringify(nextPayload),'settle-'+input.operation,at,id,input.version)
  ];
  for(const next of nextRows)statements.push(db.prepare('UPDATE ranking_members SET points=?,seed=?,rank=?,previous_rank=?,attendance=?,wins=?,losses=?,updated_at=? WHERE member_id=?').bind(next.points,seedForPoints(next.points),next.rank,byId.get(next.member_id).rank,next.attendance,next.wins,next.losses,at,next.member_id));
  for(const [memberId,delta] of deltas){const before=byId.get(memberId),after=nextRows.find(row=>row.member_id===memberId);statements.push(db.prepare('INSERT INTO ranking_events (schedule_id,member_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,rank_before,rank_after,seed_before,seed_after,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,memberId,delta.attendance,delta.wins,delta.losses,delta.points,before.points,after.points,before.rank,after.rank,before.seed,after.seed,at));}
  await db.batch(statements);
  const saved=await db.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
  return json({data:unpack(saved)});
}
function page(editor){
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>콕끼리 · 콕하나로 우리끼리</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%8F%B8%3C/text%3E%3C/svg%3E"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Do+Hyeon&family=Noto+Sans+KR:wght@400;500;600;700&display=swap"><style>${css}</style></head><body><header><a class="brand" href="#home"><span class="brand-name">콕<span class="shuttle" aria-hidden="true">🏸</span>끼리</span><span class="tagline">콕하나로 우리끼리</span></a><span class="access">${editor?'운영진':'회원 게시판'}</span></header><main><div id="message" role="status" aria-live="polite"></div><div id="app"></div></main><footer class="days-together">콕끼리 Since 2026.05.08. 우리가 함께한지 <strong id="daysTogether">-</strong>일</footer><dialog id="picker" aria-labelledby="pickerTitle"></dialog><script>(${client.toString()})(${JSON.stringify(editor).replaceAll('<','\\u003c')});</script></body></html>`;
}
export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname,key=env.EDITOR_KEY;
  const editor=Boolean(key)&&path==='/operate-'+key?key:'';
  if(path==='/api/operator-login')return operatorLogin(request,env);
  if(images[path])return new Response(Uint8Array.from(atob(images[path]),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png','cache-control':'public,max-age=86400'}});
  if(path==='/api/people'&&request.method==='GET'){
    if(!env.DB)return json({people:appPeople});
    await ensureRankingMembers(env.DB,appPeople);
    const {results}=await env.DB.prepare('SELECT member_id,seed,points FROM ranking_members').all(),info=new Map(results.map(row=>[row.member_id,row]));
    return json({people:appPeople.map(person=>info.has(person.id)?{...person,seed:info.get(person.id).seed,points:info.get(person.id).points}:person)});
  }
  if(path.startsWith('/api/')){
    try{
      if(!env.DB)throw Error('Storage unavailable');
      if(path==='/api/rankings'&&request.method==='GET'){
        await ensureRankingMembers(env.DB,appPeople);
        const {results}=await env.DB.prepare('SELECT member_id,name,points,seed,rank,previous_rank,attendance,wins,losses,updated_at FROM ranking_members ORDER BY rank ASC').all();
        const sourceDate='2026-09-10';
        const lastSettle=await env.DB.prepare('SELECT MAX(settled_at) AS m FROM ranking_settlements').first();
        const updatedDate=lastSettle&&lastSettle.m?new Date(lastSettle.m).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}):sourceDate;
        return json({items:results,source:'콕끼리 시드 관리표.xlsx',sourceDate,updatedDate});
      }
      const settleMatch=path.match(/^\/api\/posts\/([a-zA-Z0-9-]{1,80})\/settle$/);
      if(settleMatch){
        if(request.method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405);
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 점수를 반영할 수 있습니다.'},403);
        const raw=await request.text();if(raw.length>4000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);if(!Number.isInteger(input.version)||input.version<1||typeof input.operation!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(input.operation))throw Error('점수 반영 요청을 확인해주세요.');}catch(e){return json({error:e.message||'입력 내용을 확인해주세요.'},400);}
        await ensureRankingMembers(env.DB,appPeople);
        return settleSchedule(env.DB,settleMatch[1],input);
      }
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
      if(input.kind==='schedule'&&input.version>0){
        const existing=await env.DB.prepare('SELECT payload FROM board_posts WHERE id=? AND kind=\'schedule\'').bind(id).first();
        if(existing&&JSON.parse(existing.payload).settledAt)return json({error:'이미 점수가 반영된 대진표는 변경할 수 없습니다.'},409);
      }
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
