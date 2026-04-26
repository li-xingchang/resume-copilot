/**
 * Resume Co-Pilot content script — works on any careers/job page.
 *
 * Lifecycle:
 *   1. Run on every page; detect if it looks like a job listing.
 *   2. Extract JD text, company, title from the DOM.
 *   3. POST /score → inject floating widget showing match breakdown + gaps.
 *   4. "Fix" buttons open /tailor in the dashboard.
 *   5. "Approve & Pre-fill" calls /approve, then fills input fields field-by-field
 *      with a random 8-22s delay between each (enforced by background.ts messaging).
 *
 * Guardrails:
 *   - NEVER call .click() on a submit button.
 *   - NEVER auto-submit. User must click Submit themselves.
 *   - Log every field fill to /audit via background message.
 *   - Rate limit checked by background before every pre-fill batch.
 */

import type { PlasmoCSConfig } from "plasmo";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

// ---------------------------------------------------------------------------
// Plasmo config — runs on all pages; widget only mounts on job pages
// ---------------------------------------------------------------------------

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
};

// ---------------------------------------------------------------------------
// Job page detection — heuristics to decide if we should show the widget
// ---------------------------------------------------------------------------

function isJobPage(): boolean {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const bodyText = document.body.innerText.slice(0, 3000).toLowerCase();

  // URL signals
  const urlSignals = [
    "jobs", "careers", "apply", "job", "position", "opening",
    "greenhouse.io", "lever.co", "workday.com", "ashbyhq.com",
    "smartrecruiters.com", "workable.com", "bamboohr.com",
    "icims.com", "taleo.net", "myworkdayjobs.com", "jobvite.com",
    "recruitee.com", "dover.com", "rippling.com",
  ];

  // Page content signals
  const contentSignals = [
    "job description", "responsibilities", "qualifications", "requirements",
    "about the role", "what you'll do", "what we're looking for",
    "apply now", "submit application", "years of experience",
  ];

  const hasUrlSignal = urlSignals.some((s) => url.includes(s));
  const hasTitleSignal = ["job", "role", "engineer", "manager", "analyst", "designer", "director"].some((s) => title.includes(s));
  const hasContentSignal = contentSignals.filter((s) => bodyText.includes(s)).length >= 2;

  return hasUrlSignal || (hasTitleSignal && hasContentSignal);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GapItem {
  requirement: string;
  type: "must" | "nice";
  weight: number;
  evidence_strength: number;
  fact_id: string | null;
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
  cached: boolean;
}

interface ResumeVersion {
  id: string;
  company: string | null;
  title: string | null;
  created_at: string;
  diff_summary: string;
}

// ---------------------------------------------------------------------------
// DOM extraction helpers (Greenhouse-specific selectors)
// ---------------------------------------------------------------------------

function extractJDText(): string {
  const selectors = [
    '[data-qa="job-description"]',
    ".job-description",
    "#content",
    "main",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return document.body.innerText.slice(0, 8000);
}

function extractCompany(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]');
  if (meta?.content) return meta.content;
  const title = document.title;
  const match = title.match(/at (.+?) -/i) ?? title.match(/^(.+?) \|/);
  return match?.[1]?.trim() ?? window.location.hostname.replace("boards.", "");
}

function extractJobTitle(): string {
  const selectors = [
    '[data-qa="job-title"]',
    "h1.app-title",
    "h1",
    'meta[property="og:title"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement | HTMLMetaElement>(sel);
    const text =
      el instanceof HTMLMetaElement ? el.content : el?.textContent?.trim();
    if (text) return text.replace(/\s+at\s+.*/i, "").trim();
  }
  return "Unknown Role";
}

// ---------------------------------------------------------------------------
// Greenhouse form field selectors for pre-fill
// Maps canonical resume sections to DOM input selectors.
// ---------------------------------------------------------------------------

interface FieldMapping {
  label: string;
  selector: string;
  value: (content: string) => string;
}

function getFieldMappings(markdownContent: string): FieldMapping[] {
  // Extract sections from markdown — naive but sufficient for MVP
  const extractSection = (header: string): string => {
    const re = new RegExp(`## ${header}\\s*([\\s\\S]*?)(?=## |$)`, "i");
    return markdownContent.match(re)?.[1]?.trim() ?? "";
  };

  return [
    {
      label: "first_name",
      selector:
        'input[name="job_application[first_name]"], input[data-qa="first-name"]',
      value: () => "", // pulled from user profile, not resume
    },
    {
      label: "resume_text",
      selector:
        'textarea[name="job_application[cover_letter]"], textarea[data-qa="cover-letter"]',
      value: () => extractSection("Summary"),
    },
  ].filter((f) => f.value(markdownContent).length > 0);
}

// ---------------------------------------------------------------------------
// Background message helpers
// ---------------------------------------------------------------------------

type BgMessage =
  | { type: "CHECK_RATE_LIMIT"; domain: string }
  | { type: "LOG_FIELD_FILL"; domain: string; fieldLabel: string; userId: string; applicationId: string }
  | { type: "GET_USER_ID" }
  | { type: "GET_VERSIONS" };

function sendToBackground<T>(msg: BgMessage): Promise<T> {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage(msg, (response: T) => resolve(response))
  );
}

