import { describe, it, expect } from "vitest";
import { foundingCooldownTurnsRemaining } from "./foundingCooldown";
import { CORPORATION_FOUNDING_COOLDOWN_TURNS } from "@/lib/constants/corporations";

describe("foundingCooldownTurnsRemaining (Bug #0728)", () => {
  it("returns 0 for a user's first-ever founding (no prior turn)", () => {
    expect(foundingCooldownTurnsRemaining(undefined, 10)).toBe(0);
    expect(foundingCooldownTurnsRemaining(null, 10)).toBe(0);
  });

  it("returns remaining turns while within the cooldown window", () => {
    // founded at 100, currentTurn 150 → 100 + 168 - 150 = 118 remaining
    expect(foundingCooldownTurnsRemaining(100, 150)).toBe(118);
  });

  it("returns 0 once the cooldown window has fully elapsed", () => {
    expect(foundingCooldownTurnsRemaining(100, 100 + CORPORATION_FOUNDING_COOLDOWN_TURNS)).toBe(0);
    expect(foundingCooldownTurnsRemaining(100, 1000)).toBe(0);
  });

  it("is exactly 1 on the turn before the window ends", () => {
    expect(foundingCooldownTurnsRemaining(100, 100 + CORPORATION_FOUNDING_COOLDOWN_TURNS - 1)).toBe(
      1
    );
  });
});
