"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  DEMO_JD,
  getOnboardingScore,
  saveOnboardingScore,
  setOnboardingStep,
  track,
} from "@/lib/onboarding";
import { apiFetch } from "@/lib/api";

interface GapItem {
  requirement: string;
  type: "must" | "nice";
  evidence_strength: number;
  gap_reason: string;
}

interface ScoreResult {
  overall: number;
  coverage: number;
  seniority_fit: number;
  evidence_gap: number;
  gaps: GapItem[];
  cohort_note: string;
  jd_hash: string;
  seniority_detail?: Record<string, unknown>;
}

interface DiffItem {
  section: string;
  bullet_text: string;
  fact_ids: string[];
  action: string;
}

interface Props {
  onComplete: () => void;
}

// Animated counter
function useCountUp(target: number, duration = 1200, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    const steps = 40;
    const step = target / steps;
    const interval = duration / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += step;
      if (current >= target) {
        setValue(target);
        clearInterval(timer);
      } else {
        setValue(Math.round(current));
      }
    }, interval);
    return () => clearInterval(timer);
  }, [target, duration, start]);
  return value;
}

function ScorePill({
  label,
  value,
  animate,
  tooltip,
}: {
  label: string;
  value: number;
  animate: boolean;
  tooltip?: string;
}) {
  const displayed = useCountUp(value, 1200, animate);
  const color = value >= 70 ? "text-green-600" : value >= 50 ? "text-amber-500" : "text-red-500";

  return (
    <div className="flex flex-col items-center bg-gray-50 rounded-xl p-4 flex-1" title={tooltip}>
      <span className={`text-3xl font-black tabular-nums ${color}`}>{displayed}%</span>
      <span className="text-xs text-gray-500 mt-1">{label}</span>
    </div>
  );
}

