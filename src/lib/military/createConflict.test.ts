import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  buildConflict,
  conflictToFront,
  deployOpeningForces,
  type BuildConflictInput,
} from "./createConflict";
import type { ConflictSide } from "@/lib/db/types/conflict";
import { OCCUPATION } from "./config";

const west: ConflictSide = {
  label: "United States",
  countries: ["US"],
  kind: "state",
  backer: "west",
};
const east: ConflictSide = {
  label: "Soviet Union",
  countries: ["RU"],
  kind: "state",
  backer: "east",
};
const gov: ConflictSide = { label: "Government", countries: ["RU"], kind: "state" };
const rebels: ConflictSide = { label: "Insurgents", countries: [], kind: "generated" };

const base = (over: Partial<BuildConflictInput> = {}): BuildConflictInput => ({
  id: "c1",
  conflictId: 1,
  hostCountry: "RU",
  type: "interstate",
  sideA: west,
  sideB: east,
  startTurn: 5,
  createdBy: "player",
  ...over,
});

describe("buildConflict", () => {
  it("derives region + terrain from the host and seeds live state", () => {
    const c = buildConflict(base());
    expect(c.region).toBeTruthy();
    expect(c.terrain).toBeTruthy();
    expect(c.terr).toBeGreaterThan(0);
    expect(c.infra).toBeGreaterThanOrEqual(0);
    expect(c.enemyMix.length).toBeGreaterThan(0);
    // Hosted in RU with RU on side B: the front opens at RU's own pole, not at a
    // 50/50 split — nobody stands on the defender's soil before the first battle.
    expect(c.control).toBe(100);
    expect(c.controlStart).toBe(c.control);
    expect(c.status).toBe("active");
  });

  it("marks west-vs-east as contested, and a backer-less internal war as internal", () => {
    expect(buildConflict(base()).bloc).toBe("contested");
    expect(buildConflict(base({ type: "civil_war", sideA: gov, sideB: rebels })).bloc).toBe(
      "internal"
    );
  });

  it("a generated side keeps countries empty", () => {
    const c = buildConflict(base({ type: "civil_war", sideA: gov, sideB: rebels }));
    expect(c.sideB.countries).toEqual([]);
    expect(c.sideB.kind).toBe("generated");
  });

  it("defaults the name from the side labels", () => {
    expect(buildConflict(base()).name).toBe("United States vs Soviet Union");
    expect(buildConflict(base({ name: "The Big One" })).name).toBe("The Big One");
  });
});

describe("conflictToFront", () => {
  it("maps a conflict onto a battle-sim Front", () => {
    const c = buildConflict(base());
    const f = conflictToFront(c);
    expect(f.id).toBe(c._id);
    expect(f.terr).toBe(c.terr);
    expect(f.infra).toBe(c.infra);
    expect(f.enemyBase).toBe(c.baseStrength);
    expect(f.contested).toBe(c.bloc === "contested");
    expect(f.enemyMix).toEqual(c.enemyMix);
  });
});

// The front's starting line is the host's own pole: a nation begins a war holding
// all of its own soil, and only a conflict fought on neutral ground starts split.
describe("buildConflict front seeding", () => {
  it("starts a defender on side A holding all of its own soil", () => {
    const c = buildConflict(base({ hostCountry: "US", sideA: west, sideB: east }));
    expect(c.control).toBe(0);
    expect(c.controlStart).toBe(0);
  });

  it("starts a defender on side B holding all of its own soil", () => {
    const c = buildConflict(base({ hostCountry: "RU", sideA: west, sideB: east }));
    expect(c.control).toBe(100);
    expect(c.controlStart).toBe(100);
  });

  it("starts split when the host belongs to neither side", () => {
    const c = buildConflict(
      base({ type: "intervention", hostCountry: "TR", sideA: west, sideB: east })
    );
    expect(c.control).toBe(50);
    expect(c.controlStart).toBe(50);
  });

  it("puts a civil war's host at its government's pole", () => {
    // gov holds RU, rebels are generated — the government starts holding the country.
    const c = buildConflict(
      base({ type: "civil_war", hostCountry: "RU", sideA: gov, sideB: rebels })
    );
    expect(c.control).toBe(0);
  });

  // sideA/sideB are list order under the dynamic model, not blocs — so a seeded
  // supply gap would hand a permanent combat advantage to whoever was listed first.
  it("opens both sides at the same neutral supply", () => {
    const c = buildConflict(base());
    expect(c.supplyA).toBe(c.supplyB);
    expect(c.supplyA).toBe(OCCUPATION.supplyNeutral);
  });
  it("records the seeded supplies as the baselines", () => {
    const c = buildConflict(base());
    expect(c.supplyBaseA).toBe(c.supplyA);
    expect(c.supplyBaseB).toBe(c.supplyB);
  });
});

