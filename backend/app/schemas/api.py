"""
Pydantic v2 request/response schemas for all API endpoints.
Compatible with Python 3.9+ (uses Optional instead of X | None syntax).
"""
import uuid
from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# /ingest
# ---------------------------------------------------------------------------

class CareerFactOut(BaseModel):
    id: uuid.UUID
    type: Literal["role", "achievement", "skill", "education", "certification", "project"]
    canonical_text: str
    metric_json: Optional[dict]
    is_verified: bool
    source_section: Optional[str]


class IngestResponse(BaseModel):
    fact_count: int
    facts: List[CareerFactOut]


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
    fact_id: Optional[uuid.UUID]
    gap_reason: str


class ScoreResponse(BaseModel):
    overall: int
    coverage: int
    seniority_fit: int
    evidence_gap: int
    gaps: List[GapItem]
    cohort_note: str
    jd_hash: str
    cached: bool = False


# ---------------------------------------------------------------------------
# /tailor
# ---------------------------------------------------------------------------

class TailorRequest(BaseModel):
    user_id: uuid.UUID
    jd_hash: str
    focus_requirement: Optional[str] = None


class DiffItem(BaseModel):
    section: str
    bullet_text: str
    fact_ids: List[uuid.UUID]
    action: Literal["added", "removed", "modified"]
    original_text: Optional[str] = None


class TailorResponse(BaseModel):
    version_id: uuid.UUID
    diff: List[DiffItem]
    markdown_content: str
    pdf_url: Optional[str]
    citation_count: int


# ---------------------------------------------------------------------------
# /versions
# ---------------------------------------------------------------------------

class VersionNode(BaseModel):
    id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    jd_hash: Optional[str]
    company: Optional[str]
    title: Optional[str]
    created_at: datetime
    diff_summary: str
    application_status: Optional[str]


class VersionGraphResponse(BaseModel):
    nodes: List[VersionNode]


# ---------------------------------------------------------------------------
# /approve
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
# /audit
# ---------------------------------------------------------------------------

class AuditRequest(BaseModel):
    user_id: uuid.UUID
    application_id: Optional[uuid.UUID] = None
    action_type: str
    target_domain: str
    metadata: Optional[dict] = None
