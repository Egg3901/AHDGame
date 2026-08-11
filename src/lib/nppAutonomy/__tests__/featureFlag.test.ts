import { describe, it, expect } from "vitest";
import { isNppAutonomyEnabled, isNppAutonomyActive } from "../featureFlag";
import type { Db } from "mongodb";

function mockDb(gameStateDoc: any, enabledForPlayers: boolean): Db {
  const gameState = { findOne: async () => gameStateDoc };
  const countryGameStates = { findOne: async () => ({ enabledForPlayers }) };
  return {
    collection: (name: string) =>
      name === "gameState"
        ? gameState
        : name === "countryGameStates"
          ? countryGameStates
          : { findOne: async () => null },
  } as unknown as Db;
}

describe("nppAutonomy featureFlag", () => {
  it("isNppAutonomyEnabled reads gameState.nppAutonomyEnabled", async () => {
    expect(await isNppAutonomyEnabled(mockDb({ nppAutonomyEnabled: true }, false))).toBe(true);
    expect(await isNppAutonomyEnabled(mockDb({ nppAutonomyEnabled: false }, false))).toBe(false);
    expect(await isNppAutonomyEnabled(mockDb({}, false))).toBe(false);
  });

  it("isNppAutonomyActive is true only when flag on AND country disabled", async () => {
    expect(await isNppAutonomyActive(mockDb({ nppAutonomyEnabled: true }, false), "US")).toBe(true);
    // flag on but country enabled for players -> false (safety rail)
    expect(await isNppAutonomyActive(mockDb({ nppAutonomyEnabled: true }, true), "US")).toBe(false);
    // flag off -> false regardless
    expect(await isNppAutonomyActive(mockDb({ nppAutonomyEnabled: false }, false), "US")).toBe(
      false
    );
  });
});
