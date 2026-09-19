import { seedForPoints } from './rankings.js';

export const SCORE_WINDOW_MS=20*7*86400000;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const iso=value=>new Date(value).toISOString();
const point=row=>({id:String(row.id),at:row.recorded_at,before:row.points_before,points:row.points_after,kind:row.kind,seed:seedForPoints(row.points_after)});

export async function scoreHistory(request,env){
  if(request.method!=='GET')return json({error:'허용되지 않은 요청입니다.'},405);
  const url=new URL(request.url),type=url.searchParams.get('type'),id=url.searchParams.get('id')||'',before=url.searchParams.get('before');
  if(!['member','guest'].includes(type)||!/^[A-Za-z0-9-]{1,120}$/.test(id))return json({error:'조회할 회원을 확인해주세요.'},400);
  const now=Date.now();
  if(before!==null){
    const parsed=Date.parse(before);
    if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(before)||!Number.isFinite(parsed)||iso(parsed)!==before||parsed>now+1000||parsed<Date.UTC(1900,0,1))return json({error:'조회 기간을 확인해주세요.'},400);
  }
  // A single SELECT uses one SQLite clock and snapshot for person, bounds and history.
  // Worker/host clocks can lag SQLite by milliseconds, hiding a just-committed event.
  // Never match on a mutable nickname.
  const target=type==='member'
    ?'SELECT member_id AS id,name,points,promoted_guest_id AS guest_id FROM ranking_members WHERE hidden=0 AND member_id=?'
    :'SELECT guest_id AS id,name,points,NULL AS guest_id FROM guests WHERE hidden=0 AND guest_id=?';
  const cte=`WITH person AS (${target}), bounds AS (
    SELECT strftime('%Y-%m-%dT%H:%M:%fZ',to_at,'-140 days') AS from_at,to_at
    FROM (SELECT coalesce(?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+0.001 seconds')) AS to_at)
  ), history AS (
    SELECT h.* FROM score_point_history h JOIN person p
      ON (h.person_type='${type}' AND h.person_id=p.id)
      OR (h.person_type='guest' AND h.person_id=p.guest_id)
  ) `;
  const eventJson="json_object('id',id,'recorded_at',recorded_at,'points_before',points_before,'points_after',points_after,'kind',kind)";
  const person=await env.DB.prepare(cte+`SELECT person.*,bounds.*,
    (SELECT json_group_array(${eventJson}) FROM
      (SELECT * FROM history WHERE recorded_at>=bounds.from_at AND recorded_at<bounds.to_at ORDER BY recorded_at,id)) AS window_rows,
    (SELECT ${eventJson} FROM history WHERE recorded_at<bounds.from_at ORDER BY recorded_at DESC,id DESC LIMIT 1) AS carry_row,
    (SELECT MIN(recorded_at) FROM history) AS first_at
    FROM person CROSS JOIN bounds`).bind(id,before).first();
  if(!person)return json({error:'현재 명단에 없는 회원입니다.'},404);
  const from=person.from_at,to=person.to_at,observedAt=iso(Date.parse(to)-1);
  const rows=JSON.parse(person.window_rows||'[]'),carry=person.carry_row?point(JSON.parse(person.carry_row)):null;
  const points=rows.map(point);
  // A first event's before-value is evidence, but not evidence of an earlier registration date.
  if(!carry&&points.length&&Number.isFinite(points[0].before))points.unshift({...points[0],id:'baseline-'+points[0].id,points:points[0].before,before:null,kind:'baseline',seed:seedForPoints(points[0].before)});
  if(before===null)points.push({id:'current',at:observedAt,before:null,points:person.points,kind:'current',seed:seedForPoints(person.points)});
  return json({person:{id,type,name:person.name,points:person.points,seed:seedForPoints(person.points)},range:{from,to},points,carry,hasOlder:Boolean(carry),nextBefore:from,recordedFrom:person.first_at||observedAt});
}
