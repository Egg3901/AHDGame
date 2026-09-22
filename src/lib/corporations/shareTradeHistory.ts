import type { Db } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import type {
  ShareTradeHistory,
  ShareTradeKind,
  ShareTradeParty,
  ShareTradeStructureChangeMeta,
} from "@/lib/db/types/shareTradeHistory";
import type { CurrencyCode } from "@/lib/constants/currencies";

const COLL = "shareTradeHistory";

const STRUCTURE_CHANGE_KINDS = new Set<ShareTradeKind>(["stock_split", "reverse_split"]);

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

function buildShareTradeDocument(input: RecordShareTradeInput): Omit<ShareTradeHistory, "_id"> {
  const isStructureChange = STRUCTURE_CHANGE_KINDS.has(input.kind);
  return {
    corporationId: input.corporationId,
    kind: input.kind,
    turn: input.turn,
    createdAt: input.createdAt ?? new Date(),
    shares: isStructureChange ? 0 : input.shares,
    pricePerShareAnchor: isStructureChange ? 0 : input.pricePerShareAnchor,
    totalAnchor: isStructureChange
      ? 0
      : Math.round(input.shares * input.pricePerShareAnchor * 100) / 100,
    from: input.from,
    to: input.to,
    ...(input.corpCurrencyCode ? { corpCurrencyCode: input.corpCurrencyCode } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.structureChange ? { structureChange: input.structureChange } : {}),
  };
}

/**
 * Insert a trade-history row. Best-effort: logs to Sentry on failure rather
 * than throwing so it can never roll back the share-movement it audits.
 */
export async function recordShareTrade(db: Db, input: RecordShareTradeInput): Promise<void> {
  try {
    await db
      .collection<Omit<ShareTradeHistory, "_id">>(COLL)
      .insertOne(buildShareTradeDocument(input));
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "shareTradeHistory" } });
  }
}

/** Best-effort batch form for turn paths that already collect several fills. */
export async function recordShareTrades(db: Db, inputs: RecordShareTradeInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await db
      .collection<Omit<ShareTradeHistory, "_id">>(COLL)
      .insertMany(inputs.map(buildShareTradeDocument), { ordered: false });
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "shareTradeHistory" } });
  }
}
