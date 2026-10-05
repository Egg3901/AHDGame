import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { gameConfig as referenceGameConfig } from "@/lib/seeds/reference/gameConfig";
import {
  STALE_MARKET_MODE_STAMP_UNSET,
  STALE_PER_WORLD_GAME_CONFIG_UNSET,
  TURN_ANCHORED_GAME_CONFIG_KEPT,
  coreGameConfigUpdate,
} from "./coreGameConfigUpdate";

describe("1991 player banking seed settings", () => {
  it("enables fresh/reset 1991 access while preserving existing disabled gates on top-up", async () => {
    const db = createInMemoryDb();
    const config = db.collection("gameConfig");
    await config.updateOne({ _id: "default" }, coreGameConfigUpdate(false, 1991), { upsert: true });
    expect(config.docs[0]).toMatchObject({
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
      playerAdvancedBankChartersEnabled: true,
      bankPropForexFeesEnabled: true,
    });
    await config.updateOne(
      { _id: "default" },
      { $set: { playerAdvancedBankChartersEnabled: false, bankPropForexFeesEnabled: false } }
    );
    await config.updateOne({ _id: "default" }, coreGameConfigUpdate(false, 1991), { upsert: true });
    expect(config.docs[0]).toMatchObject({
      playerAdvancedBankChartersEnabled: false,
      bankPropForexFeesEnabled: false,
    });
    await config.updateOne({ _id: "default" }, coreGameConfigUpdate(true, 1991), { upsert: true });
    expect(config.docs[0]).toMatchObject({
      playerAdvancedBankChartersEnabled: true,
      bankPropForexFeesEnabled: true,
    });
  });
  it("leaves absent banking gates absent when topping up an existing legacy world", async () => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [{ _id: "default" }]);
    await db
      .collection("gameConfig")
      .updateOne({ _id: "default" }, coreGameConfigUpdate(false, 1991), { upsert: true });
    for (const key of [
      "privateBankingEnabled",
      "bankPropTradingEnabled",
      "playerAdvancedBankChartersEnabled",
      "bankPropForexFeesEnabled",
    ])
      expect(db.collection("gameConfig").docs[0]).not.toHaveProperty(key);
  });
});

/** Top-level GameConfig fields with their declared types, read from the type source. */
function gameConfigFields(): Array<{ name: string; type: string }> {
  const src = readFileSync(path.resolve(__dirname, "../../db/types/gameConfig.ts"), "utf8");
  const start = src.indexOf("export interface GameConfig {");
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let body = "";
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (depth >= 1) body += c;
    if (depth === 0) break;
  }
  const fields: Array<{ name: string; type: string }> = [];
  for (const match of body.matchAll(/^ {2}([A-Za-z0-9_]+)\??:\s*([^;]+);/gm)) {
    fields.push({ name: match[1], type: match[2] });
  }
  return fields;
}

describe("turn-anchored gameConfig state on reset", () => {
  // A field anchored to the outgoing world's turn counter makes a turn-1 world
  // behave as if it were deep into the old one.
  const turnAnchored = gameConfigFields()
    .filter(
      ({ name, type }) =>
        /Turns?$/.test(name) ||
        /Intervention$/.test(name) ||
        /^bankConstructionAdmission/.test(name) ||
        /\bstartedTurn\b|Turn\??:/.test(type)
    )
    .map(({ name }) => name);

  it("finds the turn-anchored fields in the type source", () => {
    expect(turnAnchored).toEqual(
      expect.arrayContaining([
        "retailDemandTransitionStartTurn",
        "commodityNominalPriceIndexTurn",
        "nppMarketCoverageIntervention",
        "centralBankPricingPhaseIn",
      ])
    );
  });

  it("clears or explicitly keeps every turn-anchored field", () => {
    const unclassified = turnAnchored.filter(
      (name) =>
        !(name in STALE_PER_WORLD_GAME_CONFIG_UNSET) &&
        !(name in STALE_MARKET_MODE_STAMP_UNSET) &&
        !(name in TURN_ANCHORED_GAME_CONFIG_KEPT)
    );
    expect(unclassified).toEqual([]);
  });

  it("never unsets a key the reference config rewrites, which would race the seed", () => {
    for (const key of Object.keys(STALE_PER_WORLD_GAME_CONFIG_UNSET)) {
      expect(referenceGameConfig).not.toHaveProperty(key);
    }
  });

  it("keeps ops access gates out of the unset list", () => {
    for (const key of ["sandboxTesterAccessEnabled", "maintenanceMode", "marketGuardEnabled"]) {
      expect(STALE_PER_WORLD_GAME_CONFIG_UNSET).not.toHaveProperty(key);
    }
  });

  it("leaves an old world's stamps absent after the reset update, like a fresh seed", async () => {
    const db = createInMemoryDb();
    db.seed("gameConfig", [
      {
        _id: "default",
        retailDemandTransitionStartTurn: 514,
        retailDemandTransitionTurns: 192,
        commodityNominalPriceIndex: 1.9569,
        commodityNominalPriceIndexTurn: 1329,
        nppMarketCoverageIntervention: { review: { startTurn: 445, reviewTurn: 493 } },
        sandboxTesterAccessEnabled: true,
      },
    ]);
    await db
      .collection("gameConfig")
      .updateOne({ _id: "default" }, { $unset: STALE_PER_WORLD_GAME_CONFIG_UNSET });
    const doc = db.collection("gameConfig").docs[0];
    for (const key of Object.keys(STALE_PER_WORLD_GAME_CONFIG_UNSET)) {
      expect(doc).not.toHaveProperty(key);
    }
    expect(doc.sandboxTesterAccessEnabled).toBe(true);
  });
});
