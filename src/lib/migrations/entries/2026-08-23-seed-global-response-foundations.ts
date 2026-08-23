import type { Migration } from "../types";
import { runSeedGlobalResponseFoundations } from "../../../../scripts/migrations/2026-08-23-seed-global-response-foundations";

export const migration: Migration = {
  id: "2026-08-23-seed-global-response-foundations",
  description:
    "Enable release 1.3 global-response campaigns and insert missing campaign, tension, doctrine, and era-scaled nuclear baseline state.",
  idempotent: true,
  execute: (db, ctx) => runSeedGlobalResponseFoundations(db, { dryRun: ctx.dryRun }),
};
