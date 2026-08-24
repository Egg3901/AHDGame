import type { Db } from "mongodb";
import type { LegislationType, StatePolicy } from "@/lib/db/types";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
} from "@/lib/legislationTypeAliases";
import { resolveOptionLabel } from "./optionLabel";
import { resolveProvisionPolicyOption, type ResolvableProvision } from "./resolvePolicyOption";
import type { SnapshotFields } from "./currentLaw";
import type { FiscalScope } from "./types";

export type SnapshottableProvision = ResolvableProvision &
  SnapshotFields & { legislationTypeId: string };

/** Mirrors `currentLaw.policyStoreId` — national rows live under a pseudo-stateId. */
function policyStoreId(scope: FiscalScope): string {
  if (scope.scope === "region") return scope.regionId;
  return getNationalDocId(scope.countryId) ?? `${scope.countryId.toLowerCase()}_national`;
}

/**
 * Freeze the proposed and current option labels at proposal time so historical
 * bill detail does not drift after the law changes.
 *
 * Wired to every bill-creation site, national and regional. Only the national
 * ones called it before, which is why a region bill rendered its own enacted
 * outcome as "Current law".
 *
 * Labels are stamped as SEPARATE name and explanation fields. Nothing combines
 * them; the read path and the client keep them apart.
 *
 * Safe to run after `stampTaxSliderProvisions`: a slider provision carries a
 * synthetic "rate:<value>" option id that resolves to no seeded option, so the
 * conditional spreads leave its already-stamped labels alone.
 */
export async function snapshotBillPolicyProvisions<T extends SnapshottableProvision>(
  db: Db,
  scope: FiscalScope,
  provisions: T[]
): Promise<Array<T & SnapshotFields>> {
  if (provisions.length === 0) return provisions;

  const canonicalIds = [
    ...new Set(
      provisions
        .map((p) => canonicalizeLegislationTypeId(p.legislationTypeId))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (canonicalIds.length === 0) return provisions;
  const equivalents = [
    ...new Set(canonicalIds.flatMap((id) => getEquivalentLegislationTypeIds(id))),
  ];

  const [legislationTypes, currentPolicies] = await Promise.all([
    db
      .collection<LegislationType>("legislationTypes")
      .find({ _id: { $in: equivalents } })
      .toArray(),
    db
      .collection<StatePolicy>("statePolicies")
      .find({ stateId: policyStoreId(scope), legislationTypeId: { $in: equivalents } })
      .toArray(),
  ]);

  const legislationTypeMap = new Map<string, LegislationType>();
  for (const lt of legislationTypes) {
    const key = canonicalizeLegislationTypeId(lt._id);
    if (!key) continue;
    if (!legislationTypeMap.has(key) || lt._id === key) legislationTypeMap.set(key, lt);
  }

  const currentPolicyIdMap = new Map<string, string>();
  for (const policy of currentPolicies) {
    const key = canonicalizeLegislationTypeId(policy.legislationTypeId);
    if (!key) continue;
    if (!currentPolicyIdMap.has(key) || policy.legislationTypeId === key) {
      currentPolicyIdMap.set(key, policy.policyOptionId);
    }
  }

  const missing = canonicalIds.filter((id) => !currentPolicyIdMap.has(id));
  if (missing.length > 0) {
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

    const seen = new Set<string>();
    for (const law of laws) {
      const key = canonicalizeLegislationTypeId(law.legislationTypeId);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const option = legislationTypeMap.get(key)?.policyOptions?.[law.policyOptionIndex ?? -1];
      if (option?.id) currentPolicyIdMap.set(key, option.id);
    }
  }

  return provisions.map((provision) => {
    const key =
      canonicalizeLegislationTypeId(provision.legislationTypeId) ?? provision.legislationTypeId;
    const lt = legislationTypeMap.get(key);
    const proposed = resolveProvisionPolicyOption(lt, provision);
    const currentId = currentPolicyIdMap.get(key);
    const currentOption = currentId
      ? lt?.policyOptions?.find((option) => option.id === currentId)
      : undefined;

    const proposedLabel = proposed ? resolveOptionLabel(proposed.option) : undefined;
    const currentLabel = currentOption ? resolveOptionLabel(currentOption) : undefined;

    return {
      ...provision,
      ...(proposedLabel
        ? {
            policyOptionNameSnapshot: proposedLabel.name,
            ...(proposedLabel.explanation
              ? { policyOptionExplanationSnapshot: proposedLabel.explanation }
              : {}),
          }
        : {}),
      ...(currentOption ? { currentPolicyOptionIdSnapshot: currentOption.id } : {}),
      ...(currentLabel
        ? {
            currentPolicyOptionNameSnapshot: currentLabel.name,
            ...(currentLabel.explanation
              ? { currentPolicyOptionExplanationSnapshot: currentLabel.explanation }
              : {}),
          }
        : {}),
    };
  });
}
