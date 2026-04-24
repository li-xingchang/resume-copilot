"""
Resume Intelligence Co-Pilot — FastAPI application entry point.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import ingest, score, tailor, versions

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: nothing async-heavy needed; migrations handled by Alembic externally
    yield
    # Shutdown: engine cleanup happens via GC for async engines


app = FastAPI(
    title="Resume Intelligence Co-Pilot",
    description=(
        "Memory-graph resume engine. Every bullet cites a career_fact. "
        "Every version traces to a parent. Every outcome trains the lift scores."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest.router, tags=["Memory"])
app.include_router(score.router, tags=["Intelligence"])
app.include_router(tailor.router, tags=["Intelligence"])
app.include_router(versions.router, tags=["Graph"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
