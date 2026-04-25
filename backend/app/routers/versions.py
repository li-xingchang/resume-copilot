from __future__ import annotations
"""
GET /versions — return the version graph for the timeline UI.
GET /versions/{version_id} — return a single version with full diff.
GET /facts/{fact_id} — return a single career fact (used by CitationBadge).
POST /approve — record that user approved a version for submission.
POST /audit — append an audit log entry (called by extension background.ts).
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_verified_user_id
from app.database import get_db
from app.models.tables import Application, AuditLog, CareerFact, ResumeVersion, User
from app.routers.ingest import _upsert_user
from app.schemas.api import (
    ApproveRequest,
    ApproveResponse,
    AuditRequest,
    VersionGraphResponse,
    VersionNode,
)

router = APIRouter()


def _diff_summary(diff_json: dict | None) -> str:
    if not diff_json:
        return "Original upload"
    diff = diff_json.get("diff", [])
    added = sum(1 for d in diff if d.get("action") == "added")
    removed = sum(1 for d in diff if d.get("action") == "removed")
    modified = sum(1 for d in diff if d.get("action") == "modified")
    parts = []
    if added:
        parts.append(f"+{added}")
    if removed:
        parts.append(f"-{removed}")
    if modified:
        parts.append(f"~{modified}")
    return ", ".join(parts) + " bullets" if parts else "No changes"


@router.get("/facts/{fact_id}", response_model=dict)
async def get_fact(fact_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    """Used by CitationBadge.tsx to show tooltip on hover."""
    fact = await db.get(CareerFact, fact_id)
    if not fact:
        raise HTTPException(status_code=404, detail="Fact not found")
    return {
        "id": str(fact.id),
        "type": fact.type,
        "canonical_text": fact.canonical_text,
        "metric_json": fact.metric_json,
        "is_verified": fact.is_verified,
        "source_section": fact.source_section,
    }


@router.get("/versions", response_model=VersionGraphResponse)
async def list_versions(
    db: AsyncSession = Depends(get_db),
    clerk_id: str = Depends(get_verified_user_id),
) -> VersionGraphResponse:
    user_id = await _upsert_user(db, clerk_id)

    rows = await db.execute(
        select(ResumeVersion)
        .where(ResumeVersion.user_id == user_id)
        .order_by(ResumeVersion.created_at.asc())
    )
    versions = rows.scalars().all()

    # Fetch latest application status per version
    app_rows = await db.execute(
        select(Application).where(Application.user_id == user_id)
    )
    apps: dict[uuid.UUID, str] = {a.version_id: a.status for a in app_rows.scalars()}

    nodes = [
        VersionNode(
            id=v.id,
            parent_id=v.parent_id,
            jd_hash=v.jd_hash,
            company=v.company,
            title=v.title,
            created_at=v.created_at,
            diff_summary=_diff_summary(v.diff_json),
            application_status=apps.get(v.id),
        )
        for v in versions
    ]
    return VersionGraphResponse(nodes=nodes)


@router.get("/versions/{version_id}", response_model=dict)
async def get_version(version_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    version = await db.get(ResumeVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    return {
        "id": str(version.id),
        "parent_id": str(version.parent_id) if version.parent_id else None,
        "jd_hash": version.jd_hash,
        "company": version.company,
        "title": version.title,
        "diff_json": version.diff_json,
        "citation_refs": [str(c) for c in (version.citation_refs or [])],
        "markdown_content": version.markdown_content,
        "pdf_url": version.pdf_url,
        "created_at": version.created_at.isoformat(),
    }


@router.post("/approve", response_model=ApproveResponse)
async def approve(
    req: ApproveRequest,
    db: AsyncSession = Depends(get_db),
    clerk_id: str = Depends(get_verified_user_id),
) -> ApproveResponse:
    """Extension calls this when the user clicks 'Approve & Pre-fill'."""
    user_id = await _upsert_user(db, clerk_id)
    if req.user_id != user_id:
        raise HTTPException(status_code=403, detail="user_id does not match token")
    version = await db.get(ResumeVersion, req.version_id)
    if not version or version.user_id != user_id:
        raise HTTPException(status_code=404, detail="Version not found")

    application = Application(
        user_id=req.user_id,
        version_id=req.version_id,
        jd_hash=req.jd_hash,
        company=req.company,
        platform=req.platform,
        status="pending",
    )
    db.add(application)
    await db.flush()

    # Audit the approval
    db.add(
        AuditLog(
            user_id=req.user_id,
            application_id=application.id,
            action_type="approved",
            target_domain=req.target_domain,
            metadata_json={"version_id": str(req.version_id), "jd_hash": req.jd_hash},
        )
    )

    return ApproveResponse(application_id=application.id, status="pending")


@router.post("/audit", status_code=204, response_model=None)
async def audit(
    req: AuditRequest,
    db: AsyncSession = Depends(get_db),
    clerk_id: str = Depends(get_verified_user_id),
) -> Response:
    """Extension background.ts posts individual field-fill events here."""
    user_id = await _upsert_user(db, clerk_id)
    db.add(
        AuditLog(
            user_id=req.user_id,
            application_id=req.application_id,
            action_type=req.action_type,
            target_domain=req.target_domain,
            metadata_json=req.metadata,
        )
    )
    return Response(status_code=204)
