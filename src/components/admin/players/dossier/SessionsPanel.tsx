"use client";

// SessionsPanel — the recent login/logout stream. Each row: direction glyph,
// relative time (absolute on hover), IP + fingerprint anchors, UA. Kept
// deliberately dense — an investigator scans this for "same IP as the other
// account, minutes apart".

import { formatRelative } from "@/components/admin/forensics/types";
import { formatDateTime, OVERLINE_CLS, PANEL_CLS, type DossierSessionRow } from "./dossierTypes";

interface SessionsPanelProps {
  sessions: DossierSessionRow[];
}

export function SessionsPanel({ sessions }: SessionsPanelProps) {
  return (
    <section className={PANEL_CLS} aria-label="Recent sessions">
      <h3 className={`mb-2 ${OVERLINE_CLS}`}>Recent sessions ({sessions.length})</h3>
      {sessions.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">No login activity recorded.</p>
      ) : (
        <ul className="divide-y divide-card-border/50">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 py-2">
              <span
                aria-hidden
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  s.type === "login"
                    ? "bg-green-500/10 text-green-400"
                    : "bg-gray-500/10 text-gray-400"
                }`}
              >
                {s.type === "login" ? "↓" : "↑"}
              </span>
              <span className="w-12 flex-shrink-0 text-[11px] font-medium capitalize">
                {s.type}
              </span>
              <span
                className="w-16 flex-shrink-0 tabular-nums text-[11px] text-muted"
                title={formatDateTime(s.timestamp)}
              >
                {formatRelative(s.timestamp)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] tracking-tight text-foreground/85">
                {s.ipAddress ?? "—"}
                {s.fingerprint && <span className="text-muted"> · {s.fingerprint}</span>}
              </span>
              {s.userAgent && (
                <span
                  className="hidden max-w-[180px] truncate text-[10px] text-muted lg:inline"
                  title={s.userAgent}
                >
                  {s.userAgent}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
