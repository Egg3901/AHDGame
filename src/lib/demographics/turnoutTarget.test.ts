import { describe, it, expect } from "vitest";
import {
  isBucketTarget,
  turnoutModifierPath,
  readTurnoutModifier,
  turnoutTargetLabel,
} from "./turnoutTarget";
import { allBucketIds } from "./bucketLabels";

describe("turnout target ids", () => {
  it("accepts every bucket the picker can offer", () => {
    for (const id of allBucketIds()) {
      expect(isBucketTarget(id), id).toBe(true);
    }
  });

  it("rejects archetype ids and malformed input", () => {
    for (const id of ["retirees", "college_liberals", "race", "race:", ":black", ""]) {
      expect(isBucketTarget(id), id).toBe(false);
    }
  });

  // Storage only needs bucket-vs-archetype. Whether a bucket EXISTS for a
  // country is a separate question, because the keys differ per country.
  it("accepts the international dimensions the non-US models use", () => {
    for (const id of ["ethnicity:white_british", "income:low", "urbanization:rural"]) {
      expect(isBucketTarget(id), id).toBe(true);
    }
  });

  it("routes a bucket target to its dimension, not to voterGroups", () => {
    expect(turnoutModifierPath("race:black")).toBe("modifiers.race.black");
    expect(turnoutModifierPath("education:no_college")).toBe("modifiers.education.no_college");
  });

  // The whole point of keeping the legacy branch: an address delivered before
  // this change wrote to modifiers.voterGroups, and expiry must subtract from
  // the same field or the boost never comes off.
  it("keeps legacy archetype targets on the voterGroups field", () => {
    expect(turnoutModifierPath("college_liberals")).toBe("modifiers.voterGroups.college_liberals");
  });

  it("reads back from whichever field it writes to", () => {
    const modifiers = { race: { black: 4 }, voterGroups: { retirees: 7 } };
    expect(readTurnoutModifier(modifiers, "race:black")).toBe(4);
    expect(readTurnoutModifier(modifiers, "retirees")).toBe(7);
    expect(readTurnoutModifier(modifiers, "age:young")).toBe(0);
    expect(readTurnoutModifier(undefined, "race:black")).toBe(0);
  });

  it("labels both target kinds as English, never a raw key", () => {
    expect(turnoutTargetLabel("race:black")).toBe("Black voters");
    expect(turnoutTargetLabel("education:no_college")).toBe("No degree");
    expect(turnoutTargetLabel("college_liberals")).toBe("College Liberals");
    for (const id of allBucketIds()) {
      const label = turnoutTargetLabel(id);
      expect(label).not.toContain(":");
      expect(label).not.toContain("_");
    }
  });
});
