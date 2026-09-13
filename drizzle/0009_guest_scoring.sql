-- 요청 068: 게스트도 정산 점수 변동 대상(출석 +1·승 +1·패 -1, 점수 누적·화살표).
--   게스트 테이블에 출석·승·패·정산 직전 점수 컬럼 추가, 정산 직전 점수는 현재 점수로 맞춰 초기 화살표 없음.
ALTER TABLE guests ADD COLUMN attendance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guests ADD COLUMN wins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guests ADD COLUMN losses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE guests ADD COLUMN previous_points INTEGER NOT NULL DEFAULT 0;
UPDATE guests SET previous_points=points;
-- 게스트 정산 델타 기록(마감 취소 역산용). 회원의 ranking_events에 대응.
CREATE TABLE IF NOT EXISTS guest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  attendance_points INTEGER NOT NULL DEFAULT 0,
  win_points INTEGER NOT NULL DEFAULT 0,
  loss_points INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  points_before INTEGER NOT NULL DEFAULT 0,
  points_after INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);
