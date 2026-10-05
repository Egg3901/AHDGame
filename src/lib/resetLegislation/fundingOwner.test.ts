import { describe, expect, it } from "vitest";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import { resetLawFamilies } from "./catalog";
import { fundingNameForLaw1991, fundingSeatForLaw, type ResetCountry } from "./fundingOwner";

const countries: ResetCountry[] = ["US", "UK", "JP"];

describe("1991 reset funding owners", () => {
  it("resolves every law to an existing, era-active Cabinet seat", () => {
    for (const country of countries) {
      const roster = getCabinetPositions(country);
      for (const law of resetLawFamilies) {
        const seatId = fundingSeatForLaw(law, country);
        const seat = roster.find((position) => position.id === seatId);
        expect(seat, `${country} ${law.id}: ${seatId}`).toBeDefined();
        expect(isSeatActive(seat!, 1991), `${country} ${law.id}: ${seatId}`).toBe(true);
      }
    }
  });

  it("uses the legislated US education split only when enabled", () => {
    const law = resetLawFamilies.find((family) => family.id === "L10")!;
    expect(fundingSeatForLaw(law, "US")).toBe("secretary_of_health");
    expect(fundingSeatForLaw(law, "US", new Set(["secretary_of_education"]))).toBe(
      "secretary_of_education"
    );
  });

  it("honors the historical exception seats", () => {
    const byId = (id: string) => resetLawFamilies.find((family) => family.id === id)!;
    expect(fundingSeatForLaw(byId("L50"), "US")).toBe("secretary_of_treasury");
    expect(fundingSeatForLaw(byId("L21"), "UK")).toBe("health_secretary");
    expect(fundingSeatForLaw(byId("L36"), "UK")).toBe("justice_secretary");
    expect(fundingSeatForLaw(byId("L37"), "JP")).toBe("health_minister");
  });

  it("shows 1991 institution names instead of successor departments", () => {
    const byId = (id: string) => resetLawFamilies.find((family) => family.id === id)!;
    expect(fundingNameForLaw1991(byId("L10"), "US")).toBe(
      "Department of Health, Education, and Welfare"
    );
    expect(fundingNameForLaw1991(byId("L10"), "US", new Set(["secretary_of_education"]))).toBe(
      "U.S. Department of Education"
    );
    expect(fundingNameForLaw1991(byId("L29"), "UK")).toBe("Dept of Trade and Industry");
    expect(fundingNameForLaw1991(byId("L15"), "JP")).toBe(
      "Ministry of Education, Science and Culture"
    );
    expect(fundingNameForLaw1991(byId("L30"), "JP")).toBe(
      "Ministry of International Trade and Industry"
    );
    expect(fundingNameForLaw1991(byId("L50"), "US")).toBe(
      "Department of the Treasury (ATF funding)"
    );
  });
});
