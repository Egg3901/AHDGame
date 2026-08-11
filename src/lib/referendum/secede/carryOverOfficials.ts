/**
 * Carry the seceding region's sitting officials into the new country's government:
 *
 *  - Westminster MPs whose seat is in the region (`officeType: "commons"`) become
 *    members of the new lower chamber (`holyrood`/`senedd`), keeping their
 *    character + seat metadata; their party is remapped per the split `idMap`
 *    (non-major → independent), matching `splitParties`' member re-party.
 *  - The region's devolved First Minister (`officeType: "governor"`) becomes the
 *    new country's head of government (`firstMinister` + `governmentFormations`).
 *
 * Remaining chamber seats fill via the election engine (the standup spawners).
 * Runs AFTER `splitParties` (consumes its `idMap`). Idempotent: region MPs no
 * longer match `officeType: "commons"` once carried, so a re-run is a no-op.
 */
import type { Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import type { SecedingCountryId } from "./subRegions";

export interface CarryOverOfficialsResult {
  msps: number;
  headOfGov: 0 | 1;
}

function remapParty(party: string | undefined, idMap: Record<number, number>): string {
  const mapped = idMap[Number(party)];
  return mapped != null ? String(mapped) : "independent";
}

export async function carryOverOfficials(
  db: Db,
  regionId: string,
  fromCountryId: CountryId,
  toCountryId: SecedingCountryId,
  idMap: Record<number, number>
): Promise<CarryOverOfficialsResult> {
  const now = new Date();
  const lowerKey = getCountryConfig(toCountryId).legislature.lowerChamber?.key ?? "lowerHouse";
  const officials = db.collection<ElectedOfficial>("electedOfficials");

  // 1. Region MPs → new lower-chamber members (party remapped).
  const mps = await officials
    .find({ countryId: fromCountryId, officeType: "commons", state: regionId })
    .toArray();
  for (const mp of mps) {
    await officials.updateOne(
      { _id: mp._id },
      {
        $set: {
          countryId: toCountryId,
          officeType: lowerKey,
          party: remapParty(mp.party, idMap),
          updatedAt: now,
        },
      }
    );
  }

  // 2. Devolved First Minister → head of government.
  const fm = await officials.findOne({
    countryId: fromCountryId,
    officeType: "governor",
    state: regionId,
  });
  let headOfGov: 0 | 1 = 0;
  if (fm) {
    const governingPartyId = remapParty(fm.party, idMap);
    await officials.updateOne(
      { _id: fm._id },
      {
        $set: {
          countryId: toCountryId,
          officeType: "firstMinister",
          party: governingPartyId,
          updatedAt: now,
        },
      }
    );
    if (fm.characterId) {
      // Stand up a FORMED government so the new country resolves a head of
      // government immediately. The canonical field the parliamentary system
      // reads is `pmCharacterId` (NOT `headOfGovernmentCharacterId`) + a
      // "formed" status; the per-turn seat phase backfills the seat tallies.
      await db.collection<ParliamentaryGovernment>("governmentFormations").updateOne(
        { _id: toCountryId },
        {
          $set: {
            countryId: toCountryId,
            cycle: 1,
            status: "formed",
            formationType: "majority",
            pmCharacterId: fm.characterId,
            ...(fm.characterName ? { pmName: fm.characterName } : {}),
            governingPartyId,
            formedAt: now,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
          $unset: { headOfGovernmentCharacterId: "" },
        },
        { upsert: true }
      );
    }
    headOfGov = 1;
  }

  return { msps: mps.length, headOfGov };
}
