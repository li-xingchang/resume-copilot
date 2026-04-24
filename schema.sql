-- =============================================================================
-- Resume Intelligence Co-Pilot — Postgres Schema
-- =============================================================================
-- Architecture note: the "memory graph" has three tiers:
--   1. career_facts  — atomic, verifiable truth units with embeddings
--   2. resume_versions — immutable snapshots that CITE career_facts (no hallucinations)
--   3. applications / outcomes — feedback loop that trains bullet_performance lift scores
--
-- The key invariant: every resume bullet traces to >= 1 career_fact_id.
-- The key moat: lift scores compound over time, making older users' resumes
-- objectively better at matching, not just subjectively different.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Users (shadow table for Clerk/NextAuth; clerk_id is the join key)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    clerk_id    TEXT        UNIQUE NOT NULL,
    email       TEXT        UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- career_facts — the immutable memory store
-- Each row is ONE verifiable professional truth: a role, achievement, skill,
-- or certification. The metric_json captures quantitative evidence so we can
-- penalise vague bullets when computing evidence_gap in /score.
-- Embeddings enable pgvector retrieval in /score and /tailor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS career_facts (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Taxonomy used in score breakdown and filtering
    type            TEXT        NOT NULL CHECK (type IN (
                        'role', 'achievement', 'skill', 'education',
                        'certification', 'project')),

    canonical_text  TEXT        NOT NULL,       -- human-readable sentence, LLM-rewritable
    metric_json     JSONB,                      -- {"value":40,"unit":"%","direction":"increase"}
    embedding       vector(1536),               -- text-embedding-3-small output

    -- is_verified = user clicked "Confirm" on /onboard; unverified facts are
    -- surfaced but flagged so the LLM can hedge its language
    is_verified     BOOLEAN     NOT NULL DEFAULT FALSE,

    source_section  TEXT,                       -- original resume section for provenance
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- resume_versions — directed acyclic graph of tailored resumes
-- parent_id = NULL  →  original ingested resume (root node)
-- parent_id = <id>  →  tailored version derived from that parent
-- diff_json stores exactly what changed so /graph can render a diff timeline.
-- citation_refs enforces the "no hallucination" contract:
--   every bullet in this version must trace to a career_fact.id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resume_versions (
    id                  UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id           UUID    REFERENCES resume_versions(id), -- NULL = root
    jd_hash             TEXT,                                   -- NULL = base resume
    company             TEXT,
    title               TEXT,

    -- Structural diff from parent; {"added":[…],"removed":[…],"modified":[…]}
    -- Each item carries {bullet_text, fact_ids[]} for the citation trail.
    diff_json           JSONB,

    citation_refs       UUID[]  NOT NULL DEFAULT '{}',  -- career_fact_ids cited
    markdown_content    TEXT,                           -- full rendered resume
    pdf_url             TEXT,                           -- S3 presigned URL
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- applications — one row per human-approved submit attempt
-- status 'pending' = extension pre-filled but user hasn't submitted yet
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version_id      UUID        NOT NULL REFERENCES resume_versions(id),
    jd_hash         TEXT        NOT NULL,
    company         TEXT        NOT NULL,
    platform        TEXT        NOT NULL CHECK (platform IN (
                        'greenhouse', 'lever', 'workday', 'linkedin', 'other')),
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'submitted', 'withdrawn')),
    submitted_at    TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- outcomes — recruiter signals that close the feedback loop
-- source helps distinguish detected vs manually-entered outcomes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outcomes (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id  UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    event_type      TEXT        NOT NULL CHECK (event_type IN (
                        'view', 'interview', 'rejection', 'offer')),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source          TEXT        -- 'extension_detected' | 'manual' | 'email_parse'
);

-- ---------------------------------------------------------------------------
-- bullet_performance — aggregate lift score per canonical bullet
-- lift_score = smoothed interview-conversion rate for bullets with this hash.
-- The /tailor reranker weights: 0.6*cosine + 0.3*lift_score + 0.1*recency.
-- This is the compound-learning moat: power users' resumes get provably better.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bullet_performance (
    bullet_hash     TEXT        PRIMARY KEY,    -- SHA-256 of canonical_text (normalised)
    fact_id         UUID        REFERENCES career_facts(id),
    times_shown     INTEGER     NOT NULL DEFAULT 0,
    interviews      INTEGER     NOT NULL DEFAULT 0,
    -- Laplace-smoothed: (interviews + 1) / (times_shown + 2)
    lift_score      FLOAT       NOT NULL DEFAULT 0.0,
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- jd_cache — parsed JD requirements keyed by SHA-256 of jd_text
-- Re-scoring the same JD = 0 LLM calls, ~$0.00 marginal cost.
-- extracted_requirements schema:
--   [{id: uuid, text: str, type: "must"|"nice", weight: 1-3}]
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jd_cache (
    jd_hash                 TEXT    PRIMARY KEY,
    company                 TEXT,
    title                   TEXT,
    extracted_requirements  JSONB   NOT NULL,
    raw_text                TEXT    NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- audit_logs — immutable append-only compliance trail
-- Every extension action (show widget, fill field, approve) is logged here.
-- Never deleted; drives the /queue analytics view.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id  UUID        REFERENCES applications(id),
    action_type     TEXT        NOT NULL,   -- 'score_widget_shown' | 'prefill_initiated'
                                            -- | 'field_filled' | 'approved' | 'rate_limited'
    target_domain   TEXT,
    metadata_json   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- career_facts: user-scoped lookups + embedding ANN
CREATE INDEX IF NOT EXISTS idx_cf_user          ON career_facts(user_id);
CREATE INDEX IF NOT EXISTS idx_cf_user_type     ON career_facts(user_id, type);
CREATE INDEX IF NOT EXISTS idx_cf_verified      ON career_facts(user_id, is_verified);

-- IVFFlat cosine index for /score and /tailor ANN searches.
-- lists=100 handles up to ~1M vectors; rebuild with CONCURRENTLY if table grows beyond that.
-- SET ivfflat.probes = 10 at query time for recall/latency balance.
CREATE INDEX IF NOT EXISTS idx_cf_embedding
    ON career_facts USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- resume_versions: graph traversal + JD lookup
CREATE INDEX IF NOT EXISTS idx_rv_user          ON resume_versions(user_id);
CREATE INDEX IF NOT EXISTS idx_rv_parent        ON resume_versions(parent_id);
CREATE INDEX IF NOT EXISTS idx_rv_jd_hash       ON resume_versions(jd_hash);
CREATE INDEX IF NOT EXISTS idx_rv_user_created  ON resume_versions(user_id, created_at DESC);

-- applications + outcomes
CREATE INDEX IF NOT EXISTS idx_app_user         ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_app_status       ON applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_outcomes_app     ON outcomes(application_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_type    ON outcomes(event_type, occurred_at);

-- audit_logs: domain-rate-limit lookups in background.ts
CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_domain     ON audit_logs(target_domain, created_at DESC);

-- =============================================================================
-- Triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION _set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_career_facts_updated_at
    BEFORE UPDATE ON career_facts
    FOR EACH ROW EXECUTE FUNCTION _set_updated_at();
