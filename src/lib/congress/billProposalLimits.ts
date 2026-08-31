/**
 * Bill proposal limitation checks shared across all four bill-proposal routes.
 *
 * Constraint 1: One active bill per sponsor (per legislative body)
 * Constraint 2: No duplicate provision at same policy option level across active bills
 * Constraint 3: No proposing the current active policy level (no-op bills)
 */
import type { Db } from "mongodb";
import type { Bill, LegislationType, GovernorExecutiveOrder } from "@/lib/db/types";
import type { StateBill } from "@/lib/db/types/stateBill";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { ObjectId } from "mongodb";
import { inferCountryIdFromStateId } from "@/lib/congress/resolveBillCountryId";
import { regionalDefaultLevel } from "@/lib/politicalLegislation/regionalDefaults";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
  humanizeLegislationTypeId,
} from "@/lib/legislationTypeAliases";

export interface PolicyProvisionInput {
  legislationTypeId: string;
  policyOptionId?: string;
}

export interface LimitationError {
  error: string;
}

/** Terminal statuses for national bills — bill is no longer in-flight */
export const NATIONAL_TERMINAL_STATUSES: Bill["status"][] = [
  "failed",
  "withdrawn",
  "signed",
  "override_failed",
];

/** Terminal statuses for state bills */
export const STATE_TERMINAL_STATUSES: StateBill["status"][] = [
  "failed",
  "signed",
  "enacted",
  "override_failed",
];

/**
 * Constraint 2: Check whether any active bill in the same legislative body
 * already has a provision proposing the same legislationTypeId + policyOptionId.
 *
 * @param collectionName - "bills" or "stateBills"
 * @param activeBillFilter - Mongo filter scoping to the correct legislative body + non-terminal status
 * @param proposedProvisions - The policy provisions the user wants to add
 */
export async function checkDuplicateProvisions(
  db: Db,
  collectionName: "bills" | "stateBills",
  activeBillFilter: Record<string, unknown>,
  proposedProvisions: PolicyProvisionInput[]
): Promise<LimitationError | null> {
  // Only check provisions that have a policyOptionId
  const provisionsToCheck = proposedProvisions.filter((p) => p.policyOptionId);
  if (provisionsToCheck.length === 0) return null;

  const activeBills = await db
    .collection(collectionName)
    .find(activeBillFilter, {
      projection: { provisions: 1, legislationTypeId: 1 },
    })
    .toArray();

  // Build a set of "legislationTypeId:policyOptionId" keys from all active bills
  const activeProvisionKeys = new Set<string>();
  for (const bill of activeBills) {
    const provisions = (bill as Record<string, unknown>).provisions as
      { legislationTypeId?: string; policyOptionId?: string; type?: string }[] | undefined;
    if (!provisions) continue;
    for (const p of provisions) {
      // Only check policy provisions (not tariff/subsidy/nationalize/privatize/embargo)
      if (
        p.type === "tariff" ||
        p.type === "subsidy" ||
        p.type === "end_subsidy" ||
        p.type === "nationalize" ||
        p.type === "privatize" ||
        p.type === "designate_strategic_sector" ||
        p.type === "embargo" ||
        p.type === "end_embargo"
      )
        continue;
      if (p.legislationTypeId && p.policyOptionId) {
        const canonicalId =
          canonicalizeLegislationTypeId(p.legislationTypeId) ?? p.legislationTypeId;
        activeProvisionKeys.add(`${canonicalId}:${p.policyOptionId}`);
      }
    }
  }

  // Check each proposed provision against the set
  for (const provision of provisionsToCheck) {
    const canonicalId =
      canonicalizeLegislationTypeId(provision.legislationTypeId) ?? provision.legislationTypeId;
    const key = `${canonicalId}:${provision.policyOptionId}`;
    if (activeProvisionKeys.has(key)) {
      // Look up the legislation type name for a user-friendly error
      const lt = await db
        .collection<LegislationType>("legislationTypes")
        .findOne(
          { _id: { $in: getEquivalentLegislationTypeIds(provision.legislationTypeId) } },
          { projection: { name: 1 } }
        );
      const name =
        lt?.name ??
        humanizeLegislationTypeId(provision.legislationTypeId) ??
        provision.legislationTypeId;
      return {
        error: `Another active bill already proposes ${name} at this policy level. Wait for it to resolve before proposing the same change.`,
      };
    }
  }

  return null;
}

export interface TariffProvisionInput {
  scopeType: "economy_wide" | "sector" | "origin_country" | "corporation";
  targetSectorType?: string;
  targetOriginCountryId?: string;
  // Callers may pass either a string or an ObjectId (serialized vs raw DB type)
  targetCorporationId?: string | { toString(): string };
}

