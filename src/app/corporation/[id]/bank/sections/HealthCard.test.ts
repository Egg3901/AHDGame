import { describe, expect, it } from "vitest";
import { panicTurnOrdinal } from "./HealthCard";

describe("panicTurnOrdinal", () => {
  it("uses first for a one-turn run", () => {
    expect(panicTurnOrdinal(1)).toBe("first");
  });

  it("uses English ordinals (ticket #1111 showed 3th)", () => {
    expect(panicTurnOrdinal(2)).toBe("2nd");
    expect(panicTurnOrdinal(3)).toBe("3rd");
    expect(panicTurnOrdinal(4)).toBe("4th");
    expect(panicTurnOrdinal(11)).toBe("11th");
    expect(panicTurnOrdinal(12)).toBe("12th");
    expect(panicTurnOrdinal(13)).toBe("13th");
    expect(panicTurnOrdinal(21)).toBe("21st");
    expect(panicTurnOrdinal(22)).toBe("22nd");
    expect(panicTurnOrdinal(23)).toBe("23rd");
  });
});
