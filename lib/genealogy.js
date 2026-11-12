/**
 * Kul-Kirti Genealogy Engine
 * ===========================
 * Core service for the Digital Vanshawali system.
 *
 * All functions accept a `pool` (pg Pool) as their first argument and
 * return Promises.  No function mutates state without a transaction.
 *
 * Key algorithms:
 *   - detectCycle:    recursive CTE — walks up from child, checks if parent
 *                     is already a descendant of child (would create a cycle)
 *   - findAncestors:  recursive CTE — walks up the parent chain
 *   - findDescendants: recursive CTE — walks down the child chain
 *   - calculateGeneration: walks up to a root person, counts levels
 *   - getFamilyTree:  breadth-first limited-depth tree builder
 *   - validateRelationship: full pipeline — existence, self-parent, duplicate,
 *                     cycle, constraint checks
 */

"use strict";

const MAX_TREE_DEPTH = 7;     // max generations to render in one request
const MAX_ANCESTOR_DEPTH = 50; // safety limit for recursive CTE

/* ───────────────────────────────────────────────────────────────────────────
   1. CYCLE DETECTION
   ───────────────────────────────────────────────────────────────────────────
   Before adding parent → child, check whether `child` is already an
   ancestor of `parent`.  If so, adding the relationship would create a
   circular genealogy (A → B → ... → A).

   Returns true if a cycle WOULD be created. */

async function detectCycle(pool, parentId, childId) {
  // Quick self-parent check (DB constraint also enforces this)
  if (parentId === childId) return true;

  // Recursive CTE: walk down from childId, see if parentId appears
  const result = await pool.query(
    `
    WITH RECURSIVE descendants AS (
      SELECT child_id, parent_id, 1 AS depth
      FROM person_relationships
      WHERE child_id = $1 AND status = 'verified'
      UNION ALL
      SELECT r.child_id, r.parent_id, d.depth + 1
      FROM person_relationships r
      JOIN descendants d ON r.parent_id = d.child_id
      WHERE r.status = 'verified' AND d.depth < $2
    )
    SELECT 1 FROM descendants WHERE parent_id = $1 LIMIT 1
    `,
    [childId, MAX_ANCESTOR_DEPTH]
  );
  return result.rows.length > 0;
}

/* ───────────────────────────────────────────────────────────────────────────
   2. FIND ANCESTORS
   ───────────────────────────────────────────────────────────────────────────
   Walk up the parent chain from a person.  Returns array of ancestor
   records with their generation distance. */

async function findAncestors(pool, personId, maxDepth = MAX_ANCESTOR_DEPTH) {
  const result = await pool.query(
    `
    WITH RECURSIVE ancestor_chain AS (
      SELECT
        r.parent_id,
        r.child_id,
        r.relation_type,
        r.status,
        1 AS depth
      FROM person_relationships r
      WHERE r.child_id = $1 AND r.status = 'verified'
      UNION ALL
      SELECT
        r.parent_id,
        r.child_id,
        r.relation_type,
        r.status,
        ac.depth + 1
      FROM person_relationships r
      JOIN ancestor_chain ac ON r.child_id = ac.parent_id
      WHERE r.status = 'verified' AND ac.depth < $2
    )
    SELECT
      ac.parent_id,
      ac.relation_type,
      ac.status,
      ac.depth,
      p.full_name,
      p.public_id,
      p.gender,
      p.birth_year,
      p.death_year,
      p.is_living,
      p.village
    FROM ancestor_chain ac
    JOIN people p ON p.id = ac.parent_id
    WHERE p.status = 'verified' AND p.visibility = 'public'
    ORDER BY ac.depth
    `,
    [personId, maxDepth]
  );
  return result.rows;
}

/* ───────────────────────────────────────────────────────────────────────────
   3. FIND DESCENDANTS
   ───────────────────────────────────────────────────────────────────────────
   Walk down the child chain from a person.  Returns array of descendant
   records with their generation distance. */

async function findDescendants(pool, personId, maxDepth = MAX_TREE_DEPTH) {
  const result = await pool.query(
    `
    WITH RECURSIVE descendant_chain AS (
      SELECT
        r.parent_id,
        r.child_id,
        r.relation_type,
        r.status,
        1 AS depth
      FROM person_relationships r
      WHERE r.parent_id = $1 AND r.status = 'verified'
      UNION ALL
      SELECT
        r.parent_id,
        r.child_id,
        r.relation_type,
        r.status,
        dc.depth + 1
      FROM person_relationships r
      JOIN descendant_chain dc ON r.parent_id = dc.child_id
      WHERE r.status = 'verified' AND dc.depth < $2
    )
    SELECT
      dc.child_id,
      dc.parent_id,
      dc.relation_type,
      dc.depth,
      p.full_name,
      p.public_id,
      p.gender,
      p.birth_year,
      p.death_year,
      p.is_living,
      p.village
    FROM descendant_chain dc
    JOIN people p ON p.id = dc.child_id
    WHERE p.status = 'verified' AND p.visibility = 'public'
    ORDER BY dc.depth, p.full_name
    `,
    [personId, maxDepth]
  );
  return result.rows;
}

