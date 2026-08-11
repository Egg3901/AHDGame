export type InKindHolderKind = "character" | "imperial" | "corporation" | "fund";

export interface InKindShareholder {
  id: string;
  kind: InKindHolderKind;
  shares: number;
}

export interface InKindDistributionInput {
  /** The dissolving corp's own cap table (positive-share holders are used). */
  shareholders: InKindShareholder[];
  /** The dissolving corp's public float (shares with no named owner). */
  publicFloatShares: number;
  /** The dissolving corp's total shares (the pro-rata denominator). */
  totalShares: number;
  /** Number of ISSUER shares the dissolving corp holds (the block to distribute). */
  blockShares: number;
}

export interface InKindAllocation {
  id: string;
  kind: InKindHolderKind;
  shares: number;
}

export interface InKindDistributionResult {
  /** Per-recipient integer share allocations (only positive entries). */
  allocations: InKindAllocation[];
  /** Remainder routed back to the ISSUER's public float. */
  publicFloatShares: number;
}

const FLOAT_MARKER = "__float__";

/**
 * Distribute a cross-held equity block IN-KIND, pro-rata to the dissolving
 * corp's cap table, instead of cashing it out at market price (the money-mint
 * the dissolution route used to do). Uses the largest-remainder (Hamilton)
 * method so allocations are integers that sum EXACTLY to `blockShares` — no
 * shares are minted or burned. The dissolving corp's own public-float fraction
 * returns to the issuer's public float.
 */
export function computeInKindEquityDistribution(
  input: InKindDistributionInput
): InKindDistributionResult {
  const { shareholders, publicFloatShares, totalShares, blockShares } = input;
  if (!Number.isFinite(blockShares) || blockShares <= 0) {
    return { allocations: [], publicFloatShares: 0 };
  }

  const recipients: { id: string; kind: InKindHolderKind | "float"; weight: number }[] = [];
  for (const sh of shareholders) {
    if (sh.shares > 0) recipients.push({ id: sh.id, kind: sh.kind, weight: sh.shares });
  }
  if (publicFloatShares > 0) {
    recipients.push({ id: FLOAT_MARKER, kind: "float", weight: publicFloatShares });
  }

  // No owners at all — return the whole block to the issuer float to conserve.
  if (recipients.length === 0) {
    return { allocations: [], publicFloatShares: blockShares };
  }

  const denom =
    Number.isFinite(totalShares) && totalShares > 0
      ? totalShares
      : recipients.reduce((s, r) => s + r.weight, 0);

  const exacts = recipients.map((r) => (blockShares * r.weight) / denom);
  const floors = exacts.map((e) => Math.floor(e));
  const allocated = floors.reduce((s, f) => s + f, 0);
  let leftover = blockShares - allocated;

  // Hand out the leftover one share at a time, highest fractional remainder
  // first. Round-robin if leftover exceeds the recipient count (cap-table
  // drift) so the distributed total always equals blockShares exactly.
  const order = recipients
    .map((_, i) => i)
    .sort((a, b) => exacts[b] - floors[b] - (exacts[a] - floors[a]));
  let k = 0;
  while (leftover > 0) {
    floors[order[k % order.length]] += 1;
    leftover -= 1;
    k += 1;
  }

  const allocations: InKindAllocation[] = [];
  let floatShares = 0;
  for (let i = 0; i < recipients.length; i++) {
    if (floors[i] <= 0) continue;
    if (recipients[i].kind === "float") {
      floatShares += floors[i];
    } else {
      allocations.push({
        id: recipients[i].id,
        kind: recipients[i].kind as InKindHolderKind,
        shares: floors[i],
      });
    }
  }
  return { allocations, publicFloatShares: floatShares };
}
