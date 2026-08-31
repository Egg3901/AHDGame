import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { processNavairTurn } from "../turn";
import { FREE_REPAIR_CEILING } from "../repair";
import { WITHDRAW_INTEGRITY } from "../missions";

/**
 * Repair inside the turn pass, and the rescue that makes it reachable.
 *
 * The rescue is the test that matters. `alive()` is `integrity > 0` and the pass gates on
 * it before stationing, so a hull at exactly zero was never stationed, never resupplied,
 * and could never recover. On the live world that left the UK's entire navy, seven of
 * seven hulls, permanently unable to blockade anything.
 */

const unitDocs: Record<string, unknown>[] = [];
const conflictDocs: Record<string, unknown>[] = [];

function mockDb(): Db {
  const col = (name: string) => {
    if (name === "conflicts") {
      return { find: () => ({ toArray: async () => conflictDocs }) };
    }
    if (name === "militaryUnits") {
      return {
        find: () => ({ toArray: async () => unitDocs }),
        bulkWrite: async (
          ops: {
            updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
          }[]
        ) => {
          for (const op of ops) {
            const doc = unitDocs.find((d) => d._id === op.updateOne.filter._id);
            if (doc) Object.assign(doc, op.updateOne.update.$set);
          }
          return { modifiedCount: ops.length };
        },
      };
    }
    return {
      find: () => ({ toArray: async () => [] }),
      findOne: async () => null,
      bulkWrite: async () => ({ modifiedCount: 0 }),
      insertMany: async () => ({ insertedCount: 0 }),
    };
  };
  return { collection: vi.fn().mockImplementation(col) } as unknown as Db;
}

const hull = (over: Record<string, unknown>) => ({
  _id: "hull-1",
  countryId: "UK",
  domain: "naval",
  branchId: "navy",
  type: "Guided-Missile Destroyer",
  name: "1st Test Squadron",
  icon: "ship",
  posture: "standard",
  techTier: 1,
  personnel: 1000,
  readiness: 70,
  basePower: 90,
  upkeepBase: 100,
  vet: 1,
  xp: 0,
  equipment: { firepower: 1, protection: 1, support: 1 },
  drill: null,
  theaterId: "reserve",
  assignedGeneralId: null,
  createdTurn: 1,
  integrity: 100,
  supply: 100,
  mission: "PORT",
  station: "weu",
  ...over,
});

beforeEach(() => {
  unitDocs.length = 0;
  conflictDocs.length = 0;
});

