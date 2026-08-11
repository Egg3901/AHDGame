import type { Migration } from "../types";
import { runAdoptReferenceGameConfigGates } from "../../../../scripts/migrations/adoptReferenceGameConfigGates";

export const migration: Migration = {
  id: "2026-08-08-adopt-reference-gameconfig-gates",
  description:
    "Fill gameConfig gates the world never set from the reference config, and raise an unchosen market tier on a world still inside its first game day. Never lowers a tier; never overrides an operator's choice.",
  idempotent: true,
  execute: (db, ctx) => runAdoptReferenceGameConfigGates(db, { dryRun: ctx.dryRun }),
};
