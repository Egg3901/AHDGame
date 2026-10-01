import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
const calls = vi.hoisted(() => ({
  firstDuma: vi.fn(),
  firstCouncil: vi.fn(),
  repeatDuma: vi.fn(),
  repeatCouncil: vi.fn(),
  admitDuma: vi.fn(),
  admitDumaRepeat: vi.fn(),
  admitCouncil: vi.fn(),
}));
vi.mock("./dumaElectionOpening", () => ({ openRussianDumaElection: calls.firstDuma }));
vi.mock("./councilElectionOpening", () => ({
  openRussianCouncilElection: calls.firstCouncil,
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION: "russianCouncilElectionOpenings",
}));
vi.mock("./dumaRepeatOpening", () => ({
  openRussianDumaRepeat: calls.repeatDuma,
  RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION: "russianDumaRepeatOpenings",
}));
vi.mock("./councilRepeatOpening", () => ({ openRussianCouncilRepeat: calls.repeatCouncil }));
vi.mock("./dumaNpcAdmission", () => ({ admitRussianDumaNpcNominees: calls.admitDuma }));
vi.mock("./dumaRepeatNpcAdmission", () => ({
  admitRussianDumaRepeatNpcNominees: calls.admitDumaRepeat,
}));
vi.mock("./councilNpcAdmission", () => ({ admitRussianCouncilNpcNominees: calls.admitCouncil }));
import { processRussianAssemblyCampaigns as processCampaign } from "./assemblyCampaigns";
beforeEach(() => {
  for (const mock of Object.values(calls)) mock.mockReset();
});
function scenario() {
  const mem = createInMemoryDb(),
    dumaRoot = new ObjectId(),
    councilRoot = new ObjectId();
  mem.seed("countryGameStates", [
    { _id: "RU", ruSovietSuccessionSinceTurn: 48, ruFederalAssemblyMandateSinceTurn: 129 },
  ]);
  calls.firstDuma.mockImplementation(async () => {
    mem.collection("countryGameStates").docs[0].ruFirstDumaElectionCohortId = dumaRoot;
    return { cohortId: dumaRoot, created: true };
  });
  calls.firstCouncil.mockImplementation(async () => {
    mem.collection("countryGameStates").docs[0].ruFirstCouncilElectionCohortId = councilRoot;
    mem.seed("russianCouncilElectionOpenings", [
      { _id: councilRoot.toHexString(), cohortId: councilRoot, openedOnTurn: 129 },
    ]);
    return { cohortId: councilRoot, created: true };
  });
  calls.admitDuma.mockResolvedValue({ created: 678 });
  calls.admitDumaRepeat.mockResolvedValue({ created: 3 });
  calls.admitCouncil.mockResolvedValue({ created: 534 });
  return {
    mem,
    dumaRoot,
    councilRoot,
    input: {
      db: mem as unknown as Db,
      game: { preset: "1991-default" },
      turn: 129,
      now: new Date(1000),
    },
  };
}
function certify(fixture: ReturnType<typeof scenario>, pending: boolean) {
  const { mem, dumaRoot, councilRoot } = fixture;
  Object.assign(mem.collection("countryGameStates").docs[0], {
    ruFirstDumaElectionCohortId: dumaRoot,
    ruFirstCouncilElectionCohortId: councilRoot,
    ruDumaNpcAdmissionCohortId: dumaRoot,
  });
  mem.seed("russianDumaElectionResults", [
    {
      _id: dumaRoot.toHexString(),
      cohortId: dumaRoot,
      countryId: "RU",
      preset: "1991-default",
      mandateSinceTurn: 129,
      resolvedOnTurn: 141,
      result: {
        constituencyResults: [{ decision: { outcome: pending ? "repeat" : "elected" } }],
        listDecision: { outcome: "elected" },
      },
    },
  ]);
  mem.seed("russianCouncilElectionResults", [
    {
      _id: councilRoot.toHexString(),
      cohortId: councilRoot,
      countryId: "RU",
      preset: "1991-default",
      mandateSinceTurn: 129,
      resolvedOnTurn: 141,
      result: [{ decision: { outcome: pending ? "repeat" : "elected" } }],
    },
  ]);
}
describe("Automatic native Assembly campaigns", () => {
  it("opens both first families then admits disjoint slates in Duma-first order", async () => {
    const fixture = scenario();
    expect(await processCampaign(fixture.input)).toEqual({
      firstOpened: 2,
      repeatsOpened: 0,
      npcCandidatesCreated: 1212,
    });
    const order = [calls.firstDuma, calls.firstCouncil, calls.admitDuma, calls.admitCouncil].map(
      (mock) => mock.mock.invocationCallOrder[0]
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("resumes a partial first opening without opening another Duma family", async () => {
    const fixture = scenario();
    fixture.mem.collection("countryGameStates").docs[0].ruFirstDumaElectionCohortId =
      fixture.dumaRoot;
    expect((await processCampaign(fixture.input)).firstOpened).toBe(1);
    expect(calls.firstDuma).not.toHaveBeenCalled();
    expect(calls.admitDuma).toHaveBeenCalledTimes(1);
  });
  it("opens and admits only the next failed generations", async () => {
    const fixture = scenario();
    certify(fixture, true);
    for (const [mock, root] of [
      [calls.repeatDuma, fixture.dumaRoot],
      [calls.repeatCouncil, fixture.councilRoot],
    ] as const)
      mock.mockResolvedValue({
        created: true,
        record: { cohortId: new ObjectId(), rootCohortId: root, generation: 1, openedOnTurn: 150 },
      });
    expect(await processCampaign({ ...fixture.input, turn: 150 })).toEqual({
      firstOpened: 0,
      repeatsOpened: 2,
      npcCandidatesCreated: 537,
    });
    expect(calls.firstDuma).not.toHaveBeenCalled();
    expect(calls.admitDumaRepeat).toHaveBeenCalledWith(
      expect.objectContaining({ rootCohortId: fixture.dumaRoot, generation: 1 })
    );
  });
  it("leaves certified held families alone", async () => {
    const fixture = scenario();
    certify(fixture, false);
    expect(await processCampaign({ ...fixture.input, turn: 150 })).toEqual({
      firstOpened: 0,
      repeatsOpened: 0,
      npcCandidatesCreated: 0,
    });
    for (const mock of Object.values(calls)) expect(mock).not.toHaveBeenCalled();
  });
  it("does not reopen a campaign which cannot finish inside its seated original term", async () => {
    const fixture = scenario();
    certify(fixture, true);
    fixture.mem.collection("countryGameStates").docs[0].ruFederalAssemblySinceTurn = 145;
    fixture.mem.seed("russianAssemblySeatings", [
      {
        _id: `${fixture.dumaRoot.toHexString()}:${fixture.councilRoot.toHexString()}`,
        countryId: "RU",
        preset: "1991-default",
        dumaRootCohortId: fixture.dumaRoot,
        councilRootCohortId: fixture.councilRoot,
        seatedOnTurn: 145,
        dumaTermEndTurn: 237,
        councilTermEndTurn: 237,
      },
    ]);
    expect((await processCampaign({ ...fixture.input, turn: 225 })).repeatsOpened).toBe(0);
    for (const mock of Object.values(calls)) expect(mock).not.toHaveBeenCalled();
  });
  it("preserves an existing alternate Assembly without inventing native first roots", async () => {
    const fixture = scenario();
    fixture.mem.collection("countryGameStates").docs[0].ruFederalAssemblySinceTurn = 145;
    expect(await processCampaign({ ...fixture.input, turn: 150 })).toEqual({
      firstOpened: 0,
      repeatsOpened: 0,
      npcCandidatesCreated: 0,
    });
    for (const mock of Object.values(calls)) expect(mock).not.toHaveBeenCalled();
  });
  it.each(["missing-journal", "future-seating", "missing-receipt"])(
    "refuses native%s without opening or admitting candidates",
    async (defect) => {
      const fixture = scenario();
      certify(fixture, false);
      const seatedOnTurn = defect === "future-seating" ? 151 : 145;
      fixture.mem.collection("countryGameStates").docs[0].ruFederalAssemblySinceTurn = seatedOnTurn;
      if (defect !== "missing-journal")
        fixture.mem.seed("russianAssemblySeatings", [
          {
            _id: `${fixture.dumaRoot.toHexString()}:${fixture.councilRoot.toHexString()}`,
            countryId: "RU",
            preset: "1991-default",
            dumaRootCohortId: fixture.dumaRoot,
            councilRootCohortId: fixture.councilRoot,
            seatedOnTurn,
            dumaTermEndTurn: 237,
            councilTermEndTurn: 237,
          },
        ]);
      if (defect === "missing-receipt")
        fixture.mem.collection("russianDumaElectionResults").docs.splice(0);
      await expect(processCampaign({ ...fixture.input, turn: 150 })).rejects.toThrow();
      for (const mock of Object.values(calls)) expect(mock).not.toHaveBeenCalled();
    }
  );
  it("requires dates and actual political consent, preserving Congress otherwise", async () => {
    const fixture = scenario();
    expect((await processCampaign({ ...fixture.input, turn: 100 })).firstOpened).toBe(0);
    expect(
      (await processCampaign({ ...fixture.input, game: { preset: "1979-default" } })).firstOpened
    ).toBe(0);
    delete fixture.mem.collection("countryGameStates").docs[0].ruFederalAssemblyMandateSinceTurn;
    expect((await processCampaign(fixture.input)).firstOpened).toBe(0);
    for (const mock of Object.values(calls)) expect(mock).not.toHaveBeenCalled();
  });
});
