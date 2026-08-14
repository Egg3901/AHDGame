import { describe, expect, it } from "vitest";
import { getCabinetPositions, getCabinetCountryIds } from "./cabinetMechanics";
import { resolveCabinetRoster, resolveSeatName, isSeatActive } from "@/lib/cabinet/rosterEra";

const PRESETS = [1953, 1979, 1991, 2019] as const;

describe("US cabinet year gating", () => {
  const us = getCabinetPositions("US");

  it("active seat counts per preset year", () => {
    // Education no longer auto-enables by year (legislation-gated), so 1991/2019
    // are one seat lighter than before until a Department of Education Act passes.
    expect(resolveCabinetRoster(us, 1953)).toHaveLength(9);
    expect(resolveCabinetRoster(us, 1979)).toHaveLength(12);
    expect(resolveCabinetRoster(us, 1991)).toHaveLength(13);
    expect(resolveCabinetRoster(us, 2019)).toHaveLength(14);
  });

  it("existence gates carry the researched years", () => {
    const byId = Object.fromEntries(us.map((p) => [p.id, p]));
    expect(byId.secretary_of_hud.yearEnabled).toBe(1965);
    expect(byId.secretary_of_transportation.yearEnabled).toBe(1967);
    expect(byId.secretary_of_energy.yearEnabled).toBe(1977);
    // Education is legislation-gated: never auto-enables by year.
    expect(byId.secretary_of_education.yearEnabled).toBe(9999);
    expect(byId.secretary_of_veterans.yearEnabled).toBe(1989);
    expect(byId.secretary_of_homeland.yearEnabled).toBe(2002);
    expect(byId.secretary_of_health.yearEnabled).toBe(1953);
  });

  it("HEW stays HEW by year alone; splits to HHS only via legislation", () => {
    const health = us.find((p) => p.id === "secretary_of_health")!;
    // No year auto-flips HEW to HHS anymore.
    expect(resolveSeatName(health, 1953)).toBe("Secretary of Health, Education, and Welfare");
    expect(resolveSeatName(health, 1980)).toBe("Secretary of Health, Education, and Welfare");
    expect(resolveSeatName(health, 2019)).toBe("Secretary of Health, Education, and Welfare");

    // Department of Education Act passed → Education seat active + HEW renamed HHS.
    const split = new Set(["secretary_of_education"]);
    const education = us.find((p) => p.id === "secretary_of_education")!;
    expect(isSeatActive(education, 1954, split)).toBe(true);
    expect(isSeatActive(education, 1954)).toBe(false);
    expect(resolveSeatName(health, 1954, split)).toBe("Secretary of Health and Human Services");
    expect(resolveCabinetRoster(us, 1954, split)).toHaveLength(10);
  });

  it("active-set orders are unique at every preset year", () => {
    for (const year of PRESETS) {
      const orders = resolveCabinetRoster(us, year).map((p) => p.order);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });
});

describe("UK cabinet year gating", () => {
  const uk = getCabinetPositions("UK");
  const byId = Object.fromEntries(uk.map((p) => [p.id, p]));

  it("18 defined seats; active counts per preset year", () => {
    expect(uk).toHaveLength(18);
    expect(resolveCabinetRoster(uk, 1953)).toHaveLength(14);
    expect(resolveCabinetRoster(uk, 1979)).toHaveLength(17);
    expect(resolveCabinetRoster(uk, 1991)).toHaveLength(17);
    expect(resolveCabinetRoster(uk, 2019)).toHaveLength(17);
  });

  it("existence gates", () => {
    expect(byId.first_secretary_of_state.yearEnabled).toBe(1962);
    expect(byId.northern_ireland.yearEnabled).toBe(1972);
    expect(byId.wales.yearEnabled).toBe(1964);
    expect(byId.environment_secretary.yearEnabled).toBe(2001);
  });

  it("MAFF succession pair never co-active anywhere in the era domain", () => {
    const maff = byId.agriculture_secretary;
    expect(maff.yearRetired).toBe(2001);
    expect(maff.succeededBy).toBe("environment_secretary");
    for (let y = 1950; y <= 2049; y++) {
      expect(
        resolveCabinetRoster([maff, byId.environment_secretary], y).length
      ).toBeLessThanOrEqual(1);
    }
  });

  it("2019 canonical-name corrections (no 2021+ anachronisms)", () => {
    expect(resolveSeatName(byId.business_secretary, 2019)).toBe(
      "Secretary of State for Business, Energy and Industrial Strategy"
    );
    expect(resolveSeatName(byId.levelling_secretary, 2019)).toBe(
      "Secretary of State for Housing, Communities and Local Government"
    );
    expect(byId.environment_secretary.name).toBe(
      "Secretary of State for Environment, Food and Rural Affairs"
    );
  });

  it("1953 renames", () => {
    expect(resolveSeatName(byId.defence_secretary, 1953)).toBe("Secretary of State for War");
    expect(resolveSeatName(byId.defence_secretary, 1963)).toBe("Secretary of State for War");
    expect(resolveSeatName(byId.defence_secretary, 1964)).toBe("Secretary of State for Defence");
    expect(resolveSeatName(byId.justice_secretary, 1953)).toBe("Lord Chancellor");
    expect(resolveSeatName(byId.health_secretary, 1953)).toBe("Minister of Health");
    expect(resolveSeatName(byId.business_secretary, 1953)).toBe("President of the Board of Trade");
    expect(resolveSeatName(byId.work_secretary, 1953)).toBe(
      "Minister of Labour and National Service"
    );
    expect(resolveSeatName(byId.agriculture_secretary, 1953)).toBe(
      "Minister of Agriculture and Fisheries"
    );
  });

  it("defence department follows War Office → MoD", async () => {
    const { getCabinetMechanics } = await import("./cabinetMechanics");
    const { resolveDepartment } = await import("@/lib/cabinet/rosterEra");
    const mech = getCabinetMechanics("UK", "defence_secretary")!;
    expect(resolveDepartment(mech, 1953)).toBe("War Office");
    expect(resolveDepartment(mech, 1964)).toBe("Ministry of Defence");
  });

  it("foreign / agriculture / labour departments follow era bands", async () => {
    const { getCabinetMechanics } = await import("./cabinetMechanics");
    const { resolveDepartment } = await import("@/lib/cabinet/rosterEra");
    const foreign = getCabinetMechanics("UK", "foreign_secretary")!;
    expect(resolveDepartment(foreign, 1953)).toBe("Foreign Office");
    expect(resolveDepartment(foreign, 1979)).toBe("Foreign and Commonwealth Office");
    expect(resolveDepartment(foreign, 2019)).toBe("Foreign and Commonwealth Office");
    expect(resolveDepartment(foreign, 2020)).toBe("Foreign, Commonwealth & Development Office");

    const agri = getCabinetMechanics("UK", "agriculture_secretary")!;
    expect(resolveDepartment(agri, 1953)).toBe("Ministry of Agriculture and Fisheries");
    expect(resolveDepartment(agri, 1955)).toBe("Ministry of Agriculture, Fisheries and Food");

    const work = getCabinetMechanics("UK", "work_secretary")!;
    expect(resolveDepartment(work, 1953)).toBe("Ministry of Labour and National Service");
    expect(resolveDepartment(work, 1959)).toBe("Ministry of Labour");
    expect(resolveDepartment(work, 1968)).toBe("Dept of Employment");
    expect(resolveDepartment(work, 2001)).toBe("Dept for Work and Pensions");
  });

  it("1979 DHSS-era names", () => {
    expect(resolveSeatName(byId.health_secretary, 1979)).toBe(
      "Secretary of State for Social Services"
    );
    expect(resolveSeatName(byId.levelling_secretary, 1979)).toBe(
      "Secretary of State for the Environment"
    );
    expect(resolveSeatName(byId.work_secretary, 1979)).toBe("Secretary of State for Employment");
  });

  it("agriculture seat has mechanics, orders, and the Domestic group", async () => {
    const { getCabinetMechanics, getCabinetPositionGroup } = await import("./cabinetMechanics");
    expect(getCabinetMechanics("UK", "agriculture_secretary")).toBeDefined();
    expect(getCabinetPositionGroup("UK", "agriculture_secretary")).toBe("Domestic");
    const { UK_MINISTERIAL_ORDERS } = await import("./ukCabinetOrders");
    expect(UK_MINISTERIAL_ORDERS.agriculture_secretary).toHaveLength(2);
  });

  it("active-set orders unique at preset years", () => {
    for (const year of PRESETS) {
      const orders = resolveCabinetRoster(uk, year).map((p) => p.order);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });
});

describe("RU cabinet year gating", () => {
  const ru = getCabinetPositions("RU");
  it("all seats perpetual; premier gets the 1991 title band", () => {
    for (const p of ru) expect(p.yearEnabled).toBe(1775);
    const premier = ru.find((p) => p.id === "premier")!;
    expect(resolveSeatName(premier, 1979)).toBe("Chairman of the Council of Ministers");
    expect(resolveSeatName(premier, 1991)).toBe("Prime Minister of the USSR");
  });
});

describe("DD cabinet year gating", () => {
  const dd = getCabinetPositions("DD");
  const byId = Object.fromEntries(dd.map((p) => [p.id, p]));

  it("1953 runs 14 of 16 seats; 1979 all 16", () => {
    expect(resolveCabinetRoster(dd, 1953)).toHaveLength(14);
    expect(resolveCabinetRoster(dd, 1979)).toHaveLength(16);
  });

  it("existence gates", () => {
    expect(byId.minister_of_defence.yearEnabled).toBe(1956);
    expect(byId.minister_of_culture.yearEnabled).toBe(1954);
  });

  it("1953 name bands", () => {
    expect(resolveSeatName(byId.generalSecretary, 1953)).toBe("First Secretary");
    expect(resolveSeatName(byId.generalSecretary, 1979)).toBe("General Secretary");
    expect(resolveSeatName(byId.gosbank_liaison, 1953)).toBe(
      "Council Liaison to the Deutsche Notenbank"
    );
    expect(resolveSeatName(byId.gosbank_liaison, 1979)).toBe("Council Liaison to the Staatsbank");
    expect(resolveSeatName(byId.minister_of_agriculture, 1953)).toBe(
      "Minister of Agriculture and Forestry"
    );
    expect(resolveSeatName(byId.minister_of_higher_education, 1953)).toBe(
      "State Secretary for Higher Education"
    );
    expect(resolveSeatName(byId.minister_of_higher_education, 1979)).toBe(
      "Minister of Higher and Technical Education"
    );
  });
});

describe("every registered cabinet seat has an explicit yearEnabled", () => {
  it("no country ships an implicit default", () => {
    for (const countryId of getCabinetCountryIds()) {
      for (const position of getCabinetPositions(countryId)) {
        expect(
          position.yearEnabled,
          `${countryId}:${position.id} missing explicit yearEnabled`
        ).toBeTypeOf("number");
      }
    }
  });
});
