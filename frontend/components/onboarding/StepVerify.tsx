"use client";

import React, { useState } from "react";
import { getOnboardingFacts, setOnboardingStep, track } from "@/lib/onboarding";

interface CareerFact {
  id: string;
  type: string;
  canonical_text: string;
  metric_json: Record<string, unknown> | null;
  source_section: string | null;
}

interface Props {
  onComplete: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  achievement: "bg-blue-100 text-blue-700",
  skill: "bg-purple-100 text-purple-700",
  role: "bg-green-100 text-green-700",
  education: "bg-yellow-100 text-yellow-700",
  certification: "bg-orange-100 text-orange-700",
  project: "bg-pink-100 text-pink-700",
};

export default function StepVerify({ onComplete }: Props) {
  const allFacts = getOnboardingFacts() as CareerFact[];
  const topFacts = allFacts.slice(0, 8);

  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [facts, setFacts] = useState<CareerFact[]>(topFacts);

  const MIN_CONFIRMED = 3;
  const canProceed = confirmed.size >= MIN_CONFIRMED;

  function toggleConfirm(id: string) {
    setConfirmed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startEdit(fact: CareerFact) {
    setEditingId(fact.id);
    setEditText(fact.canonical_text);
  }

  function saveEdit(id: string) {
    setFacts((prev) =>
      prev.map((f) => (f.id === id ? { ...f, canonical_text: editText } : f))
    );
    setEditingId(null);
    track("fact_edited");
  }

  function handleProceed() {
    track("facts_verified", { confirmed: confirmed.size, total: facts.length });
    setOnboardingStep("first_score");
    onComplete();
  }

  function handleSkip() {
    track("facts_verify_skipped");
    setOnboardingStep("first_score");
    onComplete();
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-1">Do these look right?</h2>
      <p className="text-sm text-gray-500 mb-2">
        We found {allFacts.length} career facts. Confirm at least {MIN_CONFIRMED} so matching is accurate.
      </p>
      <p className="text-xs text-gray-400 mb-6">
        Click any fact to confirm it. Click the pencil to edit.
      </p>

      <div className="space-y-2 mb-6">
        {facts.map((fact) => {
          const isConfirmed = confirmed.has(fact.id);
          const isEditing = editingId === fact.id;

          return (
            <div
              key={fact.id}
              onClick={() => !isEditing && toggleConfirm(fact.id)}
              className={`
                border rounded-xl p-4 cursor-pointer transition-all
                ${isConfirmed
                  ? "border-green-400 bg-green-50"
                  : "border-gray-200 bg-white hover:border-gray-300"}
              `}
            >
              <div className="flex items-start gap-3">
                {/* Confirm checkbox */}
                <div className={`
                  mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
                  ${isConfirmed ? "border-green-500 bg-green-500" : "border-gray-300"}
                `}>
                  {isConfirmed && <span className="text-white text-xs">✓</span>}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${TYPE_COLORS[fact.type] ?? "bg-gray-100 text-gray-600"}`}>
                      {fact.type}
                    </span>
                    {fact.metric_json && (
                      <span className="text-[10px] text-green-600 font-medium">✓ Has metric</span>
                    )}
                  </div>

                  {isEditing ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <textarea
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full text-sm border border-blue-300 rounded-lg p-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                        rows={2}
                      />
                      <div className="flex gap-2 mt-1">
                        <button
                          onClick={() => saveEdit(fact.id)}
                          className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-700 leading-relaxed">{fact.canonical_text}</p>
                  )}
                </div>

                {/* Edit button */}
                {!isEditing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); startEdit(fact); }}
                    className="text-gray-300 hover:text-gray-500 transition-colors shrink-0 text-sm"
                    title="Edit this fact"
                  >
                    ✏️
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-4 text-sm">
        <div className="flex gap-1">
          {Array.from({ length: MIN_CONFIRMED }).map((_, i) => (
            <div
              key={i}
              className={`h-2 w-6 rounded-full transition-all ${i < confirmed.size ? "bg-green-500" : "bg-gray-200"}`}
            />
          ))}
        </div>
        <span className="text-gray-500 text-xs">
          {confirmed.size}/{MIN_CONFIRMED} confirmed
        </span>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={handleSkip}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          I'll edit later →
        </button>

        {!canProceed && (
          <p className="text-xs text-amber-600 text-center">
            ⚠️ Confirm {MIN_CONFIRMED - confirmed.size} more for better matching
          </p>
        )}

        <button
          onClick={handleProceed}
          disabled={!canProceed}
          className={`
            px-6 py-2.5 rounded-xl font-semibold text-sm transition-all
            ${canProceed
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"}
          `}
        >
          Looks good →
        </button>
      </div>
    </div>
  );
}
