import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { MilitaryCommand } from "@/lib/military/types";
import { migration } from "./2026-08-26-drop-off-roster-command-commanders";

function command(over: Partial<MilitaryCommand> = {}): MilitaryCommand {
  return {
    id: "cmd1",
    name: "Command Post 1",
    type: "REGIONAL",
    commanderIds: [],
    commandingGeneralId: null,
    regionIds: [],
    spec: "Regional Command",
    posture: "Deterrence",
    supply: "Normal",
    readiness: "Forming",
    cap: 20,
    base: 60,
    political: "Medium",
    branchFocus: "Combined",
    unitIds: [],
    role: "role",
    ...over,
  };
}

/**
 * @param roster character ids the country's commissioned-general roster holds.
 *   `listCountryGenerals` reads characters then characterGenerals, and the mock
 *   collection ignores the query, so both reads are narrowed together.
 */
function setup(docs: { countryId: string; commands: MilitaryCommand[] }[], roster: string[]) {
  const db = createMockDb() as unknown as MockDb;
  db.collection("militaryCommands");
  db.collection("characters");
  db.collection("characterGenerals");

  db.collectionMocks.militaryCommands.find.mockReturnValue({
    project: () => ({ toArray: async () => docs.map((d) => ({ countryId: d.countryId })) }),
    toArray: async () => docs.map((d) => ({ countryId: d.countryId })),
  });
  db.collectionMocks.militaryCommands.findOne.mockImplementation(
    async (filter: { countryId: string }) => docs.find((d) => d.countryId === filter.countryId)
  );
  db.collectionMocks.characters.find.mockReturnValue({
    project: () => ({ toArray: async () => roster.map((id) => ({ _id: id, name: `Gen ${id}` })) }),
  });
  db.collectionMocks.characterGenerals.find.mockReturnValue({
    toArray: async () =>
      roster.map((id) => ({
        characterId: id,
        commissioned: true,
        general: { level: 2, name: id },
      })),
  });
  return db;
}

const run = (db: MockDb, dryRun = false) => migration.execute(db as unknown as Db, { dryRun });

describe("2026-08-26-drop-off-roster-command-commanders", () => {
  it("drops a commander whose character has left the country, and clears their lead", async () => {
    const db = setup(
      [
        {
          countryId: "RU",
          commands: [command({ commanderIds: ["gone"], commandingGeneralId: "gone" })],
        },
      ],
      ["stays"]
    );

    const result = await run(db);

    const [filter, update] = db.collectionMocks.militaryCommands.updateOne.mock.calls[0];
    expect(filter).toEqual({ countryId: "RU" });
    const saved = (update as { $set: { commands: MilitaryCommand[] } }).$set.commands;
    expect(saved[0].commanderIds).toEqual([]);
    expect(saved[0].commandingGeneralId).toBeNull();
    expect(result.documentsUpdated).toBe(1);
    expect(result.notes?.join(" ")).toMatch(/RU: dropped 1 commander/);
  });

  it("keeps the commanders the country still has", async () => {
    const db = setup(
      [
        {
          countryId: "UK",
          commands: [command({ commanderIds: ["stays", "gone"], commandingGeneralId: "stays" })],
        },
      ],
      ["stays"]
    );

    await run(db);

    const saved = (
      db.collectionMocks.militaryCommands.updateOne.mock.calls[0][1] as {
        $set: { commands: MilitaryCommand[] };
      }
    ).$set.commands;
    expect(saved[0].commanderIds).toEqual(["stays"]);
    expect(saved[0].commandingGeneralId).toBe("stays");
  });

  it("writes nothing for a country that is already clean", async () => {
    const db = setup(
      [{ countryId: "US", commands: [command({ commanderIds: ["stays"] })] }],
      ["stays"]
    );

    const result = await run(db);

    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes).toEqual(["no command listed an off-roster commander"]);
  });

  it("reports what it would do without writing, on a dry run", async () => {
    const db = setup(
      [{ countryId: "RU", commands: [command({ commanderIds: ["gone"] })] }],
      ["stays"]
    );

    const result = await run(db, true);

    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes?.join(" ")).toMatch(/RU: would drop 1 commander/);
  });

  /**
   * A roster that came back empty for a reason this one-shot write cannot see
   * would otherwise strip every commander in the country. The runtime reconcile
   * heals the same state on next load, so skipping costs nothing.
   */
  it("refuses to mass-strip a country whose roster reads as empty", async () => {
    const db = setup([{ countryId: "DD", commands: [command({ commanderIds: ["someone"] })] }], []);

    const result = await run(db);

    expect(db.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
    expect(result.notes?.join(" ")).toMatch(/DD: SKIPPED/);
  });

  it("says nothing about an empty roster when no command lists anyone", async () => {
    const db = setup([{ countryId: "DD", commands: [command()] }], []);

    const result = await run(db);

    expect(result.notes).toEqual(["no command listed an off-roster commander"]);
  });

  it("repairs every affected country in one pass", async () => {
    const db = setup(
      [
        { countryId: "RU", commands: [command({ commanderIds: ["gone"] })] },
        { countryId: "UK", commands: [command({ commanderIds: ["stays"] })] },
        { countryId: "DD", commands: [command({ commanderIds: ["gone", "stays"] })] },
      ],
      ["stays"]
    );

    const result = await run(db);

    expect(result.documentsScanned).toBe(3);
    expect(result.documentsUpdated).toBe(2);
    expect(db.collectionMocks.militaryCommands.updateOne.mock.calls.map((c) => c[0])).toEqual([
      { countryId: "RU" },
      { countryId: "DD" },
    ]);
  });

  // Re-running after a successful pass must find nothing left to do.
  it("is idempotent", async () => {
    const db = setup(
      [{ countryId: "RU", commands: [command({ commanderIds: ["gone"] })] }],
      ["stays"]
    );
    await run(db);
    const saved = (
      db.collectionMocks.militaryCommands.updateOne.mock.calls[0][1] as {
        $set: { commands: MilitaryCommand[] };
      }
    ).$set.commands;

    const second = setup([{ countryId: "RU", commands: saved }], ["stays"]);
    const result = await run(second);

    expect(second.collectionMocks.militaryCommands.updateOne).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  it("declares itself idempotent to the runner", () => {
    expect(migration.idempotent).toBe(true);
    expect(migration.id).toBe("2026-08-26-drop-off-roster-command-commanders");
  });
});

describe("registry", () => {
  it("walks this migration on deploy", async () => {
    const { MIGRATIONS } = await import("../registry");
    expect(MIGRATIONS.map((m) => m.id)).toContain("2026-08-26-drop-off-roster-command-commanders");
  });
});
