import { describe, expect, it } from "vitest";
import {
  FREIGHT_HAUL_LOAD_MODE_DESCRIPTION,
  formatFreightTeu,
  freightHaulLoadCaption,
  freightHaulLoadLabel,
  freightHaulLoadTooltip,
} from "./freightHaulLoadCopy";

describe("freightHaulLoadCopy", () => {
  it("keeps sub-10 TEU loads from rounding into whole TEU", () => {
    expect(formatFreightTeu(0.1)).toBe("0.1");
    expect(formatFreightTeu(3.6)).toBe("3.6");
    expect(formatFreightTeu(4)).toBe("4");
    expect(formatFreightTeu(12.4)).toBe("12");
  });

  it("surfaces capacity beside haul and books haul as demand", () => {
    expect(FREIGHT_HAUL_LOAD_MODE_DESCRIPTION.toLowerCase()).toContain("haul load");
    const tip = freightHaulLoadTooltip("NY", {
      bulk: 3.6,
      special: 0,
      total: 3.6,
      capacity: 65,
    });
    expect(tip[0]).toBe("NY");
    expect(tip[1]).toBe("Freight capacity: 65 TEU");
    expect(tip[2]).toBe("Interstate haul: 3.6 TEU/turn (5.5%)");
    expect(tip[3]).toBe("Bulk: 3.6 · Special: 0");
    expect(tip[4]).toMatch(/counts as freight demand/i);
    expect(freightHaulLoadLabel({ bulk: 3.6, special: 0, total: 3.6, capacity: 65 })).toBe(
      "65 TEU"
    );
  });

  it("falls back to haul-only copy when capacity is unknown", () => {
    const tip = freightHaulLoadTooltip("NY", { bulk: 3.6, special: 0, total: 3.6 });
    expect(tip[1]).toBe("Projected haul load: 3.6 TEU/turn");
    expect(freightHaulLoadLabel(3.6)).toBe("3.6 TEU");
  });

  it("explains that haul feeds freight prices and sold %", () => {
    expect(freightHaulLoadCaption(false)).toMatch(/No freight data yet/i);
    const caption = freightHaulLoadCaption(true);
    expect(caption.toLowerCase()).not.toContain("ready customers");
    expect(caption).toMatch(/freight capacity/i);
    expect(caption).toMatch(/freight demand/i);
  });
});
