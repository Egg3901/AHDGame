import { describe, expect, it } from "vitest";
import { isFreePartyMoveWindowOpen } from "./antiAbuseGuards";

/**
 * The one free party move is gated by an explicit admin flag
 * (gameState.freePartyMovesOpen), NOT inferred from the pause state. A staged
 * launch unpauses for verification turns and re-pauses, so the pre-go-live pause
 * looks identical to an ordinary mid-game admin pause — hence the explicit flag.
 */
describe("isFreePartyMoveWindowOpen", () => {
  it("is true only when the admin flag is explicitly set", () => {
    expect(isFreePartyMoveWindowOpen({ freePartyMovesOpen: true })).toBe(true);
  });

  it("is false when the flag is off", () => {
    expect(isFreePartyMoveWindowOpen({ freePartyMovesOpen: false })).toBe(false);
  });

  it("is false when the flag is absent (default)", () => {
    expect(isFreePartyMoveWindowOpen({})).toBe(false);
  });

  it("is false for null/undefined game state", () => {
    expect(isFreePartyMoveWindowOpen(null)).toBe(false);
    expect(isFreePartyMoveWindowOpen(undefined)).toBe(false);
  });
});
