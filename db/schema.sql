CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gotras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  origin_place TEXT,
  origin_period TEXT,
  founder_name TEXT,
  founder_notes TEXT,
  historical_details TEXT,
  source_references TEXT,
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('draft', 'verified')),
  created_by UUID NOT NULL REFERENCES admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gotra_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gotra_id UUID NOT NULL REFERENCES gotras(id) ON DELETE CASCADE,
  person_name TEXT NOT NULL,
  relation_or_role TEXT,
  village TEXT,
  district TEXT,
  state TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('gotra', 'village', 'family')),
  name TEXT NOT NULL,
  village TEXT,
  district TEXT,
  state TEXT NOT NULL,
  family_branch TEXT,
  notes TEXT,
  family_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  contributor_name TEXT NOT NULL,
  contributor_contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES admins(id),
  review_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  -- Set when an approved submission is linked into people/relationships.
  linked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS published_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID UNIQUE REFERENCES submissions(id),
  type TEXT NOT NULL CHECK (type IN ('gotra', 'village', 'family')),
  name TEXT NOT NULL,
  village TEXT,
  district TEXT,
  state TEXT NOT NULL,
  family_branch TEXT,
  notes TEXT,
  family_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_by UUID NOT NULL REFERENCES admins(id),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS published_records_search_idx
  ON published_records USING GIN (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(village,'') || ' ' || coalesce(district,'') || ' ' || coalesce(state,'')));

CREATE INDEX IF NOT EXISTS gotra_members_gotra_idx ON gotra_members (gotra_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- DIGITAL VANSHAWALI — GENEALOGY SYSTEM SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════
-- All tables are additive (CREATE TABLE IF NOT EXISTS) — existing tables
-- and data are never touched.  The existing `gotras` table is referenced
-- as a foreign key; no columns are added to it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. FAMILY BRANCHES ──────────────────────────────────────────────────────
-- Hierarchical branches within a gotra.  A gotra may contain multiple
-- branches and disconnected documented family roots.

CREATE TABLE IF NOT EXISTS family_branches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gotra_id     UUID NOT NULL REFERENCES gotras(id) ON DELETE CASCADE,
  parent_branch_id UUID REFERENCES family_branches(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  slug         TEXT,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('draft', 'verified', 'archived')),
  created_by   UUID NOT NULL REFERENCES admins(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gotra_id, name)
);

CREATE INDEX IF NOT EXISTS family_branches_gotra_idx ON family_branches (gotra_id);
CREATE INDEX IF NOT EXISTS family_branches_parent_idx ON family_branches (parent_branch_id);

-- ── 2. PEOPLE ──────────────────────────────────────────────────────────────
-- Individual people in the genealogy.  Each has a UUID (internal) and a
-- stable public_id (shareable).  Visibility controls what the public sees.

CREATE TABLE IF NOT EXISTS people (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id       TEXT UNIQUE NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  full_name       TEXT NOT NULL,
  alt_names       TEXT,                          -- comma-separated alternative names
  gender          TEXT CHECK (gender IN ('male', 'female', 'other', 'unknown') OR gender IS NULL),
  birth_date      DATE,
  death_date      DATE,
  birth_year      TEXT,                          -- approximate year as text (e.g. "c. 1850")
  death_year      TEXT,
  birthplace      TEXT,
  village         TEXT,
  district        TEXT,
  state           TEXT,
  biography       TEXT,
  profile_image_key TEXT,                        -- R2/CDN key when storage is added
  is_living       BOOLEAN NOT NULL DEFAULT TRUE,
  status          TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('draft', 'pending', 'verified', 'archived')),
  visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'private')),
  created_by      UUID NOT NULL REFERENCES admins(id),
  updated_by      UUID REFERENCES admins(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-detect is_living: if no death_date and no death_year, default to true
-- (overridden by admin as needed)

CREATE INDEX IF NOT EXISTS people_public_id_idx ON people (public_id);
CREATE INDEX IF NOT EXISTS people_name_idx ON people USING GIN (to_tsvector('simple', full_name));
CREATE INDEX IF NOT EXISTS people_status_idx ON people (status);
CREATE INDEX IF NOT EXISTS people_status_visibility_idx ON people (status, visibility);
CREATE INDEX IF NOT EXISTS people_village_idx ON people (village);

-- ── 3. PERSON-GOTRA LINKS ──────────────────────────────────────────────────
-- Many-to-many: a person can be associated with one or more gotras.
-- This is NOT a parent-child relationship — it's a membership association.

CREATE TABLE IF NOT EXISTS person_gotra_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  gotra_id    UUID NOT NULL REFERENCES gotras(id) ON DELETE CASCADE,
  branch_id   UUID REFERENCES family_branches(id) ON DELETE SET NULL,
  is_root     BOOLEAN NOT NULL DEFAULT FALSE,    -- earliest documented ancestor
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_id, gotra_id)
);

