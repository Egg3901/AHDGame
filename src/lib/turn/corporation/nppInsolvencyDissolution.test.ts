import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/currency/corporationCapital", () => ({
  // Identity-ish: treat liquidCapital as already anchor for the test.
  corpLiquidCapitalToAnchor: (v: number) => v,
  fxRateForCorpFromMap: () => 1,
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/corporations/settlementLock", () => ({
  // Lock always acquired → run the dissolution.
  withCorporationSettlementLock: vi.fn((_db, _id, _field, _now, run: () => Promise<unknown>) =>
    run()
  ),
}));
vi.mock("@/lib/bonds/executeCorporationBondDefaultDissolution", () => ({
  executeCorporationBondDefaultDissolution: vi.fn().mockResolvedValue({ ok: true }),
}));

import { executeCorporationBondDefaultDissolution } from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import {
  processNppInsolventCorpDissolution,
  PERSISTENT_INSOLVENCY_GRACE_TURNS,
  LINGERING_DEFAULT_GRACE_TURNS,
} from "./nppInsolvencyDissolution";

function corp(overrides: Record<string, unknown>) {
  return {
    _id: new ObjectId(),
    name: "Corp",
    ceoType: "npp",
    liquidCapital: 0,
    ...overrides,
  };
}

/**
 * Minimal fake Db: `corporations` serves the corp list + captures bulkWrite
 * clock ops; `bonds.distinct` serves the lingering-default issuer ids.
 */
function makeDb(
  corps: unknown[],
  lingeringIssuerIds: ObjectId[] = [],
  opts: { commandEconomyEnabled?: boolean; currentYear?: number } = {}
) {
  const bulkWrites: { updateOne: { filter: unknown; update: Record<string, unknown> } }[] = [];
  const db = {
    collection: (name: string) => {
      if (name === "bonds") {
        return { distinct: async () => lingeringIssuerIds };
      }
      // Soft-budget guard reads: default null → flag OFF / era unknown, so the
      // command-economy exemption is inert and every legacy assertion holds.
      if (name === "gameConfig") {
        return {
          findOne: async () =>
            opts.commandEconomyEnabled === undefined
              ? null
              : { commandEconomyEnabled: opts.commandEconomyEnabled },
        };
      }
      if (name === "gameState") {
        return {
          findOne: async () =>
            opts.currentYear === undefined ? null : { currentYear: opts.currentYear },
        };
      }
      return {
        find: () => ({ toArray: async () => corps }),
        bulkWrite: async (ops: (typeof bulkWrites)[number][]) => {
          bulkWrites.push(...ops);
          return { ok: 1 };
        },
      };
    },
  } as unknown as Db;
  return { db, bulkWrites };
}

const TURN = 251;

describe("processNppInsolventCorpDissolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dissolves only corps below the deep-insolvency threshold (-1M)", async () => {
    const deep = corp({ liquidCapital: -2_000_000 });
    const shallow = corp({ liquidCapital: -500_000 }); // transient dip — spared
    const healthy = corp({ liquidCapital: 3_000_000 });
    const { db } = makeDb([deep, shallow, healthy]);

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res.candidates).toBe(1);
    expect(res.dissolved).toBe(1);
    expect(executeCorporationBondDefaultDissolution).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeCorporationBondDefaultDissolution).mock.calls[0][1]).toMatchObject({
      _id: deep._id,
    });
  });

  it("caps dissolutions per turn and does the deepest holes first", async () => {
    // 30 insolvent corps, cap is 25 — the 25 deepest should be dissolved.
    const corps = Array.from({ length: 30 }, (_, i) =>
      corp({ liquidCapital: -1_000_001 - i * 1000 })
    );
    const { db } = makeDb(corps);

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res.candidates).toBe(30);
    expect(res.dissolved).toBe(25);
    // Deepest (last in the array, most negative) must be among those dissolved.
    const dissolvedIds = vi
      .mocked(executeCorporationBondDefaultDissolution)
      .mock.calls.map((c) => (c[1] as { _id: ObjectId })._id.toString());
    expect(dissolvedIds).toContain(corps[29]._id.toString()); // deepest
    expect(dissolvedIds).not.toContain(corps[0]._id.toString()); // shallowest, over the cap
  });

  it("no-ops when there are no NPP corps", async () => {
    const res = await processNppInsolventCorpDissolution(makeDb([]).db, TURN);
    expect(res).toEqual({ dissolved: 0, candidates: 0 });
    expect(executeCorporationBondDefaultDissolution).not.toHaveBeenCalled();
  });

  it("soft budget: command-economy state firms are exempt from dissolution when the regime is on", async () => {
    // Equally deep in the red: a Soviet (RU) command firm and a US market firm.
    const sovietFirm = corp({ countryId: "RU", liquidCapital: -5_000_000 });
    const usFirm = corp({ countryId: "US", liquidCapital: -5_000_000 });
    const { db } = makeDb([sovietFirm, usFirm], [], {
      commandEconomyEnabled: true,
      currentYear: 1960, // Soviet command era
    });

    const res = await processNppInsolventCorpDissolution(db, TURN);

    // Only the US firm is a candidate / dissolved; the command firm is spared.
    expect(res.candidates).toBe(1);
    expect(res.dissolved).toBe(1);
    expect(executeCorporationBondDefaultDissolution).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executeCorporationBondDefaultDissolution).mock.calls[0][1]).toMatchObject({
      _id: usFirm._id,
    });
  });

  it("soft budget is inert once the command era has passed (RU firm dissolves post-1991)", async () => {
    const postSovietFirm = corp({ countryId: "RU", liquidCapital: -5_000_000 });
    const { db } = makeDb([postSovietFirm], [], {
      commandEconomyEnabled: true,
      currentYear: 1995, // past the RU throughYear (1991) → market rules resume
    });

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res.candidates).toBe(1);
    expect(res.dissolved).toBe(1);
  });

  it("skips a corp whose settlement lock is already held (result null), continues others", async () => {
    const { withCorporationSettlementLock } = await import("@/lib/corporations/settlementLock");
    vi.mocked(withCorporationSettlementLock).mockResolvedValueOnce(null); // first corp locked
    const a = corp({ liquidCapital: -5_000_000 });
    const b = corp({ liquidCapital: -2_000_000 });
    const { db } = makeDb([a, b]);

    const res = await processNppInsolventCorpDissolution(db, TURN);
    // a is deepest → attempted first but lock null → not counted; b dissolves.
    expect(res.candidates).toBe(2);
    expect(res.dissolved).toBe(1);
  });

  // ── #3237: persistent-insolvency clock ─────────────────────────────────────

  it("stamps nppInsolventSinceTurn on a newly-insolvent corp without dissolving it", async () => {
    const bleeder = corp({ liquidCapital: -200_000 }); // negative, above deep threshold
    const { db, bulkWrites } = makeDb([bleeder]);

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res.dissolved).toBe(0);
    expect(res.candidates).toBe(0);
    expect(bulkWrites).toHaveLength(1);
    expect(bulkWrites[0].updateOne.filter).toMatchObject({ _id: bleeder._id });
    expect(bulkWrites[0].updateOne.update).toMatchObject({
      $set: { nppInsolventSinceTurn: TURN },
    });
  });

  it("dissolves a persistently-insolvent corp once the grace window has elapsed", async () => {
    const zombie = corp({
      liquidCapital: -200_000,
      nppInsolventSinceTurn: TURN - PERSISTENT_INSOLVENCY_GRACE_TURNS,
    });
    const notYet = corp({
      liquidCapital: -200_000,
      nppInsolventSinceTurn: TURN - (PERSISTENT_INSOLVENCY_GRACE_TURNS - 1),
    });
    const { db } = makeDb([zombie, notYet]);

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res.candidates).toBe(1);
    expect(res.dissolved).toBe(1);
    expect(vi.mocked(executeCorporationBondDefaultDissolution).mock.calls[0][1]).toMatchObject({
      _id: zombie._id,
    });
  });

  it("clears the clock (and does not dissolve) when a stamped corp recovers", async () => {
    const recovered = corp({
      liquidCapital: 50_000,
      nppInsolventSinceTurn: TURN - PERSISTENT_INSOLVENCY_GRACE_TURNS * 2,
    });
    const { db, bulkWrites } = makeDb([recovered]);

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res.dissolved).toBe(0);
    expect(bulkWrites).toHaveLength(1);
    expect(bulkWrites[0].updateOne.update).toMatchObject({
      $unset: { nppInsolventSinceTurn: "" },
    });
  });

  it("treats positive share escrow as usable cash: negative LC + bigger escrow is not insolvent", async () => {
    const escrowed = corp({
      liquidCapital: -200_000,
      shareEscrowBalance: 300_000, // effective cash +100k
      nppInsolventSinceTurn: TURN - PERSISTENT_INSOLVENCY_GRACE_TURNS * 2, // stale stamp
    });
    const { db, bulkWrites } = makeDb([escrowed]);

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res.dissolved).toBe(0);
    expect(res.candidates).toBe(0);
    // Stale stamp is cleared since effective cash recovered.
    expect(bulkWrites).toHaveLength(1);
    expect(bulkWrites[0].updateOne.update).toMatchObject({
      $unset: { nppInsolventSinceTurn: "" },
    });
  });

  it("healthy-corp no-op guard: solvent unstamped corps get no writes and no dissolution", async () => {
    const healthy = corp({ liquidCapital: 3_000_000 });
    const { db, bulkWrites } = makeDb([healthy]);

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res).toEqual({ dissolved: 0, candidates: 0 });
    expect(bulkWrites).toHaveLength(0);
    expect(executeCorporationBondDefaultDissolution).not.toHaveBeenCalled();
  });

  // ── #3237: lingering bond default ──────────────────────────────────────────

  it("dissolves an NPP issuer whose bond default lingered past the grace window", async () => {
    const stuckIssuer = corp({ liquidCapital: 100_000 }); // cash-positive but default never cured
    const { db } = makeDb([stuckIssuer], [stuckIssuer._id as ObjectId]);

    const res = await processNppInsolventCorpDissolution(db, TURN);

    expect(res.candidates).toBe(1);
    expect(res.dissolved).toBe(1);
    expect(vi.mocked(executeCorporationBondDefaultDissolution).mock.calls[0][1]).toMatchObject({
      _id: stuckIssuer._id,
    });
    // Sanity: grace constant is exported and sane.
    expect(LINGERING_DEFAULT_GRACE_TURNS).toBeGreaterThan(0);
  });
});
