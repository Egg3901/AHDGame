import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  applyTensionEvent,
  clampTension,
  isNuclearWar,
  nuclearArmedCountryIds,
  runTensionTurn,
  stepTension,
  tensionBand,
  tensionFloor,
  tensionPressureBreakdown,
  warAcclimationMultiplier,
  warDeclarationTensionDelta,
  warPressures,
  TENSION_BASELINE,
} from "./tension";

const NO_WARS = { nuclearWarIntensity: 0, nuclearWarCount: 0, otherWarIntensity: 0 };

describe("tensionBand", () => {
  it("maps the full range to the five bands", () => {
    expect(tensionBand(5)).toBe("DETENTE");
    expect(tensionBand(20)).toBe("CALM");
    expect(tensionBand(50)).toBe("ELEVATED");
    expect(tensionBand(70)).toBe("CRISIS");
    expect(tensionBand(90)).toBe("BRINK");
  });
});

describe("tensionFloor", () => {
  it("is the baseline in a quiet, disarmed world", () => {
    expect(
      tensionFloor({ escalationLevel: 0, activeCrises: 0, totalWarheads: 0, ...NO_WARS })
    ).toBe(TENSION_BASELINE);
  });

  it("explains every contribution to the same floor players see", () => {
    const breakdown = tensionPressureBreakdown({
      escalationLevel: 2,
      activeCrises: 3,
      totalWarheads: 100,
      ...NO_WARS,
    });
    expect(breakdown).toEqual({
      baseline: 12,
      escalation: 8,
      activeCrises: 9,
      arsenal: 12,
      wars: 0,
      floor: 41,
    });
    expect(
      tensionFloor({ escalationLevel: 2, activeCrises: 3, totalWarheads: 100, ...NO_WARS })
    ).toBe(breakdown.floor);
  });

  it("rises with escalation, crises, arsenals and wars, each capped", () => {
    const hot = tensionFloor({
      escalationLevel: 99,
      activeCrises: 99,
      totalWarheads: 1e6,
      nuclearWarIntensity: 999,
      nuclearWarCount: 1,
      otherWarIntensity: 999,
    });
    // 12 + 30 + 12 + 18 + 48 = 120, clamped to the scale's ceiling.
    expect(hot).toBe(100);
  });

  it("a nuclear shooting war alone parks the floor in CRISIS", () => {
    const floor = tensionFloor({
      escalationLevel: 0,
      activeCrises: 0,
      totalWarheads: 400,
      nuclearWarIntensity: 70,
      nuclearWarCount: 1,
      otherWarIntensity: 0,
    });
    // Nuclear opposition guarantees a crisis-grade floor.
    expect(floor).toBeGreaterThanOrEqual(60);
    expect(["CRISIS", "BRINK"]).toContain(tensionBand(floor));
  });

  it("weighs a proxy war far lighter than a nuclear war of equal intensity", () => {
    const base = { escalationLevel: 0, activeCrises: 0, totalWarheads: 0 };
    const clash = tensionPressureBreakdown({
      ...base,
      nuclearWarIntensity: 70,
      nuclearWarCount: 1,
      otherWarIntensity: 0,
    }).wars;
    const proxy = tensionPressureBreakdown({
      ...base,
      nuclearWarIntensity: 0,
      nuclearWarCount: 0,
      otherWarIntensity: 70,
    }).wars;
    expect(clash).toBeGreaterThan(proxy * 3);
  });

  it("keeps even a low-intensity war between small nuclear powers in CRISIS", () => {
    const floor = tensionFloor({
      escalationLevel: 0,
      activeCrises: 0,
      totalWarheads: 2,
      nuclearWarIntensity: 1,
      nuclearWarCount: 1,
      otherWarIntensity: 0,
    });
    expect(floor).toBeGreaterThanOrEqual(60);
    expect(tensionBand(floor)).toBe("CRISIS");
  });

  it("keeps every war intensity additive above the nuclear-war minimum", () => {
    const base = {
      escalationLevel: 0,
      activeCrises: 0,
      totalWarheads: 0,
      nuclearWarCount: 1,
    };
    const low = tensionPressureBreakdown({
      ...base,
      nuclearWarIntensity: 1,
      otherWarIntensity: 0,
    }).wars;
    const hotter = tensionPressureBreakdown({
      ...base,
      nuclearWarIntensity: 70,
      otherWarIntensity: 0,
    }).wars;
    const withAnotherWar = tensionPressureBreakdown({
      ...base,
      nuclearWarIntensity: 70,
      otherWarIntensity: 40,
    }).wars;
    expect(hotter).toBeGreaterThan(low);
    expect(withAnotherWar).toBeGreaterThan(hotter);
  });
});

