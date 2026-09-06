"use client";

import { useCallback, useEffect, useState } from "react";
import { LandingGlobe } from "@/components/LandingGlobe";

interface Headline {
  turn: number;
  nppCount: number;
  nppHeldPct: number;
  activeCrises: number;
  inflationIndex: number;
  totalWealth: number;
  effectivePartyCount: number;
  nppOfficeSharePct: number;
}

interface StatsResponse {
  headline: Headline;
}

interface WorldsimConfig {
  playableNations: Array<{
    id: string;
    name: string;
    governmentType: string;
    headOfStateTitle: string | null;
  }>;
  nations?: Array<{
    id: string;
    name: string;
    governmentType: string;
    headOfStateTitle: string | null;
  }>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function WorldsimPageClient() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [config, setConfig] = useState<WorldsimConfig | null>(null);
  const [turns, setTurns] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    const [statsResponse, configResponse] = await Promise.all([
      fetch("/api/singleplayer/worldsim/stats", { cache: "no-store" }),
      fetch("/api/singleplayer/worldsim/config", { cache: "no-store" }),
    ]);
    if (!statsResponse.ok)
      throw new Error(`Could not load worldsim stats (${statsResponse.status})`);
    if (!configResponse.ok)
      throw new Error(`Could not load worldsim nations (${configResponse.status})`);
    setStats((await statsResponse.json()) as StatsResponse);
    setConfig((await configResponse.json()) as WorldsimConfig);
  }, []);

  useEffect(() => {
    void loadStats().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Could not load worldsim stats");
    });
  }, [loadStats]);

  const advance = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/singleplayer/worldsim/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok)
        throw new Error(body?.error ?? `Worldsim advance failed (${response.status})`);
      await loadStats();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Worldsim advance failed");
    } finally {
      setBusy(false);
    }
  };

  const headline = stats?.headline;
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-12 sm:px-6">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Worldsim{" "}
          <span className="ml-2 rounded border border-primary/50 px-1.5 py-0.5 text-[10px] tracking-[0.12em]">
            Beta
          </span>
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">A world without a player</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Advance the local simulation and inspect its balance. No character is required for this
          mode.
        </p>
      </header>

      <section
        aria-label="World map"
        className="mb-6 h-[min(72vh,720px)] min-h-[420px] overflow-hidden rounded border border-card-border bg-slate-950"
      >
        <LandingGlobe bare initialZoom={1.05} hideLiveIndicator navigationDisabled allowBareZoom />
      </section>

      <section className="rounded border border-card-border bg-card-muted p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Current turn</p>
            <p className="mt-1 text-3xl font-bold">{headline?.turn ?? "..."}</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs text-muted">
              Turns
              <input
                type="number"
                min={1}
                max={12}
                value={turns}
                onChange={(event) =>
                  setTurns(Math.max(1, Math.min(12, Number(event.target.value) || 1)))
                }
                className="mt-1 block w-20 rounded border border-card-border bg-background px-2 py-2 text-sm text-foreground"
              />
            </label>
            <button
              type="button"
              onClick={() => void advance()}
              disabled={busy}
              className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Advancing..." : "Advance"}
            </button>
          </div>
        </div>

        {headline ? (
          <dl className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["Active crises", formatNumber(headline.activeCrises)],
              ["NPP office share", `${headline.nppOfficeSharePct.toFixed(1)}%`],
              ["NPP organizations", formatNumber(headline.nppCount)],
              ["Inflation index", headline.inflationIndex.toFixed(2)],
              ["Total wealth", formatNumber(headline.totalWealth)],
              ["Effective parties", headline.effectivePartyCount.toFixed(2)],
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-card-border bg-background p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      </section>

      <section className="mt-6 rounded border border-card-border bg-card-muted p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Nations in this world
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Playable nations and their government types</caption>
            <thead className="border-b border-card-border text-xs text-muted">
              <tr>
                <th className="pb-2 pr-4 font-medium">Nation</th>
                <th className="pb-2 pr-4 font-medium">Government</th>
                <th className="pb-2 font-medium">Head of state</th>
              </tr>
            </thead>
            <tbody>
              {(config?.nations ?? config?.playableNations ?? []).map((nation) => (
                <tr key={nation.id} className="border-b border-card-border/60 last:border-0">
                  <th scope="row" className="py-2 pr-4 font-medium">
                    {nation.name}
                  </th>
                  <td className="py-2 pr-4 text-muted">{nation.governmentType}</td>
                  <td className="py-2 text-muted">{nation.headOfStateTitle ?? "Head of state"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
