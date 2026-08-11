"use client";

import { useState } from "react";

interface DuplicateRecord {
  id: string;
  characterName: string | null;
  isNPP: boolean;
  isFilled: boolean;
  electedAt: string | null;
  updatedAt: string;
  isKept: boolean;
}

interface DuplicateSeat {
  seatKey: string;
  officeType: string;
  state?: string;
  senateClass?: number;
  district?: number;
  records: DuplicateRecord[];
}

interface DiagnosticResult {
  status: string;
  message: string;
  totalOfficials: number;
  duplicateSeats: number;
  staleRecords: number;
  duplicates: DuplicateSeat[];
}

export function HealStaleAdminAppointments() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/stale-admin-appointments");
      const data = await res.json();
      if (res.ok) {
        setDiagnostic(data);
      } else {
        setResult({ ok: false, message: data.error ?? "Diagnostic failed" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const runHeal = async () => {
    if (
      !confirm(
        "This will remove stale admin-appointed officials that have been superseded by election winners.\n\nFilled records are kept over vacant ones. Continue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/stale-admin-appointments", { method: "POST" });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message ?? data.error ?? "Unknown response" });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal Stale Admin Appointments</h3>
        <p className="mt-1 text-xs text-muted">
          Removes duplicate electedOfficials records for the same seat. Keeps filled records over
          vacant ones, and most recent among equal fill status. Fixes admin-appointed officials that
          weren&apos;t cleaned up after elections.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Running..." : "Diagnose"}
        </button>
        <button
          onClick={runHeal}
          disabled={loading}
          className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
        >
          {loading ? "Healing..." : "Heal All"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 text-xs space-y-2">
          <div className="flex gap-4">
            <span>
              <span className="font-medium">Total officials:</span> {diagnostic.totalOfficials}
            </span>
            <span>
              <span className="font-medium">Duplicate seats:</span> {diagnostic.duplicateSeats}
            </span>
            <span>
              <span className="font-medium">Stale records:</span> {diagnostic.staleRecords}
            </span>
          </div>

          {diagnostic.duplicates.length > 0 ? (
            <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
              {diagnostic.duplicates.slice(0, 20).map((dup, i) => (
                <div key={i} className="border-t border-card-border pt-2">
                  <div className="font-medium text-muted">{dup.seatKey}</div>
                  <ul className="mt-1 ml-4 list-disc">
                    {dup.records.map((r, j) => (
                      <li
                        key={j}
                        className={
                          r.isKept ? "text-success" : r.isFilled ? "text-error" : "text-warning"
                        }
                      >
                        {r.characterName ?? "(vacant)"} {r.isNPP ? "[NPP]" : ""}
                        {!r.isFilled ? " [vacant record]" : ""}
                        {r.isKept ? " ← kept" : " ← will remove"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {diagnostic.duplicates.length > 20 && (
                <p className="text-muted">...and {diagnostic.duplicates.length - 20} more</p>
              )}
            </div>
          ) : (
            <p className="text-success">No duplicate officials found</p>
          )}
        </div>
      )}

      {result && (
        <p className={`text-xs font-medium ${result.ok ? "text-success" : "text-error"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
