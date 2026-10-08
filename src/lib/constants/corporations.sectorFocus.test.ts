import { describe, expect, it } from "vitest";
import { FOUNDABLE_CORPORATION_TYPES, sectorFocusOptions } from "./corporations";
import { updateCorporationSettingsSchema } from "@/lib/api/schemas/corporations";

describe("sectorFocusOptions", () => {
  it("offers only foundable types for a modern corporation", () => {
    const options = sectorFocusOptions("manufacturing");
    expect(options).toEqual([...FOUNDABLE_CORPORATION_TYPES]);
    expect(options).not.toContain("automobiles");
    expect(options).not.toContain("entertainment");
  });

  it("keeps a legacy retired focus visible for that corporation only", () => {
    expect(sectorFocusOptions("automobiles")).toContain("automobiles");
    expect(sectorFocusOptions("automobiles")).not.toContain("entertainment");
  });

  it("ignores unknown values", () => {
    expect(sectorFocusOptions("not_a_type")).toEqual([...FOUNDABLE_CORPORATION_TYPES]);
    expect(sectorFocusOptions(null)).toEqual([...FOUNDABLE_CORPORATION_TYPES]);
  });
});

describe("updateCorporationSettingsSchema", () => {
  it("rejects switching focus to a retired type", () => {
    expect(updateCorporationSettingsSchema.safeParse({ primaryType: "automobiles" }).success).toBe(
      false
    );
    expect(
      updateCorporationSettingsSchema.safeParse({ secondaryType: "entertainment" }).success
    ).toBe(false);
    expect(updateCorporationSettingsSchema.safeParse({ secondaryType: null }).success).toBe(true);
    expect(updateCorporationSettingsSchema.safeParse({ primaryType: "media" }).success).toBe(true);
  });
});
