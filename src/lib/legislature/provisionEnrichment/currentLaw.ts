import type { Db } from "mongodb";
import type { LegislationType, StatePolicy } from "@/lib/db/types";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
} from "@/lib/legislationTypeAliases";
import { regionalDefaultLevel } from "@/lib/politicalLegislation/regionalDefaults";
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
export function policyStoreId(scope: FiscalScope): string {
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

/** The ladder position of the live current-law row, by index or by option id. */
function liveIndex(
  lt: LegislationType | null | undefined,
  live: LiveCurrentPolicy | undefined
): number | undefined {
  if (live?.policyOptionIndex !== undefined) return live.policyOptionIndex;
  if (live?.policyOptionId) {
    const index = lt?.policyOptions?.findIndex((opt) => opt.id === live.policyOptionId);
    if (index !== undefined && index !== -1) return index;
  }
  return undefined;
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
  // The index is resolved from the id snapshot wherever one exists, even when a
  // structured label wins below: the ladder position drives effect chips and the
  // approval shift, and those must not silently fall back to the live row.
  let snapshotIndex: number | undefined;
  if (provision.currentPolicyOptionIdSnapshot) {
    const index = lt?.policyOptions?.findIndex(
      (opt) => opt.id === provision.currentPolicyOptionIdSnapshot
    );
    if (index !== undefined && index !== -1) snapshotIndex = index;
  }

  // 1. Structured label snapshot — frozen text, so a later seed-text edit does
  //    not rewrite history. This is what the migration leaves behind, and it is
  //    the field's original stated purpose.
  if (
    provision.currentPolicyOptionNameSnapshot &&
    provision.currentPolicyOptionExplanationSnapshot
  ) {
    return {
      ...(snapshotIndex !== undefined ? { index: snapshotIndex } : {}),
      label: {
        name: provision.currentPolicyOptionNameSnapshot,
        explanation: provision.currentPolicyOptionExplanationSnapshot,
      },
    };
  }

  // 2. Id snapshot, re-resolved against the catalog. This is what corrects
  //    documents written before structured snapshots existed, whose combined
  //    label had dropped the option name. A stale id (law reseeded with
  //    different option ids) falls through rather than blanking the box.
  if (snapshotIndex !== undefined) {
    return { index: snapshotIndex, label: labelFromIndex(lt, snapshotIndex) };
  }

  // 3. Legacy combined snapshot, split the way the national page always rendered
  //    it. There is no id to place it on the ladder, so the index falls through
  //    to the live row — the position drives the effect chips, and the national
  //    path has always taken it from the live row in exactly this case.
  const fromLive = liveIndex(lt, live);

  if (provision.currentPolicyOptionNameSnapshot) {
    const label = splitLegacySnapshot(provision.currentPolicyOptionNameSnapshot);
    if (label) return { label, ...(fromLive !== undefined ? { index: fromLive } : {}) };
  }

  // 4/5. Live row (statePolicies, else enactedLaws), supplied by the caller.
  if (fromLive !== undefined) {
    return { index: fromLive, label: labelFromIndex(lt, fromLive) };
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

  // Last resort at REGION scope only: a new-generation `both` law with no row
  // anywhere sits at level 0, which is already what `getEnactedLevel` reports
  // to the engine. Without this the provision renders with no current law at
  // all, and `LawProvisionComparison` drops the fiscal comparison and the
  // metric chips along with it. Deliberately not applied at national scope —
  // there a missing row means something else is wrong and should surface.
  if (scope.scope === "region") {
    for (const id of canonical) {
      if (out.has(id)) continue;
      const level = regionalDefaultLevel(id);
      if (level !== undefined) out.set(id, { policyOptionIndex: level });
    }
  }

  return out;
}
