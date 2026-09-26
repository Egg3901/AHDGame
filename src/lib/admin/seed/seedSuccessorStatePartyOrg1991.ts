import type { Db } from "mongodb";
import type { PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import { SUCCESSOR_REGIONS_1991 } from "@/lib/seeds/reference/successorRegions1991";
import { SUCCESSOR_PARTIES_1991 } from "@/lib/seeds/reference/successorParties1991";

/**
 * January 1991 founding footprints. The nationally organized transition parties
 * are present in each region; Yugoslavia's republican parties are restricted to
 * their own republics. Organization strength is a scenario starting value, not
 * a claim about party membership or a regional election result.
 */
export async function seedSuccessorStatePartyOrg1991(
  db: Db,
  reset: boolean,
  preset: string,
  log: (message: string) => void
): Promise<void> {
  if (preset !== "1991-default") return;
  const countries = Object.keys(SUCCESSOR_REGIONS_1991) as (keyof typeof SUCCESSOR_REGIONS_1991)[];
  if (reset)
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .deleteMany({ countryId: { $in: countries } });
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: { $in: countries }, isDefault: true })
    .project({ countryId: 1, name: 1, sequentialId: 1 })
    .toArray();
  const now = new Date();
  let count = 0;
  for (const countryId of countries) {
    const roster = SUCCESSOR_PARTIES_1991[countryId] ?? [];
    const regions = SUCCESSOR_REGIONS_1991[countryId] ?? [];
    for (const seed of roster) {
      const party = parties.find(
        (entry) => entry.countryId === countryId && entry.name === seed.name
      );
      if (!party) throw new Error(`Missing 1991 ${countryId} party: ${seed.name}`);
      for (const region of regions) {
        if (countryId === "YU" && !yugoslavPartyPresent(seed.abbreviation, region._id)) continue;
        const strength = seed.regimeStatus === "ruling" ? 70 : 35;
        const partyId = String(party.sequentialId);
        const _id = `${region._id}_${partyId}`;
        await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
          { _id },
          {
            $set: {
              countryId,
              stateId: region._id,
              partyId,
              organization: strength,
              registration: strength,
              updatedAt: now,
              hasPresence: true,
            },
            $setOnInsert: {
              chairId: null,
              viceChairId: null,
              treasurerId: null,
              treasury: 0,
              stateTaxRate: 0,
              politicalStrength: 0,
              consecutiveLosses: 0,
              createdAt: now,
            },
          },
          { upsert: true }
        );
        count++;
      }
    }
  }
  log(`Seeded ${count} January 1991 regional party organizations`);
}

function yugoslavPartyPresent(abbreviation: string, regionId: string): boolean {
  if (abbreviation === "SRSJ") return true;
  if (abbreviation === "SPS")
    return regionId.startsWith("YU_SRB") || regionId === "YU_VOJ" || regionId === "YU_KOS";
  if (abbreviation === "HDZ") return regionId === "YU_CRO";
  if (abbreviation === "SDA") return regionId === "YU_BIH";
  if (abbreviation === "DEMOS") return regionId === "YU_SLO";
  if (abbreviation === "SKCG") return regionId === "YU_MNE";
  if (abbreviation === "VMRO-DPMNE") return regionId === "YU_MKD";
  return false;
}
