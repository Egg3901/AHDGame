import { POLITICAL_MEDIA_ORDER_INDEXES } from "@/lib/politicalMedia/indexes";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-04-political-media-order-indexes",
  description: "Indexes for bounded political media order servicing and replay reads.",
  idempotent: true,
  async execute(db, ctx) {
    const notes: string[] = [];
    let created = 0;
    for (const index of POLITICAL_MEDIA_ORDER_INDEXES) {
      const label = `${index.collection}.${index.options.name}`;
      if (ctx.dryRun) {
        notes.push(`would create ${label}`);
        continue;
      }
      await db.collection(index.collection).createIndex(index.keys, index.options);
      created += 1;
      notes.push(`created/verified ${label}`);
    }
    return {
      documentsScanned: POLITICAL_MEDIA_ORDER_INDEXES.length,
      documentsUpdated: created,
      notes,
    };
  },
};
