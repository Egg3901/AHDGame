"use client";

import { useState } from "react";

interface DiagnosticResult {
  status: string;
  message: string;
  usersWithoutActiveCharacterId: number;
  brokenActiveCharacterIdLinks: number;
  charactersMissingCountryId: number;
  totalUsersChecked: number;
  totalCharactersChecked: number;
}

export function HealDiscordUsers() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/discord-users");
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
        "This will backfill missing activeCharacterId links, fix broken character references, and add missing countryId to characters.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/discord-users", { method: "POST" });
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
        <h3 className="font-semibold text-sm">Heal Player Account Linkage</h3>
        <p className="mt-1 text-xs text-muted">
          Detects and fixes missing activeCharacterId links, broken character references, and
          characters missing countryId. Affects Discord-registered and legacy accounts.
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
        <div className="rounded-lg border border-card-border bg-background p-3 text-xs space-y-1">
          <p className={diagnostic.status === "ok" ? "text-success" : "text-error"}>
            {diagnostic.message}
          </p>
          {diagnostic.status !== "ok" && (
            <div className="text-muted text-xs space-y-0.5 mt-2">
              <p>
                • Missing activeCharacterId:{" "}
                <span className="font-semibold">{diagnostic.usersWithoutActiveCharacterId}</span>
              </p>
              <p>
                • Broken character links:{" "}
                <span className="font-semibold">{diagnostic.brokenActiveCharacterIdLinks}</span>
              </p>
              <p>
                • Characters missing countryId:{" "}
                <span className="font-semibold">{diagnostic.charactersMissingCountryId}</span>
              </p>
            </div>
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