describe("processNavairTurn repair", () => {
  it("mends a damaged hull resting in its home port", async () => {
    unitDocs.push(hull({ integrity: 40, mission: "PORT", station: "weu" }));

    const res = await processNavairTurn(mockDb(), 100);

    expect(res.formationsRepaired).toBe(1);
    expect(unitDocs[0].integrity).toBeGreaterThan(40);
  });

  // THE regression. Before this, `alive()` gated a zero-integrity hull out of the pass
  // before it could be stationed or resupplied, so zero was permanent.
  it("rescues a hull at zero integrity and brings it back into service", async () => {
    unitDocs.push(hull({ integrity: 0, mission: "SEA_CONTROL", station: "mea" }));

    await processNavairTurn(mockDb(), 100);

    expect(unitDocs[0].integrity).toBeGreaterThan(0);
  });

  // A wreck contributes nothing where it is. Pulling it home is the rotation decision the
  // config's own rationale describes, and it is what lets it reach the home ceiling.
  it("sends a rescued wreck home", async () => {
    unitDocs.push(hull({ integrity: 0, station: "mea", mission: "SEA_CONTROL" }));

    await processNavairTurn(mockDb(), 100);

    expect(unitDocs[0].station).toBe("weu");
  });

  it("leaves a wreck where a commander put it", async () => {
    unitDocs.push(
      hull({ integrity: 0, station: "mea", mission: "SEA_CONTROL", stationSetByPlayer: true })
    );

    await processNavairTurn(mockDb(), 100);

    expect(unitDocs[0].station).toBe("mea");
    expect(unitDocs[0].integrity).toBeGreaterThan(0);
  });

  it("does not carry a hull on station past the station ceiling", async () => {
    unitDocs.push(
      hull({ integrity: FREE_REPAIR_CEILING.station, mission: "BLOCKADE", station: "mea" })
    );

    await processNavairTurn(mockDb(), 100);

    expect(unitDocs[0].integrity).toBe(FREE_REPAIR_CEILING.station);
  });

  // The defect this catches: `stationOf` sends any alive formation with a theater back to
  // its front, and a front is exactly where supply is too low for repair to happen. A
  // hull nudged off zero and immediately redeployed stuck a few points above zero for
  // ever, which is the plateau the config's docblock warns about. It has to stay home
  // until it is seaworthy, not for one turn.
  it("keeps a withdrawn hull home across turns until it can fight again", async () => {
    unitDocs.push(
      hull({ integrity: 0, station: "mea", mission: "SEA_CONTROL", theaterId: "war-1" })
    );

    for (let turn = 0; turn < 3; turn++) await processNavairTurn(mockDb(), 100 + turn);

    expect(unitDocs[0].station).toBe("weu");
    expect(unitDocs[0].integrity).toBeGreaterThanOrEqual(WITHDRAW_INTEGRITY);
  });

  // Below the withdraw threshold the engine pulls a formation home, but only one it
  // stationed itself. A commander who wants a damaged hull forward keeps it forward.
  it("withdraws a badly damaged hull the engine stationed, not one a commander placed", async () => {
    unitDocs.push(
      hull({ _id: "auto", integrity: 20, station: "mea", mission: "SEA_CONTROL" }),
      hull({
        _id: "ordered",
        integrity: 20,
        station: "mea",
        mission: "SEA_CONTROL",
        stationSetByPlayer: true,
      })
    );

    await processNavairTurn(mockDb(), 100);

    expect(unitDocs[0].station).toBe("weu");
    expect(unitDocs[1].station).toBe("mea");
  });

  // Ordering regression. Repair changes a formation's station, supply and integrity, while
  // `byRegion` still indexes every hull by where it stood at the start of the turn. Run
  // before the contest, a hull that had just withdrawn home went on contesting the water it
  // left, at the better supply it found at home: a fleet in two places at once, slightly
  // winning. Repair must therefore run after the channels are written.
  it("does not let a withdrawing hull contest the water it left", async () => {
    unitDocs.push(
      hull({ integrity: 0, station: "mea", mission: "SEA_CONTROL", theaterId: "war-1" })
    );

    const db = mockDb();
    await processNavairTurn(db, 100);

    // The channel write is the contest's output. A hull that withdrew must not have moved
    // any channel at its old station, because it was gone before the contest was scored.
    const channelWrites = (db.collection as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0]))
      .filter((n) => n === "navairChannels");
    expect(channelWrites.length).toBeGreaterThan(0);
    expect(unitDocs[0].station).toBe("weu");
  });

  // A formation that withdrew and then fought recovers nothing that turn, because you mend
  // between engagements and not during one. Keying the write on the repair alone silently
  // dropped the station change with it, leaving the hull at the front it was pulled from.
  it("persists the move home even on a turn that mends nothing", async () => {
    conflictDocs.push({
      _id: "war-1",
      region: "mea",
      sideA: { countries: ["UK"] },
      sideB: { countries: ["RU"] },
    });
    unitDocs.push(
      hull({
        _id: "uk-1",
        integrity: 20,
        station: "mea",
        mission: "SEA_CONTROL",
        theaterId: "war-1",
      }),
      hull({
        _id: "ru-1",
        countryId: "RU",
        integrity: 100,
        station: "mea",
        mission: "SEA_CONTROL",
        theaterId: "war-1",
      })
    );

    await processNavairTurn(mockDb(), 100);

    const uk = unitDocs.find((d) => d._id === "uk-1")!;
    // It fought, so it mended nothing, and it must still have been moved home. The
    // integrity assertion is what stops this passing for the wrong reason: if no
    // engagement fired, the hull would have mended and the write would have happened
    // anyway, proving nothing about the dropped station change.
    expect(uk.integrity as number).toBeLessThanOrEqual(20);
    expect(uk.station).toBe("weu");
  });

  it("leaves an undamaged fleet alone", async () => {
    unitDocs.push(hull({ integrity: 100 }));

    const res = await processNavairTurn(mockDb(), 100);

    expect(res.formationsRepaired).toBe(0);
    expect(unitDocs[0].integrity).toBe(100);
  });
});
