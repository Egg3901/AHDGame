import { describe, it, expect } from "vitest";
import {
  POSTURES,
  VETM,
  ARCHES,
  USTATS,
  eqAvg,
  techMult,
  computeCard,
  statObj,
  effPower,
  combatValue,
  effUpkeep,
  doctrineMult,
  terrainFactor,
  recommendRole,
  RESERVE_FRONT,
  terrainFamilyOf,
  type CombatUnit,
  type Front,
} from "../combat";
import { natMods } from "../doctrineTree";
import { STRATEGIC_REGIONS } from "../regions";
import { ObjectId } from "mongodb";

const IDENTITY_NAT = natMods({});
const IDENTITY_GEN = { cv: 1, cvTrait: {}, cas: 1, supply: 0, upkeep: 1, ready: 0, enemy: 1 };

function unit(over: Partial<CombatUnit> = {}): CombatUnit {
  return {
    _id: new ObjectId(),
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "1st Armored Division",
    type: "Armored Division",
    icon: "tank",
    basePower: 92,
    personnel: 15000,
    upkeepBase: 180,
    posture: "standard",
    techTier: 2,
    vet: 1,
    xp: 0,
    readiness: 70,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "reserve",
    assignedGeneralId: null,
    createdTurn: 1,
    ...over,
  };
}

describe("combat config", () => {
  it("defines postures, veterancy multipliers, and archetypes", () => {
    expect(POSTURES.find((p) => p.id === "standard")?.pw).toBe(1);
    expect(VETM).toEqual([0.9, 1.0, 1.08, 1.16, 1.25]);
    expect(ARCHES.ground.find((a) => a.type === "Armored Division")?.power).toBe(92);
    expect(USTATS["Armored Division"].traits).toContain("armored");
  });
});

describe("per-unit math", () => {
  it("techMult and eqAvg", () => {
    expect(techMult(2)).toBeCloseTo(0.96, 5);
    expect(eqAvg(unit().equipment)).toBeCloseTo(1, 5);
  });
  it("effPower composes base × posture × tech × vet × equipment", () => {
    // 92 × 1.0 × 0.96 × 1.0 × (1 + 1×0.03) = 90.9696 → 91
    expect(effPower(unit())).toBe(91);
  });
  it("combatValue applies readiness curve × doctrine multiplier (identity)", () => {
    // 91 × (0.55 + 0.45×0.70) × 1 = 91 × 0.865 = 78.7 → 79
    expect(combatValue(unit(), IDENTITY_NAT, IDENTITY_GEN)).toBe(79);
  });
  it("doctrineMult multiplies national cvAll × general cv", () => {
    const nm = { ...IDENTITY_NAT, cvAll: 1.1 };
    const gm = { ...IDENTITY_GEN, cv: 1.08 };
    // 1.1 × 1.08 (breakthrough) = 1.188
    expect(doctrineMult(unit(), nm, gm)).toBeCloseTo(1.1 * 1.08, 5);
  });
  it("effUpkeep scales by posture, country scale, doctrine, general", () => {
    // 180 × 1.0 (standard up) × 2.6 (scale) × 1 × 1 = 468
    expect(effUpkeep(unit(), IDENTITY_NAT, IDENTITY_GEN, 2.6)).toBe(468);
  });
});

describe("computeCard + statObj", () => {
  it("derives stats and trait keys", () => {
    const card = computeCard(unit({ vet: 3 }));
    expect(card.stats.length).toBe(8);
    // vet >= 3 adds the elite trait
    expect(card.traitKeys).toContain("elite");
    const st = statObj(unit());
    expect(typeof st.fp).toBe("number");
  });
});

describe("terrainFactor + recommendRole", () => {
  const at = (terrain: string): Front => ({ ...RESERVE_FRONT, id: "central-front", terrain });

  it("applies terrain domain/trait multipliers, clamped", () => {
    // Savanna rewards armor (trait armored 1.08).
    const m = terrainFactor(at("Savanna"), "ground", ["armored"]);
    expect(m).toBeGreaterThan(1);
    expect(m).toBeLessThanOrEqual(1.4);
  });

  it("is neutral in the rear area and for an unrecognised terrain", () => {
    expect(terrainFactor(RESERVE_FRONT, "ground", ["armored"])).toBe(1);
    expect(terrainFactor(at("Lunar regolith"), "ground", ["armored"])).toBe(1);
  });

  // Regression: TERRAIN was keyed by the ids of the four RETIRED static theaters
  // (afghan/nicaragua/angola/ogaden). Every live conflict has a dynamic id, so the
  // lookup always missed and every per-domain and per-trait terrain modifier was dead
  // on every real front — including the naval ones a player asked about.
  it("resolves terrain for a dynamic conflict, not just the retired theater ids", () => {
    expect(terrainFactor(at("Arid / mountainous"), "naval", [])).toBeLessThan(1);
    expect(terrainFactor(at("Littoral rainforest"), "marine", [])).toBeGreaterThan(1);
    expect(terrainFactor(at("Open ocean"), "naval", [])).toBeGreaterThan(1);
  });

  it("matches the terrain family however the phrase is written", () => {
    const a = terrainFactor(at("Arid / mountainous"), "naval", []);
    expect(terrainFactor(at("MOUNTAIN passes"), "naval", [])).toBe(a);
    expect(terrainFactor(at("tundra and ice"), "naval", [])).toBe(a);
  });

  it("still clamps a stacked bonus to the 0.6..1.4 band", () => {
    const m = terrainFactor(at("Littoral rainforest"), "marine", [
      "amphibious",
      "stealth",
      "recon",
    ]);
    expect(m).toBeLessThanOrEqual(1.4);
    expect(m).toBeGreaterThanOrEqual(0.6);
  });

  // Coverage guard: a conflict is born with its host region's terrain, so a region
  // whose phrase matches no family would silently get no terrain effects — the same
  // failure as the retired theater-id keying, just narrower. Caught two ("Subcontinent",
  // "Scattered islands") when the family table was first written.
  it("classifies the terrain of every strategic region", () => {
    const unmatched = STRATEGIC_REGIONS.filter((r) => terrainFamilyOf(r.terrain) === null).map(
      (r) => `${r.id}: "${r.terrain}"`
    );
    expect(unmatched).toEqual([]);
  });
  it("recommends a battle role from unit profile", () => {
    expect(recommendRole(unit({ type: "Ballistic Missile Brigade", domain: "rocket" }))).toBe(
      "deepstrike"
    );
    expect(["frontline", "reserve", "flank", "support"]).toContain(recommendRole(unit()));
  });
});
