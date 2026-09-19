-- Request 117: preserve actual score observations independently of reversible settlement events.
-- This migration never changes a person's score, rank, result or roster membership.
CREATE TABLE IF NOT EXISTS score_point_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_type TEXT NOT NULL CHECK(person_type IN ('member','guest')),
  person_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  points_before INTEGER,
  points_after INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('initial','settlement','manual','snapshot','change')),
  source_id TEXT,
  UNIQUE(person_type,person_id,kind,source_id)
);
CREATE INDEX IF NOT EXISTS idx_score_history_person_time
ON score_point_history(person_type,person_id,recorded_at,id);

-- Only surviving, timestamped records can be backfilled. Do not invent earlier dates.
INSERT OR IGNORE INTO score_point_history(person_type,person_id,recorded_at,points_before,points_after,kind,source_id)
SELECT person_type,person_id,at,before_points,after_points,kind,source_id FROM (
  SELECT 'member' AS person_type,member_id AS person_id,strftime('%Y-%m-%dT%H:%M:%fZ',created_at) AS at,
    points_before AS before_points,points_after AS after_points,'settlement' AS kind,schedule_id AS source_id FROM ranking_events
  UNION ALL
  SELECT 'guest',guest_id,strftime('%Y-%m-%dT%H:%M:%fZ',created_at),points_before,points_after,'settlement',CAST(id AS TEXT) FROM guest_events
  UNION ALL
  SELECT person_type,person_id,strftime('%Y-%m-%dT%H:%M:%fZ',created_at),before_points,after_points,
    CASE action WHEN 'create' THEN 'initial' ELSE 'manual' END,id FROM people_changes
  WHERE after_points IS NOT NULL AND (action='create' OR (action='update' AND before_points<>after_points))
) WHERE at IS NOT NULL ORDER BY at,person_type,person_id,kind,source_id;

-- Snapshot marks when this ledger became continuous, not an invented original registration date.
INSERT OR IGNORE INTO score_point_history(person_type,person_id,recorded_at,points_after,kind,source_id)
SELECT 'member',member_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),points,'snapshot','ledger-start' FROM ranking_members WHERE hidden=0;
INSERT OR IGNORE INTO score_point_history(person_type,person_id,recorded_at,points_after,kind,source_id)
SELECT 'guest',guest_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),points,'snapshot','ledger-start' FROM guests WHERE hidden=0;

-- Trigger writes participate in the same transaction: failed changes leave no false history.
-- Name/rank-only changes and unchanged scores do not create extra observations.
CREATE TRIGGER IF NOT EXISTS score_history_member_created AFTER INSERT ON ranking_members
WHEN NEW.hidden=0
BEGIN
  INSERT INTO score_point_history(person_type,person_id,recorded_at,points_after,kind)
  VALUES ('member',NEW.member_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.points,'initial');
END;
CREATE TRIGGER IF NOT EXISTS score_history_member_changed AFTER UPDATE OF points ON ranking_members
WHEN NEW.hidden=0 AND NEW.points<>OLD.points
BEGIN
  INSERT INTO score_point_history(person_type,person_id,recorded_at,points_before,points_after,kind)
  VALUES ('member',NEW.member_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),OLD.points,NEW.points,'change');
END;
CREATE TRIGGER IF NOT EXISTS score_history_guest_created AFTER INSERT ON guests
WHEN NEW.hidden=0
BEGIN
  INSERT INTO score_point_history(person_type,person_id,recorded_at,points_after,kind)
  VALUES ('guest',NEW.guest_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.points,'initial');
END;
CREATE TRIGGER IF NOT EXISTS score_history_guest_changed AFTER UPDATE OF points ON guests
WHEN NEW.hidden=0 AND NEW.points<>OLD.points
BEGIN
  INSERT INTO score_point_history(person_type,person_id,recorded_at,points_before,points_after,kind)
  VALUES ('guest',NEW.guest_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),OLD.points,NEW.points,'change');
END;
