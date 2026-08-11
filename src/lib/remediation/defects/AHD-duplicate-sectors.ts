// AHD-duplicate-sectors: cross-border sectors stamped with the owner's HQ
// country instead of the country they operate in.
//
// Legacy cross-border expansion rows carried `corporateSectors.countryId` from
// the owning corporation's HQ rather than from the authoritative state record.
// A later hostile takeover then created a PARALLEL sector for the same
// (corporation, state, type), because the location key disagreed.
//
// Half A (code): sector creation derives countryId from the state.
// Half B (this heal): normalise stamped countryId from the state record, then
// merge the duplicate rows into one keeper.
//
// The merge is the dangerous half and the reason this defect declares a tight
// cap. Under PLANTS the losing rows carry built capacity and in-flight build
// orders that must be folded into the keeper before deletion, which
// normalizeAndMergeCorporateSectors does behind a mode gate. The gate is not
// cosmetic: under CAPITAL mode sectorTurn owns capitalStock and re-derives it
// from revenue every turn, so folding there would double it.
//
// The heal itself lives in src/lib/corporations/repairDuplicateSectors.ts and
// is also exposed at POST /api/admin/heal/duplicate-sectors. This entry adds
// what that route never had: a detector, a dry run, a snapshot and an audit
// row.

import type { Db } from "mongodb";
import type { CorporateSector, State } from "@/lib/db/types";
import {
  buildSectorStateCountryMap,
  getCorporateSectorLocationKey,
  getSectorOperatingCountryId,
} from "@/lib/corporations/sectorLocation";
import { normalizeAndMergeCorporateSectors } from "@/lib/corporations/repairDuplicateSectors";
import type { Defect, DetectResult, HealPlan, HealResult, VerifyResult } from "../types";

interface Survey {
  /** Sectors whose stamped countryId disagrees with their state's country. */
  misstamped: Array<{ id: string; stateId: string; from: string; to: string }>;
  /** Groups sharing a location key, i.e. genuine duplicates. */
  duplicateGroups: Array<{
    key: string;
    keeperId: string;
    duplicateIds: string[];
    stateId: string;
    sectorType: string;
  }>;
}

async function survey(db: Db): Promise<Survey> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({})
    .sort({ createdAt: 1 })
    .toArray();
  const states = await db
    .collection<State>("states")
    .find({}, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const stateCountryByStateId = buildSectorStateCountryMap(states);

  const misstamped: Survey["misstamped"] = [];
  for (const sector of sectors) {
    const operating = getSectorOperatingCountryId(sector, stateCountryByStateId);
    if (sector.countryId === operating) continue;
    misstamped.push({
      id: sector._id.toString(),
      stateId: sector.stateId,
      from: sector.countryId,
      to: operating,
    });
  }

  // Group on the POST-normalisation key, exactly as the heal does — grouping on
  // the current stamped country would miss the duplicates the normalisation is
  // about to create collisions between.
  const groups = new Map<string, CorporateSector[]>();
  for (const sector of sectors) {
    const key = getCorporateSectorLocationKey(sector, stateCountryByStateId);
    const group = groups.get(key) ?? [];
    group.push(sector);
    groups.set(key, group);
  }

  const duplicateGroups: Survey["duplicateGroups"] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const [keeper, ...duplicates] = group;
    duplicateGroups.push({
      key,
      keeperId: keeper._id.toString(),
      duplicateIds: duplicates.map((sector) => sector._id.toString()),
      stateId: keeper.stateId,
      sectorType: keeper.sectorType,
    });
  }

  return { misstamped, duplicateGroups };
}

function touchedIds(result: Survey): string[] {
  const ids = new Set<string>();
  for (const row of result.misstamped) ids.add(row.id);
  for (const group of result.duplicateGroups) {
    ids.add(group.keeperId);
    for (const id of group.duplicateIds) ids.add(id);
  }
  return [...ids];
}

