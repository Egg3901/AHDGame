import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const notifySpy = vi.fn();
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...a: unknown[]) => {
    notifySpy(...a);
    return Promise.resolve();
  },
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/commands/route";

function command(over: Record<string, unknown> = {}) {
  return {
    id: "a",
    name: "A",
    type: "REGIONAL",
    commanderIds: [],
    commandingGeneralId: null,
    regionIds: ["mea"],
    spec: "Joint Operations",
    posture: "Deterrence",
    supply: "High",
    readiness: "Alert",
    cap: 20,
    base: 80,
    political: "Low",
    branchFocus: "Army",
    unitIds: ["u1"],
    role: "role",
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
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("PUT commands", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("militaryUnits");
    db.collection("militaryCommands");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: true });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([{ _id: "u1" }, { _id: "u2" }]) }),
    });
    db.collectionMocks.militaryCommands.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it("saves a valid command structure (upsert)", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ commands: [command()] }), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.militaryCommands.updateOne).toHaveBeenCalled();
  });

  it("400s a unit not belonging to the country without writing", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ commands: [command({ unitIds: ["foreign"] })] }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
  });

  it("400s a unit assigned to two commands", async () => {
    const { PUT } = await import(ROUTE);
    const body = {
      commands: [command({ id: "a", unitIds: ["u1"] }), command({ id: "b", unitIds: ["u1"] })],
    };
    const res = await PUT(req(body), call);
    expect(res.status).toBe(400);
  });

  it("403s a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ commands: [command()] }), call);
    expect(res.status).toBe(403);
  });

  it("404s when conflicts is disabled", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ conflictsEnabled: false });
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ commands: [command()] }), call);
    expect(res.status).toBe(404);
  });

  // Commanders must be the country's real commissioned generals (character ids).
  function withGenerals() {
    db.collection("characters");
    db.collection("characterGenerals");
    db.collectionMocks.characters.find.mockReturnValue({
      project: () => ({
        toArray: vi.fn().mockResolvedValue([{ _id: "char_9", name: "Gen. Real" }]),
      }),
    });
    db.collectionMocks.characterGenerals.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          characterId: "char_9",
          general: { name: "Gen. Real", spec: "armor", level: 2, traits: [] },
        },
      ]),
    });
  }

  it("accepts a commander that is a real commissioned general", async () => {
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ commands: [command({ commanderIds: ["char_9"] })] }), call);
    expect(res.status).toBe(200);
  });

  it("400s a commander who is not a commissioned general of the country", async () => {
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(req({ commands: [command({ commanderIds: ["stranger"] })] }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
  });

  it("accepts a commanding general drawn from the command's own commanders", async () => {
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({ commands: [command({ commanderIds: ["char_9"], commandingGeneralId: "char_9" })] }),
      call
    );
    expect(res.status).toBe(200);
  });

  it("accepts a null commanding general (a command with no lead)", async () => {
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({ commands: [command({ commanderIds: ["char_9"], commandingGeneralId: null })] }),
      call
    );
    expect(res.status).toBe(200);
  });

  it("400s a commanding general who is not a commander of that command", async () => {
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({ commands: [command({ commanderIds: [], commandingGeneralId: "char_9" })] }),
      call
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
  });

  it("400s the SAME general leading two commands", async () => {
    // The CG page resolves the viewer's command with commands.find(...), which
    // returns the FIRST match — so a general leading two would silently be able to
    // operate only one, and the other command's generals could never be posted to a
    // conflict at all. Its units would exist and never reach a front.
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({
        commands: [
          command({
            id: "a",
            unitIds: ["u1"],
            commanderIds: ["char_9"],
            commandingGeneralId: "char_9",
          }),
          command({
            id: "b",
            unitIds: ["u2"],
            commanderIds: ["char_9"],
            commandingGeneralId: "char_9",
          }),
        ],
      }),
      call
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/one command/i);
    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
  });

  it("allows the same general to COMMAND in two commands, only not to LEAD both", async () => {
    // Sitting on two rosters is not the problem; being the single point of control
    // for two is. Only commandingGeneralId is constrained.
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({
        commands: [
          command({
            id: "a",
            unitIds: ["u1"],
            commanderIds: ["char_9"],
            commandingGeneralId: "char_9",
          }),
          command({
            id: "b",
            unitIds: ["u2"],
            commanderIds: ["char_9"],
            commandingGeneralId: null,
          }),
        ],
      }),
      call
    );
    expect(res.status).toBe(200);
  });

  it("does not mistake two null leads for a duplicate", async () => {
    // null is the ordinary state of an unled command; two of them must not collide.
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({
        commands: [
          command({
            id: "a",
            unitIds: ["u1"],
            commanderIds: ["char_9"],
            commandingGeneralId: null,
          }),
          command({
            id: "b",
            unitIds: ["u2"],
            commanderIds: ["char_9"],
            commandingGeneralId: null,
          }),
        ],
      }),
      call
    );
    expect(res.status).toBe(200);
  });

  it("400s a commanding general who is not a general of this country", async () => {
    withGenerals();
    const { PUT } = await import(ROUTE);
    const res = await PUT(
      req({ commands: [command({ commanderIds: ["ghost"], commandingGeneralId: "ghost" })] }),
      call
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
  });

  describe("notifying a new Commanding General", () => {
    const CG = "507f1f77bcf86cd799439011";
    const USER = "507f191e810c19729de860ea";

    /** Generals whose ids are real ObjectId strings, plus the character→user lookup. */
    function withRealIds(previousCommands: unknown[] = []) {
      db.collection("characters");
      db.collection("characterGenerals");
      db.collectionMocks.characters.find.mockReturnValue({
        project: () => ({
          toArray: vi.fn().mockResolvedValue([{ _id: CG, name: "Gen. Real", userId: USER }]),
        }),
      });
      db.collectionMocks.characterGenerals.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            characterId: CG,
            general: { name: "Gen. Real", spec: "armor", level: 2, traits: [] },
          },
        ]),
      });
      db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
        countryId: "US",
        commands: previousCommands,
      });
    }

    it("notifies the general newly named CG", async () => {
      withRealIds();
      const { PUT } = await import(ROUTE);
      await PUT(
        req({ commands: [command({ commanderIds: [CG], commandingGeneralId: CG })] }),
        call
      );
      expect(notifySpy).toHaveBeenCalled();
      const inputs = notifySpy.mock.calls[0][0];
      expect(inputs).toHaveLength(1);
      expect(String(inputs[0].userId)).toBe(USER);
      expect(inputs[0].type).toBe("command_appointed");
      // The message must name the page — a new CG otherwise has no route to it.
      expect(inputs[0].message).toMatch(/command page/i);
      expect(inputs[0].metadata.href).toBe("/country/us/general/commands");
    });

    it("does NOT re-notify when the same CG is saved again", async () => {
      // This route is client-authoritative and debounced: it re-sends the whole array
      // on every edit. Notifying on presence rather than CHANGE would ping the same
      // player on every keystroke.
      withRealIds([{ id: "a", name: "A", commandingGeneralId: CG }]);
      const { PUT } = await import(ROUTE);
      await PUT(
        req({ commands: [command({ id: "a", commanderIds: [CG], commandingGeneralId: CG })] }),
        call
      );
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it("notifies when the lead CHANGES on an existing command", async () => {
      withRealIds([{ id: "a", name: "A", commandingGeneralId: "someone_else" }]);
      const { PUT } = await import(ROUTE);
      await PUT(
        req({ commands: [command({ id: "a", commanderIds: [CG], commandingGeneralId: CG })] }),
        call
      );
      expect(notifySpy).toHaveBeenCalled();
    });

    it("sends nothing when a command is saved with no lead", async () => {
      withRealIds();
      const { PUT } = await import(ROUTE);
      await PUT(
        req({ commands: [command({ commanderIds: [CG], commandingGeneralId: null })] }),
        call
      );
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it("does not throw on a character id that is not an ObjectId", async () => {
      // new ObjectId(bad) throws; that must never fail the save the Secretary made.
      withGenerals();
      db.collectionMocks.militaryCommands.findOne.mockResolvedValue(null);
      const { PUT } = await import(ROUTE);
      const res = await PUT(
        req({ commands: [command({ commanderIds: ["char_9"], commandingGeneralId: "char_9" })] }),
        call
      );
      expect(res.status).toBe(200);
    });
  });
});
