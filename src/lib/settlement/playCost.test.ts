import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import { getPlay } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/currency/characterFunds", () => ({
  getHomeCurrency: vi.fn().mockReturnValue("RUB"),
  loadCharacterFxRate: vi.fn(),
}));

const db = {} as Db;

function character(over: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    actions: 5,
    funds: 50_000,
    currencyBalances: { campaign: 200_000 },
    ...over,
  } as Character;
}

describe("seatFundsLocal", () => {
  it("takes an authored local figure at face value", async () => {
    const { seatFundsLocal } = await import("./playCost");
    // `credit`: $60M, already the seat country's own currency.
    expect(seatFundsLocal(getPlay("credit")!)).toBe(60_000_000);
  });

  it("is zero for a seat play with no funds cost", async () => {
    const { seatFundsLocal } = await import("./playCost");
    expect(seatFundsLocal(getPlay("terms")!)).toBe(0);
  });
});

describe("resolvePersonalFunds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("charges the anchor cost as-is when forex is off, against `funds`", async () => {
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);
    const { resolvePersonalFunds } = await import("./playCost");
    const out = await resolvePersonalFunds(db, character(), getPlay("rally")!);
    expect(out).toEqual({ local: 5_000, field: "funds", balanceLocal: 50_000 });
  });

  it("converts at the home rate when forex is on, against the campaign balance", async () => {
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
    vi.mocked(loadCharacterFxRate).mockResolvedValue({ rate: 4, ok: true });
    const { resolvePersonalFunds } = await import("./playCost");
    const out = await resolvePersonalFunds(db, character(), getPlay("rally")!);
    expect(out).toEqual({
      local: 20_000,
      field: "currencyBalances.campaign",
      balanceLocal: 200_000,
    });
  });

  it("rounds the converted cost to a whole unit", async () => {
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
    vi.mocked(loadCharacterFxRate).mockResolvedValue({ rate: 1.337, ok: true });
    const { resolvePersonalFunds } = await import("./playCost");
    const out = await resolvePersonalFunds(db, character(), getPlay("rally")!);
    expect(Number.isInteger(out.local)).toBe(true);
    expect(out.local).toBe(6_685);
  });

  it("costs nothing for a free personal play but still reports the right field", async () => {
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
    vi.mocked(loadCharacterFxRate).mockResolvedValue({ rate: 4, ok: true });
    const { resolvePersonalFunds } = await import("./playCost");
    const out = await resolvePersonalFunds(db, character(), getPlay("oped")!);
    expect(out.local).toBe(0);
    expect(out.field).toBe("currencyBalances.campaign");
  });

  it("does not consult an FX rate when forex is off", async () => {
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);
    const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
    const { resolvePersonalFunds } = await import("./playCost");
    await resolvePersonalFunds(db, character(), getPlay("rally")!);
    expect(vi.mocked(loadCharacterFxRate)).not.toHaveBeenCalled();
  });

  it("does not consult an FX rate for a free play even when forex is on", async () => {
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
    const { resolvePersonalFunds } = await import("./playCost");
    await resolvePersonalFunds(db, character(), getPlay("letter")!);
    expect(vi.mocked(loadCharacterFxRate)).not.toHaveBeenCalled();
  });

  it("reads the balance from the field forex selects, not the other one", async () => {
    // The two differ by design here: 50k in `funds`, 200k in the campaign
    // balance. Reading the wrong one is wrong by exactly the exchange rate.
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
    vi.mocked(loadCharacterFxRate).mockResolvedValue({ rate: 1, ok: true });
    const { resolvePersonalFunds } = await import("./playCost");
    const out = await resolvePersonalFunds(db, character(), getPlay("rally")!);
    expect(out.balanceLocal).toBe(200_000);
  });
});
