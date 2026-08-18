"use client";

import { CountryFlag } from "@/components/CountryFlag";
import type { CountryId } from "@/lib/constants/countries";
import { getStateDisplayName } from "@/lib/commodity-map";
import { formatUnits } from "../lib/helpers";

/** Price/base at or above this reads as a local shortage. */
const SHORT_RATIO = 1.25;
/** Price/base at or below this, with local surplus, reads as stranded supply. */
const GLUT_RATIO = 0.8;
const MAX_ROWS = 5;

interface DislocationPanelProps {
  statePrices: Record<string, number>;
  stateSupply: Record<string, number>;
  stateDemand: Record<string, number>;
  stateCountryMap: Record<string, string>;
  basePrice: number;
  /** Per-state extraction ceiling; only present for extractable resources. */
  capacityByState?: Record<string, number>;
  unit: string;
}

/**
 * Where this market is dislocated: states paying a shortage premium, states
 * sitting on supply their local market cannot absorb, and (for extractable
 * resources) states with unmined deposit room. The same good can be cheap and
 * scarce on one map because moving it costs freight and freight has limits —
 * this panel turns that confusing picture into a build/ship to-do list.
 */
// A missing or non-positive state price is a data gap, not a price of zero: a
// zero ratio would classify the state as a glut ("cannot sell locally") when
// nothing was measured. Mask both to the base price (ratio 1, never listed).
function statePriceOr(price: number | undefined, basePrice: number): number {
  return typeof price === "number" && price > 0 ? price : basePrice;
}

export default function DislocationPanel({
  statePrices,
  stateSupply,
  stateDemand,
  stateCountryMap,
  basePrice,
  capacityByState,
  unit,
}: DislocationPanelProps) {
  if (!(basePrice > 0)) return null;
  const stateIds = Object.keys(stateCountryMap);

  const short = stateIds
    .map((id) => ({ id, ratio: statePriceOr(statePrices[id], basePrice) / basePrice }))
    .filter((s) => s.ratio >= SHORT_RATIO)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, MAX_ROWS);

  const stranded = stateIds
    .map((id) => ({
      id,
      ratio: statePriceOr(statePrices[id], basePrice) / basePrice,
      surplus: (stateSupply[id] ?? 0) - (stateDemand[id] ?? 0),
    }))
    .filter((s) => s.ratio <= GLUT_RATIO && s.surplus > 0)
    .sort((a, b) => b.surplus - a.surplus)
    .slice(0, MAX_ROWS);

  const room = capacityByState
    ? stateIds
        .map((id) => ({ id, headroom: (capacityByState[id] ?? 0) - (stateSupply[id] ?? 0) }))
        .filter((s) => s.headroom > 0)
        .sort((a, b) => b.headroom - a.headroom)
        .slice(0, MAX_ROWS)
    : [];

  if (short.length === 0 && stranded.length === 0 && room.length === 0) return null;

  const stateRow = (id: string, right: string) => {
    const countryId = stateCountryMap[id] as CountryId;
    return (
      <li key={id} className="flex items-center justify-between gap-2 py-0.5 text-xs">
        <span className="flex items-center gap-1.5 text-foreground">
          <CountryFlag country={countryId} size="sm" />
          {getStateDisplayName(countryId, id)}
        </span>
        <span className="tabular-nums text-muted">{right}</span>
      </li>
    );
  };

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">Where this market is out of balance</h3>
      <p className="mt-0.5 text-xs text-muted">
        Goods do not move for free, so one map can hold both a shortage and a glut. Building supply
        in a short state, or shipping out of a glutted one, is what closes the gap.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {short.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground">Short: paying a premium</p>
            <ul className="mt-1 divide-y divide-border/50">
              {short.map((s) => stateRow(s.id, `${s.ratio.toFixed(2)}x base price`))}
            </ul>
          </div>
        )}
        {stranded.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground">Oversupplied: cannot sell locally</p>
            <ul className="mt-1 divide-y divide-border/50">
              {stranded.map((s) => stateRow(s.id, `+${formatUnits(s.surplus, unit)} surplus`))}
            </ul>
          </div>
        )}
        {room.length > 0 && (
          <div>
            <p className="text-xs font-medium text-foreground">Deposits with room to grow</p>
            <ul className="mt-1 divide-y divide-border/50">
              {room.map((s) => stateRow(s.id, `${formatUnits(s.headroom, unit)}/turn free`))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
