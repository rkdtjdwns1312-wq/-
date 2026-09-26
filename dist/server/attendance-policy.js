// Count the configured roster, including guests, absences and late arrivals.
// Individual attendance exclusions remain the settlement caller's responsibility.
export function attendancePolicy(post){
  const participantCount=new Set(Array.isArray(post?.names)?post.names:[]).size;
  const schedule=Array.isArray(post?.schedule)?post.schedule:[];
  const randomOnly=schedule.length>0&&schedule.every(round=>round?.method==='random');
  const reasons=[];
  if(randomOnly)reasons.push('random-only');
  if(participantCount<=15)reasons.push('participants-at-most-15');
  return {eligible:reasons.length===0,participantCount,randomOnly,reasons};
}