CREATE INDEX IF NOT EXISTS person_gotra_links_person_idx ON person_gotra_links (person_id);
CREATE INDEX IF NOT EXISTS person_gotra_links_gotra_idx ON person_gotra_links (gotra_id);
CREATE INDEX IF NOT EXISTS person_gotra_links_branch_idx ON person_gotra_links (branch_id);

-- ── 4. PERSON RELATIONSHIPS ────────────────────────────────────────────────
-- Parent-child relationships.  This is the core of the genealogy engine.
-- Supports biological, adoptive, step-parent, and guardian types.
-- Has a CHECK constraint preventing self-parenting and a unique constraint
-- preventing duplicate (parent, child, type) triples.

CREATE TABLE IF NOT EXISTS person_relationships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  child_id        UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  relation_type   TEXT NOT NULL DEFAULT 'biological'
                  CHECK (relation_type IN ('biological', 'adoptive', 'step', 'guardian', 'other')),
  status          TEXT NOT NULL DEFAULT 'verified'
                  CHECK (status IN ('draft', 'pending', 'verified', 'disputed')),
  evidence_source TEXT,
  created_by      UUID NOT NULL REFERENCES admins(id),
  approved_by     UUID REFERENCES admins(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Prevent self-parenting at the database level
  CONSTRAINT no_self_parenting CHECK (parent_id <> child_id),
  -- Prevent duplicate parent-child-type triples
  UNIQUE (parent_id, child_id, relation_type)
);

CREATE INDEX IF NOT EXISTS person_rel_parent_idx ON person_relationships (parent_id);
CREATE INDEX IF NOT EXISTS person_rel_child_idx ON person_relationships (child_id);
CREATE INDEX IF NOT EXISTS person_rel_status_idx ON person_relationships (status);
CREATE INDEX IF NOT EXISTS person_rel_parent_status_idx ON person_relationships (parent_id, status);

-- ── 5. GENEALOGY SOURCES ───────────────────────────────────────────────────
-- Historical documents, photographs, certificates, manuscripts.
-- File metadata only — actual files stored in R2/CDN when storage is added.

CREATE TABLE IF NOT EXISTS genealogy_sources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  source_type   TEXT CHECK (source_type IN ('document', 'photo', 'certificate', 'manuscript', 'inscription', 'book', 'other')),
  storage_key   TEXT,                             -- R2/CDN key
  source_date   TEXT,                             -- date of the source document (text for flexibility)
  author        TEXT,
  reference     TEXT,                             -- citation reference
  status        TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('pending', 'verified', 'rejected')),
  uploaded_by   UUID NOT NULL REFERENCES admins(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. PERSON-SOURCE LINKS ─────────────────────────────────────────────────
-- Links sources to specific people (evidence for relationships, biographical data).

CREATE TABLE IF NOT EXISTS person_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  source_id   UUID NOT NULL REFERENCES genealogy_sources(id) ON DELETE CASCADE,
  link_type   TEXT,                               -- 'birth', 'death', 'marriage', 'biography', 'relationship'
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (person_id, source_id)
);

CREATE INDEX IF NOT EXISTS person_sources_person_idx ON person_sources (person_id);
CREATE INDEX IF NOT EXISTS person_sources_source_idx ON person_sources (source_id);

-- ── 7. GENEALOGY CONTRIBUTIONS ─────────────────────────────────────────────
-- Public submissions for new people, relationships, corrections.
-- Never directly modify verified genealogy — all changes go through review.

