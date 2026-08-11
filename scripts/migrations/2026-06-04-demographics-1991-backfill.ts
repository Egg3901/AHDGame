/**
 * 2026-06-04 — Backfill live archetype demographics to the 1991 era for all
 * playable countries (US, UK, JP, DE, IE, CN, BR).
 *
 * Context: the region "Demographics & Turnout" tab was blank for IE/CN/DE.
 * The static census donut cards are fixed in code (preset-aware registry).
 * This script fixes the OTHER half — the live `stateDemographics` collection
 * that drives the "Polling Archetypes" table and the simulation — so every
 * region's voter-group population mix reflects the 1991 preset, the same as a
 * fresh `1991-default` seed would produce.
 *
 * Idempotent by construction: the 1991 target is recomputed from the STATIC
 * source seeds via `applyEra1991DemographicAdjustments`, never from the
 * (possibly already-adjusted) live value. `applyEra1991DemographicAdjustments`
 * multiplies + renormalizes, so it is NOT safe to re-apply to a live value —
 * we always start from the canonical source array, so re-running converges.
 *
 * Scope / safety:
 *   - Updates ONLY `stateDemographics` (groups / categoryWeights / leans) and
 *     upserts the per-country `demographicCategories` doc.
 *   - Does NOT touch `stateDemographicTurnout` — preserves live GOTV /
 *     suppression turnout modifiers.
 *   - Aborts unless `gameState.preset === "1991-default"` (pass --force to
 *     override, e.g. for a staging world on a different preset).
 *
 * Usage (targets MONGODB_URI_LIVE in .env.local):
 *   npx tsx scripts/migrations/2026-06-04-demographics-1991-backfill.ts           # dry-run (no writes)
 *   npx tsx scripts/migrations/2026-06-04-demographics-1991-backfill.ts --apply   # write to LIVE
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import type { CountryId } from "@/lib/constants/countries";
import type { StateDemographics, DemographicCategory } from "@/lib/db/types";
import { applyEra1991DemographicAdjustments } from "@/lib/seeds/reference/stateDemographics1991";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

interface CountrySource {
  cc: CountryId;
  loadDemographics: () => Promise<StateDemographics[]>;
  loadCategories: () => Promise<DemographicCategory[]>;
}

const COUNTRIES: CountrySource[] = [
  {
    cc: "US",
    loadDemographics: () =>
      import("@/lib/seeds/stateDemographics").then((m) => m.stateDemographics),
    loadCategories: () =>
      import("@/lib/seeds/demographicCategories").then((m) => m.demographicCategories),
  },
  {
    cc: "UK",
    loadDemographics: () =>
      import("@/lib/seeds/uk/ukRegionDemographics").then((m) => m.ukRegionDemographics),
    loadCategories: () =>
      import("@/lib/seeds/uk/ukDemographicCategories").then((m) => m.ukDemographicCategories),
  },
  {
    cc: "JP",
    loadDemographics: () =>
      import("@/lib/seeds/jp/jpRegionDemographics").then((m) => m.jpRegionDemographics),
    loadCategories: () =>
      import("@/lib/seeds/jp/jpDemographicCategories").then((m) => m.jpDemographicCategories),
  },
  {
    cc: "DE",
    loadDemographics: () =>
      import("@/lib/seeds/de/deRegionDemographics").then((m) => m.deRegionDemographics),
    loadCategories: () =>
      import("@/lib/seeds/de/deDemographicCategories").then((m) => m.deDemographicCategories),
  },
  {
    cc: "IE",
    loadDemographics: () =>
      import("@/lib/seeds/ie/ieRegionDemographics").then((m) => m.ieRegionDemographics),
    loadCategories: () =>
      import("@/lib/seeds/ie/ieDemographicCategories").then((m) => m.ieDemographicCategories),
  },
  {
    cc: "CN",
    loadDemographics: () =>
      import("@/lib/seeds/cn/cnRegionDemographics").then((m) => m.cnRegionDemographics),
    loadCategories: () =>
      import("@/lib/seeds/cn/cnDemographicCategories").then((m) => m.cnDemographicCategories),
  },
  {
    cc: "BR",
    loadDemographics: () =>
      import("@/lib/seeds/br/brRegionDemographics").then((m) => m.brRegionDemographics),
    loadCategories: () =>
      import("@/lib/seeds/br/brDemographicCategories").then((m) => m.brDemographicCategories),
  },
];

/** Population map per group id, for comparing live vs target. */
function populationMap(d: StateDemographics): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, g] of Object.entries(d.groups ?? {})) out[id] = g?.population ?? 0;
  return out;
}

