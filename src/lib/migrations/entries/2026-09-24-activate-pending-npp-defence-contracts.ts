import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import { isNppOwned } from "@/lib/corporations/nppOwned";
import type { Migration, MigrationContext, MigrationResult } from "../types";

type NppOwnershipRow = Pick<Corporation, "_id" | "ceoType" | "caretakerCeo">;

async function activatePendingNppDefenceContracts(
  db: Db,
  ctx: MigrationContext
): Promise<MigrationResult> {
  const corporations = await db
    .collection<NppOwnershipRow>("corporations")
    .find({ ceoType: "npp" })
    .project<NppOwnershipRow>({ _id: 1, ceoType: 1, caretakerCeo: 1 })
    .toArray();
  const nppCorporationIds = corporations.filter(isNppOwned).map((corp) => corp._id);

  if (nppCorporationIds.length === 0) {
    return {
      documentsScanned: 0,
      documentsUpdated: 0,
      notes: ["No true NPP-owned corporations found; no defence contracts changed."],
    };
  }

  const contracts = db.collection<DefenceContract>("defenceContracts");
  const filter = {
    status: "pending" as const,
    corporationId: { $in: nppCorporationIds },
  };

  if (ctx.dryRun) {
    const pending = await contracts.countDocuments(filter);
    return {
      documentsScanned: pending,
      documentsUpdated: 0,
      notes: [`DRY RUN, no writes. ${pending} pending NPP defence contract(s) need activation.`],
    };
  }

  const result = await contracts.updateMany(filter, {
    $set: { status: "active", updatedAt: new Date() },
  });
  return {
    documentsScanned: result.matchedCount,
    documentsUpdated: result.modifiedCount,
    notes: [
      `${result.modifiedCount} pending NPP defence contract(s) activated; caretaker-run player corporations were excluded.`,
    ],
  };
}

export const migration: Migration = {
  id: "2026-09-24-activate-pending-npp-defence-contracts",
  description:
    "Activate legacy pending defence contracts for true NPP-owned suppliers while preserving player caretaker offers",
  idempotent: true,
  execute: activatePendingNppDefenceContracts,
};
