/** Portable Guided Path draft model. A draft never itself enacts or funds a law. */
import type { LawChoice } from "./eligibility";

export interface DraftLawProvision {
  familyId: string;
  scope: "national" | "regional";
  choice: LawChoice;
  fundingOwnerId: string | null;
  currentAnnualAllocation: number;
  proposedAnnualAllocation: number;
  primaryMetricIds: readonly string[];
}

export interface DraftBillReview {
  provisions: readonly DraftLawProvision[];
  agencyAllocations: { ownerId: string; proposedAnnualAllocation: number; change: number }[];
  regionalAnnualAllocation: number;
  regionalAnnualChange: number;
  totalAnnualAllocation: number;
  totalAnnualChange: number;
  distinctPrimaryMetricIds: string[];
}

function key(provision: Pick<DraftLawProvision, "familyId" | "scope">): string {
  return `${provision.scope}:${provision.familyId}`;
}

function validate(provision: DraftLawProvision): void {
  if (!provision.familyId.trim()) throw new Error("law family is required");
  if (
    !Number.isFinite(provision.currentAnnualAllocation) ||
    provision.currentAnnualAllocation < 0 ||
    !Number.isFinite(provision.proposedAnnualAllocation) ||
    provision.proposedAnnualAllocation < 0
  ) {
    throw new Error("annual allocations must be nonnegative and finite");
  }
  if (provision.scope === "national" && !provision.fundingOwnerId) {
    throw new Error("national law requires a funding owner");
  }
  if (provision.scope === "regional" && provision.fundingOwnerId !== null) {
    throw new Error("regional law has no Cabinet funding owner");
  }
}

/** Adding the same family/scope edits that provision, not a second charge. */
export function upsertDraftProvision(
  provisions: readonly DraftLawProvision[],
  next: DraftLawProvision
): DraftLawProvision[] {
  validate(next);
  const existing = provisions.findIndex((provision) => key(provision) === key(next));
  if (existing < 0) return [...provisions, next];
  return provisions.map((provision, index) => (index === existing ? next : provision));
}

export function removeDraftProvision(
  provisions: readonly DraftLawProvision[],
  scope: DraftLawProvision["scope"],
  familyId: string
): DraftLawProvision[] {
  return provisions.filter((provision) => key(provision) !== `${scope}:${familyId}`);
}

export function reviewDraftBill(provisions: readonly DraftLawProvision[]): DraftBillReview {
  const agencies = new Map<
    string,
    { ownerId: string; proposedAnnualAllocation: number; change: number }
  >();
  const metrics = new Set<string>();
  const keys = new Set<string>();
  const billScope = provisions[0]?.scope;
  let regionalAnnualAllocation = 0;
  let regionalAnnualChange = 0;
  let totalAnnualAllocation = 0;
  let totalAnnualChange = 0;
  for (const provision of provisions) {
    validate(provision);
    if (provision.scope !== billScope)
      throw new Error("a bill cannot cross national and regional jurisdictions");
    const provisionKey = key(provision);
    if (keys.has(provisionKey)) throw new Error(`duplicate law provision ${provisionKey}`);
    keys.add(provisionKey);
    const change = provision.proposedAnnualAllocation - provision.currentAnnualAllocation;
    totalAnnualAllocation += provision.proposedAnnualAllocation;
    totalAnnualChange += change;
    for (const id of provision.primaryMetricIds) metrics.add(id);
    if (provision.scope === "regional") {
      regionalAnnualAllocation += provision.proposedAnnualAllocation;
      regionalAnnualChange += change;
    } else {
      const ownerId = provision.fundingOwnerId!;
      const agency = agencies.get(ownerId) ?? { ownerId, proposedAnnualAllocation: 0, change: 0 };
      agency.proposedAnnualAllocation += provision.proposedAnnualAllocation;
      agency.change += change;
      agencies.set(ownerId, agency);
    }
  }
  return {
    provisions: [...provisions],
    agencyAllocations: [...agencies.values()],
    regionalAnnualAllocation,
    regionalAnnualChange,
    totalAnnualAllocation,
    totalAnnualChange,
    distinctPrimaryMetricIds: [...metrics],
  };
}
