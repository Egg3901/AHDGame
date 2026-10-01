import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { russianAssemblySeatingRuntimeScenario } from "./testing/assemblySeatingRuntimeScenario";
import { materializeRussianAssemblySeating } from "./assemblySeating";
import { materializeRussianDumaConvocationOpening as open } from "./dumaConvocationOpening";
import { loadRussianDumaAuthority, loadCurrentRussianDumaClock } from "./dumaConvocationAuthority";
import type { CountryGameState } from "@/lib/db/types";
async function fixture() {
  const f = russianAssemblySeatingRuntimeScenario();
  await materializeRussianAssemblySeating(f.input);
  for (const state of f.mem.collection("states").docs) {
    state.population = 1000000;
    state.votingEligiblePopulation = 700000;
  }
  return {
    ...f,
    next: {
      ...f.input,
      turn: 225,
      game: { preset: "1991-default" },
      cohortId: new ObjectId(),
      electionIds: Array.from({ length: 226 }, () => new ObjectId()),
    },
  };
}
describe("ordinary Duma opening authority", () => {
  it("opens both tiers at the term boundary while retaining first roots, offices and money", async () => {
    const f = await fixture();
    const before = structuredClone(f.mem.collection("electedOfficials").docs);
    const people = structuredClone(f.mem.collection("npps").docs);
    expect(await open(f.next)).toMatchObject({ created: true, number: 2 });
    const country = f.mem.collection("countryGameStates").docs[0] as unknown as CountryGameState;
    expect(country.ruFirstDumaElectionCohortId).toEqual(f.dumaRoot);
    expect(country.ruFirstCouncilElectionCohortId).toEqual(f.councilRoot);
    expect(f.mem.collection("electedOfficials").docs).toEqual(before);
    expect(f.mem.collection("npps").docs).toEqual(people);
    const ballots = f.mem.collection("elections").docs.filter((row) => row.cycle === 2);
    expect(ballots).toHaveLength(226);
    expect(ballots.every((row) => row.endTurn === 237)).toBe(true);
    expect(
      await loadRussianDumaAuthority({ db: f.input.db, country, root: f.next.cohortId, turn: 225 })
    ).toMatchObject({ number: 2, record: { termEndTurn: 429 } });
    expect(await loadCurrentRussianDumaClock({ db: f.input.db, country, turn: 225 })).toMatchObject(
      { number: 1, termEndTurn: 237 }
    );
    expect(await open({ ...f.next, cohortId: new ObjectId() })).toMatchObject({
      cohortId: f.next.cohortId,
      created: false,
    });
    expect(f.mem.collection("elections").docs.filter((row) => row.cycle === 2)).toHaveLength(226);
  });
  it("does not open early or behind an unresolved current-family ballot", async () => {
    const f = await fixture();
    expect(await open({ ...f.next, turn: 224 })).toBeNull();
    f.mem.seed("elections", [
      { _id: new ObjectId(), countryId: "RU", electionType: "dumaDeputy", status: "active" },
    ]);
    expect(await open(f.next)).toBeNull();
    expect(f.mem.collection("russianDumaConvocations").docs).toHaveLength(0);
  });
  it("fails closed if the active first Assembly has no actual seating proof", async () => {
    const f = await fixture();
    f.mem.collection("russianAssemblySeatings").docs.length = 0;
    await expect(open(f.next)).rejects.toThrow("actual first Assembly seating");
    expect(f.mem.collection("russianDumaConvocations").docs).toHaveLength(0);
  });
  it.each(["term", "predecessor", "first-root", "missing-ballot"])(
    "rejects a changed %s in the immutable opening",
    async (defect) => {
      const f = await fixture();
      await open(f.next);
      const row = f.mem.collection("russianDumaConvocations").docs[0];
      if (defect === "term") row.termEndTurn = 500;
      if (defect === "predecessor") row.predecessorCohortId = new ObjectId();
      if (defect === "first-root") row.firstDumaRoot = new ObjectId();
      if (defect === "missing-ballot") (row.electionIds as ObjectId[]).pop();
      const country = f.mem.collection("countryGameStates").docs[0] as unknown as CountryGameState;
      await expect(
        loadRussianDumaAuthority({ db: f.input.db, country, root: f.next.cohortId, turn: 225 })
      ).rejects.toThrow();
    }
  );
});
