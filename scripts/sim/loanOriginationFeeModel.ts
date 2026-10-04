import { quoteLoanOrigination } from "../../src/lib/banking/rules/loanFees";

for (const currency of ["USD", "JPY"] as const) {
  for (const principal of [12.34, 100_000, 1_000_000]) {
    const quote = quoteLoanOrigination(principal, currency);
    const openingVault = 2_000_000;
    const closingVault = openingVault - quote.proceeds;
    const closingAssets = closingVault + quote.principal;
    const feeEquityGain = closingAssets - openingVault;
    if (Math.abs(feeEquityGain - quote.originationFee) > 1e-6)
      throw new Error("Fee equity reconciliation failed");
    if (Math.abs(closingVault + quote.proceeds - openingVault) > 1e-6)
      throw new Error("Cash conservation failed");
    console.log(JSON.stringify({ currency, ...quote, feeEquityGain }));
  }
}
