"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { PrimaryElectoralMap, type PrimaryStateData } from "@/components/PrimaryElectoralMap";
import { US_STATE_ID_NAME_PAIRS } from "@/lib/constants/usStateNames";
import {
  MAX_STATE_ORG_BONUS_GENERAL,
  MAX_STATE_ORG_BONUS_PRIMARY,
  STATE_ORG_COST_ACTIONS,
  STATE_ORG_COST_FUNDS,
  STATE_ORG_MAX_LEVEL,
  STATE_ORG_REFERENCE_FRACTION,
  stateOrgBonusFraction,
} from "@/lib/electionEngine/constants";
import { formatStatePresenceCost, statePresenceNextCost } from "@/lib/campaigns/statePresenceCost";

interface StateOrgRow {
  stateId: string;
  /** Cost of the next level here, priced and converted by the list route. */
  nextCost: number;
  level: number;
  totalInvested: number;
  updatedAt: string | null;
}

interface RacePresenceEntry {
  characterId: string;
  name: string;
  party: string | null;
  isSelf: boolean;
  levelsByState: Record<string, number>;
}

interface ListResponse {
  states?: StateOrgRow[];
  /** Anchor to the viewer's currency; rows already carry a converted nextCost. */
  fxRate?: number;
  racePresence?: RacePresenceEntry[];
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

// Bonus is uncapped-but-diminishing — mirror the engine curve exactly rather
// than the old linear level/MAX ratio, so the number shown matches the vote.
function bonusPct(level: number): number {
  return Math.round(stateOrgBonusFraction(level) * MAX_STATE_ORG_BONUS_PRIMARY * 100);
}

function generalBonusPct(level: number): number {
  return Math.round(stateOrgBonusFraction(level) * MAX_STATE_ORG_BONUS_GENERAL * 100);
}

export function StateOrganizationTab({
  showHubLink = false,
}: {
  /** When true, link out to the dedicated Political Operations hub. */
  showHubLink?: boolean;
} = {}) {
  const [rows, setRows] = useState<StateOrgRow[]>([]);
  const [homeState, setHomeState] = useState<string | null>(null);
  const [partyHex, setPartyHex] = useState<string>("#3B82F6");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [racePresence, setRacePresence] = useState<RacePresenceEntry[]>([]);
  /** Whose presence the map is showing. null = the viewer's own. */
  const [viewingCharacterId, setViewingCharacterId] = useState<string | null>(null);
  /** Anchor to the viewer's currency, for pricing a level with no row of its own. */
  const [fxRate, setFxRate] = useState(1);

  useEffect(() => {
    fetch("/api/political-operations/state-org/list")
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          setUnauthorized(true);
          setLoading(false);
          return;
        }
        if (!r.ok) {
          setError("Failed to load campaign presence");
          setLoading(false);
          return;
        }
        const d: ListResponse = await r.json();
        setRows(d.states ?? []);
        setFxRate(d.fxRate ?? 1);
        setRacePresence(d.racePresence ?? []);
        setHomeState(d.homeState ?? null);
        if (d.partyHex) setPartyHex(d.partyHex);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setError("Failed to load campaign presence");
      });
  }, []);

  const rowByState = useMemo(() => new Map(rows.map((r) => [r.stateId, r])), [rows]);

  const viewedCandidate = useMemo(
    () => racePresence.find((c) => c.characterId === viewingCharacterId) ?? null,
    [racePresence, viewingCharacterId]
  );

  /**
   * Levels to paint. Viewing your own presence uses the authoritative per-state
   * rows (they carry investment history); viewing a rival overlays their levels
   * onto the same state list so the map geometry stays identical.
   */
  const displayRows = useMemo<StateOrgRow[]>(() => {
    if (!viewedCandidate) return rows;
    return rows.map((r) => ({
      ...r,
      level: viewedCandidate.levelsByState[r.stateId] ?? 0,
      totalInvested: 0,
    }));
  }, [rows, viewedCandidate]);

  // Map data: gray at level 0, blending toward party hex as level rises.
  const stateData = useMemo<Record<string, PrimaryStateData>>(() => {
    const out: Record<string, PrimaryStateData> = {};
    for (const r of displayRows) {
      const t = stateOrgBonusFraction(r.level);
      const color = blendHex(BASE_GRAY, partyHex, t);
      const stateName = US_STATE_NAMES[r.stateId] ?? r.stateId;
      const isHome = r.stateId === homeState;
      const tooltipLines = [
        `Level: ${r.level}`,
        `Projected bonus: +${bonusPct(r.level)}% in the primary, +${generalBonusPct(r.level)}% in the general`,
      ];
      if (isHome) tooltipLines.push("(home state)");
      out[r.stateId] = {
        color,
        label: stateName,
        tooltip: tooltipLines,
      };
    }
    return out;
  }, [displayRows, partyHex, homeState]);

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

  if (unauthorized) return null;

  if (loading) {
    return <div className="p-4 text-muted">Loading campaign presence...</div>;
  }

  const ownRow = selectedState ? rowByState.get(selectedState) : null;
  const selectedRow =
    selectedState && viewedCandidate
      ? {
          stateId: selectedState,
          level: viewedCandidate.levelsByState[selectedState] ?? 0,
          totalInvested: 0,
          updatedAt: null,
          // Another candidate's level, priced through the same helper the route
          // uses, so the ladder reads identically whoever you are looking at.
          nextCost: statePresenceNextCost(
            viewedCandidate.levelsByState[selectedState] ?? 0,
            fxRate
          ),
        }
      : ownRow;
  const viewingOther = viewedCandidate !== null && !viewedCandidate.isSelf;
  const selectedName = selectedState ? (US_STATE_NAMES[selectedState] ?? selectedState) : null;

  return (
    <div>
      <div className="mb-4 rounded-lg border border-card-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium">Campaign Presence</h3>
          {showHubLink && (
            <Link
              href="/political-operations"
              className="text-xs font-medium text-primary hover:underline"
            >
              Political Operations hub →
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          Build per-state infrastructure for the presidential race. It counts in the primary{" "}
          <strong>and</strong> in the general election. Each level costs {STATE_ORG_COST_ACTIONS}{" "}
          campaign actions plus an escalating price from your campaign treasury, starting near $
          {STATE_ORG_COST_FUNDS.toLocaleString("en-US")}. There is <strong>no level cap</strong> —
          but the bonus flattens as the price compounds, so level {STATE_ORG_MAX_LEVEL} already
          delivers about {Math.round(STATE_ORG_REFERENCE_FRACTION * 100)}% of the maximum. Fully
          invested, a state approaches +{Math.round(MAX_STATE_ORG_BONUS_PRIMARY * 100)}% in-state
          vote bonus in the primary and +{Math.round(MAX_STATE_ORG_BONUS_GENERAL * 100)}% in the
          general.
        </p>
        {racePresence.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted">Showing</span>
            <button
              type="button"
              onClick={() => setViewingCharacterId(null)}
              className={`rounded border px-2 py-1 text-xs transition-colors ${
                viewingCharacterId === null
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border text-muted hover:text-primary"
              }`}
            >
              You
            </button>
            {racePresence.map((c) => (
              <button
                key={c.characterId}
                type="button"
                onClick={() => setViewingCharacterId(c.characterId)}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  viewingCharacterId === c.characterId
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-card-border text-muted hover:text-primary"
                }`}
              >
                {c.name}
                {c.isSelf ? " (you)" : ""}
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 text-sm text-muted">
          Build early and keep building. Levels do not reset when the primary ends, so what you put
          in before the primary keeps working through the general. You can also keep building during
          the general. Levels drop to 25% only after the presidential general resolves. Organization
          is per player and per state, so a rival&apos;s investment never covers yours.
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
                  <dd className="font-mono">{selectedRow.level}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Projected primary bonus</dt>
                  <dd className="font-mono">+{bonusPct(selectedRow.level)}%</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Projected general bonus</dt>
                  <dd className="font-mono">+{generalBonusPct(selectedRow.level)}%</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Next level costs</dt>
                  <dd className="font-mono">{formatStatePresenceCost(selectedRow.nextCost)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted">Career investment</dt>
                  <dd className="font-mono">{selectedRow.totalInvested} actions</dd>
                </div>
              </dl>

              <button
                type="button"
                disabled={busy === selectedState || viewingOther}
                onClick={() => build(selectedState)}
                className="mt-4 w-full rounded border border-primary/60 px-3 py-2 text-sm text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                title={
                  viewingOther
                    ? "You are viewing another candidate's presence"
                    : `Build +1 (${STATE_ORG_COST_ACTIONS} campaign actions + ${formatStatePresenceCost(selectedRow.nextCost)})`
                }
              >
                {busy === selectedState
                  ? "Building..."
                  : viewingOther
                    ? `Viewing ${viewedCandidate?.name ?? "another candidate"}`
                    : `Build (+1) — ${STATE_ORG_COST_ACTIONS} campaign actions + ${formatStatePresenceCost(selectedRow.nextCost)}`}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
