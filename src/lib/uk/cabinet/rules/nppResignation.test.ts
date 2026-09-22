import { describe, expect, it } from "vitest";
import {
  NPP_RESIGNATION_BASE_CHANCE,
  NPP_RESIGNATION_GRACE_TURNS,
  NPP_RESIGNATION_MAX_CHANCE,
  nppResignationChance,
  shouldNppMinisterResign,
} from "./nppResignation";

describe("nppResignationChance", () => {
  it("is zero during the grace period, whatever the approval", () => {
    expect(
      nppResignationChance({ approval: 0, turnsInPost: NPP_RESIGNATION_GRACE_TURNS - 1 })
    ).toBe(0);
    expect(shouldNppMinisterResign({ approval: 0, turnsInPost: 0 }, () => 0)).toBe(false);
  });

  it("is the base chance for a settled minister of a popular government", () => {
    expect(nppResignationChance({ approval: 100, turnsInPost: 10 })).toBe(
      NPP_RESIGNATION_BASE_CHANCE
    );
    expect(nppResignationChance({ approval: 50, turnsInPost: 10 })).toBe(
      NPP_RESIGNATION_BASE_CHANCE
    );
  });

  it("rises as approval falls, capped at the max", () => {
    const low = nppResignationChance({ approval: 25, turnsInPost: 10 });
    const floor = nppResignationChance({ approval: 0, turnsInPost: 10 });
    expect(low).toBeGreaterThan(NPP_RESIGNATION_BASE_CHANCE);
    expect(floor).toBeGreaterThan(low);
    expect(floor).toBeLessThanOrEqual(NPP_RESIGNATION_MAX_CHANCE);
    expect(nppResignationChance({ approval: -30, turnsInPost: 10 })).toBe(floor);
  });

  it("clamps approval above 100 to the base chance", () => {
    expect(nppResignationChance({ approval: 150, turnsInPost: 10 })).toBe(
      NPP_RESIGNATION_BASE_CHANCE
    );
  });

  it("rolls against the chance with the injected rng", () => {
    const input = { approval: 0, turnsInPost: 10 };
    const chance = nppResignationChance(input);
    expect(chance).toBeGreaterThan(0);
    expect(shouldNppMinisterResign(input, () => 0)).toBe(true);
    expect(shouldNppMinisterResign(input, () => 0.999)).toBe(false);
    expect(shouldNppMinisterResign(input, () => chance)).toBe(false);
  });
});
