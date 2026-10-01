/** Persistence shell for v2 Cabinet requests. It never transfers or mints cash. */
import type { Db } from "mongodb";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { validateResetDepartmentAllocations } from "./rules/allocation";

export type ResetAllocationWriteResult =
  { ok: true } | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export async function setResetDepartmentAllocations(input: {
  db: Db;
  worldId: string;
  countryId: "US" | "UK" | "JP";
  departmentId: string;
  positionId: string;
  turn: number;
  actorId: string;
  allocations: Readonly<Record<string, number>>;
}): Promise<ResetAllocationWriteResult> {
  const { db, worldId, countryId, departmentId, positionId, turn, actorId, allocations } = input;
  if (!worldId || !Number.isSafeInteger(turn) || turn < 1 || !actorId) {
    return { ok: false, status: 409, error: "The active reset world is not ready" };
  }
  const collection = db.collection<ResetDepartmentAccountSnapshot>("resetDepartmentAccounts");
  const account = await collection.findOne({ _id: `${countryId}:${departmentId}`, worldId });
  if (!account) {
    return { ok: false, status: 404, error: "This department has no v2 account" };
  }
  if (account.countryId !== countryId || account.controllingSeatId !== positionId) {
    return { ok: false, status: 403, error: "This office does not control that department" };
  }
  const validation = validateResetDepartmentAllocations(account, allocations);
  if (!validation.ok) return { ok: false, status: 400, error: validation.reason };
  if ((account.lastAllocationChangedTurn ?? 0) >= turn) {
    return { ok: false, status: 400, error: "Allocations can only change once per turn" };
  }
  const result = await collection.updateOne(
    {
      _id: account._id,
      worldId,
      accruedThroughTurn: account.accruedThroughTurn,
      programAllocationPercents: account.programAllocationPercents,
      $or: [
        { lastAllocationChangedTurn: { $exists: false } },
        { lastAllocationChangedTurn: { $lt: turn } },
      ],
    },
    {
      $set: {
        programAllocationPercents: validation.allocations,
        lastAllocationChangedTurn: turn,
        lastAllocationChangedBy: actorId,
      },
    }
  );
  if (result.modifiedCount !== 1) {
    return { ok: false, status: 409, error: "Allocations changed. Refresh and try again" };
  }
  return { ok: true };
}
