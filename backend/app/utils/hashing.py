import hashlib


def hash_text(text: str) -> str:
    """SHA-256 of normalised (lowercased, collapsed-whitespace) text. Used for jd_hash."""
    normalised = " ".join(text.lower().split())
    return hashlib.sha256(normalised.encode()).hexdigest()


def hash_bullet(canonical_text: str) -> str:
    """SHA-256 of normalised bullet text. Used as bullet_performance primary key."""
    normalised = " ".join(canonical_text.lower().split())
    return hashlib.sha256(normalised.encode()).hexdigest()
