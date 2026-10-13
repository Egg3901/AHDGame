import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/generals/[characterId]/route";

const GENERAL_ID = new ObjectId().toString();
const SECOND_GENERAL_ID = new ObjectId().toString();

const req = () => new Request("http://x", { method: "DELETE" });
const call = (characterId = GENERAL_ID) => ({
  params: Promise.resolve({ code: "us", positionId: "secretary_of_defense", characterId }),
});

describe("DELETE dismiss a general", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "secdef" } },
    } as never);
    db.collection("characters");
    db.collectionMocks.characters.findOne.mockResolvedValue({ _id: new ObjectId(GENERAL_ID) });
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("characterGenerals");
    db.collection("militaryCommands");
    db.collection("militaryFormations");
    db.collection("militaryUnits");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: true,
      currentTurn: 40,
    });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "secdef",
    });
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: GENERAL_ID,
      general: { spec: "armor", level: 4, xp: 30, traits: ["breakthrough"], pts: 1 },
      commissioned: true,
    });
    db.collectionMocks.characterGenerals.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [
        {
          id: "cmd1",
          commanderIds: [GENERAL_ID, SECOND_GENERAL_ID],
          commandingGeneralId: GENERAL_ID,
          regionIds: [],
          unitIds: [],
        },
      ],
    });
    db.collectionMocks.militaryCommands.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      positions: {},
      conflictAssignments: [
        { theaterId: "afghan", generalCharacterId: GENERAL_ID, inCharge: true },
        { theaterId: "afghan", generalCharacterId: SECOND_GENERAL_ID, inCharge: false },
      ],
    });
    db.collectionMocks.militaryFormations.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.militaryUnits.updateMany.mockResolvedValue({ matchedCount: 1 });
  });

  it.each([true, false])("refuses a target outside the country when acting=%s", async (acting) => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "secdef",
      acting,
    });
    // The country-scoped lookup finds no domestic target, even though the global
    // commission lookup would still find a serving general.
    db.collectionMocks.characters.findOne.mockResolvedValue(null);
    const { DELETE } = await import(ROUTE);
    expect((await DELETE(req(), call())).status).toBe(404);
    expect(db.collectionMocks.characters.findOne).toHaveBeenCalledWith(
      { _id: new ObjectId(GENERAL_ID), countryId: "US" },
      { projection: { _id: 1 } }
    );
    expect(db.collectionMocks.characterGenerals.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.militaryFormations.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.militaryUnits.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a malformed target id before reading or writing target state", async () => {
    const { DELETE } = await import(ROUTE);
    expect((await DELETE(req(), call("not-an-id"))).status).toBe(400);
    expect(db.collectionMocks.characters.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
  });

  const commandsWritten = () =>
    db.collectionMocks.militaryCommands.updateOne.mock.calls[0][1].$set.commands;
  const assignmentsWritten = () =>
    db.collectionMocks.militaryFormations.updateOne.mock.calls[0][1].$set.conflictAssignments;

  it("clears the commission but retains the record for re-appointment", async () => {
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call(GENERAL_ID));
    expect(res.status).toBe(200);
    const update = db.collectionMocks.characterGenerals.updateOne.mock.calls[0][1];
    expect(update.$set.commissioned).toBe(false);
    expect(update.$set.dismissedTurn).toBe(40);
    // The career survives the dismissal.
    expect(update.$set.general).toBeUndefined();
    expect(update.$unset).toBeUndefined();
  });

  it("drops the dismissed general from their command and clears the lead", async () => {
    const { DELETE } = await import(ROUTE);
    await DELETE(req(), call(GENERAL_ID));
    expect(commandsWritten()[0].commanderIds).toEqual([SECOND_GENERAL_ID]);
    expect(commandsWritten()[0].commandingGeneralId).toBeNull();
  });

  // Dismissing a theater commander vacates that front; W7 made the TC the only actor
  // who may declare there, so authority falls back to the defense holder.
  it("drops their postings and leaves the front without a theater commander", async () => {
    const { DELETE } = await import(ROUTE);
    await DELETE(req(), call(GENERAL_ID));
    const written = assignmentsWritten() as { generalCharacterId: string; inCharge: boolean }[];
    expect(written.map((a) => a.generalCharacterId)).toEqual([SECOND_GENERAL_ID]);
    expect(written.some((a) => a.inCharge)).toBe(false);
  });

  // A dismissed general keeps no forces: their units fall to General Staff / reserve.
  it("frees the dismissed general's units to reserve", async () => {
    const { DELETE } = await import(ROUTE);
    await DELETE(req(), call(GENERAL_ID));
    expect(db.collectionMocks.militaryUnits.updateMany).toHaveBeenCalledWith(
      { countryId: "US", assignedGeneralId: GENERAL_ID },
      { $set: { assignedGeneralId: null, theaterId: "reserve" } }
    );
  });

  it("404s a character who is not a commissioned general", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue(null);
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call(new ObjectId().toString()));
    expect(res.status).toBe(404);
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
  });

  it("404s an already-dismissed general", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: GENERAL_ID,
      general: { spec: "armor", level: 4, xp: 0, traits: [], pts: 0 },
      commissioned: false,
    });
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call(GENERAL_ID));
    expect(res.status).toBe(404);
  });

  it("403s a non-holder non-admin", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: false,
      currentTurn: 40,
    });
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "nobody" } },
    } as never);
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call(GENERAL_ID));
    expect(res.status).toBe(403);
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
  });

  it("dismisses a general when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: false,
      currentTurn: 40,
    });
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call(GENERAL_ID));
    expect(res.status).toBe(200);
    expect(db.collectionMocks.characterGenerals.updateOne).toHaveBeenCalled();
  });
});