CREATE TABLE IF NOT EXISTS genealogy_contributions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_type TEXT NOT NULL
                    CHECK (contribution_type IN ('new_person', 'new_relationship', 'correction', 'branch_addition', 'gotra_info', 'dispute')),
  -- For new_person submissions:
  proposed_name      TEXT,
  proposed_gender    TEXT,
  proposed_birth_year TEXT,
  proposed_death_year TEXT,
  proposed_village   TEXT,
  proposed_gotra_id  UUID REFERENCES gotras(id),
  proposed_branch_id UUID REFERENCES family_branches(id),
  proposed_father_id UUID REFERENCES people(id),
  proposed_mother_id UUID REFERENCES people(id),
  -- For correction submissions:
  existing_person_id UUID REFERENCES people(id),
  existing_rel_id    UUID REFERENCES person_relationships(id),
  -- Common fields:
  description       TEXT,
  evidence          TEXT,                           -- description of evidence
  contributor_name  TEXT NOT NULL,
  contributor_contact TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'needs_info', 'disputed')),
  reviewed_by       UUID REFERENCES admins(id),
  review_notes      TEXT,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS genealogy_contrib_status_idx ON genealogy_contributions (status);
CREATE INDEX IF NOT EXISTS genealogy_contrib_type_idx ON genealogy_contributions (contribution_type);
CREATE INDEX IF NOT EXISTS genealogy_contrib_person_idx ON genealogy_contributions (existing_person_id);

-- ── 8. GENEALOGY AUDIT LOG ─────────────────────────────────────────────────
-- Tracks every administrative change to the genealogy for accountability.

CREATE TABLE IF NOT EXISTS genealogy_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES admins(id),
  action      TEXT NOT NULL,                       -- 'create_person', 'update_person', 'add_relationship', etc.
  entity_type TEXT NOT NULL,                       -- 'person', 'relationship', 'branch', 'gotra', 'contribution'
  entity_id   UUID,
  changes     JSONB,                                -- before/after diff
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS genealogy_audit_admin_idx ON genealogy_audit (admin_id);
CREATE INDEX IF NOT EXISTS genealogy_audit_entity_idx ON genealogy_audit (entity_type, entity_id);

-- ── 9. TREE PROJECTION (derived generation data) ───────────────────────────
-- Cached generation numbers for frequently accessed people.
-- Rebuilt after approved relationship changes.

CREATE TABLE IF NOT EXISTS genealogy_tree_projection (
  person_id     UUID PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  root_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  generation    INTEGER NOT NULL DEFAULT 1,
  path_length   INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS genealogy_tree_root_idx ON genealogy_tree_projection (root_person_id);
CREATE INDEX IF NOT EXISTS genealogy_tree_gen_idx ON genealogy_tree_projection (generation);


-- ═══════════════════════════════════════════════════════════════════════════
-- VANSHAWALI ENHANCEMENT — LOCATIONS, IMPORT STAGING, BRANCH PERMISSIONS
-- ═══════════════════════════════════════════════════════════════════════════
-- All additive.  Existing tables and data are never touched.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 10. LOCATIONS ──────────────────────────────────────────────────────────
-- Normalized village/city/district/state.  Many people share one location.
-- People can still use text columns directly; location_id is optional.

CREATE TABLE IF NOT EXISTS locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  village_name TEXT NOT NULL,
  city         TEXT,
  district     TEXT,
  state        TEXT,
  slug         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (village_name, district, state)
);

CREATE INDEX IF NOT EXISTS locations_village_idx ON locations (village_name);
CREATE INDEX IF NOT EXISTS locations_district_idx ON locations (district);
CREATE INDEX IF NOT EXISTS locations_state_idx ON locations (state);

-- Add nullable location_id to people (does NOT remove existing text columns)
ALTER TABLE people ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS people_location_idx ON people (location_id);

-- ── 11. IMPORT STAGING TABLES ──────────────────────────────────────────────
-- For CSV/Excel bulk import.  Jobs track the overall import; rows store
-- parsed and validated data before commit.

