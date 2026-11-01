// Calendar dates, not browser clocks or mutable updated_at timestamps, govern
// the member's narrow schedule permission. Unknown legacy dates fail closed.
export function validScheduleDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
}
export function resolveScheduleDate(post){
  if(Object.hasOwn(post||{},'scheduleDate'))return validScheduleDate(post.scheduleDate)?post.scheduleDate:'';
  const match=String(post?.preTitle||post?.title||'').match(/^(?:(\d{4})년\s*)?(\d{1,2})월\s+(\d{1,2})일(?:\s|\()/);
  if(!match)return '';
  const created=Date.parse(post.createdAt||post.created_at||'');
  if(!Number.isFinite(created))return '';
  const createdDay=new Date(created+9*3600000).toISOString().slice(0,10),year=Number(createdDay.slice(0,4));
  const years=match[1]?[Number(match[1])]:[year-1,year,year+1];
  const candidates=years.map(y=>String(y).padStart(4,'0')+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0')).filter(validScheduleDate)
    .map(day=>({day,diff:Math.abs(Date.parse(day+'T00:00:00Z')-Date.parse(createdDay+'T00:00:00Z'))})).sort((a,b)=>a.diff-b.diff);
  if(!candidates.length||candidates[0].diff>183*86400000||(candidates[1]&&candidates[0].diff===candidates[1].diff))return '';
  return candidates[0].day;
}
export function titleMatchesScheduleDate(title,day){
  if(!validScheduleDate(day)||typeof title!=='string')return false;
  const [year,month,date]=day.split('-').map(Number);
  const weekday=['일','월','화','수','목','금','토'][new Date(day+'T00:00:00Z').getUTCDay()];
  // Require the same generated date prefix for member-created drafts. Place and
  // hour remain user input; arbitrary titles cannot disguise a backdated event.
  return title.startsWith(month+'월 '+date+'일('+weekday+') ')&&year>0;
}
export function memberMayEditSchedule(post,access){
  return Boolean(access?.allowed&&post?.kind==='schedule'&&!post.settledAt&&resolveScheduleDate(post)===access.today);
}
