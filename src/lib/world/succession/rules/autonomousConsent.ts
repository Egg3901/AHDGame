/** Background successors decide on the recorded settlement terms, not on a
 * historical timer. The rule has a small, explicit risk budget so its result
 * and explanation remain stable for one proposal revision. */
export function decideAutonomousFederationConsent(input: {
  stability: number;
  fiscalCapacity: number;
  assetShareBps: number;
  debtShareBps: number;
}): { choice: "approve" | "reject"; reason: string } {
  const { stability, fiscalCapacity, assetShareBps, debtShareBps } = input;
  if (
    !Number.isFinite(stability) ||
    stability < 0 ||
    stability > 1 ||
    !Number.isFinite(fiscalCapacity) ||
    fiscalCapacity < 0 ||
    fiscalCapacity > 1 ||
    !Number.isSafeInteger(assetShareBps) ||
    !Number.isSafeInteger(debtShareBps) ||
    assetShareBps < 0 ||
    debtShareBps < 0 ||
    assetShareBps > 10_000 ||
    debtShareBps > 10_000
  )
    throw new Error("Autonomous federation consent needs bounded economic terms");
  const unfundedDebtBps = Math.max(0, debtShareBps - assetShareBps);
  const affordableGapBps = Math.round(500 + 2_500 * fiscalCapacity + 1_500 * stability);
  if (unfundedDebtBps > affordableGapBps)
    return {
      choice: "reject",
      reason: `Debt exceeds the asset allocation by ${unfundedDebtBps} basis points, above this government's ${affordableGapBps}-point fiscal risk limit.`,
    };
  if (stability < 0.2)
    return {
      choice: "reject",
      reason: `Political stability is ${stability.toFixed(2)}, below the 0.20 threshold for assuming settlement obligations.`,
    };
  return {
    choice: "approve",
    reason: `The ${unfundedDebtBps}-point debt-versus-asset share gap is within the ${affordableGapBps}-point fiscal risk limit, and political stability is ${stability.toFixed(2)}.`,
  };
}
