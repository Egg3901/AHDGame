/** Turn response of the explicitly provisional opening household index. */
export function provisionalRealPurchasingPower(input: {
  openingIndex: number;
  openingGrossIncome: number;
  openingBasketIndex: number;
  currentGrossIncome: number;
  currentBasketIndex: number;
}): number {
  const values = Object.values(input);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("Purchasing-power proxy requires positive finite observations");
  }
  const openingRatio = input.openingGrossIncome / input.openingBasketIndex;
  const currentRatio = input.currentGrossIncome / input.currentBasketIndex;
  return input.openingIndex * (currentRatio / openingRatio);
}
