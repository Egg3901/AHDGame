"use client";

import { useEffect, useMemo, useState } from "react";
import { formatLocalFunds } from "@/lib/actions";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ActionOption, NPPOption } from "./types";
import { getStatCapOverride } from "./types";
import {
  needsAttention,
  recommendedAction,
  filterRoster,
  sortRoster,
  bulkCost,
  type RosterNpp,
  type RosterFilter,
  type RosterSort,
} from "./nppRoster";

export interface NppRosterPanelProps {
  scope: "state" | "national";
  /** NPPs to manage; each carries a homeState (state scope shares one state). */
  npps: Array<NPPOption & { homeState: string }>;
  actions: ActionOption[];
  /** Currency to format per-action treasury costs in (defaults to USD). */
  currency?: CurrencyCode;
  /** Execute one influence action against one NPP. */
  onExecute: (nppId: string, type: ActionOption["type"]) => Promise<{ ok: boolean }>;
}

const STAT_DEFS: { key: keyof RosterNpp["stats"]; abbr: string; invert?: boolean }[] = [
  { key: "favorability", abbr: "FAV" },
  { key: "politicalInfluence", abbr: "INF" },
  { key: "loyalty", abbr: "LOY" },
  { key: "ambition", abbr: "AMB" },
  { key: "stubbornness", abbr: "STB", invert: true },
];

const FILTERS: { key: RosterFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "low_loyalty", label: "Low loyalty" },
  { key: "low_fav", label: "Low favorability" },
  { key: "stubborn", label: "High stubbornness" },
  { key: "running", label: "Running now" },
  { key: "no_office", label: "No office" },
];

const SORTS: { key: RosterSort; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "name", label: "Name" },
  { key: "state", label: "State" },
  { key: "favorability", label: "Favorability" },
  { key: "politicalInfluence", label: "Influence" },
  { key: "loyalty", label: "Loyalty" },
  { key: "ambition", label: "Ambition" },
  { key: "stubbornness", label: "Stubbornness" },
];

function statTone(v: number): string {
  if (v >= 66) return "text-success";
  if (v >= 33) return "text-warning";
  return "text-error";
}
function barColor(v: number): string {
  if (v >= 66) return "rgb(34,197,94)";
  if (v >= 33) return "rgb(245,158,11)";
  return "rgb(239,68,68)";
}

