/**
 * Focused #860 vertical-slice tests: vacancy shell idempotency, seat commands,
 * lifecycle hooks (resign/retire, with non-UK and non-Commons preservation),
 * recall signature idempotency, and special_commons static coverage
 * (method/office/labels/NPP parity).
 *
 * Phase-ordering (commons watcher after governor watcher) is asserted by
 * inspection of BASE_TURN_PHASE_NAMES in turnPhaseNames.ts; importing that
 * module here drags the full country-phase chain, so it stays out of this
 * focused file.
 */
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createFakeCommonsDb } from "./commonsTestDb";

const NOW = new Date("2026-09-01T12:00:00Z");
const TURN = 500;

function mpCharacter(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    countryId: "UK",
    name: "Test MP",
    homeState: "LON",
    party: "1",
    favorability: 60,
    infamy: 0,
    politicalInfluence: 0,
    currentOffice: { type: "commons", state: "LON" },
    ...over,
  };
}

function commonsSeat(characterId: ObjectId, over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    officeType: "commons",
    countryId: "UK",
    state: "LON",
    characterId,
    nppId: null,
    characterName: "Test MP",
    party: "1",
    ...over,
  };
}

describe("commons vacancy shell idempotency", () => {
  it("creates once per official row: repeat creates return the live vacancy", async () => {
    const { createCommonsVacancy } = await import("./commonsVacancyShell");
    const fake = createFakeCommonsDb();
    const officialId = new ObjectId();
    const input = {
      officialId,
      state: "LON",
      reason: "resignation" as const,
      vacatedTurn: TURN,
      now: NOW,
    };
    const first = await createCommonsVacancy(fake.db, input);
    const second = await createCommonsVacancy(fake.db, { ...input, reason: "removal" as const });
    expect(second._id.equals(first._id)).toBe(true);
    expect(second.reason).toBe("resignation");
    expect(fake.read("ukCommonsVacancies")).toHaveLength(1);
  });

  it("claims only open vacancies, so a retried spawn converges", async () => {
    const { claimVacanciesForElection } = await import("./commonsVacancyShell");
    const fake = createFakeCommonsDb();
    const ids = [new ObjectId(), new ObjectId()];
    fake.seed(
      "ukCommonsVacancies",
      ids.map((id) => ({ _id: id, countryId: "UK", status: "open" }))
    );
    const electionId = new ObjectId();
    expect(await claimVacanciesForElection(fake.db, ids, electionId, TURN, NOW)).toBe(2);
    expect(await claimVacanciesForElection(fake.db, ids, electionId, TURN, NOW)).toBe(0);
    for (const doc of fake.read<{ status: string }>("ukCommonsVacancies")) {
      expect(doc.status).toBe("scheduled");
    }
  });

  it("reopens scheduled vacancies for retry but never touches filled ones", async () => {
    const { reopenCommonsVacanciesForRetry, markVacanciesFilled } =
      await import("./commonsVacancyShell");
    const fake = createFakeCommonsDb();
    const electionId = new ObjectId();
    const otherId = new ObjectId();
    fake.seed("ukCommonsVacancies", [
      { _id: new ObjectId(), electionId, status: "scheduled" },
      { _id: new ObjectId(), electionId: otherId, status: "scheduled" },
    ]);
    expect(await markVacanciesFilled(fake.db, otherId, TURN, NOW)).toBe(1);
    expect(await reopenCommonsVacanciesForRetry(fake.db, electionId, NOW)).toBe(1);
    expect(await reopenCommonsVacanciesForRetry(fake.db, electionId, NOW)).toBe(0);
    const docs = fake.read<{ status: string; electionId?: unknown }>("ukCommonsVacancies");
    expect(docs.find((d) => d.status === "open")).toBeTruthy();
    expect(docs.find((d) => d.status === "filled")).toBeTruthy();
  });
});

