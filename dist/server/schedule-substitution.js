import { createScheduleTools } from './schedule-tools.js';
import { rosterRevision } from './roster-write.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const unpack=row=>({...JSON.parse(row.payload),id:row.id,kind:row.kind,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at});
const conflict=()=>json({error:'다른 기기에서 대진이나 회원 정보가 변경되었습니다. 최신 내용을 확인한 뒤 다시 긴급교체해주세요.',conflict:true},409);

// The caller checks operator authority. Only one slot changes; recorded results
// and progress stay intact, while settlement resolves the replacement by DB ID.
export async function substituteSchedule(db,id,input){
  const validName=value=>typeof value==='string'&&value.trim()&&value.length<=100&&!/[\u0000-\u001f\u007f]/.test(value);
  if(!input||!Number.isInteger(input.version)||input.version<1||!Number.isInteger(input.round)||input.round<1||input.round>20||!Number.isInteger(input.court)||input.court<1||input.court>100||!validName(input.oldName)||!validName(input.newName))return json({error:'라운드·코트 번호와 기존 멤버·교체 멤버 이름을 확인해주세요.'},400);
  const revision=await rosterRevision(db);
  const row=await db.prepare("SELECT * FROM board_posts WHERE id=? AND kind='schedule'").bind(id).first();
  if(!row)return json({error:'대진표를 찾을 수 없습니다.'},404);
  const post=unpack(row),ri=input.round-1,mi=input.court-1,match=post.schedule?.[ri]?.g?.[mi];
  if(post.settledAt)return json({error:'마감된 대진표는 긴급교체할 수 없습니다.'},409);
  if(row.version!==input.version)return conflict();
  const oldName=input.oldName.trim(),newName=input.newName.trim();
  if(!Array.isArray(match)||match.length!==4||match.filter(n=>n===oldName).length!==1)return json({error:'선택한 라운드·코트에 기존 멤버가 있는지 확인해주세요.'},400);
  const members=(await db.prepare('SELECT member_id AS id,name,promoted_guest_id FROM ranking_members WHERE hidden=0').all()).results;
  const guests=(await db.prepare('SELECT guest_id AS id,name FROM guests WHERE hidden=0').all()).results;
  const roster=[...members,...guests],found=roster.filter(p=>p.name===newName);
  if(found.length!==1)return json({error:found.length?'같은 이름이 여러 명입니다. 시드현황에서 구별되는 이름으로 정리한 뒤 교체해주세요.':'교체 멤버를 시드현황의 회원·게스트 명단에서 찾지 못했습니다. 먼저 등록한 뒤 정확한 이름을 입력해주세요.'},400);
  const person=found[0],byId=new Map(roster.map(p=>[p.id,p]));
  for(const member of members)if(member.promoted_guest_id)byId.set(member.promoted_guest_id,member);
  // Legacy ID-less posts used member-name first, then guest-name resolution.
  // Freeze that same mapping, without guessing a real identity for adhoc names.
  const ids=post.names.map((name,index)=>post.participantIds?.[index]||roster.find(p=>p.name===name)?.id||'adhoc-'+crypto.randomUUID());
  let index=ids.findIndex(pid=>byId.get(pid)?.id===person.id);
  const label=index>=0?post.names[index]:person.name;
  const aliases=new Set(post.names.filter((name,i)=>byId.get(ids[i])?.id===person.id));
  if(label===oldName||byId.get(ids[post.names.indexOf(oldName)])?.id===person.id)return json({error:'기존 멤버와 다른 교체 멤버를 입력해주세요.'},400);
  if(match.some(name=>name===label||aliases.has(name)))return json({error:'같은 경기에는 한 회원을 두 번 넣을 수 없습니다.'},400);
  if((post.absent||[]).some(name=>name===label||aliases.has(name)))return json({error:'교체 멤버가 불참자로 지정되어 있습니다. 먼저 불참 지정을 해제해주세요.'},400);
  if([label,...aliases].some(name=>(post.lateRounds?.[name]||0)>ri))return json({error:'교체 멤버는 이 라운드에 아직 늦참 대기 중입니다.'},400);
  if(index<0){
    if(post.names.includes(label))return json({error:'대진표의 같은 이름이 다른 회원 ID와 연결되어 있습니다. 참가자 정보를 먼저 확인해주세요.'},400);
    if(post.names.length>=200)return json({error:'참가자 명단은 최대 200명입니다. 명단을 확인해주세요.'},400);
    post.names.push(label);ids.push(person.id);index=post.names.length-1;
  }
  post.participantIds=ids;
  match[match.indexOf(oldName)]=label;
  const tools=createScheduleTools();for(let i=0;i<post.schedule.length;i++)tools.refreshRound(post,i);
  const at=new Date().toISOString();
  const saved=await db.prepare("UPDATE board_posts SET payload=?,version=version+1,last_operation='substitute',updated_at=? WHERE id=? AND kind='schedule' AND version=? AND (SELECT revision FROM roster_write_revision WHERE id=1)=?").bind(JSON.stringify(post),at,id,input.version,revision).run();
  if(!saved.meta.changes)return conflict();
  return json({data:unpack(await db.prepare('SELECT * FROM board_posts WHERE id=?').bind(id).first())});
}
