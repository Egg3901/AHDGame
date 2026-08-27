import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/military/blocLookup", () => ({
  loadMilitaryBlocs: vi.fn().mockResolvedValue({ US: "west", RU: "east" }),
}));

const resolveConflict = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/military/resolveConflict", () => ({
  resolveConflict: (...args: unknown[]) => resolveConflict(...args),
}));

const { resolveBattleDeclarations } = await import("../battleResolution");

function unit(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "Div",
    type: "Armored Division",
    icon: "tank",
    basePower: 92,
    personnel: 15000,
    upkeepBase: 180,
    posture: "standard",
    techTier: 2,
    vet: 1,
    xp: 0,
    readiness: 70,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "vietnam",
    assignedGeneralId: null,
    createdTurn: 1,
    ...over,
  };
}

/**
 * THE HARD GATE for the whole of PR4.
 *
 * A proxy war's belligerents are factions with EMPTY rosters. Before the placement
 * clause, `sideOf` found the target in no roster, fell back to `blocOf`, got
 * non-aligned and returned null — so the offensive was built with `side: null`, the
 * walkover branch ran, and `if (off.side)` skipped `joinSide` AND `applyOccupation`
 * together. Control never moved, and nothing failed: no error, no log, a green suite.
 *
 * Every feature below this — the token force, the three-turn hold, the resolution,
 * the map — is inert until this passes.
 */
