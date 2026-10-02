import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureOfficeTransition } from "@/lib/analytics/officeTransitionAnalytics";
import { ObjectId, type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type {
  CabinetMember,
  Character,
  CentralBank,
  CongressLeader,
  ElectedOfficial,
  PoliticalParty,
  StatePartyOrg,
} from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { getResignablePositions, resignAllPositions, resignPosition } from "./resignations";

vi.mock("@/lib/analytics/officeTransitionAnalytics", () => ({
  captureOfficeTransition: vi.fn().mockResolvedValue(undefined),
}));

const characterId = new ObjectId("507f1f77bcf86cd799439011");
const partyId = new ObjectId("507f1f77bcf86cd799439012");
const character = {
  _id: characterId,
  countryId: "US",
  name: "Alex Morgan",
  currentOffice: null,
} as unknown as Character;

let db: MockDb;

function setFind(collectionName: string, documents: unknown[]): void {
  const collection = db.collection(collectionName);
  collection.find.mockReturnValue(createAsyncIterableCursor(documents));
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("characters").findOne.mockResolvedValue(character);
  for (const collectionName of [
    "electedOfficials",
    "cabinetMembers",
    "statePartyOrg",
    "congressLeaders",
    "governmentFormations",
    "parliamentaryGovernments",
    "centralBanks",
    "politicalParties",
  ]) {
    setFind(collectionName, []);
  }
});

describe("getResignablePositions", () => {
  it("lists offices, PM, cabinet, party, state, legislative, and central-bank positions", async () => {
    const official = {
      _id: new ObjectId("507f1f77bcf86cd799439013"),
      countryId: "US",
      officeType: "house",
      state: "CA",
      characterId,
    } as ElectedOfficial;
    const cabinetMember = {
      _id: new ObjectId("507f1f77bcf86cd799439014"),
      countryId: "US",
      positionId: "secretary_of_state",
      characterId,
    } as CabinetMember;
    const stateOrganization = {
      _id: "US:CA:1",
      countryId: "US",
      stateId: "CA",
      partyId: "1",
      chairId: characterId,
      viceChairId: null,
      treasurerId: null,
    } as StatePartyOrg;
    const congressLeader = {
      _id: new ObjectId("507f1f77bcf86cd799439015"),
      role: "speaker_of_the_house",
      characterId,
      characterName: character.name,
    } as CongressLeader;
    const government = { _id: "UK" } as GovernmentFormation;
    const bank = {
      _id: "UK",
      countryId: "UK",
      chairCharacterId: characterId,
    } as CentralBank;
    const party = {
      _id: partyId,
      countryId: "US",
      sequentialId: 1,
      name: "National Reform Party",
      chairId: characterId,
      viceChairId: null,
      treasurerId: null,
    } as PoliticalParty;

    setFind("electedOfficials", [official]);
    setFind("cabinetMembers", [cabinetMember]);
    setFind("statePartyOrg", [stateOrganization]);
    setFind("congressLeaders", [congressLeader]);
    setFind("governmentFormations", [government]);
    setFind("centralBanks", [bank]);
    setFind("politicalParties", [party]);

    const positions = await getResignablePositions(db as unknown as Db, character);

    expect(positions.map((position) => position.id)).toEqual(
      expect.arrayContaining([
        `official:${official._id.toString()}`,
        "prime-minister:UK",
        `cabinet:${cabinetMember._id.toString()}`,
        `national-party:${partyId.toString()}:chairId`,
        "state-party:US:CA:1:chairId",
        `congress:${congressLeader._id.toString()}`,
        "central-bank:UK",
      ])
    );
    expect(positions.find((position) => position.id === "prime-minister:UK")?.label).toContain(
      "United Kingdom"
    );
    expect(
      positions.find((position) => position.id === `cabinet:${cabinetMember._id.toString()}`)?.label
    ).toContain("Secretary of State");
  });
});

