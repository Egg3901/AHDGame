import { describe, it, expect } from "vitest";
import {
  resolveConscriptionStance,
  reinforceUnit,
  CONSCRIPTION_STANCES,
  RESERVE_LAW_BY_COUNTRY,
  stanceForReserveLevel,
  reserveManpowerLabel,
} from "./manpower";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";

const unit = (over: Partial<MilitaryUnit> = {}) =>
  ({
    domain: "ground",
    type: "Infantry Division", // establishment 12000
    personnel: 6000,
    vet: 2,
    xp: 50,
    ...over,
  }) as MilitaryUnit;

describe("resolveConscriptionStance", () => {
  it("gives the eastern bloc universal service and the US selective", () => {
    expect(resolveConscriptionStance("RU").conscriptAllowed).toBe(true);
    expect(resolveConscriptionStance("DD").conscriptAllowed).toBe(true);
    expect(resolveConscriptionStance("US").conscriptAllowed).toBe(true);
  });

  it("falls back to a defined stance for an unknown country", () => {
    expect(CONSCRIPTION_STANCES[resolveConscriptionStance("ZZ").id]).toBeTruthy();
  });

  it("a fallback nation may not conscript", () => {
    expect(resolveConscriptionStance("ZZ").conscriptAllowed).toBe(false);
  });
});

describe("reinforceUnit", () => {
  it("fills toward establishment, capped by the mode's rate", () => {
    const r = reinforceUnit(unit(), "conscript", 999999);
    // 25% of 12000 = 3000 drawn; 6000 → 9000
    expect(r.drawn).toBe(3000);
    expect(r.personnel).toBe(9000);
  });

  it("never draws more than the pool holds", () => {
    const r = reinforceUnit(unit(), "conscript", 500);
    expect(r.drawn).toBe(500);
    expect(r.personnel).toBe(6500);
  });

  it("never overfills past establishment", () => {
    const r = reinforceUnit(unit({ personnel: 11900 }), "conscript", 999999);
    expect(r.personnel).toBe(12000);
    expect(r.drawn).toBe(100);
  });

  it("conscripts dilute veterancy down a level", () => {
    // 6000 men at score 250 (vet2,xp50) + 3000 conscripts at 0
    //   → (6000*250 + 3000*0) / 9000 = 166.67 → vet 1, xp round(66.67) = 67
    const r = reinforceUnit(unit(), "conscript", 999999);
    expect(r.vet).toBe(1);
    expect(r.xp).toBe(67);
  });

  it("trained replacements dilute less than conscripts", () => {
    const c = reinforceUnit(unit(), "conscript", 999999);
    const t = reinforceUnit(unit(), "trained", 999999);
    const score = (x: { vet: number; xp: number }) => x.vet * 100 + x.xp;
    expect(score(t)).toBeGreaterThan(score(c));
  });

  it("a full-strength unit draws nothing and is unchanged", () => {
    const r = reinforceUnit(unit({ personnel: 12000 }), "trained", 999999);
    expect(r.drawn).toBe(0);
    expect(r.vet).toBe(2);
    expect(r.xp).toBe(50);
  });

  it("an unknown archetype is left alone rather than guessed at", () => {
    const r = reinforceUnit(unit({ type: "Not A Real Unit" }), "conscript", 999999);
    expect(r.drawn).toBe(0);
    expect(r.personnel).toBe(6000);
  });
});

describe("stanceForReserveLevel", () => {
  it("maps the reserve ladder onto conscription stances", () => {
    expect(stanceForReserveLevel(0).id).toBe("volunteer");
    expect(stanceForReserveLevel(1).id).toBe("limited");
    expect(stanceForReserveLevel(2).id).toBe("selective");
    expect(stanceForReserveLevel(3).id).toBe("national");
    expect(stanceForReserveLevel(4).id).toBe("universal");
  });

  it("only permits conscripts from the ready-reserve rung upward", () => {
    expect(stanceForReserveLevel(0).conscriptAllowed).toBe(false);
    expect(stanceForReserveLevel(1).conscriptAllowed).toBe(false);
    expect(stanceForReserveLevel(2).conscriptAllowed).toBe(true);
    expect(stanceForReserveLevel(4).conscriptAllowed).toBe(true);
  });

  it("pool multiplier rises monotonically with the level", () => {
    const mults = [0, 1, 2, 3, 4].map((i) => stanceForReserveLevel(i).poolMult);
    for (let i = 1; i < mults.length; i++) expect(mults[i]).toBeGreaterThan(mults[i - 1]);
  });

  it("clamps an out-of-range level", () => {
    expect(stanceForReserveLevel(-3).id).toBe("volunteer");
    expect(stanceForReserveLevel(99).id).toBe("universal");
  });

  it("names the reserve law for every playable nation", () => {
    expect(RESERVE_LAW_BY_COUNTRY.US).toBe("us.sec.reserveForces");
    expect(RESERVE_LAW_BY_COUNTRY.UK).toBe("uk.sec.territorialReserves");
    expect(RESERVE_LAW_BY_COUNTRY.RU).toBe("ru.sec.reservesVoluntaryDefense");
    expect(RESERVE_LAW_BY_COUNTRY.DD).toBe("dd.sec.reservesVoluntaryDefense");
  });
});

describe("reserveManpowerLabel", () => {
  it("describes the pool effect for a country's own reserve law", () => {
    expect(reserveManpowerLabel("US", "us.sec.reserveForces", 4)).toBe(" · manpower ×2");
    expect(reserveManpowerLabel("US", "us.sec.reserveForces", 2)).toBe(" · manpower ×1");
  });

  it("warns when a level forbids conscription", () => {
    expect(reserveManpowerLabel("US", "us.sec.reserveForces", 0)).toContain("no conscription");
    expect(reserveManpowerLabel("US", "us.sec.reserveForces", 1)).toContain("no conscription");
    expect(reserveManpowerLabel("US", "us.sec.reserveForces", 3)).not.toContain("no conscription");
  });

  // Concatenated blindly into the option label, so a non-reserve law must contribute nothing.
  it("is empty for any other legislation", () => {
    expect(reserveManpowerLabel("US", "us.economy.fiscal.primary", 2)).toBe("");
  });

  // Guards against showing one nation's ladder on another's bill.
  it("is empty when the law belongs to a different country", () => {
    expect(reserveManpowerLabel("UK", "us.sec.reserveForces", 2)).toBe("");
  });
});
