"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  OnboardingStep,
  STEPS,
  getOnboardingStep,
  setOnboardingStep,
  track,
} from "@/lib/onboarding";
import StepUpload from "@/components/onboarding/StepUpload";
import StepVerify from "@/components/onboarding/StepVerify";
import StepFirstScore from "@/components/onboarding/StepFirstScore";
import StepExtension from "@/components/onboarding/StepExtension";

const STEP_ORDER: OnboardingStep[] = ["upload", "verify", "first_score", "extension"];

export default function OnboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("upload");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Honour ?step= param, falling back to persisted state
    const paramStep = searchParams.get("step") as OnboardingStep | null;
    const persistedStep = getOnboardingStep();

    const step =
      paramStep && STEP_ORDER.includes(paramStep)
        ? paramStep
        : persistedStep === "complete"
        ? "upload"
        : persistedStep;

    setCurrentStep(step);
    setMounted(true);
    track("onboarding_started", { step });
  }, []);

  function advanceTo(step: OnboardingStep) {
    setCurrentStep(step);
    router.replace(`/onboard?step=${step}`);
  }

  function handleStepComplete() {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx < STEP_ORDER.length - 1) {
      advanceTo(STEP_ORDER[idx + 1]);
    } else {
      // Final step complete → go to dashboard
      setOnboardingStep("complete");
      router.push("/graph");
    }
  }

  const currentIdx = STEP_ORDER.indexOf(currentStep);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top progress bar */}
      <div className="h-1 bg-gray-200 fixed top-0 left-0 right-0 z-50">
        <div
          className="h-full bg-blue-600 transition-all duration-500"
          style={{ width: `${((currentIdx + 1) / STEP_ORDER.length) * 100}%` }}
        />
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-16 pb-16">
        {/* Step indicators */}
        <div className="flex items-center justify-between mb-10">
          {STEPS.map((step, i) => {
            const isDone = i < currentIdx;
            const isActive = i === currentIdx;
            return (
              <React.Fragment key={step.key}>
                <div className="flex flex-col items-center gap-1 text-center">
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                      isDone
                        ? "bg-blue-600 border-blue-600 text-white"
                        : isActive
                        ? "border-blue-600 text-blue-600 bg-white"
                        : "border-gray-200 text-gray-300 bg-white"
                    }`}
                  >
                    {isDone ? "✓" : i + 1}
                  </div>
                  <span
                    className={`text-[11px] font-medium hidden sm:block ${
                      isActive ? "text-blue-600" : isDone ? "text-gray-700" : "text-gray-300"
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-2 transition-all ${i < currentIdx ? "bg-blue-600" : "bg-gray-200"}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Step description */}
        <p className="text-center text-xs text-gray-400 -mt-6 mb-8">
          {STEPS[currentIdx]?.description}
        </p>

        {/* Step content */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {currentStep === "upload" && (
            <StepUpload onComplete={handleStepComplete} />
          )}
          {currentStep === "verify" && (
            <StepVerify onComplete={handleStepComplete} />
          )}
          {currentStep === "first_score" && (
            <StepFirstScore onComplete={handleStepComplete} />
          )}
          {currentStep === "extension" && (
            <StepExtension onComplete={handleStepComplete} />
          )}
        </div>

        {/* Skip entire onboarding */}
        {currentStep !== "extension" && (
          <p className="text-center mt-6 text-xs text-gray-400">
            Already set up?{" "}
            <button
              onClick={() => {
                setOnboardingStep("complete");
                router.push("/graph");
              }}
              className="underline hover:text-gray-600"
            >
              Go to dashboard
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
