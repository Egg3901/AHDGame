/**
 * Bootstrap-time Reg/Org seeding from curated lane templates.
 *
 * Runs after every country's `statePartyOrg` rows have been seeded
 * (`runSeed` + country-specific `seed*StatePartyOrg`). For each
 * `StateRegistrationSeed` row:
 *   - Maps the seed's party `abbr` to that country's `politicalParties`
 *     `sequentialId`.
 *   - Updates the matching `statePartyOrg` row with `.organization` and
 *     `.registration` values from the seed.
 *   - Upserts a `stateRegistrationPool` row holding `.independent` and
 *     `.unregistered`.
 *
 * Preset-aware: `2019-default` (and any 2019-* variants) use the curated
 * 2019-era data in `registrationLanes.ts`; `1991-default` uses the
 * 1991-era curation in `registrationLanes1991.ts`. Unknown presets skip
 * Reg seeding entirely (`statePartyOrg.registration` stays undefined,
 * the politics turn phase is a no-op for those states until data lands).
 */

import type { Db } from "mongodb";
import { IS_NUMERIC_BSON } from "@/lib/db/numericTypeFilter";
import {
  buildAllRegistrationSeeds,
  validateSeed,
  type StateRegistrationSeed,
} from "@/lib/seeds/registration/registrationLanes";
import { build1953RegistrationSeeds } from "@/lib/seeds/registration/registrationLanes1953";
import { build1979RegistrationSeeds } from "@/lib/seeds/registration/registrationLanes1979";
import { build1991RegistrationSeeds } from "@/lib/seeds/registration/registrationLanes1991";
import { build1999RegistrationSeeds } from "@/lib/seeds/registration/registrationLanes1999";
import { build2007RegistrationSeeds } from "@/lib/seeds/registration/registrationLanes2007";
import { build2023RegistrationSeeds } from "@/lib/seeds/registration/registrationLanes2023";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalParty, StatePartyOrg, StateRegistrationPool } from "@/lib/db/types";

interface SeedResult {
  presetUsed: string;
  rowsProcessed: number;
  partyOrgRowsUpdated: number;
  poolRowsUpserted: number;
  poolRowsDeleted: number;
  warnings: string[];
}

/**
 * Resolve which Reg/Org seed bundle to apply for a given preset.
 *
 * Returns null when the preset has no curated Reg data — caller should
 * skip seeding rather than fall back to a different era's numbers, since
 * cross-era seeding produces anachronistic results
 * (e.g. 2019 Reg shares in a 1991 game).
 */
function selectSeedBundle(presetId: string): StateRegistrationSeed[] | null {
  if (presetId === "2019-default" || presetId === "empty" || presetId === "2019-no-parties") {
    return buildAllRegistrationSeeds();
  }
  if (presetId === "1953-default") {
    return build1953RegistrationSeeds();
  }
  if (presetId === "1979-default") {
    return build1979RegistrationSeeds();
  }
  if (presetId === "1991-default") {
    return build1991RegistrationSeeds();
  }
  if (presetId === "1999-default") {
    return build1999RegistrationSeeds();
  }
  if (presetId === "2007-default") {
    return build2007RegistrationSeeds();
  }
  if (presetId === "2023-default") {
    return build2023RegistrationSeeds();
  }
  return null;
}

