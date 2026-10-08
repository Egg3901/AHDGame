import type { ObjectId } from "mongodb";
import type {
  Corporation,
  CorporationExit,
  CorporationExitOwnerKind,
  CorporationExitReason,
} from "@/lib/db/types";

export type CorporationExitSnapshot = Pick<
  Corporation,
  | "_id"
  | "name"
  | "sequentialId"
  | "countryId"
  | "type"
  | "ceoType"
  | "countryOwnerId"
  | "ownershipState"
  | "liquidCapital"
  | "liquidCurrencyCode"
  | "sharePrice"
  | "totalShares"
>;

export function exitOwnerKind(corp: CorporationExitSnapshot): CorporationExitOwnerKind {
  // Same test as `isStateOwned`, kept local so the rules module has no imports
  // beyond types.
  if (corp.countryOwnerId || corp.ownershipState === "stateOwned") return "state";
  return corp.ceoType === "npp" ? "npp" : "player";
}

/** Plain-data exit row for a corporation as it stood when it left. */
export function buildCorporationExit(input: {
  corporation: CorporationExitSnapshot;
  reason: CorporationExitReason;
  turn: number;
  /** Revenue on the corporation's last history row, if any. */
  lastRevenue?: number | null;
  successorId?: ObjectId;
  now: Date;
}): CorporationExit {
  const { corporation: corp } = input;
  const finite = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  const exit: CorporationExit = {
    _id: corp._id,
    corporationId: corp._id,
    name: corp.name,
    countryId: corp.countryId,
    corporationType: corp.type,
    ownerKind: exitOwnerKind(corp),
    turn: input.turn,
    reason: input.reason,
    finalCash: finite(corp.liquidCapital),
    finalMarketCap: finite(corp.sharePrice) * finite(corp.totalShares),
    finalRevenue: finite(input.lastRevenue),
    createdAt: input.now,
  };
  if (corp.sequentialId != null) exit.sequentialId = corp.sequentialId;
  if (corp.liquidCurrencyCode) exit.currencyCode = corp.liquidCurrencyCode;
  if (input.successorId) exit.successorId = input.successorId;
  return exit;
}
