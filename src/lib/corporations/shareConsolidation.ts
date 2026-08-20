import type { ObjectId } from "mongodb";
import type { Corporation, Shareholder } from "@/lib/db/types";

/**
 * Whether the corporation may undergo CEO-driven share structure changes (split / reverse split).
 */
export function corporationCanRestructureShares(
  corp: Corporation
): { ok: true } | { ok: false; reason: string } {
  if (corp.countryOwnerId != null || corp.isNationalized) {
    return { ok: false, reason: "State-owned corporations cannot change share structure." };
  }
  const total = corp.totalShares ?? 0;
  if (total <= 0) {
    return { ok: false, reason: "Invalid outstanding share count." };
  }
  return { ok: true };
}

/** Sum of on-book shareholder shares plus public float (must match totalShares when no open sell orders). */
export function sumAccountedOutstandingShares(corp: Corporation): number {
  const float = corp.publicFloat ?? 0;
  const sh = (corp.shareholders ?? []).reduce((s, h) => s + (h.shares ?? 0), 0);
  return sh + float;
}

export type HolderKind = "character" | "imperial" | "corporation" | "fund";

type AllocPart = {
  key: string;
  kind: HolderKind | "float";
  ownerId?: ObjectId;
  avgCostPerShare?: number;
  weight: number;
  /** Pre-split supershare count (if any holder in this dedup group had one). */
  superShares?: number;
};

function holderKindOf(h: Shareholder): HolderKind | null {
  if (h.characterId) return "character";
  if (h.imperialCharacterId) return "imperial";
  if (h.corporationId) return "corporation";
  if (h.fundId) return "fund";
  return null;
}

function ownerIdOf(h: Shareholder, kind: HolderKind): ObjectId {
  if (kind === "character") return h.characterId!;
  if (kind === "imperial") return h.imperialCharacterId!;
  if (kind === "fund") return h.fundId!;
  return h.corporationId!;
}

function buildAllocParts(corp: Corporation): AllocPart[] {
  const parts: AllocPart[] = [];
  const float = corp.publicFloat ?? 0;
  if (float > 0) {
    parts.push({ key: "__float__", kind: "float", weight: float });
  }
  // Dedup by (kind, ownerId). Blend avgCostPerShare across duplicate rows
  // using a weighted average on shares, mirroring creditShares helpers.
  const byOwner = new Map<
    string,
    {
      kind: HolderKind;
      ownerId: ObjectId;
      shares: number;
      costWeightedSum: number;
      costWeightedShares: number;
      /** Pre-split supershare count — only the CEO should have one, but we
       * take the max defensively across any duplicate rows for the same owner. */
      superShares: number;
    }
  >();
  for (const h of corp.shareholders ?? []) {
    const n = h.shares ?? 0;
    if (n <= 0) continue;
    const kind = holderKindOf(h);
    if (!kind) continue;
    const ownerId = ownerIdOf(h, kind);
    const key = `${kind}:${ownerId.toString()}`;
    const prev = byOwner.get(key);
    const hSuper = h.superShares ?? 0;
    if (prev) {
      prev.shares += n;
      prev.superShares = Math.max(prev.superShares, hSuper);
      if (h.avgCostPerShare != null) {
        prev.costWeightedSum += h.avgCostPerShare * n;
        prev.costWeightedShares += n;
      }
    } else {
      byOwner.set(key, {
        kind,
        ownerId,
        shares: n,
        superShares: hSuper,
        costWeightedSum: h.avgCostPerShare != null ? h.avgCostPerShare * n : 0,
        costWeightedShares: h.avgCostPerShare != null ? n : 0,
      });
    }
  }
  for (const [key, v] of byOwner.entries()) {
    parts.push({
      key,
      kind: v.kind,
      ownerId: v.ownerId,
      weight: v.shares,
      avgCostPerShare:
        v.costWeightedShares > 0 ? v.costWeightedSum / v.costWeightedShares : undefined,
      superShares: v.superShares > 0 ? v.superShares : undefined,
    });
  }
  return parts;
}

/**
 * Integer allocation of `newTotal` shares across float + shareholders, proportional to current weights.
 * Largest-remainder method so the sum matches `newTotal` exactly.
 */
