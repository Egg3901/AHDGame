import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Character, State } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    effectiveNow: new Date("2026-01-15T12:00:00.000Z"),
    currentTurn: 100,
    lastTurnProcessed: new Date("2026-01-15T11:00:00.000Z"),
  }),
}));
vi.mock("@/lib/turn/partyOrg/presence", () => ({
  updatePartyPresence: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/utils/electionCandidacy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils/electionCandidacy")>(
    "@/lib/utils/electionCandidacy"
  );
  return {
    ...actual,
    withdrawAllActiveCandidacies: vi.fn().mockResolvedValue({
      withdrawnGeneralElections: 0,
      withdrawnStatePartyElections: 0,
      withdrawnNationalPartyElections: 0,
      withdrawnCommitteeElections: 0,
    }),
    cleanupPartyPositionsOnSwitch: vi.fn().mockResolvedValue({
      clearedNationalLeadership: [],
      clearedStateLeadership: [],
      removedFromCommittee: false,
      withdrawnStateElections: 0,
      withdrawnNationalElections: 0,
      withdrawnCommitteeElections: 0,
    }),
  };
});
vi.mock("@/lib/caucus/cleanupCaucusParticipationForCharacters", () => ({
  cleanupCaucusParticipationForCharacters: vi.fn().mockResolvedValue({
    candidaciesWithdrawn: 0,
    votesDeleted: 0,
    membershipsClosed: 0,
    factionIdsCleared: 0,
    chairSeatsCleared: 0,
    viceChairSeatsCleared: 0,
  }),
}));

vi.mock("@/lib/military/severFromChainOfCommand", () => ({
  severFromChainOfCommand: vi.fn().mockResolvedValue({ led: [], changed: false }),
}));

import { performRelocation } from "./performRelocation";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import { severFromChainOfCommand } from "@/lib/military/severFromChainOfCommand";

