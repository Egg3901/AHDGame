import { describe, it, expect } from "vitest";
import { MINISTERIAL_ACTION_CAP, MINISTERIAL_ACTION_REGEN_INTERVAL } from "./cabinetMechanicsTypes";

describe("ministerial action economy", () => {
  it("caps ministerial actions at 4", () => {
    expect(MINISTERIAL_ACTION_CAP).toBe(4);
  });

  it("keeps the 24-turn regen interval", () => {
    expect(MINISTERIAL_ACTION_REGEN_INTERVAL).toBe(24);
  });
});
