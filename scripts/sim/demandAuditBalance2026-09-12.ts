import {
  BUILDING_MATERIALS_GDP_DEMAND_FRACTION,
  COMMODITY_BASE_PRICES,
  MARKETING_ADVERTISING_DEMAND_ELASTICITY,
  MARKETING_ADVERTISING_DEMAND_RATE,
  MARKETING_ADVERTISING_REFERENCE_BUDGETS_ANCHOR,
} from "../../src/lib/constants/commodities";

const budgetScales = [0.00005, 0.01, 0.5, 1, 2, 10];
const advertising = budgetScales.map((scale) => {
  const budgets = MARKETING_ADVERTISING_REFERENCE_BUDGETS_ANCHOR * scale;
  const factor = scale ** (MARKETING_ADVERTISING_DEMAND_ELASTICITY - 1);
  const demandValue = budgets * MARKETING_ADVERTISING_DEMAND_RATE * factor;
  return { scale, factor, demandValue };
});

const referenceGdp = 1e12;
const buildingMaterialsUnits =
  (referenceGdp * BUILDING_MATERIALS_GDP_DEMAND_FRACTION) /
  COMMODITY_BASE_PRICES.building_materials;

console.log(JSON.stringify({ advertising, referenceGdp, buildingMaterialsUnits }, null, 2));
