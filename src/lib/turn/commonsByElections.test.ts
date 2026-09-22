/**
 * Focused #860 watcher tests: the Commons by-election turn phase.
 *
 * Backstop (unhooked holder-less rows gain a `removal` vacancy), spawn (one
 * `special_commons` per region over open vacancies with a persisted carve),
 * live-race suppression, retry cooldown, reconciliation to
 * filled/reopened/subsumed, and the recall trigger pipeline. Every case runs
 * the real phase against the in-memory fake Commons db.
 */
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createFakeCommonsDb } from "@/lib/uk/elections/commonsTestDb";
import { getUkCommonsSeats } from "@/lib/constants/states";
import { COMMONS_BY_ELECTION_RETRY_COOLDOWN_TURNS } from "@/lib/uk/elections/commonsRecallRules";

const NOW = new Date("2026-09-01T12:00:00Z");
const TURN = 500;
const LON_SEATS = getUkCommonsSeats(undefined).LON;

function tombstone(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    officeType: "commons",
    countryId: "UK",
    state: "LON",
    characterId: null,
    nppId: null,
    characterName: "Gone MP",
    party: "1",
    ...over,
  };
}

function openVacancy(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "UK",
    state: "LON",
    seats: 1,
    reason: "resignation",
    status: "open",
    vacatedTurn: TURN - 10,
    ...over,
  };
}

function seatedMp() {
  const characterId = new ObjectId();
  return {
    official: {
      _id: new ObjectId(),
      officeType: "commons",
      countryId: "UK",
      state: "LON",
      characterId,
      nppId: null,
      characterName: "Sitting MP",
      party: "1",
    },
    character: {
      _id: characterId,
      userId: new ObjectId(),
      countryId: "UK",
      name: "Sitting MP",
      party: "1",
      favorability: 60,
      infamy: 0,
    },
  };
}

describe("commons watcher backstop", () => {
  it("records a removal vacancy for an unhooked holder-less row, exactly once", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    fake.seed("electedOfficials", [tombstone()]);

    const first = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    expect(first.vacanciesEnsured).toBe(1);
    const vacancies = fake.read<Record<string, unknown>>("ukCommonsVacancies");
    expect(vacancies).toHaveLength(1);
    expect(vacancies[0].reason).toBe("removal");

    const second = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    expect(second.vacanciesEnsured).toBe(0);
    expect(fake.read("ukCommonsVacancies")).toHaveLength(1);
  });

  it("leaves seated MPs and non-Commons rows alone", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    const { official, character } = seatedMp();
    fake.seed("electedOfficials", [
      official,
      {
        _id: new ObjectId(),
        officeType: "house",
        countryId: "US",
        state: "CA",
        characterId: null,
        nppId: null,
      },
    ]);
    fake.seed("characters", [character]);

    const result = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    expect(result.vacanciesEnsured).toBe(0);
    expect(fake.read("ukCommonsVacancies")).toHaveLength(0);
  });
});

describe("commons watcher spawn", () => {
  it("spawns one special_commons race per region with the carve persisted and vacancies claimed", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    const v1 = openVacancy();
    const v2 = openVacancy({ _id: new ObjectId() });
    fake.seed("ukCommonsVacancies", [v1, v2]);

    const result = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    expect(result.spawned).toBe(1);

    const races = fake.read<Record<string, unknown>>("elections");
    expect(races).toHaveLength(1);
    expect(races[0].electionType).toBe("special_commons");
    expect(races[0].state).toBe("LON");
    expect(races[0].totalSeats).toBe(2);
    expect(races[0].byElectionCarve as number).toBeCloseTo(2 / (LON_SEATS as number), 9);
    const claimed = (races[0].byElectionVacancyIds as ObjectId[]).map(String).sort();
    expect(claimed).toEqual(
      [(v1._id as ObjectId).toString(), (v2._id as ObjectId).toString()].sort()
    );

    for (const doc of fake.read<Record<string, unknown>>("ukCommonsVacancies")) {
      expect(doc.status).toBe("scheduled");
      expect(doc.electionId).toBeDefined();
    }
  });

  it("does not spawn while a live special or regular race covers the region", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    for (const electionType of ["special_commons", "commons"]) {
      const fake = createFakeCommonsDb();
      fake.seed("ukCommonsVacancies", [openVacancy()]);
      fake.seed("elections", [
        {
          _id: new ObjectId(),
          countryId: "UK",
          state: "LON",
          electionType,
          status: "active",
        },
      ]);
      const result = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
      expect(result.spawned).toBe(0);
      expect(fake.read("elections")).toHaveLength(1);
      expect(fake.read<Record<string, unknown>>("ukCommonsVacancies")[0].status).toBe("open");
    }
  });

  it("honors the retry cooldown after a finished special, then spawns again", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    expect(COMMONS_BY_ELECTION_RETRY_COOLDOWN_TURNS).toBeGreaterThan(0);

    const CoolingFake = createFakeCommonsDb();
    CoolingFake.seed("ukCommonsVacancies", [openVacancy()]);
    CoolingFake.seed("elections", [
      {
        _id: new ObjectId(),
        countryId: "UK",
        state: "LON",
        electionType: "special_commons",
        status: "completed",
        endTurn: TURN - 1,
      },
    ]);
    const cooling = await processCommonsByElectionWatcher(CoolingFake.db, TURN, NOW);
    expect(cooling.spawned).toBe(0);

    const staleFake = createFakeCommonsDb();
    staleFake.seed("ukCommonsVacancies", [openVacancy()]);
    staleFake.seed("elections", [
      {
        _id: new ObjectId(),
        countryId: "UK",
        state: "LON",
        electionType: "special_commons",
        status: "completed",
        endTurn: TURN - COMMONS_BY_ELECTION_RETRY_COOLDOWN_TURNS - 1,
      },
    ]);
    const stale = await processCommonsByElectionWatcher(staleFake.db, TURN, NOW);
    expect(stale.spawned).toBe(1);
  });
});

