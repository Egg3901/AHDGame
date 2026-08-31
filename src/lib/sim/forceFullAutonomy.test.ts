import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { forceFullAutonomy } from "./forceFullAutonomy";

/**
 * The harness writes two documents: `gameState` (autonomy + world-level gates)
 * and `gameConfig` (the economy/market half). The gameConfig write was missing
 * entirely, so a sandbox ran `marketSystemMode: "capital"` on top of an economy
 * with 16 of 20 flags absent — the tier looked configured while the mechanics
 * underneath it were inert. These pin both writes.
 */

interface Captured {
  collection: string;
  filter: unknown;
  update: Record<string, Record<string, unknown>>;
}

function captureDb(): { db: Db; writes: Captured[] } {
  const writes: Captured[] = [];
  const db = {
    collection: (name: string) => ({
      updateOne: async (filter: unknown, update: unknown) => {
        writes.push({ collection: name, filter, update: update as Captured["update"] });
        return { acknowledged: true };
      },
    }),
  } as unknown as Db;
  return { db, writes };
}

describe("forceFullAutonomy", () => {
  it("sets NPP autonomy to the maximum implemented level", async () => {
    const { db, writes } = captureDb();
    await forceFullAutonomy(db);
    const gameState = writes.find((w) => w.collection === "gameState");
    expect(gameState?.update.$set.nppAutonomyLevel).toBe("v3");
    expect(gameState?.update.$set.nppAutonomyEnabled).toBe(true);
  });

  it("can activate autonomous foreign policy for a balance run", async () => {
    const { db, writes } = captureDb();
    await forceFullAutonomy(db, "v4", "active", "support");
    const gameState = writes.find((w) => w.collection === "gameState");

    expect(gameState?.update.$set).toMatchObject({
      nppForeignPolicyMode: "active",
      nppForeignPolicyModeBy: "sim-harness",
      nppForeignPolicyStage: "support",
      nppForeignPolicyStageBy: "sim-harness",
    });
    expect(gameState?.update.$set.nppForeignPolicyModeAt).toBeTruthy();
  });

  it("forces the NPP offensive switches on, or the war stage simulates nothing", async () => {
    // Both ship OFF for real worlds. This helper defaults the foreign-policy stage to
    // "war", so a run at these settings exists to exercise offensives — and with the
    // switches off a belligerent is never offered `conduct_war` and never joins an
    // ally's attack, so the harness would report a fully-wired war stage that produced
    // zero of them. Same failure the crisis-spawn gate had before it was forced here.
    const { db, writes } = captureDb();
    await forceFullAutonomy(db);
    const gameState = writes.find((w) => w.collection === "gameState");

    expect(gameState?.update.$set).toMatchObject({
      nppOffensiveInitiationEnabled: true,
      nppOffensiveInitiationEnabledBy: "sim-harness",
      nppOffensiveJoinEnabled: true,
      nppOffensiveJoinEnabledBy: "sim-harness",
    });
  });

  it("can preserve player-country access for a production-shaped policy run", async () => {
    const { db, writes } = captureDb();
    await forceFullAutonomy(db, "v3", "active", "war", true);

    expect(writes.filter((write) => write.collection === "countryGameStates")).toHaveLength(0);
  });

  it("enables the engine-driven economy flags on gameConfig", async () => {
    const { db, writes } = captureDb();
    await forceFullAutonomy(db);
    const cfg = writes.find((w) => w.collection === "gameConfig");
    expect(cfg, "forceFullAutonomy must write gameConfig, not just gameState").toBeDefined();

    // Every one of these is read by a turn phase, so it actually fires headless.
    for (const flag of [
      "extractionOutputScaleEnabled",
      "commodityScarcityDriftEnabled",
      "qualityPremiumPricingEnabled",
      "sectorQualityEnabled",
      "stockCoverCapEnabled",
      "supplyAgreementsEnabled",
      "contractIssuanceEnabled",
      "prospectingEnabled",
      "brandLoyaltyEnabled",
      "nppCorporateAttacksEnabled",
    ]) {
      expect(cfg?.update.$set[flag], `${flag} should be enabled for the sim`).toBe(true);
    }
  });

  it("does not force era-derived or legacy flags", async () => {
    const { db, writes } = captureDb();
    await forceFullAutonomy(db);
    const set = {
      ...(writes.find((w) => w.collection === "gameConfig")?.update.$set ?? {}),
      ...(writes.find((w) => w.collection === "gameState")?.update.$set ?? {}),
    };
    // eurozoneEnabled is era-derived (seedForex); forcing it on corrupts FX for
    // any preset predating the euro. indexFundsEnabled is superseded by
    // indexFundsMode. altScoringEnabled is an ops kill-switch, on by default.
    expect(set).not.toHaveProperty("eurozoneEnabled");
    // Arming the launch guard auto-reverts clearing/capital back to "ledger"
    // mid-run and disarms itself, silently ending the experiment.
    expect(set).not.toHaveProperty("marketGuardEnabled");
    expect(set).not.toHaveProperty("indexFundsEnabled");
    expect(set).not.toHaveProperty("altScoringEnabled");
  });
});