function StatBar({ value, invert }: { value: number; invert?: boolean }) {
  const eff = invert ? 100 - value : value;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-xs font-semibold tabular-nums ${statTone(eff)}`}>
        {value.toFixed(2)}
      </span>
      <span className="block h-1 w-full overflow-hidden rounded-full bg-card-border/40">
        <span
          className="block h-full rounded-full"
          style={{ width: `${value}%`, backgroundColor: barColor(eff) }}
        />
      </span>
    </div>
  );
}

export function NppRosterPanel({
  scope,
  npps,
  actions,
  currency = "USD",
  onExecute,
}: NppRosterPanelProps) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [sortKey, setSortKey] = useState<RosterSort>("attention");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ActionOption | null>(null);

  const rows = useMemo(
    () => sortRoster(filterRoster(npps, { filter, state: stateFilter, q }), sortKey),
    [npps, filter, stateFilter, q, sortKey]
  );
  const attnCount = useMemo(
    () => npps.filter((n) => needsAttention(n.stats).length > 0).length,
    [npps]
  );
  const stateOptions = useMemo(() => [...new Set(npps.map((n) => n.homeState))].sort(), [npps]);

  // Prune the selection to NPPs still present after a background refresh, so a
  // relocated/departed NPP doesn't linger selected and get acted on.
  useEffect(() => {
    setSel((s) => {
      if (s.size === 0) return s;
      const valid = new Set(npps.map((n) => n.id));
      const next = new Set<string>();
      let changed = false;
      for (const id of s) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : s;
    });
  }, [npps]);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Select-all operates over the currently-filtered rows (what the user sees).
  const allFilteredSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleSelectAll = () =>
    setSel((s) => {
      const n = new Set(s);
      if (allFilteredSelected) {
        for (const r of rows) n.delete(r.id);
      } else {
        for (const r of rows) n.add(r.id);
      }
      return n;
    });

  const runOne = async (id: string, type: ActionOption["type"]) => {
    setBusy(true);
    try {
      await onExecute(id, type);
    } finally {
      setBusy(false);
    }
  };

  const runBulk = async (action: ActionOption) => {
    setBusy(true);
    try {
      for (const id of sel) {
        const npp = npps.find((n) => n.id === id);
        if (npp && getStatCapOverride(action.type, npp.stats)) continue; // skip maxed
        await onExecute(id, action.type);
      }
      // Keep the selection so the player can run another action on the same set
      // without re-selecting (the panel refreshes in the background).
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const drawerNpp = npps.find((n) => n.id === drawerId) ?? null;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Search NPPs"
          placeholder="Search NPPs or states…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[180px] flex-1 rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm"
        />
        {scope === "national" && (
          <select
            aria-label="State"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-lg border border-card-border bg-card px-2 py-1.5 text-sm"
          >
            <option value="all">All states</option>
            {stateOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as RosterSort)}
          className="rounded-lg border border-card-border bg-card px-2 py-1.5 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Filter chips + select-all */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filter === f.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-card-border text-muted hover:text-foreground"
            }`}
          >
            {f.label}
            {f.key === "attention" && attnCount > 0 ? ` (${attnCount})` : ""}
          </button>
        ))}
        <button
          type="button"
          onClick={toggleSelectAll}
          disabled={rows.length === 0}
          className="ml-auto rounded-full border border-card-border px-3 py-1 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
        >
          {allFilteredSelected ? "Clear all" : `Select all (${rows.length})`}
        </button>
      </div>

      {/* Bulk bar (top) */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-card-elevated px-4 py-2 shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{sel.size} selected</span>
            <button
              className="text-xs text-muted hover:text-foreground"
              onClick={() => setSel(new Set())}
            >
              Clear
            </button>
          </div>
          {confirmAction ? (
            <div className="flex items-center gap-2 text-xs">
              <span>
                Spend {bulkCost(sel.size, confirmAction).actions} AP
                {bulkCost(sel.size, confirmAction).funds > 0
                  ? ` + ${formatLocalFunds(bulkCost(sel.size, confirmAction).funds, currency)}`
                  : ""}{" "}
                across {sel.size} NPPs?
              </span>
              <button
                className="rounded-md bg-primary px-3 py-1 font-medium text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => runBulk(confirmAction)}
              >
                {busy ? "Working…" : "Confirm"}
              </button>
              <button
                className="text-muted hover:text-foreground"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Bulk:</span>
              {actions.map((a) => (
                <button
                  key={a.type}
                  className="rounded-md border border-card-border bg-card px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
                  onClick={() => setConfirmAction(a)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Roster table */}
      <div className="overflow-x-auto rounded-xl border border-card-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="w-8 px-2 py-2"></th>
              <th className="px-2 py-2">NPP</th>
              {STAT_DEFS.map((s) => (
                <th key={s.key} className="px-2 py-2 text-center">
                  {s.abbr}
                </th>
              ))}
              <th className="w-10 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {rows.map((n) => {
              const flags = needsAttention(n.stats);
              const checked = sel.has(n.id);
              return (
                <tr key={n.id} className={checked ? "bg-primary/5" : ""}>
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={checked} onChange={() => toggle(n.id)} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => setDrawerId(n.id)}
                      >
                        {n.name}
                      </button>
                      <span className="text-xs text-muted">
                        {n.homeState}
                        {n.currentOfficeLabel
                          ? ` · ${n.currentOfficeLabel}`
                          : n.activeCandidacyLabel
                            ? ` · Running`
                            : ""}
                      </span>
                      {flags.length > 0 && (
                        <span
                          title={flags.join(", ")}
                          className="inline-block h-2 w-2 shrink-0 rounded-full bg-warning"
                        />
                      )}
                    </div>
                  </td>
                  {STAT_DEFS.map((s) => (
                    <td key={s.key} className="px-2 py-2">
                      <StatBar value={n.stats[s.key]} invert={s.invert} />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      title="Manage"
                      aria-label="Manage"
                      onClick={() => setDrawerId(n.id)}
                      className="text-muted hover:text-foreground"
                    >
                      ⚙
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted">No NPPs match this filter.</div>
        )}
      </div>

      {/* Drawer */}
      {drawerNpp && (
        <NppDrawer
          npp={drawerNpp}
          actions={actions}
          currency={currency}
          busy={busy}
          onClose={() => setDrawerId(null)}
          onAction={runOne}
        />
      )}
    </div>
  );
}

function NppDrawer({
  npp,
  actions,
  currency,
  busy,
  onClose,
  onAction,
}: {
  npp: NPPOption & { homeState: string };
  actions: ActionOption[];
  currency: CurrencyCode;
  busy: boolean;
  onClose: () => void;
  onAction: (id: string, type: ActionOption["type"]) => void;
}) {
  const rec = recommendedAction(npp.stats);
  const flags = needsAttention(npp.stats);
  return (
    <div className="rounded-xl border border-primary/40 bg-card p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="font-semibold">{npp.name}</div>
          <div className="text-xs text-muted">
            {npp.homeState}
            {npp.currentOfficeLabel ? ` · ${npp.currentOfficeLabel}` : ""}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          className="text-muted hover:text-foreground"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {flags.length > 0 && (
        <div className="mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          Needs attention: {flags.join(" · ")}
        </div>
      )}
      <div className="mb-3 grid grid-cols-5 gap-2">
        {STAT_DEFS.map((s) => (
          <div key={s.key}>
            <div className="text-[10px] uppercase tracking-wide text-muted">{s.abbr}</div>
            <StatBar value={npp.stats[s.key]} invert={s.invert} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {actions.map((a) => {
          const blocked = getStatCapOverride(a.type, npp.stats);
          const isRec = a.type === rec;
          return (
            <button
              key={a.type}
              type="button"
              disabled={busy || !!blocked || !a.available}
              onClick={() => onAction(npp.id, a.type)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 ${
                isRec ? "border-primary bg-primary/5" : "border-card-border hover:bg-card-elevated"
              }`}
            >
              <span>
                <span className="font-medium">{a.name}</span>
                {isRec && (
                  <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                    Recommended
                  </span>
                )}
                <span className="ml-2 text-xs text-muted">
                  {a.actionCost} AP
                  {a.baseFundCost > 0 ? ` · ${formatLocalFunds(a.baseFundCost, currency)}` : ""}
                  {blocked ? ` · ${blocked.unavailableReason}` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
