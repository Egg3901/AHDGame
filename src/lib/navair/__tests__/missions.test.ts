import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  defaultNavalMission,
  defaultAirMission,
  defaultMissionFor,
  WITHDRAW_INTEGRITY,
  WITHDRAW_READINESS,
  type MissionContext,
} from "../missions";
import type { NavairUnit } from "../types";
import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";

function unit(over: Partial<NavairUnit> = {}): NavairUnit {
  return {
    _id: new ObjectId(),
    countryId: "US" as CountryId,
    branchId: "navy",
    domain: "naval",
    name: "Formation",
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
    station: "nat",
    integrity: 100,
    supply: 100,
    ...over,
  } as NavairUnit;
}

function ctx(over: Partial<MissionContext> = {}): MissionContext {
  return {
    enemies: new Set<string>(),
    frontRegions: new Set<RegionCode>(),
    contestedHere: false,
    airContestedHere: false,
    ...over,
  };
}

const atWar = { enemies: new Set(["RU"]) };

describe("defaultNavalMission", () => {
  it("sends a wrecked formation home before anything else", () => {
    // First check on purpose: a damaged fleet should withdraw rather than grind itself to
    // nothing in a fight it is already losing.
    const wreck = unit({ integrity: WITHDRAW_INTEGRITY - 1 });
    expect(defaultNavalMission(wreck, ctx({ ...atWar, contestedHere: true }))).toBe("PORT");
  });

  it("sends a worn-out formation home even at full integrity", () => {
    const worn = unit({ readiness: WITHDRAW_READINESS - 1 });
    expect(defaultNavalMission(worn, ctx({ ...atWar, contestedHere: true }))).toBe("PORT");
  });

  it("stays in port in peacetime", () => {
    expect(defaultNavalMission(unit(), ctx())).toBe("PORT");
  });

  it("fights when something hostile is in the same water", () => {
    expect(defaultNavalMission(unit(), ctx({ ...atWar, contestedHere: true }))).toBe("SEA_CONTROL");
  });

  it("keeps a submarine hidden rather than putting it in the line", () => {
    // Sea control would spend the one advantage a submarine has.
    const sub = unit({ type: "Attack Submarine" });
    expect(defaultNavalMission(sub, ctx(atWar))).toBe("SEA_DENIAL");
  });

  it("still fights a submarine that is already in contact", () => {
    const sub = unit({ type: "Attack Submarine" });
    expect(defaultNavalMission(sub, ctx({ ...atWar, contestedHere: true }))).toBe("SEA_CONTROL");
  });

  it("does not blockade in peacetime", () => {
    expect(defaultNavalMission(unit(), ctx())).not.toBe("BLOCKADE");
  });
});

describe("defaultAirMission", () => {
  it("stands down when damaged", () => {
    const hurt = unit({ domain: "air", type: "Fighter Wing", integrity: WITHDRAW_INTEGRITY - 1 });
    expect(defaultAirMission(hurt, ctx(atWar))).toBe("STANDDOWN");
  });

  it("stands down in peacetime", () => {
    const wing = unit({ domain: "air", type: "Fighter Wing" });
    expect(defaultAirMission(wing, ctx())).toBe("STANDDOWN");
  });

  it("puts an air defence wing on patrol, never on a ground mission", () => {
    // Using it for close air support would be using it as a worse fighter wing.
    const sam = unit({ domain: "air", type: "Air Defense Wing" });
    const withFront = ctx({ ...atWar, frontRegions: new Set(["nat" as RegionCode]) });
    expect(defaultAirMission(sam, withFront)).toBe("CAP");
  });

  it("wins the sky before supporting the ground", () => {
    // Close air support flown into an uncontested enemy fighter screen loses the air force
    // without moving the front.
    const wing = unit({ domain: "air", type: "Fighter Wing" });
    const contested = ctx({
      ...atWar,
      airContestedHere: true,
      frontRegions: new Set(["nat" as RegionCode]),
    });
    expect(defaultAirMission(wing, contested)).toBe("CAP");
  });

  it("supports the ground war when the sky is clear and a front is in reach", () => {
    const wing = unit({ domain: "air", type: "Fighter Wing", station: "nat" });
    const withFront = ctx({ ...atWar, frontRegions: new Set(["nat" as RegionCode]) });
    expect(defaultAirMission(wing, withFront)).toBe("CAS");
  });

  it("does not fly close air support at a front it cannot reach", () => {
    const wing = unit({ domain: "air", type: "Fighter Wing", station: "nat" });
    const farFront = ctx({ ...atWar, frontRegions: new Set(["spa" as RegionCode]) });
    expect(defaultAirMission(wing, farFront)).toBe("PATROL");
  });

  it("uses transports for supply, not for fighting", () => {
    const lift = unit({ domain: "air", type: "Airlift Wing", station: "nat" });
    const withFront = ctx({ ...atWar, frontRegions: new Set(["nat" as RegionCode]) });
    expect(defaultAirMission(lift, withFront)).toBe("AIRLIFT");
  });
});

describe("defaultMissionFor", () => {
  it("declines to command a domain this subsystem does not own", () => {
    const infantry = unit({ domain: "ground" });
    expect(defaultMissionFor(infantry, ctx(atWar))).toBeNull();
  });

  it("commands naval and air", () => {
    expect(defaultMissionFor(unit(), ctx(atWar))).not.toBeNull();
    expect(defaultMissionFor(unit({ domain: "air" }), ctx(atWar))).not.toBeNull();
  });
});
