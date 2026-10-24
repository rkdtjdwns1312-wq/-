-- Names are unique only within the active roster. API roster revision CAS
-- additionally serializes cross-member/guest duplicate checks.
-- The old name UNIQUE is an inline SQLite constraint: rebuild the member
-- table, copying every row/column/rowid. Copy the referencing events first so
-- foreign keys remain valid throughout; no foreign_keys=OFF is needed in D1.
-- D1 migrations execute atomically. Replay preserves all records and history.
CREATE TABLE ranking_members_active_names (
  member_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  points INTEGER NOT NULL,
  seed TEXT NOT NULL,
  rank INTEGER NOT NULL,
  previous_rank INTEGER NOT NULL,
  attendance INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  previous_points INTEGER NOT NULL DEFAULT 0,
  is_operator INTEGER NOT NULL DEFAULT 0,
  rank_movement INTEGER NOT NULL DEFAULT 0,
  rank_protected INTEGER NOT NULL DEFAULT 0,
  floor_protected_at TEXT,
  promoted_guest_id TEXT,
  edit_version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO ranking_members_active_names(rowid,member_id,name,points,seed,rank,previous_rank,attendance,wins,losses,updated_at,hidden,previous_points,is_operator,rank_movement,rank_protected,floor_protected_at,promoted_guest_id,edit_version)
SELECT rowid,member_id,name,points,seed,rank,previous_rank,attendance,wins,losses,updated_at,hidden,previous_points,is_operator,rank_movement,rank_protected,floor_protected_at,promoted_guest_id,edit_version FROM ranking_members;

CREATE TABLE ranking_events_active_names (
  schedule_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  attendance_points INTEGER NOT NULL,
  win_points INTEGER NOT NULL,
  loss_points INTEGER NOT NULL,
  total_points INTEGER NOT NULL,
  points_before INTEGER NOT NULL,
  points_after INTEGER NOT NULL,
  rank_before INTEGER NOT NULL,
  rank_after INTEGER NOT NULL,
  seed_before TEXT NOT NULL,
  seed_after TEXT NOT NULL,
  created_at TEXT NOT NULL,
  floor_protected_before TEXT,
  PRIMARY KEY(schedule_id,member_id),
  FOREIGN KEY(member_id) REFERENCES ranking_members_active_names(member_id)
);
INSERT INTO ranking_events_active_names(rowid,schedule_id,member_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,rank_before,rank_after,seed_before,seed_after,created_at,floor_protected_before)
SELECT rowid,schedule_id,member_id,attendance_points,win_points,loss_points,total_points,points_before,points_after,rank_before,rank_after,seed_before,seed_after,created_at,floor_protected_before FROM ranking_events;

DROP TABLE ranking_events;
DROP TABLE ranking_members;
ALTER TABLE ranking_members_active_names RENAME TO ranking_members;
ALTER TABLE ranking_events_active_names RENAME TO ranking_events;
CREATE INDEX idx_ranking_events_member_created ON ranking_events(member_id,created_at DESC);
CREATE UNIQUE INDEX ranking_members_active_name ON ranking_members(name) WHERE hidden=0;
CREATE UNIQUE INDEX IF NOT EXISTS guests_active_name ON guests(name) WHERE hidden=0;

-- Restore the original score-history triggers only after copying, so schema
-- migration cannot manufacture new initial/change observations.
CREATE TRIGGER score_history_member_created AFTER INSERT ON ranking_members
WHEN NEW.hidden=0
BEGIN
  INSERT INTO score_point_history(person_type,person_id,recorded_at,points_after,kind)
  VALUES ('member',NEW.member_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.points,'initial');
END;
CREATE TRIGGER score_history_member_changed AFTER UPDATE OF points ON ranking_members
WHEN NEW.hidden=0 AND NEW.points<>OLD.points
BEGIN
  INSERT INTO score_point_history(person_type,person_id,recorded_at,points_before,points_after,kind)
  VALUES ('member',NEW.member_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),OLD.points,NEW.points,'change');
END;
