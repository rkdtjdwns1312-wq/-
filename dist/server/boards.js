import images from './images.js';
import { client } from './boards-client.js';
import { css } from './boards-style.js';
import { createScheduleTools } from './schedule-tools.js';
import { operatorLogin } from './operator-login.js';
import { adminLogin, adminKeyFor } from './admin-login.js';
import { orderRankingRows, seedForPoints } from './rankings.js';
import { readWeeklyResults } from './weekly-results.js';
import { liveCourts } from './live-courts.js';
import { createLiveView } from './live-client.js';
import { liveCss } from './live-style.js';
import { rosterRevision,commitRoster,updateRows,insertRows } from './roster-write.js';

function scoredState(row,delta,at){
  const d=delta||{attendance:0,wins:0,losses:0,points:0};
  const rawPoints=row.points+d.points,points=Math.max(20,rawPoints);
  const protectedNow=Boolean(delta&&d.wins+d.losses>0&&rawPoints<=20);
  return {...row,points,attendance:d.attendance,wins:d.wins,losses:d.losses,
    rank_protected:protectedNow?1:0,
    floor_protected_at:points>20?null:protectedNow?at:row.floor_protected_at};
}

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const unpack=row=>({...JSON.parse(row.payload),id:row.id,kind:row.kind,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
const defaultTitle=()=>new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});

