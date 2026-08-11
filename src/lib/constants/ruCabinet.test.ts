import { describe, it, expect } from "vitest";
import { RU_CABINET_POSITIONS } from "./ruCabinet";

describe("RU_CABINET_POSITIONS (Council of Ministers, spec §3 / D7)", () => {
  it("has 16 uniquely-identified seats with contiguous orders", () => {
    expect(RU_CABINET_POSITIONS).toHaveLength(16);
    const ids = RU_CABINET_POSITIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(16);
    expect([...RU_CABINET_POSITIONS.map((p) => p.order)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i)
    );
  });

  it("exactly one head-of-government seat (the Premier — never cabinet-appointable)", () => {
    const hog = RU_CABINET_POSITIONS.filter(
      (p) => "isHeadOfGovernment" in p && p.isHeadOfGovernment
    );
    expect(hog).toHaveLength(1);
    expect(hog[0].id).toBe("premier");
  });

  it("splits Foreign and Internal Trade into visually distinct seats (D7)", () => {
    const foreign = RU_CABINET_POSITIONS.find((p) => p.id === "minister_of_foreign_trade");
    const internal = RU_CABINET_POSITIONS.find((p) => p.id === "minister_of_internal_trade");
    expect(foreign).toBeDefined();
    expect(internal).toBeDefined();
    expect(foreign!.name).not.toBe(internal!.name);
  });

  it("carries the distinctly Soviet planning seats", () => {
    const ids = RU_CABINET_POSITIONS.map((p) => p.id);
    expect(ids).toContain("chairman_of_gosplan");
    expect(ids).toContain("gosbank_liaison");
    expect(ids).toContain("minister_of_machine_building");
  });
});
