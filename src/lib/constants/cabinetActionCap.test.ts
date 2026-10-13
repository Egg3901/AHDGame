import { describe, it, expect } from "vitest";
import {
  MINISTERIAL_ACTION_ACCRUAL_TURNS,
  MINISTERIAL_ACTION_CAP,
  MINISTERIAL_ACTION_REGEN_INTERVAL,
} from "./cabinetMechanicsTypes";

describe("ministerial action economy", () => {
  it("caps ministerial actions at 4", () => {
    expect(MINISTERIAL_ACTION_CAP).toBe(4);
  });

  it("accrues one action every 6 turns (4 per day at 1 turn per hour)", () => {
    expect(MINISTERIAL_ACTION_ACCRUAL_TURNS).toBe(6);
  });

  it("keeps the deprecated 24-turn regen interval export", () => {
    expect(MINISTERIAL_ACTION_REGEN_INTERVAL).toBe(24);
  });
});
