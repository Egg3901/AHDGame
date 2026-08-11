"use client";

import { useEffect, useMemo, useState } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { PrimaryElectoralMap, type PrimaryStateData } from "@/components/PrimaryElectoralMap";
import { US_STATE_ID_NAME_PAIRS } from "@/lib/constants/usStateNames";
import {
  MAX_STATE_ORG_BONUS_PRIMARY,
  STATE_ORG_COST_ACTIONS,
  STATE_ORG_COST_FUNDS,
  STATE_ORG_MAX_LEVEL,
} from "@/lib/electionEngine/constants";

interface StateOrgRow {
  stateId: string;
  level: number;
  totalInvested: number;
  updatedAt: string | null;
}

interface ListResponse {
  states?: StateOrgRow[];
  homeState?: string | null;
  partyHex?: string;
  partyName?: string | null;
}

/** Default neutral gray for level-0 states. */
const BASE_GRAY = "#374151"; // gray-700

const US_STATE_NAMES: Record<string, string> = Object.fromEntries(US_STATE_ID_NAME_PAIRS);

/**
 * Linear-blend two hex colors. `t` in [0, 1]: 0 returns `from`, 1 returns `to`.
 * Used to darken the gray baseline toward the party color as level rises.
 */
function blendHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const clampT = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r + (b.r - a.r) * clampT);
  const g = Math.round(a.g + (b.g - a.g) * clampT);
  const b2 = Math.round(a.b + (b.b - a.b) * clampT);
  return `#${[r, g, b2].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace(/^#/, "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function bonusPct(level: number): number {
  return Math.round((level / STATE_ORG_MAX_LEVEL) * MAX_STATE_ORG_BONUS_PRIMARY * 100);
}

export function StateOrganizationTab() {
  const [rows, setRows] = useState<StateOrgRow[]>([]);
  const [homeState, setHomeState] = useState<string | null>(null);
  const [partyHex, setPartyHex] = useState<string>("#3B82F6");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/political-operations/state-org/list")
      .then((r) => r.json())
      .then((d: ListResponse) => {
        setRows(d.states ?? []);
        setHomeState(d.homeState ?? null);
        if (d.partyHex) setPartyHex(d.partyHex);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setError("Failed to load state organization");
      });
  }, []);

  const rowByState = useMemo(() => new Map(rows.map((r) => [r.stateId, r])), [rows]);

  // Map data: gray at level 0, blending toward party hex as level rises.
  const stateData = useMemo<Record<string, PrimaryStateData>>(() => {
    const out: Record<string, PrimaryStateData> = {};
    for (const r of rows) {
      const t = r.level / STATE_ORG_MAX_LEVEL;
      const color = blendHex(BASE_GRAY, partyHex, t);
      const stateName = US_STATE_NAMES[r.stateId] ?? r.stateId;
      const isHome = r.stateId === homeState;
      const tooltipLines = [
        `Level: ${r.level} / ${STATE_ORG_MAX_LEVEL}`,
        `Projected primary bonus: +${bonusPct(r.level)}%`,
      ];
      if (isHome) tooltipLines.push("(home state)");
      out[r.stateId] = {
        color,
        label: stateName,
        tooltip: tooltipLines,
      };
    }
    return out;
  }, [rows, partyHex, homeState]);

  async function build(stateId: string) {
    setBusy(stateId);
    setError(null);
    try {
      trackAction("org.build", { stateId });
      const res = await fetch("/api/political-operations/state-org/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Build failed");
      } else {
        setRows((prev) =>
          prev.map((r) =>
            r.stateId === stateId
              ? { ...r, level: body.level, totalInvested: body.totalInvested }
              : r
          )
        );
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="p-4 text-muted">Loading state organization...</div>;
  }

  const selectedRow = selectedState ? rowByState.get(selectedState) : null;
  const selectedName = selectedState ? (US_STATE_NAMES[selectedState] ?? selectedState) : null;
  const selectedMaxed = (selectedRow?.level ?? 0) >= STATE_ORG_MAX_LEVEL;

  return (
    <div>
      <div className="mb-4 rounded-lg border border-card-border bg-card p-4">
        <h3 className="font-medium">State Organization</h3>
        <p className="mt-1 text-sm text-muted">
          Build per-state infrastructure for the next presidential primary. Costs{" "}
          {STATE_ORG_COST_ACTIONS} actions + ${STATE_ORG_COST_FUNDS.toLocaleString("en-US")} per +1
          level. Capped at level {STATE_ORG_MAX_LEVEL} (+
          {Math.round(MAX_STATE_ORG_BONUS_PRIMARY * 100)}% in-state vote bonus during primaries).
          Levels reset to 25% after each Presidential General resolves.
        </p>
        <p className="mt-2 text-xs text-muted">
          Hover any state for current investment and projected bonus. Click a state to build. Color
          saturates from gray toward your party color as you invest.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr,1fr]">
        <PrimaryElectoralMap stateData={stateData} onStateClick={setSelectedState} />

        <aside className="rounded-xl border border-card-border bg-card p-4 self-start">
          {!selectedState && (
            <p className="text-sm text-muted">
              Click a state on the map to view its investment level, projected bonus, and the Build
              action.
            </p>
          )}
          {selectedState && selectedRow && (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-lg font-semibold">{selectedName}</h4>
                {selectedState === homeState && (
                  <span className="text-xs text-muted">(home state)</span>
                )}
              </div>

              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Level</dt>
                  <dd className="font-mono">
                    {selectedRow.level} / {STATE_ORG_MAX_LEVEL}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Projected primary bonus</dt>
                  <dd className="font-mono">+{bonusPct(selectedRow.level)}%</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Career investment</dt>
                  <dd className="font-mono">{selectedRow.totalInvested} actions</dd>
                </div>
              </dl>

              <button
                type="button"
                disabled={busy === selectedState || selectedMaxed}
                onClick={() => build(selectedState)}
                className="mt-4 w-full rounded border border-primary/60 px-3 py-2 text-sm text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  selectedMaxed
                    ? `Level ${STATE_ORG_MAX_LEVEL} cap reached`
                    : `Build +1 (${STATE_ORG_COST_ACTIONS} actions + $${STATE_ORG_COST_FUNDS.toLocaleString("en-US")})`
                }
              >
                {busy === selectedState
                  ? "Building..."
                  : selectedMaxed
                    ? "Maxed"
                    : `Build (+1) — ${STATE_ORG_COST_ACTIONS} actions + $${STATE_ORG_COST_FUNDS.toLocaleString("en-US")}`}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
