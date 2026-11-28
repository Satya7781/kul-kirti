-- Samiti directory migration (2026-11-28)
-- Additive only. Membership is managed from the 17th admin module and the
-- active rows are published on /samiti.html.

CREATE TABLE IF NOT EXISTS samiti_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  position     TEXT NOT NULL DEFAULT 'Member',
  is_president BOOLEAN NOT NULL DEFAULT FALSE,
  photo_data   TEXT,
  photo_mime   TEXT CHECK (photo_mime IS NULL OR photo_mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  sort_order   INTEGER NOT NULL DEFAULT 100,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES admins(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS samiti_members_order_idx
  ON samiti_members (is_active, is_president DESC, sort_order, lower(name));

-- At most one published president; the application also checks this so the
-- admin gets a readable error instead of a raw database constraint failure.
CREATE UNIQUE INDEX IF NOT EXISTS samiti_one_active_president
  ON samiti_members ((is_president)) WHERE is_president AND is_active;

-- Register the module with the same three actions as every other console
-- module, then grant day-to-day view/edit to admins and everything to Super
-- Admin. Approve stays off: publishing is an edit operation here.
WITH actions(name) AS (VALUES ('view'), ('edit'), ('approve'))
INSERT INTO admin_permissions (key, module, action, label)
SELECT 'samiti:' || a.name, 'samiti', a.name, 'Samiti Directory · ' || initcap(a.name)
FROM actions a
ON CONFLICT (key) DO NOTHING;

INSERT INTO admin_role_permissions (role, permission_key, allowed)
SELECT r.role, p.key,
       CASE WHEN r.role = 'super_admin' OR a.name IN ('view', 'edit') THEN TRUE ELSE FALSE END
FROM (VALUES ('super_admin'), ('admin')) AS r(role)
CROSS JOIN (VALUES ('view'), ('edit'), ('approve')) AS a(name)
JOIN admin_permissions p ON p.module = 'samiti' AND p.action = a.name
ON CONFLICT (role, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed;
