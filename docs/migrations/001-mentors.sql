-- Migration 001: Create mentors table
-- Run this in the Supabase SQL editor (https://supabase.com/dashboard → SQL Editor)

CREATE TABLE IF NOT EXISTS mentors (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT          NOT NULL,
  description     TEXT,
  system_prompt   TEXT          NOT NULL DEFAULT '',
  methodology_text TEXT         DEFAULT '',
  is_active       BOOLEAN       DEFAULT TRUE,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- Verify: SELECT * FROM mentors;
