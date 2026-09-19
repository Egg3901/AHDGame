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

/**
 * Insert a trade-history row. Best-effort: logs to Sentry on failure rather
 * than throwing so it can never roll back the share-movement it audits.
 */
export async function recordShareTrade(db: Db, input: RecordShareTradeInput): Promise<void> {
  const isStructureChange = STRUCTURE_CHANGE_KINDS.has(input.kind);
  const doc: Omit<ShareTradeHistory, "_id"> = {
    corporationId: input.corporationId,
    kind: input.kind,
    turn: input.turn,
    createdAt: input.createdAt ?? new Date(),
    // Corporate actions stay on this audit surface for cost-basis replay, but
    // they are not executable trades and must contribute no volume/notional.
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
  try {
    await db.collection<Omit<ShareTradeHistory, "_id">>(COLL).insertOne(doc);
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "shareTradeHistory" } });
  }
}
