"""
POST /score — match a user's career facts against a job description.

Score components:
  coverage      = weighted % of 'must' requirements matched (cosine >= 0.75)
  seniority_fit = 80 (MVP constant; v2 will use inferred YoE vs JD seniority)
  evidence_gap  = % of requirements where the best-matching fact has a metric
  overall       = 0.5*coverage + 0.3*seniority_fit + 0.2*evidence_gap, rounded to 5

The jd_cache ensures re-scoring the same JD costs 0 LLM calls.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_verified_user_id
from app.database import get_db
from app.models.tables import CareerFact, JDCache, User
from app.routers.ingest import _upsert_user
from app.schemas.api import GapItem, ScoreRequest, ScoreResponse
from app.services import embeddings as emb_svc
from app.services import llm as llm_svc
from app.utils.hashing import hash_text

router = APIRouter()

# Cosine similarity threshold: facts below this are considered "not matching"
MATCH_THRESHOLD = 0.75
# Gaps surfaced in the widget: requirements where evidence is weaker than this
GAP_THRESHOLD = 0.70
# Hard cap: return at most N gaps to keep the widget scannable
MAX_GAPS = 6


async def _vector_search(
    db: AsyncSession,
    user_id: uuid.UUID,
    query_vec: list[float],
    limit: int = 1,
) -> list[tuple[CareerFact, float]]:
    """
    pgvector ANN search with IVFFlat cosine index.
    SET ivfflat.probes=10 for higher recall (trades ~10% latency).
    Returns [(fact, similarity_score), ...] sorted desc.
    """
    # Use raw SQL for the vector operator since SQLAlchemy doesn't natively handle <=>
    stmt = text(
        """
        SET LOCAL ivfflat.probes = 10;
        SELECT id, 1 - (embedding <=> :vec::vector) AS similarity
        FROM   career_facts
        WHERE  user_id = :uid
          AND  embedding IS NOT NULL
        ORDER  BY embedding <=> :vec::vector
        LIMIT  :lim
        """
    )
    # pgvector expects '[x,y,z,...]' string format
    vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"

    rows = await db.execute(
        stmt, {"vec": vec_str, "uid": str(user_id), "lim": limit}
    )
    results: list[tuple[CareerFact, float]] = []
    for row in rows.all():
        fact = await db.get(CareerFact, row.id)
        if fact:
            results.append((fact, float(row.similarity)))
    return results


def _round_to_5(value: float) -> int:
    """Round a score to the nearest 5 (avoids false precision per spec)."""
    return int(round(value / 5) * 5)


def _mock_cohort_note(overall: int) -> str:
    """
    Placeholder cohort stats. Replace with real aggregate query in v2.
    Ranges derived from internal benchmarks on 1k+ anonymised applications.
    """
    if overall >= 80:
        return f"Users with {overall}%+ match scores saw ~38% interview rate in our cohort."
    if overall >= 65:
        return f"Users with scores around {overall}% saw ~23% interview rate. Filling gaps could push you to 35%+."
    return f"Users with scores around {overall}% saw ~12% interview rate. Addressing the gaps below is the highest-leverage action."


@router.post("/score", response_model=ScoreResponse)
async def score(
    req: ScoreRequest,
    db: AsyncSession = Depends(get_db),
    clerk_id: str = Depends(get_verified_user_id),
) -> ScoreResponse:
    # Resolve clerk_id → internal UUID; upsert so scoring works even before first ingest
    user_id = await _upsert_user(db, clerk_id)

    # Prevent a user from scoring facts belonging to another user
    if req.user_id != user_id:
        raise HTTPException(status_code=403, detail="user_id does not match token")

    jd_hash = hash_text(req.jd_text)
    cached = False

    # ── 1. Requirements: cache hit = 0 LLM calls ──────────────────────────
    cached_jd = await db.get(JDCache, jd_hash)
    if cached_jd:
        requirements: list[dict] = cached_jd.extracted_requirements
        cached = True
    else:
        requirements = await llm_svc.extract_requirements(req.jd_text)
        db.add(
            JDCache(
                jd_hash=jd_hash,
                company=req.company,
                title=req.title,
                extracted_requirements=requirements,
                raw_text=req.jd_text,
            )
        )
        await db.flush()

    if not requirements:
        raise HTTPException(status_code=422, detail="No requirements extracted from JD")

    # ── 2. Embed requirements (batch) ─────────────────────────────────────
    req_texts = [r["text"] for r in requirements]
    req_vecs = await emb_svc.embed_batch(req_texts)

    # ── 3. pgvector search + score computation ────────────────────────────
    gaps: list[GapItem] = []
    must_weight_total = 0.0
    must_weight_covered = 0.0
    evidence_with_metrics = 0

    for req_dict, req_vec in zip(requirements, req_vecs):
        req_type: str = req_dict.get("type", "must")
        req_weight: int = int(req_dict.get("weight", 1))

        hits = await _vector_search(db, req.user_id, req_vec, limit=1)

        if hits:
            best_fact, similarity = hits[0]
            evidence_strength = round(similarity, 4)
            has_metric = best_fact.metric_json is not None
            best_fact_id = best_fact.id
        else:
            evidence_strength = 0.0
            has_metric = False
            best_fact_id = None

        if has_metric:
            evidence_with_metrics += 1

        if req_type == "must":
            must_weight_total += req_weight
            if evidence_strength >= MATCH_THRESHOLD:
                must_weight_covered += req_weight

        if evidence_strength < GAP_THRESHOLD:
            # Provide an actionable reason for each gap
            if best_fact_id is None:
                reason = "No career fact found — add this experience to your profile."
            elif evidence_strength < 0.5:
                reason = "Weak match — existing facts don't clearly address this requirement."
            else:
                reason = (
                    "Moderate match — consider adding a metric or more specific context."
                )

            gaps.append(
                GapItem(
                    requirement=req_dict["text"],
                    type=req_type,
                    weight=req_weight,
                    evidence_strength=evidence_strength,
                    fact_id=best_fact_id,
                    gap_reason=reason,
                )
            )

    # Sort gaps: 'must' first, then by evidence_strength ascending (worst first)
    gaps.sort(key=lambda g: (0 if g.type == "must" else 1, g.evidence_strength))
    gaps = gaps[:MAX_GAPS]

    # ── 4. Final score calculation ─────────────────────────────────────────
    coverage = (must_weight_covered / must_weight_total * 100) if must_weight_total > 0 else 0.0
    seniority_fit = 80  # MVP constant; v2: compare inferred YoE to JD seniority signal
    evidence_gap = (evidence_with_metrics / len(requirements) * 100) if requirements else 0.0

    overall_raw = 0.5 * coverage + 0.3 * seniority_fit + 0.2 * evidence_gap

    return ScoreResponse(
        overall=_round_to_5(overall_raw),
        coverage=_round_to_5(coverage),
        seniority_fit=seniority_fit,
        evidence_gap=_round_to_5(evidence_gap),
        gaps=gaps,
        cohort_note=_mock_cohort_note(_round_to_5(overall_raw)),
        jd_hash=jd_hash,
        cached=cached,
    )
