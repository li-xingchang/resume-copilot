"""
Pydantic v2 request/response schemas for all API endpoints.
Mirrors the product spec exactly so the frontend can be typed end-to-end.
"""
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# /ingest
# ---------------------------------------------------------------------------

class CareerFactOut(BaseModel):
    id: uuid.UUID
    type: Literal["role", "achievement", "skill", "education", "certification", "project"]
    canonical_text: str
    metric_json: dict | None
    is_verified: bool
    source_section: str | None


class IngestResponse(BaseModel):
    fact_count: int
    facts: list[CareerFactOut]


# ---------------------------------------------------------------------------
# /score
# ---------------------------------------------------------------------------

class ScoreRequest(BaseModel):
    user_id: uuid.UUID
    jd_text: str = Field(..., min_length=50)
    company: str
    title: str


class GapItem(BaseModel):
    requirement: str
    type: Literal["must", "nice"]
    weight: int = Field(ge=1, le=3)
    evidence_strength: float = Field(ge=0.0, le=1.0)
    fact_id: uuid.UUID | None   # best matching fact, if any
    gap_reason: str             # "No fact found" | "Weak match" | "Missing metric"


class ScoreResponse(BaseModel):
    overall: int                # rounded to nearest 5
    coverage: int               # weighted % of 'must' reqs with sim > 0.75
    seniority_fit: int          # 80 for MVP
    evidence_gap: int           # % requirements where best fact has metric_json
    gaps: list[GapItem]
    cohort_note: str
    jd_hash: str
    cached: bool = False        # True if requirements were served from jd_cache


# ---------------------------------------------------------------------------
# /tailor
# ---------------------------------------------------------------------------

class TailorRequest(BaseModel):
    user_id: uuid.UUID
    jd_hash: str
    focus_requirement: str | None = None    # if set, boost this req in reranking


class DiffItem(BaseModel):
    section: str
    bullet_text: str
    fact_ids: list[uuid.UUID]               # citations for this bullet
    action: Literal["added", "removed", "modified"]
    original_text: str | None = None        # for 'modified' items


class TailorResponse(BaseModel):
    version_id: uuid.UUID
    diff: list[DiffItem]
    markdown_content: str
    pdf_url: str | None
    citation_count: int


# ---------------------------------------------------------------------------
# /versions
# ---------------------------------------------------------------------------

class VersionNode(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    jd_hash: str | None
    company: str | None
    title: str | None
    created_at: datetime
    diff_summary: str           # e.g. "+3 bullets, -1 bullet, 2 modified"
    application_status: str | None  # pulled from applications table


class VersionGraphResponse(BaseModel):
    nodes: list[VersionNode]


# ---------------------------------------------------------------------------
# /approve  (extension calls this before pre-filling)
# ---------------------------------------------------------------------------

class ApproveRequest(BaseModel):
    user_id: uuid.UUID
    version_id: uuid.UUID
    jd_hash: str
    company: str
    platform: Literal["greenhouse", "lever", "workday", "linkedin", "other"]
    target_domain: str


class ApproveResponse(BaseModel):
    application_id: uuid.UUID
    status: str


# ---------------------------------------------------------------------------
# /audit  (extension background.ts posts individual field fills)
# ---------------------------------------------------------------------------

class AuditRequest(BaseModel):
    user_id: uuid.UUID
    application_id: uuid.UUID | None
    action_type: str
    target_domain: str
    metadata: dict | None = None
