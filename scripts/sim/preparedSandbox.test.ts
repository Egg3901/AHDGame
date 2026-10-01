import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { preparedConfigurationHash, preservedAutonomyLevel } from "./preparedSandbox";
import { buildRunWorldArgs } from "./simJobArgs";

const preparedSandbox = {
  gameStateSha256: "a".repeat(64),
  gameConfigSha256: "b".repeat(64),
  initialTurn: 1,
};

describe("prepared world arguments and provenance", () => {
  it("preserves configuration without cloning production", () => {
    expect(buildRunWorldArgs({ preparedSandbox })).toEqual([
      "--clone-mode",
      "--preserve-live-config",
    ]);
  });

  it.each([
    { marketSystemMode: "plants" },
    { autonomyLevel: "v4" },
    { allFeatureFlags: true },
    { campaignEraPriceLevelEnabled: true },
    { frontierEntryExperimentEnabled: false },
    { sovereignIssuanceConsolidationEnabled: false },
    { domesticSovereignBondCoverageEnabled: true },
    { mode: "elections-only" },
    { actors: "synthetic" },
    { countries: "US" },
  ])("rejects a gameplay or population override %j", (override) => {
    expect(() => buildRunWorldArgs({ preparedSandbox, ...override })).toThrow();
  });

  it("reports the preserved v4 level rather than the CLI v3 default", () => {
    expect(preservedAutonomyLevel("v4")).toBe("v4");
    expect(() => preservedAutonomyLevel("v6")).toThrow();
  });

  it("hashes restored BSON and captured JSON identically despite key order", () => {
    const id = new ObjectId("000000000000000000000001");
    const at = new Date("1991-01-01T00:00:00Z");
    const original = { _id: id, at, options: { b: false, a: [1, 2] } };
    const restored = {
      options: { a: [1, 2], b: false },
      at: at.toISOString(),
      _id: id.toHexString(),
    };
    expect(preparedConfigurationHash(original)).toBe(preparedConfigurationHash(restored));
    expect(preparedConfigurationHash({ ...restored, options: { a: [1, 2], b: true } })).not.toBe(
      preparedConfigurationHash(original)
    );
  });
});
