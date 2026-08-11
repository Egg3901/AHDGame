import { describe, expect, it } from "vitest";

import { formatTreasuryReserveInputValue } from "@/lib/currency/treasuryReserveDisplay";

describe("treasuryReserveDisplay", () => {
  it("returns a rounded integer string for valid amounts", () => {
    expect(formatTreasuryReserveInputValue(10_000)).toBe("10000");
    expect(formatTreasuryReserveInputValue(10_000.4)).toBe("10000");
    expect(formatTreasuryReserveInputValue(10_000.6)).toBe("10001");
  });

  it("clamps null/undefined/non-positive values to '0'", () => {
    expect(formatTreasuryReserveInputValue(null)).toBe("0");
    expect(formatTreasuryReserveInputValue(undefined)).toBe("0");
    expect(formatTreasuryReserveInputValue(-100)).toBe("0");
    expect(formatTreasuryReserveInputValue(0)).toBe("0");
  });
});
