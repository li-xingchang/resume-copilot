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
Extract 5-8 requirements. For each, output JSON with:
  id: (uuid v4),
  text: (concise 1-sentence requirement),
  type: "must" | "nice",
  weight: 1-3  (1=nice-to-have, 3=critical gate)

Return ONLY a JSON array. No extra text."""

EXTRACT_USER = """Job Description:
{jd_text}

Extract 5-8 requirements as a JSON array."""


async def extract_requirements(jd_text: str) -> list[dict]:
    """Extract structured requirements from raw JD text via GPT-4o-mini."""
    response = await _client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": EXTRACT_SYSTEM},
            {"role": "user", "content": EXTRACT_USER.format(jd_text=jd_text[:8000])},
        ],
        temperature=0.1,
        response_format={"type": "json_object"},
        max_tokens=1000,
    )
    raw = response.choices[0].message.content or "{}"
    parsed = json.loads(raw)

    # The model sometimes wraps the array in {"requirements": [...]}
    if isinstance(parsed, dict):
        parsed = next(iter(parsed.values()))

    # Ensure every item has a valid UUID
    for item in parsed:
        if "id" not in item or not item["id"]:
            item["id"] = str(uuid.uuid4())

    return parsed


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
