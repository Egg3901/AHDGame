import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { russianAssemblySeatingRuntimeScenario } from "./testing/assemblySeatingRuntimeScenario";
import { materializeRussianAssemblySeating } from "./assemblySeating";
import { materializeRussianDumaConvocationOpening } from "./dumaConvocationOpening";
import { materializeRussianDumaNpcAdmission } from "./dumaNpcAdmission";
import { materializeRussianDumaElectionResult } from "./dumaElectionResult";
import { materializeRussianDumaConvocationSeating as seat } from "./dumaConvocationSeating";
import { materializeRussianDumaRepeatOpening } from "./dumaRepeatOpening";
import { materializeRussianDumaRepeatNpcAdmission } from "./dumaRepeatNpcAdmission";
import { materializeRussianDumaRepeatResult } from "./dumaRepeatResult";
import { validateRussianDumaPlayerFiling } from "./dumaPlayerFiling";
import { loadCurrentRussianDumaClock } from "./dumaConvocationAuthority";
import type { Character, CountryGameState, Election, ElectionCandidate } from "@/lib/db/types";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";
async function fixture() {
  const f = russianAssemblySeatingRuntimeScenario();
  await materializeRussianAssemblySeating(f.input);
  const first = f.mem.collection("russianDumaElectionResults").docs[0];
  const nominees = first.nominees as Array<{ ownerId: ObjectId; name: string; party: string }>;
  for (const row of f.mem.collection("npps").docs) {
    const nominee = nominees.find((n) => String(n.ownerId) === String(row._id));
    if (nominee) {
      row.name = nominee.name;
      row.party = nominee.party;
    }
  }
  for (const state of f.mem.collection("states").docs) {
    state.population = 1000000;
    state.votingEligiblePopulation = 700000;
  }
  f.mem.seed(
    "politicalParties",
    [1, 2, 3].map((sequentialId) => ({ _id: new ObjectId(), countryId: "RU", sequentialId }))
  );
  const cohortId = new ObjectId();
  await materializeRussianDumaConvocationOpening({
    ...f.input,
    game: { preset: "1991-default" },
    turn: 225,
    cohortId,
    electionIds: Array.from({ length: 226 }, () => new ObjectId()),
  });
  await materializeRussianDumaNpcAdmission({ ...f.input, cohortId, turn: 225 });
  return { ...f, cohortId };
}
async function count(
  f: Awaited<ReturnType<typeof fixture>>,
  cohort: ObjectId,
  turn: number,
  failFirst = false
) {
  const polls = f.mem
    .collection("elections")
    .docs.filter((row) =>
      (row.russianDumaRound as Election["russianDumaRound"])?.cohortId.equals(cohort)
    );
  const candidates = f.mem.collection("electionCandidates").docs as unknown as ElectionCandidate[];
  f.mem.seed(
    "electionVoteTallies",
    polls.map((poll, index) => {
      const round = poll.russianDumaRound as NonNullable<Election["russianDumaRound"]>;
      const rows = candidates.filter((row) => row.electionId.equals(poll._id as ObjectId));
      poll.status = "completed";
      const totalVotes = Object.fromEntries(
        rows.map((row) => [
          String(row._id),
          failFirst && index === 0
            ? 0
            : Math.floor(
                round.registeredVoters *
                  (round.tier === "list"
                    ? 1 / 3
                    : row.party === "1"
                      ? 0.6
                      : row.party === "2"
                        ? 0.4
                        : 0)
              ),
        ])
      );
      return {
        _id: new ObjectId(),
        electionId: poll._id,
        finalized: false,
        totalVotes,
        candidateParties: Object.fromEntries(rows.map((row) => [String(row._id), row.party])),
        russianDumaBallot: { againstAllVotes: 0 },
      };
    })
  );
  return materializeRussianDumaElectionResult({ ...f.input, cohortId: cohort, turn });
}
function financial(f: Awaited<ReturnType<typeof fixture>>) {
  return JSON.stringify(
    f.mem
      .collection("npps")
      .docs.map((row) => ({ _id: row._id, money: row.money, personalAccount: row.personalAccount }))
  );
}
function council(f: Awaited<ReturnType<typeof fixture>>) {
  return JSON.stringify(
    f.mem
      .collection("electedOfficials")
      .docs.filter((row) => row.officeType === "federationCouncilMember")
  );
}
describe("ordinary Duma handover and vacancies", () => {
  it("allows an outgoing deputy to contest the next convocation but rejects the later government exception", async () => {
    const f = await fixture();
    const election = f.mem
      .collection("elections")
      .docs.find(
        (row) =>
          row.cycle === 2 &&
          (row.russianDumaRound as Election["russianDumaRound"])?.tier === "constituency"
      ) as unknown as Election;
    const character = {
      _id: new ObjectId(),
      countryId: "RU",
      homeState: election.state,
      party: "independent",
      currentOffice: { type: "dumaDeputy" },
    } as Character;
    const input = { db: f.input.db, election, character, turn: 225, registrationOrder: 1000 };
    expect(await validateRussianDumaPlayerFiling(input)).toMatchObject({ allowed: true });
    character.currentOffice = { type: "primeMinister" };
    expect(await validateRussianDumaPlayerFiling(input)).toEqual({
      allowed: false,
      reason: "incompatible-office",
    });
  });
  it("requires the actual ordinary seating receipt behind a current-convocation marker", async () => {
    const f = await fixture();
    await count(f, f.cohortId, 237);
    await seat({ ...f.input, turn: 237 });
    const journals = f.mem.collection("russianAssemblySeatings").docs;
    journals.splice(
      journals.findIndex((row) => row._id === `${f.cohortId}:duma`),
      1
    );
    const country = f.mem.collection("countryGameStates").docs[0] as unknown as CountryGameState;
    await expect(
      loadCurrentRussianDumaClock({ db: f.input.db, country, turn: 238 })
    ).rejects.toThrow("actual immutable handover receipt");
  });

  it("renews only the Duma, retains Council and first proof, and fixes the new four-year clock", async () => {
    const f = await fixture(),
      cash = financial(f),
      upper = council(f);
    const firstJournal = JSON.stringify(f.mem.collection("russianAssemblySeatings").docs[0]);
    await count(f, f.cohortId, 237);
    expect(await seat({ ...f.input, turn: 237 })).toBe(true);
    expect(council(f)).toBe(upper);
    expect(financial(f)).toBe(cash);
    expect(JSON.stringify(f.mem.collection("russianAssemblySeatings").docs[0])).toBe(firstJournal);
    const country = f.mem.collection("countryGameStates").docs[0];
    expect(country.ruFirstDumaElectionCohortId).toEqual(f.dumaRoot);
    expect(country.ruFirstCouncilElectionCohortId).toEqual(f.councilRoot);
    expect(country.ruFederalAssemblySinceTurn).toBe(145);
    expect(country.ruDumaCurrentConvocationCohortId).toEqual(f.cohortId);
    expect(f.mem.collection("russianDumaConvocations").docs[0]).toMatchObject({
      number: 2,
      termEndTurn: 429,
      seatedOnTurn: 237,
    });
    const config = getCountryConfigForRuntime("RU", "1991-default", {
      ruFederalAssemblySinceTurn: 145,
      ruDumaCurrentConvocationCohortId: f.cohortId,
    });
    expect(config.lowerElectionSystem?.termYears).toBe(4);
    expect(config.upperElectionSystem?.termYears).toBe(2);
    expect(await seat({ ...f.input, turn: 238 })).toBe(false);
  });
  it("fills a failed new-convocation constituency without replacing held seats or extending its term", async () => {
    const f = await fixture();
    await count(f, f.cohortId, 237, true);
    expect(await seat({ ...f.input, turn: 237 })).toBe(true);
    const held = f.mem
      .collection("electedOfficials")
      .docs.filter((row) => row.officeType === "dumaDeputy");
    const heldIds = held.map((row) => String(row._id));
    const upper = council(f),
      cash = financial(f);
    const repeat = await materializeRussianDumaRepeatOpening({
      ...f.input,
      turn: 240,
      rootCohortId: f.cohortId,
      previousResultId: String(f.cohortId),
      cohortId: new ObjectId(),
      electionIds: [new ObjectId()],
    });
    expect(repeat?.created).toBe(true);
    await materializeRussianDumaRepeatNpcAdmission({
      ...f.input,
      turn: 240,
      rootCohortId: f.cohortId,
      generation: 1,
    });
    const polls = f.mem
      .collection("elections")
      .docs.filter((row) =>
        (row.russianDumaRound as Election["russianDumaRound"])?.cohortId.equals(
          repeat!.record.cohortId
        )
      );
    const candidates = f.mem.collection("electionCandidates")
      .docs as unknown as ElectionCandidate[];
    f.mem.seed(
      "electionVoteTallies",
      polls.map((poll) => {
        poll.status = "completed";
        const register = (poll.russianDumaRound as NonNullable<Election["russianDumaRound"]>)
          .registeredVoters;
        const rows = candidates.filter((row) => row.electionId.equals(poll._id as ObjectId));
        return {
          _id: new ObjectId(),
          electionId: poll._id,
          finalized: false,
          totalVotes: Object.fromEntries(
            rows.map((row) => [
              String(row._id),
              Math.floor(register * (row.party === "1" ? 0.6 : row.party === "2" ? 0.4 : 0)),
            ])
          ),
          candidateParties: Object.fromEntries(rows.map((row) => [String(row._id), row.party])),
          russianDumaBallot: { againstAllVotes: 0 },
        };
      })
    );
    await materializeRussianDumaRepeatResult({
      ...f.input,
      turn: 252,
      rootCohortId: f.cohortId,
      generation: 1,
    });
    expect(await seat({ ...f.input, turn: 252 })).toBe(true);
    expect(
      heldIds.every((id) =>
        f.mem.collection("electedOfficials").docs.some((row) => String(row._id) === id)
      )
    ).toBe(true);
    expect(council(f)).toBe(upper);
    expect(financial(f)).toBe(cash);
    expect(f.mem.collection("russianDumaConvocations").docs[0]).toMatchObject({
      termEndTurn: 429,
      seatedOnTurn: 237,
    });
    expect(f.mem.collection("russianAssemblySeatings").docs.at(-1)?.dumaSeats).toBe(450);
    expect(await seat({ ...f.input, turn: 253 })).toBe(false);
  });
  it("leaves the old Duma in custody until a viable certified successor exists", async () => {
    const f = await fixture(),
      before = JSON.stringify(f.mem.collection("electedOfficials").docs);
    expect(await seat({ ...f.input, turn: 225 })).toBe(false);
    await count(f, f.cohortId, 237);
    const receipt = f.mem
      .collection("russianDumaElectionResults")
      .docs.find((row) => row._id === String(f.cohortId))!;
    for (const ballot of receipt.ballots as Array<{ candidates: Array<{ eligible: boolean }> }>)
      for (const candidate of ballot.candidates) candidate.eligible = false;
    expect(await seat({ ...f.input, turn: 237 })).toBe(false);
    expect(JSON.stringify(f.mem.collection("electedOfficials").docs)).toBe(before);
  });
});
