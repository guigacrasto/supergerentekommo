-- Pipeline Visibility — global config per team
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS pipeline_visibility (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team TEXT NOT NULL,
  pipeline_id INTEGER NOT NULL,
  pipeline_name TEXT NOT NULL DEFAULT '',
  visible BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team, pipeline_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_visibility_team
  ON pipeline_visibility(team);

-- RLS disabled (service role key bypasses anyway)
ALTER TABLE pipeline_visibility ENABLE ROW LEVEL SECURITY;
