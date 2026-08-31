import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/general/assignments/route";

function assignment(over: Record<string, unknown> = {}) {
  return {
    theaterId: "afghan",
    generalCharacterId: "g_sub",
    inCharge: true,
    ...over,
  };
}
function req(body: unknown) {
  return new Request("http://x", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = { params: Promise.resolve({ code: "us" }) };

describe("PUT general assignments", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    // The caller is the CG of a command containing g_cg (self) and g_sub.
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "g_cg" } },
    } as never);
    db.collection("gameState");
    db.collection("militaryCommands");
    db.collection("militaryFormations");
    db.collection("militaryUnits");
    db.collection("characters");
    db.collection("characterGenerals");
    db.collection("conflicts");
    // Postings validate their theaterId against live conflicts; "afghan" is live.
    // The doc itself is read, not just counted: a posting to a PROXY war is refused
    // unless the country is already a belligerent, so the gate needs the rosters.
    // This one is an ordinary interstate war, which that narrowing must not catch.
    db.collectionMocks.conflicts.countDocuments.mockResolvedValue(1);
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      _id: "afghan",
      type: "war",
      sideA: { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" },
      sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [
        {
          id: "cmd1",
          name: "US Defense",
          commanderIds: ["g_cg", "g_sub"],
          commandingGeneralId: "g_cg",
          regionIds: [],
          unitIds: [],
        },
      ],
    });
    db.collectionMocks.militaryFormations.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([{ _id: "u1" }, { _id: "u2" }]) }),
    });
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({
        toArray: vi.fn().mockResolvedValue([
          { _id: "g_cg", name: "CG" },
          { _id: "g_sub", name: "Sub" },
          { _id: "g_outsider", name: "Outsider" },
        ]),
      }),
    });
    db.collectionMocks.characterGenerals.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { characterId: "g_cg", general: { name: "CG", spec: "armor", level: 2, traits: [] } },
        { characterId: "g_sub", general: { name: "Sub", spec: "armor", level: 1, traits: [] } },
        {
          characterId: "g_outsider",
          general: { name: "Outsider", spec: "armor", level: 1, traits: [] },
        },
      ]),
    });
  });

  it("lets a commanding general post their own subordinate", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ conflictAssignments: [assignment()] }), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.militaryFormations.updateOne).toHaveBeenCalled();
  });

  it("lets a commanding general take a front personally", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({ conflictAssignments: [assignment({ generalCharacterId: "g_cg" })] }),
      call
    );
    expect(res.status).toBe(200);
  });

  /**
   * Another commanding general's row for someone who has since emigrated or been
   * dismissed. The merged whole is validated against the live roster, so carrying
   * that row through froze EVERY commanding general in the country out of saving,
   * over a name none of them owns and none of them can reach.
   */
  it("carries other commands' postings through but drops one for a departed general", async () => {
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      conflictAssignments: [
        { theaterId: "afghan", generalCharacterId: "g_outsider", inCharge: false },
        { theaterId: "afghan", generalCharacterId: "g_departed", inCharge: false },
      ],
    });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ conflictAssignments: [assignment({ inCharge: false })] }), call);
    expect(res.status).toBe(200);
    const saved = db.collectionMocks.militaryFormations.updateOne.mock.calls[0][1].$set
      .conflictAssignments as { generalCharacterId: string }[];
    expect(saved.map((a) => a.generalCharacterId).sort()).toEqual(["g_outsider", "g_sub"]);
  });

  // The caller's OWN submission is still validated strictly: a departed general in
  // their command list is refused rather than quietly dropped.
  it("403s a commanding general whose own character has left the country", async () => {
    // The mock collection ignores the query, so the roster is narrowed by narrowing
    // BOTH reads listCountryGenerals makes.
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([{ _id: "g_sub", name: "Sub" }]) }),
    });
    db.collectionMocks.characterGenerals.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { characterId: "g_sub", general: { name: "Sub", spec: "armor", level: 1, traits: [] } },
        ]),
    });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ conflictAssignments: [assignment()] }), call);
    expect(res.status).toBe(403);
    expect(db.collectionMocks.militaryFormations.updateOne).not.toHaveBeenCalled();
  });

  it("403s a general who leads no command", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "g_sub" } },
    } as never);
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ conflictAssignments: [assignment()] }), call);
    expect(res.status).toBe(403);
    expect(db.collectionMocks.militaryFormations.updateOne).not.toHaveBeenCalled();
  });

  // A CG commands their own command, not the whole army.
  it("400s posting a general from outside the caller's command", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({ conflictAssignments: [assignment({ generalCharacterId: "g_outsider" })] }),
      call
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryFormations.updateOne).not.toHaveBeenCalled();
  });

  it("400s two theater commanders at one conflict", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({
        conflictAssignments: [
          assignment({ generalCharacterId: "g_cg", inCharge: true }),
          assignment({ generalCharacterId: "g_sub", inCharge: true }),
        ],
      }),
      call
    );
    expect(res.status).toBe(400);
  });

  it("400s an unknown theater", async () => {
    db.collectionMocks.conflicts.countDocuments.mockResolvedValue(0); // no such conflict
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({ conflictAssignments: [assignment({ theaterId: "atlantis" })] }),
      call
    );
    expect(res.status).toBe(400);
  });

  it("400s a posting to a proxy war the country has not joined", async () => {
    // `sideOf` would place the US here by backer. Posting a general is the quietest
    // of the three doors into a war the design says is entered by a bloc vote and a
    // vote of your own legislature.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      _id: "afghan",
      type: "cold_war",
      sideA: { label: "RVN", countries: [], kind: "generated", backer: "west" },
      sideB: { label: "DRV", countries: [], kind: "generated", backer: "east" },
    });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ conflictAssignments: [assignment()] }), call);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a belligerent/i);
  });

  it("allows the posting once the country is on a proxy war's roster", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      _id: "afghan",
      type: "cold_war",
      sideA: { label: "RVN", countries: ["US"], kind: "generated", backer: "west" },
      sideB: { label: "DRV", countries: [], kind: "generated", backer: "east" },
    });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ conflictAssignments: [assignment()] }), call);

    expect(res.status).toBe(200);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ conflictAssignments: [assignment()] }), call);
    expect(res.status).toBe(404);
  });

  it("400s an invalid country", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ conflictAssignments: [assignment()] }), {
      params: Promise.resolve({ code: "zz" }),
    });
    expect(res.status).toBe(400);
  });

  // Other commands' postings must survive: this CG only owns their own generals'.
  it("preserves postings belonging to generals outside the caller's command", async () => {
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      positions: {},
      conflictAssignments: [
        { theaterId: "angola", generalCharacterId: "g_outsider", inCharge: true },
      ],
    });
    const { PUT } = await import(ROUTE);
    await PUT(req({ conflictAssignments: [assignment()] }), call);
    const written = db.collectionMocks.militaryFormations.updateOne.mock.calls[0][1].$set
      .conflictAssignments as { generalCharacterId: string }[];
    expect(written.map((a) => a.generalCharacterId).sort()).toEqual(["g_outsider", "g_sub"]);
  });

  // Re-posting a general moves the units assigned to them (units follow the general).
  it("reconciles the theaters of units assigned to a re-posted general", async () => {
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      project: () => ({
        toArray: vi
          .fn()
          .mockResolvedValue([{ _id: "unitA", theaterId: "reserve", assignedGeneralId: "g_sub" }]),
      }),
    });
    const { PUT } = await import(ROUTE);
    await PUT(
      req({
        conflictAssignments: [assignment({ generalCharacterId: "g_sub", theaterId: "afghan" })],
      }),
      call
    );
    const bulk = db.collectionMocks.militaryUnits.bulkWrite.mock.calls[0][0];
    expect(bulk).toEqual([
      { updateOne: { filter: { _id: "unitA" }, update: { $set: { theaterId: "afghan" } } } },
    ]);
  });
});