CREATE TABLE IF NOT EXISTS import_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID NOT NULL REFERENCES admins(id),
  filename      TEXT,
  total_rows    INTEGER NOT NULL DEFAULT 0,
  valid_rows    INTEGER NOT NULL DEFAULT 0,
  invalid_rows  INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'previewing'
                CHECK (status IN ('previewing', 'validated', 'committed', 'failed', 'cancelled')),
  summary       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS import_rows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_number    INTEGER NOT NULL,
  external_id   TEXT,
  full_name     TEXT,
  father_external_id TEXT,
  mother_external_id TEXT,
  village       TEXT,
  city          TEXT,
  district      TEXT,
  state         TEXT,
  branch_name   TEXT,
  living_status TEXT,
  is_valid      BOOLEAN NOT NULL DEFAULT TRUE,
  errors        JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_person_id UUID REFERENCES people(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS import_rows_job_idx ON import_rows (job_id);
CREATE INDEX IF NOT EXISTS import_rows_valid_idx ON import_rows (job_id, is_valid);

-- ── 12. USER BRANCH PERMISSIONS ─────────────────────────────────────────────
-- Branch-level access for branch representatives.  Only created if needed;
-- the existing admins table with role='super_admin' handles full access.

CREATE TABLE IF NOT EXISTS user_branch_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email      TEXT NOT NULL,
  branch_id       UUID REFERENCES family_branches(id) ON DELETE CASCADE,
  permission_level TEXT NOT NULL DEFAULT 'submit'
                  CHECK (permission_level IN ('submit', 'manage', 'view')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_email, branch_id)
);

CREATE INDEX IF NOT EXISTS user_branch_perms_email_idx ON user_branch_permissions (user_email);
CREATE INDEX IF NOT EXISTS user_branch_perms_branch_idx ON user_branch_permissions (branch_id);

-- ── 13. LINK gotra_members to people table ─────────────────────────────────
-- Adds a nullable FK so each gotra_member can reference its full people record.
ALTER TABLE gotra_members ADD COLUMN IF NOT EXISTS linked_person_id UUID REFERENCES people(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS gotra_members_linked_person_idx ON gotra_members (linked_person_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PUBLIC FAMILY TREE SYSTEM
-- ═══════════════════════════════════════════════════════════════════════════
-- Allows anyone to submit their own family tree without an admin account.
-- The tree is stored in draft status until admin reviews it.
-- created_by on people is made nullable so public-submitted people work.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 14. PUBLIC FAMILY TREES ────────────────────────────────────────────────
-- Each public submission is one family tree with a list of members (JSONB).
-- Statuses: draft (saved by user), pending (submitted for review),
--           approved (linked into main genealogy), rejected.

CREATE TABLE IF NOT EXISTS public_family_trees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token            TEXT UNIQUE NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,16)),
  creator_name     TEXT NOT NULL,
  creator_contact  TEXT,
  gotra_name       TEXT NOT NULL,
  village          TEXT,
  district         TEXT,
  state            TEXT,
  family_members   JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'linked')),
  -- After admin links this tree into the main genealogy:
  linked_gotra_id  UUID REFERENCES gotras(id),
  reviewed_by      UUID REFERENCES admins(id),
  review_notes     TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pft_status_idx ON public_family_trees (status);
CREATE INDEX IF NOT EXISTS pft_gotra_name_idx ON public_family_trees (gotra_name);
CREATE INDEX IF NOT EXISTS pft_token_idx ON public_family_trees (token);

-- ── Allow people.created_by to be NULL ─────────────────────────────────────
-- Public-submitted people are created without an admin account.
ALTER TABLE people ALTER COLUMN created_by DROP NOT NULL;

-- ── Track submission → genealogy linkage on existing databases ────────────
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS linked_at TIMESTAMPTZ;

-- ── Allow family_branches.created_by to be NULL ────────────────────────────
ALTER TABLE family_branches ALTER COLUMN created_by DROP NOT NULL;

-- ── Allow gotras to be created in draft by system (NULL created_by) ────────
ALTER TABLE gotras ALTER COLUMN created_by DROP NOT NULL;

-- ── Allow person_relationships.created_by to be NULL ──────────────────────
ALTER TABLE person_relationships ALTER COLUMN created_by DROP NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 15. GOTRA-FIRST VANSHAWALI (additive)
-- ═══════════════════════════════════════════════════════════════════════════
-- `status` keeps its original meaning (draft = unverified, verified = public).
-- `is_active` is the new activation switch: deactivating hides a Gotra from new
-- tree creation without hiding already-created trees from administrators.

