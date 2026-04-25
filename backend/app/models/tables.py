"""
SQLAlchemy ORM models matching schema.sql exactly.
Compatible with Python 3.9+ (uses Optional instead of X | None syntax).
"""
import uuid
from datetime import datetime
from typing import List, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clerk_id: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    facts: Mapped[List["CareerFact"]] = relationship(back_populates="user")
    versions: Mapped[List["ResumeVersion"]] = relationship(back_populates="user")


class CareerFact(Base):
    __tablename__ = "career_facts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(
        Text,
        CheckConstraint("type IN ('role','achievement','skill','education','certification','project')"),
        nullable=False,
    )
    canonical_text: Mapped[str] = mapped_column(Text, nullable=False)
    metric_json: Mapped[Optional[dict]] = mapped_column(JSONB)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(1536))
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_section: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="facts")


class ResumeVersion(Base):
    __tablename__ = "resume_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("resume_versions.id"))
    jd_hash: Mapped[Optional[str]] = mapped_column(Text)
    company: Mapped[Optional[str]] = mapped_column(Text)
    title: Mapped[Optional[str]] = mapped_column(Text)
    diff_json: Mapped[Optional[dict]] = mapped_column(JSONB)
    citation_refs: Mapped[list] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False, default=list)
    markdown_content: Mapped[Optional[str]] = mapped_column(Text)
    pdf_url: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="versions")
    parent: Mapped[Optional["ResumeVersion"]] = relationship(remote_side="ResumeVersion.id")
    children: Mapped[List["ResumeVersion"]] = relationship(back_populates="parent")
    application: Mapped[Optional["Application"]] = relationship(back_populates="version")


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resume_versions.id"), nullable=False)
    jd_hash: Mapped[str] = mapped_column(Text, nullable=False)
    company: Mapped[str] = mapped_column(Text, nullable=False)
    platform: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    version: Mapped["ResumeVersion"] = relationship(back_populates="application")
    outcomes: Mapped[List["Outcome"]] = relationship(back_populates="application")
    audit_logs: Mapped[List["AuditLog"]] = relationship(back_populates="application")


class Outcome(Base):
    __tablename__ = "outcomes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    source: Mapped[Optional[str]] = mapped_column(Text)

    application: Mapped["Application"] = relationship(back_populates="outcomes")


class BulletPerformance(Base):
    __tablename__ = "bullet_performance"

    bullet_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    fact_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("career_facts.id"))
    times_shown: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    interviews: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lift_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JDCache(Base):
    __tablename__ = "jd_cache"

    jd_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    company: Mapped[Optional[str]] = mapped_column(Text)
    title: Mapped[Optional[str]] = mapped_column(Text)
    extracted_requirements: Mapped[dict] = mapped_column(JSONB, nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    application_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("applications.id"))
    action_type: Mapped[str] = mapped_column(Text, nullable=False)
    target_domain: Mapped[Optional[str]] = mapped_column(Text)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    application: Mapped[Optional["Application"]] = relationship(back_populates="audit_logs")
