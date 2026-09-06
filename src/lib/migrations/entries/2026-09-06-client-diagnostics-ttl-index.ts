import type { Db } from "mongodb";
import type { Migration } from "../types";

const INDEX_NAME = "clientDiagnostics_expiresAt_ttl";

export const migration: Migration = {
  id: "2026-09-06-client-diagnostics-ttl-index",
  description: "Expire opt-in desktop diagnostics after thirty days",
  idempotent: true,
  execute: async (db: Db, ctx) => {
    const collection = db.collection("clientDiagnostics");
    const exists = (await collection.indexes().catch(() => [])).some(
      (index) => index.name === INDEX_NAME
    );
    if (exists) return { notes: [`${INDEX_NAME} already present`] };
    if (ctx.dryRun) return { notes: [`dry run: would create ${INDEX_NAME}`] };
    await collection.createIndex({ expiresAt: 1 }, { name: INDEX_NAME, expireAfterSeconds: 0 });
    return { notes: [`created ${INDEX_NAME}`] };
  },
};
