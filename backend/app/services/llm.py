from __future__ import annotations
"""
LLM service: GPT-4o-mini calls for requirement extraction and resume tailoring.

Truthfulness contract (enforced in every prompt):
  - The model MUST only reference provided fact_ids.
  - If no fact supports a requirement, it MUST return a gap_reason, not invent text.
"""
import json
import uuid

from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import get_settings
from app.schemas.api import DiffItem, GapItem

settings = get_settings()
_client = AsyncOpenAI(api_key=settings.openai_api_key)


# ---------------------------------------------------------------------------
# Requirement extraction
# ---------------------------------------------------------------------------

EXTRACT_SYSTEM = """You are a technical recruiter parsing a job description.
Return a JSON object with two keys:

"requirements": array of 5-8 objects, each with:
  id: (uuid v4),
  text: (concise 1-sentence requirement),
  type: "must" | "nice",
  weight: 1-3  (1=nice-to-have, 3=critical gate)

"seniority": object with:
  required_yoe: minimum years of experience as integer (null if not specified),
  level: one of "intern" | "junior" | "mid" | "senior" | "staff" | "principal" | "manager" | "director" | "vp" | "executive"
         (infer from language: "senior"→senior, "lead"→staff, "director"→director, "VP"→vp, etc.),
  is_manager: true if role requires managing direct reports

Return ONLY valid JSON. No extra text."""

EXTRACT_USER = """Job Description:
{jd_text}

Extract requirements and seniority as a JSON object."""


async def extract_requirements(jd_text: str) -> dict:
    """
    Extract structured requirements AND seniority metadata from raw JD text.
    Returns {"requirements": [...], "seniority": {...}}
    """
    response = await _client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": EXTRACT_SYSTEM},
            {"role": "user", "content": EXTRACT_USER.format(jd_text=jd_text[:8000])},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
        max_tokens=1200,
    )
    raw = response.choices[0].message.content or "{}"
    parsed = json.loads(raw)

    # Normalise: ensure top-level keys exist
    requirements = parsed.get("requirements", [])
    seniority = parsed.get("seniority", {})

    # If model returned a flat array instead, recover gracefully
    if isinstance(parsed, list):
        requirements = parsed
        seniority = {}

    # Ensure every requirement has a valid UUID
    for item in requirements:
        if "id" not in item or not item["id"]:
            item["id"] = str(uuid.uuid4())

    return {"requirements": requirements, "seniority": seniority}


# ---------------------------------------------------------------------------
# User seniority inference
# ---------------------------------------------------------------------------

SENIORITY_SYSTEM = """You are analysing a professional's career facts to infer seniority.
Return a JSON object with:
  inferred_yoe: estimated total years of professional experience as integer,
  highest_level: the highest seniority level reached, one of:
    "intern" | "junior" | "mid" | "senior" | "staff" | "principal" | "manager" | "director" | "vp" | "executive",
  is_manager: true if they have managed direct reports

Be conservative — infer from titles, scope, and tenure clues in the facts.
Return ONLY valid JSON."""

SENIORITY_USER = """Career facts:
{facts_json}

Infer seniority profile as a JSON object."""


async def infer_user_seniority(facts: list[dict]) -> dict:
    """
    Infer years-of-experience, seniority level, and management status from
    a user's career facts. Called once per user and cached in-process.
    """
    # Only use role/achievement facts — skills/education don't signal seniority
    relevant = [
        f for f in facts
        if f.get("type") in ("role", "achievement", "project")
    ][:30]  # cap to avoid token overflow

    if not relevant:
        return {"inferred_yoe": 0, "highest_level": "mid", "is_manager": False}

    response = await _client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": SENIORITY_SYSTEM},
            {"role": "user", "content": SENIORITY_USER.format(
                facts_json=json.dumps(
                    [{"type": f["type"], "canonical_text": f["canonical_text"]} for f in relevant],
                    indent=2,
                )[:4000]
            )},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
        max_tokens=200,
    )
    raw = response.choices[0].message.content or "{}"
    result = json.loads(raw)
    return {
        "inferred_yoe": int(result.get("inferred_yoe") or 0),
        "highest_level": result.get("highest_level", "mid"),
        "is_manager": bool(result.get("is_manager", False)),
    }


