-- Serializes snapshot-based roster/scoring writes across different requests.
-- No existing member, score, settlement or event data is changed.
CREATE TABLE roster_write_revision (
  id INTEGER PRIMARY KEY CHECK (id=1),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO roster_write_revision (id,revision) VALUES (1,0);
