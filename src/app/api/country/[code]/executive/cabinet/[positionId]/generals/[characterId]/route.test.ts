import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/generals/[characterId]/route";

const req = () => new Request("http://x", { method: "DELETE" });
const call = (characterId = "g1") => ({
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
      characterId: "g1",
      general: { spec: "armor", level: 4, xp: 30, traits: ["breakthrough"], pts: 1 },
      commissioned: true,
    });
    db.collectionMocks.characterGenerals.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [
        {
          id: "cmd1",
          commanderIds: ["g1", "g2"],
          commandingGeneralId: "g1",
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
        { theaterId: "afghan", generalCharacterId: "g1", inCharge: true },
        { theaterId: "afghan", generalCharacterId: "g2", inCharge: false },
      ],
    });
    db.collectionMocks.militaryFormations.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.militaryUnits.updateMany.mockResolvedValue({ matchedCount: 1 });
  });

  const commandsWritten = () =>
    db.collectionMocks.militaryCommands.updateOne.mock.calls[0][1].$set.commands;
  const assignmentsWritten = () =>
    db.collectionMocks.militaryFormations.updateOne.mock.calls[0][1].$set.conflictAssignments;

  it("clears the commission but retains the record for re-appointment", async () => {
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call("g1"));
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
    await DELETE(req(), call("g1"));
    expect(commandsWritten()[0].commanderIds).toEqual(["g2"]);
    expect(commandsWritten()[0].commandingGeneralId).toBeNull();
  });

  // Dismissing a theater commander vacates that front; W7 made the TC the only actor
  // who may declare there, so authority falls back to the defense holder.
  it("drops their postings and leaves the front without a theater commander", async () => {
    const { DELETE } = await import(ROUTE);
    await DELETE(req(), call("g1"));
    const written = assignmentsWritten() as { generalCharacterId: string; inCharge: boolean }[];
    expect(written.map((a) => a.generalCharacterId)).toEqual(["g2"]);
    expect(written.some((a) => a.inCharge)).toBe(false);
  });

  // A dismissed general keeps no forces: their units fall to General Staff / reserve.
  it("frees the dismissed general's units to reserve", async () => {
    const { DELETE } = await import(ROUTE);
    await DELETE(req(), call("g1"));
    expect(db.collectionMocks.militaryUnits.updateMany).toHaveBeenCalledWith(
      { countryId: "US", assignedGeneralId: "g1" },
      { $set: { assignedGeneralId: null, theaterId: "reserve" } }
    );
  });

  it("404s a character who is not a commissioned general", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue(null);
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call("nobody"));
    expect(res.status).toBe(404);
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
  });

  it("404s an already-dismissed general", async () => {
    db.collectionMocks.characterGenerals.findOne.mockResolvedValue({
      characterId: "g1",
      general: { spec: "armor", level: 4, xp: 0, traits: [], pts: 0 },
      commissioned: false,
    });
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call("g1"));
    expect(res.status).toBe(404);
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "nobody" } },
    } as never);
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call("g1"));
    expect(res.status).toBe(403);
    expect(db.collectionMocks.characterGenerals.updateOne).not.toHaveBeenCalled();
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(req(), call("g1"));
    expect(res.status).toBe(404);
  });
});
