import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import type { CorporateSector, Corporation } from "@/lib/db/types/corporation";

export interface ConstructionAdmission {
  token: string;
  loanId: string;
  turn: number;
}

/** Config admission and disabling serialize on the same document. */
export async function acquireConstructionAdmission(
  db: Db,
  admission: ConstructionAdmission
): Promise<boolean> {
  const config = db.collection<GameConfig>("gameConfig");
  const guard = {
    _id: "default",
    privateBankingEnabled: true,
    treasuryCashLedgerEnabled: true,
    bankConstructionFinanceEnabled: true,
    bankConstructionAdmissionClosing: { $ne: true },
  };
  const appended = await config.updateOne(
    { ...guard, bankConstructionAdmissions: { $not: { $elemMatch: { token: admission.token } } } },
    { $push: { bankConstructionAdmissions: admission } }
  );
  if (appended.matchedCount === 1) return true;
  return (
    (await config.findOne(
      { ...guard, bankConstructionAdmissions: { $elemMatch: { token: admission.token } } },
      { projection: { _id: 1 } }
    )) !== null
  );
}

export async function releaseConstructionAdmission(db: Db, token?: string): Promise<void> {
  if (!token) return;
  await db
    .collection<GameConfig>("gameConfig")
    .updateOne({ _id: "default" }, { $pull: { bankConstructionAdmissions: { token } } });
}

/** Leave recovery enabled until every persisted cash or collateral obligation is clear. */
export async function setConstructionFinanceEnabled(
  db: Db,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const config = db.collection<GameConfig>("gameConfig");
  if (enabled) {
    const result = await config.updateOne(
      {
        _id: "default",
        privateBankingEnabled: true,
        treasuryCashLedgerEnabled: true,
        bankConstructionAdmissionClosing: { $ne: true },
      },
      { $set: { bankConstructionFinanceEnabled: true } }
    );
    return result.matchedCount === 1
      ? { ok: true }
      : {
          ok: false,
          error:
            "Private banking or Treasury cash accounting is disabled, or a finance disable is still running",
        };
  }
  const before = await config.findOne(
    { _id: "default" },
    {
      projection: { bankConstructionAdmissionClosing: 1, bankConstructionAdmissionClosingToken: 1 },
    }
  );
  const token = randomUUID();
  const previousBarrier =
    before?.bankConstructionAdmissionClosing === true
      ? {
          bankConstructionAdmissionClosing: true,
          bankConstructionAdmissionClosingToken: before.bankConstructionAdmissionClosingToken ?? {
            $exists: false,
          },
        }
      : { bankConstructionAdmissionClosing: { $ne: true } };
  const closing = await config.updateOne(
    {
      _id: "default",
      ...previousBarrier,
      $expr: { $eq: [{ $size: { $ifNull: ["$bankConstructionAdmissions", []] } }, 0] },
    },
    {
      $set: {
        bankConstructionAdmissionClosing: true,
        bankConstructionAdmissionClosingToken: token,
      },
    }
  );
  if (closing.matchedCount !== 1)
    return { ok: false, error: "A construction request or cash receipt is still admitted" };
  try {
    const [claims, leases] = await Promise.all([
      db.collection<CorporateSector>("corporateSectors").countDocuments({
        $or: [
          {
            "constructionFinancing.status": { $in: ["awaiting_approval", "funding", "building"] },
          },
          { "constructionFinancing.escrowLocal": { $gt: 0 } },
          { constructionPropertyTransition: { $exists: true } },
        ],
      }),
      db
        .collection<Corporation>("corporations")
        .countDocuments({ bankConstructionFunding: { $exists: true } }),
    ]);
    if (claims || leases)
      return {
        ok: false,
        error: "Finish outstanding construction claims and cash recovery before disabling finance",
      };
    const disabled = await config.updateOne(
      {
        _id: "default",
        bankConstructionAdmissionClosing: true,
        bankConstructionAdmissionClosingToken: token,
        $expr: { $eq: [{ $size: { $ifNull: ["$bankConstructionAdmissions", []] } }, 0] },
      },
      {
        $set: { bankConstructionFinanceEnabled: false },
        $unset: { bankConstructionAdmissionClosing: "", bankConstructionAdmissionClosingToken: "" },
      }
    );
    return disabled.matchedCount === 1
      ? { ok: true }
      : { ok: false, error: "Construction admission changed during disable" };
  } finally {
    await config.updateOne(
      {
        _id: "default",
        bankConstructionAdmissionClosing: true,
        bankConstructionAdmissionClosingToken: token,
      },
      {
        $unset: { bankConstructionAdmissionClosing: "", bankConstructionAdmissionClosingToken: "" },
      }
    );
  }
}

/** A killed pre-reservation request has no sector claim or bank cash lease to retain. */
export async function recoverConstructionAdmissions(db: Db, turn: number): Promise<void> {
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { bankConstructionAdmissions: 1 } });
  for (const admission of config?.bankConstructionAdmissions ?? []) {
    if (admission.turn >= turn) continue;
    const [claim, bank] = await Promise.all([
      db
        .collection<CorporateSector>("corporateSectors")
        .findOne(
          { "constructionFinancing.admissionToken": admission.token },
          { projection: { constructionFinancing: 1 } }
        ),
      db
        .collection<Corporation>("corporations")
        .findOne(
          { "bankConstructionFunding.loanId": admission.loanId },
          { projection: { _id: 1 } }
        ),
    ]);
    const state = claim?.constructionFinancing;
    if (
      !bank &&
      (!state ||
        state.fundingCleanupCompleted ||
        state.status === "cancelled" ||
        state.status === "released")
    )
      await releaseConstructionAdmission(db, admission.token);
  }
}