/**
 * Constraint: Check whether any active bill in the same legislative body already
 * proposes a tariff at the same (scopeType, target) so two in-flight bills cannot
 * race to set the same tariff. Caller passes `activeBillFilter` scoping to the
 * correct legislative body and non-terminal status.
 *
 * Match key: (scopeType, targetSectorType ?? null, targetOriginCountryId ?? null,
 * targetCorporationId ?? null). Different scopes do not collide with each other —
 * an economy-wide tariff does not conflict with a sector-specific one.
 */
export async function checkDuplicateTariffProvisions(
  db: Db,
  collectionName: "bills" | "stateBills",
  activeBillFilter: Record<string, unknown>,
  proposedTariffs: TariffProvisionInput[]
): Promise<LimitationError | null> {
  if (proposedTariffs.length === 0) return null;

  const activeBills = await db
    .collection(collectionName)
    .find(activeBillFilter, { projection: { provisions: 1 } })
    .toArray();

  const activeTariffKeys = new Set<string>();
  for (const bill of activeBills) {
    const provisions = (bill as Record<string, unknown>).provisions as
      | {
          type?: string;
          scopeType?: string;
          targetSectorType?: string;
          targetOriginCountryId?: string;
          targetCorporationId?: string;
        }[]
      | undefined;
    if (!provisions) continue;
    for (const p of provisions) {
      if (p.type !== "tariff") continue;
      activeTariffKeys.add(tariffKey(p));
    }
  }

  for (const t of proposedTariffs) {
    if (activeTariffKeys.has(tariffKey(t))) {
      return {
        error:
          "Another active bill already proposes a tariff at this scope. Wait for it to resolve before proposing the same change.",
      };
    }
  }

  return null;
}

function tariffKey(p: {
  scopeType?: string;
  targetSectorType?: string;
  targetOriginCountryId?: string;
  targetCorporationId?: string | { toString(): string };
}): string {
  return [
    p.scopeType ?? "",
    p.targetSectorType ?? "",
    p.targetOriginCountryId ?? "",
    p.targetCorporationId ? p.targetCorporationId.toString() : "",
  ].join("|");
}

/**
 * Constraint 3: Check whether any proposed provision sets a law to its current active level.
 *
 * Checks statePolicies first (primary source), then falls back to the most recent
 * non-repealed enactedLaw for legislation types not found in statePolicies.
 *
 * @param policyStoreId - The stateId used in the statePolicies collection
 *   ("federal" for US Congress, "{countryId}_national" for international parliament,
 *    or the actual stateId for state/regional bills)
 * @param proposedProvisions - The policy provisions the user wants to add
 */
