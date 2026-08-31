import type { Db } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import {
  getProjectedPoliticalLegislationTypes,
  isPoliticalLegislationPreset,
} from "./seedPoliticalLegislation";
import { isOldLegislationTypeExcluded } from "@/lib/politicalMetrics/pipelinePreset";

export async function seedLegislationTypes(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    await db
      .collection("committeeAssignments")
      .drop()
      .catch((error) => {
        logWarning("Collection drop failed (may not exist)", {
          component: "AdminSeed",
          action: "drop collection",
          metadata: { error: String(error) },
        });
      });
    await db.collection("stateBills").deleteMany({});
  }

  const collection = db.collection<LegislationType>("legislationTypes");

  const politicalLegislation = isPoliticalLegislationPreset(preset);
  const baseTypes = politicalLegislation
    ? legislationTypes.filter((t) => !isOldLegislationTypeExcluded(t))
    : legislationTypes;
  // Resolved here rather than plumbed through every caller: the projected
  // catalog must reflect the world's YEAR (era windows), and a caller that
  // forgot to pass it would silently seed laws outside their window.
  const { resolveWorldSeedYear } = await import("@/lib/era/context");
  const year = await resolveWorldSeedYear(db, preset);
  const projectedTypes = politicalLegislation ? getProjectedPoliticalLegislationTypes(year) : [];
  const seedSet = [...baseTypes, ...projectedTypes];

  // Upsert-by-_id instead of drop+insertMany (ticket #0860): a destructive
  // reseed only ever ran from the admin reset flow, so new reference entries
  // (e.g. UK agriculture/technology legislation) never reached worlds that
  // weren't reseeded after the entries were added — the changelog announced
  // them, but live worlds silently kept the old category list. Upserting
  // keeps this idempotent and safe to run against a live world at any time,
  // and still prunes any doc no longer present in the reference file so the
  // collection stays in sync with it either way.
  if (seedSet.length > 0) {
    await collection.bulkWrite(
      seedSet.map((t) => ({
        replaceOne: { filter: { _id: t._id }, replacement: t, upsert: true },
      }))
    );
  }
  // Never touch admin-authored custom types (source: "admin", created via
  // /api/admin/law-types) — the old drop()+insertMany already silently wiped
  // these on every reseed, which this fix should not carry forward.
  // The prune set is the CURRENT seed set, so on the political-legislation
  // preset the excluded old US/UK/RU/DD docs are removed and the projected
  // new-generation docs survive (generation-aware deleter, spec §6).
  await collection.deleteMany({
    _id: { $nin: seedSet.map((t) => t._id) },
    source: { $ne: "admin" },
  });

  log(
    `Seeded ${seedSet.length} legislation types (synced, non-destructive` +
      `${politicalLegislation ? `, political-legislation preset: ${projectedTypes.length} projected` : ""})`
  );
}
