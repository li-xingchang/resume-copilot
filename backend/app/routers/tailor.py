"""
POST /tailor — retrieve, rerank, and rewrite resume bullets using only verified facts.

Retrieval pipeline (top-50 facts, then reranked):
  score = 0.6 * cosine_similarity
        + 0.3 * bullet_performance.lift_score   (proven interview conversion)
        + 0.1 * recency_score                   (days since last used, decayed)

The LLM receives only the top-N reranked facts and must cite every bullet.
"""
import math
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tables import BulletPerformance, CareerFact, JDCache, ResumeVersion, User
from app.schemas.api import DiffItem, TailorRequest, TailorResponse
from app.services import embeddings as emb_svc
from app.services import llm as llm_svc
from app.utils.hashing import hash_bullet

router = APIRouter()

RETRIEVE_LIMIT = 50     # ANN candidates before reranking
RERANK_LIMIT = 25       # facts sent to the LLM (context budget)
RECENCY_HALF_LIFE_DAYS = 90.0   # lift_score decays with this half-life


def _recency_score(last_used_at: datetime | None) -> float:
    """Exponential decay from last_used_at. Returns 0-1."""
    if last_used_at is None:
        return 0.0
    age_days = (datetime.now(timezone.utc) - last_used_at).days
    return math.exp(-math.log(2) * age_days / RECENCY_HALF_LIFE_DAYS)


async def _retrieve_and_rerank(
    db: AsyncSession,
    user_id: uuid.UUID,
    jd_requirements: list[dict],
    focus_requirement: str | None,
) -> list[dict]:
    """
    1. Embed all requirements (or just focus_requirement) and run ANN retrieval.
    2. Aggregate cosine scores across requirements per fact (max pooling).
    3. Join with bullet_performance for lift_score.
    4. Compute composite rerank score.
    5. Return top-RERANK_LIMIT facts as dicts ready for the LLM prompt.
    """
    # Build a combined query vector: average of all requirement embeddings,
    # with the focus requirement upweighted 2x if provided.
    vecs = await emb_svc.embed_batch([r["text"] for r in jd_requirements])

    if focus_requirement:
        focus_vec = await emb_svc.embed_text(focus_requirement)
        # 2x weight on focus requirement by duplicating it
        vecs.append(focus_vec)
        vecs.append(focus_vec)

    # Average embedding vector
    dim = len(vecs[0])
    avg_vec = [sum(v[i] for v in vecs) / len(vecs) for i in range(dim)]
    vec_str = "[" + ",".join(str(x) for x in avg_vec) + "]"

    # ANN retrieval
    rows = await db.execute(
        text(
            """
            SET LOCAL ivfflat.probes = 15;
            SELECT id,
                   1 - (embedding <=> :vec::vector) AS cosine
            FROM   career_facts
            WHERE  user_id = :uid
              AND  embedding IS NOT NULL
            ORDER  BY embedding <=> :vec::vector
            LIMIT  :lim
            """
        ),
        {"vec": vec_str, "uid": str(user_id), "lim": RETRIEVE_LIMIT},
    )
    candidate_rows = rows.all()
    if not candidate_rows:
        return []

    # Fetch bullet_performance for all candidates in one query
    fact_ids = [r.id for r in candidate_rows]
    cosine_map: dict[uuid.UUID, float] = {r.id: float(r.cosine) for r in candidate_rows}

    bp_rows = await db.execute(
        select(BulletPerformance).where(BulletPerformance.fact_id.in_(fact_ids))
    )
    bp_map: dict[uuid.UUID, BulletPerformance] = {
        bp.fact_id: bp for bp in bp_rows.scalars()
    }

    # Rerank
    scored: list[tuple[float, uuid.UUID]] = []
    for fact_id in fact_ids:
        cosine = cosine_map[fact_id]
        bp = bp_map.get(fact_id)
        lift = bp.lift_score if bp else 0.0
        recency = _recency_score(bp.last_used_at if bp else None)
        composite = 0.6 * cosine + 0.3 * lift + 0.1 * recency
        scored.append((composite, fact_id))

    scored.sort(reverse=True)
    top_ids = [fid for _, fid in scored[:RERANK_LIMIT]]

    # Fetch full fact objects
    facts_out = []
    for fid in top_ids:
        fact = await db.get(CareerFact, fid)
        if fact:
            facts_out.append(
                {
                    "id": str(fact.id),
                    "type": fact.type,
                    "canonical_text": fact.canonical_text,
                    "metric_json": fact.metric_json,
                    "is_verified": fact.is_verified,
                }
            )
    return facts_out


