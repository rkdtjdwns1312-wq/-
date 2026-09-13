-- 요청 073: 홈페이지 관리자 권한 — 운영진(왕관)을 DB로 관리(임명/해제).
--   기존 하드코딩 운영진 6명을 초기 임명 상태로 시드.
ALTER TABLE ranking_members ADD COLUMN is_operator INTEGER NOT NULL DEFAULT 0;
UPDATE ranking_members SET is_operator=1 WHERE name IN ('로토','백구','구구','이코','뉴키','단우');
-- 요청 074: 백업 스냅샷(공지·대진·시드) 저장. 주간 자동 + 관리자 수동, 1개월 보관.
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'auto',
  data TEXT NOT NULL
);
