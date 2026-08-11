import { describe, it, expect } from "vitest";
import { formatSectorTypeSlugsInText } from "@/lib/utils/formatSectorTypeSlugsInText";

describe("formatSectorTypeSlugsInText", () => {
  it("replaces snake_case sector slugs with labels", () => {
    expect(formatSectorTypeSlugsInText("Raid on real_estate sector")).toBe(
      "Raid on Real Estate sector"
    );
    expect(formatSectorTypeSlugsInText("untapped telecommunications market")).toBe(
      "untapped Telecommunications market"
    );
  });

  it("leaves unknown tokens unchanged", () => {
    expect(formatSectorTypeSlugsInText("No sector here")).toBe("No sector here");
  });

  it("does not match inside longer words", () => {
    expect(formatSectorTypeSlugsInText("xmediax")).toBe("xmediax");
  });
});