describe("a proxy war moves control", () => {
  let db: MockDb;

  const declaration = {
    _id: new ObjectId(),
    declarerCountry: "US",
    // The FACTION, not a member country. This is the declarable target.
    targetCountry: "NVN",
    theaterId: "vietnam",
    declaredByCharacterId: "char_1",
    declaredTurn: 40,
    status: "pending",
  };

  // Rebuilt per test: resolution mutates the conflict document it is handed, so the
  // rest of the tick sees a consistent picture — the roster (`joinSide`), the front
  // and supplies (`applyOccupation`), and the faction's `tokenStrength`. A single
  // literal shared across cases would carry one test's grinding into the next.
  let vietnam: ReturnType<typeof makeVietnam>;
  const makeVietnam = () => ({
    _id: "vietnam",
    name: "Vietnam War",
    hostCountry: "SVN",
    hostEntities: ["NVN", "SVN"],
    region: "sea",
    terrain: "Jungle / delta",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 300,
    terr: 1.1,
    infra: 20,
    enemyMix: ["infantry"],
    type: "cold_war",
    // Empty rosters — the sides ARE the factions.
    sideA: {
      label: "Republic of Vietnam",
      countries: [],
      kind: "generated",
      backer: "west",
      factionEntity: "SVN",
      tokenStrength: 40,
    },
    sideB: {
      label: "DRV",
      countries: [],
      kind: "generated",
      backer: "east",
      factionEntity: "NVN",
      tokenStrength: 40,
    },
    supplyA: 60,
    supplyB: 60,
    supplyBaseA: 60,
    supplyBaseB: 60,
    control: 50,
    controlStart: 50,
    status: "active",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vietnam = makeVietnam();
    db = createMockDb();
    for (const c of [
      "militaryUnits",
      "militaryFormations",
      "nationalDoctrine",
      "battleDeclarations",
      "battleReports",
      "conflicts",
    ]) {
      db.collection(c);
    }
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue(vietnam);
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([declaration]),
    });

    const all = [unit({ countryId: "US", basePower: 4000, theaterId: "vietnam" })];
    db.collectionMocks.militaryUnits.find.mockImplementation(
      (q: { countryId?: string; theaterId?: string } = {}) => {
        const docs = q.theaterId
          ? all.filter((u) => u.theaterId === q.theaterId)
          : q.countryId
            ? all.filter((u) => u.countryId === q.countryId)
            : all;
        const toArray = vi.fn().mockResolvedValue(docs);
        return { toArray, project: () => ({ toArray }) };
      }
    );
  });

  const controlWrite = () => {
    const call = db.collectionMocks.conflicts.updateOne.mock.calls.find(
      (c) => c[1]?.$set && "control" in c[1].$set
    );
    return call?.[1].$set as { control: number } | undefined;
  };

  it("moves control when a bloc attacks a faction", async () => {
    await resolveBattleDeclarations(db as unknown as Db, 41);

    const set = controlWrite();
    expect(set).toBeDefined();
    // The US declared on side A's behalf, so a US win drives control DOWN from 50.
    expect(set!.control).toBeLessThan(50);
  });

  it("fights the faction's token force instead of walking through it", async () => {
    // A faction owns no militaryUnits rows, so the defending side reached the battle
    // math empty and every declaration was a walkover — the host conquered by the
    // first bloc that bothered to declare, every turn, unopposed.
    await resolveBattleDeclarations(db as unknown as Db, 41);

    const report = db.collectionMocks.battleReports.insertOne.mock.calls[0]?.[0] as {
      noContact?: boolean;
      result?: unknown;
    };
    expect(report).toBeDefined();
    // The walkover branch writes `noContact: true` and no `result`. A real battle
    // writes a result and never sets that flag — so this distinguishes the two
    // reports, which both otherwise carry the same theatre and attackers.
    expect(report.noContact).toBeFalsy();
    expect(report.result).toBeDefined();
  });

  it("takes the faction's losses off tokenStrength, not off a unit table", async () => {
    // The faction has no country row to write casualties back to. This write is
    // deliberately its own, not folded into applyOccupation's $set: that early-returns
    // when control does not move, which is every battle once the front is pinned at a
    // pole — so a stalemate would grind the token force and record none of it.
    await resolveBattleDeclarations(db as unknown as Db, 41);

    const tokenWrite = db.collectionMocks.conflicts.updateOne.mock.calls.find((c) =>
      JSON.stringify(c[1] ?? {}).includes("tokenStrength")
    );
    expect(tokenWrite).toBeDefined();
    const set = (tokenWrite![1] as { $set: Record<string, number> }).$set;
    expect(set["sideB.tokenStrength"]).toBeLessThan(40);
    expect(set["sideB.tokenStrength"]).toBeGreaterThanOrEqual(0);
  });

  it("never writes militaryUnits for the faction", async () => {
    // persistSide bulk-writes filtered on countryId: side.country. A synthetic side
    // has no rows — assert the ABSENCE of a write, not an empty bulk op.
    await resolveBattleDeclarations(db as unknown as Db, 41);

    const writes = db.collectionMocks.militaryUnits.bulkWrite.mock.calls;
    expect(writes.flatMap((c) => c[0] ?? []).some((op) => JSON.stringify(op).includes("NVN"))).toBe(
      false
    );
  });

  it("stamps the pole clock instead of resolving the moment it reaches one", async () => {
    // A proxy war is not won by REACHING a pole but by HOLDING one. An interstate war
    // still ends on contact; this one starts a three-turn clock the loser can break.
    resolveConflict.mockClear();
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...vietnam,
      // One decisive push from side A's pole. A side-A win drives control DOWN, so
      // the pole it can reach is 0, not 100.
      control: 0.5,
    });

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const poleWrite = db.collectionMocks.conflicts.updateOne.mock.calls.find((c) =>
      JSON.stringify(c[1] ?? {}).includes("poleSinceTurn")
    );
    expect(poleWrite).toBeDefined();
    const set = (poleWrite![1] as { $set: Record<string, unknown> }).$set;
    expect(set.poleSide).toBe("A");
    expect(set.poleSinceTurn).toBe(41);
    // The war does NOT end here — resolveColdWarHolds owns that, three turns later.
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("walks over a faction whose token force is spent", async () => {
    // ⚠️ A faction at zero strength fields no units. If it still counted as a
    // defender the offensive would take neither branch — no walkover, and an empty
    // defending side handed to resolvePvpBattle — and the front would stop moving
    // for good. A faction ground to nothing would become the immortal wall the
    // token force exists to remove.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...vietnam,
      sideB: { ...vietnam.sideB, tokenStrength: 0 },
    });

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const report = db.collectionMocks.battleReports.insertOne.mock.calls[0]?.[0] as {
      noContact?: boolean;
      unopposedAdvance?: boolean;
    };
    expect(report).toBeDefined();
    expect(report.noContact).toBe(true);
    // And the walkover still takes ground, so the war can actually be won.
    expect(report.unopposedAdvance).toBe(true);
  });

  it("never enrols the faction into a side's country roster", async () => {
    // A faction IS the side. Writing "NVN" into sideB.countries would list North
    // Vietnam as a member country of its own side, and put a non-CountryId into a
    // field every belligerent surface reads as one.
    await resolveBattleDeclarations(db as unknown as Db, 41);

    const rosterWrites = db.collectionMocks.conflicts.updateOne.mock.calls.filter((c) =>
      JSON.stringify(c[1] ?? {}).includes("countries")
    );
    for (const call of rosterWrites) {
      expect(JSON.stringify(call[1])).not.toContain("NVN");
    }
  });
});
