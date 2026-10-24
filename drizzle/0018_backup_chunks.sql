-- Legacy backups.data stays intact. Large new backups store a small manifest in
-- that column; each chunk is UTF-8 text safely below D1's 2 MB value/row limit.
CREATE TABLE IF NOT EXISTS backup_chunks (
  backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (typeof(chunk_index)='integer' AND chunk_index>=0),
  data TEXT NOT NULL CHECK (length(CAST(data AS BLOB))<=524288),
  PRIMARY KEY (backup_id,chunk_index)
);
