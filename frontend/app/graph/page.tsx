"use client";

/**
 * /graph — Resume version timeline.
 * Shows all tailored resume versions as a tree, with diff summaries and application status.
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { apiFetch } from "@/lib/api";

interface VersionNode {
  id: string;
  parent_id: string | null;
  jd_hash: string | null;
  company: string | null;
  title: string | null;
  created_at: string;
  diff_summary: string;
  application_status: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  submitted: "bg-blue-100 text-blue-800",
  interviewing: "bg-purple-100 text-purple-800",
  offered: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function GraphPage() {
  const { getToken } = useAuth();
  const [nodes, setNodes] = useState<VersionNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await apiFetch("/versions", { token });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        setNodes(data.nodes ?? []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Version History</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every tailored resume is saved here, linked to the job it was written for.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading versions…
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && nodes.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-4xl mb-3">🌱</div>
          <p className="font-medium">No versions yet</p>
          <p className="text-sm mt-1">
            Upload your resume on{" "}
            <Link href="/onboard" className="text-primary underline">
              the onboard page
            </Link>
            , then tailor it for a job.
          </p>
        </div>
      )}

      {nodes.length > 0 && (
        <div className="space-y-3">
          {nodes.map((node) => (
            <div key={node.id} className="relative">
              {node.parent_id && (
                <div className="absolute left-5 -top-3 w-px h-3 bg-border" />
              )}
              <div className={`border rounded-lg p-4 bg-white hover:shadow-sm transition-shadow ${node.parent_id ? "ml-8" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {node.company ?? "Unknown Company"}
                      </span>
                      {node.title && (
                        <span className="text-sm text-muted-foreground">· {node.title}</span>
                      )}
                      {node.application_status && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${STATUS_COLORS[node.application_status] ?? "bg-gray-100 text-gray-700"}`}>
                          {node.application_status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-foreground">{formatDate(node.created_at)}</span>
                      <span className="text-xs text-muted-foreground">{node.diff_summary}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/tailor?jd_hash=${node.jd_hash}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Re-tailor →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
