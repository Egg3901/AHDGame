import { describe, expect, it } from "vitest";
import { alignmentColor, customBlocPalette } from "./alignmentColors";
import { isCustomAlignmentPoleToken } from "./alignmentEras";
import { resolveOrgIdentity } from "./orgIdentity";
import { buildBlocPalette } from "@/app/world/worldBlocs";

describe("chosen Bloc colors", () => {
  it.each(["#a855f7", "#12ABcd", "#008080", "#000000", "#ffffff"] as const)(
    "uses %s consistently for organization, alignment and map",
    (color) => {
      expect(isCustomAlignmentPoleToken(color)).toBe(true);
      const selected = customBlocPalette(color);
      expect(selected.accent).toBe(color.toLowerCase());
      expect(selected.accentSoft).toMatch(/^#[0-9a-f]{6}$/);
      expect(alignmentColor(color)).toBe(selected.accent);
      expect(resolveOrgIdentity("chosen", true, "Chosen", "bloc", null, color).accent).toBe(
        selected.accent
      );
      expect(
        buildBlocPalette([{ poleId: "ORG:chosen", label: "Chosen", accentToken: color }])[
          "ORG:chosen"
        ].fill
      ).toBe(selected.accent);
    }
  );

  it.each([
    "#abc",
    "#abcdef00",
    "red",
    "#gggggg",
    "url(evil)",
    "#123456;",
    "#123456\n",
    "#123456\r\n",
    "",
    "success",
  ])("rejects invalid custom color %s", (color) => {
    expect(isCustomAlignmentPoleToken(color)).toBe(false);
  });

  it("preserves legacy token appearance", () => {
    expect(isCustomAlignmentPoleToken("info")).toBe(true);
    expect(customBlocPalette("warning").accent).toBe("#c58b20");
    expect(alignmentColor("info")).toBe("var(--info)");
    expect(alignmentColor("success")).toBe("var(--success)");
  });
});
