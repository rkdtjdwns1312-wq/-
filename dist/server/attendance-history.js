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

export function attendanceKind(day,meetingType=''){
  if(meetingType==='벙개')return 'flash';
  if(meetingType==='정모'||meetingType==='소정모')return 'regular';
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if(!match)return 'flash';
  const weekday=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))).getUTCDay();
  return weekday===3||weekday===6?'regular':'flash';
}

export function monthsBefore(day,count){
  const [year,month,date]=day.split('-').map(Number),targetMonth=month-1-count,targetYear=year+Math.floor(targetMonth/12),normalizedMonth=(targetMonth%12+12)%12;
  const lastDate=new Date(Date.UTC(targetYear,normalizedMonth+1,0)).getUTCDate();
  return targetYear+'-'+String(normalizedMonth+1).padStart(2,'0')+'-'+String(Math.min(date,lastDate)).padStart(2,'0');
}

export function recentRegularAttendance(entries,today,months=3){
  const start=monthsBefore(today,months);
  return entries.filter(entry=>entry.kind==='regular'&&entry.date>=start&&entry.date<=today).length;
}

// Rebuild cumulative attendance from immutable schedule posts. One member is
// counted at most once per calendar date, even if more than one post exists.
export async function readAttendanceHistories(db,members){
  const histories=new Map(members.map(member=>[member.member_id,new Set()]));
  const kindHistories=new Map(members.map(member=>[member.member_id,new Map()]));
  const dayKinds=new Map();
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

  function addAttendance(memberId,day,kind,explicit=false){
    histories.get(memberId)?.add(day);
    const kinds=kindHistories.get(memberId),current=kinds?.get(day);
    if(!kinds||current?.explicit&&!explicit)return;
    if(!current||explicit&&!current.explicit||explicit===current.explicit&&kind==='flash')kinds.set(day,{kind,explicit});
  }
  function addDayKind(day,kind,explicit=false){
    const current=dayKinds.get(day);
    if(current?.explicit&&!explicit)return;
    if(!current||explicit&&!current.explicit||explicit===current.explicit&&kind==='flash')dayKinds.set(day,{kind,explicit});
  }

  for(const row of postsResult.results||[]){
    const post=parsedSchedule(row),day=post&&resolveScheduleDate(post);if(!day)continue;
    const explicit=['정모','소정모','벙개'].includes(post.meetingType),kind=attendanceKind(day,post.meetingType);
    addDayKind(day,kind,explicit);
    const names=Array.isArray(post.names)?post.names:[],ids=Array.isArray(post.participantIds)?post.participantIds:[];
    const played=new Set((Array.isArray(post.schedule)?post.schedule:[]).flatMap(round=>Array.isArray(round?.g)?round.g:[]).flatMap(game=>Array.isArray(game)?game:[]).map(cleanName).filter(Boolean));
    const absent=new Set((Array.isArray(post.absent)?post.absent:[]).map(cleanName).filter(Boolean));
    for(let index=0;index<names.length;index++){
      const name=cleanName(names[index]);if(!name||!played.has(name)||absent.has(name))continue;
      const participantId=typeof ids[index]==='string'?ids[index]:'';
      let memberId=participantId&&(byMemberId.get(participantId)||byPromotedGuestId.get(participantId));
      if(!memberId&&participantId)continue; // a known ID that is not a current member belongs to a guest
      if(!memberId){const matches=aliases.get(name);if(matches?.size===1)memberId=[...matches][0];}
      if(memberId)addAttendance(memberId,day,kind,explicit);
    }
  }
  for(const row of manualResult.results||[]){
    const name=cleanName(row.person_name),matches=aliases.get(name);
    const dayKind=dayKinds.get(row.attendance_date);
    if(matches?.size===1)addAttendance([...matches][0],row.attendance_date,dayKind?.kind||attendanceKind(row.attendance_date),Boolean(dayKind?.explicit));
  }
  const result=new Map([...histories].map(([memberId,days])=>[memberId,[...days].sort()]));
  result.kinds=new Map([...kindHistories].map(([memberId,kinds])=>[memberId,new Map([...kinds].map(([day,value])=>[day,value.kind]))]));
  return result;
}
