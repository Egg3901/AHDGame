import { democraticHealthPressure } from "../../src/lib/governanceStyle/rules/democraticConsequences";

const BASE_GDP = 100;
const BASE_GROWTH = 2.5;

console.log("health\tparty_drag_pct\truler_drag_pct\tgdp_drag_pts\t10y_gdp_vs_healthy_pct");
for (const health of [100, 80, 60, 50, 40, 30, 20, 10, 0]) {
  const pressure = democraticHealthPressure(health);
  const healthyGdp = BASE_GDP * Math.pow(1 + BASE_GROWTH / 100, 10);
  const impairedGrowth = BASE_GROWTH - pressure.gdpGrowthDrag;
  const impairedGdp = BASE_GDP * Math.pow(1 + impairedGrowth / 100, 10);
  const gapPct = (impairedGdp / healthyGdp - 1) * 100;
  console.log(
    [
      health,
      (pressure.partyPenalty * 100).toFixed(2),
      (pressure.currentRulerPenalty * 100).toFixed(2),
      pressure.gdpGrowthDrag.toFixed(3),
      gapPct.toFixed(2),
    ].join("\t")
  );
}
