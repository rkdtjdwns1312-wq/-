-- 요청 065: 삭제해도 목록에 되살아나던 옛 대진표(legacy-schedule) 정리.
--   원인은 preserveLegacy가 조회 때마다 schedules(id=1)에서 board_posts로 되살린 것(코드에서 호출 제거).
--   0004에서 이미 board_posts에 넣었으므로 여기서 남은 행을 지운다.
DELETE FROM board_posts WHERE id='legacy-schedule';
-- 요청 066: 시드현황 점수 변동(▲/▼ + 수치) 표시용. 정산 직전 점수를 저장하고, 새 대진 시작 시 초기화한다.
--   가장 최근 정산(아직 유효한 정산)의 정산 직전 점수(points_before)를 복원해, 방금 마감한 대진의
--   점수 변동 화살표가 바로 보이도록 한다. 정산 이력이 없는 회원은 현재 점수로 맞춰 변동 표시가 없게 한다.
ALTER TABLE ranking_members ADD COLUMN previous_points INTEGER NOT NULL DEFAULT 0;
UPDATE ranking_members SET previous_points=COALESCE((SELECT e.points_before FROM ranking_events e WHERE e.member_id=ranking_members.member_id ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1),points);
