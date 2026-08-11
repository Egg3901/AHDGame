import { describe, expect, it } from "vitest";
import { formatRemainingTurns } from "./formatRemainingTurns";

describe("formatRemainingTurns", () => {
  it("null target → No timer", () => {
    expect(formatRemainingTurns(null, 100)).toEqual({ text: "No timer", urgency: "normal" });
    expect(formatRemainingTurns(undefined, 100)).toEqual({ text: "No timer", urgency: "normal" });
  });

  it("target already reached → Ended", () => {
    expect(formatRemainingTurns(100, 100)).toEqual({ text: "Ended", urgency: "ended" });
    expect(formatRemainingTurns(98, 100)).toEqual({ text: "Ended", urgency: "ended" });
  });

  it("leads with the turn count, hour estimate in parens", () => {
    expect(formatRemainingTurns(102, 100).text).toBe("2 turns (~2h)");
  });

  it("singular turn has no plural 's'", () => {
    expect(formatRemainingTurns(101, 100).text).toBe("1 turn (~1h)");
  });

  it("rolls hours into days for long horizons", () => {
    expect(formatRemainingTurns(124, 100).text).toBe("24 turns (~1d)");
    expect(formatRemainingTurns(125, 100).text).toBe("25 turns (~1d 1h)");
  });

  it("preserves urgency thresholds (critical < 6 turns, warning < 24, else normal)", () => {
    expect(formatRemainingTurns(105, 100).urgency).toBe("critical"); // 5 turns
    expect(formatRemainingTurns(110, 100).urgency).toBe("warning"); // 10 turns
    expect(formatRemainingTurns(130, 100).urgency).toBe("normal"); // 30 turns
  });
});
