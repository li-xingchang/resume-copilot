/**
 * Extension popup — shown when user clicks the toolbar icon.
 * Reads userId from chrome.storage (written by the dashboard after Clerk login).
 * If not connected, opens the dashboard sign-in page with ?extension=true
 * so the dashboard can post SET_USER_ID back to the extension.
 */

import { useEffect, useState } from "react"

const APP_URL = process.env.PLASMO_PUBLIC_APP_URL ?? "http://localhost:3000"

export default function Popup() {
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    chrome.storage.local.get("userId", (res) => {
      setUserId(res.userId ?? null)
      setLoading(false)
    })

    // Listen for SET_USER_ID from the dashboard tab (fired after Clerk login)
    const listener = (msg: { type: string; userId?: string }) => {
      if (msg.type === "SET_USER_ID" && msg.userId) {
        chrome.storage.local.set({ userId: msg.userId })
        setUserId(msg.userId)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handleConnect = () => {
    chrome.tabs.create({ url: `${APP_URL}/sign-in?extension=true` })
  }

  const handleDisconnect = () => {
    chrome.storage.local.remove("userId")
    setUserId(null)
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={{ fontSize: 18 }}>🎯</span>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Resume Co-Pilot</span>
      </div>

      {loading ? (
        <p style={mutedStyle}>Loading…</p>
      ) : userId ? (
        <>
          <div style={connectedBadge}>
            <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Connected</span>
          </div>
          <p style={mutedStyle}>
            The score widget will appear automatically on Greenhouse and Lever job pages.
          </p>
          <button onClick={handleDisconnect} style={secondaryBtn}>
            Disconnect account
          </button>
        </>
      ) : (
        <>
          <p style={mutedStyle}>
            Connect your Resume Co-Pilot account to score and pre-fill job applications.
          </p>
          <button onClick={handleConnect} style={primaryBtn}>
            Connect to Resume Co-Pilot
          </button>
        </>
      )}

      <div style={footerStyle}>
        <a href={`${APP_URL}/graph`} target="_blank" rel="noreferrer" style={linkStyle}>
          Version graph →
        </a>
        <a href={`${APP_URL}/queue`} target="_blank" rel="noreferrer" style={linkStyle}>
          Apply queue →
        </a>
      </div>
    </div>
  )
}

// Inline styles — no Tailwind in popup context
const containerStyle: React.CSSProperties = {
  width: 260,
  padding: "16px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 13,
  color: "#111827",
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 14,
  paddingBottom: 12,
  borderBottom: "1px solid #e5e7eb",
}

const connectedBadge: React.CSSProperties = {
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: 6,
  padding: "6px 10px",
  marginBottom: 10,
  fontSize: 12,
}

const mutedStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 12,
  lineHeight: 1.5,
  marginBottom: 12,
}

const primaryBtn: React.CSSProperties = {
  width: "100%",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 7,
  padding: "9px 0",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
}

const secondaryBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  color: "#6b7280",
  cursor: "pointer",
}

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginTop: 14,
  paddingTop: 12,
  borderTop: "1px solid #e5e7eb",
}

const linkStyle: React.CSSProperties = {
  color: "#2563eb",
  fontSize: 11,
  textDecoration: "none",
}