// ---------------------------------------------------------------------------
// Score widget React component
// ---------------------------------------------------------------------------

const API = process.env.PLASMO_PUBLIC_BACKEND_URL ?? "http://localhost:8000";
const APP_URL = process.env.PLASMO_PUBLIC_APP_URL ?? "http://localhost:3000";

function ScoreWidget() {
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [prefilling, setPrefilling] = useState(false);
  const [prefillDone, setPrefillDone] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const jdText = useRef(extractJDText());
  const company = useRef(extractCompany());
  const title = useRef(extractJobTitle());

  useEffect(() => {
    (async () => {
      // Get userId from background (stored after login)
      const uid = await sendToBackground<string | null>({ type: "GET_USER_ID" });
      if (!uid) {
        setError("Not logged in. Open the extension popup to sign in.");
        setLoading(false);
        return;
      }
      setUserId(uid);

      // Fetch score
      try {
        const res = await fetch(`${API}/score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: uid,
            jd_text: jdText.current,
            company: company.current,
            title: title.current,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data: ScoreResult = await res.json();
        setScore(data);

        // Cache score in storage for /tailor page to read
        await chrome.storage.local.set({
          [`score_${data.jd_hash}`]: JSON.stringify(data),
        });

        // Fetch versions for dropdown
        const vRes = await fetch(`${API}/versions?user_id=${uid}`);
        if (vRes.ok) {
          const vData: { nodes: ResumeVersion[] } = await vRes.json();
          setVersions(vData.nodes.filter((v) => v.diff_summary !== "Original upload"));
          if (vData.nodes.length > 0) {
            setSelectedVersionId(vData.nodes[vData.nodes.length - 1].id);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleFix = (req: string, jdHash: string) => {
    const url = `${APP_URL}/tailor?jd_hash=${jdHash}&focus=${encodeURIComponent(req)}`;
    window.open(url, "_blank", "noopener");
  };

  const handleApproveAndPrefill = async () => {
    if (!score || !userId || !selectedVersionId) return;

    // Check rate limit before doing anything
    const allowed = await sendToBackground<boolean>({
      type: "CHECK_RATE_LIMIT",
      domain: window.location.hostname,
    });
    if (!allowed) {
      alert("Rate limit reached: max 20 pre-fills per hour per domain. Try again later.");
      return;
    }

    setPrefilling(true);

    // Register application
    let applicationId = "";
    try {
      const res = await fetch(`${API}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          version_id: selectedVersionId,
          jd_hash: score.jd_hash,
          company: company.current,
          platform: "greenhouse",
          target_domain: window.location.hostname,
        }),
      });
      const data = await res.json();
      applicationId = data.application_id;
    } catch {
      setError("Failed to register application. Pre-fill aborted.");
      setPrefilling(false);
      return;
    }

    // Fetch full version markdown for field values
    const vRes = await fetch(`${API}/versions/${selectedVersionId}`);
    if (!vRes.ok) {
      setError("Could not fetch version content.");
      setPrefilling(false);
      return;
    }
    const vData = await vRes.json();
    const mappings = getFieldMappings(vData.markdown_content ?? "");

    // Fill fields one by one with randomised delay (enforced by background)
    for (const field of mappings) {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        field.selector
      );
      if (!input) continue;

      // Wait for background to signal the random delay has elapsed
      await sendToBackground<void>({
        type: "LOG_FIELD_FILL",
        domain: window.location.hostname,
        fieldLabel: field.label,
        userId,
        applicationId,
      });

      // Set value using React-compatible setter (required for controlled inputs)
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set;

      const val = field.value(vData.markdown_content ?? "");
      if (input instanceof HTMLTextAreaElement) {
        nativeTextareaSetter?.call(input, val);
      } else {
        nativeInputValueSetter?.call(input, val);
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    setPrefillDone(true);
    setPrefilling(false);

    // Show "Review and Submit" toast — user must click Submit themselves
    showReviewToast();
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={widgetButtonStyle}
        title="Resume Co-Pilot — click to expand"
      >
        🎯 {score ? `${score.overall}%` : "…"}
      </button>
    );
  }

  return (
    <div style={widgetStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Resume Co-Pilot</span>
        <button onClick={() => setCollapsed(true)} style={closeBtn}>
          ×
        </button>
      </div>

      {loading && <p style={mutedText}>Scoring…</p>}
      {error && <p style={errorText}>{error}</p>}

      {score && !loading && (
        <>
          {/* Score summary */}
          <div style={scoreRow}>
            <ScorePill label="Match" value={score.overall} />
            <ScorePill label="Coverage" value={score.coverage} />
            <ScorePill label="Seniority" value={score.seniority_fit} />
            <ScorePill label="Evidence" value={score.evidence_gap} />
          </div>

          {/* Cohort note */}
          <p style={{ ...mutedText, marginBottom: 10 }}>{score.cohort_note}</p>

          {/* Gaps */}
          {score.gaps.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, color: "#374151" }}>
                Gaps to address:
              </p>
              {score.gaps.map((g, i) => (
                <div key={i} style={gapRow}>
                  <span
                    style={{
                      ...gapBadge,
                      background: g.type === "must" ? "#fee2e2" : "#fef9c3",
                      color: g.type === "must" ? "#b91c1c" : "#92400e",
                    }}
                  >
                    {g.type}
                  </span>
                  <span style={{ fontSize: 11, flex: 1, lineHeight: 1.4 }}>
                    {g.requirement}
                  </span>
                  <button
                    onClick={() => handleFix(g.requirement, score.jd_hash)}
                    style={fixBtn}
                  >
                    Fix →
                  </button>
                </div>
              ))}
            </div>
          )}

          <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "8px 0" }} />

          {/* Version selector */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11, color: "#6b7280", display: "block", marginBottom: 4 }}>
              Resume version
            </label>
            <select
              value={selectedVersionId}
              onChange={(e) => setSelectedVersionId(e.target.value)}
              style={selectStyle}
            >
              {versions.length === 0 && (
                <option value="">No tailored versions yet</option>
              )}
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.company ?? "—"} · {v.diff_summary} ·{" "}
                  {new Date(v.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleApproveAndPrefill}
            disabled={prefilling || prefillDone || !selectedVersionId}
            style={{
              ...approveBtn,
              background: prefillDone ? "#16a34a" : prefilling ? "#6b7280" : "#2563eb",
            }}
          >
            {prefillDone
              ? "✓ Fields pre-filled — Review and Submit"
              : prefilling
              ? "Filling fields…"
              : "Approve & Pre-fill"}
          </button>

          <p style={{ ...mutedText, textAlign: "center", marginTop: 4 }}>
            ⚠️ This extension never clicks Submit. You review and submit.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast (non-blocking — anchored to bottom of page)
// ---------------------------------------------------------------------------

function showReviewToast() {
  const toast = document.createElement("div");
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "#1e3a5f",
    color: "#fff",
    padding: "12px 24px",
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "system-ui, sans-serif",
    zIndex: "2147483647",
    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    maxWidth: "400px",
    textAlign: "center",
  });
  toast.textContent =
    "✅ Fields pre-filled from your resume memory. Review everything, then click Submit yourself.";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 7000);
}

