-- Ejecutar esto en el SQL Editor de Supabase

-- Tabla principal: todos los videos escaneados (deduplicados globalmente)
CREATE TABLE IF NOT EXISTS tiktok_videos (
  video_id TEXT PRIMARY KEY,
  description TEXT,
  create_time TIMESTAMPTZ,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  author_username TEXT,
  author_nickname TEXT,
  hashtags_found TEXT[], -- en cuáles hashtags se encontró
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de relación video <-> hashtag para saber de dónde vino cada video
CREATE TABLE IF NOT EXISTS video_hashtags (
  id SERIAL PRIMARY KEY,
  video_id TEXT REFERENCES tiktok_videos(video_id),
  hashtag TEXT NOT NULL,
  found_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(video_id, hashtag)
);

-- Tabla de runs: cada ejecución del scanner
CREATE TABLE IF NOT EXISTS scan_runs (
  id SERIAL PRIMARY KEY,
  run_date TIMESTAMPTZ DEFAULT NOW(),
  hashtags_scanned TEXT[],
  total_videos_found INT DEFAULT 0,
  new_videos_added INT DEFAULT 0,
  duplicates_skipped INT DEFAULT 0
);

-- Tabla del top: snapshot por cada run (configurable, default 50)
CREATE TABLE IF NOT EXISTS top_videos (
  id SERIAL PRIMARY KEY,
  run_id INT REFERENCES scan_runs(id),
  rank INT,
  video_id TEXT REFERENCES tiktok_videos(video_id),
  score NUMERIC, -- score compuesto
  views BIGINT,
  likes BIGINT,
  comments BIGINT,
  description TEXT,
  author_username TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Desactivar RLS para que funcione con anon key
ALTER TABLE tiktok_videos DISABLE ROW LEVEL SECURITY;
ALTER TABLE video_hashtags DISABLE ROW LEVEL SECURITY;
ALTER TABLE scan_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE top_videos DISABLE ROW LEVEL SECURITY;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_videos_views ON tiktok_videos(views DESC);
CREATE INDEX IF NOT EXISTS idx_videos_likes ON tiktok_videos(likes DESC);
CREATE INDEX IF NOT EXISTS idx_top_run ON top_videos(run_id);
