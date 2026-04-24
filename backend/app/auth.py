"""
Clerk JWT verification middleware.

Every protected endpoint calls `Depends(get_verified_user_id)`.
It extracts the Bearer token, verifies it with Clerk's JWKS endpoint,
and returns the clerk_id (sub claim). The endpoint then checks that
the clerk_id matches the user_id in the request body to prevent
one user from accessing another's data.

JWKS keys are cached in-process and refreshed every 60 minutes.
"""
import time
from functools import lru_cache

import httpx
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from app.config import get_settings

settings = get_settings()
_bearer = HTTPBearer()

# Cache JWKS for 60 minutes to avoid hammering Clerk on every request
_jwks_cache: dict = {}
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600


async def _get_jwks() -> dict:
    global _jwks_cache, _jwks_fetched_at
    if time.time() - _jwks_fetched_at < _JWKS_TTL and _jwks_cache:
        return _jwks_cache

    async with httpx.AsyncClient() as client:
        # Clerk publishes JWKS at a well-known URL derived from the publishable key
        # Format: pk_live_<base64-encoded-domain>
        # We use the backend secret key to fetch from the Clerk API instead.
        r = await client.get(
            "https://api.clerk.com/v1/jwks",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            timeout=5,
        )
        r.raise_for_status()
        _jwks_cache = r.json()
        _jwks_fetched_at = time.time()
        return _jwks_cache


async def get_verified_user_id(
    creds: HTTPAuthorizationCredentials = Security(_bearer),
) -> str:
    """
    FastAPI dependency. Returns the Clerk user ID (sub claim) from a valid JWT.
    Raises 401 if the token is missing, expired, or tampered with.
    """
    token = creds.credentials
    try:
        jwks = await _get_jwks()
        # jose.jwt.decode handles key selection from the JWKS automatically
        payload = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            options={"verify_aud": False},  # Clerk JWTs don't have a fixed audience
        )
        clerk_id: str = payload["sub"]
        return clerk_id
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
    except Exception:
        raise HTTPException(status_code=401, detail="Could not verify credentials")
