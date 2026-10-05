/** Annual real household income in local currency at constant 1991 prices. */
export function provisionalRealPurchasingPower(input: {
  currentGrossIncome: number;
  currentBasketIndex: number;
}): number {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Purchasing-power proxy requires positive finite observations");
  }
  return (input.currentGrossIncome * 100) / input.currentBasketIndex;
}