async function detect(db: Db): Promise<DetectResult> {
  const result = await survey(db);
  const droppedRows = result.duplicateGroups.reduce((sum, g) => sum + g.duplicateIds.length, 0);

  return {
    affected: touchedIds(result).length,
    sample: [
      ...result.misstamped.slice(0, 5).map((row) => ({ kind: "misstamped", ...row })),
      ...result.duplicateGroups.slice(0, 5).map((group) => ({
        kind: "duplicate-group",
        stateId: group.stateId,
        sectorType: group.sectorType,
        rows: group.duplicateIds.length + 1,
      })),
    ],
    notes: [
      `${result.misstamped.length} sector(s) stamped with the wrong country`,
      `${result.duplicateGroups.length} duplicate group(s), ${droppedRows} row(s) to be merged away`,
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const result = await survey(db);
  const ids = touchedIds(result);
  const droppedRows = result.duplicateGroups.reduce((sum, g) => sum + g.duplicateIds.length, 0);

  return {
    affected: ids.length,
    touched: [{ collection: "corporateSectors", ids }],
    // Revenue and workers are SUMMED into the keeper and margin is
    // revenue-weighted, so the merge conserves both. Under plants the capacity
    // fold is likewise additive.
    moneyDelta: 0,
    summary:
      `restamp ${result.misstamped.length} sector(s) from the state record and merge ` +
      `${result.duplicateGroups.length} duplicate group(s) (${droppedRows} row(s) deleted)`,
    notes: [
      ...result.misstamped
        .slice(0, 10)
        .map((row) => `restamp ${row.stateId}: ${row.from} -> ${row.to}`),
      ...result.duplicateGroups
        .slice(0, 10)
        .map((g) => `merge ${g.stateId}/${g.sectorType}: ${g.duplicateIds.length + 1} rows -> 1`),
    ],
    payload: result,
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: { now: Date }): Promise<HealResult> {
  const outcome = await normalizeAndMergeCorporateSectors(db, ctx.now);
  const deleted = outcome.mergedGroups.reduce((sum, group) => sum + (group.count - 1), 0);

  return {
    documentsScanned: healPlan.affected,
    documentsUpdated: outcome.normalizedSectors.length + outcome.mergedGroups.length,
    documentsDeleted: deleted,
    notes: [
      `restamped ${outcome.normalizedSectors.length} sector(s)`,
      `merged ${outcome.mergedGroups.length} group(s), deleting ${deleted} row(s)`,
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const result = await survey(db);
  const remaining = touchedIds(result).length;
  return {
    ok: remaining === 0,
    remaining,
    notes:
      remaining === 0
        ? ["every sector's countryId matches its state, and no location key has two rows"]
        : [
            `${result.misstamped.length} still misstamped, ${result.duplicateGroups.length} duplicate group(s) remain`,
          ],
  };
}

export const defect: Defect = {
  id: "AHD-duplicate-sectors",
  title: "Cross-border corporate sectors stamped with HQ country, producing duplicate rows",
  severity: "P1",
  // 3abeb353f "prevent duplicate cross-border sectors" (PR #1230) added
  // sectorLocation.ts, so a sector's country is derived from the authoritative
  // state record rather than the owner's HQ. A build older than this still
  // stamps the HQ country and will recreate both the misstamp and the parallel
  // row on the next cross-border expansion.
  codeFix: {
    pr: 1230,
    mergedTo: "master",
    requiredCommit: "3abeb353f",
  },
  // Checked 2026-08-08. Both halves of this defect are runtime-only:
  //   duplicates — the sovereign-issuer seeder upserts on
  //     {corporationId, stateId, sectorType}, so re-seeding overwrites rather
  //     than adding a parallel row.
  //   misstamps  — generateCountryOwnedSeedData builds each sector with the
  //     same countryId it used to filter the states, so a seeded sector's
  //     country always matches its state by construction. The seed has no
  //     cross-border expansion, which is the only thing that creates the
  //     HQ-vs-operating divergence.
  seedFix: {
    status: "not-needed",
    files: ["src/lib/seeds/reference/budgets.ts"],
    note: "seed upserts on (corp, state, type) and derives countryId from the same filter as the states; no cross-border sectors are seeded",
  },
  envs: ["dev", "sandbox", "prod"],
  idempotent: true,
  // Tight cap on purpose: this heal DELETES rows carrying capacity, so a run
  // touching thousands of sectors is a signal that something else is wrong.
  guards: ["turn-lock-free", "max-affected:1000"],
  detect,
  plan,
  apply,
  verify,
};
