"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { partyApiUrl } from "@/lib/urls";
import { getMessageStyle } from "@/lib/utils/formatters";
import { contrastTextColor } from "@/lib/utils/colorContrast";
import { adjacentStates } from "@/lib/constants/stateAdjacency";
import { isClusterConnected } from "@/lib/parties/priorityRegion";
import type { CountryId } from "@/lib/constants/countries";
import type { PartyData } from "./types";

/**
 * Chair-Office card for setting the party's Priority Region cluster.
 *
 * Behavior:
 *   - Shows the current cluster (state names) + remaining lockout turns
 *     when one is set, regardless of whether the slot is currently
 *     editable.
 *   - When unlocked (no cluster set OR lockout expired), renders a state
 *     picker. Player selects 2-3 (or 2-4 if Phase F's anchor lookup
 *     adds the bonus) states from the country's full state list.
 *   - Adjacency validation runs server-side on submit; client just
 *     enforces basic size + duplicate rules pre-submit so the player
 *     gets fast feedback.
 *   - Once set, the slot locks for PRIORITY_REGION_LOCKOUT_TURNS (168)
 *     turns. No clears, no re-sets in that window.
 */

interface PriorityRegionResponse {
  priorityRegion: {
    stateIds: string[];
    setAtTurn: number;
    setBy: string;
  } | null;
  unlockTurn: number | null;
  turnsRemaining: number;
  isLocked: boolean;
  lockoutDurationTurns: number;
  /** State IDs where the party holds the state-level executive — gets the (Gov) tag + qualifies the cluster for the +1 anchor slot. */
  governorStates: string[];
}

interface StatesResponse {
  states: Array<{ id: string; name: string }>;
}

interface PriorityRegionCardProps {
  party: PartyData;
  countryCode: string;
}

