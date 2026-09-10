/**
 * Union service effects use prepaid turn receipts. loadFundedUnionServices never
 * infers payment from cash left after settlement or from the newly selected slate.
 */
import type { Union } from "@/lib/db/types";
import type { UnionServiceId } from "./unionServices";
import { paidUnionServices } from "./rules";

export const UNION_SERVICE_FUNDING_PROJECTION = {
  ownerId: 1,
  suspended: 1,
  serviceReceipts: 1,
} as const;

export function loadFundedUnionServices(
  unions: readonly Pick<Union, "_id" | "ownerId" | "suspended" | "serviceReceipts">[],
  currentTurn: number
): Map<string, UnionServiceId[]> {
  return new Map(
    unions.map((union) => [
      union._id.toString(),
      paidUnionServices({ ...union, ownerId: union.ownerId?.toString() ?? null }, currentTurn),
    ])
  );
}