ALTER TABLE gotras ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE gotras ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE gotras ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE gotras
   SET normalized_name = regexp_replace(lower(coalesce(name, '')), '\s+', ' ', 'g')
 WHERE normalized_name IS NULL;
CREATE INDEX IF NOT EXISTS gotras_normalized_name_idx ON gotras (normalized_name);
CREATE INDEX IF NOT EXISTS gotras_active_status_idx ON gotras (is_active, status);

-- One submitted family tree = one branch under exactly one Gotra.
-- The JSON revision keeps the user's unordered, independently entered boxes
-- until an admin approves them into canonical people/relationships rows.
CREATE TABLE IF NOT EXISTS family_trees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gotra_id          UUID NOT NULL REFERENCES gotras(id),
  tree_reference    TEXT UNIQUE NOT NULL DEFAULT 'KK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  edit_token        TEXT UNIQUE NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)),
  root_person_id    UUID REFERENCES people(id) ON DELETE SET NULL,
  submitter_name    TEXT,
  submitter_contact TEXT,
  village           TEXT,
  district          TEXT,
  state             TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending', 'under_review',
                                      'correction_required', 'verified', 'rejected')),
  revision_number   INTEGER NOT NULL DEFAULT 1,
  current_revision  JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_notes      TEXT,
  reviewed_by       UUID REFERENCES admins(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ,
  verified_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS family_trees_gotra_idx ON family_trees (gotra_id);
CREATE INDEX IF NOT EXISTS family_trees_status_idx ON family_trees (status);
CREATE INDEX IF NOT EXISTS family_trees_gotra_status_idx ON family_trees (gotra_id, status);
CREATE INDEX IF NOT EXISTS family_trees_token_idx ON family_trees (edit_token);
CREATE INDEX IF NOT EXISTS family_trees_submitted_idx ON family_trees (submitted_at DESC);

-- A verified tree may later be linked to another verified tree.  The link is
-- a separate record: neither tree is deleted or rewritten.
CREATE TABLE IF NOT EXISTS tree_links (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_tree_id           UUID NOT NULL REFERENCES family_trees(id) ON DELETE CASCADE,
  target_tree_id           UUID NOT NULL REFERENCES family_trees(id) ON DELETE CASCADE,
  common_ancestor_person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  source_anchor_person_id   UUID REFERENCES people(id) ON DELETE SET NULL,
  created_relationship_id   UUID REFERENCES person_relationships(id) ON DELETE SET NULL,
  linking_admin_id         UUID NOT NULL REFERENCES admins(id),
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at              TIMESTAMPTZ,
  reversed_by              UUID REFERENCES admins(id),
  reversal_notes           TEXT
);
CREATE INDEX IF NOT EXISTS tree_links_source_idx ON tree_links (source_tree_id, status);
CREATE INDEX IF NOT EXISTS tree_links_target_idx ON tree_links (target_tree_id, status);

-- Immutable decision history for every verification/revision.
CREATE TABLE IF NOT EXISTS verification_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_tree_id  UUID NOT NULL REFERENCES family_trees(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  admin_id        UUID NOT NULL REFERENCES admins(id),
  decision        TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'correction_required', 'under_review')),
  remarks         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS verification_records_tree_idx ON verification_records (family_tree_id, created_at DESC);

-- Canonical people carry their tree, role, optional spouse details and the
-- gotra a daughter married into. Parent-child edges stay in
-- person_relationships (already cycle/duplicate protected).
ALTER TABLE people ADD COLUMN IF NOT EXISTS family_tree_id UUID REFERENCES family_trees(id) ON DELETE SET NULL;
ALTER TABLE people ADD COLUMN IF NOT EXISTS wife_name TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS wife_gotra TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS married_gotra TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS member_type TEXT
  CHECK (member_type IN ('root', 'son', 'daughter') OR member_type IS NULL);
ALTER TABLE people ADD COLUMN IF NOT EXISTS birth_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS people_family_tree_idx ON people (family_tree_id);
CREATE INDEX IF NOT EXISTS people_tree_member_idx ON people (family_tree_id, member_type);

