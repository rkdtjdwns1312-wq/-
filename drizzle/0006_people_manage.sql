-- 요청 060: 시드현황 사람 추가/삭제(회원·게스트) 지원
-- 회원은 ranking_members에 hidden 플래그를 두어 삭제=숨김 처리(정산 이력 FK 보존).
-- 게스트는 지금까지 roster.js(정적)에서만 왔으나, 추가/삭제를 위해 guests 테이블로 옮긴다(코드가 정적 게스트를 INSERT OR IGNORE로 시드).
ALTER TABLE ranking_members ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS guests (
  guest_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);
