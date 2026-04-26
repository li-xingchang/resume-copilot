from __future__ import annotations
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
    # pgvector expects '[x,y,z,...]' string format
    vec_str = "[" + ",".join(str(v) for v in query_vec) + "]"

    # SET LOCAL must be a separate statement — cannot be batched with SELECT in asyncpg
    await db.execute(text("SET LOCAL ivfflat.probes = 10"))

    # Use CAST(:vec AS vector) instead of :vec::vector — the :: confuses SQLAlchemy's
    # named-parameter parser, which treats the second colon as a new parameter prefix.
    stmt = text(
        """
        SELECT id, 1 - (embedding <=> CAST(:vec AS vector)) AS similarity
        FROM   career_facts
        WHERE  user_id = :uid
          AND  embedding IS NOT NULL
        ORDER  BY embedding <=> CAST(:vec AS vector)
        LIMIT  :lim
        """
    )

    rows = await db.execute(stmt, {"vec": vec_str, "uid": str(user_id), "lim": limit})
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
    if overall >= 80:
        return f"Users with {overall}%+ match scores saw ~38% interview rate in our cohort."
    if overall >= 65:
        return f"Users with scores around {overall}% saw ~23% interview rate. Filling gaps could push you to 35%+."
    return f"Users with scores around {overall}% saw ~12% interview rate. Addressing the gaps below is the highest-leverage action."


# In-process seniority cache: user_id → {inferred_yoe, highest_level, is_manager}
# Resets on server restart. Good enough for dev; use Redis in prod.
_seniority_cache: dict[str, dict] = {}

LEVEL_RANK = {
    "intern": 0, "junior": 1, "mid": 2, "senior": 3,
    "staff": 4, "principal": 5, "manager": 4,
    "director": 6, "vp": 7, "executive": 8,
}


def _compute_seniority_fit(user_s: dict, jd_s: dict) -> tuple[int, dict]:
    """
    Compare user seniority against JD seniority requirements.
    Returns (score_0_to_100, detail_dict).
    """
    required_yoe: int = jd_s.get("required_yoe") or 0
    user_yoe: int = user_s.get("inferred_yoe") or 0
    jd_level: str = (jd_s.get("level") or "mid").lower()
    user_level: str = (user_s.get("highest_level") or "mid").lower()
    jd_wants_mgr: bool = bool(jd_s.get("is_manager", False))
    user_is_mgr: bool = bool(user_s.get("is_manager", False))

    # YoE score
    if required_yoe == 0:
        yoe_score = 100.0
    else:
        yoe_score = min(user_yoe / required_yoe, 1.0) * 100

    # Level score
    jd_rank = LEVEL_RANK.get(jd_level, 2)
    user_rank = LEVEL_RANK.get(user_level, 2)
    diff = user_rank - jd_rank
    if diff >= 0:
        level_score = 100.0
    elif diff == -1:
        level_score = 75.0
    elif diff == -2:
        level_score = 50.0
    else:
        level_score = 25.0

    # Management score
    if jd_wants_mgr == user_is_mgr:
        mgmt_score = 100.0
    elif jd_wants_mgr and not user_is_mgr:
        mgmt_score = 40.0   # they want a people manager, you're IC
    else:
        mgmt_score = 85.0   # you manage people, they want IC — slight penalty

    composite = 0.5 * yoe_score + 0.3 * level_score + 0.2 * mgmt_score
    detail = {
        "user_yoe": user_yoe,
        "required_yoe": required_yoe,
        "user_level": user_level,
        "jd_level": jd_level,
        "user_is_manager": user_is_mgr,
        "jd_wants_manager": jd_wants_mgr,
        "yoe_score": round(yoe_score),
        "level_score": round(level_score),
        "mgmt_score": round(mgmt_score),
    }
    return _round_to_5(composite), detail


@router.post("/score", response_model=ScoreResponse)
async def score(
    req: ScoreRequest,
    db: AsyncSession = Depends(get_db),
    clerk_id: str = Depends(get_verified_user_id),
) -> ScoreResponse:
    user_id = await _upsert_user(db, clerk_id)

    jd_hash = hash_text(req.jd_text)
    cached = False

    # ── 1. Requirements + seniority: cache hit = 0 LLM calls ─────────────
    cached_jd = await db.get(JDCache, jd_hash)
    if cached_jd:
        stored = cached_jd.extracted_requirements
        # Handle both old format (list) and new format (dict with requirements+seniority)
        if isinstance(stored, list):
            requirements: list[dict] = stored
            jd_seniority: dict = {}
        else:
            requirements = stored.get("requirements", [])
            jd_seniority = stored.get("seniority", {})
        cached = True
    else:
        extracted = await llm_svc.extract_requirements(req.jd_text)
        requirements = extracted["requirements"]
        jd_seniority = extracted["seniority"]
        db.add(
            JDCache(
                jd_hash=jd_hash,
                company=req.company,
                title=req.title,
                extracted_requirements=extracted,   # store full dict incl. seniority
                raw_text=req.jd_text,
            )
        )
        await db.flush()

    if not requirements:
        raise HTTPException(status_code=422, detail="No requirements extracted from JD")

    # ── 2. User seniority (inferred from career facts, cached in-process) ─
    uid_str = str(user_id)
    if uid_str not in _seniority_cache:
        from sqlalchemy import select as sa_select
        fact_rows = await db.execute(
            sa_select(CareerFact).where(
                CareerFact.user_id == user_id,
                CareerFact.type.in_(["role", "achievement", "project"]),
            ).limit(30)
        )
        facts_for_seniority = [
            {"type": f.type, "canonical_text": f.canonical_text}
            for f in fact_rows.scalars()
        ]
        _seniority_cache[uid_str] = await llm_svc.infer_user_seniority(facts_for_seniority)
    user_seniority = _seniority_cache[uid_str]

    # ── 3. Embed requirements (batch) ─────────────────────────────────────
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

        hits = await _vector_search(db, user_id, req_vec, limit=1)

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
    seniority_fit, seniority_detail = _compute_seniority_fit(user_seniority, jd_seniority)
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
        seniority_detail=seniority_detail,
    )
