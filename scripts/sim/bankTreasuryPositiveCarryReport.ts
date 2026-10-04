import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  computeBankTreasuryFundingRatePercent,
  planBankTreasurySweep,
  quoteBankTreasuryBond,
} from "@/lib/banking/rules/bankTreasury";
import type { Bond } from "@/lib/db/types/bond";

const currentTurn = 100;
const quote = (id: string, couponRate: number, remainingTurns: number, publicFloat = 100) =>
  quoteBankTreasuryBond({
    bond: {
      _id: new ObjectId(id),
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      marketPrice: 1,
      couponRate,
      maturityTurn: currentTurn + remainingTurns,
      matured: false,
      defaulted: false,
      publicFloat,
    } as Bond,
    currency: "USD",
    currentTurn,
    poolCashLocal: 100_000,
    poolTargetCashLocal: 100_000,
  });

const fundedRateInput = {
  currency: "USD" as const,
  primeRate: 4,
  inflationRate: 0,
  depositOffset: 0,
  npcDeposits: 100_000,
  totalDeposits: 100_000,
  playerDeposits: 0,
  playerDepositsAreLiabilities: true,
  discountWindowDebt: 0,
  cbMarginDebt: 0,
  interbankLoans: [],
};
const currentFundingRatePercent = computeBankTreasuryFundingRatePercent(fundedRateInput);
const noLiabilityFundingRatePercent = computeBankTreasuryFundingRatePercent({
  ...fundedRateInput,
  npcDeposits: 0,
  totalDeposits: 0,
});
const guaranteedLoss = quote("325000000000000000000001", 7, 1);
const lowerYield = quote("325000000000000000000002", 6, 48, 1);
const higherYield = quote("325000000000000000000003", 8, 48, 1);
const planned = planBankTreasurySweep(
  [lowerYield, higherYield],
  2_020,
  0,
  currentFundingRatePercent
);

assert.equal(guaranteedLoss.askPerUnitLocal, 1_010);
assert.ok(guaranteedLoss.annualizedContractYieldPercent < 0);
assert.ok(noLiabilityFundingRatePercent === 0);
assert.deepEqual(
  planned.map((item) => item.bondId),
  [higherYield.bondId, lowerYield.bondId]
);
assert.ok(planned.every((item) => item.units > 0));

process.stdout.write(
  `${JSON.stringify(
    {
      ruleSource: "src/lib/banking/rules/bankTreasury.ts",
      currentFundingRatePercent,
      noLiabilityFundingRatePercent,
      guaranteedLoss: {
        bondId: guaranteedLoss.bondId,
        remainingTurns: guaranteedLoss.remainingTurns,
        couponRate: guaranteedLoss.couponRate,
        askPerUnitLocal: guaranteedLoss.askPerUnitLocal,
        annualizedContractYieldPercent: guaranteedLoss.annualizedContractYieldPercent,
        autoEligible: guaranteedLoss.annualizedContractYieldPercent > currentFundingRatePercent,
      },
      positiveCarryOrder: planned.map((item) => ({
        bondId: item.bondId,
        units: item.units,
        askPerUnitLocal: item.askPerUnitLocal,
        costLocal: item.costLocal,
        annualizedContractYieldPercent:
          item.bondId === higherYield.bondId
            ? higherYield.annualizedContractYieldPercent
            : lowerYield.annualizedContractYieldPercent,
      })),
    },
    null,
    2
  )}\n`
);
