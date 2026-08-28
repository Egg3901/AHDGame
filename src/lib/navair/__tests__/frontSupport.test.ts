import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  frontSupportFor,
  casWeightFor,
  interdictionFor,
  canLandMarines,
  NO_SUPPORT,
  MARINE_LANDING_THRESHOLD,
  INTERDICTION,
} from "../frontSupport";
import { channelKey, emptyChannels } from "../channels";
import { airSuperiorityBand } from "@/app/world/conflicts/[conflictId]/conflictRecordView";
import type { NavairUnit, RegionChannels, AirMission } from "../types";
import type { CountryId } from "@/lib/constants/countries";

function wing(over: Partial<NavairUnit> & { mission: AirMission }): NavairUnit {
  return {
    _id: new ObjectId(),
    countryId: "US" as CountryId,
    branchId: "af",
    domain: "air",
    name: "Wing",
    type: "Fighter Wing",
    icon: "jet",
    posture: "standard",
    techTier: 1,
    personnel: 1800,
    readiness: 100,
    basePower: 88,
    upkeepBase: 100,
    vet: 2,
    xp: 0,
    equipment: { firepower: 50, protection: 50, support: 50 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
    station: "weu",
    integrity: 100,
    supply: 100,
    ...over,
  } as NavairUnit;
}

describe("casWeightFor", () => {
  it("is nothing when nobody is flying close air support", () => {
    expect(casWeightFor([wing({ mission: "CAP" })], ["US"], "weu")).toBe(0);
  });

  it("counts a wing on the mission that can reach the front", () => {
    expect(casWeightFor([wing({ mission: "CAS" })], ["US"], "weu")).toBeGreaterThan(0);
  });

  it("ignores a wing that cannot physically reach the front", () => {
    // A fighter wing two oceans away is doing something useful, but it is not this.
    expect(casWeightFor([wing({ mission: "CAS", station: "spa" })], ["US"], "weu")).toBe(0);
  });

  it("ignores another side's aircraft", () => {
    expect(
      casWeightFor([wing({ mission: "CAS", countryId: "RU" as CountryId })], ["US"], "weu")
    ).toBe(0);
  });
});

describe("interdictionFor", () => {
  it("is nothing with no strike aircraft and no sea control", () => {
    expect(interdictionFor([], ["US"], "weu", 0)).toBe(0);
  });

  it("rises with sea control on a front the sea can reach", () => {
    const none = interdictionFor([], ["US"], "weu", 0);
    const held = interdictionFor([], ["US"], "weu", 100);
    expect(held).toBeGreaterThan(none);
  });

  it("is capped well short of severing a theatre", () => {
    // An army cut off entirely stops being a war and starts being a bookkeeping exercise,
    // and the land layer already models encirclement its own way.
    const many = Array.from({ length: 200 }, () => wing({ mission: "STRIKE_AIRBASE" }));
    expect(interdictionFor(many, ["US"], "weu", 100)).toBeLessThanOrEqual(INTERDICTION.cap);
  });
});

describe("frontSupportFor", () => {
  const channels = new Map<string, RegionChannels>([
    [channelKey("US", "weu"), { ...emptyChannels(1), airSuperiority: 70 }],
    [channelKey("US", "nat"), { ...emptyChannels(1), seaControl: 80 }],
  ]);

  it("reads air superiority for the front's own region", () => {
    expect(frontSupportFor([], channels, ["US"], "weu").airSuperiority).toBe(70);
  });

  it("takes sea control from adjacent water, not the land tile", () => {
    // A land front has no sea control of its own; what matters is the water beside it.
    expect(frontSupportFor([], channels, ["US"], "weu").seaControl).toBeGreaterThan(0);
  });

  it("returns nothing meaningful for a side with no presence anywhere", () => {
    const empty = frontSupportFor([], new Map(), ["RU"], "weu");
    expect(empty).toEqual(NO_SUPPORT);
  });
});

describe("canLandMarines", () => {
  it("refuses an opposed landing into contested water", () => {
    // Allowing this at parity would make amphibious assault the default answer to any
    // coastal front.
    expect(canLandMarines(50)).toBe(false);
    expect(canLandMarines(MARINE_LANDING_THRESHOLD - 1)).toBe(false);
  });

  it("allows it once the water is genuinely held", () => {
    expect(canLandMarines(MARINE_LANDING_THRESHOLD)).toBe(true);
  });
});

describe("airSuperiorityBand", () => {
  it("never reports a number, only a posture a player can act on", () => {
    expect(airSuperiorityBand(90, 10)).toBe("You hold the air");
    expect(airSuperiorityBand(10, 90)).toBe("Enemy holds the air");
    expect(airSuperiorityBand(50, 50)).toBe("Air contested");
  });

  it("says the sky is uncontested when neither side is up", () => {
    expect(airSuperiorityBand(0, 0)).toBe("Air uncontested");
  });

  it("is symmetric about the middle", () => {
    expect(airSuperiorityBand(60, 40)).toBe("Air advantage");
    expect(airSuperiorityBand(40, 60)).toBe("Enemy air advantage");
  });
});