export default function StepFirstScore({ onComplete }: Props) {
  const { getToken } = useAuth();
  const [tab, setTab] = useState<"paste" | "demo">("demo");
  const [jdText, setJdText] = useState("");
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [animate, setAnimate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fixLoading, setFixLoading] = useState<string | null>(null);
  const [fixedBullet, setFixedBullet] = useState<DiffItem | null>(null);
  const [modalGap, setModalGap] = useState<string | null>(null);

  // Restore from cache if user refreshed
  useEffect(() => {
    const cached = getOnboardingScore();
    if (cached.score) {
      setScore(cached.score as ScoreResult);
      setAnimate(true);
    }
  }, []);

  async function runScore(text: string) {
    setLoading(true);
    setError(null);
    setScore(null);
    track("first_jd_scored", { source: tab });

    try {
      const token = await getToken();
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 15000);

      const res = await apiFetch("/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_text: text,
          company: tab === "demo" ? "Stripe" : "Company",
          title: tab === "demo" ? "Senior PM" : "Role",
        }),
        signal: controller.signal,
        token,
      });

      if (!res.ok) throw new Error("Scoring failed");
      const data: ScoreResult = await res.json();
      setScore(data);
      saveOnboardingScore(data, data.jd_hash);
      setTimeout(() => setAnimate(true), 200);
    } catch (e) {
      setError((e as Error).name === "AbortError" ? "Request timed out. Try again." : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function fixGap(gap: GapItem) {
    if (!score) return;
    setFixLoading(gap.requirement);
    setModalGap(gap.requirement);
    track("first_gap_fixed", { requirement: gap.requirement });

    try {
      const token = await getToken();
      const res = await apiFetch("/tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd_hash: score.jd_hash,
          focus_requirement: gap.requirement,
        }),
        token,
      });
      if (!res.ok) throw new Error("Tailor failed");
      const data = await res.json();
      const relevant = (data.diff as DiffItem[]).find(
        (d) => d.fact_ids.length > 0
      ) ?? data.diff[0];
      setFixedBullet(relevant ?? null);
    } catch {
      setFixedBullet(null);
    } finally {
      setFixLoading(null);
    }
  }

  function handleProceed() {
    setOnboardingStep("extension");
    onComplete();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-1">Score your first job</h2>
      <p className="text-sm text-gray-500 mb-6">
        Paste a JD or try our demo — see how your background stacks up in seconds.
      </p>

      {/* Tabs */}
      {!score && (
        <>
          <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-4 text-sm">
            {(["demo", "paste"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 font-medium transition-colors ${
                  tab === t ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t === "demo" ? "🎯 Try Demo JD (Stripe PM)" : "📋 Paste a Job Description"}
              </button>
            ))}
          </div>

          {tab === "paste" && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">Job description</label>
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  🔒 We never store your JD — only a hash
                </span>
              </div>
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="Paste the full job description here…"
                className="w-full border border-gray-200 rounded-xl p-3 text-sm h-40 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          )}

          {tab === "demo" && (
            <div className="mb-4 bg-gray-50 rounded-xl p-4 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Stripe · Senior Product Manager</p>
              <p className="text-xs text-gray-600 line-clamp-4">{DEMO_JD.slice(0, 300)}…</p>
            </div>
          )}

          <button
            onClick={() => runScore(tab === "demo" ? DEMO_JD : jdText)}
            disabled={loading || (tab === "paste" && jdText.length < 50)}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Scoring…
              </span>
            ) : (
              "Score This Job →"
            )}
          </button>
        </>
      )}

      {error && (
        <div className="mt-3 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">
          {error}
        </div>
      )}

      {/* Score results */}
      {score && (
        <div className="space-y-5">
          {/* Score pills */}
          <div className="flex gap-3">
            <ScorePill label="Overall" value={score.overall} animate={animate} tooltip="Composite match score" />
            <ScorePill label="Coverage" value={score.coverage} animate={animate} tooltip="Must-have requirements matched" />
            <ScorePill label="Seniority" value={score.seniority_fit} animate={animate} tooltip="YoE + level + management fit" />
            <ScorePill label="Evidence" value={score.evidence_gap} animate={animate} tooltip="Facts with quantitative metrics" />
          </div>

          {/* Cohort note */}
          <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">
            {score.cohort_note}
          </p>

          {/* Seniority detail */}
          {score.seniority_detail && (
            <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 space-y-1">
              <p className="font-semibold text-blue-700 mb-1">Seniority breakdown</p>
              <p>Your level: <strong>{String(score.seniority_detail.user_level)}</strong> · JD wants: <strong>{String(score.seniority_detail.jd_level)}</strong></p>
              <p>Your YoE: <strong>{String(score.seniority_detail.user_yoe)} years</strong> · Required: <strong>{String(score.seniority_detail.required_yoe || "not specified")}</strong></p>
              {score.seniority_detail.jd_wants_manager && (
                <p>Role requires people management: {score.seniority_detail.user_is_manager ? "✅ You have it" : "⚠️ You don't have it"}</p>
              )}
            </div>
          )}

          {/* Gaps */}
          {score.gaps.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Gaps to address</p>
              <div className="space-y-2">
                {score.gaps.slice(0, 4).map((gap, i) => (
                  <div key={i} className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl p-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 mt-0.5 ${
                      gap.type === "must" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                    }`}>
                      {gap.type}
                    </span>
                    <p className="text-sm text-gray-700 flex-1 leading-relaxed">{gap.requirement}</p>
                    <button
                      onClick={() => fixGap(gap)}
                      disabled={!!fixLoading}
                      className="text-xs text-blue-600 border border-blue-200 rounded-lg px-3 py-1 hover:bg-blue-50 shrink-0 transition-colors disabled:opacity-50"
                    >
                      {fixLoading === gap.requirement ? "…" : "Fix →"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleProceed}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors"
          >
            Next: Install Extension →
          </button>

          <button
            onClick={() => { setScore(null); setAnimate(false); }}
            className="w-full text-sm text-gray-400 hover:text-gray-600 underline"
          >
            Try a different JD
          </button>
        </div>
      )}

      {/* Fix modal */}
      {modalGap && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl">
            <h3 className="font-bold text-lg mb-1">Suggested fix</h3>
            <p className="text-sm text-gray-500 mb-4">Gap: <em>{modalGap}</em></p>

            {fixLoading ? (
              <div className="flex items-center gap-2 py-6 justify-center text-gray-500">
                <span className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Generating bullet from your facts…</span>
              </div>
            ) : fixedBullet ? (
              <div className={`rounded-xl p-4 border-l-4 text-sm leading-relaxed ${
                fixedBullet.fact_ids.length > 0
                  ? "bg-green-50 border-l-green-500"
                  : "bg-red-50 border-l-red-400"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {fixedBullet.fact_ids.length > 0 ? (
                    <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full font-medium">
                      Cited from your resume
                    </span>
                  ) : (
                    <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-medium">
                      ⚠️ Gap — not in your resume
                    </span>
                  )}
                </div>
                <p>{fixedBullet.bullet_text}</p>
                {fixedBullet.fact_ids.length > 0 && (
                  <p className="text-xs text-gray-400 mt-2">
                    Source: fact #{fixedBullet.fact_ids[0].slice(0, 6)}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No bullet could be generated from your current facts.</p>
            )}

            <button
              onClick={() => { setModalGap(null); setFixedBullet(null); }}
              className="mt-4 w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700"
            >
              Got it →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
