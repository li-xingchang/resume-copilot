"""
Thin wrapper around OpenAI embeddings with in-process LRU cache.
text-embedding-3-small outputs 1536 dimensions, matching the vector column.
"""
import asyncio
from functools import lru_cache

from openai import AsyncOpenAI

from app.config import get_settings

settings = get_settings()
_client = AsyncOpenAI(api_key=settings.openai_api_key)

# In-process cache: avoids re-embedding identical text within a request batch.
# For a multi-worker deployment, use Redis instead.
_cache: dict[str, list[float]] = {}
_CACHE_MAX = 2000


async def embed_text(text: str) -> list[float]:
    """Return the embedding for a single text string, using the process cache."""
    key = text.strip()
    if key in _cache:
        return _cache[key]

    response = await _client.embeddings.create(
        model=settings.embedding_model,
        input=key,
        encoding_format="float",
    )
    vec = response.data[0].embedding

    if len(_cache) < _CACHE_MAX:
        _cache[key] = vec
    return vec


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed up to 2048 texts in one API call (OpenAI batch limit)."""
    # Deduplicate while preserving order
    unique = list(dict.fromkeys(t.strip() for t in texts))
    uncached = [t for t in unique if t not in _cache]

    if uncached:
        response = await _client.embeddings.create(
            model=settings.embedding_model,
            input=uncached,
            encoding_format="float",
        )
        for text, item in zip(uncached, response.data):
            if len(_cache) < _CACHE_MAX:
                _cache[text] = item.embedding

    # Rebuild in original order (duplicates resolved from cache)
    text_map = {t.strip(): _cache[t.strip()] for t in texts}
    return [text_map[t.strip()] for t in texts]
