import { describe, expect, it } from "vitest";
import { pickTier, validateOutcomeTable } from "./tiers";
import type { OutcomeTier } from "@/lib/db/types/events";

const TABLE: OutcomeTier[] = [
  { minRoll: 1, maxRoll: 39, label: "bad", effects: [] },
  { minRoll: 40, maxRoll: 79, label: "mid", effects: [] },
  { minRoll: 80, maxRoll: 100, label: "good", effects: [] },
];

describe("event substrate tiers", () => {
  it("pickTier maps roll to the correct band", () => {
    expect(pickTier(TABLE, 1).label).toBe("bad");
    expect(pickTier(TABLE, 39).label).toBe("bad");
    expect(pickTier(TABLE, 40).label).toBe("mid");
    expect(pickTier(TABLE, 80).label).toBe("good");
    expect(pickTier(TABLE, 100).label).toBe("good");
  });

  it("pickTier throws when roll is uncovered", () => {
    expect(() => pickTier(TABLE, 0)).toThrow(/not covered/i);
  });

  it("validateOutcomeTable accepts a full 1–100 partition", () => {
    expect(() => validateOutcomeTable(TABLE)).not.toThrow();
  });

  it("validateOutcomeTable rejects gaps", () => {
    const gapTable: OutcomeTier[] = [
      { minRoll: 1, maxRoll: 50, label: "a", effects: [] },
      { minRoll: 52, maxRoll: 100, label: "b", effects: [] },
    ];
    expect(() => validateOutcomeTable(gapTable)).toThrow(/gap/i);
  });
});