export function allocateProportionalShareTotals(
  corp: Corporation,
  newTotal: number
): { publicFloat: number; shareholders: Shareholder[] } {
  const parts = buildAllocParts(corp);
  const weightSum = parts.reduce((s, p) => s + p.weight, 0);
  if (parts.length === 0 || weightSum <= 0) {
    throw new Error("allocateProportionalShareTotals: no share buckets");
  }
  if (newTotal < parts.length) {
    throw new Error("allocateProportionalShareTotals: newTotal too small for holder count");
  }

  const floors = parts.map((p) => Math.floor((p.weight * newTotal) / weightSum));
  const allocated = floors.reduce((a, b) => a + b, 0);
  const remainder = newTotal - allocated;
  const fracOrder = parts
    .map((p, i) => ({
      i,
      frac: (p.weight * newTotal) / weightSum - floors[i]!,
    }))
    .sort((a, b) => b.frac - a.frac);
  const counts = [...floors];
  for (let k = 0; k < remainder; k++) {
    counts[fracOrder[k]!.i]!++;
  }

  // Reverse splits can round a tiny holder (e.g. a single-share owner in a
  // multi-million-share corp) down to zero, which trips the drop-holder
  // invariant. Guarantee every non-float holder with positive input weight
  // gets at least 1 share, stealing from whichever non-float holder currently
  // holds the most. Float can still go to zero — it is not a legal person.
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.kind === "float") continue;
    if (p.weight <= 0) continue;
    if (counts[i]! >= 1) continue;
    let maxIdx = -1;
    for (let j = 0; j < parts.length; j++) {
      if (j === i) continue;
      if (parts[j]!.kind === "float") continue;
      if (counts[j]! <= 1) continue;
      if (maxIdx === -1 || counts[j]! > counts[maxIdx]!) maxIdx = j;
    }
    if (maxIdx === -1) continue;
    counts[maxIdx]!--;
    counts[i]!++;
  }

  // Price-per-share scales inversely with share count in a split, so cost basis
  // per share scales by the same factor: oldTotal / newTotal. All holders see
  // the same multiplier because allocation is proportional.
  const oldTotal = weightSum;
  const basisFactor = oldTotal / newTotal;

  let publicFloat = 0;
  const shareholders: Shareholder[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const n = counts[i]!;
    if (p.kind === "float") {
      publicFloat = n;
      continue;
    }
    if (n <= 0 || !p.ownerId) continue;
    const entry: Shareholder = { shares: n } as Shareholder;
    if (p.kind === "character") entry.characterId = p.ownerId;
    else if (p.kind === "imperial") entry.imperialCharacterId = p.ownerId;
    else if (p.kind === "fund") entry.fundId = p.ownerId;
    else entry.corporationId = p.ownerId;
    if (p.avgCostPerShare != null) {
      entry.avgCostPerShare = p.avgCostPerShare * basisFactor;
    }
    // Scale supershares proportionally to the share allocation so dual-class
    // voting power survives splits/reverse splits. The split ratio is n / p.weight
    // (new shares ÷ old shares for this holder). Floored and capped at n so the
    // effective invariant `min(superShares, shares)` is never violated. This was
    // previously missing entirely — the entire shareholders array was $set without
    // superShares, silently demoting every dual-class founder to one-share-one-vote
    // after any split (Bug #0832).
    if (p.superShares != null && p.superShares > 0 && p.weight > 0) {
      const scaledSuper = Math.floor((p.superShares * n) / p.weight);
      if (scaledSuper > 0) {
        entry.superShares = Math.min(scaledSuper, n);
      }
    }
    shareholders.push(entry);
  }

  shareholders.sort((a, b) => {
    const aId = (a.characterId ?? a.imperialCharacterId ?? a.corporationId ?? a.fundId)!.toString();
    const bId = (b.characterId ?? b.imperialCharacterId ?? b.corporationId ?? b.fundId)!.toString();
    return aId.localeCompare(bId);
  });

  return { publicFloat, shareholders };
}

export type FundHoldingSplitSync = {
  fundId: ObjectId;
  /** Exact post-split cap-table share count this fund must mirror in its holdings ledger. */
  newShares: number;
  /** Factor to multiply the holding's per-share cost basis by (oldTotal / newTotal). */
  basisFactor: number;
};

/**
 * A split rescales each fund's cap-table entry, but a fund's internal `holdings`
 * ledger (which drives NAV and realized P&L) is not re-derived from the cap
 * table — mark-to-market multiplies the stored `shares` by the new price. Left
 * alone, holdings.shares keeps the pre-split count and NAV is off by the split
 * factor. This derives, from the already-rescaled `newShareholders`, the exact
 * share count and cost-basis factor to write back into each surviving fund's
 * holdings so the ledger stays in lockstep with the cap table.
 */
export function planFundHoldingSplitSync(
  newShareholders: Pick<
    Shareholder,
    "characterId" | "imperialCharacterId" | "corporationId" | "fundId" | "shares"
  >[],
  oldTotal: number,
  newTotal: number
): FundHoldingSplitSync[] {
  if (oldTotal <= 0 || newTotal <= 0) return [];
  const basisFactor = oldTotal / newTotal;
  const syncs: FundHoldingSplitSync[] = [];
  for (const h of newShareholders) {
    if (h.fundId && (h.shares ?? 0) > 0) {
      syncs.push({ fundId: h.fundId, newShares: h.shares, basisFactor });
    }
  }
  return syncs;
}

