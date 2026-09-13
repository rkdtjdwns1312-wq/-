-- 요청 080·081: 정모의 순위 변동을 명단 재정렬과 분리하고 최저 20점을 보호한다.
ALTER TABLE ranking_members ADD COLUMN rank_movement INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranking_members ADD COLUMN rank_protected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ranking_members ADD COLUMN floor_protected_at TEXT;
ALTER TABLE ranking_members ADD COLUMN promoted_guest_id TEXT;
ALTER TABLE guests ADD COLUMN rank_protected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guests ADD COLUMN floor_protected_at TEXT;
ALTER TABLE ranking_events ADD COLUMN floor_protected_before TEXT;
ALTER TABLE guest_events ADD COLUMN floor_protected_before TEXT;
ALTER TABLE ranking_settlements ADD COLUMN rank_order_before TEXT;

-- 이관으로 previous_rank가 덮여도 정산 이벤트의 증감은 그대로 남아 있다.
-- 새 대진/마감 취소로 초기화된 행은 복구하지 않는다.
WITH latest AS (
  SELECT schedule_id,settled_at FROM ranking_settlements ORDER BY settled_at DESC,rowid DESC LIMIT 1
)
UPDATE ranking_members
SET rank_movement=COALESCE((
  SELECT e.rank_before-e.rank_after FROM ranking_events e,latest s
  WHERE e.schedule_id=s.schedule_id AND e.member_id=ranking_members.member_id
    AND e.win_points+e.loss_points>0
),0),
rank_protected=CASE WHEN EXISTS (
  SELECT 1 FROM ranking_events e,latest s
  WHERE e.schedule_id=s.schedule_id AND e.member_id=ranking_members.member_id
    AND e.win_points+e.loss_points>0 AND e.points_after<=20
) THEN 1 ELSE 0 END
WHERE hidden=0 AND attendance>0 AND updated_at=(SELECT settled_at FROM latest);

UPDATE ranking_members SET floor_protected_at=(
  SELECT settled_at FROM ranking_settlements ORDER BY settled_at DESC,rowid DESC LIMIT 1
),rank_movement=0 WHERE rank_protected=1;

WITH latest AS (
  SELECT schedule_id,settled_at FROM ranking_settlements ORDER BY settled_at DESC,rowid DESC LIMIT 1
)
UPDATE guests SET rank_protected=1,floor_protected_at=(SELECT settled_at FROM latest)
WHERE hidden=0 AND attendance>0 AND EXISTS (
  SELECT 1 FROM guest_events e,latest s
  WHERE e.schedule_id=s.schedule_id AND e.guest_id=guests.guest_id
    AND e.win_points+e.loss_points>0 AND e.points_after<=20
) AND EXISTS (SELECT 1 FROM ranking_members m,latest s WHERE m.hidden=0 AND m.updated_at=s.settled_at);

-- 사용자 확인: 기존 20점 미만 회원·게스트도 모두 20점으로 보정한다.
-- 과거 정산 이벤트의 원본 점수는 보존한다.
UPDATE ranking_members SET points=20,previous_points=MAX(20,previous_points),seed='E' WHERE points<20;
UPDATE guests SET points=20,previous_points=MAX(20,previous_points) WHERE points<20;

WITH ordered AS (
  SELECT member_id,ROW_NUMBER() OVER (
    ORDER BY points DESC,
      CASE WHEN points=20 AND floor_protected_at IS NOT NULL THEN 1 ELSE 0 END,
      CASE WHEN points=20 THEN floor_protected_at END,
      rank ASC,name ASC
  ) AS new_rank FROM ranking_members WHERE hidden=0
)
UPDATE ranking_members SET rank=(SELECT new_rank FROM ordered WHERE ordered.member_id=ranking_members.member_id)
WHERE hidden=0;
