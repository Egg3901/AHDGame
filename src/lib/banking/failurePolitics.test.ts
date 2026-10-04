import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { bankFailureApprovalModifiers, loadBankFailureEffects } from "./failurePolitics";
import { migration } from "@/lib/migrations/entries/2026-10-04-bank-failure-politics-index";
describe("bank failure politics batching and gates", () => {
  it("activates recovered publication in one cohort and preserves its first delivery turn", async () => {
    const { createInMemoryDb } = await import("@/lib/test-utils/inMemoryDb");
    const memory = createInMemoryDb();
    memory.seed("bankFailurePoliticalEvents", [
      {
        _id: "pending",
        countryId: "US",
        paidTurn: null,
        depositExposure: 1000,
        taxpayerPaid: 200,
        gdp: 100000,
      },
    ]);
    const first = await loadBankFailureEffects(memory as unknown as Db, 10, true);
    expect(first.get("US")).toEqual({ approval: -0.2, consumerConfidence: -1 });
    const repeated = await loadBankFailureEffects(memory as unknown as Db, 11, true);
    expect(memory.collection("bankFailurePoliticalEvents").docs[0].paidTurn).toBe(10);
    expect(repeated.get("US")?.approval).toBeCloseTo((-0.2 * 47) / 48);
  });
  it("makes zero event reads with the switch off", async () => {
    const db = createMockDb();
    await loadBankFailureEffects(db as unknown as Db, 10, false);
    expect(db.collection("bankFailurePoliticalEvents").find).not.toHaveBeenCalled();
    expect(db.collection("gameConfig").findOne).not.toHaveBeenCalled();
  });
  it("loads one projected, bounded cohort for all countries", async () => {
    const db = createMockDb();
    db.collection("bankFailurePoliticalEvents").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "one",
          countryId: "US",
          paidTurn: 10,
          gdp: 100_000,
          taxpayerPaid: 200,
          depositExposure: 1000,
        },
        {
          _id: "two",
          countryId: "UK",
          paidTurn: 10,
          gdp: 50_000,
          taxpayerPaid: 100,
          depositExposure: 500,
        },
      ]),
    });
    const effects = await loadBankFailureEffects(db as unknown as Db, 10, true);
    expect(db.collection("bankFailurePoliticalEvents").find).toHaveBeenCalledTimes(1);
    expect(db.collection("bankFailurePoliticalEvents").find.mock.calls[0][0]).toEqual({
      $or: [{ paidTurn: { $gt: -38, $lte: 10 } }, { paidTurn: null }],
    });
    expect(effects.get("US")).toEqual(effects.get("UK"));
    expect(bankFailureApprovalModifiers(effects.get("US"))[0]).toMatchObject({
      source: "banking",
      marginEffect: 0,
      effect: -0.2,
    });
  });
  it("resolves an absent flag to off and never queries events", async () => {
    const db = createMockDb();
    await loadBankFailureEffects(db as unknown as Db, 10);
    expect(db.collection("bankFailurePoliticalEvents").find).not.toHaveBeenCalled();
  });
  it("registers the bounded-read index with dry-run and idempotent apply", async () => {
    const db = createMockDb();
    await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collection("bankFailurePoliticalEvents").createIndex).not.toHaveBeenCalled();
    await migration.execute(db as unknown as Db, { dryRun: false });
    expect(db.collection("bankFailurePoliticalEvents").createIndex).toHaveBeenCalledWith(
      { paidTurn: 1 },
      { name: "paid_turn" }
    );
  });
});
