import { describe, expect, it } from "vitest";
import { NG_CABINET_POSITIONS } from "./ngCabinet";
import { getCabinetPositions, getCabinetPositionGroup } from "./cabinetMechanics";
import { NG_CABINET_MECHANICS } from "./ngCabinetMechanics";

const VALID_GROUPS = new Set([
  "Centre",
  "Economy",
  "Security & Foreign",
  "Society",
  "Domestic",
  "Nations",
]);

describe("NG cabinet (Federal Executive Council)", () => {
  it("registers the appointable portfolios with non-empty names", () => {
    expect(NG_CABINET_POSITIONS.length).toBeGreaterThanOrEqual(14);
    for (const pos of NG_CABINET_POSITIONS) {
      expect(pos.name).toBeTruthy();
    }
  });

  it("includes minister_of_finance (matches countries.ts financeMinisterCabinetId)", () => {
    expect(NG_CABINET_POSITIONS.some((p) => p.id === "minister_of_finance")).toBe(true);
  });

  it("positions are ordered by the order field", () => {
    for (let i = 0; i < NG_CABINET_POSITIONS.length - 1; i++) {
      expect(NG_CABINET_POSITIONS[i]!.order).toBeLessThanOrEqual(
        NG_CABINET_POSITIONS[i + 1]!.order
      );
    }
  });

  it("is presidential — no cabinet seat is flagged head-of-government", () => {
    for (const pos of NG_CABINET_POSITIONS) {
      expect((pos as { isHeadOfGovernment?: boolean }).isHeadOfGovernment ?? false).toBe(false);
    }
  });

  it("getCabinetPositions('NG') resolves the roster", () => {
    expect(getCabinetPositions("NG").length).toBe(NG_CABINET_POSITIONS.length);
  });

  it("every position has a mechanics entry and a valid group", () => {
    for (const pos of NG_CABINET_POSITIONS) {
      expect(NG_CABINET_MECHANICS[pos.id], `mechanics for ${pos.id}`).toBeTruthy();
      expect(VALID_GROUPS.has(getCabinetPositionGroup("NG", pos.id)), `group for ${pos.id}`).toBe(
        true
      );
    }
  });
});
