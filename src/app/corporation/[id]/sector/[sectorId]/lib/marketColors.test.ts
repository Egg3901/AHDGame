import { describe, it, expect } from "vitest";
import { PLAYER_SLOT_COLORS, NPP_ARC_COLOR, playerSlotColor } from "./marketColors";

describe("playerSlotColor", () => {
  it("gives the same corp the same colour every time", () => {
    // The old ring coloured by array index, so a rival leaving the sector
    // repainted everyone after it and "the blue one" stopped meaning anything.
    expect(playerSlotColor("corp-abc", 0)).toBe(playerSlotColor("corp-abc", 7));
  });

  it("does not repaint survivors when an earlier rival drops out", () => {
    const before = ["a", "b", "c"].map((id, i) => playerSlotColor(id, i));
    const after = ["b", "c"].map((id, i) => playerSlotColor(id, i));
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[2]);
  });

  it("only ever returns a validated slot colour", () => {
    for (const id of ["a", "zzz", "corp-1", "corp-2", "corp-3", "corp-4", "corp-5"]) {
      expect(PLAYER_SLOT_COLORS).toContain(playerSlotColor(id, 0));
    }
  });

  it("falls back to the index only when there is no identity to key off", () => {
    expect(playerSlotColor(undefined, 1)).toBe(PLAYER_SLOT_COLORS[1]);
    expect(playerSlotColor(undefined, PLAYER_SLOT_COLORS.length)).toBe(PLAYER_SLOT_COLORS[0]);
  });
});

describe("palette composition", () => {
  it("keeps teal off pink's shoulder", () => {
    // Order is load-bearing: adjacent #0d9488 and #db2777 measure ΔE 3.8 under
    // deuteranopia, which is a hard fail. As ordered they are not neighbours.
    const teal = PLAYER_SLOT_COLORS.indexOf("#0d9488");
    const pink = PLAYER_SLOT_COLORS.indexOf("#db2777");
    expect(Math.abs(teal - pink)).toBeGreaterThan(1);
  });

  it("stops at four rather than growing a fifth hue", () => {
    // Past four the answer is the list, not another colour. A generated fifth is
    // indistinguishable from an existing slot under CVD.
    expect(PLAYER_SLOT_COLORS).toHaveLength(4);
  });

  it("keeps the NPP arc out of the player slots", () => {
    expect(PLAYER_SLOT_COLORS).not.toContain(NPP_ARC_COLOR);
  });
});
