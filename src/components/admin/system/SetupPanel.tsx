"use client";

import { useCallback, useEffect, useState } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { ImfInstitutionSeedForm } from "@/components/admin/economy/ImfInstitutionSeedForm";

interface SetupStatus {
  ready: boolean;
  checks: Record<string, boolean>;
  gameState: { currentTurn: number; isActive: boolean } | null;
  counts: Record<string, number>;
}

interface SetupResult {
  success: boolean;
  message: string;
  scope: string;
  logs: string[];
}

const CHECK_LABELS: Record<string, string> = {
  states: "US States",
  policies: "Policies",
  gameConfig: "Game Config",
  gameState: "Game State",
  parties: "Political Parties",
  demographics: "Demographics",
  electedOfficials: "Elected Officials",
  elections: "Elections",
  seats: "Seats",
  partyBudgets: "Party Budgets",
  unownedSectors: "Unowned Sectors",
};

interface ImfSeedStatus {
  seeded: boolean;
  corporationId?: string;
  sequentialId?: number | null;
}

export function SetupPanel() {
  const registered = useRegisteredCountries();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [imfStatus, setImfStatus] = useState<ImfSeedStatus | null>(null);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<CountryId | "all">("US");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/setup");
      if (!res.ok) throw new Error(`Status check failed (${res.status})`);
      const data: SetupStatus = await res.json();
      setStatus(data);
      setError(null);

      const imfRes = await fetch("/api/admin/imf/seed");
      if (imfRes.ok) {
        const imfJson = (await imfRes.json()) as ImfSeedStatus;
        setImfStatus(imfJson);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const runSetup = async () => {
    if (
      !confirm(
        "This will seed all reference data, initialize game state, and create elected officials.\n\nExisting data is preserved (idempotent). Continue?"
      )
    )
      return;

    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Setup failed (${res.status})`);
      setResult(data);
      // Refresh status after setup
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const allReady = status?.ready ?? false;
  const checks = status?.checks ?? {};
  const passCount = Object.values(checks).filter(Boolean).length;
  const totalCount = Object.keys(checks).length;

  return (
    <div className="space-y-6">
      {/* Status overview */}
      <div
        className={`rounded-xl border p-5 shadow-sm ${
          allReady ? "border-green-500/30 bg-green-500/5" : "border-yellow-500/30 bg-yellow-500/5"
        }`}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              allReady ? "bg-green-500/20" : "bg-yellow-500/20"
            }`}
          >
            {allReady ? (
              <svg
                className="h-5 w-5 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5 text-yellow-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            )}
          </div>
          <div>
            <h2 className="font-semibold">{allReady ? "Server Ready" : "Setup Required"}</h2>
            <p className="text-xs text-muted">
              {passCount}/{totalCount} checks passing
            </p>
          </div>
        </div>

        {/* Checklist */}
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(checks).map(([key, ok]) => (
            <div
              key={key}
              className="flex items-center gap-2 rounded-lg border border-card-border bg-card/50 px-3 py-2 text-sm"
            >
              {ok ? (
                <span className="text-green-500">&#10003;</span>
              ) : (
                <span className="text-red-500">&#10007;</span>
              )}
              <span className={ok ? "text-foreground" : "text-muted"}>
                {CHECK_LABELS[key] ?? key}
              </span>
              {status?.counts[key] != null && (
                <span className="ml-auto text-xs text-muted">
                  {status.counts[key === "gameConfig" ? key : key]}
                </span>
              )}
            </div>
          ))}
        </div>

        {status?.gameState && (
          <p className="mt-3 text-xs text-muted">
            Game state: Turn {status.gameState.currentTurn},{" "}
            {status.gameState.isActive ? "active" : "paused"}
          </p>
        )}
      </div>

      {/* IMF institution — required for corporate bailout admin tools */}
      <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
        <h3 className="mb-1 font-semibold">IMF institution corporation</h3>
        <p className="mb-3 text-sm text-muted">
          Creates or repairs the &quot;International Monetary Fund&quot; corporation (USD, hidden
          from the exchange). Required before activating IMF bailouts from the Corporations admin
          panel. Choose two starting shareholders and which one is CEO; safe to re-run to repair
          ownership.
        </p>
        {imfStatus && (
          <p className="mb-3 text-xs font-mono text-muted">
            Status: {imfStatus.seeded ? "seeded" : "not seeded"}
            {imfStatus.corporationId ? ` — id ${imfStatus.corporationId}` : ""}
          </p>
        )}
        <ImfInstitutionSeedForm onSuccess={() => void fetchStatus()} />
      </div>

      {/* Run setup */}
      {!allReady && (
        <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
          <h3 className="mb-1 font-semibold">Run Setup</h3>
          <p className="mb-4 text-sm text-muted">
            Seeds all reference data, initializes game state (paused), creates elected officials and
            cycle-1 elections, and ensures database indexes. Safe to run multiple times.
          </p>

          <div className="mb-4">
            <label className="block text-xs text-muted mb-1.5">Scope</label>
            <div className="flex gap-2">
              {[...registered, "all" as const].map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    scope === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-card-border bg-card text-muted hover:text-foreground"
                  }`}
                >
                  {COUNTRY_CONFIGS[s as CountryId]?.name ?? "All Countries"}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={runSetup}
            disabled={running}
            className="min-h-[44px] rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Running Setup...
              </span>
            ) : (
              "Run Setup"
            )}
          </button>
        </div>
      )}

      {/* Result output */}
      {result && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-5 shadow-sm">
          <h3 className="mb-2 font-semibold text-green-400">Setup Complete</h3>
          <p className="mb-3 text-sm text-muted">{result.message}</p>
          {result.logs.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted hover:text-foreground transition-colors">
                Show {result.logs.length} log entries
              </summary>
              <ul className="mt-2 max-h-64 overflow-y-auto space-y-0.5 text-muted font-mono">
                {result.logs.map((line, i) => (
                  <li
                    key={i}
                    className={line.startsWith("===") ? "font-semibold text-foreground mt-2" : ""}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 shadow-sm">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}
