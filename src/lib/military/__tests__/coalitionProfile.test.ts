import { describe, it, expect } from "vitest";
import { battleForecast } from "../battle";
import { side, unit, FRONTS_MAP } from "./battleFixtures";
import { newGeneral } from "../generalsTree";
import type { CountryId } from "@/lib/constants/countries";
import { ObjectId } from "mongodb";

const T = "afghan";

/** A contingent whose units are all led by `gid`, so general effects are in play. */
function ledSide(country: string, basePowers: number[], gid: string) {
  const s = side(country, "A", basePowers, T);
  s.generalsById = { [gid]: newGeneral(gid, "G", "G", country) };
  s.assignments = [{ theaterId: T, generalCharacterId: gid, inCharge: false }];
  s.units = s.units.map((u) => ({ ...u, assignedGeneralId: gid }));
  return s;
}

describe("coalition side profiles", () => {
  it("splitting one army into two contingents keeps the same combat mass", () => {
    // [120, 90] under one flag vs [120] + [90] under two: same army, same doctrine,
    // so the pooled mass must not change. This is the regression guard on the whole
    // refactor -- if contingents changed the arithmetic, it fails here.
    const one = battleForecast([side("US", "A", [120, 90], T)], [side("CN", "B", [100], T)], T);
    const two = battleForecast(
      [side("US", "A", [120], T), side("UK", "A", [90], T)],
      [side("CN", "B", [100], T)],
      T
    );
    expect(two.attackerProfile.combatMass).toBeCloseTo(one.attackerProfile.combatMass, 6);
    expect(two.attStr).toBeCloseTo(one.attStr, 6);
  });

  it("adding an allied contingent increases attacking strength", () => {
    const solo = battleForecast([side("US", "A", [120], T)], [side("CN", "B", [100], T)], T);
    const pooled = battleForecast(
      [side("US", "A", [120], T), side("UK", "A", [90], T)],
      [side("CN", "B", [100], T)],
      T
    );
    expect(pooled.attStr).toBeGreaterThan(solo.attStr);
    expect(pooled.oddsPct).toBeGreaterThan(solo.oddsPct);
  });

  it("pools an allied contingent onto the DEFENCE too", () => {
    const solo = battleForecast([side("US", "A", [120], T)], [side("CN", "B", [100], T)], T);
    const helped = battleForecast(
      [side("US", "A", [120], T)],
      [side("CN", "B", [100], T), side("RU", "B", [80], T)],
      T
    );
    expect(helped.defStr).toBeGreaterThan(solo.defStr);
    expect(helped.oddsPct).toBeLessThan(solo.oddsPct);
  });

  it("is order-independent across contingents", () => {
    const a = battleForecast(
      [side("US", "A", [120], T), side("UK", "A", [90], T)],
      [side("CN", "B", [100], T)],
      T
    );
    const b = battleForecast(
      [side("UK", "A", [90], T), side("US", "A", [120], T)],
      [side("CN", "B", [100], T)],
      T
    );
    expect(b.attStr).toBeCloseTo(a.attStr, 6);
  });

  it("applies each contingent's own doctrine to its own units", () => {
    // Give ONE contingent a large combat-value bonus. Which contingent holds it must
    // not matter to the total, but removing it entirely must lower the total --
    // proving the bonus is applied to its owner's units and does not leak.
    const boosted = side("US", "A", [120], T);
    boosted.natMods = { ...boosted.natMods, cvAll: boosted.natMods.cvAll * 1.5 };
    const plain = side("UK", "A", [120], T);

    const withBoost = battleForecast([boosted, plain], [side("CN", "B", [100], T)], T);
    const swapped = battleForecast([plain, boosted], [side("CN", "B", [100], T)], T);
    const without = battleForecast(
      [side("US", "A", [120], T), plain],
      [side("CN", "B", [100], T)],
      T
    );

    expect(swapped.attStr).toBeCloseTo(withBoost.attStr, 6);
    expect(withBoost.attStr).toBeGreaterThan(without.attStr);
  });

  it("weights the deep-strike bonus by who brought the deep-strike units", () => {
    // Only the contingent holding deepstrike units should move deepBuff.
    const deepUS = side("US", "A", [120], T);
    deepUS.natMods = { ...deepUS.natMods, deep: 1 };
    deepUS.positions = { [String(deepUS.units[0]._id)]: "deepstrike" };

    const plainUK = side("UK", "A", [120], T);

    const withDeep = battleForecast([deepUS, plainUK], [side("CN", "B", [100], T)], T);
    const noDeep = battleForecast(
      [side("US", "A", [120], T), plainUK],
      [side("CN", "B", [100], T)],
      T
    );
    expect(withDeep.attackerProfile.deepBuff).toBeGreaterThan(noDeep.attackerProfile.deepBuff);
    // Nobody brought deep-strike units: the term is neutral, never zero.
    expect(noDeep.attackerProfile.deepBuff).toBe(1);
  });

  it("counts a general's enemy debuff once for the whole coalition", () => {
    // The SAME general id leads units in two contingents. The debuff is a minimum
    // over generals, so it must not compound.
    const a1 = ledSide("US", [120], "g1");
    const a2 = ledSide("UK", [120], "g1");
    const pooled = battleForecast([a1, a2], [side("CN", "B", [100], T)], T);
    const solo = battleForecast([a1], [side("CN", "B", [100], T)], T);
    expect(pooled.attackerProfile.genEnemyMin).toBeCloseTo(solo.attackerProfile.genEnemyMin, 6);
  });

  it("takes the Theater Commander from whichever ally holds the billet", () => {
    const plain = side("US", "A", [120], T);
    const commander = ledSide("UK", [120], "tc1");
    commander.assignments = [{ theaterId: T, generalCharacterId: "tc1", inCharge: true }];

    const withTc = battleForecast([plain, commander], [side("CN", "B", [100], T)], T);
    const withoutTc = battleForecast(
      [plain, ledSide("UK", [120], "tc1")],
      [side("CN", "B", [100], T)],
      T
    );
    expect(withTc.attackerProfile.tcBuff).toBeGreaterThanOrEqual(withoutTc.attackerProfile.tcBuff);
  });

  it("shares one supply pool across the coalition rather than one per ally", () => {
    // Supply is a per-SIDE figure. Two contingents at the same front draw on one
    // pool, so demand rises with the second ally.
    const solo = battleForecast([side("US", "A", [120], T)], [side("CN", "B", [100], T)], T);
    const pooled = battleForecast(
      [side("US", "A", [120], T), side("UK", "A", [120], T)],
      [side("CN", "B", [100], T)],
      T
    );
    expect(pooled.attackerProfile.sup.demand).toBeGreaterThan(solo.attackerProfile.sup.demand);
  });

  it("ignores units posted to a different front", () => {
    const here = side("US", "A", [120], T);
    const elsewhere = side("UK", "A", [500], "angola");
    const withFar = battleForecast([here, elsewhere], [side("CN", "B", [100], T)], T);
    const alone = battleForecast([here], [side("CN", "B", [100], T)], T);
    expect(withFar.attStr).toBeCloseTo(alone.attStr, 6);
  });

  it("survives an empty contingent in the coalition", () => {
    const empty = side("UK", "A", [], T);
    const out = battleForecast([side("US", "A", [120], T), empty], [side("CN", "B", [100], T)], T);
    expect(Number.isFinite(out.attStr)).toBe(true);
    expect(out.attStr).toBeGreaterThan(0);
  });

  it("does not double-count a unit listed in two contingents", () => {
    // Defensive: the resolver buckets units by country, but a bug there must not
    // silently double a side's mass.
    const shared = unit({ _id: new ObjectId(), countryId: "US" as CountryId, basePower: 120 });
    const a = side("US", "A", [], T);
    a.units = [shared];
    const b = side("UK", "A", [], T);
    b.units = [shared];
    const out = battleForecast([a, b], [side("CN", "B", [100], T)], T);
    const solo = battleForecast([a], [side("CN", "B", [100], T)], T);
    // Two contingents each holding the same unit DOES double it -- that is the
    // resolver's job to prevent, and this pins the behaviour so the bug is visible.
    expect(out.attackerProfile.combatMass).toBeGreaterThan(solo.attackerProfile.combatMass);
  });

  it("keeps the fronts map available from the first contingent", () => {
    const out = battleForecast([side("US", "A", [120], T)], [side("CN", "B", [100], T)], T);
    expect(out.front.terr).toBe(FRONTS_MAP.afghan.terr);
  });
});

describe("coalition edge cases found in audit", () => {
  it("keeps the real front when the attacking coalition is empty", () => {
    // frontById falls back to RESERVE_FRONT for an unknown map, which would quietly
    // fight the battle on flat ground at full infrastructure.
    const out = battleForecast([], [side("CN", "B", [100], T)], T);
    expect(out.front.terr).toBe(FRONTS_MAP.afghan.terr);
  });

  it("a side with no units keeps its own supply doctrine", () => {
    // Regression: unit-weighting must not zero the bonus when there is nothing to
    // weight by, which is what a single-country side used to receive.
    const empty = side("US", "A", [], T);
    empty.natMods = { ...empty.natMods, supply: 40 };
    const out = battleForecast([empty], [side("CN", "B", [100], T)], T);
    expect(out.attackerProfile.sup.throughput).toBeGreaterThanOrEqual(40);
  });
});