describe("commons seat commands", () => {
  it("resign tombstones the seat, clears currentOffice, and records a vacancy", async () => {
    const { resignCommonsSeat } = await import("./commonsSeatCommands");
    const fake = createFakeCommonsDb();
    const character = mpCharacter();
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [commonsSeat(character._id as ObjectId)]);
    fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    const result = await resignCommonsSeat(fake.db, character as never, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = fake.read<Record<string, unknown>>("electedOfficials");
    expect(rows).toHaveLength(1);
    expect(rows[0].characterId).toBeNull();
    const vacancies = fake.read<Record<string, unknown>>("ukCommonsVacancies");
    expect(vacancies).toHaveLength(1);
    expect(vacancies[0].reason).toBe("resignation");
    expect((vacancies[0]._id as ObjectId).equals(result.vacancyId)).toBe(true);
    const updated = fake.read<Record<string, unknown>>("characters")[0];
    expect(updated.currentOffice).toBeNull();
  });

  it("resign 404s without a seat and 400s while actively running", async () => {
    const { resignCommonsSeat } = await import("./commonsSeatCommands");
    const fake = createFakeCommonsDb();
    const character = mpCharacter();
    fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    const missing = await resignCommonsSeat(fake.db, character as never, NOW);
    expect(missing).toMatchObject({ ok: false, status: 404 });
    fake.seed("electedOfficials", [commonsSeat(character._id as ObjectId)]);
    fake.seed("electionCandidates", [
      { _id: new ObjectId(), characterId: character._id, status: "active" },
    ]);
    const blocked = await resignCommonsSeat(fake.db, character as never, NOW);
    expect(blocked).toMatchObject({ ok: false, status: 400 });
  });

  it("defect moves the party and vacates with the defection reason", async () => {
    const { defectCommonsSeat } = await import("./commonsSeatCommands");
    const fake = createFakeCommonsDb();
    const character = mpCharacter();
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [commonsSeat(character._id as ObjectId)]);
    fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    const result = await defectCommonsSeat(fake.db, character as never, "2", NOW);
    expect(result.ok).toBe(true);
    expect(fake.read<Record<string, unknown>>("characters")[0].party).toBe("2");
    expect(fake.read<Record<string, unknown>>("ukCommonsVacancies")[0].reason).toBe("defection");
  });

  it("defect 400s when the seat is held but the target party is the current one", async () => {
    const { defectCommonsSeat } = await import("./commonsSeatCommands");
    const fake = createFakeCommonsDb();
    const character = mpCharacter({ party: "2" });
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [commonsSeat(character._id as ObjectId, { party: "2" })]);
    fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    const same = await defectCommonsSeat(fake.db, character as never, "2", NOW);
    expect(same).toMatchObject({ ok: false, status: 400 });
  });
});