export function PriorityRegionCard({ party, countryCode }: PriorityRegionCardProps) {
  const [data, setData] = useState<PriorityRegionResponse | null>(null);
  const [states, setStates] = useState<Array<{ id: string; name: string }>>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [prRes, statesRes] = await Promise.all([
        fetch(`${partyApiUrl(countryCode, party.id)}/priority-region`),
        fetch(`/api/country/${countryCode}/states`),
      ]);
      if (prRes.ok) setData((await prRes.json()) as PriorityRegionResponse);
      if (statesRes.ok) {
        const payload = (await statesRes.json()) as StatesResponse;
        setStates(payload.states);
      }
    } finally {
      setLoading(false);
    }
  }, [countryCode, party.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stateNameById = useMemo(
    () => Object.fromEntries(states.map((s) => [s.id, s.name])),
    [states]
  );

  const governorStateSet = useMemo(
    () => new Set(data?.governorStates ?? []),
    [data?.governorStates]
  );

  // Eligible pick set: states the player can ADD to the cluster while
  // keeping it connected. Empty cluster → every state eligible. Otherwise,
  // any state adjacent to at least one already-picked state. Already-
  // picked states stay clickable (so the player can un-pick them).
  const eligibleSet = useMemo(() => {
    const country = countryCode.toUpperCase() as CountryId;
    if (picked.length === 0) return new Set(states.map((s) => s.id));
    const set = new Set<string>(picked);
    for (const id of picked) {
      for (const neighbor of adjacentStates(country, id)) {
        set.add(neighbor);
      }
    }
    return set;
  }, [picked, states, countryCode]);

  // Anchor preview: would the *currently picked* cluster qualify for the
  // +1 governor-anchor slot? Used to set the displayed cap (3 vs 4) so
  // the player understands why a 4th pick is enabled.
  const hasAnchorOnPicks = useMemo(
    () => picked.some((id) => governorStateSet.has(id)),
    [picked, governorStateSet]
  );
  const maxPicks = hasAnchorOnPicks ? 4 : 3;

  // Connectedness warning when an un-pick orphans another picked state.
  const country = countryCode.toUpperCase() as CountryId;
  const picksAreConnected = picked.length < 2 || isClusterConnected(country, picked);

  const togglePick = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSubmit = async () => {
    if (picked.length < 2) {
      setMsg("✗ Pick at least 2 states.");
      return;
    }
    if (picked.length > 4) {
      setMsg("✗ Pick at most 4 states.");
      return;
    }
    setSubmitting(true);
    setMsg("");
    try {
      const res = await fetch(`${partyApiUrl(countryCode, party.id)}/priority-region`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateIds: picked }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMsg(`✗ ${body.error ?? "Failed to set Priority Region"}`);
        return;
      }
      setMsg("✓ Priority Region locked in.");
      setPicked([]);
      await fetchAll();
    } catch {
      setMsg("✗ Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted">
        Loading Priority Region…
      </div>
    );
  }

  const isLocked = data?.isLocked ?? false;
  const cluster = data?.priorityRegion ?? null;
  const turnsRemaining = data?.turnsRemaining ?? 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Priority Region</h2>
        <span className="text-xs text-muted">
          +25% effectiveness on national PS actions in cluster states
        </span>
      </div>

      <p className="text-xs text-muted mb-4">
        Pick 2–3 adjacent states (4 with a Governor anchor) where this party will concentrate its
        organizing efforts. Cluster states get a +25% effectiveness bonus on direct national PS
        actions — Build Org, NPP placement, Contest, etc. Once set, the cluster is{" "}
        <strong>locked for {data?.lockoutDurationTurns ?? 168} turns</strong>; no changes until the
        cooldown expires.
      </p>

      {msg && <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(msg)}`}>{msg}</div>}

      {/* Current cluster (if any) */}
      {cluster && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
            Current cluster
            {isLocked && (
              <span className="ml-2 text-muted">
                · locked for {turnsRemaining} more turn{turnsRemaining === 1 ? "" : "s"}
              </span>
            )}
            {!isLocked && cluster.stateIds.length > 0 && (
              <span className="ml-2 text-muted">· unlocked, can re-set below</span>
            )}
          </div>
          {cluster.stateIds.length === 0 ? (
            <p className="text-sm text-muted italic">
              All cluster states have been evicted (loss of presence). The slot stays locked until
              the cooldown expires.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cluster.stateIds.map((id) => (
                <span
                  key={id}
                  className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary"
                >
                  {stateNameById[id] ?? id}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Setter UI — visible only when slot is unlocked */}
      {!isLocked && (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">
            {cluster ? "Re-set cluster" : "Set initial cluster"}
            <span className="ml-2 normal-case text-[10px] text-muted/70">
              {picked.length} / {maxPicks} picked
              {hasAnchorOnPicks && (
                <span className="ml-2 text-success">· governor anchor active (+1 slot)</span>
              )}
            </span>
          </div>
          {picked.length >= 2 && !picksAreConnected && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
              Picked states aren&apos;t all connected. Add a bridging state or un-pick the orphan
              before submitting.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {states.map((s) => {
              const isPicked = picked.includes(s.id);
              const isEligible = eligibleSet.has(s.id);
              const atCap = !isPicked && picked.length >= maxPicks;
              const disabled = !isPicked && (!isEligible || atCap);
              const isGovernor = governorStateSet.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => togglePick(s.id)}
                  disabled={disabled}
                  title={
                    atCap
                      ? `Cluster cap reached (${maxPicks}).`
                      : !isEligible
                        ? "Not adjacent to any picked state."
                        : isGovernor
                          ? "Your party holds the state-level executive here — qualifies the cluster for +1 slot."
                          : undefined
                  }
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2 ${
                    isPicked
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-card-border text-muted hover:border-primary/40 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-card-border disabled:hover:text-muted"
                  }`}
                >
                  <span>{s.name}</span>
                  {isGovernor && (
                    <span
                      className={`text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                        isPicked ? "bg-primary/20 text-primary" : "bg-success/15 text-success"
                      }`}
                    >
                      Gov
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || picked.length < 2 || !picksAreConnected}
            className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: party.color, color: contrastTextColor(party.color) }}
          >
            {submitting ? "Locking in…" : "Lock in Priority Region"}
          </button>
        </div>
      )}
    </div>
  );
}