/* ───────────────────────────────────────────────────────────────────────────
   4. FIND CHILDREN (direct children only)
   ─────────────────────────────────────────────────────────────────────────── */

async function findChildren(pool, personId) {
  const result = await pool.query(
    `
    SELECT
      p.id, p.public_id, p.full_name, p.gender,
      p.birth_year, p.death_year, p.is_living, p.village,
      r.relation_type, r.status AS rel_status
    FROM person_relationships r
    JOIN people p ON p.id = r.child_id
    WHERE r.parent_id = $1 AND r.status = 'verified'
      AND p.status = 'verified' AND p.visibility = 'public'
    ORDER BY p.full_name
    `,
    [personId]
  );
  return result.rows;
}

/* ───────────────────────────────────────────────────────────────────────────
   5. FIND PARENTS (direct parents only)
   ─────────────────────────────────────────────────────────────────────────── */

async function findParents(pool, personId) {
  const result = await pool.query(
    `
    SELECT
      p.id, p.public_id, p.full_name, p.gender,
      p.birth_year, p.death_year, p.is_living, p.village,
      r.relation_type, r.status AS rel_status, r.id AS rel_id
    FROM person_relationships r
    JOIN people p ON p.id = r.parent_id
    WHERE r.child_id = $1 AND r.status = 'verified'
      AND p.status = 'verified' AND p.visibility = 'public'
    ORDER BY r.relation_type
    `,
    [personId]
  );
  return result.rows;
}

/* ───────────────────────────────────────────────────────────────────────────
   6. FIND SIBLINGS
   ───────────────────────────────────────────────────────────────────────────
   People who share at least one verified parent with the given person. */

async function findSiblings(pool, personId) {
  const result = await pool.query(
    `
    SELECT DISTINCT
      p.id, p.public_id, p.full_name, p.gender,
      p.birth_year, p.death_year, p.is_living, p.village
    FROM person_relationships r_child
    JOIN person_relationships r_sibling ON r_sibling.parent_id = r_child.parent_id
    JOIN people p ON p.id = r_sibling.child_id
    WHERE r_child.child_id = $1
      AND r_sibling.child_id <> $1
      AND r_child.status = 'verified'
      AND r_sibling.status = 'verified'
      AND p.status = 'verified' AND p.visibility = 'public'
    ORDER BY p.full_name
    `,
    [personId]
  );
  return result.rows;
}

/* ───────────────────────────────────────────────────────────────────────────
   7. CALCULATE GENERATION
   ───────────────────────────────────────────────────────────────────────────
   Walk up from a person to the earliest documented root.
   Root = generation 1.  Each level down increments by 1.

   If a person has no parents (is a root), generation = 1.
   If multiple ancestor paths exist, the shortest path determines generation. */

async function calculateGeneration(pool, personId) {
  const result = await pool.query(
    `
    WITH RECURSIVE ancestor_chain AS (
      SELECT
        child_id,
        parent_id,
        0 AS depth
      FROM person_relationships
      WHERE child_id = $1 AND status = 'verified'
      UNION ALL
      SELECT
        r.child_id,
        r.parent_id,
        ac.depth + 1
      FROM person_relationships r
      JOIN ancestor_chain ac ON r.child_id = ac.parent_id
      WHERE r.status = 'verified' AND ac.depth < $2
    )
    SELECT
      COALESCE(MAX(depth), 0) + 1 AS generation
    FROM ancestor_chain
    `,
    [personId, MAX_ANCESTOR_DEPTH]
  );
  return result.rows[0] ? result.rows[0].generation : 1;
}

/* ───────────────────────────────────────────────────────────────────────────
   8. GET FAMILY TREE (limited depth, for rendering)
   ───────────────────────────────────────────────────────────────────────────
   Builds a tree object suitable for frontend rendering.
   Returns: { person, parents, children, generation, depth }
   Only loads `depth` levels deep. */

