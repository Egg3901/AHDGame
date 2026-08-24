import type { Db } from "mongodb";
import type { LegislationType, StatePolicy } from "@/lib/db/types";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
} from "@/lib/legislationTypeAliases";
import { resolveOptionLabel, splitLegacySnapshot } from "./optionLabel";
import { resolveProvisionPolicyOption, type ResolvableProvision } from "./resolvePolicyOption";
import type { FiscalScope, ProvisionLabel } from "./types";

/** The frozen labels a provision carries once it has been through the snapshot pass. */
export interface SnapshotFields {
  policyOptionNameSnapshot?: string;
  policyOptionExplanationSnapshot?: string;
  currentPolicyOptionIdSnapshot?: string;
  currentPolicyOptionNameSnapshot?: string;
  currentPolicyOptionExplanationSnapshot?: string;
}

export type SnapshottedProvision = ResolvableProvision & SnapshotFields;

/** A live current-law row, from statePolicies or the enactedLaws fallback. */
export interface LiveCurrentPolicy {
  policyOptionIndex?: number;
  policyOptionId?: string;
}

/**
 * The `statePolicies.stateId` key for a scope.
 *
 * National rows are keyed on a pseudo-stateId ("federal", "uk_national", ...),
 * not on a `scope` field: `StatePolicy.scope` is optional on reads because
 * pre-migration documents lack it, so filtering on it would silently miss them.
 * Both pre-merge implementations keyed on stateId and this preserves that.
 */
function policyStoreId(scope: FiscalScope): string {
  if (scope.scope === "region") return scope.regionId;
  return getNationalDocId(scope.countryId) ?? `${scope.countryId.toLowerCase()}_national`;
}

function labelFromIndex(
  lt: LegislationType | null | undefined,
  index: number
): ProvisionLabel | undefined {
  const option = lt?.policyOptions?.[index];
  return option ? resolveOptionLabel(option) : undefined;
}

/**
 * The current law shown beside a proposal.
 *
 * Snapshot first, live only as a fallback. Reading live unconditionally is what
 * made an enacted bill render its own outcome as "Current law": once the bill
 * enacts, the live row IS the proposal.
 */
export function resolveCurrentLaw(
  lt: LegislationType | null | undefined,
  provision: SnapshottedProvision,
  live: LiveCurrentPolicy | undefined
): { label?: ProvisionLabel; index?: number } {
  // 1. Id snapshot — the strongest signal, and re-resolvable against the catalog.
  //    A stale id (law reseeded with different option ids) falls through rather
  //    than blanking the box.
  if (provision.currentPolicyOptionIdSnapshot) {
    const index = lt?.policyOptions?.findIndex(
      (opt) => opt.id === provision.currentPolicyOptionIdSnapshot
    );
    if (index !== undefined && index !== -1) {
      return { index, label: labelFromIndex(lt, index) };
    }
  }

  // 2. Structured label snapshot.
  if (
    provision.currentPolicyOptionNameSnapshot &&
    provision.currentPolicyOptionExplanationSnapshot
  ) {
    return {
      label: {
        name: provision.currentPolicyOptionNameSnapshot,
        explanation: provision.currentPolicyOptionExplanationSnapshot,
      },
    };
  }

  // 3. Legacy combined snapshot, split the way the national page always rendered it.
  if (provision.currentPolicyOptionNameSnapshot) {
    const label = splitLegacySnapshot(provision.currentPolicyOptionNameSnapshot);
    if (label) return { label };
  }

  // 4/5. Live row (statePolicies, else enactedLaws), supplied by the caller.
  if (live?.policyOptionIndex !== undefined) {
    return { index: live.policyOptionIndex, label: labelFromIndex(lt, live.policyOptionIndex) };
  }
  if (live?.policyOptionId) {
    const index = lt?.policyOptions?.findIndex((opt) => opt.id === live.policyOptionId);
    if (index !== undefined && index !== -1) {
      return { index, label: labelFromIndex(lt, index) };
    }
  }

  // 6. Nothing to show.
  return {};
}

/** The proposed option's label. Snapshot first, then live resolution. */
export function resolveProposedLabel(
  lt: LegislationType | null | undefined,
  provision: SnapshottedProvision,
  fallbackName: string
): { label: ProvisionLabel; index?: number } {
  const resolved = resolveProvisionPolicyOption(lt, provision);

  if (provision.policyOptionNameSnapshot && provision.policyOptionExplanationSnapshot) {
    return {
      label: {
        name: provision.policyOptionNameSnapshot,
        explanation: provision.policyOptionExplanationSnapshot,
      },
      ...(resolved ? { index: resolved.index } : {}),
    };
  }
  if (provision.policyOptionNameSnapshot) {
    const label = splitLegacySnapshot(provision.policyOptionNameSnapshot);
    if (label) return { label, ...(resolved ? { index: resolved.index } : {}) };
  }
  if (resolved) {
    return { label: resolveOptionLabel(resolved.option), index: resolved.index };
  }
  return { label: { name: fallbackName } };
}

/**
 * Live current-law rows for a set of legislation types at one scope.
 *
 * `statePolicies` is primary; the most recent un-repealed `enactedLaws` row
 * fills gaps. Legislation-type ids are canonicalized so legacy tax-rate aliases
 * resolve — the regional path previously did a raw lookup and missed them.
 */
export async function loadLiveCurrentPolicies(
  db: Db,
  scope: FiscalScope,
  legislationTypeIds: string[]
): Promise<Map<string, LiveCurrentPolicy>> {
  const out = new Map<string, LiveCurrentPolicy>();
  if (legislationTypeIds.length === 0) return out;

  const canonical = [
    ...new Set(
      legislationTypeIds
        .map((id) => canonicalizeLegislationTypeId(id))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (canonical.length === 0) return out;
  const equivalents = [...new Set(canonical.flatMap((id) => getEquivalentLegislationTypeIds(id)))];

  const policies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: policyStoreId(scope), legislationTypeId: { $in: equivalents } })
    .toArray();
  for (const policy of policies) {
    const key = canonicalizeLegislationTypeId(policy.legislationTypeId);
    if (!key) continue;
    // Prefer an exact canonical-id row over a legacy alias row for the same law.
    if (out.has(key) && policy.legislationTypeId !== key) continue;
    out.set(key, {
      ...(typeof policy.policyOptionIndex === "number"
        ? { policyOptionIndex: policy.policyOptionIndex }
        : {}),
      ...(policy.policyOptionId ? { policyOptionId: policy.policyOptionId } : {}),
    });
  }

  const missing = canonical.filter((id) => !out.has(id));
  if (missing.length === 0) return out;

  const laws = await db
    .collection<EnactedLaw>("enactedLaws")
    .find({
      legislationTypeId: {
        $in: [...new Set(missing.flatMap((id) => getEquivalentLegislationTypeIds(id)))],
      },
      repealedAt: { $exists: false },
      ...(scope.scope === "region"
        ? { stateId: scope.regionId }
        : { countryId: scope.countryId as string }),
    })
    .sort({ enactedAt: -1 })
    .toArray();
  for (const law of laws) {
    const key = canonicalizeLegislationTypeId(law.legislationTypeId);
    if (!key || out.has(key)) continue;
    if (law.policyOptionIndex === undefined) continue;
    out.set(key, { policyOptionIndex: law.policyOptionIndex });
  }

  return out;
}