export async function seedRegistrationLanes(
  db: Db,
  presetId: string,
  log: (msg: string) => void = () => {}
): Promise<SeedResult> {
  const result: SeedResult = {
    presetUsed: presetId,
    rowsProcessed: 0,
    partyOrgRowsUpdated: 0,
    poolRowsUpserted: 0,
    poolRowsDeleted: 0,
    warnings: [],
  };

  const bundle = selectSeedBundle(presetId);
  if (!bundle) {
    log(`seedRegistrationLanes: no curated Reg data for preset "${presetId}" — skipping`);
    return result;
  }

  // Build a per-country `abbr → sequentialId` lookup once. Parties seeded
  // via `runSeed` / country seeders have a stable `abbreviation` field.
  const allParties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
  const abbrLookup: Record<CountryId, Map<string, string>> = {
    US: new Map(),
    UK: new Map(),
    DE: new Map(),
    JP: new Map(),
    IE: new Map(),
    BR: new Map(),
    CN: new Map(),
    NG: new Map(),
    HU: new Map(),
    PL: new Map(),
    RO: new Map(),
    YU: new Map(),
    BG: new Map(),
    UKR: new Map(),
    BLR: new Map(),
    CS: new Map(),
    BAL: new Map(),
    RU: new Map(),
    FR: new Map(),
    IT: new Map(),
    ES: new Map(),
    SE: new Map(),
    TR: new Map(),
    GR: new Map(),
    AT: new Map(),
    FI: new Map(),
    DD: new Map(),
    SCO: new Map(),
    WAL: new Map(),
  };
  for (const p of allParties) {
    const map = abbrLookup[p.countryId];
    if (map && p.abbreviation) {
      map.set(p.abbreviation.toUpperCase(), String(p.sequentialId));
    }
  }

  const now = new Date();

  for (const row of bundle) {
    const validationError = validateSeed(row);
    if (validationError) {
      result.warnings.push(validationError);
    }

    result.rowsProcessed += 1;

    const countryLookup = abbrLookup[row.countryId];
    if (!countryLookup || countryLookup.size === 0) {
      result.warnings.push(
        `${row.countryId}/${row.stateId}: no political parties seeded for country — skipping row`
      );
      continue;
    }

    // Update each party's statePartyOrg row with its org+reg from the seed.
    for (const share of row.parties) {
      const sequentialId = countryLookup.get(share.abbr.toUpperCase());
      if (!sequentialId) {
        result.warnings.push(
          `${row.countryId}/${row.stateId}: party abbr "${share.abbr}" not found in DB — skipping party`
        );
        continue;
      }
      const docId = `${row.stateId}_${sequentialId}`;
      const writeResult = await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
        { _id: docId },
        {
          $set: {
            organization: share.org,
            registration: share.reg,
            updatedAt: now,
          },
        }
      );
      if (writeResult.matchedCount === 0) {
        result.warnings.push(
          `${row.countryId}/${row.stateId}: no statePartyOrg row for ${share.abbr} (${docId})`
        );
      } else {
        result.partyOrgRowsUpdated += 1;
      }
    }

    // Upsert the non-party pool row for this state. The composite `_id`
    // matches the design's documented pattern (`${countryId}_${stateId}`).
    const poolId = `${row.countryId}_${row.stateId}`;
    await db.collection<StateRegistrationPool>("stateRegistrationPool").updateOne(
      { _id: poolId },
      {
        $set: {
          countryId: row.countryId,
          stateId: row.stateId,
          independent: row.independent,
          unregistered: row.unregistered,
          lastUpdatedTurn: 0,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    result.poolRowsUpserted += 1;
  }

  // A bootstrap reset preserves this collection because the legacy core seed
  // cannot rebuild it. Reconcile the covered preset scope after upserting so
  // stale rows from an earlier bundle cannot survive (notably DC and the
  // pre-statehood AK/HI territories in a 1953 world).
  const coveredCountries = [...new Set(bundle.map((row) => row.countryId))];
  const admittedUSStates = await db
    .collection<{ _id: string; countryId?: string; admittedYear?: number }>("states")
    .find({ countryId: "US", admittedYear: IS_NUMERIC_BSON }, { projection: { _id: 1 } })
    .toArray();
  const validPoolIds = [
    ...bundle.map((row) => `${row.countryId}_${row.stateId}`),
    ...admittedUSStates.map((state) => `US_${state._id}`),
  ];
  const cleanup = await db.collection<StateRegistrationPool>("stateRegistrationPool").deleteMany({
    countryId: { $in: coveredCountries },
    _id: { $nin: validPoolIds },
  });
  result.poolRowsDeleted = cleanup.deletedCount;

  log(
    `seedRegistrationLanes (${presetId}): ${result.rowsProcessed} rows, ${result.partyOrgRowsUpdated} partyOrg updates, ${result.poolRowsUpserted} pool upserts, ${result.poolRowsDeleted} stale pool deletes, ${result.warnings.length} warning(s)`
  );
  for (const w of result.warnings.slice(0, 10)) {
    log(`  ⚠ ${w}`);
  }
  if (result.warnings.length > 10) {
    log(`  …and ${result.warnings.length - 10} more`);
  }

  return result;
}
