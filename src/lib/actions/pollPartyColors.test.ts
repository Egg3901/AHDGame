import { describe, it, expect } from "vitest";
import { resolvePollPartyColors } from "./pollPartyColors";

describe("resolvePollPartyColors", () => {
  it("uses stored colors, legacy names, then neutral gray", () => {
    const out = resolvePollPartyColors(
      ["3", "democrat", "independent", "9", null, "3"],
      [{ sequentialId: 3, color: "#112233" }]
    );
    expect(out).toEqual({
      "3": "#112233",
      democrat: "#3b82f6",
      independent: "#9CA3AF",
      "9": "#9CA3AF",
    });
  });
});
