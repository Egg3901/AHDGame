import { describe, expect, it } from "vitest";
import { type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-09-11-central-bank-pricing-phase-in";

describe("central-bank pricing phase-in migration", () => {
  it("anchors the rollout to the current turn without replacing config", async () => {
    const db = createInMemoryDb();
    await db.collection("gameConfig").insertOne({
      _id: "default",
      lineOfCreditEnabled: true,
      centralBankPricingPhaseIn: {},
    });
    await db.collection("gameState").insertOne({ _id: "current", currentTurn: 240 });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(result.documentsUpdated).toBe(1);
    await expect(db.collection("gameConfig").findOne({ _id: "default" })).resolves.toMatchObject({
      lineOfCreditEnabled: true,
      centralBankPricingPhaseIn: { startedTurn: 240 },
    });
  });

  it("is a no-op in dry-run mode", async () => {
    const db = createInMemoryDb();
    await db.collection("gameConfig").insertOne({ _id: "default", centralBankPricingPhaseIn: {} });
    await db.collection("gameState").insertOne({ _id: "current", currentTurn: 240 });

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(result.documentsUpdated).toBe(0);
    await expect(db.collection("gameConfig").findOne({ _id: "default" })).resolves.toMatchObject({
      centralBankPricingPhaseIn: {},
    });
  });
});
