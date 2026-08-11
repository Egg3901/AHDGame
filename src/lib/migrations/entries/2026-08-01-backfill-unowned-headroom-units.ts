import type { Migration } from "../types";
import { runBackfillUnownedHeadroomUnits } from "../../../../scripts/migrations/backfillUnownedHeadroomUnits";

export const migration: Migration = {
  id: "2026-08-01-backfill-unowned-headroom-units",
  description:
    "Backfill unownedSectors.headroomUnits (derived revenue->units via default-strategy commodity mix); telemetry/groundwork only, no behavior change.",
  idempotent: true,
  execute: (db, ctx) => runBackfillUnownedHeadroomUnits(db, { dryRun: ctx.dryRun }),
};
