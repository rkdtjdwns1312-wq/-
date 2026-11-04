import { resolveScheduleDate } from './member-schedule-policy.js';

const cleanName=value=>typeof value==='string'?value.normalize('NFC').trim():'';

function addAlias(index,name,memberId){
  const key=cleanName(name);if(!key)return;
  if(!index.has(key))index.set(key,new Set());
  index.get(key).add(memberId);
}

function parsedSchedule(row){
  try{return {...JSON.parse(row.payload),createdAt:row.created_at};}
  catch{return null;}
}

// Rebuild cumulative attendance from immutable schedule posts. One member is
// counted at most once per calendar date, even if more than one post exists.
export async function readAttendanceHistories(db,members){
  const histories=new Map(members.map(member=>[member.member_id,new Set()]));
  const byMemberId=new Map(members.map(member=>[member.member_id,member.member_id]));
  const byPromotedGuestId=new Map(members.filter(member=>member.promoted_guest_id).map(member=>[member.promoted_guest_id,member.member_id]));
  const aliases=new Map();
  for(const member of members)addAlias(aliases,member.name,member.member_id);

  const [changesResult,postsResult,manualResult]=await Promise.all([
    db.prepare('SELECT person_type,person_id,before_name,after_name FROM people_changes').all(),
    db.prepare("SELECT payload,created_at FROM board_posts WHERE kind='schedule' ORDER BY created_at ASC,id ASC").all(),
    db.prepare('SELECT attendance_date,person_name FROM manual_attendance ORDER BY attendance_date ASC,person_name ASC').all()
  ]);
  for(const change of changesResult.results||[]){
    const memberId=change.person_type==='member'?byMemberId.get(change.person_id):change.person_type==='guest'?byPromotedGuestId.get(change.person_id):null;
    if(!memberId)continue;
    addAlias(aliases,change.before_name,memberId);addAlias(aliases,change.after_name,memberId);
  }

  for(const row of postsResult.results||[]){
    const post=parsedSchedule(row),day=post&&resolveScheduleDate(post);if(!day)continue;
    const names=Array.isArray(post.names)?post.names:[],ids=Array.isArray(post.participantIds)?post.participantIds:[];
    const played=new Set((Array.isArray(post.schedule)?post.schedule:[]).flatMap(round=>Array.isArray(round?.g)?round.g:[]).flatMap(game=>Array.isArray(game)?game:[]).map(cleanName).filter(Boolean));
    const absent=new Set((Array.isArray(post.absent)?post.absent:[]).map(cleanName).filter(Boolean));
    for(let index=0;index<names.length;index++){
      const name=cleanName(names[index]);if(!name||!played.has(name)||absent.has(name))continue;
      const participantId=typeof ids[index]==='string'?ids[index]:'';
      let memberId=participantId&&(byMemberId.get(participantId)||byPromotedGuestId.get(participantId));
      if(!memberId&&participantId)continue; // a known ID that is not a current member belongs to a guest
      if(!memberId){const matches=aliases.get(name);if(matches?.size===1)memberId=[...matches][0];}
      if(memberId)histories.get(memberId)?.add(day);
    }
  }
  for(const row of manualResult.results||[]){
    const name=cleanName(row.person_name),matches=aliases.get(name);
    if(matches?.size===1)histories.get([...matches][0])?.add(row.attendance_date);
  }
  return new Map([...histories].map(([memberId,days])=>[memberId,[...days].sort()]));
}
