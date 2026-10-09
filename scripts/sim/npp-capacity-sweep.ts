/** Deterministic recruitment-capacity sweep for the 1991 US and UK worlds. */
import assert from "node:assert/strict";
import { states1991 } from "../../src/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "../../src/lib/countries/uk/data/ukRegions1991";
import { calculateNppCeiling, calculatePartyNppCapacity } from "../../src/lib/npp/partyCapacity";
import { calculateRecruitmentSlots } from "../../src/lib/npp/recruitment";

const report = [
  { country: "US", regions: states1991.length },
  { country: "UK", regions: ukRegions1991.length },
].map(({ country, regions }) => {
  const ceiling = calculateNppCeiling(regions);
  const rows = [1, 5, 10, 20, 40, 100, 133, 136, 200].map((members) => ({
    members,
    before: calculatePartyNppCapacity(members, Math.max(25, regions * 3)),
    after: calculatePartyNppCapacity(members, ceiling),
  }));
  for (let members = 0; members <= 200; members++) {
    const capacity = calculatePartyNppCapacity(members, ceiling);
    assert(capacity >= calculatePartyNppCapacity(members, Math.max(25, regions * 3)));
    assert(capacity <= ceiling);
    assert(capacity >= calculatePartyNppCapacity(Math.max(0, members - 1), ceiling));
  }
  const localSlots = calculateRecruitmentSlots(50);
  assert.equal(localSlots, 6);
  assert.equal(ceiling, regions * localSlots);
  assert.equal(calculatePartyNppCapacity(200, ceiling), ceiling);
  return { country, regions, ceiling, localSlots, rows };
});
assert.equal(report[0].ceiling / report[0].regions, report[1].ceiling / report[1].regions);
console.log(JSON.stringify({ kind: "deterministic-capacity-sweep", report }, null, 2));
