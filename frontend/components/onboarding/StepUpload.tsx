"use client";

import React, { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { saveOnboardingFacts, setOnboardingStep, track } from "@/lib/onboarding";
import { apiFetch } from "@/lib/api";

interface CareerFact {
  id: string;
  type: string;
  canonical_text: string;
  metric_json: Record<string, unknown> | null;
  is_verified: boolean;
  source_section: string | null;
}

interface Props {
  onComplete: () => void;
}

type Phase = "idle" | "uploading" | "parsing" | "done" | "error";

export default function StepUpload({ onComplete }: Props) {
  const { getToken } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [factCount, setFactCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadFile(file: File) {
    if (!file.name.endsWith(".pdf") && !file.name.endsWith(".docx")) {
      setError("Only PDF and DOCX files are supported. Try converting your resume first.");
      return;
    }

    setPhase("uploading");
    setError(null);
    track("resume_upload_started", { fileType: file.name.split(".").pop() });

    try {
      setPhase("parsing");
      const token = await getToken();
      const form = new FormData();
      form.append("file", file);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await apiFetch("/ingest", {
        method: "POST",
        body: form,
        signal: controller.signal,
        token,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(err.detail ?? "Upload failed");
      }

      const data = await res.json();

      if (!data.facts || data.facts.length < 5) {
        setError(
          `Only ${data.fact_count ?? 0} facts extracted — your PDF may be image-based or corrupted. Try a DOCX version or email support@yourcopilot.com.`
        );
        setPhase("error");
        return;
      }

      saveOnboardingFacts(data.facts);
      setFactCount(data.fact_count);
      setPhase("done");
      track("resume_uploaded", { factCount: data.fact_count });

      setTimeout(() => {
        setOnboardingStep("verify");
        onComplete();
      }, 1200);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setError("Request timed out. Check your connection and try again.");
      } else {
        setError((e as Error).message || "PDF unreadable. Try DOCX or email us.");
      }
      setPhase("error");
      track("resume_upload_failed", { error: (e as Error).message });
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-xl font-bold mb-1">Upload your resume</h2>
      <p className="text-sm text-gray-500 mb-6">
        We'll extract your career history into searchable memory. Only you can see it.
      </p>

      {/* Upload zone */}
      <div
        onClick={() => phase === "idle" || phase === "error" ? fileRef.current?.click() : null}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-2xl p-12 text-center transition-all
          ${phase === "idle" || phase === "error" ? "cursor-pointer" : "cursor-default"}
          ${dragOver ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-400 hover:bg-gray-50"}
          ${phase === "done" ? "border-green-400 bg-green-50" : ""}
        `}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
        />

        {phase === "idle" && (
          <>
            <div className="text-5xl mb-3">📄</div>
            <p className="font-semibold text-gray-700">Drop your resume here</p>
            <p className="text-sm text-gray-400 mt-1">PDF or DOCX · Max 10MB</p>
          </>
        )}

        {phase === "uploading" && (
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-600">Uploading…</p>
          </div>
        )}

        {phase === "parsing" && (
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-gray-700">Parsing career facts with AI…</p>
            <p className="text-xs text-gray-400">Extracting achievements, roles, skills</p>
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col items-center gap-3">
            <div className="text-5xl">✅</div>
            <p className="font-semibold text-green-700">
              {factCount} career facts extracted
            </p>
            <p className="text-sm text-gray-500">Moving to verification…</p>
          </div>
        )}

        {phase === "error" && (
          <>
            <div className="text-5xl mb-3">⚠️</div>
            <p className="font-semibold text-gray-700">Try again</p>
            <p className="text-sm text-gray-400 mt-1">PDF or DOCX · Max 10MB</p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
          {error}
        </div>
      )}
    </div>
  );
}
