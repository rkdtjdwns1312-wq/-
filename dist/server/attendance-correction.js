import { attendancePolicy } from './attendance-policy.js';
import { orderRankingRows,seedForPoints } from './rankings.js';
import { commitRoster,updateRows,insertRows } from './roster-write.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const tables=['board_posts','ranking_members','guests','ranking_settlements','ranking_events','guest_events','people_changes','score_point_history','roster_write_revision'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const ensure=(condition,message)=>{if(!condition)throw Object.assign(Error(message),{review:true});};
const key=(type,id)=>type+':'+id;
const changed=(a,b,fields)=>fields.some(f=>a[f]!==b[f]);
const eventFields=['attendance_points','total_points','points_before','points_after','floor_protected_before'];
const memberEventFields=[...eventFields,'rank_before','rank_after','seed_before','seed_after'];

export async function attendanceSnapshot(db){
  const result=await db.batch(tables.map(t=>db.prepare('SELECT rowid AS rowid,* FROM '+t+' ORDER BY rowid')));
  return Object.fromEntries(tables.map((t,i)=>[t,result[i].results]));
}
export async function attendanceFingerprint(snapshot){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))))].map(b=>b.toString(16).padStart(2,'0')).join('');
}

// A preview is pure: replay only affected people, retaining absolute manual edits.
// Incomplete or discontinuous history blocks the write instead of guessing a debit.
export function planAttendanceCorrection(snapshot){
  const s=structuredClone(snapshot),posts=new Map(s.board_posts.map(p=>[p.id,p]));
  const settlements=[...s.ranking_settlements].sort((a,b)=>a.settled_at.localeCompare(b.settled_at)||a.rowid-b.rowid);
  const settlementById=new Map(settlements.map(x=>[x.schedule_id,x]));
  const candidates=[];
  for(const settlement of settlements){
    const row=posts.get(settlement.schedule_id);ensure(row,'정산 게시글이 없어 자동 정정을 중단했습니다.');
    const post=JSON.parse(row.payload),policy=attendancePolicy(post);
    if(policy.eligible)continue;
    const events=[...s.ranking_events,...s.guest_events].filter(e=>e.schedule_id===row.id&&e.attendance_points>0);
    if(!events.length)continue;
    ensure(post.settledAt&&post.settlementMode!=='unscored','마감 상태와 정산 이력이 달라 확인이 필요합니다.');
    candidates.push({id:row.id,title:post.preTitle||post.title,version:row.version,settledAt:settlement.settled_at,participantCount:policy.participantCount,randomOnly:policy.randomOnly,attendanceCredits:events.reduce((n,e)=>n+e.attendance_points,0)});
  }
  if(!candidates.length)return {candidates:[],people:[],credits:0,pointsRemoved:0,updates:null};
  const candidateIds=new Set(candidates.map(c=>c.id)),first=candidates[0].settledAt;
  const members=new Map(s.ranking_members.map(r=>[r.member_id,r]));
  const promoted=new Map(s.ranking_members.filter(r=>r.promoted_guest_id).map(r=>[r.promoted_guest_id,r.member_id]));
  const canonical=(type,id)=>type==='guest'&&promoted.has(id)?key('member',promoted.get(id)):key(type,id);
  const current=new Map([...s.ranking_members.map(r=>[key('member',r.member_id),r]),...s.guests.filter(r=>!promoted.has(r.guest_id)).map(r=>[key('guest',r.guest_id),r])]);
  const timelines=new Map([...current.keys()].map(k=>[k,[]]));
  const add=(k,step)=>{ensure(timelines.has(k),'정산 대상 회원을 찾을 수 없어 정정을 중단했습니다.');timelines.get(k).push(step);};
  for(const [type,list] of [['member',s.ranking_events],['guest',s.guest_events]])for(const e of list){
    const settlement=settlementById.get(e.schedule_id);ensure(settlement,'연결되지 않은 정산 이력을 확인해주세요.');
    add(canonical(type,e[type+'_id']),{kind:'event',at:settlement.settled_at,order:settlement.rowid,type,event:e,before:e.points_before,after:e.points_after,floorBefore:e.floor_protected_before??null});
  }
  for(const e of s.people_changes){
    if(e.action!=='update'||e.before_points===e.after_points||e.before_points==null||e.after_points==null)continue;
    if(String(e.id).startsWith('attendance-fix-'))continue;
    add(canonical(e.person_type,e.person_id),{kind:'manual',at:e.created_at,order:e.rowid-1000000000,before:e.before_points,after:e.after_points,floorBefore:null});
  }
  const people=[];
  for(const [k,steps] of timelines){
    steps.sort((a,b)=>a.at.localeCompare(b.at)||a.order-b.order);
    let priorFloor=null;
    for(const step of steps){
      if(step.kind==='manual'){step.floorBefore=priorFloor;step.floorAfter=null;}
      else {const e=step.event;step.floorAfter=step.after>20?null:e.win_points+e.loss_points>0&&step.before+e.attendance_points+e.win_points-e.loss_points<=20?step.at:step.floorBefore;}
      priorFloor=step.floorAfter;
    }
    const start=steps.findIndex(t=>t.kind==='event'&&candidateIds.has(t.event.schedule_id)&&t.event.attendance_points>0);
    if(start<0)continue;
    let oldPoints=steps[start].before,points=oldPoints,floor=steps[start].floorBefore,removed=0;
    for(let i=start;i<steps.length;i++){
      const step=steps[i];ensure(step.before===oldPoints,'점수 이력 사이에 설명되지 않은 변경이 있어 자동 차감을 중단했습니다: '+current.get(k).name);
      if(i>start)ensure(step.at!==steps[i-1].at||step.kind===steps[i-1].kind,'동일 시각 수동 수정과 마감의 순서를 확인해주세요.');
      step.correctedBefore=points;step.correctedFloorBefore=floor;
      if(step.kind==='manual'){points=step.after;floor=null;}
      else{
        const e=step.event,attendance=candidateIds.has(e.schedule_id)?0:e.attendance_points;
        ensure([e.attendance_points,e.win_points,e.loss_points,e.points_before,e.points_after].every(Number.isInteger),'정산 숫자 형식을 확인해주세요.');
        ensure(e.attendance_points>=0&&e.attendance_points<=1&&e.win_points>=0&&e.loss_points>=0,'정산 출석/승패 범위를 확인해주세요.');
        ensure(Math.max(20,step.before+e.attendance_points+e.win_points-e.loss_points)===step.after,'기존 정산 계산이 맞지 않아 확인이 필요합니다: '+current.get(k).name);
        removed+=e.attendance_points-attendance;
        const raw=points+attendance+e.win_points-e.loss_points;
        points=Math.max(20,raw);
        floor=points>20?null:e.win_points+e.loss_points>0&&raw<=20?step.at:floor;
        Object.assign(e,{attendance_points:attendance,points_before:step.correctedBefore,points_after:points,total_points:points-step.correctedBefore,floor_protected_before:step.correctedFloorBefore});
        if(step.type==='member'){e.seed_before=seedForPoints(e.points_before);e.seed_after=seedForPoints(e.points_after);}
      }
      step.correctedAfter=points;step.correctedFloorAfter=floor;oldPoints=step.after;
    }
    const row=current.get(k);ensure(oldPoints===row.points,'현재 점수와 마지막 이력이 달라 자동 차감을 중단했습니다: '+row.name);
    ensure(points<=row.points&&points>=20,'차감 결과의 안전 범위를 확인해주세요.');
    people.push({type:k.startsWith('member:')?'member':'guest',id:row.member_id||row.guest_id,name:row.name,before:row.points,after:points,attendanceCredits:removed,pointsRemoved:row.points-points,hidden:Boolean(row.hidden)});
    row.points=points;row.floor_protected_at=floor;
  }
  const valueAt=(k,at,order,after=false)=>{
    const steps=timelines.get(k)||[],future=steps.find(t=>t.at>at||(t.at===at&&(t.order>order||(!after&&t.order===order))));
    const past=steps.filter(t=>t.at<at||(t.at===at&&(t.order<order||(after&&t.order===order)))).at(-1);
    const row=current.get(k);ensure(row,'과거 순위 명단의 회원을 찾지 못했습니다.');
    const floor=past?(past.correctedFloorAfter!==undefined?past.correctedFloorAfter:past.floorAfter):future?(future.correctedFloorBefore!==undefined?future.correctedFloorBefore:future.floorBefore):row.floor_protected_at;
    return {points:future?(future.correctedBefore??future.before):row.points,floor_protected_at:floor};
  };
  // Rebuild only the corrected suffix's historical ranks, using each settlement's
  // recorded membership/order. This keeps later undo and weekly arrows consistent.
  let previousOrder=null;
  const manualSteps=[...timelines.values()].flat().filter(t=>t.kind==='manual'&&t.at>=first);
  for(const t of manualSteps)ensure(!settlements.some(s=>s.settled_at===t.at),'동일 시각 수동 변경과 정산의 순서를 확인해주세요.');
  const rankSteps=[...settlements.filter(x=>x.settled_at>=first).map(s=>({kind:'settlement',at:s.settled_at,order:s.rowid,settlement:s})),...manualSteps].sort((a,b)=>a.at.localeCompare(b.at)||a.order-b.order);
  for(const step of rankSteps){
    if(step.kind==='manual'){
      if(previousOrder)previousOrder=orderRankingRows(previousOrder.map((id,i)=>({...members.get(id),...valueAt(key('member',id),step.at,step.order,true),rank:i+1}))).map(r=>r.member_id);
      continue;
    }
    const settlement=step.settlement;
    const ids=JSON.parse(settlement.rank_order_before||'[]');ensure(ids.length&&new Set(ids).size===ids.length,'과거 순위 기준이 없어 정정을 중단했습니다.');
    const prior=new Map((previousOrder||ids).map((id,i)=>[id,i+1]));
    const before=orderRankingRows(ids.map((id,i)=>{const r=members.get(id);ensure(r,'과거 회원 명단을 확인해주세요.');return {...r,...valueAt(key('member',id),settlement.settled_at,settlement.rowid),rank:prior.get(id)??ids.length+i+1};}));
    const after=orderRankingRows(before.map(r=>({...r,...valueAt(key('member',r.member_id),settlement.settled_at,settlement.rowid,true)})));
    const rb=new Map(before.map(r=>[r.member_id,r.rank])),ra=new Map(after.map(r=>[r.member_id,r.rank]));
    settlement.rank_order_before=JSON.stringify(before.map(r=>r.member_id));previousOrder=after.map(r=>r.member_id);
    for(const e of s.ranking_events.filter(e=>e.schedule_id===settlement.schedule_id)){ensure(rb.has(e.member_id),'정산 회원의 과거 순위를 확인해주세요.');e.rank_before=rb.get(e.member_id);e.rank_after=ra.get(e.member_id);}
  }
  const latest=settlements.at(-1),lastRanks=new Map((previousOrder||[]).map((id,i)=>[id,i+1]));
  const latestMembers=new Map(s.ranking_events.filter(e=>e.schedule_id===latest.schedule_id).map(e=>[e.member_id,e]));
  const latestGuests=new Map(s.guest_events.filter(e=>e.schedule_id===latest.schedule_id).map(e=>[e.guest_id,e]));
  const manualAfter=new Set(s.people_changes.filter(e=>e.action==='update'&&!String(e.id).startsWith('attendance-fix-')&&e.before_points!==e.after_points&&e.created_at>=latest.settled_at).map(e=>canonical(e.person_type,e.person_id)));
  const refreshed=row=>{
    const type=row.member_id?'member':'guest',id=row.member_id||row.guest_id,k=key(type,id);
    const e=type==='member'?(latestMembers.get(id)||latestGuests.get(row.promoted_guest_id)):latestGuests.get(id);
    const delta=e&&!manualAfter.has(k)?e.points_after-e.points_before:0;
    const protectedNow=Boolean(e&&!manualAfter.has(k)&&e.win_points+e.loss_points>0&&row.points===20&&e.points_after<=20);
    return {...row,previous_points:row.points-delta,attendance:e?.attendance_points||0,wins:e?.win_points||0,losses:e?.loss_points||0,rank_protected:protectedNow?1:0,...(type==='member'?{seed:seedForPoints(row.points),previous_rank:e?.rank_before??row.previous_rank,rank_movement:e?.rank_before&&!protectedNow&&!manualAfter.has(k)&&e.win_points+e.loss_points>0?e.rank_before-e.rank_after:0}:{})};
  };
  const active=orderRankingRows(s.ranking_members.filter(r=>!r.hidden).map(r=>({...r,rank:lastRanks.get(r.member_id)??lastRanks.size+r.rank}))).map(refreshed);
  const memberRows=[...active,...s.ranking_members.filter(r=>r.hidden).map(r=>({...r,seed:seedForPoints(r.points)}))];
  const guestRows=s.guests.filter(r=>!promoted.has(r.guest_id)).map(r=>r.hidden?r:refreshed(r));
  const memberColumns=['points','seed','rank','previous_rank','previous_points','attendance','wins','losses','rank_movement','rank_protected','floor_protected_at'];
  const guestColumns=['points','previous_points','attendance','wins','losses','rank_protected','floor_protected_at'];
  const updates={
    members:memberRows.filter(r=>changed(snapshot.ranking_members.find(o=>o.member_id===r.member_id),r,memberColumns)),memberColumns,
    guests:guestRows.filter(r=>changed(snapshot.guests.find(o=>o.guest_id===r.guest_id),r,guestColumns)),guestColumns,
    rankingEvents:s.ranking_events.filter(e=>changed(snapshot.ranking_events.find(o=>o.rowid===e.rowid),e,memberEventFields)),
    guestEvents:s.guest_events.filter(e=>changed(snapshot.guest_events.find(o=>o.rowid===e.rowid),e,eventFields)),
    settlements:settlements.filter(e=>!equal(snapshot.ranking_settlements.find(o=>o.schedule_id===e.schedule_id),e))
  };
  return {candidates,people,credits:people.reduce((n,p)=>n+p.attendanceCredits,0),pointsRemoved:people.reduce((n,p)=>n+p.pointsRemoved,0),updates};
}

