"use client";

/**
 * /sign-in — Clerk sign-in page.
 *
 * When opened with ?extension=true (from the extension popup), this page
 * waits for Clerk auth to complete then posts the userId back to the extension
 * via chrome.runtime.sendMessage so the popup can store it in chrome.storage.
 *
 * The extension's background.ts handles SET_USER_ID and writes to storage.
 * The content script reads it back via GET_USER_ID.
 */

import { SignIn, useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function SignInPage() {
  const { user, isLoaded } = useUser();
  const searchParams = useSearchParams();
  const isExtension = searchParams.get("extension") === "true";

  useEffect(() => {
    if (!isLoaded || !user || !isExtension) return;

    // Send userId to extension. This requires the extension to be installed;
    // it silently no-ops if not (chrome is undefined in a normal browser context).
    try {
      // @ts-ignore — chrome is injected by the extension runtime
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        // The extension ID can be hardcoded here after publishing, or read from
        // a meta tag injected by the extension content script.
        // For dev, Plasmo dev mode injects window.__plasmo_extension_id.
        // @ts-ignore
        const extId = window.__plasmo_extension_id;
        if (extId) {
          // @ts-ignore
          chrome.runtime.sendMessage(extId, {
            type: "SET_USER_ID",
            userId: user.id,
          });
        }
      }
    } catch {
      // Extension not installed or wrong context — non-fatal
    }
  }, [isLoaded, user, isExtension]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="flex flex-col items-center gap-6">
        {isExtension && (
          <div className="text-center max-w-sm">
            <h1 className="text-lg font-semibold mb-1">Connect Resume Co-Pilot</h1>
            <p className="text-sm text-gray-500">
              Sign in to link your account to the browser extension.
              The popup will update automatically once you're signed in.
            </p>
          </div>
        )}
        <SignIn
          afterSignInUrl={isExtension ? "/sign-in?extension=true&done=true" : "/onboard"}
          afterSignUpUrl="/onboard"
        />
        {isExtension && user && (
          <p className="text-sm text-green-600 font-medium">
            ✓ Connected — you can close this tab and return to the extension.
          </p>
        )}
      </div>
    </div>
  );
}
