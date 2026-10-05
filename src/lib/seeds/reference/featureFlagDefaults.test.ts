import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_STATE_FLAGS,
  FRESH_WORLD_FLAG_EXCLUSIONS,
  FRESH_WORLD_GAME_CONFIG_FLAGS,
  NON_GAMEPLAY_GAME_CONFIG_FIELDS,
  NON_GAMEPLAY_GAME_STATE_FIELDS,
  missingGameStateFlagDefaults,
  splitFreshWorldGameConfigFlags,
} from "./featureFlagDefaults";
import { gameConfig as referenceGameConfig } from "./gameConfig";
import { MARKET_MODE_ORDER } from "@/lib/market/modes";

/**
 * Top-level fields of an interface that look like flags: anything typed as a
 * boolean, plus string-union rollout modes (`...Mode`, `...Stage`, `...Level`).
 * Read from the type source so a newly added flag is caught without anyone
 * remembering to register it.
 */
function flagFieldsOf(file: string, iface: string): string[] {
  const src = readFileSync(path.resolve(__dirname, "../../db/types", file), "utf8");
  const start = src.indexOf(`export interface ${iface} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let body = "";
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (depth === 1 && c !== "{") body += c;
    if (depth === 0) break;
  }
  const fields: string[] = [];
  for (const match of body.matchAll(/^ {2}([A-Za-z0-9_]+)\??:\s*([^;]+);/gm)) {
    const [, name, type] = match;
    const isBoolean = /\bboolean\b/.test(type);
    const isMode = /(Mode|Stage|Level)$/.test(name) && !/^(string|number)$/.test(type.trim());
    if (isBoolean || isMode) fields.push(name);
  }
  return fields;
}

const LADDER_TOPS: Record<string, string> = {
  nppForeignPolicyMode: "active",
  nppForeignPolicyStage: "war",
  nppEntryViabilityMode: "enforce",
  indexFundsMode: "full",
  labourSystemMode: "full",
  marketSystemMode: MARKET_MODE_ORDER[MARKET_MODE_ORDER.length - 1],
  freightSettlementMode: "active",
};

describe("fresh-world flag policy", () => {
  it("excludes only NPP v5", () => {
    expect(Object.keys(FRESH_WORLD_FLAG_EXCLUSIONS)).toEqual(["nppAutonomyLevel"]);
    expect(DEFAULT_GAME_STATE_FLAGS.nppAutonomyLevel).toBe("v4");
    expect(DEFAULT_GAME_STATE_FLAGS.nppAutonomyEnabled).toBe(true);
  });

  it("turns every gameState gameplay flag on, at the top of every ladder", () => {
    for (const [key, value] of Object.entries(DEFAULT_GAME_STATE_FLAGS)) {
      if (key in FRESH_WORLD_FLAG_EXCLUSIONS) continue;
      // Reset-era version selectors pick a system, they are not on/off features.
      if (key.endsWith("SystemVersion")) continue;
      expect([key, value]).toEqual([key, typeof value === "boolean" ? true : LADDER_TOPS[key]]);
    }
  });

  it("turns every gameConfig gameplay flag on, at the top of every ladder", () => {
    for (const [key, value] of Object.entries(FRESH_WORLD_GAME_CONFIG_FLAGS)) {
      expect([key, value]).toEqual([key, typeof value === "boolean" ? true : LADDER_TOPS[key]]);
    }
  });

  it("reads the flag fields from the type sources", () => {
    expect(flagFieldsOf("gameState.ts", "GameState")).toEqual(
      expect.arrayContaining(["forexEnabled", "nppAutonomyLevel", "macroGrowthV1"])
    );
    expect(flagFieldsOf("gameConfig.ts", "GameConfig")).toEqual(
      expect.arrayContaining(["treasuryCashLedgerEnabled", "marketSystemMode", "maintenanceMode"])
    );
  });

  it("fails when a new gameState flag is neither on for fresh worlds nor recorded as non-gameplay", () => {
    const unclassified = flagFieldsOf("gameState.ts", "GameState").filter(
      (key) => !(key in DEFAULT_GAME_STATE_FLAGS) && !(key in NON_GAMEPLAY_GAME_STATE_FIELDS)
    );
    expect(unclassified).toEqual([]);
  });

  it("fails when a new gameConfig flag is neither on for fresh worlds nor recorded as non-gameplay", () => {
    const unclassified = flagFieldsOf("gameConfig.ts", "GameConfig").filter(
      (key) => !(key in FRESH_WORLD_GAME_CONFIG_FLAGS) && !(key in NON_GAMEPLAY_GAME_CONFIG_FIELDS)
    );
    expect(unclassified).toEqual([]);
  });

  it("never lists a field as both a fresh-world flag and a non-gameplay switch", () => {
    for (const key of Object.keys(DEFAULT_GAME_STATE_FLAGS)) {
      expect(NON_GAMEPLAY_GAME_STATE_FIELDS).not.toHaveProperty(key);
    }
    for (const key of Object.keys(FRESH_WORLD_GAME_CONFIG_FLAGS)) {
      expect(NON_GAMEPLAY_GAME_CONFIG_FIELDS).not.toHaveProperty(key);
    }
  });

  it("is what the reference gameConfig seeds", () => {
    expect(referenceGameConfig).toMatchObject(FRESH_WORLD_GAME_CONFIG_FLAGS);
    expect(referenceGameConfig.treasuryCashLedgerEnabled).toBe(true);
  });

  it("keeps the household-demand alternative from double-counting", () => {
    expect(referenceGameConfig.householdConsumptionEnabled).toBe(true);
    expect(referenceGameConfig.demographicsDemandEnabled).toBe(false);
  });

  it("routes every flag and switch key to the insert-only half of a top-up", () => {
    const { settings, flags } = splitFreshWorldGameConfigFlags(referenceGameConfig);
    expect(flags).toMatchObject(FRESH_WORLD_GAME_CONFIG_FLAGS);
    expect(flags).toHaveProperty("adminRegistrationEnabled");
    expect(settings).not.toHaveProperty("treasuryCashLedgerEnabled");
    expect(settings).toHaveProperty("startingFunds");
  });
});

describe("missingGameStateFlagDefaults", () => {
  it("returns every default for a missing or empty doc", () => {
    expect(missingGameStateFlagDefaults(null)).toEqual(DEFAULT_GAME_STATE_FLAGS);
    expect(missingGameStateFlagDefaults({})).toEqual(DEFAULT_GAME_STATE_FLAGS);
  });

  it("preserves an explicit false on an existing world", () => {
    const out = missingGameStateFlagDefaults({ autoDisastersEnabled: false });
    expect(out).not.toHaveProperty("autoDisastersEnabled");
    expect(out).toMatchObject({ forexEnabled: true, rpgStatsEnabled: true });
  });

  it("treats the NPP autonomy pair as one flag: legacy explicit disable wins", () => {
    const out = missingGameStateFlagDefaults({ nppAutonomyEnabled: false });
    expect(out).not.toHaveProperty("nppAutonomyLevel");
    expect(out).not.toHaveProperty("nppAutonomyEnabled");
  });

  it("does not change a configured autonomy level", () => {
    const out = missingGameStateFlagDefaults({ nppAutonomyLevel: "v2" });
    expect(out).not.toHaveProperty("nppAutonomyLevel");
    expect(out).not.toHaveProperty("nppAutonomyEnabled");
  });

  it("starts all reset-era systems on the live v1 path", () => {
    expect(missingGameStateFlagDefaults(null)).toMatchObject({
      metricsSystemVersion: "v1",
      legislationSystemVersion: "v1",
      cabinetSystemVersion: "v1",
    });
  });

  it("preserves independently selected system versions across reset", () => {
    const out = missingGameStateFlagDefaults({
      metricsSystemVersion: "v2",
      cabinetSystemVersion: "v1",
    });
    expect(out).not.toHaveProperty("metricsSystemVersion");
    expect(out).not.toHaveProperty("cabinetSystemVersion");
    expect(out).toHaveProperty("legislationSystemVersion", "v1");
  });
});
