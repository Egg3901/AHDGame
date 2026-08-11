/**
 * "It's not letting me relocate my London NPP to the south east." The picker
 * disabled the full target and said nothing else, so a refusal was
 * indistinguishable from a dead control. These pin the wording the player gets.
 */
import { describe, expect, it } from "vitest";
import { getRelocationBlockReason, type RelocationTargetOption } from "./relocationBlockReason";

function option(overrides: Partial<RelocationTargetOption> = {}): RelocationTargetOption {
  return {
    id: "UK_SE",
    name: "South East",
    currentNPPs: 4,
    maxSlots: 10,
    full: false,
    ...overrides,
  };
}

describe("getRelocationBlockReason", () => {
  it("says nothing when the chosen target has room", () => {
    expect(
      getRelocationBlockReason({
        targetOptions: [option()],
        selectedTargetId: "UK_SE",
        regionLabelLower: "region",
      })
    ).toBeNull();
  });

  it("says nothing before a target is chosen", () => {
    expect(
      getRelocationBlockReason({
        targetOptions: [option()],
        selectedTargetId: "",
        regionLabelLower: "region",
      })
    ).toBeNull();
  });

  it("names the chosen region, its numbers, and the way out", () => {
    const reason = getRelocationBlockReason({
      targetOptions: [
        option({ full: true, currentNPPs: 50, maxSlots: 50 }),
        option({ id: "UK_NW" }),
      ],
      selectedTargetId: "UK_SE",
      regionLabelLower: "region",
    });

    expect(reason).toContain("South East is at capacity for your party (50/50 politicians)");
    expect(reason).toContain("build your party organization there");
  });

  it("explains the dead dropdown when every region is full", () => {
    const reason = getRelocationBlockReason({
      targetOptions: [option({ full: true }), option({ id: "UK_NW", full: true })],
      selectedTargetId: "",
      regionLabelLower: "region",
    });

    expect(reason).toContain("Every other region is at capacity for your party");
  });

  it("uses the country's own word for a region", () => {
    const reason = getRelocationBlockReason({
      targetOptions: [option({ full: true })],
      selectedTargetId: "",
      regionLabelLower: "state",
    });

    expect(reason).toContain("Every other state is at capacity");
  });

  it("stays quiet when there is nowhere to move at all", () => {
    // A different message already covers the empty picker.
    expect(
      getRelocationBlockReason({
        targetOptions: [],
        selectedTargetId: "",
        regionLabelLower: "region",
      })
    ).toBeNull();
  });
});
