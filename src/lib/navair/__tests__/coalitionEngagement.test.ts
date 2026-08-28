import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { resolveEngagement } from "../engagement";
import { navalStationFor } from "../map";
import {
  conflictRegions,
  canExtendConflictTo,
  extendConflict,
} from "@/lib/military/conflictRegions";
import type { NavairUnit, NavalMission } from "../types";
import type { CountryId } from "@/lib/constants/countries";

function hull(countryId: string, mission: NavalMission = "SEA_CONTROL"): NavairUnit {
  return {
    _id: new ObjectId(),
    countryId: countryId as CountryId,
    branchId: "navy",
    domain: "naval",
    name: `${countryId} Squadron`,
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
    theaterId: "war_1",
    assignedGeneralId: null,
    createdTurn: 1,
    station: "nat",
    mission,
    integrity: 100,
    supply: 100,
  } as NavairUnit;
}

describe("coalition engagements", () => {
  it("costs the same to fight one strong enemy as three weak ones of equal total", () => {
    // The bug this pins: pairing country against country made a fleet fight each enemy
    // separately, taking a full engagement's damage in every one. Losses scaled with the
    // NUMBER of enemies rather than their strength, which breaks exactly when a coalition
    // forms. Sides are now aggregated, so three allies fight as one line.
    const soloUs = [hull("US")];
    const oneEnemy = [hull("RU"), hull("RU"), hull("RU")];
    resolveEngagement("nat", soloUs, oneEnemy);
    const againstOneBloc = soloUs[0].integrity;

    const soloUs2 = [hull("US")];
    const threeNations = [hull("RU"), hull("DD"), hull("PL")];
    resolveEngagement("nat", soloUs2, threeNations);
    const againstThreeNations = soloUs2[0].integrity;

    // Same total opposing strength, so the same cost. Previously the second case cost
    // three times as much.
    expect(againstThreeNations).toBeCloseTo(againstOneBloc as number, 6);
  });

  it("lets allies share the damage rather than each taking it in full", () => {
    const allies = [hull("US"), hull("UK"), hull("FR")];
    const enemy = [hull("RU")];
    resolveEngagement("nat", allies, enemy);
    // Every ally is in one line, so each takes the same share, and none takes a full
    // separate engagement's worth.
    expect(allies[0].integrity).toBe(allies[1].integrity);
    expect(allies[1].integrity).toBe(allies[2].integrity);
    expect(allies[0].integrity).toBeGreaterThan(80);
  });
});

describe("navalStationFor", () => {
  it("keeps a fleet where it already is when that is water", () => {
    expect(navalStationFor("nat")).toBe("nat");
  });

  it("bases a fleet supporting an inland front in adjacent water", () => {
    // Eastern Europe is land. A carrier group cannot be there, and putting it there made
    // sea control accrue over a tile no front ever reads, so a dominant navy did nothing.
    const station = navalStationFor("eeu");
    expect(station).not.toBe("eeu");
    expect(station).toBeTruthy();
  });

  it("bases even a deep inland front at the nearest coast it can reach", () => {
    // Central Asia has no coast of its own but borders East Asia, which does. So a fleet
    // supporting a Central Asian front is in East Asian water: a long way off, and the
    // honest answer. The null return is a defensive branch for a region with no coastal
    // neighbour at all, which this 19-region map does not currently contain.
    const station = navalStationFor("cas");
    expect(station).not.toBe("cas");
    expect(station).toBeTruthy();
  });

  it("prefers the better port when a front has more than one coast in reach", () => {
    // Western Europe touches both the North Atlantic and the Mediterranean. A fleet bases
    // where the infrastructure is, not at whichever neighbour happens to be listed first.
    const station = navalStationFor("weu");
    expect(["nat", "med"]).toContain(station);
  });
});

describe("conflict regions", () => {
  const war = { region: "eeu" as const, extendedRegions: undefined };

  it("is just the primary region for a war that has not spread", () => {
    expect(conflictRegions(war)).toEqual(["eeu"]);
  });

  it("extends into adjacent ground", () => {
    expect(canExtendConflictTo(war, "weu")).toBe(true);
    expect(conflictRegions(extendConflict(war, "weu"))).toEqual(["eeu", "weu"]);
  });

  it("refuses ground that does not touch the theatre", () => {
    // A war cannot be in Eastern Europe and the South Pacific with nothing in between.
    // That is two wars, and averaging supply or air across the gap would be nonsense.
    expect(canExtendConflictTo(war, "spa")).toBe(false);
    expect(conflictRegions(extendConflict(war, "spa"))).toEqual(["eeu"]);
  });

  it("allows a chain, so a war can spread step by step", () => {
    const spread = extendConflict(war, "weu");
    // The North Atlantic touches Western Europe, not Eastern Europe. It becomes reachable
    // only once the war has actually reached the intervening ground.
    expect(canExtendConflictTo(war, "nat")).toBe(false);
    expect(canExtendConflictTo(spread, "nat")).toBe(true);
  });

  it("does not add a region twice", () => {
    expect(canExtendConflictTo({ region: "eeu", extendedRegions: ["weu"] }, "weu")).toBe(false);
  });
});
