import type { CountryElections } from "../contract";
import type { SpawnElectionsResult } from "@/lib/turn/perpetualElections/registry";
import { BR_SEATS_PER_REGION } from "@/lib/seeds/br/brRegions";
import { ensureBRElections, ensureBRSenateElections } from "./elections/perpetual";

/**
 * Brazil's elections.
 *
 * ⚠️ SERVER ONLY. The spawners reach `getDb`.
 *
 * ⚠️ ONE CHAMBER TABLE, AND THE SENATE'S ABSENCE IS DELIBERATE. The
 * Chamber of Deputies has a denormalised table that must agree with
 * `brRegions[*].houseDistricts`; its 513 seats are the fixed constitutional
 * allocation and were checked against the sum. The Senate has no table at all --
 * its 81 seats are `brRegions[*].stateSenateSeats`, read from the live regions,
 * the same way East Germany's Volkskammer and Russia's Soviet of the Union work.
 * A denormalised copy here would be a second source for a number the regions
 * already carry.
 */
const spawn = async (now: Date): Promise<SpawnElectionsResult> => {
  await ensureBRElections(now);
  await ensureBRSenateElections(now);
  return { message: "BR Câmara / Senate continuity check complete." };
};

export const BR_ELECTIONS: CountryElections = {
  spawn,
  seats: {
    byChamber: { camara: BR_SEATS_PER_REGION },
    totals: { camara: Object.values(BR_SEATS_PER_REGION).reduce((a, b) => a + b, 0) },
  },
};

export { ensureBRElections, ensureBRSenateElections };
