/** Deterministic fixed-output P&L replay of the accelerated stock-market ramps. */
import assert from "node:assert/strict";
import { assemblePhysicalPnl } from "../../src/lib/corporations/physicalPnl";
import {
  bankNpvBoostMultiplier,
  rampMultiplier,
  sectorNpvBoostMultiplier,
  sectorRevenueBoostMultiplier,
  sectorRiskPremiumAtTurn,
} from "../../src/lib/corporations/rules/marketBoost";

// Fixed production and prices isolate the tuning change from market feedback.
// Physical bills are unchanged; revenue-linked credits and growth charges move
// with the boosted revenue as they do in the sector turn.
const fixtures = [
  { name: "profitable", inputs: 40_000, labor: 20_000, other: 20_000, policyPp: 5 },
  { name: "loss-making", inputs: 70_000, labor: 25_000, other: 15_000, policyPp: 0 },
  { name: "policy-drag", inputs: 50_000, labor: 20_000, other: 10_000, policyPp: -10 },
];
const checkpoints = new Set([1212, 1213, 1253, 1309, 1349, 1405, 1446, 1501]);
const rows = [];
for (const sectorType of ["manufacturing", "financial"]) {
  let previousMultiplier = 1;
  for (let turn = 1212; turn <= 1638; turn++) {
    const controlMultiplier =
      rampMultiplier(turn, 1350, 192, 1.15) *
      (sectorType === "financial" ? rampMultiplier(turn, 1350, 192, 1.1) : 1);
    const treatmentMultiplier = sectorRevenueBoostMultiplier(turn, sectorType);
    assert.ok(treatmentMultiplier >= previousMultiplier);
    assert.ok(treatmentMultiplier >= controlMultiplier);
    previousMultiplier = treatmentMultiplier;
    for (const fixture of fixtures) {
      const pnl = (multiplier: number) => {
        const hourlyRevenue = 100_000 * multiplier;
        return assemblePhysicalPnl({
          hourlyRevenue,
          inputsCost: fixture.inputs,
          laborCost: fixture.labor,
          otherOpex: fixture.other,
          upkeep: 2_000,
          complianceCost: 0,
          financialLegs: 0,
          growthCost: hourlyRevenue * 0.05,
          policyCredit: hourlyRevenue * (fixture.policyPp / 100),
        });
      };
      const control = pnl(controlMultiplier);
      const treatment = pnl(treatmentMultiplier);
      assert.ok(treatment.profit >= control.profit);
      assert.equal(treatment.inputsCost, control.inputsCost);
      assert.equal(treatment.laborCost, control.laborCost);
      assert.equal(treatment.otherOpex, control.otherOpex);
      if (checkpoints.has(turn)) {
        rows.push({
          turn,
          sectorType,
          fixture: fixture.name,
          controlProfit: control.profit,
          treatmentProfit: treatment.profit,
          treatmentMultiplier,
          sectorNpvMultiplier: sectorNpvBoostMultiplier(turn),
          bankNpvMultiplier: bankNpvBoostMultiplier(turn),
          financialRiskPremium: sectorRiskPremiumAtTurn("financial", turn),
        });
      }
    }
  }
}
assert.equal(sectorRevenueBoostMultiplier(1212, "manufacturing"), 1);
assert.ok(
  Math.abs(sectorRevenueBoostMultiplier(1253, "manufacturing") - (1 + (0.2 * 40) / 192)) < 1e-12
);
assert.equal(sectorNpvBoostMultiplier(1309), 1);
assert.equal(sectorNpvBoostMultiplier(1501), 1.3);
assert.equal(bankNpvBoostMultiplier(1501), 1.5);
console.log(
  JSON.stringify(
    {
      method: "Fixed-output control/treatment replay using production ramp and physical P&L rules",
      limitation:
        "Does not simulate endogenous world prices, demand, AI decisions or long-run solvency",
      checkedSectorTurns: 2 * 427 * fixtures.length,
      rows,
    },
    null,
    2
  )
);
