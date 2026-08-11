// Performance indexes (compound indexes on hot read paths from the
// 2026-04-03 perf audit). Wraps scripts/migrations/add-perf-indexes.ts
// so the framework can run/verify it via `npm run migrate`.
//
// Idempotent: createIndex with a stable name is a no-op when the index
// already exists.

import type { Migration } from "../types";
import { runAddPerfIndexes } from "../../../../scripts/migrations/add-perf-indexes";

export const migration: Migration = {
  id: "add-perf-indexes",
  description:
    "Compound indexes on bills, notifications, elections, NPPs, characters, mail (perf-audit 2026-04-03).",
  idempotent: true,
  execute: async (db, ctx) => runAddPerfIndexes(db, { dryRun: ctx.dryRun }),
};