// 옛 단일 대진표(schedules id=1)는 마이그레이션 0004에서 board_posts로 1회 이관했다.
// 예전에는 조회 때마다 되살렸으나(preserveLegacy) 그 때문에 삭제해도 다시 생겨 제거했다(요청 065).
const validResult=value=>value==='a'||value==='b';
const scheduleTools=createScheduleTools();
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
  if(d.participantIds!=null&&(!Array.isArray(d.participantIds)||(d.participantIds.length>0&&(d.participantIds.length!==d.names.length||d.participantIds.some(id=>typeof id!=='string'||!id||id.length>120)||new Set(d.participantIds).size!==d.participantIds.length))))throw Error('참가자와 회원 ID 연결을 확인해주세요.');
  if(!Number.isInteger(d.courts)||d.courts<1||d.courts>20||!Number.isInteger(d.rounds)||d.rounds<1||d.rounds>20||!Array.isArray(d.schedule)||d.schedule.length!==d.rounds)throw Error('코트와 라운드 수를 확인해주세요.');
  if(d.lateRounds!=null&&(typeof d.lateRounds!=='object'||Array.isArray(d.lateRounds)))throw Error('늦참 라운드를 확인해주세요.');
  const lateEntries=Object.entries(d.lateRounds||{}).filter(([name])=>d.names.includes(name));
  if(lateEntries.some(([,n])=>!Number.isInteger(n)||n<0||n>5))throw Error('늦참은 0~5라운드 사이로 지정해주세요.');
  const lateRounds=Object.fromEntries(lateEntries.filter(([,n])=>n>0));
  const lateRegistration=Array.isArray(d.lateRegistration)?[...new Set(d.lateRegistration.filter(n=>typeof n==='string'&&d.names.includes(n)))]:[];
  const schedule=d.schedule.map((r,i)=>{
    const available=scheduleTools.availableNames({names:d.names,lateRounds},i);
    if(!r||!Array.isArray(r.g)||(r.g.length===0&&available.length>=4)||r.g.length>100||r.g.some(m=>!Array.isArray(m)||m.length!==4||new Set(m).size!==4))throw Error('대진 구성을 확인해주세요.');
    const playing=r.g.flat();
    if(playing.some(n=>!d.names.includes(n)))throw Error('대진에 명단에 없는 참가자가 있습니다.');
    if(playing.some(n=>!available.includes(n)))throw Error((i+1)+'라운드에 아직 도착하지 않은 참가자가 있습니다.');
    const method=['same','balanced','random'].includes(r.method)?r.method:'balanced';
    return {round:i+1,method,g:r.g,rest:available.filter(n=>!playing.includes(n)),late:d.names.filter(n=>!available.includes(n))};
  });
  const base={title:title||defaultTitle(),names:d.names,participantIds:Array.isArray(d.participantIds)?d.participantIds.filter(x=>typeof x==='string').slice(0,200):[],courts:d.courts,rounds:d.rounds,schedule,lateRounds,lateRegistration,results:cleanResults(d.results,schedule),settledAt:null};
  if(Array.isArray(d.mvp))base.mvp=d.mvp.filter(x=>typeof x==='string').slice(0,50);
  if(Array.isArray(d.absent))base.absent=d.absent.filter(x=>typeof x==='string'&&d.names.includes(x)).slice(0,200);
  return base;
}
async function settleSchedule(db,id,input){
  const revision=await rosterRevision(db);
  const row=await db.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
  if(!row)return json({error:'게시글을 찾을 수 없습니다.'},404);
  const post=unpack(row);
  if(post.kind!=='schedule')return json({error:'대진표만 점수 반영할 수 있습니다.'},400);
  if(post.settledAt&&row.last_operation==='settle-'+input.operation&&row.version===input.version+1)return json({data:post});
  if(row.version!==input.version)return json({error:'최신 대진표를 다시 불러온 뒤 점수를 반영해주세요.'},409);
  if(post.settledAt)return json({data:post});
  const results=cleanResults(post.results,post.schedule);
  const isScored=ri=>post.schedule[ri]?.method!=='random';
  const absentSet=new Set(Array.isArray(post.absent)?post.absent:[]);
  const isVoid=match=>match.some(n=>absentSet.has(n));
  const missing=[];
  for(let ri=0;ri<post.schedule.length;ri++){if(!isScored(ri))continue;for(let mi=0;mi<post.schedule[ri].g.length;mi++)if(!isVoid(post.schedule[ri].g[mi])&&!validResult(results[`${ri}-${mi}`]))missing.push(`${ri+1}라운드 ${mi+1}번 대진`);}
  if(missing.length)return json({error:`승패를 모두 입력해주세요. 미입력: ${missing.join(', ')}`},400);
  const rankingRows=(await db.prepare('SELECT * FROM ranking_members WHERE hidden=0 ORDER BY rank ASC').all()).results;
  if(!rankingRows.length)return json({error:'회원 점수표를 준비하지 못했습니다.'},503);
  const byId=new Map(rankingRows.map(row=>[row.member_id,row]));
  const byName=new Map(rankingRows.map(row=>[row.name,row.member_id]));
  // 요청 068: 게스트도 정산 대상. 회원/게스트를 참가자 id(우선)나 이름으로 정확히 한쪽으로만 판정한다.
  const guestRows=(await db.prepare('SELECT * FROM guests WHERE hidden=0').all()).results;
  const gById=new Map(guestRows.map(r=>[r.guest_id,r]));
  const gByName=new Map(guestRows.map(r=>[r.name,r.guest_id]));
  const promotedById=new Map(rankingRows.filter(r=>r.promoted_guest_id).map(r=>[r.promoted_guest_id,r.member_id]));
  const deltas=new Map(),gDeltas=new Map();
  const bump=(map,keyId,field)=>{const item=map.get(keyId)||{attendance:0,wins:0,losses:0,points:0};item[field]++;item.points+=field==='wins'?1:field==='losses'?-1:1;map.set(keyId,item);};
  const resolve=(name,index)=>{const pid=Array.isArray(post.participantIds)?post.participantIds[index]:'';if(byId.has(pid))return{t:'m',id:pid};if(gById.has(pid))return{t:'g',id:pid};if(promotedById.has(pid))return{t:'m',id:promotedById.get(pid)};if(pid)return null;if(byName.has(name))return{t:'m',id:byName.get(name)};if(gByName.has(name))return{t:'g',id:gByName.get(name)};return null;};
  const whoByName=new Map(post.names.map((name,index)=>[name,resolve(name,index)]));
  const addFor=(name,field)=>{const w=whoByName.get(name);if(!w)return;bump(w.t==='m'?deltas:gDeltas,w.id,field);};
  const attended=new Set();for(const name of post.names){if(absentSet.has(name)||(Object.hasOwn(post.lateRounds||{},name)&&post.lateRounds[name]>=post.rounds))continue;const w=whoByName.get(name);if(w&&!attended.has(w.t+w.id)){attended.add(w.t+w.id);addFor(name,'attendance');}}
  const scoredPlayed=new Map(),scoredLost=new Set();
  for(let ri=0;ri<post.schedule.length;ri++){
    if(!isScored(ri))continue;
    for(let mi=0;mi<post.schedule[ri].g.length;mi++){
      const match=post.schedule[ri].g[mi],winner=results[`${ri}-${mi}`];
      if(isVoid(match))continue;
      const winners=winner==='a'?match.slice(0,2):match.slice(2,4),losers=winner==='a'?match.slice(2,4):match.slice(0,2);
      for(const name of winners)addFor(name,'wins');
      for(const name of losers)addFor(name,'losses');
      for(const name of match)scoredPlayed.set(name,(scoredPlayed.get(name)||0)+1);
      for(const name of losers)scoredLost.add(name);
    }
  }
  // MVP는 회원만(게스트 제외 — 요청 039 유지).
  const mvpNames=[...scoredPlayed.keys()].filter(name=>!scoredLost.has(name)&&whoByName.get(name)?.t==='m').sort((a,b)=>(byId.get(whoByName.get(a).id)?.rank||9999)-(byId.get(whoByName.get(b).id)?.rank||9999));
  const at=new Date().toISOString();
  const nextRows=orderRankingRows(rankingRows.map(row=>scoredState(row,deltas.get(row.member_id),at)));
  const gNext=guestRows.map(row=>scoredState(row,gDeltas.get(row.guest_id),at));
  // 요청 078: 마감해도 제목은 그대로 두고, MVP는 mvp[]로만 저장한다(화면에서 제목 아래 작게 표시).
  const nextPayload={...post,results,settledAt:at,mvp:mvpNames,title:post.title,preTitle:post.title};
  const statements=[
    db.prepare("UPDATE board_posts SET payload=?,version=version+1,last_operation=?,updated_at=? WHERE id=? AND kind='schedule' AND version=?").bind(JSON.stringify(nextPayload),'settle-'+input.operation,at,id,input.version),
    // D1 batch is transactional: a failed version claim must abort ALL scoring.
    // The NOT NULL guard fails before any points/events are written.
    db.prepare("INSERT INTO ranking_settlements (schedule_id,settled_at,operation,rank_order_before) VALUES (CASE WHEN EXISTS (SELECT 1 FROM board_posts WHERE id=? AND kind='schedule' AND version=? AND last_operation=?) THEN ? ELSE NULL END,?,?,?)").bind(id,input.version+1,'settle-'+input.operation,id,at,input.operation,JSON.stringify(rankingRows.map(r=>r.member_id)))
  ];
  const memberUpdates=nextRows.map(next=>{
    const before=byId.get(next.member_id),d=deltas.get(next.member_id);
    const movement=d&&d.wins+d.losses>0&&!next.rank_protected?before.rank-next.rank:0;
    return {...next,seed:seedForPoints(next.points),previous_rank:before.rank,previous_points:before.points,updated_at:at,rank_movement:movement};
  });
  statements.push(updateRows(db,'ranking_members','member_id',memberUpdates,['points','seed','rank','previous_rank','previous_points','attendance','wins','losses','updated_at','rank_movement','rank_protected','floor_protected_at'],['edit_version']));
  const memberEvents=[...deltas].map(([memberId,d])=>{const before=byId.get(memberId),after=nextRows.find(r=>r.member_id===memberId);return {schedule_id:id,member_id:memberId,attendance_points:d.attendance,win_points:d.wins,loss_points:d.losses,total_points:after.points-before.points,points_before:before.points,points_after:after.points,rank_before:before.rank,rank_after:after.rank,seed_before:before.seed,seed_after:after.seed,created_at:at,floor_protected_before:before.floor_protected_at};});
  statements.push(insertRows(db,'ranking_events',['schedule_id','member_id','attendance_points','win_points','loss_points','total_points','points_before','points_after','rank_before','rank_after','seed_before','seed_after','created_at','floor_protected_before'],memberEvents));
  statements.push(db.prepare('UPDATE guests SET attendance=0,wins=0,losses=0,previous_points=points,rank_protected=0,edit_version=edit_version+1 WHERE hidden=0'));
  statements.push(updateRows(db,'guests','guest_id',gNext.filter(g=>gDeltas.has(g.guest_id)).map(g=>({...g,previous_points:gById.get(g.guest_id).points})),['points','previous_points','attendance','wins','losses','rank_protected','floor_protected_at']));
  const guestEvents=[...gDeltas].map(([gid,d])=>{const before=gById.get(gid),after=gNext.find(g=>g.guest_id===gid);return {schedule_id:id,guest_id:gid,attendance_points:d.attendance,win_points:d.wins,loss_points:d.losses,total_points:after.points-before.points,points_before:before.points,points_after:after.points,created_at:at,floor_protected_before:before.floor_protected_at};});
  statements.push(insertRows(db,'guest_events',['schedule_id','guest_id','attendance_points','win_points','loss_points','total_points','points_before','points_after','created_at','floor_protected_before'],guestEvents));
  try{await commitRoster(db,revision,statements);}catch(error){
    const latest=await db.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
    if(latest&&JSON.parse(latest.payload).settledAt)return json({data:unpack(latest)});
    if(!latest||latest.version!==input.version)return json({error:'다른 기기에서 대진이 변경되었습니다. 최신 내용을 확인한 뒤 다시 마감해주세요.',conflict:true},409);
    throw error;
  }
  const saved=await db.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
  return json({data:unpack(saved)});
}
// 요청 053: 마감 취소 — 가장 최근에 마감한 대진표의 정산을 되돌린다. ranking_events의 델타를 역산해 점수·출석·승·패를 원복하고, 순위·시드를 다시 계산, settledAt·MVP 제거, 제목 복원, 정산·이벤트 기록 삭제.
async function unsettleSchedule(db,id,input={}){
  const revision=await rosterRevision(db);
  const row=await db.prepare("SELECT * FROM board_posts WHERE id=? AND kind='schedule'").bind(id).first();
  if(!row)return json({error:'대진표를 찾을 수 없습니다.'},404);
  const post=unpack(row);
  if(!post.settledAt)return json({error:'아직 마감되지 않은 대진표입니다.'},400);
  if(input.version!=null&&input.version!==row.version)return json({error:'다른 기기에서 대진이 변경되었습니다. 최신 내용을 확인한 뒤 다시 마감을 취소해주세요.',conflict:true},409);
  const latest=await db.prepare('SELECT schedule_id,rank_order_before FROM ranking_settlements ORDER BY settled_at DESC,rowid DESC LIMIT 1').first();
  if(!latest||latest.schedule_id!==id)return json({error:'가장 최근에 마감한 대진표만 마감을 취소할 수 있어요.'},409);
  const events=(await db.prepare('SELECT * FROM ranking_events WHERE schedule_id=?').bind(id).all()).results;
  const rankingRows=(await db.prepare('SELECT * FROM ranking_members WHERE hidden=0 ORDER BY rank ASC').all()).results;
  const reverted=rankingRows.map(r=>({...r}));
  const revById=new Map(reverted.map(r=>[r.member_id,r]));
  for(const ev of events){const r=revById.get(ev.member_id);if(!r)continue;r.points=Math.max(20,r.points-(Math.max(20,ev.points_after)-Math.max(20,ev.points_before)));r.attendance=Math.max(0,r.attendance-ev.attendance_points);r.wins=Math.max(0,r.wins-ev.win_points);r.losses=Math.max(0,r.losses-ev.loss_points);r.floor_protected_at=ev.floor_protected_before;r.rank=ev.rank_before;}
  // 요청 068: 게스트 정산도 되돌린다.
  const gEvents=(await db.prepare('SELECT * FROM guest_events WHERE schedule_id=?').bind(id).all()).results;
  const guestRows=(await db.prepare('SELECT * FROM guests WHERE hidden=0').all()).results;
  const gRev=new Map(guestRows.map(r=>[r.guest_id,{...r}]));
  const gTouched=new Set();
  // 이관 뒤에는 동일 인물의 정산을 현재 회원 행에서 취소한다.
  const promotedByGuest=new Map(reverted.filter(r=>r.promoted_guest_id).map(r=>[r.promoted_guest_id,r]));
  for(const ev of gEvents){const promoted=promotedByGuest.get(ev.guest_id),g=gRev.get(ev.guest_id)||promoted;if(!g)continue;g.points=Math.max(20,g.points-(Math.max(20,ev.points_after)-Math.max(20,ev.points_before)));g.attendance=Math.max(0,g.attendance-ev.attendance_points);g.wins=Math.max(0,g.wins-ev.win_points);g.losses=Math.max(0,g.losses-ev.loss_points);g.floor_protected_at=ev.floor_protected_before;if(!promoted)gTouched.add(ev.guest_id);}
  // 보호로 바뀐 20점 동점 순서까지 취소한다. 이후 추가된 회원은 같은 점수에서 뒤에 둔다.
  if(latest.rank_order_before){const prior=new Map(JSON.parse(latest.rank_order_before).map((mid,i)=>[mid,i+1]));for(const r of reverted)r.rank=prior.get(r.member_id)??prior.size+r.rank;}
  const nextRows=orderRankingRows(reverted);
  const at=new Date().toISOString();
  const nextPayload={...post,settledAt:null,mvp:[],title:post.preTitle||post.title};delete nextPayload.preTitle;
  const statements=[
    db.prepare('DELETE FROM ranking_events WHERE schedule_id=?').bind(id),
    db.prepare('DELETE FROM guest_events WHERE schedule_id=?').bind(id),
    db.prepare('DELETE FROM ranking_settlements WHERE schedule_id=?').bind(id),
    db.prepare("UPDATE board_posts SET payload=?,version=version+1,last_operation='unsettle',updated_at=? WHERE id=? AND kind='schedule'").bind(JSON.stringify(nextPayload),at,id)
  ];
  statements.push(updateRows(db,'ranking_members','member_id',nextRows.map(next=>({...next,seed:seedForPoints(next.points),previous_rank:next.rank,previous_points:next.points,updated_at:at,rank_movement:0,rank_protected:0})),['points','seed','rank','previous_rank','previous_points','attendance','wins','losses','updated_at','rank_movement','rank_protected','floor_protected_at'],['edit_version']));
  statements.push(db.prepare('UPDATE guests SET rank_protected=0,edit_version=edit_version+1 WHERE hidden=0'));
  statements.push(updateRows(db,'guests','guest_id',[...gTouched].map(gid=>{const g=gRev.get(gid);return {...g,previous_points:g.points};}),['points','previous_points','attendance','wins','losses','floor_protected_at']));
  await commitRoster(db,revision,statements);
  const saved=await db.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
  return json({data:unpack(saved)});
}
// 요청 074: 백업 스냅샷(공지·대진·시드) 생성 + 1개월 지난 백업 삭제(순차 보관).
async function createBackup(env,kind){
  // One read transaction prevents a backup mixing pre-/post-settlement tables.
  const tables=['board_posts','ranking_members','guests','ranking_settlements','ranking_events','guest_events','people_changes'];
  const [posts,members,guests,settlements,rankingEvents,guestEvents,peopleChanges]=(await env.DB.batch(tables.map(table=>env.DB.prepare('SELECT * FROM '+table)))).map(result=>result.results);
  const at=new Date().toISOString();
  const notices=posts.filter(p=>p.kind==='notice').length,schedules=posts.filter(p=>p.kind==='schedule').length;
  const data=JSON.stringify({at,kind,counts:{notices,schedules,members:members.length,guests:guests.length},posts,members,guests,settlements,rankingEvents,guestEvents,peopleChanges});
  const id='bk-'+at.replace(/[:.]/g,'-')+'-'+Math.random().toString(36).slice(2,6);
  await env.DB.prepare('INSERT INTO backups (id,created_at,kind,data) VALUES (?,?,?,?)').bind(id,at,kind,data).run();
  await env.DB.prepare('DELETE FROM backups WHERE created_at<?').bind(new Date(Date.now()-31*86400000).toISOString()).run();
  return {id,at,counts:{notices,schedules,members:members.length,guests:guests.length}};
}
function page(editor,admin){
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>콕끼리 · 콕하나로 우리끼리</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%8F%B8%3C/text%3E%3C/svg%3E"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Do+Hyeon&family=Noto+Sans+KR:wght@400;500;600;700&display=swap"><style>${css}${liveCss}</style></head><body><header><a class="brand" href="#home"><span class="brand-name">콕<span class="shuttle" aria-hidden="true">🏸</span>끼리</span><span class="tagline">콕하나로 우리끼리</span></a><span class="access">${admin?'관리자':editor?'운영진':'회원 게시판'}</span></header><main><div id="message" role="status" aria-live="polite"></div><div id="app"></div></main><footer class="days-together">콕끼리 Since 2026.05.08. 우리가 함께한지 <strong id="daysTogether">-</strong>일</footer><dialog id="picker" aria-labelledby="pickerTitle"></dialog><script>(${client.toString()})(${JSON.stringify(editor).replaceAll('<','\\u003c')},${JSON.stringify(admin).replaceAll('<','\\u003c')},${createScheduleTools.toString()},${createLiveView.toString()});</script></body></html>`;
}
export default {async fetch(request,env){
  const url=new URL(request.url),path=url.pathname,key=env.EDITOR_KEY;
  const adminKey=await adminKeyFor(env);
  const admin=Boolean(adminKey)&&path==='/administrate-'+adminKey?adminKey:'';
  const editor=admin?key||'':(Boolean(key)&&path==='/operate-'+key?key:'');
  if(path==='/api/operator-login')return operatorLogin(request,env);
  if(path==='/api/live-courts')return liveCourts(request,env);
  if(path==='/api/admin-login')return adminLogin(request,env);
  if(images[path])return new Response(Uint8Array.from(atob(images[path]),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png','cache-control':'public,max-age=86400'}});
  if(path.startsWith('/api/')){
    try{
      if(!env.DB)throw Error('Storage unavailable');
  if(path==='/api/people'&&request.method==='GET'){
    if(!env.DB)return json({error:'Storage unavailable'},503);
    const weekly=await readWeeklyResults(env.DB);
    const members=(await env.DB.prepare('SELECT member_id,name,seed,points,is_operator,edit_version FROM ranking_members WHERE hidden=0 ORDER BY rank ASC').all()).results.map(r=>({id:r.member_id,name:r.name,type:'member',seed:seedForPoints(r.points),points:r.points,is_operator:r.is_operator,edit_version:r.edit_version}));
    const guests=(await env.DB.prepare('SELECT guest_id,name,points,previous_points,attendance,wins,losses,rank_protected,floor_protected_at,edit_version FROM guests WHERE hidden=0 ORDER BY points DESC').all()).results.map(r=>weekly.guest(r)).map(r=>({id:r.guest_id,name:r.name,type:'guest',seed:seedForPoints(r.points),points:r.points,previous_points:r.previous_points,attendance:r.attendance,wins:r.wins,losses:r.losses,rank_protected:r.rank_protected,floor_protected_at:r.floor_protected_at,edit_version:r.edit_version}));
    return json({people:[...members,...guests],displaySettlementId:weekly.scheduleId});
  }
      if(path==='/api/rankings'&&request.method==='GET'){
        const weekly=await readWeeklyResults(env.DB);
        const {results}=await env.DB.prepare('SELECT member_id,name,points,seed,rank,previous_rank,previous_points,attendance,wins,losses,is_operator,updated_at,rank_movement,rank_protected,floor_protected_at,edit_version,promoted_guest_id FROM ranking_members WHERE hidden=0 ORDER BY rank ASC').all();
        const sourceDate='2026-09-10';
        const updatedDate=weekly.settledAt?new Date(weekly.settledAt).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}):sourceDate;
        return json({items:results.map(r=>weekly.member(r)),source:'콕끼리 시드 관리표.xlsx',sourceDate,updatedDate,displaySettlementId:weekly.scheduleId});
      }
      if(path==='/api/people'&&request.method==='POST'){
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 추가할 수 있습니다.'},403);
        const raw=await request.text();if(raw.length>2000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
        if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'입력 내용을 확인해주세요.'},400);
        const name=typeof input.name==='string'?input.name.trim():'',type=input.type,points=Number(input.points);
        if(!name||name.length>100)return json({error:'닉네임을 확인해주세요.'},400);
        if(type!=='member'&&type!=='guest')return json({error:'회원 또는 게스트를 선택해주세요.'},400);
        if(!Number.isInteger(points)||points<20||points>1000)return json({error:'시드 점수는 20~1000 사이 숫자로 입력해주세요.'},400);
        const revision=await rosterRevision(env.DB);
        const memberNameDup=await env.DB.prepare('SELECT member_id FROM ranking_members WHERE name=?').bind(name).first();
        const guestNameDup=await env.DB.prepare('SELECT guest_id FROM guests WHERE name=?').bind(name).first();
        if(memberNameDup||guestNameDup)return json({error:'회원 또는 게스트에 같은 이름이 이미 있어요. 다른 이름을 써주세요.'},409);
        const at=new Date().toISOString();
        if(type==='member'){
          const id='custom-m-'+crypto.randomUUID();
          await commitRoster(env.DB,revision,[
            env.DB.prepare('INSERT INTO ranking_members (member_id,name,points,seed,rank,previous_rank,previous_points,attendance,wins,losses,updated_at,hidden) VALUES (?,?,?,?,?,?,?,0,0,0,?,0)').bind(id,name,points,seedForPoints(points),999999,999999,points,at),
            env.DB.prepare('INSERT INTO people_changes (id,person_type,person_id,action,before_name,after_name,before_points,after_points,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind('pc-'+crypto.randomUUID(),'member',id,'create',null,name,null,points,'운영진이 새 회원을 추가함',at)
          ],[{member_id:id,name,points,rank:999999}]);
          return json({data:{id,name,type,points,seed:seedForPoints(points)}});
        }
        const gid='custom-g-'+crypto.randomUUID();
        await commitRoster(env.DB,revision,[
          env.DB.prepare('INSERT INTO guests (guest_id,name,points,previous_points,attendance,wins,losses,hidden,created_at) VALUES (?,?,?,?,0,0,0,0,?)').bind(gid,name,points,points,at),
          env.DB.prepare('INSERT INTO people_changes (id,person_type,person_id,action,before_name,after_name,before_points,after_points,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind('pc-'+crypto.randomUUID(),'guest',gid,'create',null,name,null,points,'운영진이 새 게스트를 추가함',at)
        ]);
        return json({data:{id:gid,name,type,points,seed:seedForPoints(points)}});
      }
      if(path==='/api/people/update'&&request.method==='POST'){
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 정보를 수정할 수 있습니다.'},403);
        const raw=await request.text();if(raw.length>4000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
        if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'입력 내용을 확인해주세요.'},400);
        const id=String(input.id||''),type=input.type,name=typeof input.name==='string'?input.name.trim():'',reason=typeof input.reason==='string'?input.reason.trim():'';
        const points=Number(input.points),expectedVersion=Number(input.expectedVersion);
        if(!/^[A-Za-z0-9-]{1,120}$/.test(id)||!['member','guest'].includes(type))return json({error:'수정 대상을 확인해주세요.'},400);
        if(!name||name.length>100)return json({error:'닉네임을 확인해주세요.'},400);
        if(!Number.isInteger(points)||points<20||points>1000)return json({error:'시드 점수는 20~1000 사이 숫자로 입력해주세요.'},400);
        if(!Number.isInteger(expectedVersion)||expectedVersion<1)return json({error:'최신 정보를 다시 불러와주세요.'},400);
        if(!reason||reason.length>300)return json({error:'수정 사유를 1~300자로 입력해주세요.'},400);
        const revision=await rosterRevision(env.DB);
        const current=type==='member'
          ?await env.DB.prepare('SELECT member_id AS person_id,name,points,edit_version,promoted_guest_id FROM ranking_members WHERE member_id=? AND hidden=0').bind(id).first()
          :await env.DB.prepare('SELECT guest_id AS person_id,name,points,edit_version FROM guests WHERE guest_id=? AND hidden=0').bind(id).first();
        if(!current)return json({error:'수정할 사람을 찾지 못했습니다. 목록을 새로고침해주세요.'},404);
        if(current.edit_version!==expectedVersion)return json({error:'다른 운영진이 먼저 수정했습니다. 목록을 새로고침한 뒤 다시 시도해주세요.',conflict:true},409);
        const memberDup=await env.DB.prepare('SELECT member_id FROM ranking_members WHERE name=? AND member_id<>?').bind(name,type==='member'?id:'').first();
        const guestDup=await env.DB.prepare('SELECT guest_id FROM guests WHERE name=? AND guest_id<>?').bind(name,type==='guest'?id:(current.promoted_guest_id||'')).first();
        if(memberDup||guestDup)return json({error:'회원 또는 게스트에 같은 이름이 이미 있어요. 다른 이름을 써주세요.'},409);
        const at=new Date().toISOString(),pointsChanged=points!==current.points;
        const updateSql=type==='member'
          ?'UPDATE ranking_members SET name=?,points=?,seed=?,previous_points=CASE WHEN ? THEN ? ELSE previous_points END,rank_movement=CASE WHEN ? THEN 0 ELSE rank_movement END,rank_protected=CASE WHEN ? THEN 0 ELSE rank_protected END,floor_protected_at=CASE WHEN ? THEN NULL ELSE floor_protected_at END,edit_version=edit_version+1,updated_at=? WHERE member_id=? AND hidden=0 AND edit_version=?'
          :'UPDATE guests SET name=?,points=?,previous_points=CASE WHEN ? THEN ? ELSE previous_points END,rank_protected=CASE WHEN ? THEN 0 ELSE rank_protected END,floor_protected_at=CASE WHEN ? THEN NULL ELSE floor_protected_at END,edit_version=edit_version+1 WHERE guest_id=? AND hidden=0 AND edit_version=?';
        const updateStatement=type==='member'
          ?env.DB.prepare(updateSql).bind(name,points,seedForPoints(points),pointsChanged?1:0,points,pointsChanged?1:0,pointsChanged?1:0,pointsChanged?1:0,at,id,expectedVersion)
          :env.DB.prepare(updateSql).bind(name,points,pointsChanged?1:0,points,pointsChanged?1:0,pointsChanged?1:0,id,expectedVersion);
        const history=env.DB.prepare('INSERT INTO people_changes (id,person_type,person_id,action,before_name,after_name,before_points,after_points,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind('pc-'+crypto.randomUUID(),type,id,'update',current.name,name,current.points,points,reason,at);
        await commitRoster(env.DB,revision,[updateStatement,history],type==='member'?[{member_id:id,name,points,...(pointsChanged?{floor_protected_at:null}:{})}]:null);
        return json({data:{id,type,name,points,seed:seedForPoints(points),edit_version:expectedVersion+1}});
      }
      if(path==='/api/people/history'&&request.method==='GET'){
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 변경 이력을 볼 수 있습니다.'},403);
        const type=url.searchParams.get('type'),id=url.searchParams.get('id')||'';
        if(!['member','guest'].includes(type)||!/^[A-Za-z0-9-]{1,120}$/.test(id))return json({error:'조회 대상을 확인해주세요.'},400);
        let guestId='';
        if(type==='member')guestId=(await env.DB.prepare('SELECT promoted_guest_id FROM ranking_members WHERE member_id=?').bind(id).first())?.promoted_guest_id||'';
        const rows=type==='member'&&guestId
          ?(await env.DB.prepare("SELECT id,person_type,person_id,action,before_name,after_name,before_points,after_points,reason,created_at FROM people_changes WHERE (person_type='member' AND person_id=?) OR (person_type='guest' AND person_id=?) ORDER BY created_at DESC LIMIT 50").bind(id,guestId).all()).results
          :(await env.DB.prepare('SELECT id,person_type,person_id,action,before_name,after_name,before_points,after_points,reason,created_at FROM people_changes WHERE person_type=? AND person_id=? ORDER BY created_at DESC LIMIT 50').bind(type,id).all()).results;
        return json({items:rows});
      }
      if(path==='/api/people/hide'&&request.method==='POST'){
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 삭제할 수 있습니다.'},403);
        const raw=await request.text();if(raw.length>8000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
        if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'입력 내용을 확인해주세요.'},400);
        const ids=Array.isArray(input.ids)?[...new Set(input.ids.filter(x=>typeof x==='string'&&x.length<=100))].slice(0,300):[];
        if(!ids.length)return json({error:'삭제할 사람을 선택해주세요.'},400);
        const revision=await rosterRevision(env.DB),at=new Date().toISOString(),encodedIds=JSON.stringify(ids);
        const removedMembers=(await env.DB.prepare('SELECT member_id AS id,name,points FROM ranking_members WHERE hidden=0 AND member_id IN (SELECT value FROM json_each(?))').bind(encodedIds).all()).results;
        const removedGuests=(await env.DB.prepare('SELECT guest_id AS id,name,points FROM guests WHERE hidden=0 AND guest_id IN (SELECT value FROM json_each(?))').bind(encodedIds).all()).results;
        const histories=[...removedMembers.map(p=>({...p,type:'member'})),...removedGuests.map(p=>({...p,type:'guest'}))].map(p=>({id:'pc-'+crypto.randomUUID(),person_type:p.type,person_id:p.id,action:'hide',before_name:p.name,after_name:p.name,before_points:p.points,after_points:p.points,reason:'운영진이 명단에서 숨김',created_at:at}));
        const stmts=[env.DB.prepare('UPDATE ranking_members SET hidden=1,updated_at=?,edit_version=edit_version+1 WHERE hidden=0 AND member_id IN (SELECT value FROM json_each(?))').bind(at,encodedIds),env.DB.prepare('UPDATE guests SET hidden=1,edit_version=edit_version+1 WHERE hidden=0 AND guest_id IN (SELECT value FROM json_each(?))').bind(encodedIds),insertRows(env.DB,'people_changes',['id','person_type','person_id','action','before_name','after_name','before_points','after_points','reason','created_at'],histories)];
        await commitRoster(env.DB,revision,stmts,ids.map(member_id=>({member_id,hidden:1})));
        return json({data:{hidden:removedMembers.length+removedGuests.length}});
      }
      if(path==='/api/people/promote'&&request.method==='POST'){
        // 요청 069: 게스트를 회원으로 이관(점수·출석·승·패 그대로 옮김).
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 이관할 수 있습니다.'},403);
        const raw=await request.text();if(raw.length>8000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
        if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'입력 내용을 확인해주세요.'},400);
        const ids=Array.isArray(input.ids)?[...new Set(input.ids.filter(x=>typeof x==='string'&&x.length<=100))].slice(0,300):[];
        if(!ids.length)return json({error:'이관할 게스트를 선택해주세요.'},400);
        const revision=await rosterRevision(env.DB);
        const chosen=(await env.DB.prepare('SELECT * FROM guests WHERE hidden=0').all()).results.filter(g=>ids.includes(g.guest_id));
        if(!chosen.length)return json({error:'이관할 게스트를 찾지 못했습니다.'},404);
        const memberNames=new Set((await env.DB.prepare('SELECT name FROM ranking_members').all()).results.map(r=>r.name));
        for(const g of chosen){if(memberNames.has(g.name))return json({error:`이미 회원에 같은 이름(${g.name})이 있어요. 이름을 바꾼 뒤 이관해주세요.`},409);memberNames.add(g.name);}
        const at=new Date().toISOString(),memberChanges=chosen.map(g=>({member_id:'custom-m-'+crypto.randomUUID(),name:g.name,points:g.points,seed:seedForPoints(g.points),rank:999999,previous_rank:999999,previous_points:g.previous_points,attendance:g.attendance,wins:g.wins,losses:g.losses,updated_at:at,hidden:0,rank_protected:g.rank_protected,floor_protected_at:g.floor_protected_at,promoted_guest_id:g.guest_id}));
        const histories=chosen.map(g=>({id:'pc-'+crypto.randomUUID(),person_type:'guest',person_id:g.guest_id,action:'promote',before_name:g.name,after_name:g.name,before_points:g.points,after_points:g.points,reason:'운영진이 게스트를 회원으로 이관함',created_at:at}));
        const stmts=[insertRows(env.DB,'ranking_members',['member_id','name','points','seed','rank','previous_rank','previous_points','attendance','wins','losses','updated_at','hidden','rank_protected','floor_protected_at','promoted_guest_id'],memberChanges),env.DB.prepare('UPDATE guests SET hidden=1,edit_version=edit_version+1 WHERE guest_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(chosen.map(g=>g.guest_id))),insertRows(env.DB,'people_changes',['id','person_type','person_id','action','before_name','after_name','before_points','after_points','reason','created_at'],histories)];
        await commitRoster(env.DB,revision,stmts,memberChanges);
        return json({data:{promoted:chosen.length}});
      }
      // 요청 073: 관리자 — 운영진 임명/해제(왕관). 관리자 헤더(x-kokkiri-admin) 필요.
      if(path==='/api/operator-role'&&request.method==='POST'){
        if(!adminKey||request.headers.get('x-kokkiri-admin')!==adminKey)return json({error:'홈페이지 관리자만 변경할 수 있습니다.'},403);
        const raw=await request.text();if(raw.length>2000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
        if(!input||typeof input!=='object'||Array.isArray(input)||![true,false,0,1].includes(input.on))return json({error:'대상을 확인해주세요.'},400);
        const memberId=String(input.memberId||''),on=input.on?1:0;
        if(!memberId)return json({error:'대상을 확인해주세요.'},400);
        const r=await env.DB.prepare('UPDATE ranking_members SET is_operator=? WHERE member_id=? AND hidden=0').bind(on,memberId).run();
        if(!r.meta.changes)return json({error:'대상 회원을 찾지 못했습니다.'},404);
        return json({data:{memberId,is_operator:on}});
      }
      // 요청 074: 관리자 — 백업 목록/생성/다운로드.
      if(path==='/api/backups'&&request.method==='GET'){
        if(!adminKey||request.headers.get('x-kokkiri-admin')!==adminKey)return json({error:'홈페이지 관리자만 볼 수 있습니다.'},403);
        const {results}=await env.DB.prepare('SELECT id,created_at,kind,length(data) AS size FROM backups ORDER BY created_at DESC LIMIT 60').all();
        return json({items:results});
      }
      if(path==='/api/backups'&&request.method==='POST'){
        if(!adminKey||request.headers.get('x-kokkiri-admin')!==adminKey)return json({error:'홈페이지 관리자만 백업할 수 있습니다.'},403);
        return json({data:await createBackup(env,'manual')});
      }
      const bmatch=path.match(/^\/api\/backups\/([A-Za-z0-9-]{1,120})$/);
      if(bmatch&&request.method==='GET'){
        if(!adminKey||request.headers.get('x-kokkiri-admin')!==adminKey)return json({error:'홈페이지 관리자만 받을 수 있습니다.'},403);
        const row=await env.DB.prepare('SELECT data FROM backups WHERE id=?').bind(bmatch[1]).first();
        if(!row)return json({error:'백업을 찾을 수 없습니다.'},404);
        return new Response(row.data,{status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-disposition':'attachment; filename="'+bmatch[1]+'.json"'}});
      }
      if(path==='/api/mvp'&&request.method==='GET'){
        const last=await env.DB.prepare('SELECT schedule_id,settled_at FROM ranking_settlements ORDER BY settled_at DESC,rowid DESC LIMIT 1').first();
        if(!last)return json({mvp:[]});
        const row=await env.DB.prepare("SELECT payload FROM board_posts WHERE id=? AND kind='schedule'").bind(last.schedule_id).first();
        if(!row)return json({mvp:[]});
        const p=JSON.parse(row.payload);
        return json({mvp:Array.isArray(p.mvp)?p.mvp:[],id:last.schedule_id,settledAt:last.settled_at});
      }
      const settleMatch=path.match(/^\/api\/posts\/([a-zA-Z0-9-]{1,80})\/settle$/);
      if(settleMatch){
        if(request.method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405);
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 점수를 반영할 수 있습니다.'},403);
        const raw=await request.text();if(raw.length>4000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);if(!Number.isInteger(input.version)||input.version<1||typeof input.operation!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(input.operation))throw Error('점수 반영 요청을 확인해주세요.');}catch(e){return json({error:e.message||'입력 내용을 확인해주세요.'},400);}
        return await settleSchedule(env.DB,settleMatch[1],input);
      }
      const unsettleMatch=path.match(/^\/api\/posts\/([a-zA-Z0-9-]{1,80})\/unsettle$/);
      if(unsettleMatch){
        if(request.method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405);
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 마감을 취소할 수 있습니다.'},403);
        const raw=await request.text();if(raw.length>2000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=raw?JSON.parse(raw):{};if(!input||typeof input!=='object'||Array.isArray(input)||(input.version!=null&&(!Number.isInteger(input.version)||input.version<1)))throw Error();}catch{return json({error:'마감 취소 요청을 확인해주세요.'},400);}
        return await unsettleSchedule(env.DB,unsettleMatch[1],input);
      }
      const progressMatch=path.match(/^\/api\/posts\/([a-zA-Z0-9-]{1,80})\/progress$/);
      if(progressMatch){
        if(request.method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405);
        const raw=await request.text();if(raw.length>2000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
        if(!input||typeof input.key!=='string'||!/^(0|[1-9]\d{0,2})-(0|[1-9]\d{0,2})$/.test(input.key)||!['waiting','playing','finished'].includes(input.state)||!Number.isInteger(input.version)||input.version<1)return json({error:'대진 진행 정보를 확인해주세요.'},400);
        const row=await env.DB.prepare("SELECT * FROM board_posts WHERE id=? AND kind='schedule'").bind(progressMatch[1]).first();
        if(!row)return json({error:'대진표를 찾을 수 없습니다.'},404);
        const post=unpack(row),[ri,mi]=input.key.split('-').map(Number),round=post.schedule[ri],match=round?.g?.[mi];
        if(post.settledAt)return json({error:'마감된 대진의 진행 상태는 바꿀 수 없습니다.'},409);
        if(row.version!==input.version)return json({error:'다른 기기에서 먼저 기록했어요. 최신 대진을 확인한 뒤 다시 눌러주세요.',conflict:true},409);
        if(!Array.isArray(match)||match.length!==4)return json({error:'없는 경기입니다.'},400);
        const state=scheduleTools.matchState(post,ri,mi);
        if(state==='void')return json({error:'무효 경기의 진행 상태는 바꿀 수 없습니다.'},400);
        if(validResult(post.results?.[input.key]))return json({error:'승패가 기록된 경기는 대진종료 상태입니다.'},409);
        if(input.state==='finished'&&round.method!=='random')return json({error:'이긴 팀의 승 버튼으로 대진을 종료해주세요.'},400);
        if(input.state==='finished'&&state==='waiting')return json({error:'대진을 시작한 뒤 종료해주세요.'},400);
        if(input.state===state)return json({data:{key:input.key,state,version:row.version}});
        const matchProgress=scheduleTools.cleanProgress(post);
        if(input.state==='waiting')delete matchProgress[input.key];else matchProgress[input.key]=input.state;
        const merged={...post,matchProgress},at=new Date().toISOString();
        const updated=await env.DB.prepare("UPDATE board_posts SET payload=?,version=version+1,updated_at=? WHERE id=? AND kind='schedule' AND version=?").bind(JSON.stringify(merged),at,progressMatch[1],input.version).run();
        if(!updated.meta.changes)return json({error:'다른 기기에서 먼저 기록했어요. 최신 대진을 확인한 뒤 다시 눌러주세요.',conflict:true},409);
        return json({data:{key:input.key,state:input.state,version:row.version+1}});
      }
      const resultMatch=path.match(/^\/api\/posts\/([a-zA-Z0-9-]{1,80})\/result$/);
      if(resultMatch){
        if(request.method!=='POST')return json({error:'허용되지 않은 요청입니다.'},405);
        const raw=await request.text();if(raw.length>2000)return json({error:'입력 내용을 확인해주세요.'},413);
        let input;try{input=JSON.parse(raw);}catch{return json({error:'입력 내용을 확인해주세요.'},400);}
        if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'승패 정보를 확인해주세요.'},400);
        const rkey=String(input.key||''),winner=input.winner;
        if(!/^(0|[1-9]\d{0,2})-(0|[1-9]\d{0,2})$/.test(rkey)||!validResult(winner))return json({error:'승패 정보를 확인해주세요.'},400);
        const row=await env.DB.prepare("SELECT * FROM board_posts WHERE id=? AND kind='schedule'").bind(resultMatch[1]).first();
        if(!row)return json({error:'대진표를 찾을 수 없습니다.'},404);
        const post=unpack(row);
        if(post.settledAt)return json({error:'이미 점수가 반영된 대진표는 변경할 수 없습니다.'},409);
        const ri=Number(rkey.split('-')[0]),mi=Number(rkey.split('-')[1]),round=post.schedule[ri];
        if(!round||!Array.isArray(round.g?.[mi])||round.g[mi].length!==4)return json({error:'없는 경기입니다.'},400);
        if(round.method==='random')return json({error:'랜덤 경기는 승패를 기록하지 않습니다.'},400);
        if(Array.isArray(post.absent)&&round.g[mi].some(n=>post.absent.includes(n)))return json({error:'불참자가 있는 무효 경기는 승패를 기록하지 않습니다.'},400);
        const merged={...post,results:{...(post.results||{}),[rkey]:winner}};
        merged.matchProgress=scheduleTools.cleanProgress(merged);
        const at=new Date().toISOString();
        const upd=await env.DB.prepare("UPDATE board_posts SET payload=?,version=version+1,updated_at=? WHERE id=? AND kind='schedule' AND version=?").bind(JSON.stringify(merged),at,resultMatch[1],row.version).run();
        if(!upd.meta.changes)return json({error:'다른 기기에서 먼저 기록했어요. 잠시 후 다시 눌러주세요.',conflict:true},409);
        return json({data:{key:rkey,winner,version:row.version+1}});
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
        const offset=Math.max(0,Math.min(1000000,Math.floor(Number(url.searchParams.get('offset')))||0));
        const {results}=await env.DB.prepare('SELECT id,kind,COALESCE(json_extract(payload,\'$.preTitle\'),json_extract(payload,\'$.title\')) AS title,json_extract(payload,\'$.settledAt\') AS settledAt,json_extract(payload,\'$.mvp\') AS mvp_json,created_at,updated_at,version FROM board_posts WHERE kind=? ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?').bind(kind,offset).all();
        const items=results.slice(0,30).map(({mvp_json,...post})=>{
          const mvp=mvp_json?JSON.parse(mvp_json):[];
          return {...post,mvp:Array.isArray(mvp)?mvp:[]};
        });
        return json({items,hasMore:results.length>30});
      }
      const match=path.match(/^\/api\/posts\/([a-zA-Z0-9-]{1,80})$/);
      if(!match)return json({error:'찾을 수 없는 요청입니다.'},404);
      const id=match[1];
      if(request.method==='GET'){
        const row=await env.DB.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
        return row?json({data:unpack(row)}):json({error:'게시글을 찾을 수 없습니다.'},404);
      }
      if(request.method==='DELETE'){
        if(!key||request.headers.get('x-kokkiri-editor')!==key)return json({error:'운영진만 삭제할 수 있습니다.'},403);
        const existing=await env.DB.prepare('SELECT payload,kind,version FROM board_posts WHERE id=?').bind(id).first();
        if(!existing)return json({error:'삭제할 게시글이 없습니다.'},404);
        if(existing.kind==='schedule'&&JSON.parse(existing.payload).settledAt)return json({error:'이미 점수가 반영된 대진표는 삭제할 수 없습니다.'},409);
        const deleted=await env.DB.prepare('DELETE FROM board_posts WHERE id=? AND version=?').bind(id,existing.version).run();
        if(!deleted.meta.changes)return json({error:'다른 기기에서 게시글이 변경되었습니다. 최신 내용을 확인한 뒤 다시 삭제해주세요.',conflict:true},409);
        return json({data:{deleted:true}});
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
      if(input.kind==='schedule')payload.matchProgress={};
      if(input.kind==='schedule'&&input.version>0){
        const existing=await env.DB.prepare('SELECT payload FROM board_posts WHERE id=? AND kind=\'schedule\'').bind(id).first();
        if(existing&&JSON.parse(existing.payload).settledAt)return json({error:'이미 점수가 반영된 대진표는 변경할 수 없습니다.'},409);
        if(existing){
          const previous=JSON.parse(existing.payload);
          // A saved edit may retain progress only for the exact same game.
          // Ignore incoming progress from stale tabs or copied schedules.
          const progress=scheduleTools.cleanProgress({...payload,matchProgress:previous.matchProgress});
          for(const [pkey,state] of Object.entries(progress)){
            const [ri,mi]=pkey.split('-').map(Number);
            if(previous.schedule[ri]?.method===payload.schedule[ri]?.method&&JSON.stringify(previous.schedule[ri]?.g?.[mi])===JSON.stringify(payload.schedule[ri]?.g?.[mi]))payload.matchProgress[pkey]=state;
          }
        }
      }
      const at=new Date().toISOString();
      const result=input.version===0
        ?await env.DB.prepare('INSERT OR IGNORE INTO board_posts (id,kind,payload,version,last_operation,created_at,updated_at) VALUES (?,?,?,1,?,?,?)').bind(id,input.kind,JSON.stringify(payload),input.operation,at,at).run()
        :await env.DB.prepare('UPDATE board_posts SET payload=?,version=version+1,last_operation=?,updated_at=? WHERE id=? AND kind=? AND version=?').bind(JSON.stringify(payload),input.operation,at,id,input.kind,input.version).run();
      // Draft creation/editing never clears the latest confirmed weekly results.
      const row=await env.DB.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first();
      if(!row)return json({error:'수정할 게시글이 없습니다.'},404);
      if(!result.meta.changes&&row.last_operation!==input.operation)return json({error:'다른 운영진이 먼저 수정했습니다. 입력 내용은 유지됩니다. 새 탭에서 최신 글을 확인한 뒤 다시 수정해주세요.'},409);
      return json({data:unpack(row)});
    }catch(error){if(error?.conflict)return json({error:error.message,conflict:true},409);console.error('Board request failed',error);return json({error:'저장소에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'},503);}
  }
  if(path!=='/'&&!editor&&!admin)return new Response('페이지를 찾을 수 없습니다.',{status:404});
  return new Response(page(editor,admin),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'}});
},async scheduled(event,env,ctx){
  // 요청 074: 주간 자동 백업(Cron). 1개월 지난 백업은 createBackup 안에서 삭제.
  try{if(env.DB)await createBackup(env,'auto');}catch(e){console.error('scheduled backup failed',e);}
}};
