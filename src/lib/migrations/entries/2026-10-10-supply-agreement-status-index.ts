import type { Db } from "mongodb";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-10-supply-agreement-status-index",
  description:
    "Index the corporation turn's live supply contract load and expiry sweep: supplyAgreements by status and expiry.",
  idempotent: true,
  async execute(db: Db, ctx) {
    if (!ctx.dryRun) {
      await db
        .collection("supplyAgreements")
        .createIndex(
          { status: 1, expiresAtTurn: 1 },
          { name: "supplyAgreements_status_expiresAtTurn", background: true }
        );
    }
    return {
      documentsScanned: 0,
      documentsUpdated: ctx.dryRun ? 0 : 1,
      notes: [
        `${ctx.dryRun ? "would create" : "created/verified"} supplyAgreements.supplyAgreements_status_expiresAtTurn`,
      ],
    };
  },
};
