/** Deterministic bounded qualification for #3915. Prints a report; writes no world data. */
import { allocateSeats } from "../../src/lib/turn/election/seatAllocation";
import { SUB_REGION_SEEDS } from "../../src/lib/referendum/secede/subRegions";
import { expandLiveRegions } from "../../src/lib/referendum/secede/rules/liveRegions";
import { SUCCESSOR_REGION_COUNCILS } from "../../src/lib/countries/ukSuccessorRegions";

const reports = (["SCO", "WAL"] as const).map((country) => {
  const seeds = SUB_REGION_SEEDS[country];
  const aggregate = {
    ...seeds[0],
    _id: country,
    countryId: "UK" as const,
    population: 7_000_001,
    gdp: 250_000,
  };
  const regions = expandLiveRegions(aggregate, seeds);
  return {
    country,
    councils: Object.values(SUCCESSOR_REGION_COUNCILS[country]).flat().length,
    populationConserved: regions.reduce((s, r) => s + r.population, 0) === aggregate.population,
    chamberSeats: regions.reduce((s, r) => s + r.houseDistricts, 0),
    regions: regions.map((r) => ({ id: r._id, seats: r.houseDistricts, population: r.population })),
    cases: [0, 20, 40, 50, 60, 80, 100].map((share) => {
      const totals = ["", "snap_"].map((prefix) => {
        let awarded = 0;
        for (const region of regions) {
          const result = allocateSeats(
            `${prefix}${country === "SCO" ? "holyrood" : "senedd"}`,
            region._id,
            region.houseDistricts,
            [
              { id: "a", votes: share, party: "a" },
              { id: "b", votes: 100 - share, party: "b" },
            ],
            100,
            undefined,
            undefined,
            undefined,
            country,
            "ams"
          );
          awarded += Object.values(result.seatsEstimate).reduce((sum, seats) => sum + seats, 0);
        }
        if (awarded !== (country === "SCO" ? 129 : 60)) throw new Error("Election seats lost");
        return { type: `${prefix}${country === "SCO" ? "holyrood" : "senedd"}`, awarded };
      });
      return { voteShare: share, totals };
    }),
  };
});
if (
  reports.some((r) => !r.populationConserved || r.chamberSeats !== (r.country === "SCO" ? 129 : 60))
)
  throw new Error("Accounting invariant failed");
console.log(
  JSON.stringify(
    {
      scope:
        "Whole council membership and model-population seat apportionment; not a full-world campaign or historical constituency reconstruction",
      reports,
    },
    null,
    2
  )
);