# ---------------------------------------------------------------------------
# Resume tailoring (the core "no hallucination" rewrite)
# ---------------------------------------------------------------------------

TAILOR_SYSTEM = """You are a senior technical resume writer.
You will receive:
  1. A list of career facts (each with an id and canonical_text).
  2. A set of job requirements to target.
  3. (Optional) A focus requirement to prioritise.

STRICT RULES — never break these:
  - You MUST only use the provided career facts. Do NOT invent, embellish, or combine
    facts that are not listed. Every bullet you write must cite at least one fact_id.
  - If no provided fact supports a requirement, include a gap entry instead of a bullet.
  - Quantitative metrics in facts (metric_json) must appear verbatim in the bullet.
  - Bullets must be concise STAR-format: action verb → context → metric/outcome.

Output a JSON object with this schema:
{
  "diff": [
    {
      "section": "Experience | Skills | Summary",
      "bullet_text": "...",
      "fact_ids": ["<uuid>", ...],
      "action": "added" | "modified" | "removed",
      "original_text": "..." // only for 'modified'
    }
  ],
  "markdown_content": "# Full resume in markdown..."
}"""

TAILOR_USER = """CAREER FACTS:
{facts_json}

JOB REQUIREMENTS:
{requirements_json}

{focus_clause}

Rewrite the resume targeting these requirements. Return valid JSON only."""


async def tailor_resume(
    facts: list[dict],
    requirements: list[dict],
    focus_requirement: str | None = None,
) -> dict:
    """
    Rewrite resume using only the provided facts.
    Returns {"diff": [...], "markdown_content": "..."}.
    """
    focus_clause = (
        f"PRIORITY REQUIREMENT: '{focus_requirement}' — lead with facts that address this."
        if focus_requirement
        else ""
    )

    response = await _client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": TAILOR_SYSTEM},
            {
                "role": "user",
                "content": TAILOR_USER.format(
                    facts_json=json.dumps(facts, indent=2)[:6000],
                    requirements_json=json.dumps(requirements, indent=2)[:2000],
                    focus_clause=focus_clause,
                ),
            },
        ],
        temperature=0.3,
        response_format={"type": "json_object"},
        max_tokens=4000,
    )

    raw = response.choices[0].message.content or "{}"
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Resume parsing (used by /ingest)
# ---------------------------------------------------------------------------

PARSE_SYSTEM = """You are parsing a resume into atomic career facts.
For each fact output:
  type: "role" | "achievement" | "skill" | "education" | "certification" | "project"
  canonical_text: one clear sentence describing the fact
  metric_json: {"value": <number>, "unit": "<string>", "direction": "increase"|"decrease"|null}
               or null if the fact has no quantitative metric
  source_section: the resume section this came from (e.g. "Experience", "Skills")

IMPORTANT: One fact per bullet. Do not merge multiple achievements.
Return a JSON array of fact objects. No extra text."""

PARSE_USER = """Resume text:
{resume_text}

Parse into atomic career facts. Return JSON array only."""


async def parse_resume_to_facts(resume_text: str) -> list[dict]:
    """Parse raw resume text into a list of career fact dicts."""
    response = await _client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": PARSE_SYSTEM},
            {"role": "user", "content": PARSE_USER.format(resume_text=resume_text[:12000])},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
        max_tokens=3000,
    )
    raw = response.choices[0].message.content or "{}"
    parsed = json.loads(raw)
    if isinstance(parsed, dict):
        parsed = next(iter(parsed.values()))
    return parsed
