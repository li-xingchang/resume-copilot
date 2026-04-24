"use client";

/**
 * CitationBadge — a small pill linking a bullet to its source career_fact.
 * On hover, shows the fact's canonical_text so users can verify the source.
 * On click, navigates to /onboard#<fact_id> for full editing.
 */

import React, { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FactSummary {
  id: string;
  canonical_text: string;
  type: string;
  is_verified: boolean;
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// Module-level cache: avoids re-fetching the same fact across multiple badges
const factCache = new Map<string, FactSummary>();

async function fetchFact(factId: string): Promise<FactSummary | null> {
  if (factCache.has(factId)) return factCache.get(factId)!;
  try {
    const res = await fetch(`${API}/facts/${factId}`);
    if (!res.ok) return null;
    const data: FactSummary = await res.json();
    factCache.set(factId, data);
    return data;
  } catch {
    return null;
  }
}

export function CitationBadge({ factId }: { factId: string }) {
  const [fact, setFact] = useState<FactSummary | null>(null);
  const short = factId.slice(0, 6);

  useEffect(() => {
    fetchFact(factId).then(setFact);
  }, [factId]);

  const badge = (
    <a
      href={`/onboard#${factId}`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono
                 bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40
                 dark:text-blue-300 transition-colors cursor-pointer no-underline"
      onClick={(e) => e.stopPropagation()}
    >
      {fact?.is_verified && (
        <span title="Verified fact" className="text-green-500">✓</span>
      )}
      #{short}
    </a>
  );

  if (!fact) return badge;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs space-y-1">
          <div className="flex items-center gap-1.5">
            <span className="uppercase text-[9px] font-semibold text-muted-foreground">
              {fact.type}
            </span>
            {fact.is_verified && (
              <span className="text-green-500 text-[9px]">● Verified</span>
            )}
          </div>
          <p>{fact.canonical_text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
