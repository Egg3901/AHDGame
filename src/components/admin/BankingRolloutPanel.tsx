"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The staged activation of savings accounts: mode, read cohort, the gate and
 * comparison the rules judge against, and the rollback conditions raised.
 * Every button is decided server-side in advance, so a disabled control
 * carries the reason instead of failing on click. Same rows, badges and
 * buttons as the feature gates panel above it.
 */

type Mode = "off" | "shadow" | "authoritative";
type RolloutChange =
  | { kind: "mode"; mode: Mode }
  | { kind: "add_read_currency"; currency: string }
  | { kind: "remove_read_currency"; currency: string };

interface RolloutSnapshot {
  privateBankingEnabled: boolean;
  state: { mode: Mode; readCurrencies: string[] };
  currentTurn: number;
  gate: { ok: boolean; reasons: string[] };
  comparison: {
    turn: number;
    currencies: Array<{
      currency: string;
      legacyOwnerTotal: number;
      accountOwnerTotal: number;
      rowDiscrepancies: number;
      discrepancies: number;
    }>;
  } | null;
  rollback: Array<{ code: string; detail: string; suggested: RolloutChange }>;
  decisions: Array<{
    change: RolloutChange;
    allowed: boolean;
    reasons: string[];
    direction: "widen" | "narrow" | "none";
  }>;
}

const MODES: { value: Mode; label: string; blurb: string }[] = [
  { value: "off", label: "Off", blurb: "Legacy savings fields only. Accounts are not written." },
  {
    value: "shadow",
    label: "Shadow",
    blurb:
      "Accounts are refreshed from the legacy fields every turn and compared. Nothing reads them.",
  },
  {
    value: "authoritative",
    label: "Authoritative",
    blurb:
      "Writes go through the accounts; the legacy fields are projections. Reads follow the cohort below.",
  },
];

function sameChange(a: RolloutChange, b: RolloutChange): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "mode" && b.kind === "mode") return a.mode === b.mode;
  if (a.kind !== "mode" && b.kind !== "mode") return a.currency === b.currency;
  return false;
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const palette = {
    ok: { background: "rgba(34,197,94,0.15)", color: "var(--success)" },
    warn: { background: "rgba(239,68,68,0.15)", color: "var(--destructive)" },
    muted: { background: "rgba(148,163,184,0.15)", color: "var(--muted)" },
  }[tone];
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={palette}
    >
      {children}
    </span>
  );
}

