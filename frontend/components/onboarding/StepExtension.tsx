"use client";

import React, { useEffect, useState } from "react";
import { setOnboardingStep, track } from "@/lib/onboarding";

interface Props {
  onComplete: () => void;
}

type Status = "checking" | "installed" | "not_installed";

export default function StepExtension({ onComplete }: Props) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    track("extension_step_viewed");
    checkExtension();
  }, []);

  function checkExtension() {
    setStatus("checking");
    try {
      // @ts-ignore — chrome is injected by extension runtime
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        // Try to ping the extension — if it responds, it's installed
        // @ts-ignore
        chrome.runtime.sendMessage(
          undefined,
          { type: "GET_USER_ID" },
          (res: unknown) => {
            // @ts-ignore
            if (chrome.runtime.lastError || res === undefined) {
              setStatus("not_installed");
            } else {
              setStatus("installed");
            }
          }
        );
        // Fallback timeout
        setTimeout(() => {
          setStatus((s) => (s === "checking" ? "not_installed" : s));
        }, 1500);
      } else {
        setStatus("not_installed");
      }
    } catch {
      setStatus("not_installed");
    }
  }

  function handleComplete() {
    track("onboarding_completed", { extensionInstalled: status === "installed" });
    setOnboardingStep("complete");
    onComplete();
  }

  function handleSkip() {
    track("extension_install_skipped");
    setOnboardingStep("complete");
    onComplete();
  }

  return (
    <div className="max-w-lg mx-auto text-center">
      <div className="text-6xl mb-4">
        {status === "checking" ? "⏳" : status === "installed" ? "🎉" : "🧩"}
      </div>

      {status === "checking" && (
        <>
          <h2 className="text-xl font-bold mb-2">Checking for extension…</h2>
          <div className="h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </>
      )}

      {status === "installed" && (
        <>
          <h2 className="text-xl font-bold mb-2 text-green-700">Extension detected! 🎉</h2>
          <p className="text-sm text-gray-500 mb-6">
            You're all set. The score widget will appear automatically on any job page you visit.
          </p>
          <button
            onClick={handleComplete}
            className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors"
          >
            Go to Dashboard →
          </button>
        </>
      )}

      {status === "not_installed" && (
        <>
          <h2 className="text-xl font-bold mb-2">Last step: Add to Chrome</h2>
          <p className="text-sm text-gray-500 mb-6">
            The extension scores jobs automatically as you browse. It{" "}
            <strong>never applies without you</strong> — you always review and click Submit.
          </p>

          {/* How it works */}
          <div className="bg-gray-50 rounded-2xl p-5 mb-6 text-left space-y-3">
            {[
              { icon: "🔍", text: "Open any job posting — widget appears automatically" },
              { icon: "📊", text: "See your match score and gaps in seconds" },
              { icon: "✍️", text: "Approve tailored bullets, pre-fill the form" },
              { icon: "✅", text: "You review and click Submit — we never do" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xl">{item.icon}</span>
                <p className="text-sm text-gray-700">{item.text}</p>
              </div>
            ))}
          </div>

          {/* Install instructions */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-left">
            <p className="text-sm font-semibold text-blue-800 mb-2">To load the extension in Chrome:</p>
            <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
              <li>Open Chrome → <code className="bg-blue-100 px-1 rounded">chrome://extensions</code></li>
              <li>Toggle <strong>Developer mode</strong> ON (top right)</li>
              <li>Click <strong>Load unpacked</strong></li>
              <li>Select the <code className="bg-blue-100 px-1 rounded">extension/build/chrome-mv3-prod</code> folder</li>
            </ol>
          </div>

          <button
            onClick={checkExtension}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors mb-3"
          >
            I installed it — check again
          </button>

          <p className="text-xs text-gray-400 mb-2">
            On mobile? The extension requires desktop Chrome.
          </p>

          <button
            onClick={handleSkip}
            className="text-sm text-gray-400 hover:text-gray-600 underline"
          >
            Skip for now
          </button>
        </>
      )}
    </div>
  );
}
