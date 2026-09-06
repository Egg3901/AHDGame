import { getDb } from "@/lib/mongodb";
import {
  ddElectionsLive,
  ensureRegionalDelegateElections,
  ensureRegionalGovernorElections,
  seatsFromRegionField,
} from "../shared";

/**
 * DD Volkskammer — the GDR's unicameral chamber, elected as a single National
 * Front list per macro-region (1953) / Land (1979). One multi-seat regional
 * delegate election per region, seats from the live `houseDistricts`.
 *
 * The seed sums to 500, but the LIVE sum is whatever the region docs say now —
 * reunification carried ten more Laender in and the chamber grew to 693. Sizing
 * from the live docs rather than the seed total is the whole point: the shared
 * spawner forces this map onto each new cycle so a resized chamber cannot go on
 * electing to its old magnitude (#1262). Mirrors `ensureRUSupremeSovietElections`
 * — the sibling one-party command state.
 */
export async function ensureDDVolkskammerElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "DD",
      electionType: "volkskammerDeputy",
      seatsForRegions: (regions) => seatsFromRegionField(regions, "houseDistricts"),
      openPrimaryImmediately: true,
      statusGated: true,
      label: "Volkskammer",
    },
    now
  );
}

/**
 * Land First Secretaries — the shared governor family with the Volkskammer
 * anchor override (threaded via countryId in canonicalCycle, mirroring RU's
 * republic-soviet ride-along). The shared helper has no status gate, so the
 * DD wrapper adds it (the RU pattern).
 */
export async function ensureDDGovernorElections(now: Date): Promise<void> {
  const db = await getDb();
  if (!(await ddElectionsLive(db))) return;
  await ensureRegionalGovernorElections("DD", now);
}

/**
 * Land assemblies (Landtage) — each Land's authored chamber size
 * (`stateSenateSeats` on the seeded State doc). Without this family, Land
 * First Secretaries have no same-party legislature NPPs to queue state bills
 * through (ticket #1044). Mirrors `ensureRURepublicSovietElections`.
 */
export async function ensureDDLandAssemblyElections(now: Date): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "DD",
      electionType: "landAssembly",
      seatsForRegions: (regions) => seatsFromRegionField(regions, "stateSenateSeats"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: ddElectionsLive,
      label: "Landtag",
    },
    now
  );
}
