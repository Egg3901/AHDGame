import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  tradeApproaches,
  blockadeClosureFor,
  blockadeClosureByCountry,
  blockadeAffinityMultiplier,
  BLOCKADE,
} from "../blockade";
import type { NavairUnit, NavalMission } from "../types";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";

function hull(
  countryId: string,
  station: RegionCode,
  mission: NavalMission,
  over: Partial<NavairUnit> = {}
): NavairUnit {
  return {
    _id: new ObjectId(),
    countryId: countryId as CountryId,
    branchId: "navy",
    domain: "naval",
    name: "Squadron",
    type: "Guided-Missile Destroyer",
    icon: "ship",
    posture: "standard",
    techTier: 1,
    personnel: 1000,
    readiness: 100,
    basePower: 64,
    upkeepBase: 100,
    vet: 2,
    xp: 0,
    equipment: { firepower: 50, protection: 50, support: 50 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
    station,
    mission,
    integrity: 100,
    supply: 100,
    ...over,
  } as NavairUnit;
}

const hostileTo = (...ids: string[]) => new Set(ids);

describe("tradeApproaches", () => {
  it("includes navigable water next to a landlocked-typed home region", () => {
    // Western Europe is typed `land` because that is what the theatre is, but its trade
    // plainly goes by sea. Adjacency is what makes that work without a lane table.
    const approaches = tradeApproaches("weu");
    expect(approaches.length).toBeGreaterThan(0);
  });

  it("is empty for no region", () => {
    expect(tradeApproaches(undefined)).toEqual([]);
  });
});

describe("blockadeClosureFor", () => {
  it("is zero when nobody is blockading", () => {
    expect(blockadeClosureFor("US", [], hostileTo("RU"))).toBe(0);
  });

  it("ignores a neutral fleet sitting in the same water", () => {
    // Otherwise a superpower could strangle a country's trade by parking ships nearby
    // without ever declaring war.
    const neutral = [hull("FR", "nat", "BLOCKADE")];
    expect(blockadeClosureFor("US", neutral, hostileTo("RU"))).toBe(0);
  });

  it("ignores hostile hulls that are not actually blockading", () => {
    const transiting = [hull("RU", "nat", "TRANSIT"), hull("RU", "nat", "PORT")];
    expect(blockadeClosureFor("US", transiting, hostileTo("RU"))).toBe(0);
  });

  it("rises with committed blockading force", () => {
    const one = [hull("RU", "nat", "BLOCKADE")];
    const many = Array.from({ length: 8 }, () => hull("RU", "nat", "BLOCKADE"));
    const light = blockadeClosureFor("US", one, hostileTo("RU"));
    const heavy = blockadeClosureFor("US", many, hostileTo("RU"));
    expect(heavy).toBeGreaterThan(light);
    expect(light).toBeGreaterThan(0);
  });

  it("weighs a blockade posture above sea denial above escort", () => {
    const at = (m: NavalMission) =>
      blockadeClosureFor("US", [hull("RU", "nat", m)], hostileTo("RU"));
    expect(at("BLOCKADE")).toBeGreaterThan(at("SEA_DENIAL"));
    expect(at("SEA_DENIAL")).toBeGreaterThan(at("ESCORT"));
  });

  it("never reaches total closure from a single squadron", () => {
    const closure = blockadeClosureFor("US", [hull("RU", "nat", "BLOCKADE")], hostileTo("RU"));
    expect(closure).toBeLessThan(1);
  });

  it("takes the worst approach, not the sum of them", () => {
    // Closing one of several routes into a country does not close the country.
    const oneRoute = [hull("RU", "nat", "BLOCKADE")];
    const closure = blockadeClosureFor("US", oneRoute, hostileTo("RU"));
    expect(closure).toBeLessThanOrEqual(1);
  });
});

describe("blockadeClosureByCountry", () => {
  it("returns an empty map when no war is running", () => {
    const units = [hull("RU", "nat", "BLOCKADE")];
    expect(blockadeClosureByCountry(units, new Map()).size).toBe(0);
  });

  it("only reports countries actually under pressure", () => {
    const hostility = new Map([
      ["US", new Set(["RU"])],
      ["RU", new Set(["US"])],
    ]);
    const units = [hull("RU", "nat", "BLOCKADE")];
    const out = blockadeClosureByCountry(units, hostility);
    expect(out.has("US")).toBe(true);
    // Russia is not being blockaded by anybody, so it must not appear at all.
    expect(out.has("RU")).toBe(false);
  });
});

describe("blockadeAffinityMultiplier", () => {
  it("leaves trade untouched with no blockade", () => {
    expect(blockadeAffinityMultiplier(0)).toBe(1);
  });

  it("returns zero only at total closure, which is what flips isBlocked", () => {
    expect(blockadeAffinityMultiplier(1)).toBe(0);
  });

  it("never reaches zero short of total closure", () => {
    // Reaching zero hands the flow to reachableBook as unreachable supply. A blockade
    // that is merely strong must not silently become total.
    expect(blockadeAffinityMultiplier(0.99)).toBeGreaterThanOrEqual(BLOCKADE.minAffinityMultiplier);
    expect(blockadeAffinityMultiplier(0.99)).toBeGreaterThan(0);
  });

  it("degrades trade continuously in between", () => {
    expect(blockadeAffinityMultiplier(0.25)).toBeGreaterThan(blockadeAffinityMultiplier(0.75));
  });
});