@router.post("/tailor", response_model=TailorResponse)
async def tailor(req: TailorRequest, db: AsyncSession = Depends(get_db)) -> TailorResponse:
    user = await db.get(User, req.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    cached_jd = await db.get(JDCache, req.jd_hash)
    if not cached_jd:
        raise HTTPException(
            status_code=404,
            detail="JD not found in cache. Call POST /score first.",
        )

    requirements: list[dict] = cached_jd.extracted_requirements

    # Retrieve and rerank facts
    top_facts = await _retrieve_and_rerank(
        db, req.user_id, requirements, req.focus_requirement
    )
    if not top_facts:
        raise HTTPException(
            status_code=422,
            detail="No career facts found. Upload your resume via POST /ingest first.",
        )

    # LLM rewrite — truthfulness enforced by prompt
    llm_result = await llm_svc.tailor_resume(top_facts, requirements, req.focus_requirement)

    raw_diff: list[dict] = llm_result.get("diff", [])
    markdown_content: str = llm_result.get("markdown_content", "")

    # Collect all cited fact IDs for citation_refs column
    all_cited_ids: list[uuid.UUID] = []
    diff_items: list[DiffItem] = []
    for item in raw_diff:
        fact_ids = [uuid.UUID(fid) for fid in item.get("fact_ids", []) if fid]
        all_cited_ids.extend(fact_ids)
        diff_items.append(
            DiffItem(
                section=item.get("section", "Experience"),
                bullet_text=item.get("bullet_text", ""),
                fact_ids=fact_ids,
                action=item.get("action", "modified"),
                original_text=item.get("original_text"),
            )
        )

    # Persist new resume version
    # Find parent: latest version for this user (or null if first tailor)
    latest = await db.execute(
        select(ResumeVersion)
        .where(ResumeVersion.user_id == req.user_id)
        .order_by(ResumeVersion.created_at.desc())
        .limit(1)
    )
    parent_version = latest.scalars().first()

    new_version = ResumeVersion(
        user_id=req.user_id,
        parent_id=parent_version.id if parent_version else None,
        jd_hash=req.jd_hash,
        company=cached_jd.company,
        title=cached_jd.title,
        diff_json={"diff": [d.model_dump() for d in diff_items]},
        citation_refs=list(set(all_cited_ids)),
        markdown_content=markdown_content,
        pdf_url=None,   # PDF generation (e.g. WeasyPrint) is an async job; v2
    )
    db.add(new_version)
    await db.flush()

    # Update bullet_performance lift scores (Laplace-smoothed)
    for item in diff_items:
        for fid in item.fact_ids:
            bh = hash_bullet(item.bullet_text)
            bp = await db.get(BulletPerformance, bh)
            if bp:
                bp.times_shown += 1
                bp.lift_score = (bp.interviews + 1) / (bp.times_shown + 2)
                from datetime import timezone
                bp.last_used_at = datetime.now(timezone.utc)
            else:
                db.add(
                    BulletPerformance(
                        bullet_hash=bh,
                        fact_id=fid,
                        times_shown=1,
                        interviews=0,
                        lift_score=1 / 3,   # Laplace prior: 1/(1+2)
                    )
                )

    await db.flush()

    return TailorResponse(
        version_id=new_version.id,
        diff=diff_items,
        markdown_content=markdown_content,
        pdf_url=None,
        citation_count=len(set(all_cited_ids)),
    )
