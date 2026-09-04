import { describe, expect, it } from "vitest";
import { DD_CABINET_MECHANICS } from "./ddCabinetMechanics";
import { DD_CABINET_POSITIONS } from "./ddCabinet";
import { PERPETUAL_YEAR } from "@/lib/cabinet/rosterEra";

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
      expect(mechanics.director_of_intelligence.department).toBe("Security Service");
    }
  });

  it("no bloc SEAT NAME carries a GDR or Soviet-specific title", async () => {
    // The department check above never looked at seat names, so a GDR-specific
    // title could reach eight countries unnoticed. DD's security seat is the
    // Stasi by name and by its 1950 stand-up; the bloc must carry neither.
    const {
      EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS,
      PL_CABINET_POSITIONS,
      YU_CABINET_POSITIONS,
      UNION_REPUBLIC_CABINET_POSITIONS,
    } = await import("./easternBlocCabinet");
    for (const positions of [
      EASTERN_BLOC_GENERAL_SECRETARY_CABINET_POSITIONS,
      PL_CABINET_POSITIONS,
      YU_CABINET_POSITIONS,
      UNION_REPUBLIC_CABINET_POSITIONS,
    ]) {
      for (const position of positions) {
        expect(position.name, position.id).not.toMatch(/DDR|Stasi|USSR|Soviet/i);
      }
      const security = positions.find((p) => p.id === "director_of_intelligence")!;
      expect(security.name).toBe("Minister of State Security");
      // Perpetual, not DD's 1950: Poland's UB dates from 1945 and the rest
      // likewise predate the MfS.
      expect(security.yearEnabled).toBe(PERPETUAL_YEAR);
    }
  });
});
