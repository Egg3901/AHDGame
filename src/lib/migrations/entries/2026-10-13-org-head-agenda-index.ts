import type { Migration } from "../types";

/** Create the same agenda-pool identity guard on existing worlds as bootstrap. */
export const migration: Migration = {
  id: "2026-10-13-org-head-agenda-index",
  description: "Unique identity for each organisation head's agenda action pool.",
  idempotent: true,
  async execute(db, ctx) {
    if (!ctx.dryRun)
      await db
        .collection("orgHeadAgendaActions")
        .createIndex(
          { organizationId: 1, characterId: 1 },
          { unique: true, name: "orgHeadAgendaActions_org_character" }
        );
    return {
      documentsScanned: 0,
      documentsUpdated: ctx.dryRun ? 0 : 1,
      notes: [
        `${ctx.dryRun ? "would create" : "created/verified"} orgHeadAgendaActions_org_character`,
      ],
    };
  },
};
