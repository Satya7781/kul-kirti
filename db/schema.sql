CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin',
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
  reviewed_at TIMESTAMPTZ
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
