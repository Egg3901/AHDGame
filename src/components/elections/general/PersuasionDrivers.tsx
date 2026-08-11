"use client";

/**
 * Persuasion-driver card — an interactive head-to-head explorer. The viewer
 * picks a Focus candidate and an Opponent candidate; the five signed driver
 * bars (Candidate Support, Policy alignment, Coattails, Money, Incumbency)
 * recompute for that pair via the engine's `getPersuasionDriverBreakdown`
 * (through `computePairwiseDriverDisplay`). Positive bars push toward Focus
 * (Focus party color); negative bars push away (drag red).
 *
 * Default selection is the popular-vote leader vs. the top cross-party rival,
 * preserving the prior fixed view while making it labeled and changeable.
 *
 * All inputs are already client-side in the election DTO, so no server round-
 * trip is needed on selection change. Fog-of-war is unchanged: `support` is
 * stripped server-side for non-privileged viewers and defaults to neutral.
 */

import { useMemo, useState } from "react";
import {
  computePairwiseDriverDisplay,
  pickDefaultDriverPair,
  type DriverDisplayInputs,
} from "@/lib/elections/computePersuasionDriverDisplay";
import type { PersuasionDriver } from "@/lib/elections/generalViewModel";

export interface PersuasionDriverCandidate {
  id: string;
  characterId: string;
  /** Display name for the selector label. */
  name: string;
  party: string;
  partyColor: string;
  partyEcon: number;
  partySocial: number;
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  nationalInfluence: number;
  isNPP: boolean;
  sharePct: number;
  /** Undefined for fogged (non-privileged) viewers. */
  support?: number;
}

function CandidateSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PersuasionDriverCandidate[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-card-border bg-background px-2 py-1 text-xs"
      >
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function DriverBarRow({ driver: d, maxAbs }: { driver: PersuasionDriver; maxAbs: number }) {
  const isPositive = d.contributionPct >= 0;
  const widthPct = maxAbs > 0 ? (Math.abs(d.contributionPct) / maxAbs) * 50 : 0; // 50% per side of midline
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold">{d.label}</span>
        <span
          className="tabular-nums font-bold"
          style={{ color: isPositive ? d.color : "#ef4444" }}
        >
          {isPositive && d.contributionPct > 0 ? "+" : ""}
          {d.contributionPct.toFixed(1)}
          {d.unit === "%" ? "%" : " pts"}
        </span>
      </div>
      {/* Diverging bar centered on a midline */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-background">
        {/* Midline */}
        <span
          className="absolute top-0 h-full"
          style={{ left: "50%", width: 1, background: "var(--card-border)" }}
        />
        {/* Bar — anchored to midline; grows left for negative, right for positive. */}
        <span
          className="absolute top-0 h-full"
          style={{
            left: isPositive ? "50%" : `${50 - widthPct}%`,
            width: `${widthPct}%`,
            background: isPositive ? d.color : "#ef4444",
            opacity: 0.85,
          }}
        />
      </div>
    </div>
  );
}

export function PersuasionDrivers({
  stateName,
  stateId,
  candidates,
  inputs,
}: {
  stateName: string;
  stateId: string;
  candidates: PersuasionDriverCandidate[];
  inputs: DriverDisplayInputs;
}) {
  const defaultPair = useMemo(() => pickDefaultDriverPair(candidates), [candidates]);
  const [focusId, setFocusId] = useState<string | null>(defaultPair?.focusId ?? null);
  const [opponentId, setOpponentId] = useState<string | null>(defaultPair?.opponentId ?? null);

  // Defensive resolution — selection ids may not match if the candidate list
  // shifts between polls; fall back to the computed default pair.
  const focus =
    candidates.find((c) => c.id === focusId) ??
    candidates.find((c) => c.id === defaultPair?.focusId) ??
    null;
  const opponent =
    candidates.find((c) => c.id === opponentId && c.id !== focus?.id) ??
    candidates.find((c) => c.id === defaultPair?.opponentId && c.id !== focus?.id) ??
    null;

  const opponentOptions = focus ? candidates.filter((c) => c.id !== focus.id) : candidates;

  const handleFocusChange = (newFocusId: string) => {
    setFocusId(newFocusId);
    if (newFocusId === (opponent?.id ?? opponentId)) {
      const next = candidates.find((c) => c.id !== newFocusId);
      setOpponentId(next?.id ?? null);
    }
  };

  const drivers = useMemo(() => {
    if (!focus || !opponent) return [];
    return computePairwiseDriverDisplay(candidates, focus.id, opponent.id, inputs);
  }, [candidates, focus, opponent, inputs]);

  // A valid Focus/Opponent pair always yields the full 5-row breakdown
  // (`getPersuasionDriverBreakdown` returns one row per driver). Render those
  // rows even when every value is 0 — an evenly-matched or fogged-spectator
  // pairing is a real computed result, not a "no data yet" state. The
  // placeholder is reserved for `drivers.length === 0` (no cross-party pair).
  const hasDrivers = drivers.length > 0;
  const maxAbs = Math.max(0, ...drivers.map((d) => Math.abs(d.contributionPct)));
  // Mixed units: driver rows are "pts" acting on the persuadable slice;
  // coattail rows are direct "%" share tilts. Render them as separate
  // labeled groups so the units are honest.
  const driverRows = drivers.filter((d) => d.unit !== "%");
  const coattailRows = drivers.filter((d) => d.unit === "%");

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Persuasion Drivers
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-muted">{stateId}</span>
      </div>

      {focus && opponent ? (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <CandidateSelect
              label="Focus"
              value={focus.id}
              options={candidates}
              onChange={handleFocusChange}
            />
            <CandidateSelect
              label="Opponent"
              value={opponent.id}
              options={opponentOptions}
              onChange={setOpponentId}
            />
          </div>
          <p className="mb-3 text-xs text-muted leading-snug">
            Why <span className="font-semibold">{stateName}</span> voters lean toward{" "}
            <span className="font-semibold" style={{ color: focus.partyColor }}>
              {focus.name}
            </span>{" "}
            over <span className="font-semibold">{opponent.name}</span>. Each driver is signed:{" "}
            <span className="font-semibold">+</span> = lift,{" "}
            <span className="font-semibold">&minus;</span> = drag. Drivers are relative within this
            list and only move the persuadable slice of each party&apos;s vote, so their real effect
            is small. Coattail rows are direct share tilts in %. A raw vote lead does not equal the
            sum of these bars.
          </p>
        </>
      ) : null}

      {!hasDrivers ? (
        <p className="text-xs italic text-muted">
          No persuasion drivers computed for {stateName} yet — drivers populate once vote data and
          enrichment data are loaded.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wider text-muted">
            Persuasion drivers (pts of the persuadable slice)
          </div>
          {driverRows.map((d) => (
            <DriverBarRow key={d.label} driver={d} maxAbs={maxAbs} />
          ))}
          {coattailRows.length > 0 ? (
            <>
              <div className="mt-1 border-t border-card-border pt-2 text-[10px] uppercase tracking-wider text-muted">
                Coattail tilts (direct % of vote share)
              </div>
              {coattailRows.map((d) => (
                <DriverBarRow key={d.label} driver={d} maxAbs={maxAbs} />
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
