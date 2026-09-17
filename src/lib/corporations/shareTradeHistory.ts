import { ObjectId, type Db } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import type {
  ShareTradeHistory,
  ShareTradeKind,
  ShareTradeParty,
  ShareTradeStructureChangeMeta,
} from "@/lib/db/types/shareTradeHistory";
import type { CurrencyCode } from "@/lib/constants/currencies";

const COLL = "shareTradeHistory";

export interface RecordShareTradeInput {
  corporationId: ShareTradeHistory["corporationId"];
  kind: ShareTradeKind;
  turn: number;
  shares: number;
  pricePerShareAnchor: number;
  from: ShareTradeParty | null;
  to: ShareTradeParty | null;
  corpCurrencyCode?: CurrencyCode;
  note?: string;
  createdAt?: Date;
  /** Set for `stock_split` and `reverse_split` rows. */
  structureChange?: ShareTradeStructureChangeMeta;
}

/** Convergent-insert outcome for one trade-history row (issue #1672). */
export type RecordShareTradeOutcome = "applied" | "already-applied" | "failed";

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === 11000;
}

/**
 * Insert a trade-history row. Best-effort: logs to Sentry on failure rather
 * than throwing so it can never roll back the share-movement it audits.
 * Accepts a caller-supplied `_id` so keyed flows (issue #1672) can re-insert
 * the same row convergently after a crash: a duplicate `_id` reports
 * `already-applied` instead of logging a Sentry error.
 */
export async function recordShareTrade(
  db: Db,
  input: RecordShareTradeInput,
  options?: { _id?: ObjectId }
): Promise<RecordShareTradeOutcome> {
  const doc: Omit<ShareTradeHistory, "_id"> = {
    corporationId: input.corporationId,
    kind: input.kind,
    turn: input.turn,
    createdAt: input.createdAt ?? new Date(),
    shares: input.shares,
    pricePerShareAnchor: input.pricePerShareAnchor,
    totalAnchor: Math.round(input.shares * input.pricePerShareAnchor * 100) / 100,
    from: input.from,
    to: input.to,
    ...(input.corpCurrencyCode ? { corpCurrencyCode: input.corpCurrencyCode } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.structureChange ? { structureChange: input.structureChange } : {}),
  };
  try {
    await db
      .collection<ShareTradeHistory>(COLL)
      .insertOne({ ...doc, _id: options?._id ?? new ObjectId() });
    return "applied";
  } catch (err) {
    if (isDuplicateKeyError(err)) return "already-applied";
    Sentry.captureException(err, { tags: { module: "shareTradeHistory" } });
    return "failed";
  }
}
