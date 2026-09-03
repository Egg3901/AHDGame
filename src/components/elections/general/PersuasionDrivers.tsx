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
import { useTranslations } from "next-intl";
import {
  computePairwiseDriverDisplay,
  computePersuadableSliceReadout,
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

function DriverBarRow({
  driver: d,
  maxAbs,
  hint,
}: {
  driver: PersuasionDriver;
  maxAbs: number;
  hint?: string;
}) {
  const t = useTranslations("elections");
  const isPositive = d.contributionPct >= 0;
  const widthPct = maxAbs > 0 ? (Math.abs(d.contributionPct) / maxAbs) * 50 : 0; // 50% per side of midline
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between text-xs">
        <span
          className={
            hint ? "font-semibold underline decoration-dotted cursor-help" : "font-semibold"
          }
          title={hint}
        >
          {d.label}
        </span>
        <span
          className="tabular-nums font-bold"
          style={{ color: isPositive ? d.color : "#ef4444" }}
        >
          {isPositive && d.contributionPct > 0 ? "+" : ""}
          {d.contributionPct.toFixed(1)}
          {d.unit === "%" ? "%" : ` ${t("persuasion.pts")}`}
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
  const t = useTranslations("elections");
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

  // Ceiling readout (ticket #1131) — how much of each side's vote the drivers
  // can actually reach this cycle. A big registration lean is not a vote-share
  // floor, and positive drivers only move the persuadable slice, so the card
  // states both numbers instead of leaving the player to infer them.
  const slice = useMemo(() => {
    if (!focus || !opponent) return null;
    return computePersuadableSliceReadout(drivers, focus.party, opponent.party, inputs);
  }, [drivers, focus, opponent, inputs]);

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t("persuasion.title")}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-muted">{stateId}</span>
      </div>

      {focus && opponent ? (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <CandidateSelect
              label={t("persuasion.focus")}
              value={focus.id}
              options={candidates}
              onChange={handleFocusChange}
            />
            <CandidateSelect
              label={t("persuasion.opponent")}
              value={opponent.id}
              options={opponentOptions}
              onChange={setOpponentId}
            />
          </div>
          <p className="mb-3 text-xs text-muted leading-snug">
            {t.rich("persuasion.explanation", {
              state: () => <span className="font-semibold">{stateName}</span>,
              focus: () => (
                <span className="font-semibold" style={{ color: focus.partyColor }}>
                  {focus.name}
                </span>
              ),
              opponent: () => <span className="font-semibold">{opponent.name}</span>,
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
          </p>
        </>
      ) : null}

      {!hasDrivers ? (
        <p className="text-xs italic text-muted">{t("persuasion.empty", { state: stateName })}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wider text-muted">
            {t("persuasion.driversGroup")}
          </div>
          {driverRows.map((d) => {
            // Ticket #1261: players mistook the Money row for treasury or
            // lifetime spend. It reads recent spend (this turn full weight,
            // earlier spend fading), so explain that on hover.
            const isMoney = d.label === "Money";
            return (
              <DriverBarRow
                key={d.label}
                driver={d}
                maxAbs={maxAbs}
                hint={isMoney ? t("persuasion.moneyHint") : undefined}
              />
            );
          })}
          {slice && focus && opponent ? (
            <p className="mt-1 rounded border border-card-border bg-background px-2 py-1.5 text-[11px] leading-snug text-muted">
              {t("persuasion.ceiling", {
                opponent: opponent.name,
                opponentSlice: slice.opponentSlicePct.toFixed(1),
                focus: focus.name,
                focusSlice: slice.focusSlicePct.toFixed(1),
                net: slice.netDriverPts.toFixed(1),
              })}
            </p>
          ) : null}
          {coattailRows.length > 0 ? (
            <>
              <div className="mt-1 border-t border-card-border pt-2 text-[10px] uppercase tracking-wider text-muted">
                {t("persuasion.coattailsGroup")}
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