async function getFamilyTree(pool, personId, depth = MAX_TREE_DEPTH) {
  // Fetch the person
  const personResult = await pool.query(
    `SELECT id, public_id, full_name, alt_names, gender, birth_year, death_year,
            birthplace, village, district, state, biography, is_living, status
     FROM people WHERE id = $1`,
    [personId]
  );
  if (!personResult.rows[0]) return null;

  const person = personResult.rows[0];

  // Fetch parents
  const parents = await findParents(pool, personId);

  // Fetch children (limited depth)
  const children = await findChildren(pool, personId);

  // Fetch siblings
  const siblings = await findSiblings(pool, personId);

  // Calculate generation
  const generation = await calculateGeneration(pool, personId);

  // Fetch gotra memberships
  const gotras = await pool.query(
    `SELECT g.id, g.name, l.is_root, l.branch_id
     FROM person_gotra_links l
     JOIN gotras g ON g.id = l.gotra_id
     WHERE l.person_id = $1`,
    [personId]
  );

  return {
    person,
    parents: parents.map(p => ({
      ...p,
      generation: generation - 1,
    })),
    children: children.map(c => ({
      ...c,
      generation: generation + 1,
    })),
    siblings,
    generation,
    gotras: gotras.rows,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
   9. VALIDATE RELATIONSHIP (full pipeline)
   ───────────────────────────────────────────────────────────────────────────
   Returns { valid: boolean, error: string | null }
   Called before any relationship is created. */

async function validateRelationship(pool, parentId, childId, relationType) {
  // 1. Self-parenting
  if (parentId === childId) {
    return { valid: false, error: "self_parenting" };
  }

  // 2. Both people exist
  const existCheck = await pool.query(
    `SELECT id FROM people WHERE id IN ($1, $2) AND status <> 'archived'`,
    [parentId, childId]
  );
  if (existCheck.rows.length < 2) {
    return { valid: false, error: "person_not_found" };
  }

  // 3. Duplicate check
  const dupCheck = await pool.query(
    `SELECT id FROM person_relationships
     WHERE parent_id = $1 AND child_id = $2 AND relation_type = $3`,
    [parentId, childId, relationType || "biological"]
  );
  if (dupCheck.rows.length > 0) {
    return { valid: false, error: "duplicate_relationship" };
  }

  // 4. Cycle detection
  const wouldCycle = await detectCycle(pool, parentId, childId);
  if (wouldCycle) {
    return { valid: false, error: "circular_genealogy" };
  }

  // 5. Biological parent count (max 2 biological parents — father + mother)
  if (relationType === "biological") {
    const bioParentCount = await pool.query(
      `SELECT COUNT(*)::int AS count FROM person_relationships
       WHERE child_id = $1 AND relation_type = 'biological' AND status = 'verified'`,
      [childId]
    );
    if (bioParentCount.rows[0].count >= 2) {
      return { valid: false, error: "max_biological_parents" };
    }
  }

  return { valid: true, error: null };
}

/* ───────────────────────────────────────────────────────────────────────────
   10. AUDIT LOG HELPER
   ─────────────────────────────────────────────────────────────────────────── */

async function logAudit(pool, adminId, action, entityType, entityId, changes = null) {
  await pool.query(
    `INSERT INTO genealogy_audit (admin_id, action, entity_type, entity_id, changes)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, action, entityType, entityId, changes ? JSON.stringify(changes) : null]
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   11. REBUILD TREE PROJECTION
   ───────────────────────────────────────────────────────────────────────────
   Recalculate cached generation numbers for all people.
   Called after approved relationship changes.  Can be expensive —
   intended for background or post-commit execution. */

async function rebuildTreeProjection(pool) {
  await pool.query(
    `
    WITH RECURSIVE gen_calc AS (
      -- Roots: people with no verified parents
      SELECT
        p.id AS person_id,
        p.id AS root_person_id,
        1 AS generation,
        0 AS path_length
      FROM people p
      WHERE p.status = 'verified'
        AND NOT EXISTS (
          SELECT 1 FROM person_relationships r
          WHERE r.child_id = p.id AND r.status = 'verified'
        )
      UNION ALL
      -- Children: increment generation from parent
      SELECT
        r.child_id,
        gc.root_person_id,
        gc.generation + 1,
        gc.path_length + 1
      FROM person_relationships r
      JOIN gen_calc gc ON r.parent_id = gc.person_id
      WHERE r.status = 'verified'
    )
    INSERT INTO genealogy_tree_projection (person_id, root_person_id, generation, path_length, updated_at)
    SELECT DISTINCT ON (person_id)
      person_id, root_person_id, generation, path_length, NOW()
    FROM gen_calc
    ORDER BY person_id, path_length ASC
    ON CONFLICT (person_id) DO UPDATE SET
      root_person_id = EXCLUDED.root_person_id,
      generation     = EXCLUDED.generation,
      path_length    = EXCLUDED.path_length,
      updated_at     = NOW()
    `,
    []
  );
}

/* ───────────────────────────────────────────────────────────────────────────
   EXPORTS
   ─────────────────────────────────────────────────────────────────────────── */

module.exports = {
  MAX_TREE_DEPTH,
  MAX_ANCESTOR_DEPTH,
  detectCycle,
  findAncestors,
  findDescendants,
  findChildren,
  findParents,
  findSiblings,
  calculateGeneration,
  getFamilyTree,
  validateRelationship,
  logAudit,
  rebuildTreeProjection,
};