describe("lifecycle hooks", () => {
  it("resignPosition tombstones UK commons rows and records a vacancy", async () => {
    const { resignPosition } = await import("@/lib/settings/resignations");
    const fake = createFakeCommonsDb();
    const character = mpCharacter();
    const seat = commonsSeat(character._id as ObjectId);
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [seat]);
    fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    const result = await resignPosition(
      fake.db,
      character as never,
      `official:${(seat._id as ObjectId).toString()}`
    );
    expect(result.ok).toBe(true);
    const rows = fake.read<Record<string, unknown>>("electedOfficials");
    expect(rows).toHaveLength(1);
    expect(rows[0].characterId).toBeNull();
    const vacancies = fake.read<Record<string, unknown>>("ukCommonsVacancies");
    expect(vacancies).toHaveLength(1);
    expect(vacancies[0].reason).toBe("resignation");
  });

  it("resignPosition preserves non-UK behavior: US house rows are deleted, no vacancy", async () => {
    const { resignPosition } = await import("@/lib/settings/resignations");
    const fake = createFakeCommonsDb();
    const character = mpCharacter({
      countryId: "US",
      homeState: "CA",
      currentOffice: { type: "house", state: "CA" },
    });
    const seat = {
      _id: new ObjectId(),
      officeType: "house",
      countryId: "US",
      state: "CA",
      characterId: character._id,
    };
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [seat]);
    fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    const result = await resignPosition(
      fake.db,
      character as never,
      `official:${(seat._id as ObjectId).toString()}`
    );
    expect(result.ok).toBe(true);
    expect(fake.read("electedOfficials")).toHaveLength(0);
    expect(fake.read("ukCommonsVacancies")).toHaveLength(0);
  });

  it("retireCharacter records retirement vacancies for UK MPs and none for US characters", async () => {
    const { retireCharacter } = await import("@/lib/retireCharacter");
    const fake = createFakeCommonsDb();
    const character = mpCharacter({ party: "independent", currentOffice: null });
    const seat = commonsSeat(character._id as ObjectId);
    fake.seed("characters", [character]);
    fake.seed("electedOfficials", [seat]);
    fake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    await retireCharacter(
      fake.db,
      character as never,
      character.userId as ObjectId,
      "retired" as never
    );
    const vacancies = fake.read<Record<string, unknown>>("ukCommonsVacancies");
    expect(vacancies).toHaveLength(1);
    expect(vacancies[0].reason).toBe("retirement");
    expect(vacancies[0].priorCharacterName).toBe("Test MP");

    const usFake = createFakeCommonsDb();
    const usCharacter = mpCharacter({
      countryId: "US",
      homeState: "CA",
      party: "independent",
      currentOffice: null,
    });
    usFake.seed("characters", [usCharacter]);
    usFake.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        officeType: "house",
        countryId: "US",
        state: "CA",
        characterId: usCharacter._id,
      },
    ]);
    usFake.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
    await retireCharacter(
      usFake.db,
      usCharacter as never,
      usCharacter.userId as ObjectId,
      "retired" as never
    );
    expect(usFake.read("ukCommonsVacancies")).toHaveLength(0);
  });
});

describe("recall signature idempotency", () => {
  it("re-signing is a no-op that reports the live count", async () => {
    const { addRecallSignature } = await import("./recallPetitionShell");
    const fake = createFakeCommonsDb();
    const petitionId = new ObjectId();
    fake.seed("ukRecallPetitions", [{ _id: petitionId, status: "open", signatures: [] }]);
    const signer = { _id: new ObjectId(), name: "Signer" };
    const first = await addRecallSignature(fake.db, petitionId, signer as never, TURN, NOW);
    expect(first).toMatchObject({ added: true, signatures: 1 });
    const second = await addRecallSignature(fake.db, petitionId, signer as never, TURN, NOW);
    expect(second).toMatchObject({ added: false, signatures: 1 });
  });
});

describe("special_commons static coverage", () => {
  it("shares the commons method position, office key, labels, and NPP priority", async () => {
    const { POSITION_BY_ELECTION_TYPE } = await import("@/lib/elections/electionMethod");
    expect(POSITION_BY_ELECTION_TYPE.special_commons).toBe(POSITION_BY_ELECTION_TYPE.commons);
    const {
      officeKeyForElectionType,
      MULTI_SEAT_TYPES,
      isSpecialCommonsElection,
      formatElectionTypeLabel,
    } = await import("@/lib/utils/electionLabels");
    expect(officeKeyForElectionType("special_commons")).toBe("commons");
    expect(MULTI_SEAT_TYPES.has("special_commons")).toBe(true);
    expect(isSpecialCommonsElection("special_commons")).toBe(true);
    expect(isSpecialCommonsElection("commons")).toBe(false);
    expect(formatElectionTypeLabel("special_commons")).toMatch(/by-election/i);
    const { RACE_PRIORITY } = await import("@/lib/turn/nppEntryLogic");
    const commonsIndex = (RACE_PRIORITY as readonly string[]).indexOf("commons");
    const specialIndex = (RACE_PRIORITY as readonly string[]).indexOf("special_commons");
    expect(commonsIndex).toBeGreaterThanOrEqual(0);
    expect(specialIndex).toBe(commonsIndex + 1);
  });
});
