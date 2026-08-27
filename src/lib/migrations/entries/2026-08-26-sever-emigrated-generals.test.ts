import type { Db } from "mongodb";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-26-sever-emigrated-generals";
import { severFromChainOfCommand } from "@/lib/military/severFromChainOfCommand";

vi.mock("@/lib/military/severFromChainOfCommand", () => ({
  severFromChainOfCommand: vi.fn().mockResolvedValue({ led: [], changed: true }),
}));

interface Fixture {
  /** countryId -> character ids on its commissioned-general roster. */
  roster: Record<string, string[]>;
  /** countryId -> assignedGeneralId values across its units. */
  unitHolders: Record<string, (string | null)[]>;
  /** countryId -> generalCharacterIds holding a posting. */
  postingHolders?: Record<string, string[]>;
}

function setup(fx: Fixture) {
  const countries = Object.keys(fx.roster);
  const db = createMockDb() as unknown as MockDb;
  db.collection("militaryCommands");
  db.collection("militaryUnits");
  db.collection("militaryFormations");
  db.collection("characters");
  db.collection("characterGenerals");

  db.collectionMocks.militaryCommands.distinct.mockResolvedValue(countries);
  // The migration asks militaryUnits for two different things: the countries that
  // have any units at all, and then each country's set of assigned generals.
  db.collectionMocks.militaryUnits.distinct.mockImplementation(
    async (field: string, filter?: { countryId: string }) =>
      field === "countryId" ? countries : (fx.unitHolders[filter!.countryId] ?? [])
  );
  db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(2);
  db.collectionMocks.militaryFormations.findOne.mockImplementation(
    async (filter: { countryId: string }) => ({
      countryId: filter.countryId,
      conflictAssignments: (fx.postingHolders?.[filter.countryId] ?? []).map((id) => ({
        theaterId: "front-1",
        generalCharacterId: id,
        inCharge: false,
      })),
    })
  );

  // listCountryGenerals reads characters then characterGenerals; the mock ignores
  // the query, so the roster is keyed off the country the test is currently on.
  let current = 0;
  db.collectionMocks.characters.find.mockImplementation((filter: { countryId: string }) => {
    current = countries.indexOf(filter.countryId);
    return {
      project: () => ({
        toArray: async () => fx.roster[countries[current]].map((id) => ({ _id: id, name: id })),
      }),
    };
  });
  db.collectionMocks.characterGenerals.find.mockImplementation(() => ({
    toArray: async () =>
      fx.roster[countries[current]].map((id) => ({
        characterId: id,
        commissioned: true,
        general: { level: 1, name: id },
      })),
  }));
  return db;
}

const run = (db: MockDb, dryRun = false) => migration.execute(db as unknown as Db, { dryRun });

describe("2026-08-26-sever-emigrated-generals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(severFromChainOfCommand).mockResolvedValue({ led: [], changed: true });
  });

  it("severs a general still holding units after leaving the country", async () => {
    const db = setup({ roster: { RU: ["stays"] }, unitHolders: { RU: ["stays", "gone"] } });

    const result = await run(db);

    expect(severFromChainOfCommand).toHaveBeenCalledTimes(1);
    expect(severFromChainOfCommand).toHaveBeenCalledWith(db, "RU", "gone");
    expect(result.documentsUpdated).toBe(1);
  });

  it("severs a general still holding a posting but no units", async () => {
    const db = setup({
      roster: { RU: ["stays"] },
      unitHolders: { RU: [] },
      postingHolders: { RU: ["gone"] },
    });

    await run(db);

    expect(severFromChainOfCommand).toHaveBeenCalledWith(db, "RU", "gone");
  });

  // An unassigned unit carries a null holder; treating it as an id would sever
  // "null" and hand every General Staff unit to itself.
  it("ignores units that have no general at all", async () => {
    const db = setup({ roster: { RU: ["stays"] }, unitHolders: { RU: [null, "stays"] } });

    const result = await run(db);

    expect(severFromChainOfCommand).not.toHaveBeenCalled();
    expect(result.notes).toEqual(["no country held units or postings for a departed general"]);
  });

  it("leaves a country whose holders are all on its roster alone", async () => {
    const db = setup({ roster: { US: ["a", "b"] }, unitHolders: { US: ["a", "b", "a"] } });

    const result = await run(db);

    expect(severFromChainOfCommand).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  it("sweeps every country in one pass", async () => {
    const db = setup({
      roster: { RU: ["ru1"], UK: ["uk1"], US: ["us1"] },
      unitHolders: { RU: ["gone-a"], UK: ["gone-b"], US: ["us1"] },
    });

    await run(db);

    expect(vi.mocked(severFromChainOfCommand).mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["RU", "gone-a"],
      ["UK", "gone-b"],
    ]);
  });

  it("reports what it would do without severing anything, on a dry run", async () => {
    const db = setup({ roster: { RU: ["stays"] }, unitHolders: { RU: ["gone"] } });

    const result = await run(db, true);

    expect(severFromChainOfCommand).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes?.join(" ")).toMatch(/RU: would sever gone — 2 unit\(s\), 0 posting\(s\)/);
  });

  // Same refusal as the roster migration: a bad read would otherwise hand a
  // country's entire army back to the General Staff.
  it("refuses to sweep a country whose roster reads as empty", async () => {
    const db = setup({ roster: { DD: [] }, unitHolders: { DD: ["someone"] } });

    const result = await run(db);

    expect(severFromChainOfCommand).not.toHaveBeenCalled();
    expect(result.notes?.join(" ")).toMatch(/DD: SKIPPED/);
  });

  it("counts nothing when the severance turns out to be a no-op", async () => {
    vi.mocked(severFromChainOfCommand).mockResolvedValue({ led: [], changed: false });
    const db = setup({ roster: { RU: ["stays"] }, unitHolders: { RU: ["gone"] } });

    const result = await run(db);

    expect(result.documentsUpdated).toBe(0);
  });

  it("names a vacated command in its notes", async () => {
    vi.mocked(severFromChainOfCommand).mockResolvedValue({
      led: ["command post 1"],
      changed: true,
    });
    const db = setup({ roster: { RU: ["stays"] }, unitHolders: { RU: ["gone"] } });

    const result = await run(db);

    expect(result.notes?.join(" ")).toMatch(/vacated command post 1/);
  });

  it("declares itself idempotent and is walked on deploy", async () => {
    expect(migration.idempotent).toBe(true);
    const { MIGRATIONS } = await import("../registry");
    const ids = MIGRATIONS.map((m) => m.id);
    expect(ids).toContain("2026-08-26-sever-emigrated-generals");
    // After the roster clear, which shrinks the set of holders this has to sever.
    expect(ids.indexOf("2026-08-26-sever-emigrated-generals")).toBeGreaterThan(
      ids.indexOf("2026-08-26-drop-off-roster-command-commanders")
    );
  });
});
