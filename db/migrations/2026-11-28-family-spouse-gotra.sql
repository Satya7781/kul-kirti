-- Optional spouse / married-daughter gotra fields (2026-11-28)
-- Additive only. Draft revisions are JSONB and need no schema change; these
-- columns are populated when a verified revision is materialised.

ALTER TABLE people ADD COLUMN IF NOT EXISTS wife_gotra TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS married_gotra TEXT;
