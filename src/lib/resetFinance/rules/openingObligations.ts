/** Fund the reviewed 1991 obligations once, preserving named transfer reservations. */
export interface OpeningObligation {
  sourceId: string;
  annualAmount: number;
  protectedTransfer?: boolean;
}

export function fitOpeningObligations(input: {
  revenue: number;
  gdp: number;
  interest: number;
  maximumDeficitGdpShare: number;
  obligations: readonly OpeningObligation[];
}) {
  for (const value of [input.revenue, input.gdp, input.interest]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid opening fiscal envelope");
    }
  }
  if (
    !Number.isFinite(input.maximumDeficitGdpShare) ||
    input.maximumDeficitGdpShare < 0 ||
    input.maximumDeficitGdpShare > 1
  ) {
    throw new Error("Invalid opening deficit share");
  }
  const seen = new Set<string>();
  let protectedTransfers = 0;
  let programs = 0;
  for (const obligation of input.obligations) {
    if (
      !obligation.sourceId ||
      seen.has(obligation.sourceId) ||
      !Number.isSafeInteger(obligation.annualAmount) ||
      obligation.annualAmount < 0
    ) {
      throw new Error(`Invalid or duplicate opening obligation ${obligation.sourceId}`);
    }
    seen.add(obligation.sourceId);
    if (obligation.protectedTransfer) protectedTransfers += obligation.annualAmount;
    else programs += obligation.annualAmount;
  }
  const available = Math.floor(
    input.revenue + input.gdp * input.maximumDeficitGdpShare - input.interest
  );
  if (available < protectedTransfers) {
    throw new Error("Opening receipts cannot fund interest and protected transfers");
  }
  const programCostScale =
    programs > 0 ? Math.min(1, (available - protectedTransfers) / programs) : 1;
  const sourceAllocations = Object.fromEntries(
    input.obligations.map((obligation) => [
      obligation.sourceId,
      obligation.protectedTransfer
        ? obligation.annualAmount
        : Math.floor(obligation.annualAmount * programCostScale),
    ])
  );
  const operating = Object.values(sourceAllocations).reduce((sum, amount) => sum + amount, 0);
  return {
    sourceOperating: protectedTransfers + programs,
    operating,
    protectedTransfers,
    programCostScale,
    sourceAllocations,
  };
}