export function BankingRolloutPanel() {
  const [snapshot, setSnapshot] = useState<RolloutSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/banking/rollout");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSnapshot((await res.json()) as RolloutSnapshot);
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(async (change: RolloutChange) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/banking/rollout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      const data = (await res.json()) as RolloutSnapshot & { error?: string; reasons?: string[] };
      if (!res.ok) {
        setError([data.error, ...(data.reasons ?? [])].filter(Boolean).join(" "));
        return;
      }
      setSnapshot(data);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading banking rollout…</span>
        </div>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <p className="text-sm text-destructive">Could not load the banking rollout.</p>
      </div>
    );
  }

  const decisionFor = (change: RolloutChange) =>
    snapshot.decisions.find((d) => sameChange(d.change, change));
  const comparisonRows = snapshot.comparison?.currencies ?? [];

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-card sm:p-6">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Savings accounts rollout</h3>
          <Badge tone={snapshot.privateBankingEnabled ? "ok" : "muted"}>
            {snapshot.privateBankingEnabled ? "Private banking on" : "Private banking off"}
          </Badge>
          <Badge tone={snapshot.gate.ok ? "ok" : "warn"}>
            {snapshot.gate.ok ? "Gate open" : "Gate closed"}
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Off, then shadow, then authoritative, then one currency at a time into the read cohort.
          Widening needs the gate open and a clean, fresh comparison; narrowing is always allowed.
          Turn {snapshot.currentTurn}.
        </p>
      </div>

      {error ? (
        <p className="mb-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {!snapshot.gate.ok ? (
        <ul className="mb-4 space-y-1 rounded-lg border border-card-border bg-background/40 p-3 text-xs text-muted">
          {snapshot.gate.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      <div className="mb-4 rounded-lg border border-card-border bg-background/40 p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Mode</span>
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {MODES.find((m) => m.value === snapshot.state.mode)?.label ?? snapshot.state.mode}
          </span>
        </div>
        <p className="mb-3 text-xs text-muted">
          {MODES.find((m) => m.value === snapshot.state.mode)?.blurb}
        </p>
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-card-border bg-card p-1">
          {MODES.map((mode) => {
            const change: RolloutChange = { kind: "mode", mode: mode.value };
            const decision = decisionFor(change);
            const active = snapshot.state.mode === mode.value;
            const blocked = !active && decision !== undefined && !decision.allowed;
            return (
              <button
                key={mode.value}
                type="button"
                disabled={saving || active || blocked}
                title={blocked ? decision?.reasons.join(" ") : mode.blurb}
                onClick={() => void apply(change)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  active
                    ? "bg-primary text-white"
                    : "text-muted hover:bg-background hover:text-foreground"
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-card-border bg-background/40 p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Read cohort</span>
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {snapshot.state.readCurrencies.length > 0
              ? snapshot.state.readCurrencies.join(", ")
              : "none"}
          </span>
        </div>
        <p className="mb-3 text-xs text-muted">
          Currencies whose accounts the balance sheets count as cash-backed liabilities. A currency
          joins only in authoritative mode, migrated and clean in the last comparison.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="py-1 pr-3">Currency</th>
                <th className="py-1 pr-3">Legacy total</th>
                <th className="py-1 pr-3">Accounts total</th>
                <th className="py-1 pr-3">Discrepancies</th>
                <th className="py-1 pr-3">Cohort</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.decisions
                .filter((d) => d.change.kind !== "mode")
                .map((d) => {
                  const change = d.change as Exclude<RolloutChange, { kind: "mode" }>;
                  const row = comparisonRows.find((c) => c.currency === change.currency);
                  const inCohort = snapshot.state.readCurrencies.includes(change.currency);
                  return (
                    <tr key={change.currency} className="border-t border-card-border">
                      <td className="py-1.5 pr-3 font-semibold">{change.currency}</td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {row ? row.legacyOwnerTotal.toFixed(2) : "—"}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {row ? row.accountOwnerTotal.toFixed(2) : "—"}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {row ? (
                          <Badge tone={row.discrepancies === 0 ? "ok" : "warn"}>
                            {row.discrepancies}
                          </Badge>
                        ) : (
                          <Badge tone="muted">no rows</Badge>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        <button
                          type="button"
                          disabled={saving || !d.allowed}
                          title={d.allowed ? undefined : d.reasons.join(" ")}
                          onClick={() => void apply(change)}
                          className={`rounded-md border border-card-border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                            inCohort
                              ? "bg-primary text-white"
                              : "text-muted hover:bg-background hover:text-foreground"
                          }`}
                        >
                          {inCohort ? "In cohort (remove)" : "Add to cohort"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {snapshot.comparison ? (
          <p className="mt-2 text-[11px] text-muted">
            Comparison from turn {snapshot.comparison.turn}.
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted">No comparison has run: the mode is off.</p>
        )}
      </div>

      {snapshot.rollback.length > 0 ? (
        <div className="rounded-lg border border-card-border bg-background/40 p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-semibold">Rollback conditions raised</span>
            <Badge tone="warn">{snapshot.rollback.length}</Badge>
          </div>
          <ul className="space-y-2 text-xs">
            {snapshot.rollback.map((condition) => (
              <li
                key={`${condition.code}:${condition.detail}`}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-muted">{condition.detail}</span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void apply(condition.suggested)}
                  className="rounded-md border border-card-border px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
                >
                  {condition.suggested.kind === "mode"
                    ? `Drop to ${condition.suggested.mode}`
                    : `Remove ${condition.suggested.currency}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