describe("resignPosition", () => {
  it("captures a successful ordinary office resignation after its holder is removed", async () => {
    const official = {
      _id: new ObjectId(),
      countryId: "US",
      officeType: "house",
      characterId,
    } as ElectedOfficial;
    setFind("electedOfficials", [official]);
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 42 });

    await resignPosition(db as unknown as Db, character, `official:${official._id}`);

    expect(captureOfficeTransition).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        officeType: "house",
        transitionType: "left",
        selectionMethod: "resignation",
        nationId: "US",
        turn: 42,
      })
    );
    expect(db.collection("electedOfficials").deleteOne.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(captureOfficeTransition).mock.invocationCallOrder[0]!
    );
  });

  it("does not capture a resignation when the holder deletion loses its race", async () => {
    const official = { _id: new ObjectId(), officeType: "house", characterId } as ElectedOfficial;
    setFind("electedOfficials", [official]);
    db.collection("electedOfficials").deleteOne.mockResolvedValue({ deletedCount: 0 });

    const result = await resignPosition(db as unknown as Db, character, `official:${official._id}`);

    expect(result.ok).toBe(false);
    expect(captureOfficeTransition).not.toHaveBeenCalled();
  });

  it("contains telemetry failure after a successful cabinet resignation", async () => {
    const member = {
      _id: new ObjectId(),
      countryId: "US",
      positionId: "secretary_of_state",
      characterId,
    } as CabinetMember;
    setFind("cabinetMembers", [member]);
    vi.mocked(captureOfficeTransition).mockRejectedValueOnce(new Error("Telemetry unavailable"));

    const result = await resignPosition(db as unknown as Db, character, `cabinet:${member._id}`);

    expect(result.ok).toBe(true);
    expect(captureOfficeTransition).toHaveBeenCalledWith(
      expect.objectContaining({ officeType: "usCabinet", transitionType: "left" })
    );
  });

  it("does not capture a stale fallback current office that was not changed", async () => {
    const holder = { ...character, currentOffice: { type: "senate" } } as Character;
    db.collection("characters").findOne.mockResolvedValue(holder);
    db.collection("characters").updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    await resignPosition(db as unknown as Db, holder, "current-office");

    expect(captureOfficeTransition).not.toHaveBeenCalled();
  });

  it("resigns one national party leadership role without touching other positions", async () => {
    const party = {
      _id: partyId,
      countryId: "US",
      sequentialId: 1,
      name: "National Reform Party",
      chairId: characterId,
      viceChairId: null,
      treasurerId: null,
    } as PoliticalParty;
    setFind("politicalParties", [party]);

    const result = await resignPosition(
      db as unknown as Db,
      character,
      `national-party:${partyId.toString()}:chairId`
    );

    expect(result).toEqual({ ok: true, label: "National Reform Party: Chair" });
    expect(db.collectionMocks.politicalParties.updateOne).toHaveBeenCalledWith(
      { _id: partyId, chairId: characterId },
      { $set: { chairId: null, updatedAt: expect.any(Date) } }
    );
    expect(db.collectionMocks.electedOfficials.deleteOne).not.toHaveBeenCalled();
  });

  it("keeps a legislative office when the character is actively running in an election", async () => {
    const official = {
      _id: new ObjectId("507f1f77bcf86cd799439016"),
      countryId: "US",
      officeType: "house",
      state: "CA",
      characterId,
    } as ElectedOfficial;
    setFind("electedOfficials", [official]);
    db.collection("electionCandidates").findOne.mockResolvedValue({ _id: new ObjectId() });

    const result = await resignPosition(
      db as unknown as Db,
      character,
      `official:${official._id.toString()}`
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Cannot resign while actively running in an election.",
    });
    expect(db.collectionMocks.electedOfficials.deleteOne).not.toHaveBeenCalled();
  });
});

describe("resignAllPositions", () => {
  it("preserves the elected-seat record, matching the existing resign-all behavior", async () => {
    const official = {
      _id: new ObjectId("507f1f77bcf86cd799439017"),
      countryId: "US",
      officeType: "house",
      state: "CA",
      characterId,
    } as ElectedOfficial;
    setFind("electedOfficials", [official]);

    const result = await resignAllPositions(db as unknown as Db, character);

    expect(result.resigned).toContain("Representative (CA, 1 seat)");
    expect(db.collectionMocks.electedOfficials.updateOne).toHaveBeenCalledWith(
      { _id: official._id, characterId },
      {
        $set: { characterId: null, updatedAt: expect.any(Date) },
        $unset: { characterName: "", party: "", electedAt: "" },
      }
    );
    expect(db.collectionMocks.electedOfficials.deleteOne).not.toHaveBeenCalled();
  });
});