export async function attendanceCorrection(request,env){
  if(!env.EDITOR_KEY||request.headers.get('x-kokkiri-editor')!==env.EDITOR_KEY)return json({error:'운영진만 출석점수 정정을 조회·실행할 수 있습니다.'},403);
  if(!['GET','POST'].includes(request.method))return json({error:'허용되지 않은 요청입니다.'},405);
  let input;
  if(request.method==='POST'){
    if(request.headers.get('origin')!==new URL(request.url).origin)return json({error:'요청 출처를 확인해주세요.'},403);
    const raw=await request.text();if(raw.length>1000)return json({error:'요청이 너무 큽니다.'},413);
    try{input=JSON.parse(raw);}catch{return json({error:'정정 요청을 확인해주세요.'},400);}
    if(!input||typeof input.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.fingerprint))return json({error:'미리 확인한 정정 계획이 필요합니다.'},400);
  }
  const snapshot=await attendanceSnapshot(env.DB),fingerprint=await attendanceFingerprint(snapshot);
  if(input&&input.fingerprint!==fingerprint)return json({error:'데이터가 변경되었습니다. 정정 계획을 다시 확인해주세요.',conflict:true},409);
  let plan;try{plan=planAttendanceCorrection(snapshot);}catch(e){if(e.review)return json({blocked:true,error:e.message,fingerprint},409);throw e;}
  const {updates,...summary}=plan;
  if(request.method==='GET'||!updates)return json({fingerprint,...summary,applied:false});
  const at=new Date().toISOString(),backupId='attendance-'+crypto.randomUUID();
  // The pre-change snapshot and correction are committed together. The backup is
  // never sent to the browser and the original observation ledger is retained.
  const backup=JSON.stringify({at,kind:'attendance-correction',summary,snapshot});
  const statements=[env.DB.prepare('INSERT INTO backups (id,created_at,kind,data) VALUES (?,?,?,?)').bind(backupId,at,'attendance-correction',backup),
    updateRows(env.DB,'ranking_events','rowid',updates.rankingEvents,memberEventFields),
    updateRows(env.DB,'guest_events','rowid',updates.guestEvents,eventFields),
    updateRows(env.DB,'ranking_settlements','schedule_id',updates.settlements,['rank_order_before']),
    updateRows(env.DB,'ranking_members','member_id',updates.members.map(r=>({...r,updated_at:at})),[...updates.memberColumns,'updated_at'],['edit_version']),
    updateRows(env.DB,'guests','guest_id',updates.guests,updates.guestColumns,['edit_version'])];
  statements.push(insertRows(env.DB,'people_changes',['id','person_type','person_id','action','before_name','after_name','before_points','after_points','reason','created_at'],plan.people.filter(p=>p.pointsRemoved).map(p=>({id:'attendance-fix-'+crypto.randomUUID(),person_type:p.type,person_id:p.id,action:'update',before_name:p.name,after_name:p.name,before_points:p.before,after_points:p.after,reason:'전체 랜덤 또는 15명 이하 대진의 출석점수 오반영 정정',created_at:at}))));
  await commitRoster(env.DB,snapshot.roster_write_revision[0].revision,statements);
  return json({applied:true,backupId,...summary});
}
