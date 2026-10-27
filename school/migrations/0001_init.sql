CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  roles TEXT NOT NULL,
  family_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructor_user_id TEXT NOT NULL,
  parent_user_id TEXT NOT NULL,
  phone TEXT,
  lessons_remaining INTEGER NOT NULL,
  balance_initialized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  first_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  calendar_event_id TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  instructor_user_id TEXT NOT NULL,
  child_first_name TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL UNIQUE,
  instructor_user_id TEXT NOT NULL,
  clock_in_at TEXT NOT NULL,
  clock_out_at TEXT,
  clock_in_distance_yards REAL,
  clock_out_distance_yards REAL,
  clock_in_source TEXT NOT NULL,
  clock_out_source TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_adjustments (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone_at TEXT
);

CREATE TABLE IF NOT EXISTS tracker_writes (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  lessons_remaining INTEGER NOT NULL,
  reason TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  body TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Designed for the live location phase. Raw points are deleted within 24 hours.
CREATE TABLE IF NOT EXISTS en_route_sessions (
  id TEXT PRIMARY KEY,
  instructor_user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  arrival_text_sent_at TEXT
);

CREATE TABLE IF NOT EXISTS location_points (
  id TEXT PRIMARY KEY,
  en_route_session_id TEXT NOT NULL,
  instructor_user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_location_recorded ON location_points (recorded_at);
CREATE INDEX IF NOT EXISTS idx_lessons_family_start ON lessons (family_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_lessons_instructor_start ON lessons (instructor_user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_links (email, created_at);
CREATE INDEX IF NOT EXISTS idx_adjustments_lesson ON balance_adjustments (lesson_id, undone_at);
