import { describe, expect, it } from "vitest";
import {
  BLOC_DESIGNATION_PRESETS,
  CREATABLE_ORGANIZATION_CATEGORIES,
  ORGANIZATION_CATEGORIES,
  canTableResolutionType,
  resolveOrgCategory,
} from "./orgCategory";

const nato = (over: Partial<Parameters<typeof resolveOrgCategory>[0]> = {}) =>
  resolveOrgCategory({
    organizationId: "NATO",
    category: "security",
    preset: "1953-default",
    ...over,
  });

describe("the bloc designation", () => {
  it("makes the two Cold War alliances blocs in a Cold War world", () => {
    for (const preset of BLOC_DESIGNATION_PRESETS) {
      expect(nato({ preset }), preset).toBe("bloc");
      expect(
        resolveOrgCategory({ organizationId: "WARSAW_PACT", category: "security", preset }),
        preset
      ).toBe("bloc");
    }
  });

  it("gives a bloc the patronage and coercion a defence pact is denied", () => {
    // The reason the designation exists: aid and sanctions are how a superpower
    // ran its half of the world, and NATO and the Warsaw Pact were the only
    // orgs with an alignment channel in 1953 — so without this, both mechanics
    // were unreachable in the presets the game is actually about.
    for (const type of ["aid_package", "sanctions"] as const) {
      expect(canTableResolutionType("security", type), type).toBe(false);
      expect(canTableResolutionType("bloc", type), type).toBe(true);
    }
    // And keeps what it already had.
    for (const type of ["set_posture", "joint_statement", "set_dues"] as const) {
      expect(canTableResolutionType("bloc", type), type).toBe(true);
    }
  });

  it("leaves every other organisation alone", () => {
    expect(
      resolveOrgCategory({ organizationId: "UN", category: "political", preset: "1953-default" })
    ).toBe("political");
    expect(
      resolveOrgCategory({
        organizationId: "COMECON",
        category: "economic",
        preset: "1953-default",
      })
    ).toBe("economic");
  });

  it("does not apply in a world that did not begin in the Cold War", () => {
    expect(nato({ preset: "2019-default" })).toBe("security");
    expect(nato({ preset: undefined })).toBe("security");
  });

  it("holds however late the game runs, and ends only when the game ends it", () => {
    // The trap this exists to avoid: `resolveAlignmentEra` flips to
    // post-cold-war at 1991, and hanging the designation off it would strip
    // both blocs of half their tools on the calendar, in a game still fighting
    // the Cold War. Nothing here takes a year at all.
    expect(nato()).toBe("bloc");
    expect(nato({ coldWarEnded: false })).toBe("bloc");
    expect(nato({ coldWarEnded: true })).toBe("security");
  });

  it("leads the directory, and creatable categories keep their order", () => {
    // The directory groups by this array, so its order is display order.
    expect(ORGANIZATION_CATEGORIES[0]).toBe("bloc");
    expect(CREATABLE_ORGANIZATION_CATEGORIES[0]).toBe("political");
  });

  it("cannot be founded by a player", () => {
    // A player picking "bloc" would hand themselves powers a security alliance
    // is explicitly denied.
    expect(CREATABLE_ORGANIZATION_CATEGORIES).not.toContain("bloc");
    expect(CREATABLE_ORGANIZATION_CATEGORIES).toContain("security");
  });
});
