import type { MacroCountryState } from "@/lib/world/macro/types";

export interface LegacyMacroBudgetSlice {
  revenueMinor: number;
  protectedSpendingMinor: number;
  cashAfterProtectedSpendingMinor: number;
}

/** One bounded fiscal slice for a background successor. Sector capacity is
 * already per turn in game units. Fiscal capacity determines how much of that
 * output can be collected; ordinary services consume 90% before debt calls. */
export function planLegacyMacroBudget(country: MacroCountryState): LegacyMacroBudgetSlice {
  const cash = country.federationTreasuryMinor;
  if (
    typeof cash !== "number" ||
    !Number.isSafeInteger(cash) ||
    !Number.isFinite(country.fiscalCapacity) ||
    country.fiscalCapacity < 0 ||
    country.fiscalCapacity > 1 ||
    !Number.isFinite(country.stability) ||
    country.stability < 0 ||
    country.stability > 1
  )
    throw new Error("Federation successor has invalid fiscal state");
  let output = 0;
  for (const sector of Object.values(country.sectors)) {
    if (!sector) continue;
    if (
      !Number.isFinite(sector.capacity) ||
      sector.capacity < 0 ||
      !Number.isFinite(sector.productivity) ||
      sector.productivity < 0
    )
      throw new Error("Federation successor has invalid sector output");
    output += sector.capacity * sector.productivity;
  }
  if (!Number.isFinite(output) || output <= 0)
    throw new Error("Federation successor has no fiscal output");
  const revenueMinor = Math.round(output * country.stability * country.fiscalCapacity * 20);
  const protectedSpendingMinor = Math.round(revenueMinor * 0.9);
  const cashAfterProtectedSpendingMinor = cash + revenueMinor - protectedSpendingMinor;
  if (
    !Number.isSafeInteger(revenueMinor) ||
    !Number.isSafeInteger(protectedSpendingMinor) ||
    !Number.isSafeInteger(cashAfterProtectedSpendingMinor)
  )
    throw new Error("Federation successor budget exceeds shared accounting precision");
  return { revenueMinor, protectedSpendingMinor, cashAfterProtectedSpendingMinor };
}
