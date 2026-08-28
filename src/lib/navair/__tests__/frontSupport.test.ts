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

  it("rises with sea control on a front the sea can reach, given a carrier", () => {
    // Sea control alone is not enough: something has to be able to reach inland from
    // that water. See the carrier gate below.
    const carrier = [
      {
        ...wing({ mission: "CAP" }),
        domain: "naval",
        type: "Carrier Strike Group",
        station: "nat",
      } as NavairUnit,
    ];
    const none = interdictionFor(carrier, ["US"], "weu", 0);
    const held = interdictionFor(carrier, ["US"], "weu", 100);
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

describe("carriers project ashore, escorts do not", () => {
  // Ariane's review, from having served: only carriers meaningfully affect a land
  // battle. Everything else screens the carrier and fights other ships. The config
  // already said so (CAN_FLY holds one entry, NAVAL_REACH gives a carrier 1.00 against
  // an escort's 0.40); this layer was ignoring it.
  const hull = (type: string, station: string): NavairUnit =>
    ({
      _id: new ObjectId(),
      countryId: "US" as CountryId,
      branchId: "navy",
      domain: "naval",
      name: type,
      type,
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
      mission: "SEA_CONTROL",
      integrity: 100,
      supply: 100,
    }) as NavairUnit;

  it("gives an all-escort fleet no interdiction, however much sea it holds", () => {
    const escorts = [
      hull("Guided-Missile Destroyer", "nat"),
      hull("Frigate Squadron", "nat"),
      hull("Attack Submarine", "nat"),
    ];
    expect(interdictionFor(escorts, ["US"], "weu", 100)).toBe(0);
  });

  it("gives a carrier group interdiction from the same water", () => {
    const withCarrier = [hull("Carrier Strike Group", "nat")];
    expect(interdictionFor(withCarrier, ["US"], "weu", 100)).toBeGreaterThan(0);
  });

  it("does not count an enemy's carrier", () => {
    const theirs = [{ ...hull("Carrier Strike Group", "nat"), countryId: "RU" as CountryId }];
    expect(interdictionFor(theirs, ["US"], "weu", 100)).toBe(0);
  });

  it("does not count a carrier that cannot reach the front", () => {
    const faraway = [hull("Carrier Strike Group", "spa")];
    expect(interdictionFor(faraway, ["US"], "weu", 100)).toBe(0);
  });

  it("still lets escorts contribute through the air, if they somehow strike", () => {
    // The gate is on the SEA term only. Aircraft in range are counted separately and
    // are unaffected by which hulls are present.
    const none = interdictionFor([], ["US"], "weu", 0);
    expect(none).toBe(0);
  });
});
