import type { Db } from "mongodb";
import type { StatePartyOrg } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  EASTERN_BLOC_STATE_PARTY_ORG,
  easternBlocOrgEra,
} from "@/lib/seeds/shared/easternBlocStatePartyOrg";

/**
 * Regional party-organisation seeder for the six Warsaw-Pact satellites and the
 * three Soviet union republics that are modelled as their own countries
 * (PL/HU/RO/BG/CS/YU + UKR/BLR/BAL).
 *
 * The USSR, the GDR and China each have a bespoke seeder because each runs a
 * different party structure — a single all-union party, a five-party National
 * Front, and an advisory-party system respectively. The satellites are the
 * simple case: one ruling communist party per country, so they share this one.
 *
 * Without these rows the satellites' ruling parties had NO `statePartyOrg`
 * entries at all, which leaves `registration` unset and drops them to the
 * newcomer baseline in the swing-flow engine's §7.3.2 defense — the PZPR would
 * be ~20%-peelable in its own industrial heartland.
 *
 * Era-gated: these are Cold-War structures, so the seeder no-ops in 1991/2019
 * exactly like `seedEasternBlocCountry` (refs #3269).
 */
export async function seedEasternBlocStatePartyOrg(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset?: string
): Promise<void> {
  const activePreset =
    preset ?? (await db.collection("gameState").findOne({}))?.preset ?? "1953-default";

  const { isEasternBlocEra } = await import("@/lib/seeds/presetSelector");
  if (!isEasternBlocEra(activePreset)) {
    log(`Skipping Eastern-bloc state party org seed — not a Cold-War era (preset ${activePreset})`);
    return;
  }

  const era = easternBlocOrgEra(activePreset);
  const countryIds = Object.keys(EASTERN_BLOC_STATE_PARTY_ORG) as CountryId[];

  if (reset) {
    await db.collection("statePartyOrg").deleteMany({ countryId: { $in: countryIds } });
  }

  const now = new Date();
  let upserted = 0;
  let total = 0;

  for (const countryId of countryIds) {
    const profile = EASTERN_BLOC_STATE_PARTY_ORG[countryId];
    const orgByRegion = profile.org[era];

    for (const [regionId, organization] of Object.entries(orgByRegion)) {
      const row: Omit<StatePartyOrg, "createdAt" | "updatedAt"> = {
        _id: `${regionId}_${profile.seqId}`,
        countryId,
        stateId: regionId,
        partyId: profile.seqId,
        organization,
        // Mirrors `organization` — `regByParty` is what gates §7.3.2 defense.
        registration: organization,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: profile.treasury[era],
        stateTaxRate: profile.stateTaxRate,
        politicalStrength: 0,
        hasPresence: true,
        consecutiveLosses: 0,
      };
      const { _id, ...orgData } = row;
      const result = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne(
          { _id },
          { $set: { ...orgData, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        );
      if (result.upsertedCount > 0) upserted++;
      total++;
    }
  }

  log(
    `Seeded ${total} Eastern-bloc satellite state party org entries across ${countryIds.length} countries ` +
      `(${upserted} new, ${total - upserted} updated) [preset: ${activePreset}]`
  );
}
