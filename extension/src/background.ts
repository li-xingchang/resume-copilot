/**
 * Extension background service worker.
 *
 * Responsibilities:
 *   1. Rate-limit enforcement: max 20 pre-fills per hour per domain.
 *      Uses chrome.storage.local with a rolling window of timestamps.
 *   2. Random delay between field fills: 8-22 seconds.
 *      The content script awaits a LOG_FIELD_FILL message; background sleeps
 *      the random delay, posts to /audit, then resolves.
 *   3. User-id relay: stores userId after login so content scripts can read it
 *      without needing their own auth flow.
 *
 * Guardrails:
 *   - Never auto-click Submit.
 *   - Rate-limit check is enforced HERE, not in content.js, to prevent spoofing.
 */

const API = process.env.PLASMO_PUBLIC_BACKEND_URL ?? "http://localhost:8000";
const MAX_PREFILLS_PER_HOUR = 20;
const MIN_DELAY_MS = 8_000;
const MAX_DELAY_MS = 22_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rolling-window rate limit. Returns true if the action is allowed. */
async function checkAndRecordPrefill(domain: string): Promise<boolean> {
  const key = `prefill_log_${domain}`;
  const nowMs = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour

  const stored = await chrome.storage.local.get(key);
  const timestamps: number[] = stored[key] ?? [];

  // Prune timestamps older than 1 hour
  const recent = timestamps.filter((t) => nowMs - t < windowMs);

  if (recent.length >= MAX_PREFILLS_PER_HOUR) {
    return false; // rate limited
  }

  recent.push(nowMs);
  await chrome.storage.local.set({ [key]: recent });
  return true;
}

async function postAudit(payload: {
  user_id: string;
  application_id: string;
  action_type: string;
  target_domain: string;
  metadata: Record<string, string>;
}): Promise<void> {
  try {
    await fetch(`${API}/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Audit posting is best-effort; don't block the fill
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: {
      type: string;
      domain?: string;
      fieldLabel?: string;
      userId?: string;
      applicationId?: string;
    },
    _sender,
    sendResponse
  ) => {
    if (message.type === "GET_USER_ID") {
      chrome.storage.local.get("userId", (res) => {
        sendResponse(res.userId ?? null);
      });
      return true; // keep channel open for async response
    }

    if (message.type === "CHECK_RATE_LIMIT") {
      const domain = message.domain!;
      checkAndRecordPrefill(domain).then((allowed) => sendResponse(allowed));
      return true;
    }

    if (message.type === "LOG_FIELD_FILL") {
      const { domain, fieldLabel, userId, applicationId } = message;

      // Sleep the random delay, then audit, then resolve to unblock content.js
      (async () => {
        const delay = randomDelay();
        await sleep(delay);

        await postAudit({
          user_id: userId!,
          application_id: applicationId!,
          action_type: "field_filled",
          target_domain: domain!,
          metadata: {
            field: fieldLabel!,
            delay_ms: String(Math.round(delay)),
          },
        });

        sendResponse(true);
      })();
      return true; // keep channel open for async response
    }

    if (message.type === "SET_USER_ID") {
      chrome.storage.local.set({ userId: message.userId });
      sendResponse(true);
      return false;
    }

    return false;
  }
);

// ---------------------------------------------------------------------------
// Alarm: clear prefill logs older than 2 hours to prevent unbounded growth
// ---------------------------------------------------------------------------

chrome.alarms.create("cleanup-prefill-logs", { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "cleanup-prefill-logs") return;
  const all = await chrome.storage.local.get(null);
  const nowMs = Date.now();
  const toRemove: string[] = [];

  for (const [key, val] of Object.entries(all)) {
    if (!key.startsWith("prefill_log_")) continue;
    const recent = (val as number[]).filter((t) => nowMs - t < 2 * 60 * 60 * 1000);
    if (recent.length === 0) {
      toRemove.push(key);
    } else {
      await chrome.storage.local.set({ [key]: recent });
    }
  }

  if (toRemove.length > 0) {
    await chrome.storage.local.remove(toRemove);
  }
});
