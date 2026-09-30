import {
  easternBlocElectionsLive,
  ensureRegionalDelegateElections,
  seatsFromRegionField,
} from "@/lib/turn/perpetualElections/shared";
import { hu2014RegionSeats, HU_REFORM_YEAR } from "@/lib/turn/huAssemblyReform";

/** Hungary National Assembly. */
export async function ensureHUElections(now: Date, inFlightTurn?: number): Promise<void> {
  await ensureRegionalDelegateElections(
    {
      countryId: "HU",
      electionType: "nationalAssembly",
      seatsForRegions: (regions, preset, _ctx, currentYear) =>
        preset === "1991-default" &&
        currentYear >= HU_REFORM_YEAR &&
        regions.reduce((sum, region) => sum + (region.houseDistricts ?? 0), 0) !== 199
          ? hu2014RegionSeats(regions)
          : seatsFromRegionField(regions, "houseDistricts"),
      openPrimaryImmediately: true,
      statusGated: true,
      electionsLiveGate: easternBlocElectionsLive,
      label: "National Assembly",
    },
    now,
    inFlightTurn
  );
}
