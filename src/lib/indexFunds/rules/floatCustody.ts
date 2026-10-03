/** Fund float trades preserve share totals and the existing weighted cost basis. */
export function quoteFloatCustody(input: {
  direction: "buy" | "sell";
  fundShares: number;
  publicFloat: number;
  shares: number;
  price: number;
  average?: number;
}) {
  const { direction, fundShares, publicFloat, shares, price, average } = input;
  if (
    ![fundShares, publicFloat, shares, price].every(Number.isFinite) ||
    fundShares < 0 ||
    publicFloat < 0 ||
    !Number.isSafeInteger(shares) ||
    shares <= 0 ||
    price <= 0
  )
    return undefined;
  if (direction === "buy") {
    if (publicFloat < shares) return undefined;
    return {
      fundShares: fundShares + shares,
      publicFloat: publicFloat - shares,
      average:
        fundShares > 0
          ? (fundShares * (average ?? price) + shares * price) / (fundShares + shares)
          : price,
    };
  }
  if (fundShares < shares) return undefined;
  return { fundShares: fundShares - shares, publicFloat: publicFloat + shares, average };
}
