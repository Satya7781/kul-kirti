-- Admin Control Console migration (2026-11-20)
-- Additive only. Applied by lib/migration-runner.js after db/schema.sql.
-- Every object below is guarded so the file can be replayed safely.

-- ── Admin accounts and RBAC ───────────────────────────────────────────────
ALTER TABLE admins ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES admins(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admins_role_check') THEN
    ALTER TABLE admins ADD CONSTRAINT admins_role_check
      CHECK (role IN ('super_admin', 'admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS admin_roles (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  rank        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO admin_roles (name, description, rank) VALUES
  ('admin', 'Can operate day-to-day Vanshawali modules', 10),
  ('super_admin', 'Full administrative control including accounts, roles and backups', 100)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_permissions (
  key     TEXT PRIMARY KEY,
  module  TEXT NOT NULL,
  action  TEXT NOT NULL,
  label   TEXT NOT NULL,
  UNIQUE (module, action)
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role           TEXT NOT NULL REFERENCES admin_roles(name) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES admin_permissions(key) ON DELETE CASCADE,
  allowed        BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (role, permission_key)
);

CREATE TABLE IF NOT EXISTS admin_permission_overrides (
  admin_id       UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES admin_permissions(key) ON DELETE CASCADE,
  allowed        BOOLEAN NOT NULL,
  updated_by     UUID REFERENCES admins(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (admin_id, permission_key)
);

WITH modules(name) AS (
  VALUES
    ('overview'), ('gotras'), ('trees'), ('members'), ('verification'),
    ('master'), ('branches'), ('duplicates'), ('villages'), ('accounts'),
    ('notifications'), ('reports'), ('exports'), ('backups'), ('activity'), ('roles')
), actions(name) AS (
  VALUES ('view'), ('edit'), ('approve')
), seeded AS (
  SELECT m.name || ':' || a.name AS key, m.name AS module, a.name AS action,
         initcap(replace(m.name, '_', ' ')) || ' · ' || initcap(a.name) AS label
    FROM modules m CROSS JOIN actions a
)
INSERT INTO admin_permissions (key, module, action, label)
SELECT key, module, action, label FROM seeded
ON CONFLICT (key) DO NOTHING;

-- Super Admin gets everything. Regular admins get read access everywhere,
-- day-to-day edit rights on content modules, and approval rights only on the
-- verification / linking modules. Accounts, roles and backups stay Super Admin.
WITH seeds(role, permission_key, allowed) AS (
  SELECT 'super_admin', key, TRUE FROM admin_permissions
  UNION ALL
  SELECT 'admin', key,
         CASE
           WHEN action = 'view' THEN TRUE
           WHEN action = 'edit' AND module IN (
             'gotras', 'trees', 'members', 'verification', 'master', 'branches',
             'duplicates', 'villages', 'notifications', 'reports', 'exports', 'activity'
           ) THEN TRUE
           WHEN action = 'approve' AND module IN (
             'verification', 'master', 'branches', 'duplicates'
           ) THEN TRUE
           ELSE FALSE
         END
    FROM admin_permissions
)
INSERT INTO admin_role_permissions (role, permission_key, allowed)
SELECT role, permission_key, allowed FROM seeds
ON CONFLICT (role, permission_key) DO NOTHING;

-- Correct grants if an earlier build of this migration was already applied.
UPDATE admin_role_permissions arp
SET allowed = CASE
  WHEN ap.action = 'view' THEN TRUE
  WHEN ap.action = 'edit' AND ap.module IN (
    'gotras', 'trees', 'members', 'verification', 'master', 'branches',
    'duplicates', 'villages', 'notifications', 'reports', 'exports', 'activity'
  ) THEN TRUE
  WHEN ap.action = 'approve' AND ap.module IN (
    'verification', 'master', 'branches', 'duplicates'
  ) THEN TRUE
  ELSE FALSE
END
FROM admin_permissions ap
WHERE arp.role = 'admin' AND arp.permission_key = ap.key;

-- Track issued admin sessions so an account disable / role change can revoke
-- every outstanding JWT, not just the current browser cookie.
CREATE TABLE IF NOT EXISTS admin_sessions (
  jti        TEXT PRIMARY KEY,
  admin_id   UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions (admin_id);

-- ── Rich activity log metadata ────────────────────────────────────────────
ALTER TABLE genealogy_audit ADD COLUMN IF NOT EXISTS ip INET;
ALTER TABLE genealogy_audit ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE genealogy_audit ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE genealogy_audit ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE genealogy_audit ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'genealogy';
CREATE INDEX IF NOT EXISTS genealogy_audit_created_idx ON genealogy_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS genealogy_audit_category_idx ON genealogy_audit (category, created_at DESC);

-- ── Tree revision history and verification assignment ─────────────────────
CREATE TABLE IF NOT EXISTS family_tree_revisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_tree_id  UUID NOT NULL REFERENCES family_trees(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  revision        JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
  editor_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (family_tree_id, revision_number)
);
CREATE INDEX IF NOT EXISTS family_tree_revisions_tree_idx
  ON family_tree_revisions (family_tree_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS verification_assignments (
  family_tree_id UUID PRIMARY KEY REFERENCES family_trees(id) ON DELETE CASCADE,
  admin_id       UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  assigned_by    UUID REFERENCES admins(id) ON DELETE SET NULL,
  due_at         TIMESTAMPTZ,
  notes          TEXT,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS verification_assignments_admin_idx
  ON verification_assignments (admin_id, due_at);

-- ── Branch relationship management ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS branch_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_branch_id UUID NOT NULL REFERENCES family_branches(id) ON DELETE CASCADE,
  target_branch_id UUID NOT NULL REFERENCES family_branches(id) ON DELETE CASCADE,
  relation_type    TEXT NOT NULL DEFAULT 'related'
                   CHECK (relation_type IN ('parent', 'related', 'merged_from')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unlinked')),
  notes            TEXT,
  created_by       UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlinked_at      TIMESTAMPTZ,
  unlinked_by      UUID REFERENCES admins(id) ON DELETE SET NULL,
  UNIQUE (source_branch_id, target_branch_id),
  CHECK (source_branch_id <> target_branch_id)
);
CREATE INDEX IF NOT EXISTS branch_links_source_idx ON branch_links (source_branch_id, status);
CREATE INDEX IF NOT EXISTS branch_links_target_idx ON branch_links (target_branch_id, status);

-- ── Duplicate detection and review ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS duplicate_candidates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'gotra', 'tree', 'member')),
  entity_a    UUID NOT NULL,
  entity_b    UUID NOT NULL,
  score       NUMERIC(5,2) NOT NULL DEFAULT 0,
  reasons     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'confirmed', 'dismissed', 'merged', 'resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  UNIQUE (entity_type, entity_a, entity_b),
  CHECK (entity_a <> entity_b)
);
CREATE INDEX IF NOT EXISTS duplicate_candidates_status_idx
  ON duplicate_candidates (status, score DESC, created_at DESC);

-- ── Notifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID REFERENCES admins(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'info'
             CHECK (type IN ('info', 'success', 'warning', 'danger')),
  title      TEXT NOT NULL,
  body       TEXT,
  link_url   TEXT,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at    TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications (admin_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (created_at DESC) WHERE read_at IS NULL;

-- ── Backup and restore management ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_backups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'logical_json' CHECK (kind = 'logical_json'),
  status       TEXT NOT NULL DEFAULT 'creating'
               CHECK (status IN ('creating', 'complete', 'failed', 'restoring', 'restored')),
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_counts   JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum     TEXT,
  byte_size    BIGINT NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  restored_at  TIMESTAMPTZ,
  restored_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS admin_backups_created_idx ON admin_backups (created_at DESC);

CREATE TABLE IF NOT EXISTS admin_restore_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_id   UUID NOT NULL REFERENCES admin_backups(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('missing_only', 'apply_snapshot')),
  tables      TEXT[] NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running', 'completed', 'failed')),
  started_by  UUID REFERENCES admins(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS admin_restore_jobs_backup_idx ON admin_restore_jobs (backup_id, started_at DESC);

-- Expression indexes for the fuzzy duplicate / village management queries.
CREATE INDEX IF NOT EXISTS people_name_lower_idx ON people (lower(btrim(full_name)));
CREATE INDEX IF NOT EXISTS people_village_lower_idx ON people (lower(btrim(village)));
CREATE INDEX IF NOT EXISTS family_trees_village_lower_idx ON family_trees (lower(btrim(village)));
CREATE INDEX IF NOT EXISTS gotras_name_lower_idx ON gotras (lower(btrim(name)));

-- The migration runner owns the schema_migrations ledger; do not insert it here.
