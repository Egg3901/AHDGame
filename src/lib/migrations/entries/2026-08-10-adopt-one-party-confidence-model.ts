import type { Migration } from "../types";
import { runAdoptOnePartyConfidenceModel } from "../../../../scripts/migrations/adoptOnePartyConfidenceModel";

export const migration: Migration = {
  id: "2026-08-10-adopt-one-party-confidence-model",
  description:
    "Raise countryState.hasLeaderConfidenceModel to match config for one-party states still governed as one-party states (the DDR shipped without it). Raise-only, and skips any country that converted away, whose false is a deliberate one-way conversion result.",
  idempotent: true,
  execute: (db, ctx) => runAdoptOnePartyConfidenceModel(db, { dryRun: ctx.dryRun }),
};