function samePopulations(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

async function main() {
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set in .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  console.log(APPLY ? "=== APPLY MODE (writing to LIVE) ===" : "=== DRY RUN (no writes) ===");

  try {
    const db = client.db();

    // Safety guard: only run against a 1991-default world.
    const gameState = await db
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    const preset = gameState?.preset ?? "(unset)";
    console.log(`gameState.preset = ${preset}`);
    if (preset !== "1991-default" && !FORCE) {
      console.error(`ABORT: preset is "${preset}", not "1991-default". Pass --force to override.`);
      return;
    }

    const demoCol = db.collection<StateDemographics>("stateDemographics");
    const catCol = db.collection<DemographicCategory>("demographicCategories");

    let grandUpdate = 0;
    let grandMatch = 0;
    let grandMissing = 0;

    for (const { cc, loadDemographics, loadCategories } of COUNTRIES) {
      const [sources, categories] = await Promise.all([loadDemographics(), loadCategories()]);

      // Ensure category docs exist (e.g. ie_/cn_/br_voterGroups).
      let catUpserts = 0;
      for (const cat of categories) {
        const { _id } = cat;
        const exists = await catCol.findOne({ _id }, { projection: { _id: 1 } });
        if (!exists) {
          catUpserts++;
          if (APPLY) {
            const { _id: cid, ...catData } = cat;
            await catCol.updateOne({ _id: cid }, { $set: catData }, { upsert: true });
          }
        }
      }

      let toUpdate = 0;
      let matched = 0;
      let missing = 0;
      const sampleDiffs: string[] = [];

      for (const raw of sources) {
        const target = applyEra1991DemographicAdjustments(raw, cc);
        const live = await demoCol.findOne({ _id: target._id, countryId: cc });

        if (!live) {
          missing++;
        } else if (samePopulations(populationMap(live), populationMap(target))) {
          matched++;
          continue; // already 1991 — nothing to write
        } else {
          toUpdate++;
          if (sampleDiffs.length < 2) {
            const lp = populationMap(live);
            const tp = populationMap(target);
            const changed = Object.keys(tp)
              .filter((k) => (lp[k] ?? 0) !== tp[k])
              .slice(0, 4)
              .map((k) => `${k} ${lp[k] ?? 0}→${tp[k]}`)
              .join(", ");
            sampleDiffs.push(`    ${target._id}: ${changed}`);
          }
        }

        // Reaches here only for `toUpdate` or `missing` rows (matched rows
        // `continue` above). Upsert the 1991 target; turnout is left untouched.
        if (APPLY) {
          const { _id, ...demoData } = target;
          await demoCol.updateOne({ _id }, { $set: demoData }, { upsert: true });
        }
      }

      grandUpdate += toUpdate;
      grandMatch += matched;
      grandMissing += missing;

      console.log(
        `${cc}: ${sources.length} regions — ${matched} already-1991, ${toUpdate} to update, ${missing} missing-in-live` +
          (catUpserts ? `, ${catUpserts} category doc(s) ${APPLY ? "upserted" : "missing"}` : "")
      );
      for (const s of sampleDiffs) console.log(s);
    }

    console.log(
      `\nTotal: ${grandMatch} already-1991, ${grandUpdate} to update, ${grandMissing} missing-in-live.`
    );
    if (!APPLY) {
      console.log("DRY RUN complete — no writes. Re-run with --apply to commit to LIVE.");
    } else {
      console.log("APPLY complete — stateDemographics backfilled to 1991 (turnout left intact).");
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