describe("warPressures", () => {
  const nuclearCountries = new Set<CountryId>(["US", "RU", "UK"]);

  it("splits wars with nuclear belligerents on opposing sides from every other war", () => {
    const result = warPressures(
      [
        { sideACountries: ["US"], sideBCountries: ["DD", "RU"], intensity: 70 },
        { sideACountries: ["UK"], sideBCountries: ["DE"], intensity: 40 },
      ],
      nuclearCountries
    );
    expect(result).toEqual({
      nuclearWarIntensity: 70,
      otherWarIntensity: 40,
      activeWarCount: 2,
      nuclearWarCount: 1,
      nuclearWarMinimumPressure: 48,
    });
  });

  it("detects any opposing nuclear powers, not only the US and Russia", () => {
    expect(isNuclearWar({ sideACountries: ["RU"], sideBCountries: ["US"] }, nuclearCountries)).toBe(
      true
    );
    expect(isNuclearWar({ sideACountries: ["US"], sideBCountries: ["UK"] }, nuclearCountries)).toBe(
      true
    );
  });

  it("does not classify a war as nuclear when the nuclear powers share a side", () => {
    expect(
      isNuclearWar({ sideACountries: ["US", "RU"], sideBCountries: ["DE"] }, nuclearCountries)
    ).toBe(false);
  });

  it("uses the live stockpile instead of assuming a named country is nuclear armed", () => {
    const armed = nuclearArmedCountryIds([
      { _id: "US", warheads: 522 },
      { _id: "RU", warheads: 0 },
      { _id: "UK", warheads: 12 },
    ]);
    expect(isNuclearWar({ sideACountries: ["US"], sideBCountries: ["RU"] }, armed)).toBe(false);
    expect(isNuclearWar({ sideACountries: ["US"], sideBCountries: ["UK"] }, armed)).toBe(true);
  });

  it("clamps intensity into [0, 100] per war", () => {
    const result = warPressures(
      [
        { sideACountries: ["US"], sideBCountries: ["RU"], intensity: 250 },
        { sideACountries: ["UK"], sideBCountries: ["DE"], intensity: -10 },
      ],
      nuclearCountries
    );
    expect(result).toEqual({
      nuclearWarIntensity: 100,
      otherWarIntensity: 0,
      activeWarCount: 2,
      nuclearWarCount: 1,
      nuclearWarMinimumPressure: 48,
    });
  });

  it("gives a nuclear war the largest declaration spike", () => {
    expect(
      warDeclarationTensionDelta(
        { type: "interstate", sideACountries: ["US"], sideBCountries: ["DD", "RU"] },
        nuclearCountries
      )
    ).toBe(20);
    expect(
      warDeclarationTensionDelta(
        { type: "interstate", sideACountries: ["US"], sideBCountries: ["DD"] },
        nuclearCountries
      )
    ).toBe(10);
  });

  it("slowly acclimates to a long limited war after the grace period", () => {
    const war = {
      sideACountries: ["US" as CountryId],
      sideBCountries: ["RU" as CountryId],
      intensity: 70,
      startTurn: 100,
    };
    expect(warAcclimationMultiplier(war, 112)).toBe(1);
    expect(warAcclimationMultiplier(war, 132)).toBe(0.8);
    expect(warAcclimationMultiplier(war, 152)).toBe(0.6);

    const fresh = warPressures([war], nuclearCountries, 112);
    const old = warPressures([war], nuclearCountries, 152);
    expect(old.nuclearWarIntensity).toBeLessThan(fresh.nuclearWarIntensity);
    expect(old.nuclearWarMinimumPressure).toBeLessThan(fresh.nuclearWarMinimumPressure);
    expect(old.nuclearWarMinimumPressure).toBeGreaterThanOrEqual(30);
  });

  it("restores full pressure when a prolonged war becomes hot", () => {
    expect(warAcclimationMultiplier({ intensity: 85, startTurn: 1 }, 200)).toBe(1);
    expect(warAcclimationMultiplier({ intensity: 100, startTurn: 1 }, 200)).toBe(1);
  });
});

describe("stepTension", () => {
  const quiet = { escalationLevel: 0, activeCrises: 0, totalWarheads: 0, ...NO_WARS };

  it("decays a spike toward the floor without overshooting", () => {
    const next = stepTension(80, quiet);
    expect(next).toBeLessThan(80);
    expect(next).toBeGreaterThan(TENSION_BASELINE);
  });

  it("enforces a newly higher standing-pressure floor immediately", () => {
    const hot = { escalationLevel: 5, activeCrises: 2, totalWarheads: 100, ...NO_WARS };
    const next = stepTension(TENSION_BASELINE, hot);
    expect(next).toBe(tensionFloor(hot));
  });

  it("is a fixed point exactly at the floor", () => {
    expect(stepTension(TENSION_BASELINE, quiet)).toBe(TENSION_BASELINE);
  });
});

describe("stored pressure floor", () => {
  it("uses a freshly supplied floor when cached pressure predates the war", async () => {
    const db = createMockDb();
    db.collection("coldWarTension");
    db.collectionMocks.coldWarTension!.findOne.mockResolvedValue({
      _id: "current",
      value: 72,
      pressureFloor: 12,
      updatedTurn: 435,
      events: [],
      updatedAt: new Date(),
    });

    const next = await applyTensionEvent(
      db as unknown as Db,
      435,
      "detente",
      "Negotiated settlement",
      -8,
      { minimumValue: 68.5 }
    );

    expect(next.value).toBe(68.5);
    expect(next.pressureFloor).toBe(68.5);
    expect(next.events[0]?.delta).toBe(-3.5);
  });

  it("stores the current floor and lifts legacy low tension to it in one turn", async () => {
    const db = createMockDb();
    db.collection("coldWarTension");
    db.collectionMocks.coldWarTension!.findOne.mockResolvedValue({
      _id: "current",
      value: 20.5,
      updatedTurn: 435,
      events: [],
      updatedAt: new Date(),
    });
    const pressures = {
      escalationLevel: 1,
      activeCrises: 1,
      totalWarheads: 1214,
      nuclearWarIntensity: 70,
      nuclearWarCount: 1,
      otherWarIntensity: 0,
    };

    const next = await runTensionTurn(db as unknown as Db, 436, pressures);

    expect(next.pressureFloor).toBe(tensionFloor(pressures));
    expect(next.value).toBe(next.pressureFloor);
  });
});

describe("clampTension", () => {
  it("clamps to [0, 100]", () => {
    expect(clampTension(-5)).toBe(0);
    expect(clampTension(120)).toBe(100);
    expect(clampTension(33.33)).toBe(33.3);
  });
});
