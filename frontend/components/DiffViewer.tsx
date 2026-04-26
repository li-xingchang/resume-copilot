"use client";

/**
 * DiffViewer — renders the diff between the parent resume and the new tailored version.
 *
 * Each bullet is grouped by section and labelled with:
 *   - a colour-coded action badge (added / modified / removed)
 *   - citation badges showing which career_fact_ids were used
 *
 * Sections are collapsed by default if they have no changes.
 */

import React, { useState } from "react";
import { CitationBadge } from "./CitationBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiffAction = "added" | "removed" | "modified";

export interface DiffItem {
  section: string;
  bullet_text: string;
  fact_ids: string[];
  action: DiffAction;
  original_text?: string;
}

interface DiffViewerProps {
  diff: DiffItem[];
  markdownContent: string;
  citationCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBySection(diff: DiffItem[]): Record<string, DiffItem[]> {
  return diff.reduce<Record<string, DiffItem[]>>((acc, item) => {
    (acc[item.section] ??= []).push(item);
    return acc;
  }, {});
}

const ACTION_STYLES: Record<DiffAction, string> = {
  added: "bg-green-50 border-l-4 border-l-green-500 dark:bg-green-950/30",
  removed: "bg-red-50 border-l-4 border-l-red-400 line-through opacity-60 dark:bg-red-950/30",
  modified: "bg-amber-50 border-l-4 border-l-amber-400 dark:bg-amber-950/30",
};

const ACTION_BADGE: Record<DiffAction, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  added: { label: "+ Added", variant: "default" },
  modified: { label: "~ Modified", variant: "secondary" },
  removed: { label: "− Removed", variant: "destructive" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BulletCard({ item }: { item: DiffItem }) {
  const badge = ACTION_BADGE[item.action];
  const isGap = item.fact_ids.length === 0;

  return (
    <div
      className={cn(
        "rounded-md px-4 py-3 text-sm space-y-2",
        isGap
          ? "bg-red-50 border-l-4 border-l-red-500"
          : ACTION_STYLES[item.action],
      )}
    >
      {/* Action label + citations row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge
          variant={isGap ? "destructive" : badge.variant}
          className="text-[10px] px-1.5 py-0"
        >
          {isGap ? "⚠ Gap" : badge.label}
        </Badge>
        {item.fact_ids.map((fid) => (
          <CitationBadge key={fid} factId={fid} />
        ))}
      </div>

      {/* For modified bullets, show the before/after */}
      {item.action === "modified" && item.original_text && (
        <p className="text-muted-foreground line-through text-xs">
          {item.original_text}
        </p>
      )}

      <p className={cn("leading-relaxed", isGap && "text-red-700")}>
        {item.bullet_text}
      </p>
    </div>
  );
}

function SectionBlock({
  section,
  items,
}: {
  section: string;
  items: DiffItem[];
}) {
  const hasChanges = items.some((i) => i.action !== "removed" || items.length > 0);
  const [open, setOpen] = useState(hasChanges);

  const changeCount = items.filter((i) => i.action !== "removed").length;

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{section}</span>
          {changeCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {changeCount} bullet{changeCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3 border-t pt-4">
          {items.map((item, i) => (
            <BulletCard key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function DiffViewer({ diff, markdownContent, citationCount }: DiffViewerProps) {
  const [view, setView] = useState<"diff" | "markdown">("diff");
  const grouped = groupBySection(diff);

  const added = diff.filter((d) => d.action === "added").length;
  const modified = diff.filter((d) => d.action === "modified").length;
  const removed = diff.filter((d) => d.action === "removed").length;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {added > 0 && <span className="text-green-600 font-medium">+{added} added</span>}
          {modified > 0 && <span className="text-amber-600 font-medium">~{modified} modified</span>}
          {removed > 0 && <span className="text-red-500 font-medium">−{removed} removed</span>}
          <span className="text-muted-foreground">
            {citationCount} citation{citationCount !== 1 ? "s" : ""}
          </span>
        </div>

        {/* View toggle */}
        <div className="flex rounded-md border overflow-hidden text-xs">
          <button
            onClick={() => setView("diff")}
            className={cn(
              "px-3 py-1.5 transition-colors",
              view === "diff" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            Diff
          </button>
          <button
            onClick={() => setView("markdown")}
            className={cn(
              "px-3 py-1.5 border-l transition-colors",
              view === "markdown" ? "bg-primary text-primary-foreground" : "hover:bg-muted"
            )}
          >
            Full Resume
          </button>
        </div>
      </div>

      {/* Diff view */}
      {view === "diff" && (
        <div className="space-y-3">
          {Object.entries(grouped).map(([section, items]) => (
            <SectionBlock key={section} section={section} items={items} />
          ))}
          {diff.length === 0 && (
            <div className="text-center text-muted-foreground py-12 text-sm">
              No changes generated. Try adjusting the focus requirement.
            </div>
          )}
        </div>
      )}

      {/* Full resume markdown view */}
      {view === "markdown" && (
        <div className="rounded-xl border bg-card shadow-sm p-6">
          <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed text-foreground">
            {markdownContent}
          </pre>
        </div>
      )}
    </div>
  );
}