// ---------------------------------------------------------------------------
// Inline styles (no CSS file needed for content scripts)
// ---------------------------------------------------------------------------

const widgetStyle: React.CSSProperties = {
  position: "fixed",
  top: 20,
  right: 20,
  width: 320,
  background: "#fff",
  border: "1.5px solid #e5e7eb",
  borderRadius: 12,
  boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "12px 14px 14px",
  zIndex: 2147483646,
  fontSize: 12,
};

const widgetButtonStyle: React.CSSProperties = {
  position: "fixed",
  top: 20,
  right: 20,
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontFamily: "system-ui, sans-serif",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
  zIndex: 2147483646,
  boxShadow: "0 2px 10px rgba(37,99,235,0.4)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
};

const closeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 18,
  cursor: "pointer",
  color: "#9ca3af",
  lineHeight: 1,
  padding: "0 2px",
};

const scoreRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginBottom: 8,
};

const mutedText: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 11,
  lineHeight: 1.4,
};

const errorText: React.CSSProperties = {
  color: "#b91c1c",
  fontSize: 11,
};

const gapRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  marginBottom: 5,
  padding: "5px 6px",
  background: "#f9fafb",
  borderRadius: 6,
};

const gapBadge: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  padding: "2px 5px",
  borderRadius: 4,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  flexShrink: 0,
  marginTop: 1,
};

const fixBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid #d1d5db",
  borderRadius: 4,
  padding: "2px 7px",
  fontSize: 10,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 11,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "5px 8px",
  background: "#fff",
};

const approveBtn: React.CSSProperties = {
  width: "100%",
  border: "none",
  borderRadius: 8,
  padding: "9px 0",
  color: "#fff",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
  transition: "background 0.2s",
};

function ScorePill({ label, value }: { label: string; value: number }) {
  const color =
    value >= 75 ? "#16a34a" : value >= 55 ? "#d97706" : "#dc2626";
  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        background: "#f3f4f6",
        borderRadius: 8,
        padding: "6px 4px",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>
        {value}%
      </div>
      <div style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount the widget — only on pages that look like job listings
// ---------------------------------------------------------------------------

if (isJobPage()) {
  const container = document.createElement("div");
  container.id = "resume-copilot-root";
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(<ScoreWidget />);
}

export default ScoreWidget;
