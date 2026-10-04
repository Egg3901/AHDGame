import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { russianAssemblySeatingRuntimeScenario } from "./testing/assemblySeatingRuntimeScenario";
import { materializeRussianAssemblySeating } from "./assemblySeating";
import { materializeRussianDumaConvocationOpening as open } from "./dumaConvocationOpening";
import { loadRussianDumaAuthority, loadCurrentRussianDumaClock } from "./dumaConvocationAuthority";
import type { CountryGameState } from "@/lib/db/types";
import {
  materializeRussianDuma1995Proposal,
  authorizeRussianDuma1995Proposal,
} from "./dumaElectoralProposals1995";
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
  async function enactedLaw(f: Awaited<ReturnType<typeof fixture>>) {
    const input = { ...f.next, turn: 213, sponsor: null };
    const proposal = await materializeRussianDuma1995Proposal(input);
    const bill = f.mem
      .collection("bills")
      .docs.find((row) => row._id instanceof ObjectId && row._id.equals(proposal.billId))!;
    Object.assign(bill, {
      status: "signed",
      enactedAt: input.now,
      voteSnapshot: { totals: { for: 226, against: 224, abstain: 0 } },
      otherChamberVoteSnapshot: { totals: { for: 90, against: 88, abstain: 0 } },
    });
    expect(await authorizeRussianDuma1995Proposal(input)).toBe(true);
    return { proposal, bill };
  }
  it("freezes a proved enacted1995 law for the next ordinary campaign", async () => {
    const f = await fixture();
    const { proposal } = await enactedLaw(f);
    expect(await open(f.next)).toMatchObject({ created: true });
    const ballots = f.mem.collection("elections").docs.filter((row) => row.cycle === 2);
    expect(ballots).toHaveLength(226);
    expect(
      ballots.every((row) => {
        const round = row.russianDumaRound;
        return (
          round != null &&
          typeof round === "object" &&
          "electoralLaw" in round &&
          round.electoralLaw === "law1995"
        );
      })
    ).toBe(true);
    const record = f.mem.collection("russianDumaConvocations").docs[0];
    expect(record).toMatchObject({
      electoralLaw: "law1995",
      electoralMandate: { revision: proposal.revision, sinceTurn: 213 },
    });
    const country = f.mem.collection("countryGameStates").docs[0] as unknown as CountryGameState;
    expect(
      await loadRussianDumaAuthority({ db: f.input.db, country, root: f.next.cohortId, turn: 225 })
    ).toMatchObject({ number: 2 });
  });
  it("keeps an already open campaign on its original decree after a new law passes", async () => {
    const f = await fixture();
    await open(f.next);
    const before = structuredClone(f.mem.collection("elections").docs);
    const input = { ...f.next, turn: 226, sponsor: null };
    const proposal = await materializeRussianDuma1995Proposal(input);
    const bill = f.mem
      .collection("bills")
      .docs.find((row) => row._id instanceof ObjectId && row._id.equals(proposal.billId))!;
    Object.assign(bill, {
      status: "signed",
      enactedAt: input.now,
      voteSnapshot: { totals: { for: 226, against: 224, abstain: 0 } },
      otherChamberVoteSnapshot: { totals: { for: 90, against: 88, abstain: 0 } },
    });
    expect(await authorizeRussianDuma1995Proposal(input)).toBe(true);
    expect(await open({ ...f.next, turn: 226 })).toMatchObject({ created: false });
    expect(f.mem.collection("elections").docs).toEqual(before);
    expect(f.mem.collection("russianDumaConvocations").docs[0].electoralLaw).toBeUndefined();
  });
  it("refuses a country law pointer without actual signed parliamentary authority", async () => {
    const f = await fixture();
    f.mem.collection("countryGameStates").docs[0].ruDumaElectoralMandate = {
      law: "law1995",
      proposalId: "1991-default:ru-duma:law1995",
      revision: 1,
      sinceTurn: 213,
    };
    await expect(open(f.next)).rejects.toThrow("actual enactment receipt");
    expect(f.mem.collection("russianDumaConvocations").docs).toHaveLength(0);
  });
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
