"use client";

import { useCallback, useEffect, useState } from "react";

interface CountRow {
  key: string;
  count: number;
}

interface CountryRow {
  countryId: string;
  decisions: number;
  acted: number;
  rejected: number;
  noAction: number;
}

interface LedgerResponse {
  currentTurn: number;
  fromTurn: number;
  throughTurn: number;
  documentLimitReached: boolean;
  rollout: { mode: string; stage: string };
  summary: {
    totals: {
      decisions: number;
      acted: number;
      rejected: number;
      noAction: number;
      pendingClaims: number;
      vetoes: number;
      warEntries: number;
    };
    countries: CountryRow[];
    actionMix: CountRow[];
    targets: CountRow[];
    rejectionReasons: CountRow[];
  };
  embargoes: {
    active: number;
    activePairs: number;
    averageTemporaryDurationTurns: number;
  };
  trade: {
    currentTurn: number | null;
    grossVolume: number;
    previousGrossVolume: number;
    changePercent: number | null;
  };
  activeConflictCount: number;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-card-border bg-background/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CountList({ title, rows }: { title: string; rows: CountRow[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="space-y-1">
        {rows.slice(0, 8).map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate">{row.key.replaceAll("_", " ")}</span>
            <span className="tabular-nums text-muted">{row.count}</span>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="text-xs text-muted">No records in this window.</p>
        ) : null}
      </div>
    </div>
  );
}

export function ForeignPolicyLedgerPanel() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/npp/foreign-policy", { cache: "no-store" });
      const body = (await response.json()) as LedgerResponse & { error?: string };
      if (!response.ok) {
        setError(body.error || "Failed to load foreign policy ledger.");
        return;
      }
      setData(body);
    } catch {
      setError("Network error while loading foreign policy ledger.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-4 text-sm text-muted">
        Loading ledger...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-card p-4 text-sm text-red-400">
        {error || "Foreign policy ledger is unavailable."}
      </div>
    );
  }

  const { totals } = data.summary;
  return (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Autonomous foreign policy ledger</h2>
          <p className="mt-1 text-xs text-muted">
            Turns {data.fromTurn} to {data.throughTurn}. Rollout {data.rollout.mode}, capability{" "}
            {data.rollout.stage}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-card-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Metric label="Decisions" value={totals.decisions} />
        <Metric label="Executed" value={totals.acted} />
        <Metric label="Rejected" value={totals.rejected} />
        <Metric label="No action" value={totals.noAction} />
        <Metric label="Vetoes" value={totals.vetoes} />
        <Metric label="War entries" value={totals.warEntries} />
        <Metric label="Open wars" value={data.activeConflictCount} />
      </div>

      <div className="mt-4 grid gap-4 border-t border-card-border pt-4 md:grid-cols-3">
        <CountList title="Action mix" rows={data.summary.actionMix} />
        <CountList title="Target concentration" rows={data.summary.targets} />
        <CountList title="Rejection reasons" rows={data.summary.rejectionReasons} />
      </div>

      <div className="mt-4 overflow-x-auto border-t border-card-border pt-4">
        <table className="w-full min-w-[32rem] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="pb-2">Country</th>
              <th className="pb-2 text-right">Decisions</th>
              <th className="pb-2 text-right">Executed</th>
              <th className="pb-2 text-right">Rejected</th>
              <th className="pb-2 text-right">No action</th>
            </tr>
          </thead>
          <tbody>
            {data.summary.countries.map((country) => (
              <tr key={country.countryId} className="border-t border-card-border/60">
                <td className="py-2 font-medium">{country.countryId}</td>
                <td className="py-2 text-right tabular-nums">{country.decisions}</td>
                <td className="py-2 text-right tabular-nums">{country.acted}</td>
                <td className="py-2 text-right tabular-nums">{country.rejected}</td>
                <td className="py-2 text-right tabular-nums">{country.noAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 border-t border-card-border pt-3 text-[11px] text-muted">
        Active embargoes: {data.embargoes.active} across {data.embargoes.activePairs} pairs. Average
        temporary duration: {data.embargoes.averageTemporaryDurationTurns} turns. Latest gross
        trade: {data.trade.grossVolume.toLocaleString()} (
        {data.trade.changePercent == null
          ? "no comparison"
          : `${data.trade.changePercent}% from prior snapshot`}
        ).
      </p>
      {data.documentLimitReached ? (
        <p className="mt-2 text-[11px] text-amber-400">
          The bounded ledger limit was reached. Narrow the operational review window before drawing
          completeness conclusions.
        </p>
      ) : null}
    </div>
  );
}
