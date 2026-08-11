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
 *   5. Officials  — carry MPs over as MSPs/MSs + FM to head of government (SP2c).
 *   6. Elections  — seed the standup chamber cycle (SP2c).
 *   7. Recompute  — national metrics for rump-UK + the new country.
 *   8. History    — record a secession event for both sides.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { computeNationalMetrics } from "@/lib/nationalMetrics";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import {
  ensureSCOElections,
  ensureWALElections,
  ensureSCOGovernorElections,
  ensureWALGovernorElections,
  ensureSCORegionalCouncilElections,
  ensureWALRegionalCouncilElections,
} from "@/lib/turn/perpetualElections";
import { activateCountry } from "@/lib/country/registeredCountries";
import { CAPITAL_SUBREGION, type SecedingCountryId } from "./subRegions";
import { expandToSubRegions } from "./expandToSubRegions";
import { promoteEconomyToNational } from "./promoteEconomyToNational";
import { splitParties } from "./splitParties";
import { carryOverOfficials } from "./carryOverOfficials";

// Spawn the full devolved election slate at secession — chamber + regional
// governors + regional councils. The chamber alone is not enough: the
// governor/council turn phases only run for an already-active country, and on
// the secession turn that phase pass runs BEFORE the region activates, so they
// would otherwise not appear until the following turn.
const STANDUP_ELECTION_SPAWNERS: Record<SecedingCountryId, ((now: Date) => Promise<void>)[]> = {
  SCO: [ensureSCOElections, ensureSCOGovernorElections, ensureSCORegionalCouncilElections],
  WAL: [ensureWALElections, ensureWALGovernorElections, ensureWALRegionalCouncilElections],
};

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
  const { regionId, fromCountryId, currentTurn } = args;
  if (!isSecedingCountryId(regionId)) return { ok: false, skipped: "unsupported-region" };
  const toCountryId = regionId;

  // Guard: the region's aggregate states doc must exist; bail if already expanded.
  const aggregate = await db.collection<State>("states").findOne({ _id: regionId });
  const capital = await db
    .collection<State>("states")
    .findOne({ _id: CAPITAL_SUBREGION[toCountryId] });
  if (capital) return { ok: true, skipped: "already-seceded" };
  if (!aggregate) return { ok: false, skipped: "region-not-found" };

  // 1. Register the country at runtime.
  await activateCountry(db, toCountryId);

  // 2-3. Stand up the data + economy.
  const expanded = await expandToSubRegions(db, toCountryId);
  await promoteEconomyToNational(db, fromCountryId, toCountryId);

  // 4-5. Government: parties then officials (officials consume the split idMap).
  const split = await splitParties(db, regionId, fromCountryId, toCountryId);
  const carried = await carryOverOfficials(db, regionId, fromCountryId, toCountryId, split.idMap);

  // 6. Stand up the devolved election slate (best-effort — the turn phases
  // re-run each as a net next turn).
  const standupNow = new Date();
  for (const spawn of STANDUP_ELECTION_SPAWNERS[toCountryId]) {
    await spawn(standupNow).catch((err) =>
      console.error(`${regionId} standup election seed failed (retries next turn):`, err)
    );
  }

  // 7. Recompute rump-UK + the new country's national figures.
  await computeNationalMetrics(db).catch((err) =>
    console.error(`${regionId} secession national-metrics recompute failed:`, err)
  );

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
