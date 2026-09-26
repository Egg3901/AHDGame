type NumericRecord = Record<string, number>;

export function scaleMoney(value: number | undefined, scale: number): number | undefined {
  return value === undefined ? undefined : value * scale;
}

export function scaleMoneyRecord<T extends NumericRecord>(record: T, scale: number): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value * scale])
  ) as T;
}

interface FederalBudgetMoneyShape {
  revenue: NumericRecord;
  taxBases: NumericRecord;
  spending: { byCategory: NumericRecord };
  debt: NumericRecord;
  treasuryBalance: number;
  surplus: number;
  gdp: number;
  gdpSmoothed?: number;
  militaryPriceBaselineGdp?: number;
  baselineSpendingByCategory: NumericRecord;
  baselineStateGrants: number;
  defenseAppropriation?: {
    balance: number;
    accruedThroughTurn: number;
    arrearsRatio: number;
    encumbered?: number;
  };
  intelligenceAppropriation?: { balance: number; accruedThroughTurn: number };
}

/** Pure denomination change. Rates, ratios, years and physical quantities stay unchanged. */
export function redenominateFederalBudget<T extends FederalBudgetMoneyShape>(
  doc: T,
  scale: number
) {
  const { byCategory, ...spendingScalars } = doc.spending;
  return {
    revenue: scaleMoneyRecord(doc.revenue, scale),
    taxBases: scaleMoneyRecord(doc.taxBases, scale),
    spending: {
      ...scaleMoneyRecord(spendingScalars as NumericRecord, scale),
      byCategory: scaleMoneyRecord(byCategory, scale),
    },
    debt: {
      ...doc.debt,
      principal: (doc.debt.principal ?? 0) * scale,
      ceiling: (doc.debt.ceiling ?? 0) * scale,
    } as T["debt"],
    treasuryBalance: doc.treasuryBalance * scale,
    surplus: doc.surplus * scale,
    gdp: doc.gdp * scale,
    ...(doc.gdpSmoothed === undefined ? {} : { gdpSmoothed: doc.gdpSmoothed * scale }),
    ...(doc.militaryPriceBaselineGdp === undefined
      ? {}
      : { militaryPriceBaselineGdp: doc.militaryPriceBaselineGdp * scale }),
    baselineSpendingByCategory: scaleMoneyRecord(doc.baselineSpendingByCategory, scale),
    baselineStateGrants: doc.baselineStateGrants * scale,
    ...(doc.defenseAppropriation
      ? {
          defenseAppropriation: {
            ...doc.defenseAppropriation,
            balance: doc.defenseAppropriation.balance * scale,
            ...(doc.defenseAppropriation.encumbered === undefined
              ? {}
              : { encumbered: doc.defenseAppropriation.encumbered * scale }),
          },
        }
      : {}),
    ...(doc.intelligenceAppropriation
      ? {
          intelligenceAppropriation: {
            ...doc.intelligenceAppropriation,
            balance: doc.intelligenceAppropriation.balance * scale,
          },
        }
      : {}),
  };
}

interface StateBudgetMoneyShape {
  revenue: NumericRecord;
  taxBases: NumericRecord;
  spending: { byCategory: NumericRecord };
  balance: number;
  surplus: number;
  stateGdp: number;
}

export function redenominateStateBudget<T extends StateBudgetMoneyShape>(doc: T, scale: number) {
  const { byCategory, ...spendingScalars } = doc.spending;
  return {
    revenue: scaleMoneyRecord(doc.revenue, scale),
    taxBases: scaleMoneyRecord(doc.taxBases, scale),
    spending: {
      ...scaleMoneyRecord(spendingScalars as NumericRecord, scale),
      byCategory: scaleMoneyRecord(byCategory, scale),
    },
    balance: doc.balance * scale,
    surplus: doc.surplus * scale,
    stateGdp: doc.stateGdp * scale,
  };
}
