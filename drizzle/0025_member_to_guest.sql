-- 요청 166: 정회원에서 게스트 전환 이력을 구분해 보존한다.
ALTER TABLE guests ADD COLUMN demoted_member_id TEXT;

CREATE TABLE people_changes_member_to_guest (
  id TEXT PRIMARY KEY NOT NULL,
  person_type TEXT NOT NULL CHECK(person_type IN ('member','guest')),
  person_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','update','hide','promote','demote')),
  before_name TEXT,
  after_name TEXT,
  before_points INTEGER,
  after_points INTEGER,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO people_changes_member_to_guest
SELECT * FROM people_changes;
DROP TABLE people_changes;
ALTER TABLE people_changes_member_to_guest RENAME TO people_changes;
CREATE INDEX idx_people_changes_person_created
ON people_changes(person_type,person_id,created_at DESC);
