import { refundConversionConstruction } from "../refundConversionConstruction";
import { updateParliamentaryGovernmentSeats } from "@/lib/turn/parliamentaryGovernment";
import { withSessionDb, afterCommit, unboundDb } from "@/lib/db/sessionDb";
/**
 * Atomic driver that stands a seceding UK region up as a sovereign country
 * (Scotland / Wales). Composes the SP2b + SP2c steps in dependency order,
 * recomputes both countries' national figures, and records a country-history
 * event for each side. Idempotent — re-firing on an already-seceded region is a
 * no-op.
 *
 * Order matters:
 *   1. Activate   — register the country at runtime (SP2a; no COUNTRY_ORDER edit).
 *   2. Expand     — insert the sub-regions + fan the aggregate's data out, re-home
 *                   residents/devolved artifacts to the capital (SP2b).
 *   3. Economy    — stand up the federal budget from the region's GDP share +
 *                   split treasury/debt (SP2b).
 *   4. Parties    — reconcile region parties to the configured majors (SP2c).
 *   5. Officials  — retire departing mandates + retain FM as head of government (SP2c).
 *   6. Elections  — seed the standup chamber cycle (SP2c).
 *   7. Recompute  — national metrics for rump-UK + the new country.
 *   8. History    — record a secession event for both sides.
 */
import { convertLawPrograms } from "../conversionPrograms";
import { ObjectId } from "mongodb";
import { standupElections } from "./standupElections";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { computeNationalMetrics } from "@/lib/nationalMetrics";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { activateCountry } from "@/lib/country/registeredCountries";
import { CAPITAL_SUBREGION, type SecedingCountryId } from "./subRegions";
import { expandToSubRegions } from "./expandToSubRegions";
import { promoteEconomyToNational } from "./promoteEconomyToNational";
import { splitParties } from "./splitParties";
import { carryOverOfficials } from "./carryOverOfficials";
import { promoteResetV2ForIndependence } from "./promoteResetV2";

export interface SecedeRegionArgs {
  regionId: string;
  fromCountryId: CountryId;
  currentTurn: number;
}

export interface SecedeRegionResult {
  ok: boolean;
  skipped?: "already-seceded" | "region-not-found" | "unsupported-region";
  report?: {
    split: { wholesale: number; independentized: number };
    carried: { msps: number; headOfGov: 0 | 1 };
    inserted: number;
  };
}

function isSecedingCountryId(id: string): id is SecedingCountryId {
  return id === "SCO" || id === "WAL";
}

export async function secedeRegion(db: Db, args: SecedeRegionArgs): Promise<SecedeRegionResult> {
  return withSessionDb(db, (transactionDb) =>
    secedeRegionInTransaction(transactionDb, args, unboundDb(db))
  );
}

async function secedeRegionInTransaction(
  db: Db,
  args: SecedeRegionArgs,
  originalDb: Db
): Promise<SecedeRegionResult> {
  const { regionId, fromCountryId, currentTurn } = args;
  if (!isSecedingCountryId(regionId)) return { ok: false, skipped: "unsupported-region" };
  const toCountryId = regionId;

  // Guard: the region's aggregate states doc must exist; bail if already expanded.
  const aggregate = await db.collection<State>("states").findOne({ _id: regionId });
  const capital = await db
    .collection<State>("states")
    .findOne({ _id: CAPITAL_SUBREGION[toCountryId] });
  if (capital) {
    await promoteResetV2ForIndependence(db, toCountryId, currentTurn);
    return { ok: true, skipped: "already-seceded" };
  }
  if (!aggregate) return { ok: false, skipped: "region-not-found" };

  await refundConversionConstruction(db, regionId, currentTurn);

  // 1. Register the country at runtime.
  await activateCountry(db, toCountryId);

  const oldRaces = await db
    .collection("elections")
    .find(
      { countryId: fromCountryId, state: regionId, status: { $in: ["active", "upcoming"] } },
      { projection: { _id: 1 } }
    )
    .toArray();
  const electionIds = oldRaces.map((row) => row._id);
  await db.collection("electionCandidates").deleteMany({ electionId: { $in: electionIds } });
  await db.collection("elections").deleteMany({ _id: { $in: electionIds } });

  // 2-3. Stand up the data + economy.
  const expanded = await expandToSubRegions(db, toCountryId);
  await promoteEconomyToNational(db, fromCountryId, toCountryId, currentTurn);
  await promoteResetV2ForIndependence(db, toCountryId, currentTurn);

  await convertLawPrograms(db, { regionId, countryId: toCountryId, independent: true });

  // 4-5. Government: parties then officials (officials consume the split idMap).
  const split = await splitParties(db, regionId, fromCountryId, toCountryId);
  const carried = await carryOverOfficials(db, regionId, fromCountryId, toCountryId, split.idMap);

  await updateParliamentaryGovernmentSeats(db, fromCountryId);
  await standupElections(db, toCountryId, currentTurn, new Date());
  await db.collection("organizationMemberships").updateOne(
    { organizationId: "UN", countryId: toCountryId },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        organizationId: "UN",
        countryId: toCountryId,
        status: "active",
        joinedAt: new Date(),
        joinedTurn: currentTurn,
      },
    },
    { upsert: true }
  );

  await afterCommit(db, async () => {
    // 7. Recompute rump-UK + the new country's national figures.
    await computeNationalMetrics(originalDb).catch((err) =>
      console.error(`${regionId} secession national-metrics recompute failed:`, err)
    );
  });

  // 8. Country-history events for both sides.
  const details = { regionId, fromCountryId, toCountryId };
  await recordCountryEvent(db, {
    countryId: fromCountryId,
    turn: currentTurn,
    eventType: "region_seceded",
    title: `${regionId} secedes from ${fromCountryId}`,
    details,
  }).catch((err) => console.error(`${regionId} secession history (from) failed:`, err));
  await recordCountryEvent(db, {
    countryId: toCountryId,
    turn: currentTurn,
    eventType: "region_seceded",
    title: `${regionId} becomes an independent country`,
    details,
  }).catch((err) => console.error(`${regionId} secession history (to) failed:`, err));

  return {
    ok: true,
    report: {
      split: {
        wholesale: split.wholesale,
        independentized: split.independentized,
      },
      carried,
      inserted: expanded.inserted,
    },
  };
}
