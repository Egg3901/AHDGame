import type { Db } from "mongodb";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import type { TradeFlowSnapshot } from "@/lib/db/types/tradeFlowSnapshot";
import { shapeWorldTradeLedger, type WorldTradeLedger } from "./worldTradeLedger";

/** Load the latest trade-flow snapshot and shape it for the ledger surface. */
export async function loadWorldTradeLedger(db: Db): Promise<WorldTradeLedger | null> {
  const snap = await db
    .collection<TradeFlowSnapshot>("tradeFlowSnapshots")
    .find({}, { sort: { turn: -1 }, limit: 1 })
    .next();
  if (!snap) return null;
  return shapeWorldTradeLedger(snap, COUNTRY_ORDER);
}
