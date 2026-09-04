import { describe, it, expect } from "vitest";
import { resolveCabinetTabs, isDefenseMinister, isIntelligenceMinister } from "./cabinetTabs";
import type { CabinetPositionMechanics } from "@/lib/constants/cabinetMechanicsTypes";

const base: CabinetPositionMechanics = {
  positionId: "x",
  department: "Dept",
  nationalMetrics: [],
  regionalMetrics: [],
};

describe("isDefenseMinister — RU/DD recognition", () => {
  it("recognizes the RU/DD minister_of_defence id", () => {
    expect(isDefenseMinister("minister_of_defence")).toBe(true);
  });
  it("still recognizes the existing defense ids and rejects non-defense", () => {
    expect(isDefenseMinister("secretary_of_defense")).toBe(true);
    expect(isDefenseMinister("minister_for_defence")).toBe(true); // IE
    expect(isDefenseMinister("secretary_of_education")).toBe(false);
  });
});

describe("resolveCabinetTabs — RU defense seat gains Commands + Doctrine when conflicts enabled", () => {
  it("exposes Military + Commands + Doctrine for RU minister_of_defence", () => {
    const tabs = resolveCabinetTabs({
      countryId: "RU",
      positionId: "minister_of_defence",
      mechanics: { ...base, positionId: "minister_of_defence" },
      conflictsEnabled: true,
    });
    const ids = tabs.map((t) => t.id);
    expect(ids).toContain("flagship"); // labelled "Military" for a defense seat
    expect(ids).toContain("commands");
    expect(ids).toContain("doctrine");
  });
});

describe("resolveCabinetTabs", () => {
  it("always includes Overview first and a flagship tab last", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_education",
      mechanics: base,
    });
    expect(tabs[0].id).toBe("overview");
    expect(tabs[tabs.length - 1].id).toBe("flagship");
  });

  it("adds a Treasury tab for the finance minister seat", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_treasury",
      mechanics: { ...base, positionId: "secretary_of_treasury" },
    });
    expect(tabs.some((t) => t.id === "treasury")).toBe(true);
  });

  it("does not add a Treasury tab for a non-finance seat", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_education",
      mechanics: base,
    });
    expect(tabs.some((t) => t.id === "treasury")).toBe(false);
  });

  it("adds a Foreign Relations tab for a foreign seat", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_state",
      mechanics: { ...base, positionId: "secretary_of_state" },
    });
    expect(tabs.some((t) => t.id === "foreign")).toBe(true);
  });

  it("labels the defense flagship tab 'Military'", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_defense",
      mechanics: { ...base, positionId: "secretary_of_defense" },
    });
    expect(tabs.find((t) => t.id === "flagship")?.label).toBe("Military");
  });

  it("labels a non-defense flagship tab 'Programs'", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_education",
      mechanics: base,
    });
    expect(tabs.find((t) => t.id === "flagship")?.label).toBe("Programs");
  });

  it("adds Commands + Doctrine tabs for a defense seat when Conflicts is enabled", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_defense",
      mechanics: { ...base, positionId: "secretary_of_defense" },
      conflictsEnabled: true,
    });
    expect(tabs.some((t) => t.id === "commands")).toBe(true);
    expect(tabs.some((t) => t.id === "doctrine")).toBe(true);
  });

  it("omits Commands + Doctrine tabs for a defense seat when Conflicts is disabled", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_defense",
      mechanics: { ...base, positionId: "secretary_of_defense" },
      conflictsEnabled: false,
    });
    expect(tabs.some((t) => t.id === "commands")).toBe(false);
    expect(tabs.some((t) => t.id === "doctrine")).toBe(false);
  });

  it("does not add Commands/Doctrine tabs to a non-defense seat even when Conflicts is enabled", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_education",
      mechanics: base,
      conflictsEnabled: true,
    });
    expect(tabs.some((t) => t.id === "commands")).toBe(false);
    expect(tabs.some((t) => t.id === "doctrine")).toBe(false);
  });

  it("gives the competition seat a Merger Review tab when the queue applies", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "attorney_general",
      mechanics: { ...base, positionId: "attorney_general" },
      competitionQueueApplies: true,
    });
    expect(tabs.some((t) => t.id === "competition")).toBe(true);
  });

  it("omits Merger Review when the server says the duty does not apply", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "attorney_general",
      mechanics: { ...base, positionId: "attorney_general" },
      competitionQueueApplies: false,
    });
    expect(tabs.some((t) => t.id === "competition")).toBe(false);
  });

  it("never gives Merger Review to a seat that is not the competition authority", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_education",
      mechanics: base,
      competitionQueueApplies: true,
    });
    expect(tabs.some((t) => t.id === "competition")).toBe(false);
  });
});

describe("the intelligence seat's console tab", () => {
  const intel = { ...base, positionId: "director_of_intelligence" };

  it("recognises the seat in every country, since the id is shared", () => {
    expect(isIntelligenceMinister("director_of_intelligence")).toBe(true);
    expect(isIntelligenceMinister("secretary_of_defense")).toBe(false);
  });

  it("gives the seat an Intelligence tab when Conflicts is enabled", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "director_of_intelligence",
      mechanics: intel,
      conflictsEnabled: true,
    });
    expect(tabs.some((t) => t.id === "intelligence")).toBe(true);
  });

  it("withholds it while the Conflicts subsystem is off", () => {
    // Same reasoning as Commands and Doctrine: this is Cold War machinery.
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "director_of_intelligence",
      mechanics: intel,
      conflictsEnabled: false,
    });
    expect(tabs.some((t) => t.id === "intelligence")).toBe(false);
  });

  it("never gives the tab to another seat", () => {
    const tabs = resolveCabinetTabs({
      countryId: "US",
      positionId: "secretary_of_defense",
      mechanics: { ...base, positionId: "secretary_of_defense" },
      conflictsEnabled: true,
    });
    expect(tabs.some((t) => t.id === "intelligence")).toBe(false);
  });
});
