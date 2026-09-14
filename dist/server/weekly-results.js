// Weekly display comes from the latest confirmed settlement, not draft creation.
// Legacy zeroed display columns can therefore recover without replaying scores.
export async function readWeeklyResults(db){
  const {results}=await db.prepare(`
    WITH latest AS (
      SELECT schedule_id,settled_at,rank_order_before FROM ranking_settlements
      ORDER BY settled_at DESC,rowid DESC LIMIT 1
    ), events AS (
      SELECT 'member' AS kind,e.member_id AS person_id,e.attendance_points,e.win_points,e.loss_points,
        e.points_before,e.points_after,e.rank_before,e.rank_after
      FROM ranking_events e JOIN latest s ON s.schedule_id=e.schedule_id
      UNION ALL
      SELECT 'guest',e.guest_id,e.attendance_points,e.win_points,e.loss_points,
        e.points_before,e.points_after,NULL,NULL
      FROM guest_events e JOIN latest s ON s.schedule_id=e.schedule_id
    )
    SELECT s.schedule_id,s.settled_at,s.rank_order_before,e.* FROM latest s LEFT JOIN events e ON 1=1
  `).all();
  const members=new Map(),guests=new Map();
  const priorRanks=new Map(JSON.parse(results[0]?.rank_order_before||'[]').map((id,i)=>[id,i+1]));
  for(const e of results){if(e.kind==='member')members.set(e.person_id,e);else if(e.kind==='guest')guests.set(e.person_id,e);}
  const pointEdits=new Set();
  if(results[0]?.settled_at){
    const edits=await db.prepare("SELECT DISTINCT person_type,person_id FROM people_changes WHERE action='update' AND before_points<>after_points AND created_at>=?").bind(results[0].settled_at).all();
    for(const edit of edits.results)pointEdits.add(edit.person_type+':'+edit.person_id);
  }
  function display(row,event,pointEdited){
    // A recorded manual correction intentionally clears arrows. Draft resets have
    // no people_changes entry. Cache checks also avoid suppressing a settlement
    // immediately after a manual edit in the same millisecond.
    const manuallyReset=pointEdited&&row.previous_points===row.points&&!row.rank_protected&&(!row.member_id||!row.rank_movement);
    const attendance=event?.attendance_points||0,wins=event?.win_points||0,losses=event?.loss_points||0;
    const delta=event&&!manuallyReset?Math.max(20,event.points_after)-Math.max(20,event.points_before):0;
    const protectedNow=Boolean(event&&!manuallyReset&&wins+losses>0&&row.points===20&&event.points_after<=20);
    return {...row,attendance,wins,losses,previous_points:row.points-delta,
      rank_protected:protectedNow?1:0,
      ...(row.member_id?{
        previous_rank:event?.kind==='guest'?row.rank:(event?.rank_before??priorRanks.get(row.member_id)??row.previous_rank??row.rank),
        rank_movement:event?.kind==='member'&&wins+losses>0&&!protectedNow&&!manuallyReset?event.rank_before-event.rank_after:0
      }:{})};
  }
  return {
    scheduleId:results[0]?.schedule_id||null,settledAt:results[0]?.settled_at||null,
    member(row){const {promoted_guest_id,...publicRow}=row;return display(publicRow,members.get(row.member_id)||guests.get(promoted_guest_id),pointEdits.has('member:'+row.member_id)||pointEdits.has('guest:'+promoted_guest_id));},
    guest(row){return display(row,guests.get(row.guest_id),pointEdits.has('guest:'+row.guest_id));}
  };
}
