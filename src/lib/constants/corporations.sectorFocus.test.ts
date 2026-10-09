import { describe, expect, it } from "vitest";
import { sectorPolicyTargetMatches } from "./corporations";
import { updateCorporationSettingsSchema } from "@/lib/api/schemas/corporations";

describe("updateCorporationSettingsSchema", () => {
  it("accepts operating lanes and rejects unknown focus", () => {
    expect(updateCorporationSettingsSchema.safeParse({ primaryType: "unknown_type" }).success).toBe(
      false
    );
    expect(
      updateCorporationSettingsSchema.safeParse({ secondaryType: "unknown_type" }).success
    ).toBe(false);
    expect(updateCorporationSettingsSchema.safeParse({ secondaryType: null }).success).toBe(true);
    expect(updateCorporationSettingsSchema.safeParse({ primaryType: "media" }).success).toBe(true);
  });
});

describe("sectorPolicyTargetMatches", () => {
  it("lets legacy retired targets reach only the folded lanes", () => {
    expect(sectorPolicyTargetMatches("manufacturing_vehicles", "manufacturing_vehicles")).toBe(
      true
    );
    expect(sectorPolicyTargetMatches("manufacturing_vehicles", "manufacturing")).toBe(false);
    expect(sectorPolicyTargetMatches("media_entertainment", "media_entertainment")).toBe(true);
    expect(sectorPolicyTargetMatches("media_entertainment", "media")).toBe(false);
  });

  it("lets canonical targets cover their folded lanes", () => {
    expect(sectorPolicyTargetMatches("manufacturing", "manufacturing")).toBe(true);
    expect(sectorPolicyTargetMatches("manufacturing", "manufacturing_vehicles")).toBe(true);
    expect(sectorPolicyTargetMatches("media", "media_entertainment")).toBe(true);
    expect(sectorPolicyTargetMatches("media", "manufacturing_vehicles")).toBe(false);
  });

  it("never matches an empty or unrelated target", () => {
    expect(sectorPolicyTargetMatches(undefined, "manufacturing")).toBe(false);
    expect(sectorPolicyTargetMatches("energy", "manufacturing_vehicles")).toBe(false);
  });
});
