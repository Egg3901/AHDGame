import type { Migration } from "../types";
import { runCampaignOpsTrees } from "../../../../scripts/migrations/2026-08-18-campaign-ops-trees";

export const migration: Migration = {
  id: "2026-08-18-campaign-ops-trees",
  description:
    "Strategic Operations v2: convert legacy linear campaign investment levels (fundraising/oppositionResearch/groundGame/mediaSpending) into the starter + three-branch tree model, preserving purchased investment depth. Player-friendly a→b→c fill; only un-started trees are touched.",
  idempotent: true,
  execute: (db, ctx) => runCampaignOpsTrees(db, { dryRun: ctx.dryRun }),
};
