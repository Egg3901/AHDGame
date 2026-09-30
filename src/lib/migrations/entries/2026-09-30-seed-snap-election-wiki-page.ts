import type { Migration } from "../types";
import { runSeedSnapElectionWikiPage } from "../../../../scripts/migrations/2026-09-30-seed-snap-election-wiki-page";

export const migration: Migration = {
  id: "2026-09-30-seed-snap-election-wiki-page",
  description:
    "Insert the canonical Snap Elections wiki seed when the page is missing, without changing an existing page.",
  idempotent: true,
  execute: (db, ctx) => runSeedSnapElectionWikiPage(db, { dryRun: ctx.dryRun }),
};