export type DroppedShareholder = { kind: HolderKind; ownerId: ObjectId };

/**
 * Returns every holder (character, imperial, corporation, fund) that was present
 * in `before` with positive shares but is missing or zero-share in `after`.
 * Zero-share input rows are ignored — those are never expected to survive.
 * Structured so callers can surface names instead of raw ObjectIds.
 */
export function findDroppedShareholders(
  before: Pick<
    Shareholder,
    "characterId" | "imperialCharacterId" | "corporationId" | "fundId" | "shares"
  >[],
  after: Pick<
    Shareholder,
    "characterId" | "imperialCharacterId" | "corporationId" | "fundId" | "shares"
  >[]
): DroppedShareholder[] {
  const entryOf = (
    h: Pick<Shareholder, "characterId" | "imperialCharacterId" | "corporationId" | "fundId">
  ): DroppedShareholder | null => {
    if (h.characterId) return { kind: "character", ownerId: h.characterId };
    if (h.imperialCharacterId) return { kind: "imperial", ownerId: h.imperialCharacterId };
    if (h.corporationId) return { kind: "corporation", ownerId: h.corporationId };
    if (h.fundId) return { kind: "fund", ownerId: h.fundId };
    return null;
  };
  const keyOf = (e: DroppedShareholder) => `${e.kind}:${e.ownerId.toString()}`;
  const expected = new Map<string, DroppedShareholder>();
  for (const h of before) {
    if ((h.shares ?? 0) <= 0) continue;
    const entry = entryOf(h);
    if (entry) expected.set(keyOf(entry), entry);
  }
  const present = new Set<string>();
  for (const h of after) {
    if ((h.shares ?? 0) <= 0) continue;
    const entry = entryOf(h);
    if (entry) present.add(keyOf(entry));
  }
  const dropped: DroppedShareholder[] = [];
  for (const [k, v] of expected) if (!present.has(k)) dropped.push(v);
  return dropped;
}

/**
 * Defense in depth: verify that a CEO-driven split / reverse split preserved
 * every owner in the input shareholders list. The proportional allocator is
 * designed to emit one output row per positive input holder, so a missing
 * entry means a bug shape was reintroduced (e.g., only considering one holder
 * kind).
 */
export function assertShareStructureChangePreservesHolders(
  before: Pick<
    Shareholder,
    "characterId" | "imperialCharacterId" | "corporationId" | "fundId" | "shares"
  >[],
  after: Pick<
    Shareholder,
    "characterId" | "imperialCharacterId" | "corporationId" | "fundId" | "shares"
  >[]
): void {
  const dropped = findDroppedShareholders(before, after);
  if (dropped.length > 0) {
    const keys = dropped.map((d) => `${d.kind}:${d.ownerId.toString()}`);
    throw new Error(
      `Share structure change dropped holders: ${keys.join(", ")}. ` +
        `All owner kinds (character, imperial, corporation, fund) must be preserved.`
    );
  }
}

/**
 * Scale share price so market cap stays constant when share count changes (split or reverse split).
 * factor = oldTotal / newTotal (reverse: >1, forward: <1).
 */
export function scaleSharePricesForStructureChange(
  oldTotal: number,
  newTotal: number,
  sharePrice: number
): { sharePrice: number } {
  if (newTotal <= 0 || oldTotal <= 0) {
    throw new Error("scaleSharePricesForStructureChange: totals must be positive");
  }
  const factor = oldTotal / newTotal;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  return { sharePrice: round4(sharePrice * factor) };
}

/**
 * Dilution factor for a share issuance that creates float inventory with no
 * cash entering at issuance time: oldTotal / (oldTotal + newShares). Market
 * cap must be preserved exactly like a forward split — the proceeds arrive
 * only as the float is actually bought, so pricing the new shares in for free
 * fabricates market cap (2026-08-20 incident: an uncapped issuance vote after
 * a large reverse split inflated market cap ~127x in one turn).
 */
export function issuanceDilutionFactor(oldTotal: number, newShares: number): number {
  if (!(oldTotal > 0) || !(newShares > 0)) return 1;
  return oldTotal / (oldTotal + newShares);
}

/**
 * Mongo aggregation-pipeline expression form of {@link issuanceDilutionFactor},
 * evaluated against the document pre-image ("$totalShares") so the read and
 * the scale happen in one atomic update.
 */
export function issuanceDilutionFactorExpr(newShares: number): Record<string, unknown> {
  return {
    $cond: [
      { $gt: [{ $ifNull: ["$totalShares", 0] }, 0] },
      {
        $divide: ["$totalShares", { $add: ["$totalShares", newShares] }],
      },
      1,
    ],
  };
}
