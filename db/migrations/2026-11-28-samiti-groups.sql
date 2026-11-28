-- Multiple samitis (2026-11-28)
-- Forward migration: turns the single directory into samiti groups. Existing
-- member rows (if the earlier build was applied anywhere) are preserved in a
-- default samiti.

CREATE TABLE IF NOT EXISTS samitis (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_by   UUID REFERENCES admins(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS samitis_active_order_idx
  ON samitis (is_active, sort_order, lower(name));

-- One default group keeps previously published members visible after upgrade.
INSERT INTO samitis (name, description, is_active, sort_order)
SELECT 'मुख्य समिति', NULL, TRUE, 100
WHERE NOT EXISTS (SELECT 1 FROM samitis);

ALTER TABLE samiti_members
  ADD COLUMN IF NOT EXISTS samiti_id UUID REFERENCES samitis(id) ON DELETE CASCADE;

UPDATE samiti_members
   SET samiti_id = (SELECT id FROM samitis ORDER BY sort_order, created_at LIMIT 1)
 WHERE samiti_id IS NULL;

ALTER TABLE samiti_members ALTER COLUMN samiti_id SET NOT NULL;

-- The original single-directory president index is replaced by a per-samiti
-- rule; every samiti may publish its own president.
DROP INDEX IF EXISTS samiti_one_active_president;
CREATE UNIQUE INDEX IF NOT EXISTS samiti_members_one_president_per_samiti
  ON samiti_members (samiti_id) WHERE is_president AND is_active;

CREATE INDEX IF NOT EXISTS samiti_members_samiti_order_idx
  ON samiti_members (samiti_id, is_active, is_president DESC, sort_order, lower(name));
