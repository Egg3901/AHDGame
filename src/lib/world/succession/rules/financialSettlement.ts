/**
 * Federation succession divides public financial assets and debt responsibility.
 * planSuccessionFinances defaults to population shares while preserving the
 * existing issuer and every creditor contract for continued servicing.
 */
export interface SuccessionParticipant {
  entityId: string;
  population: number;
}

export interface SuccessionFinancialTerms {
  settlementId: string;
  /** Existing contract issuer, retained even if it becomes a settlement administration. */
  servicingIssuerId: string;
  participants: readonly SuccessionParticipant[];
  /** Shared accounting minor units, never a successor's newly chosen currency. */
  financialAssetsMinor: number;
  creditorDebtMinor: number;
  /** Each complete negotiated allocation must sum to 10,000 basis points. */
  assetSharesBps?: Readonly<Record<string, number>>;
  debtSharesBps?: Readonly<Record<string, number>>;
}

export interface SuccessionFinancialPlan {
  settlementId: string;
  servicingIssuerId: string;
  creditorDebtMinor: number;
  financialAssetsMinor: number;
  assetAllocation: Record<string, number>;
  debtResponsibility: Record<string, number>;
  assetWeights: Record<string, number>;
  debtWeights: Record<string, number>;
  assetBasis: "population" | "negotiated";
  debtBasis: "population" | "negotiated";
}

function assertWholeAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer`);
}

function participantWeights(
  participants: readonly SuccessionParticipant[]
): Record<string, number> {
  if (participants.length < 2) throw new Error("Succession requires at least two participants");
  const weights: Record<string, number> = {};
  for (const participant of participants) {
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(participant.entityId))
      throw new Error("Invalid successor identity");
    if (Object.hasOwn(weights, participant.entityId))
      throw new Error("Duplicate successor identity");
    assertWholeAmount(participant.population, "Population");
    if (participant.population === 0) throw new Error("Successor population must be positive");
    weights[participant.entityId] = participant.population;
  }
  return weights;
}

function agreedWeights(
  populations: Record<string, number>,
  shares?: Readonly<Record<string, number>>
): Record<string, number> {
  if (shares === undefined) return { ...populations };
  const ids = Object.keys(populations);
  if (Object.keys(shares).length !== ids.length || ids.some((id) => !Object.hasOwn(shares, id)))
    throw new Error("Negotiated shares must name every successor exactly once");
  let sum = 0;
  for (const id of ids) {
    assertWholeAmount(shares[id], "Negotiated share");
    if (shares[id] > 10000) throw new Error("Negotiated share exceeds 100 percent");
    sum += shares[id];
  }
  if (sum !== 10000) throw new Error("Negotiated shares must total 100 percent");
  return { ...shares };
}

/** Integer largest-remainder allocation conserves every minor unit, including large balances. */
export function allocateSuccessionAmount(
  totalMinor: number,
  weights: Readonly<Record<string, number>>
): Record<string, number> {
  assertWholeAmount(totalMinor, "Settlement amount");
  const ids = Object.keys(weights).sort();
  if (!ids.length) throw new Error("Allocation requires participants");
  for (const id of ids) assertWholeAmount(weights[id], "Allocation weight");
  const denominator = ids.reduce((sum, id) => sum + BigInt(weights[id]), BigInt(0));
  if (denominator === BigInt(0)) throw new Error("Allocation weights must have a positive total");
  const total = BigInt(totalMinor);
  const rows = ids.map((id) => {
    const product = total * BigInt(weights[id]);
    return { id, amount: product / denominator, remainder: product % denominator };
  });
  let remaining = total - rows.reduce((sum, row) => sum + row.amount, BigInt(0));
  rows.sort((a, b) =>
    a.remainder === b.remainder
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1
  );
  for (const row of rows) {
    if (remaining === BigInt(0)) break;
    row.amount += BigInt(1);
    remaining -= BigInt(1);
  }
  return Object.fromEntries(rows.map((row) => [row.id, Number(row.amount)]));
}

export function planSuccessionFinances(terms: SuccessionFinancialTerms): SuccessionFinancialPlan {
  if (!terms.settlementId.trim() || !terms.servicingIssuerId.trim())
    throw new Error("Settlement and servicing issuer identities are required");
  const populations = participantWeights(terms.participants);
  const assetWeights = agreedWeights(populations, terms.assetSharesBps);
  const debtWeights = agreedWeights(populations, terms.debtSharesBps);
  return {
    settlementId: terms.settlementId,
    servicingIssuerId: terms.servicingIssuerId,
    creditorDebtMinor: terms.creditorDebtMinor,
    financialAssetsMinor: terms.financialAssetsMinor,
    assetAllocation: allocateSuccessionAmount(terms.financialAssetsMinor, assetWeights),
    debtResponsibility: allocateSuccessionAmount(terms.creditorDebtMinor, debtWeights),
    assetWeights,
    debtWeights,
    assetBasis: terms.assetSharesBps ? "negotiated" : "population",
    debtBasis: terms.debtSharesBps ? "negotiated" : "population",
  };
}

/** Allocates an actual creditor payment as contribution claims, without issuing new creditor debt. */
export function allocateSuccessionDebtService(
  plan: SuccessionFinancialPlan,
  paidMinor: number
): Record<string, number> {
  return allocateSuccessionAmount(paidMinor, plan.debtWeights);
}
