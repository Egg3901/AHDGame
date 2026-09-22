import type {
  EmptyMarketClassification,
  MarketFormationSnapshot,
} from "@/lib/db/types/marketFormation";

const EMPTY_CLASSIFICATIONS: EmptyMarketClassification[] = [
  "fundamental_zero",
  "import_served",
  "unserved",
  "entry_gap",
  "coordination_gap",
  "data_zero",
];

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function snapshotArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function snapshotShare(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function snapshotCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Shape-normalize a persisted market-formation snapshot for reads. Snapshots
 * written before the state-sector coverage evidence existed carry no
 * coverage, breadth, or sample-omission fields; those default to empty rather
 * than breaking the reader. Returns null for non-documents. Defaults only
 * fill shape, never recompute economics.
 *
 * Client-safe: type-only imports, so admin views can normalize old snapshots
 * without pulling the snapshot builder's server chain into the bundle.
 */
export function normalizeMarketFormationSnapshot(doc: unknown): MarketFormationSnapshot | null {
  const raw = snapshotRecord(doc);
  if (!raw) return null;
  const rawCounts = snapshotRecord(raw.classificationCounts);
  const classificationCounts = {} as Record<EmptyMarketClassification, number>;
  for (const key of EMPTY_CLASSIFICATIONS) {
    classificationCounts[key] = snapshotCount(rawCounts?.[key]);
  }
  const rawFunnel = snapshotRecord(raw.entryFunnel);
  const rawReasonCounts = snapshotRecord(rawFunnel?.reasonCounts);
  return {
    cellsObserved: snapshotCount(raw.cellsObserved),
    activeCells: snapshotCount(raw.activeCells),
    emptyCells: snapshotCount(raw.emptyCells),
    emptyShare: snapshotShare(raw.emptyShare),
    facilityReadyEmptyCells: snapshotCount(raw.facilityReadyEmptyCells),
    facilityReadyEmptyShare: snapshotShare(raw.facilityReadyEmptyShare),
    statesObserved: snapshotCount(raw.statesObserved),
    statesWithEmptyCells: snapshotCount(raw.statesWithEmptyCells),
    classificationCounts,
    entryFunnel: {
      corporationsObserved: snapshotCount(rawFunnel?.corporationsObserved),
      entered: snapshotCount(rawFunnel?.entered),
      rejected: snapshotCount(rawFunnel?.rejected),
      explainedOutcomeShare: snapshotShare(rawFunnel?.explainedOutcomeShare),
      reasonCounts: rawReasonCounts ?? {},
    },
    emptyByCountry: snapshotArray(raw.emptyByCountry),
    emptyBySector: snapshotArray(raw.emptyBySector),
    emptyByState: snapshotArray(raw.emptyByState),
    emptyMarketCells: snapshotArray(raw.emptyMarketCells),
    ...(typeof raw.emptyMarketCellsOmitted === "number" &&
    Number.isFinite(raw.emptyMarketCellsOmitted) &&
    raw.emptyMarketCellsOmitted > 0
      ? { emptyMarketCellsOmitted: Math.floor(raw.emptyMarketCellsOmitted) }
      : {}),
    coverageByState: snapshotArray(raw.coverageByState),
    coverageByCountry: snapshotArray(raw.coverageByCountry),
    commodityBreadth: snapshotArray(raw.commodityBreadth),
    basis: typeof raw.basis === "string" ? raw.basis : "",
  };
}
