import type { Db } from "mongodb";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { MilitaryCommand } from "../types";
import type { ConflictAssignment } from "../assignments";
import { severFromChainOfCommand } from "../severFromChainOfCommand";

function command(over: Partial<MilitaryCommand> = {}): MilitaryCommand {
  return {
    id: "cmd1",
    name: "Central Command",
    type: "REGIONAL",
    commanderIds: [],
    commandingGeneralId: null,
    regionIds: [],
    spec: "Regional Command",
    posture: "Deterrence",
    supply: "Normal",
    readiness: "Alert",
    cap: 20,
    base: 60,
    political: "Medium",
    branchFocus: "Combined",
    unitIds: [],
    role: "role",
    ...over,
  };
}

function setup(opts: {
  commands?: MilitaryCommand[];
  assignments?: ConflictAssignment[];
  unitCount?: number;
}) {
  const db = createMockDb() as unknown as MockDb;
  db.collection("militaryCommands");
  db.collection("militaryFormations");
  db.collection("militaryUnits");
  db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
    countryId: "RU",
    commands: opts.commands ?? [],
  });
  db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
    countryId: "RU",
    conflictAssignments: opts.assignments ?? [],
  });
  db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(opts.unitCount ?? 0);
  return db;
}

const sever = (db: MockDb, characterId = "gone") =>
  severFromChainOfCommand(db as unknown as Db, "RU", characterId);

/** The commands array the helper wrote back. */
function savedCommands(db: MockDb): MilitaryCommand[] {
  const call = db.collectionMocks.militaryCommands.updateOne.mock.calls.at(-1)!;
  return (call[1] as { $set: { commands: MilitaryCommand[] } }).$set.commands;
}

/** The postings array the helper wrote back. */
function savedAssignments(db: MockDb): ConflictAssignment[] {
  const call = db.collectionMocks.militaryFormations.updateOne.mock.calls.at(-1)!;
  return (call[1] as { $set: { conflictAssignments: ConflictAssignment[] } }).$set
    .conflictAssignments;
}

describe("severFromChainOfCommand", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes the character off every command roster", async () => {
    const db = setup({
      commands: [
        command({ id: "cmd1", commanderIds: ["stays", "gone"] }),
        command({ id: "cmd2", commanderIds: ["gone"] }),
        command({ id: "cmd3", commanderIds: ["stays"] }),
      ],
    });

    const ties = await sever(db);

    expect(savedCommands(db).map((c) => c.commanderIds)).toEqual([["stays"], [], ["stays"]]);
    expect(ties.changed).toBe(true);
  });

  // A command whose lead is not one of its own commanders violates the commands
  // route's invariant, so the two have to move together.
  it("clears the lead of any command they led", async () => {
    const db = setup({
      commands: [command({ commanderIds: ["gone", "stays"], commandingGeneralId: "gone" })],
    });

    const ties = await sever(db);

    expect(savedCommands(db)[0].commandingGeneralId).toBeNull();
    expect(savedCommands(db)[0].commanderIds).toEqual(["stays"]);
    expect(ties.led).toEqual(["Central Command"]);
  });

  it("leaves a lead who is somebody else alone", async () => {
    const db = setup({
      commands: [command({ commanderIds: ["gone", "stays"], commandingGeneralId: "stays" })],
    });

    const ties = await sever(db);

    expect(savedCommands(db)[0].commandingGeneralId).toBe("stays");
    expect(ties.led).toEqual([]);
  });

  it("drops their conflict postings and keeps everyone else's", async () => {
    const db = setup({
      commands: [command({ commanderIds: ["gone"] })],
      assignments: [
        { theaterId: "front-1", generalCharacterId: "gone", inCharge: true },
        { theaterId: "front-1", generalCharacterId: "stays", inCharge: false },
      ],
    });

    await sever(db);

    expect(savedAssignments(db)).toEqual([
      { theaterId: "front-1", generalCharacterId: "stays", inCharge: false },
    ]);
  });

  it("hands their units back to the General Staff, in reserve", async () => {
    const db = setup({ commands: [command({ commanderIds: ["gone"] })], unitCount: 3 });

    await sever(db);

    const [filter, update] = db.collectionMocks.militaryUnits.updateMany.mock.calls.at(-1)!;
    expect(filter).toEqual({ countryId: "RU", assignedGeneralId: "gone" });
    expect((update as { $set: Record<string, unknown> }).$set).toEqual({
      assignedGeneralId: null,
      theaterId: "reserve",
    });
  });

  // Relocation calls this for EVERY cross-country move, and almost nobody has ever
  // commanded anything. Writing three documents each time would be pure noise.
  it("writes nothing when the character held nothing", async () => {
    const db = setup({ commands: [command({ commanderIds: ["stays"] })] });

    const ties = await sever(db);

    expect(ties.changed).toBe(false);
    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.militaryFormations.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.militaryUnits.updateMany).not.toHaveBeenCalled();
  });

  // A unit can be assigned to a general who sits on no command at all, so the unit
  // count cannot be inferred from the rosters.
  it("severs units even when the character is on no command and holds no posting", async () => {
    const db = setup({ commands: [command({ commanderIds: ["stays"] })], unitCount: 2 });

    const ties = await sever(db);

    expect(ties.changed).toBe(true);
    expect(db.collectionMocks.militaryUnits.updateMany).toHaveBeenCalled();
  });

  it("severs a posting held by someone on no command", async () => {
    const db = setup({
      assignments: [{ theaterId: "front-1", generalCharacterId: "gone", inCharge: false }],
    });

    const ties = await sever(db);

    expect(ties.changed).toBe(true);
    expect(savedAssignments(db)).toEqual([]);
  });

  it("is a no-op the second time", async () => {
    const db = setup({
      commands: [command({ commanderIds: ["gone", "stays"], commandingGeneralId: "gone" })],
      assignments: [{ theaterId: "front-1", generalCharacterId: "gone", inCharge: true }],
      unitCount: 1,
    });
    await sever(db);
    const commands = savedCommands(db);
    const assignments = savedAssignments(db);

    const second = setup({ commands, assignments, unitCount: 0 });
    const ties = await sever(second);

    expect(ties.changed).toBe(false);
    expect(second.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
  });
});