-- ── Security / privacy hardening (2026-11-20) ───────────────────────────────
-- Edit tokens are bearer credentials.  They expire, can be revoked by their
-- holder, and are rotated when a tree is submitted for verification.
ALTER TABLE family_trees ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE family_trees ADD COLUMN IF NOT EXISTS token_revoked_at TIMESTAMPTZ;
ALTER TABLE family_trees ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE family_trees ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE family_trees ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMPTZ;
UPDATE family_trees
   SET token_expires_at = COALESCE(token_expires_at, created_at + INTERVAL '30 days')
 WHERE token_expires_at IS NULL;
CREATE INDEX IF NOT EXISTS family_trees_token_valid_idx
  ON family_trees (edit_token) WHERE token_revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS family_trees_privacy_idx
  ON family_trees (delete_requested_at) WHERE delete_requested_at IS NOT NULL;

-- Durable logout/session revocation (process-local sets are not enough).
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         TEXT PRIMARY KEY,
  admin_id    UUID REFERENCES admins(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revoked_tokens_expires_idx ON revoked_tokens (expires_at);

-- Contributor data requests.  Verified genealogical records are archived, so
-- a deletion request is queued for admin review instead of silently erasing
-- public history; draft/pending trees are anonymised immediately in the API.
CREATE TABLE IF NOT EXISTS privacy_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_tree_id  UUID NOT NULL REFERENCES family_trees(id) ON DELETE CASCADE,
  request_type    TEXT NOT NULL CHECK (request_type IN ('delete', 'rectify')),
  details         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'fulfilled', 'rejected')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at    TIMESTAMPTZ,
  fulfilled_by    UUID REFERENCES admins(id)
);
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx ON privacy_requests (status, created_at DESC);

-- Verification history must be append-only.
CREATE OR REPLACE FUNCTION prevent_verification_record_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'verification records are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS verification_records_immutable ON verification_records;
CREATE TRIGGER verification_records_immutable
  BEFORE UPDATE OR DELETE ON verification_records
  FOR EACH ROW EXECUTE FUNCTION prevent_verification_record_mutation();

-- Graph invariants at the database level.  Application validation still runs
-- first, but concurrent writes can no longer create a cycle or a third
-- verified biological parent.
CREATE OR REPLACE FUNCTION enforce_genealogy_integrity()
RETURNS trigger AS $$
DECLARE
  parent_count INTEGER;
  cyclic BOOLEAN;
BEGIN
  IF NEW.status = 'verified' AND NEW.relation_type = 'biological' THEN
    SELECT COUNT(*) INTO parent_count
      FROM person_relationships
     WHERE child_id = NEW.child_id
       AND relation_type = 'biological'
       AND status = 'verified'
       AND (NEW.id IS NULL OR id <> NEW.id);
    IF parent_count >= 2 THEN
      RAISE EXCEPTION 'a person cannot have more than two verified biological parents';
    END IF;
    WITH RECURSIVE ancestors AS (
      SELECT parent_id AS id, 1 AS depth
        FROM person_relationships
       WHERE child_id = NEW.parent_id AND status = 'verified'
      UNION ALL
      SELECT r.parent_id, a.depth + 1
        FROM ancestors a
        JOIN person_relationships r ON r.child_id = a.id AND r.status = 'verified'
       WHERE a.depth < 100
    )
    SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = NEW.child_id) INTO cyclic;
    IF cyclic THEN
      RAISE EXCEPTION 'relationship would create a circular genealogy';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS person_relationships_integrity ON person_relationships;
CREATE TRIGGER person_relationships_integrity
  BEFORE INSERT OR UPDATE ON person_relationships
  FOR EACH ROW EXECUTE FUNCTION enforce_genealogy_integrity();

-- Query indexes that match the actual ILIKE / sort patterns used by the API.
CREATE INDEX IF NOT EXISTS submissions_created_idx ON submissions (submitted_at DESC);
CREATE INDEX IF NOT EXISTS contributions_submitted_idx ON genealogy_contributions (submitted_at DESC);
CREATE INDEX IF NOT EXISTS people_created_idx ON people (created_at DESC);

-- Schema version ledger.  Future changes should append a new version row.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations (version)
VALUES ('2026-11-20-security-privacy')
ON CONFLICT (version) DO NOTHING;
