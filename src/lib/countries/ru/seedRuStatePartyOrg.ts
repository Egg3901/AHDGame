import type { Db } from "mongodb";
import type { StatePartyOrg } from "@/lib/db/types";
import { getRuRegionOrg, getRuPartyTreasury } from "@/lib/seeds/ru/ruStatePartyOrgCalculations";
import { getGameStatePreset } from "@/lib/db/collections/gameState";

/**
 * Soviet Union state party organization seeder (spec §5.1).
 *
 * The USSR is a single-party state — the Communist Party of the Soviet Union
 * (CPSU, sequentialId "1", seeded first) is the only party with regional
 * organization; there are no advisory minor parties (unlike CN's CPPCC
 * framework).
 *
 * `registration` mirrors `organization` per row — the swing-flow engine's
 * `regByParty` map is what gates §7.3.2 defense. Without seeded registration,
 * the CPSU would be 20%-peelable (newcomer baseline) under
 * `transferableShare` / `persuasionResistance`. The shared
 * `seedRegistrationLanes` pipeline only covers US / UK / JP / DE, so RU sets
 * `registration` inline here (the CN precedent).
 *
 * Era-specific org tables live in ruStatePartyOrgCalculations.ts — near-total
 * penetration in the RSFSR core, visibly weaker in the recently-annexed
 * western republics early on.
 */

const RU_REGION_IDS = [
  "CEN",
  "NWR",
  "NOR",
  "CBE",
  "VOL",
  "NCA",
  "URA",
  "WSB",
  "ESB",
  "FEA",
  "KAZ",
  "TRA",
  "CAS",
  "MOL",
];

const CPSU_SEQ_ID = "1";
const CPSU_STATE_TAX_RATE = 5;

export async function seedRuStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
): Promise<void> {
  const activePreset = preset ?? (await getGameStatePreset(db)) ?? "1953-default";

  // The CPSU + USSR only exist in the Cold-War (1953/1979) eras — RU regions are
  // era-gated the same way in bootstrapGameWorld, and the successor Russian
  // Federation owns this landmass in 1991/2019. Without this guard the CPSU's
  // regional org would seed for Soviet-era region ids that no longer exist,
  // leaving orphaned communist rosters in a post-Soviet world (refs #3269).
  const { isEasternBlocEra } = await import("@/lib/seeds/presetSelector");
  if (!isEasternBlocEra(activePreset)) {
    log(
      `Skipping RU state party org seed — CPSU only exists in Soviet eras (preset ${activePreset})`
    );
    return;
  }

  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId: "RU" });
  }

  const regionOrg = getRuRegionOrg(activePreset);
  const treasury = getRuPartyTreasury(activePreset);
  const now = new Date();
  const orgs: Omit<StatePartyOrg, "createdAt" | "updatedAt">[] = [];

  for (const regionId of RU_REGION_IDS) {
    const orgRow = regionOrg[regionId];
    if (!orgRow) {
      throw new Error(`RU seed: missing regionOrg entry for region ${regionId}`);
    }

    orgs.push({
      _id: `${regionId}_${CPSU_SEQ_ID}`,
      countryId: "RU",
      stateId: regionId,
      partyId: CPSU_SEQ_ID,
      organization: orgRow.cpsu,
      registration: orgRow.cpsu,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      treasury: treasury.cpsu,
      stateTaxRate: CPSU_STATE_TAX_RATE,
      politicalStrength: 0,
      hasPresence: true,
      consecutiveLosses: 0,
    });
  }

  let upserted = 0;
  for (const org of orgs) {
    const { _id, ...orgData } = org;
    const result = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id },
        { $set: { ...orgData, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
    if (result.upsertedCount > 0) upserted++;
  }

  log(
    `Seeded ${orgs.length} RU state party org entries (${upserted} new, ${orgs.length - upserted} updated) [preset: ${activePreset}]`
  );
}
