import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { CEO_INITIAL_SHARES } from "@/lib/constants/corporations";

vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/nationalization/treasury", () => ({
  creditTreasuryProceeds: vi.fn(async (_db, _country, amount: number) => Math.round(amount)),
}));

import { emitTx } from "@/lib/financialTxLog/emit";
import { creditTreasuryProceeds } from "@/lib/nationalization/treasury";
import { spinOff } from "./spinOff";

const parentId = new ObjectId();
const callerUserId = new ObjectId(); // parent owner + parent CEO's user
const parentCeoCharId = new ObjectId();
const candidateCharId = new ObjectId();
const candidateUserId = new ObjectId();

function parentCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: parentId,
    name: "Parent Co",
    userId: callerUserId,
    ceoId: parentCeoCharId,
    ceoType: "character",
    ceoVacant: false,
    countryId: "US",
    headquartersState: "CA",
    liquidCapital: 100_000_000,
    liquidCurrencyCode: "USD",

    ...overrides,
  } as any as Corporation;
}

function sector(id: ObjectId, revenue: number): CorporateSector {
  return {
    _id: id,
    corporationId: parentId,
    countryId: "US",
    stateId: "CA",
    sectorType: "technology",
    revenue,
    currentGrowthCost: 1000,
  } as any as CorporateSector;
}

let db: MockDb;
const sectorA = new ObjectId();
const sectorB = new ObjectId();

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  // Parent's sectors of the requested type.
  db.collection("corporateSectors").find = vi.fn().mockReturnValue({
    toArray: async () => [sector(sectorA, 5_000_000), sector(sectorB, 2_000_000)],
  });
  // characters.findOne resolves candidate vs parent CEO by _id.
  db.collection("characters").findOne = vi.fn().mockImplementation(async (q: { _id: ObjectId }) => {
    if (q._id.equals(candidateCharId)) return { _id: candidateCharId, userId: candidateUserId };
    if (q._id.equals(parentCeoCharId)) return { _id: parentCeoCharId, userId: callerUserId };
    return null;
  });
  // No sibling formalized subsidiaries.
  db.collection("corporations").find = vi.fn().mockReturnValue({ toArray: async () => [] });
  // Atomic debit succeeds.
  db.collection("corporations").findOneAndUpdate = vi
    .fn()
    .mockResolvedValue({ liquidCapital: 90_000_000 });
  // Sequential id.
  db.collection("counters").findOneAndUpdate = vi.fn().mockResolvedValue({ seq: 42 });
});

const baseInput = {
  callerUserId,
  sectorType: "technology" as const,
  name: "Tech Spinoff",
  tickerSymbol: "TSPN",
  appointedCeoType: "character" as const,
  appointedCeoCharacterId: candidateCharId,
  turn: 1000,
  now: new Date(),
};

