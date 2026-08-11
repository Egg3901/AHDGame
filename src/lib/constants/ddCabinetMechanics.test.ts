import { describe, expect, it } from "vitest";
import { DD_CABINET_MECHANICS } from "./ddCabinetMechanics";
import { DD_CABINET_POSITIONS } from "./ddCabinet";

describe("DD cabinet departments", () => {
  it("no department names the USSR", () => {
    for (const mech of Object.values(DD_CABINET_MECHANICS)) {
      expect(mech.department, mech.positionId).not.toMatch(/USSR|Soviet/i);
      for (const band of mech.departmentByYear ?? []) {
        expect(band.name, mech.positionId).not.toMatch(/USSR|Soviet/i);
      }
    }
  });

  it("every position keeps a mechanics entry with a matching positionId", () => {
    for (const pos of DD_CABINET_POSITIONS) {
      expect(DD_CABINET_MECHANICS[pos.id], pos.id).toBeDefined();
      expect(DD_CABINET_MECHANICS[pos.id].positionId).toBe(pos.id);
    }
  });

  it("the Staatsbank liaison band follows the 1968 rename", () => {
    const bands = DD_CABINET_MECHANICS.gosbank_liaison.departmentByYear;
    expect(bands).toBeDefined();
    expect(bands!.some((b) => b.from === 1968)).toBe(true);
  });

  it("keeps the RU levers it reuses", () => {
    // The department overrides must not drop the shared mechanics.
    expect(DD_CABINET_MECHANICS.chairman_of_gosplan.tierSetting).toBeDefined();
    expect(DD_CABINET_MECHANICS.minister_of_railways.regionalTarget).toBeDefined();
    expect(DD_CABINET_MECHANICS.minister_of_health.emergency).toBeDefined();
  });
});

describe("Eastern Bloc departments do not inherit GDR-specific names", () => {
  it("bloc councils get neutral bank and interior departments", async () => {
    const {
      EASTERN_BLOC_GENERAL_SECRETARY_CABINET_MECHANICS,
      PL_CABINET_MECHANICS,
      YU_CABINET_MECHANICS,
    } = await import("./easternBlocCabinet");
    for (const mechanics of [
      EASTERN_BLOC_GENERAL_SECRETARY_CABINET_MECHANICS,
      PL_CABINET_MECHANICS,
      YU_CABINET_MECHANICS,
    ]) {
      for (const mech of Object.values(mechanics)) {
        expect(mech.department, mech.positionId).not.toMatch(/DDR|Notenbank|State Security|USSR/i);
        for (const band of mech.departmentByYear ?? []) {
          expect(band.name, mech.positionId).not.toMatch(/DDR|Notenbank|State Security|USSR/i);
        }
      }
      expect(mechanics.gosbank_liaison.department).toBe("State Bank");
      expect(mechanics.gosbank_liaison.departmentByYear).toBeUndefined();
      expect(mechanics.minister_of_internal_affairs.department).toBe("Ministry of the Interior");
    }
  });
});