function makeCharacter(overrides: Partial<Character> = {}): Character {
  const now = new Date();
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    countryId: "US",
    name: "Jane Doe",
    homeState: "CA",
    politicalInfluence: 50,
    nationalInfluence: 30,
    partyInfluence: 20,
    favorability: 60,
    infamy: 0,
    funds: 10000,
    actions: 10,
    donorBaseLevel: 4,
    policies: { economic: 0, social: 0 },
    party: "1",
    currentOffice: null,
    groupFavorability: { union: 10 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeState(id: string, countryId: "US" | "UK" = "US"): State {
  return { _id: id, name: id, countryId } as State;
}

describe("performRelocation", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    db.collection("characters");
    db.collection("electedOfficials");
    db.collection("corporations");
    db.collection("centralBanks");
    db.collection("statePartyOrg");
    db.collection("politicalParties");

    db.collectionMocks.corporations!.findOne.mockResolvedValue(null);
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue(null);
    db.collectionMocks.statePartyOrg!.findOne.mockResolvedValue(null);
    db.collectionMocks.politicalParties!.findOne.mockResolvedValue(null);
  });

  it("same-country move: preserves party, nationalInfluence, partyInfluence; resets politicalInfluence + donor base", async () => {
    const character = makeCharacter();
    const target = makeState("TX");

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.countryChanged).toBe(false);
    const updateCall = db.collectionMocks.characters!.updateOne.mock.calls.at(-1)!;
    const setOp = (updateCall[1] as { $set: Partial<Character> }).$set;
    expect(setOp.homeState).toBe("TX");
    expect(setOp.countryId).toBe("US");
    expect(setOp.politicalInfluence).toBe(0);
    expect(setOp.donorBaseLevel).toBe(0);
    expect(setOp.groupFavorability).toEqual({});
    expect(setOp).not.toHaveProperty("nationalInfluence");
    expect(setOp).not.toHaveProperty("partyInfluence");
    expect(setOp).not.toHaveProperty("party");
  });

  it("cross-country move: resets party to independent, zeroes nationalInfluence + partyInfluence", async () => {
    const character = makeCharacter({ countryId: "US", party: "1" });
    const target = makeState("LON", "UK");

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.countryChanged).toBe(true);
    const updateCall = db.collectionMocks.characters!.updateOne.mock.calls.at(-1)!;
    const setOp = (updateCall[1] as { $set: Partial<Character> }).$set;
    expect(setOp.countryId).toBe("UK");
    expect(setOp.party).toBe("independent");
    expect(setOp.nationalInfluence).toBe(0);
    expect(setOp.partyInfluence).toBe(0);
  });

  /**
   * A saved command holds a CHARACTER id and `requireCommandingGeneral` reads
   * authority straight off it, so a commanding general who moved abroad kept
   * posting their old country's generals — the same class of stale-appointment
   * bug the cabinet-record deletion above already guards against.
   */
  describe("leaving the old country's chain of command", () => {
    // The outer beforeEach rebuilds the db but not the module mocks, and the
    // cross-country cases above have already called this one.
    beforeEach(() => vi.mocked(severFromChainOfCommand).mockClear());

    it("severs the character from the country they left, not the one they joined", async () => {
      const character = makeCharacter({ countryId: "US" });

      const outcome = await performRelocation(
        db as unknown as Db,
        character,
        makeState("LON", "UK")
      );

      expect(severFromChainOfCommand).toHaveBeenCalledWith(db, "US", character._id.toString());
      expect(outcome.relinquishedCommands).toEqual([]);
    });

    it("reports the commands they led so the move can say what it cost", async () => {
      vi.mocked(severFromChainOfCommand).mockResolvedValueOnce({
        led: ["USINDCOM"],
        changed: true,
      });

      const outcome = await performRelocation(
        db as unknown as Db,
        makeCharacter({ countryId: "US" }),
        makeState("LON", "UK")
      );

      expect(outcome.relinquishedCommands).toEqual(["USINDCOM"]);
    });

    // Moving house does not cost you your command; moving country does.
    it("leaves the chain of command alone on a same-country move", async () => {
      await performRelocation(db as unknown as Db, makeCharacter(), makeState("TX"));

      expect(severFromChainOfCommand).not.toHaveBeenCalled();
    });
  });

  it("always appends a careerHistory entry for the move", async () => {
    const character = makeCharacter();
    const target = makeState("TX");

    await performRelocation(db as unknown as Db, character, target);

    const updateCall = db.collectionMocks.characters!.updateOne.mock.calls.at(-1)!;
    const pushOp = (
      updateCall[1] as {
        $push: { careerHistory: { type: string; fromState: string; toState: string } };
      }
    ).$push;
    expect(pushOp.careerHistory.type).toBe("relocated");
    expect(pushOp.careerHistory.fromState).toBe("CA");
    expect(pushOp.careerHistory.toState).toBe("TX");
  });

  it("strips old-state party leadership even on same-country move", async () => {
    const character = makeCharacter({ party: "1" });
    const target = makeState("TX");
    db.collectionMocks.statePartyOrg!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      chairId: character._id,
    });

    await performRelocation(db as unknown as Db, character, target);

    const sporgUpdate = db.collectionMocks.statePartyOrg!.updateOne.mock.calls.at(-1);
    expect(sporgUpdate).toBeDefined();
    const setOp = (sporgUpdate![1] as { $set: Record<string, unknown> }).$set;
    expect(setOp.chairId).toBeNull();
  });

  it("fully resets donor base regardless of prior value", async () => {
    for (const prior of [0, 1, 4, 10, 100]) {
      db.collectionMocks.characters!.updateOne.mockClear();
      const character = makeCharacter({ donorBaseLevel: prior });
      await performRelocation(db as unknown as Db, character, makeState("TX"));
      const updateCall = db.collectionMocks.characters!.updateOne.mock.calls.at(-1)!;
      const setOp = (updateCall[1] as { $set: Partial<Character> }).$set;
      expect(setOp.donorBaseLevel).toBe(0);
    }
  });

  it("auto-resigns from state-bound currentOffice on same-country move", async () => {
    const character = makeCharacter({
      currentOffice: { type: "house", state: "CA", seatsHeld: 1 },
    });
    const target = makeState("TX");

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.resignedFromOffice).toBe("house (CA)");
    expect(db.collectionMocks.electedOfficials!.updateOne).toHaveBeenCalled();
  });

  it("keeps country-scoped offices (VP) on same-country move (ticket #1057)", async () => {
    const character = makeCharacter({
      currentOffice: { type: "vicePresident" },
    });
    const target = makeState("TX");

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.resignedFromOffice).toBeNull();
    expect(db.collectionMocks.electedOfficials!.updateOne).not.toHaveBeenCalled();
    const updateCall = db.collectionMocks.characters!.updateOne.mock.calls.at(-1)!;
    const setOp = (updateCall[1] as { $set: Partial<Character> }).$set;
    expect(setOp).not.toHaveProperty("currentOffice");
  });

  it("keeps President on same-country move", async () => {
    const character = makeCharacter({
      currentOffice: { type: "president" },
    });
    const target = makeState("NY");

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.resignedFromOffice).toBeNull();
    expect(db.collectionMocks.electedOfficials!.updateOne).not.toHaveBeenCalled();
  });

  it("keeps cabinet office on same-country move", async () => {
    const character = makeCharacter({
      currentOffice: { type: "usCabinet", positionId: "secretary_of_state" },
    });
    const target = makeState("TX");

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.resignedFromOffice).toBeNull();
    expect(db.collectionMocks.electedOfficials!.updateOne).not.toHaveBeenCalled();
  });

  it("resigns VP on cross-country move", async () => {
    const character = makeCharacter({
      currentOffice: { type: "vicePresident" },
    });
    const target = makeState("LON", "UK");

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.resignedFromOffice).toBe("vicePresident");
    expect(db.collectionMocks.electedOfficials!.updateOne).toHaveBeenCalled();
  });

  it("skipCeoResignForCorpId: leaves the named corp's CEO in place", async () => {
    const characterId = new ObjectId();
    const character = makeCharacter({ _id: characterId });
    const target = makeState("TX");
    const keepCorpId = new ObjectId();
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: keepCorpId,
      name: "KeepCo",
      ceoId: characterId,
      ceoVacant: false,
    });

    const outcome = await performRelocation(db as unknown as Db, character, target, {
      skipCeoResignForCorpId: keepCorpId,
    });

    expect(outcome.ceoResignedFrom).toBeNull();
    expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
  });

  it("NatCorp CEO: a same-country move keeps them seated (relaxed country-level residency)", async () => {
    const characterId = new ObjectId();
    const character = makeCharacter({ _id: characterId });
    const target = makeState("TX"); // same country
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "China",
      ceoId: characterId,
      ceoVacant: false,
      countryOwnerId: "US",
      countryId: "US",
    });

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.ceoResignedFrom).toBeNull();
    expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
  });

  it("NatCorp CEO: a cross-country move still resigns them (country residency broken)", async () => {
    const characterId = new ObjectId();
    const character = makeCharacter({ _id: characterId, countryId: "US" });
    const target = makeState("LON", "UK");
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "China",
      ceoId: characterId,
      ceoVacant: false,
      countryOwnerId: "US",
      countryId: "US",
    });

    const outcome = await performRelocation(db as unknown as Db, character, target);

    expect(outcome.ceoResignedFrom).toBe("China");
    expect(db.collectionMocks.corporations!.updateOne).toHaveBeenCalled();
  });

  it("cross-country move: clears caucus participation including factionId (bug #0552)", async () => {
    vi.mocked(cleanupCaucusParticipationForCharacters).mockClear();
    const characterId = new ObjectId();
    const character = makeCharacter({ _id: characterId, countryId: "US", party: "1" });
    const target = makeState("LON", "UK");

    await performRelocation(db as unknown as Db, character, target);

    expect(cleanupCaucusParticipationForCharacters).toHaveBeenCalledWith(
      db as unknown as Db,
      [characterId],
      expect.objectContaining({ removeMembership: true, membershipStatus: "left" })
    );
  });

  it("same-country move: does NOT touch caucus participation (caucus stays valid)", async () => {
    vi.mocked(cleanupCaucusParticipationForCharacters).mockClear();
    const character = makeCharacter();
    const target = makeState("TX");

    await performRelocation(db as unknown as Db, character, target);

    expect(cleanupCaucusParticipationForCharacters).not.toHaveBeenCalled();
  });

  it("skipCeoResignForCorpId: different id still resigns", async () => {
    const characterId = new ObjectId();
    const character = makeCharacter({ _id: characterId });
    const target = makeState("TX");
    const otherCorpId = new ObjectId();
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: otherCorpId,
      name: "OtherCo",
      ceoId: characterId,
      ceoVacant: false,
    });

    const outcome = await performRelocation(db as unknown as Db, character, target, {
      skipCeoResignForCorpId: new ObjectId(),
    });

    expect(outcome.ceoResignedFrom).toBe("OtherCo");
    expect(db.collectionMocks.corporations!.updateOne).toHaveBeenCalled();
  });
});