describe("conflict numbering", () => {
  it("carries the supplied conflict number onto the document", () => {
    expect(buildConflict(base({ conflictId: 7 })).conflictId).toBe(7);
  });
});

describe("deployOpeningForces", () => {
  it("moves comparable reserve units to the new conflict", async () => {
    const us1 = new ObjectId();
    const us2 = new ObjectId();
    const us3 = new ObjectId();
    const dd1 = new ObjectId();
    const dd2 = new ObjectId();
    const dd3 = new ObjectId();
    const reserveUnits = [
      { _id: us1, countryId: "US", basePower: 60 },
      { _id: us2, countryId: "US", basePower: 120 },
      { _id: us3, countryId: "US", basePower: 200 },
      { _id: dd1, countryId: "DD", basePower: 70 },
      { _id: dd2, countryId: "DD", basePower: 110 },
      { _id: dd3, countryId: "DD", basePower: 300 },
    ];
    const find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(reserveUnits) }),
    });
    const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const db = {
      collection: vi.fn().mockReturnValue({ find, updateMany }),
    } as unknown as Db;
    const conflict = buildConflict(
      base({
        hostCountry: "DD",
        sideA: { ...west, countries: ["US"] },
        sideB: { ...east, countries: ["DD"] },
      })
    );

    await deployOpeningForces(db, conflict);

    expect(updateMany).toHaveBeenCalledWith(
      {
        _id: { $in: [us1, us2, dd1, dd2] },
        theaterId: "reserve",
        assignedGeneralId: null,
      },
      { $set: { theaterId: conflict._id, posture: "standard" } }
    );
  });
});

describe("buildConflict host-region guard", () => {
  it("throws for a cold_war host with no home region", () => {
    expect(() =>
      buildConflict(base({ type: "cold_war", hostCountry: "ZZZ", sideA: rebels, sideB: rebels }))
    ).toThrow(/ZZZ/);
  });

  it("still falls back for other conflict types", () => {
    // Only the proxy-war path is strict: every other type reaches here from a
    // declaration, whose target is already a validated CountryId.
    expect(buildConflict(base({ hostCountry: "ZZZ" })).region).toBe("noa");
  });
});

describe("cold_war conflicts", () => {
  const faction = (label: string, entity: string, backer: "west" | "east"): ConflictSide => ({
    label,
    countries: [],
    kind: "generated",
    backer,
    factionEntity: entity,
    tokenStrength: 40,
  });

  it("opens at a 50/50 split and carries its host roster", () => {
    const c = buildConflict(
      base({
        type: "cold_war",
        hostCountry: "SVN",
        hostEntities: ["NVN", "SVN"],
        sideA: faction("Republic of Vietnam", "SVN", "west"),
        sideB: faction("DRV", "NVN", "east"),
      })
    );
    // Neither faction entity is on a roster, so nobody holds the host's soil at birth.
    expect(c.control).toBe(50);
    expect(c.hostEntities).toEqual(["NVN", "SVN"]);
    expect(c.region).toBe("sea");
    expect(c.bloc).toBe("contested");
  });

  it("preserves each side's faction entity and token strength", () => {
    const c = buildConflict(
      base({
        type: "cold_war",
        hostCountry: "SVN",
        sideA: faction("Republic of Vietnam", "SVN", "west"),
        sideB: faction("DRV", "NVN", "east"),
      })
    );
    expect(c.sideA.factionEntity).toBe("SVN");
    expect(c.sideB.factionEntity).toBe("NVN");
    expect(c.sideB.tokenStrength).toBe(40);
  });
});