describe("spinOff", () => {
  it("happy path: creates a wholly parent-owned private subsidiary", async () => {
    const result = await spinOff(db as unknown as Db, { parent: parentCorp(), ...baseInput });
    expect(result.ok).toBe(true);

    const insert = db.collection("corporations").insertOne as ReturnType<typeof vi.fn>;
    expect(insert).toHaveBeenCalledTimes(1);

    const doc = insert.mock.calls[0][0] as any;
    // 100% parent ownership, private, no float, marked as spin-off + formalized.
    expect(doc.shareholders).toHaveLength(1);
    expect(doc.shareholders[0].corporationId.equals(parentId)).toBe(true);
    expect(doc.shareholders[0].shares).toBe(CEO_INITIAL_SHARES);
    expect(doc.publicFloat).toBe(0);
    expect(doc.isPrivate).toBe(true);
    expect(doc.isSpinOff).toBe(true);
    expect(doc.spunOffFromCorpId.equals(parentId)).toBe(true);
    expect(doc.subsidiaryFormalizedAtTurn).toBe(1000);
    expect(doc.type).toBe("technology");
    // CEO is the appointed human, userId is that human (not the parent).
    expect(doc.ceoType).toBe("character");
    expect(doc.userId.equals(candidateUserId)).toBe(true);
  });

  it("pays the incorporation fee to the treasury and ledgers both legs", async () => {
    const result = await spinOff(db as unknown as Db, { parent: parentCorp(), ...baseInput });
    expect(result.ok).toBe(true);

    // The fee is government revenue, not destroyed money.
    const credited = vi.mocked(creditTreasuryProceeds).mock.calls[0];
    expect(credited[1]).toBe("US");
    const feeToTreasury = credited[2] as number;
    expect(feeToTreasury).toBeGreaterThan(0);

    const legs = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    const paid = legs.find((l) => l.type === "corp_capital_seed");
    const received = legs.find((l) => l.type === "gov_tax_revenue");
    expect(paid).toBeDefined();
    expect(received).toBeDefined();
    // Debit and credit net to zero: nothing leaks.
    expect((paid?.amount ?? 0) + (received?.amount ?? 0)).toBe(0);
    expect(received?.countryId).toBe("US");
  });

  it("transfers all sectors of the type to the new corp (re-denominated)", async () => {
    await spinOff(db as unknown as Db, { parent: parentCorp(), ...baseInput });
    const upd = db.collection("corporateSectors").updateOne as ReturnType<typeof vi.fn>;
    expect(upd).toHaveBeenCalledTimes(2);

    const setArg = upd.mock.calls[0][1] as any;
    expect(setArg.$set).toHaveProperty("corporationId");
    // Same currency (USD→USD) ⇒ revenue is preserved through the re-denomination.
    expect(setArg.$set.revenue).toBe(5_000_000);
  });

  it("mid-build spin-off: the queue and CIP move with the sector and are NOT FX-rescaled", async () => {
    // A sector spun off mid-build. spinOff is a REASSIGN (same doc, new
    // corporationId), so the plant state must ride along untouched — and the
    // ₳-anchored capex fields must never go through the revenue
    // re-denomination round-trip alongside it.
    const midBuild = {
      ...sector(sectorA, 5_000_000),
      capitalStock: 640,
      buildQueue: [
        { unitsOrdered: 200, costPaidAnchor: 9_000_000, startTurn: 990, onlineTurn: 1010 },
      ],
      constructionInProgressAnchor: 9_000_000,
      plantsStartTurn: 900,
    } as any;
    db.collection("corporateSectors").find = vi
      .fn()
      .mockReturnValue({ toArray: async () => [midBuild] });

    // A JPY parent spinning out a JPY subsidiary: revenue IS re-denominated,
    // the capex fields must not be — the rate is the whole hazard here.
    await spinOff(db as unknown as Db, {
      parent: parentCorp({ liquidCurrencyCode: "JPY" }),
      ...baseInput,
    });

    const upd = db.collection("corporateSectors").updateOne as ReturnType<typeof vi.fn>;
    const setArg = (upd.mock.calls[0][1] as any).$set;
    // Ownership moves.
    expect(setArg).toHaveProperty("corporationId");
    // The reassign never touches the plant fields: they stay on the doc as-is,
    // so the update must not restate them at all.
    expect(setArg).not.toHaveProperty("buildQueue");
    expect(setArg).not.toHaveProperty("constructionInProgressAnchor");
    expect(setArg).not.toHaveProperty("capitalStock");
    expect(setArg).not.toHaveProperty("plantsStartTurn");
    // And nothing was deleted/recreated, which is what would lose them.
    const del = db.collection("corporateSectors").deleteOne as ReturnType<typeof vi.fn>;
    expect(del).not.toHaveBeenCalled();
  });

  it("rejects when the spin-off cooldown has not elapsed", async () => {
    const result = await spinOff(db as unknown as Db, {
      parent: parentCorp({ lastSpinOffTurn: 995 }),
      ...baseInput,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects chaining (parent is itself a formalized subsidiary)", async () => {
    const result = await spinOff(db as unknown as Db, {
      parent: parentCorp({ subsidiaryFormalizedAtTurn: 10 }),
      ...baseInput,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("rejects when the parent has no sector of the requested type", async () => {
    db.collection("corporateSectors").find = vi.fn().mockReturnValue({ toArray: async () => [] });
    const result = await spinOff(db as unknown as Db, { parent: parentCorp(), ...baseInput });
    expect(result.ok).toBe(false);
  });

  it("enforces the one-person rule (candidate == parent owner)", async () => {
    db.collection("characters").findOne = vi.fn().mockResolvedValue({
      _id: candidateCharId,
      userId: callerUserId, // same human as the parent owner/CEO
    });
    const result = await spinOff(db as unknown as Db, { parent: parentCorp(), ...baseInput });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});
