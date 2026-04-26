"use client";

/**
 * /tailor — Tailor Studio
 *
 * Layout: JD requirements on the left, drafted bullets on the right.
 * Each bullet carries citation badges that trace back to career_facts.
 * User clicks "Approve Version" to save and redirect to the version graph.
 *
 * Query params:
 *   jd_hash   — required; identifies the JD in jd_cache
 *   focus     — optional; requirement text to prioritise in reranking
 */

import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { CitationBadge } from "@/components/CitationBadge";
import { DiffViewer } from "@/components/DiffViewer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@clerk/nextjs";

// ---------------------------------------------------------------------------
// Types (mirror backend schemas/api.py)
// ---------------------------------------------------------------------------

type DiffAction = "added" | "removed" | "modified";

interface DiffItem {
  section: string;
  bullet_text: string;
  fact_ids: string[];
  action: DiffAction;
  original_text?: string;
}

interface TailorResponse {
  version_id: string;
  diff: DiffItem[];
  markdown_content: string;
  pdf_url: string | null;
  citation_count: number;
}

interface JDRequirement {
  id: string;
  text: string;
  type: "must" | "nice";
  weight: number;
}

interface ScoreGap {
  requirement: string;
  type: "must" | "nice";
  evidence_strength: number;
  fact_id: string | null;
  gap_reason: string;
}

interface ScoreData {
  overall: number;
  coverage: number;
  seniority_fit: number;
  evidence_gap: number;
  gaps: ScoreGap[];
  jd_hash: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { apiFetch } from "@/lib/api";

async function fetchTailor(
  jdHash: string,
  token: string | null,
  focusRequirement?: string,
): Promise<TailorResponse> {
  const res = await apiFetch("/tailor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jd_hash: jdHash,
      focus_requirement: focusRequirement ?? null,
    }),
    token,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Tailor failed");
  }
  return res.json();
}

async function approveVersion(
  versionId: string,
  jdHash: string,
  company: string,
  platform: string,
  token: string | null,
): Promise<void> {
  const res = await apiFetch("/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version_id: versionId,
      jd_hash: jdHash,
      company,
      platform,
      target_domain: typeof window !== "undefined" ? window.location.hostname : "",
    }),
    token,
  });
  if (!res.ok) throw new Error("Approval failed");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RequirementPanel({ gaps }: { gaps: ScoreGap[] }) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          JD Requirements
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-3">
        {gaps.map((gap, i) => (
          <div
            key={i}
            className="rounded-lg border p-3 space-y-1 text-sm"
          >
            <div className="flex items-center gap-2">
              <Badge
                variant={gap.type === "must" ? "destructive" : "secondary"}
                className="text-[10px]"
              >
                {gap.type.toUpperCase()}
              </Badge>
              <span className="font-medium line-clamp-2">{gap.requirement}</span>
            </div>
            <div className="flex items-center gap-2">
              <EvidenceBar value={gap.evidence_strength} />
              <span className="text-xs text-muted-foreground">
                {Math.round(gap.evidence_strength * 100)}% match
              </span>
            </div>
            {gap.gap_reason && (
              <p className="text-xs text-amber-600">{gap.gap_reason}</p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EvidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ScoreBadge({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: number;
  tooltip: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-muted cursor-help">
            <span className="text-2xl font-bold tabular-nums">{value}%</span>
            <span className="text-[10px] text-muted-foreground mt-0.5">{label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TailorPage() {
  const { getToken, isLoaded, userId } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const jdHash = searchParams.get("jd_hash");
  const focus = searchParams.get("focus") ?? undefined;
  // Company and platform passed by the extension when opening this tab
  const company = searchParams.get("company") ?? "Unknown";
  const platform = searchParams.get("platform") ?? "greenhouse";

  const [scoreData, setScoreData] = useState<ScoreData | null>(null);
  const [tailor, setTailor] = useState<TailorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);

  // Load score data from sessionStorage (extension sets this before opening tab)
  useEffect(() => {
    const stored = sessionStorage.getItem(`score_${jdHash}`);
    if (stored) {
      try {
        setScoreData(JSON.parse(stored));
      } catch {
        // Non-critical: score panel just won't populate
      }
    }
  }, [jdHash]);

  const runTailor = useCallback(async () => {
    if (!userId || !jdHash) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const result = await fetchTailor(jdHash, token, focus);
      setTailor(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [jdHash, focus, getToken]);

  // Auto-run tailor on mount
  useEffect(() => {
    if (isLoaded && userId && jdHash && !tailor) {
      runTailor();
    }
  }, [isLoaded, userId, jdHash, tailor, runTailor]);

  const handleApprove = async () => {
    if (!userId || !tailor || !jdHash) return;
    setApproving(true);
    try {
      const token = await getToken();
      await approveVersion(tailor.version_id, jdHash, company, platform, token);
      setApproved(true);
      setTimeout(() => router.push("/graph"), 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApproving(false);
    }
  };

  if (!jdHash) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Missing <code className="mx-1 px-1 bg-muted rounded">jd_hash</code> query param.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Tailor Studio</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every bullet cites a verified career fact — no hallucinations.
          </p>
        </div>

        {/* Score summary pills */}
        {scoreData && (
          <div className="flex items-center gap-3">
            <ScoreBadge
              label="Overall"
              value={scoreData.overall}
              tooltip="Based on verified history, not recruiter opinion. Rounded to nearest 5 to avoid false precision."
            />
            <ScoreBadge
              label="Coverage"
              value={scoreData.coverage}
              tooltip="Weighted % of 'must' requirements matched by your facts (cosine ≥ 0.75)."
            />
            <ScoreBadge
              label="Seniority"
              value={scoreData.seniority_fit}
              tooltip="Inferred seniority alignment. Full signal available in v2."
            />
            <ScoreBadge
              label="Evidence"
              value={scoreData.evidence_gap}
              tooltip="% of requirements where your best-matching fact includes a quantitative metric."
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={runTailor} disabled={loading}>
            {loading ? "Generating…" : "Re-generate"}
          </Button>
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={!tailor || approving || approved}
            className={approved ? "bg-green-600 hover:bg-green-600" : ""}
          >
            {approved ? "✓ Approved" : approving ? "Saving…" : "Approve Version"}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-3 px-4 py-2 bg-destructive/10 text-destructive text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* ── Body: two-column split ── */}
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Left: JD requirements / gaps */}
        <aside className="w-80 shrink-0 border-r p-4 overflow-y-auto">
          {scoreData ? (
            <RequirementPanel gaps={scoreData.gaps} />
          ) : (
            <div className="text-sm text-muted-foreground">
              Score data not available. Run /score from the extension first.
            </div>
          )}
        </aside>

        {/* Right: diff viewer */}
        <main className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm">Retrieving facts · Reranking · Rewriting…</p>
            </div>
          )}

          {!loading && tailor && (
            <DiffViewer
              diff={tailor.diff}
              markdownContent={tailor.markdown_content}
              citationCount={tailor.citation_count}
            />
          )}

          {!loading && !tailor && !error && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Tailor will start automatically…
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
