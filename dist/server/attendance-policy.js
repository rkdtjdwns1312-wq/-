// Count the configured roster, including guests, absences and late arrivals.
// Individual attendance exclusions remain the settlement caller's responsibility.
export function attendancePolicy(post){
  const participantCount=new Set(Array.isArray(post?.names)?post.names:[]).size;
  const schedule=Array.isArray(post?.schedule)?post.schedule:[];
  const randomOnly=schedule.length>0&&schedule.every(round=>round?.method==='random');
  // 요청 127: 제목에 토요일 표시가 있는 정모는 인원수/랜덤 방식과 관계없이 출석점을 준다.
  const saturdayRegular=/(?:\(\s*토\s*\)|토요일)/.test(String(post?.preTitle||post?.title||''));
  const reasons=[];
  if(!saturdayRegular&&randomOnly)reasons.push('random-only');
  if(!saturdayRegular&&participantCount<=15)reasons.push('participants-at-most-15');
  return {eligible:reasons.length===0,participantCount,randomOnly,saturdayRegular,reasons};
}