describe("commons watcher reconciliation", () => {
  it("marks vacancies filled when their claimed race finished", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    const electionId = new ObjectId();
    fake.seed("ukCommonsVacancies", [
      {
        _id: new ObjectId(),
        countryId: "UK",
        state: "LON",
        status: "scheduled",
        electionId,
        scheduledTurn: TURN - 30,
        vacatedTurn: TURN - 40,
      },
    ]);
    fake.seed("elections", [
      {
        _id: electionId,
        countryId: "UK",
        state: "LON",
        electionType: "special_commons",
        status: "completed",
        endTurn: TURN - 1,
      },
    ]);

    const result = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    expect(result.reconciled).toBeGreaterThanOrEqual(1);
    expect(fake.read<Record<string, unknown>>("ukCommonsVacancies")[0].status).toBe("filled");
  });

  it("reopens vacancies whose race vanished and immediately retries the spawn", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    fake.seed("ukCommonsVacancies", [
      {
        _id: new ObjectId(),
        countryId: "UK",
        state: "LON",
        status: "scheduled",
        electionId: new ObjectId(),
        scheduledTurn: TURN - 30,
        vacatedTurn: TURN - 40,
      },
    ]);

    const result = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    expect(result.reconciled).toBeGreaterThanOrEqual(1);
    // Reopen drops the row back to `open`; the same pass then spawns a fresh
    // race and claims it, so the seat ends `scheduled` behind a live race.
    expect(result.spawned).toBe(1);
    expect(fake.read("elections")).toHaveLength(1);
    const doc = fake.read<Record<string, unknown>>("ukCommonsVacancies")[0];
    expect(doc.status).toBe("scheduled");
    expect(doc.electionId).toBeDefined();
  });

  it("subsumes open vacancies overtaken by a finished regular race", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    fake.seed("ukCommonsVacancies", [openVacancy({ vacatedTurn: TURN - 10 })]);
    fake.seed("elections", [
      {
        _id: new ObjectId(),
        countryId: "UK",
        state: "LON",
        electionType: "commons",
        status: "completed",
        endTurn: TURN - 2,
      },
    ]);

    const result = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    expect(result.spawned).toBe(0);
    expect(fake.read<Record<string, unknown>>("ukCommonsVacancies")[0].status).toBe("subsumed");
  });

  it("does not subsume a vacancy that postdates the regular race", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    fake.seed("ukCommonsVacancies", [openVacancy({ vacatedTurn: TURN - 1 })]);
    fake.seed("elections", [
      {
        _id: new ObjectId(),
        countryId: "UK",
        state: "LON",
        electionType: "commons",
        status: "completed",
        endTurn: TURN - 10,
      },
    ]);

    const result = await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    expect(fake.read<Record<string, unknown>>("ukCommonsVacancies")[0].status).toBe("scheduled");
    expect(result.spawned).toBe(1);
  });
});

describe("commons watcher recall pipeline", () => {
  it("opens a petition immediately on the infamy trigger", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    const { official, character } = seatedMp();
    fake.seed("electedOfficials", [official]);
    fake.seed("characters", [{ ...character, infamy: 80 }]);

    await processCommonsByElectionWatcher(fake.db, TURN, NOW);
    const second = await processCommonsByElectionWatcher(fake.db, TURN + 1, NOW);
    expect(second.petitionsAdvanced).toBeGreaterThanOrEqual(1);
    const petitions = fake.read<Record<string, unknown>>("ukRecallPetitions");
    expect(petitions).toHaveLength(1);
    expect(petitions[0].status).toBe("open");
    expect(petitions[0].trigger).toBe("infamy");
  });

  it("opens after sustained low approval and counts the streak without doubling", async () => {
    const { processCommonsByElectionWatcher } = await import("./commonsByElections");
    const fake = createFakeCommonsDb();
    const { official, character } = seatedMp();
    fake.seed("electedOfficials", [official]);
    fake.seed("characters", [{ ...character, favorability: 10, infamy: 0 }]);

    // The creation pass only installs the watch (its lastEvaluatedTurn guard
    // keeps a retried turn from double counting), so four counting passes
    // after it open the petition on the fifth run.
    for (let turn = TURN; turn < TURN + 5; turn++) {
      await processCommonsByElectionWatcher(fake.db, turn, NOW);
    }
    const petitions = fake.read<Record<string, unknown>>("ukRecallPetitions");
    expect(petitions).toHaveLength(1);
    expect(petitions[0].status).toBe("open");
    expect(petitions[0].trigger).toBe("lowApproval");
  });
});
