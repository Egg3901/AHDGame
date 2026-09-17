import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { processBrettonWoodsTurn, resolveForexBwInput } from "./brettonWoodsTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

const calmUsBank = {
  _id: "US",
  countryId: "US",
  inflationHistory: [{ turn: 719, rate: 2.0 }],
  gdpGrowthHistory: [{ turn: 719, rate: 2.5 }],
};

function seed(opts: {
  flag?: boolean;
  gameState?: Record<string, unknown>;
  bank?: Record<string, unknown> | null;
  m2?: Record<string, unknown> | null;
}) {
  db.collectionMocks["gameConfig"].findOne.mockResolvedValue(
    opts.flag === true ? { _id: "default", brettonWoodsExitEnabled: true } : { _id: "default" }
  );
  db.collectionMocks["gameState"].findOne.mockResolvedValue(
    opts.gameState !== undefined ? { _id: "current", currentYear: 1960, ...opts.gameState } : null
  );
  db.collectionMocks["centralBanks"].findOne.mockResolvedValue(
    opts.bank !== undefined ? opts.bank : calmUsBank
  );
  db.collectionMocks["moneySupplySnapshots"].findOne.mockResolvedValue(
    opts.m2 !== undefined ? opts.m2 : null
  );
}

beforeEach(() => {
  db = createMockDb();
  db.collection("gameConfig");
  db.collection("gameState");
  db.collection("centralBanks");
  db.collection("moneySupplySnapshots");
});

describe("processBrettonWoodsTurn gate", () => {
  it("flag off: single config read, zero writes, pegged idle result", async () => {
    seed({ flag: false });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1960);
    expect(res).toEqual({
      ran: false,
      regime: "pegged",
      regimeChangedAtTurn: null,
      goldCover: 1,
      foreignClaims: 0,
      suspended: false,
      floated: false,
    });
    expect(db.collectionMocks["gameState"].updateOne).not.toHaveBeenCalled();
  });

  it("flag on, fresh world: initializes full cover under the peg and persists", async () => {
    seed({ flag: true, gameState: { currentYear: 1960 } });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1960);
    expect(res.ran).toBe(true);
    expect(res.regime).toBe("pegged");
    expect(res.suspended).toBe(false);
    expect(res.goldCover).toBe(1);
    const [, update] = db.collectionMocks["gameState"].updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set.bwGoldCover).toBe(1);
    expect(update.$set.bwRegime).toBe("pegged");
  });

  it("does not suspend before the 1968 era window even with cover exhausted", async () => {
    seed({ flag: true, gameState: { currentYear: 1960, bwGoldCover: 0.1 } });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 100, 1960);
    expect(res.regime).toBe("pegged");
    expect(res.suspended).toBe(false);
  });

  it("suspends once eligible with exhausted cover, stamping the turn", async () => {
    seed({ flag: true, gameState: { currentYear: 1971, bwGoldCover: 0.2 } });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 900, 1971);
    expect(res.regime).toBe("suspended");
    expect(res.suspended).toBe(true);
    expect(res.regimeChangedAtTurn).toBe(900);
  });

  it("floats after the 90-turn suspension and never re-suspends", async () => {
    seed({
      flag: true,
      gameState: {
        currentYear: 1973,
        bwGoldCover: 0.1,
        bwRegime: "suspended",
        bwRegimeChangedAtTurn: 900,
      },
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 990, 1973);
    expect(res.regime).toBe("floating");
    expect(res.floated).toBe(true);
    expect(res.suspended).toBe(false);
  });

  it("drains cover under sustained US inflation pressure", async () => {
    seed({
      flag: true,
      gameState: { currentYear: 1965 },
      bank: {
        ...calmUsBank,
        inflationHistory: [{ turn: 719, rate: 7.0 }],
      },
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1965);
    expect(res.goldCover).toBeLessThan(1);
  });
});

describe("resolveForexBwInput", () => {
  const liveResult = {
    ran: true,
    regime: "suspended" as const,
    regimeChangedAtTurn: 900,
    goldCover: 0.2,
    foreignClaims: 1.5,
    suspended: true,
    floated: false,
  };

  it("passes the live phase result through with zero gameState reads", async () => {
    db.collectionMocks["gameState"].findOne.mockClear();
    const out = await resolveForexBwInput(db as unknown as Db, liveResult, false);
    expect(out).toBe(liveResult);
    expect(db.collectionMocks["gameState"].findOne).not.toHaveBeenCalled();
  });

  it("returns null without reading when nothing ran and nothing was skipped", async () => {
    db.collectionMocks["gameState"].findOne.mockClear();
    const out = await resolveForexBwInput(db as unknown as Db, null, false);
    expect(out).toBeNull();
    expect(db.collectionMocks["gameState"].findOne).not.toHaveBeenCalled();
  });

  it("reloads the persisted regime on a resume skip", async () => {
    db.collectionMocks["gameState"].findOne.mockResolvedValue({
      _id: "current",
      bwRegime: "suspended",
      bwRegimeChangedAtTurn: 900,
    });
    const out = await resolveForexBwInput(db as unknown as Db, null, true);
    expect(out).toEqual({ regime: "suspended", regimeChangedAtTurn: 900 });
  });

  it("falls back to null (pegged math) when the resume read finds no regime", async () => {
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current" });
    const out = await resolveForexBwInput(db as unknown as Db, null, true);
    expect(out).toBeNull();
  });
});