export async function checkCurrentPolicyLevel(
  db: Db,
  policyStoreId: string,
  proposedProvisions: PolicyProvisionInput[]
): Promise<LimitationError | null> {
  // Only check provisions that have a policyOptionId
  const provisionsToCheck = proposedProvisions.filter((p) => p.policyOptionId);
  if (provisionsToCheck.length === 0) return null;

  const canonicalLegTypeIds = [
    ...new Set(
      provisionsToCheck
        .map((p) => canonicalizeLegislationTypeId(p.legislationTypeId))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const legTypeIds = [
    ...new Set(canonicalLegTypeIds.flatMap((id) => getEquivalentLegislationTypeIds(id))),
  ];

  // Primary: check statePolicies
  const currentPolicies = await db
    .collection<StatePolicy>("statePolicies")
    .find({ stateId: policyStoreId, legislationTypeId: { $in: legTypeIds } })
    .toArray();

  // Executive orders are temporary — for bill-proposal purposes the "current
  // law" is the pre-order base. Fetch the orders for any order-enacted rows
  // and substitute their policyOptionIdBefore.
  const orderIds = currentPolicies
    .map((p) => (p.enactedBy?.kind === "order" ? p.enactedBy.id : null))
    .filter((id): id is ObjectId => id != null);
  const orderById = orderIds.length
    ? new Map(
        (
          await db
            .collection<GovernorExecutiveOrder>("governorExecutiveOrders")
            .find({ _id: { $in: orderIds } })
            .toArray()
        ).map((o) => [o._id!.toString(), o])
      )
    : new Map<string, GovernorExecutiveOrder>();

  const policyMap = new Map<string, string>();
  for (const policy of currentPolicies) {
    const canonicalId = canonicalizeLegislationTypeId(policy.legislationTypeId);
    if (!canonicalId) continue;
    if (!policyMap.has(canonicalId) || policy.legislationTypeId === canonicalId) {
      const order =
        policy.enactedBy?.kind === "order" ? orderById.get(policy.enactedBy.id.toString()) : null;
      // Substitute the pre-order base when the row is order-enacted and the
      // order recorded a before-id; otherwise use the current option as-is.
      const effectiveOptionId =
        order && order.policyOptionIdBefore ? order.policyOptionIdBefore : policy.policyOptionId;
      policyMap.set(canonicalId, effectiveOptionId);
    }
  }

  // Fallback: for types missing from statePolicies, check the most recent enacted law.
  // Resolve countryId from the policyStoreId for enacted law lookups.
  const missingTypeIds = canonicalLegTypeIds.filter((id) => !policyMap.has(id));
  if (missingTypeIds.length > 0) {
    const countryId = inferCountryIdFromStateId(policyStoreId);
    const enactedLawFilter: Record<string, unknown> = {
      legislationTypeId: {
        $in: missingTypeIds.flatMap((id) => getEquivalentLegislationTypeIds(id)),
      },
      repealedAt: { $exists: false },
    };
    if (countryId) {
      enactedLawFilter.scope = "national";
      enactedLawFilter.countryId = countryId;
    } else {
      enactedLawFilter.scope = "state";
      enactedLawFilter.stateId = policyStoreId;
    }

    // Fetch enacted laws sorted by enactedAt desc — only the most recent per type matters
    const enactedLaws = await db
      .collection<EnactedLaw>("enactedLaws")
      .find(enactedLawFilter)
      .sort({ enactedAt: -1 })
      .toArray();

    // Deduplicate: keep only the most recent per legislationTypeId
    const seenTypes = new Set<string>();
    const lawsNeedingOption: EnactedLaw[] = [];
    for (const law of enactedLaws) {
      if (seenTypes.has(law.legislationTypeId)) continue;
      seenTypes.add(law.legislationTypeId);
      if (law.policyOptionIndex !== undefined) lawsNeedingOption.push(law);
    }

    // One batched fetch for every legislation type the deduped laws reference.
    // This was a findOne per law — an N+1 over the enacted-law set on a path
    // that runs whenever a player proposes a bill.
    if (lawsNeedingOption.length > 0) {
      const equivalentIds = [
        ...new Set(
          lawsNeedingOption.flatMap((law) => getEquivalentLegislationTypeIds(law.legislationTypeId))
        ),
      ];
      const legislationTypeDocs = await db
        .collection<LegislationType>("legislationTypes")
        .find({ _id: { $in: equivalentIds } }, { projection: { policyOptions: 1 } })
        .toArray();
      const byId = new Map(legislationTypeDocs.map((lt) => [lt._id, lt]));

      for (const law of lawsNeedingOption) {
        // First existing equivalent wins, mirroring the single-doc $in lookup
        // this replaces (and deterministic where that was natural-order).
        const lt = getEquivalentLegislationTypeIds(law.legislationTypeId)
          .map((id) => byId.get(id))
          .find((doc) => doc !== undefined);
        const opt = lt?.policyOptions?.[law.policyOptionIndex!];
        if (opt?.id) {
          const canonicalId = canonicalizeLegislationTypeId(law.legislationTypeId);
          if (canonicalId) policyMap.set(canonicalId, opt.id);
        }
      }
    }

    // Region scope only (a resolvable countryId means the store is national):
    // a new-generation `both` law the region has never legislated sits at level
    // 0. The propose modal already disables that option — /api/game/current-
    // policies reports the same default — so without this the API would accept
    // a no-op bill the UI refuses to build.
    if (!countryId) {
      const defaulted = canonicalLegTypeIds
        .filter((id) => !policyMap.has(id))
        .map((id) => ({ id, level: regionalDefaultLevel(id) }))
        .filter((entry): entry is { id: string; level: number } => entry.level !== undefined);
      if (defaulted.length > 0) {
        // One batched fetch, not a findOne per law — the same N+1 the enacted-law
        // lookup above was rewritten to avoid, on the same propose hot path.
        const docs = await db
          .collection<LegislationType>("legislationTypes")
          .find(
            { _id: { $in: defaulted.map((entry) => entry.id) } },
            { projection: { policyOptions: 1 } }
          )
          .toArray();
        const byId = new Map(docs.map((doc) => [doc._id, doc]));
        for (const { id, level } of defaulted) {
          const opt = byId.get(id)?.policyOptions?.[level];
          if (opt?.id) policyMap.set(id, opt.id);
        }
      }
    }
  }

  for (const provision of provisionsToCheck) {
    const canonicalId =
      canonicalizeLegislationTypeId(provision.legislationTypeId) ?? provision.legislationTypeId;
    const currentOptionId = policyMap.get(canonicalId);
    if (currentOptionId && currentOptionId === provision.policyOptionId) {
      const lt = await db
        .collection<LegislationType>("legislationTypes")
        .findOne(
          { _id: { $in: getEquivalentLegislationTypeIds(provision.legislationTypeId) } },
          { projection: { name: 1 } }
        );
      const name =
        lt?.name ??
        humanizeLegislationTypeId(provision.legislationTypeId) ??
        provision.legislationTypeId;
      return {
        error: `The current law for ${name} is already at this level. Propose a different level.`,
      };
    }
  }

  return null;
}
