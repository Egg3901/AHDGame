import { retoolOperatingCapacityRatio } from "../retooling/rules";

type MeasurementBasis = Omit<Parameters<typeof retoolOperatingCapacityRatio>[0], "currentTurn"> & {
  operatingCapacityTurn?: number | null;
};

/** Unit basis of the persisted output, before the next turn advances a retool. */
export function pickupMeasurementBasis(row: MeasurementBasis): number {
  return row.operatingCapacityTurn == null
    ? 1
    : retoolOperatingCapacityRatio({ ...row, currentTurn: row.operatingCapacityTurn });
}

/** Production and sales travel with the built plants, not their former owner. */
interface ProductionHistory {
  producedUnits?: number;
  soldUnits?: number;
  soldByCommodity?: Partial<Record<string, number>>;
}

export function pickupProductionHistory(args: {
  receiver?: ProductionHistory;
  donor: ProductionHistory;
  /** Actual built fraction, including whole-facility rounding. */
  capacityShare: number;
  /** Donor measurement units expressed in the receiver's measurement basis. */
  unitRatio: number;
}): ProductionHistory {
  const parts = [
    { history: args.receiver, scale: 1 },
    { history: args.donor, scale: args.capacityShare * args.unitRatio },
  ].filter(
    (part): part is { history: ProductionHistory; scale: number } =>
      part.history != null &&
      Number.isFinite(part.history.producedUnits) &&
      part.history.producedUnits! >= 0 &&
      Number.isFinite(part.history.soldUnits) &&
      part.history.soldUnits! >= 0 &&
      Number.isFinite(part.scale) &&
      part.scale > 0
  );
  if (parts.length === 0) return {};
  const producedUnits = parts.reduce((sum, p) => sum + p.history.producedUnits! * p.scale, 0);
  const soldUnits = parts.reduce((sum, p) => sum + p.history.soldUnits! * p.scale, 0);
  const commodities = new Set(parts.flatMap((p) => Object.keys(p.history.soldByCommodity ?? {})));
  const soldByCommodity: Partial<Record<string, number>> = {};
  for (const commodity of commodities) {
    const sold = parts.reduce((sum, { history, scale }) => {
      const produced = history.producedUnits!;
      const fill = history.soldByCommodity?.[commodity];
      const fallback = produced > 0 ? history.soldUnits! / produced : 0;
      return (
        sum +
        produced *
          scale *
          Math.max(
            0,
            Math.min(1, typeof fill === "number" && Number.isFinite(fill) ? fill : fallback)
          )
      );
    }, 0);
    soldByCommodity[commodity] = producedUnits > 0 ? sold / producedUnits : 0;
  }
  return { producedUnits, soldUnits, soldByCommodity };
}
