"""
S3 storage service for PDF resume versions.
Uses presigned URLs so the frontend can render PDFs without proxying through the API.
"""
import io
import uuid

import boto3
from botocore.exceptions import ClientError

from app.config import get_settings

settings = get_settings()

_s3 = boto3.client(
    "s3",
    region_name=settings.aws_region,
    aws_access_key_id=settings.aws_access_key_id,
    aws_secret_access_key=settings.aws_secret_access_key,
)


def upload_pdf(user_id: uuid.UUID, version_id: uuid.UUID, pdf_bytes: bytes) -> str:
    """Upload a PDF and return a presigned URL valid for 7 days."""
    key = f"resumes/{user_id}/{version_id}.pdf"
    _s3.put_object(
        Bucket=settings.s3_bucket,
        Key=key,
        Body=pdf_bytes,
        ContentType="application/pdf",
    )
    url = _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=604800,  # 7 days
    )
    return url


def get_pdf_url(user_id: uuid.UUID, version_id: uuid.UUID) -> str | None:
    """Return a fresh presigned URL for an existing version, or None if not found."""
    key = f"resumes/{user_id}/{version_id}.pdf"
    try:
        _s3.head_object(Bucket=settings.s3_bucket, Key=key)
    except ClientError:
        return None
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=604800,
    )
