import type {
  NppMarketEntryDiagnostic,
  NppMarketEntryFunnel,
  NppMarketEntryReason,
} from "@/lib/db/types/marketFormation";

export const NPP_MARKET_ENTRY_FUNNEL_COLLECTION = "nppMarketEntryFunnels";
export const NPP_MARKET_ENTRY_FUNNEL_RETENTION_TURNS = 48;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Shape-normalize a persisted funnel document for reads. Funnel documents
 * written before newer rejection reasons existed stay servable: missing
 * aggregates default from the diagnostics array itself, and reason strings
 * outside the current union pass through untouched so a newer writer never
 * breaks an older reader. Returns null for non-documents. Invents no
 * outcomes: rows without a reason string still count as observed, never as
 * explained.
 */
export function normalizeNppMarketEntryFunnel(doc: unknown): NppMarketEntryFunnel | null {
  const raw = asRecord(doc);
  if (!raw) return null;
  const diagnostics = Array.isArray(raw.diagnostics)
    ? (raw.diagnostics.filter((row) => asRecord(row) !== null) as NppMarketEntryDiagnostic[])
    : [];
  const rawCounts = asRecord(raw.reasonCounts);
  const reasonCounts: Partial<Record<NppMarketEntryReason, number>> = {};
  if (rawCounts) {
    for (const [reason, count] of Object.entries(rawCounts)) {
      if (typeof count === "number" && Number.isFinite(count) && count > 0) {
        reasonCounts[reason as NppMarketEntryReason] = count;
      }
    }
  } else {
    for (const row of diagnostics) {
      if (typeof row.reason === "string") {
        reasonCounts[row.reason] = (reasonCounts[row.reason] ?? 0) + 1;
      }
    }
  }
  const corporationsObserved =
    typeof raw.corporationsObserved === "number" &&
    Number.isFinite(raw.corporationsObserved) &&
    raw.corporationsObserved >= 0
      ? Math.floor(raw.corporationsObserved)
      : diagnostics.length;
  const entered = asNonNegativeInt(raw.entered, Math.floor(reasonCounts.entered ?? 0));
  const rejected = asNonNegativeInt(raw.rejected, Math.max(0, corporationsObserved - entered));
  return {
    _id: typeof raw._id === "string" ? raw._id : `turn:${asNonNegativeInt(raw.turn, 0)}`,
    schemaVersion: 1,
    turn: asNonNegativeInt(raw.turn, 0),
    generatedAt: raw.generatedAt instanceof Date ? raw.generatedAt : new Date(0),
    corporationsObserved,
    entered,
    rejected,
    reasonCounts,
    diagnostics,
  };
}
