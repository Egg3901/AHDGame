/**
 * Who is in whose group, resolved for every corporation in one pass.
 *
 * `controlledGroupIds` (merger review) answers this for ONE root and scans the
 * corporation set to do it. The turn phase needs every group at once, so this
 * does the same walk once and returns the whole mapping rather than being
 * called in a loop.
 *
 * A group edge requires BOTH halves of the relationship:
 *  - the parent controls >50% of voting power (de facto control), and
 *  - the child is a FORMALIZED subsidiary.
 *
 * De facto control alone is not a group for tax. Formalization is an explicit
 * act the parent already has to take, and making relief depend on it means the
 * same declaration that buys the tax benefit is the one that makes the group
 * legible to merger review and to everyone reading the corporation page.
 */

import type { Db } from "mongodb";
import {
  corporationWithReservedHoldings,
  loadReservedCorporatePositionsByTarget,
} from "@/lib/corporations/reservedCorporateHoldings";
import type { Corporation } from "@/lib/db/types";
import { resolveMembershipRows } from "./rules/membership";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";

export type { GroupMembership } from "./rules/membership";
import type { GroupMembership } from "./rules/membership";

export type GroupCorpRow = Pick<
  Corporation,
  "_id" | "shareholders" | "totalShares" | "superShareMultiplier" | "subsidiaryFormalizedAtTurn"
>;

/** Resolve every corporate group in the world. */
export async function resolveFormalizedGroups(
  db: Db,
  options: { includeReserved?: boolean; includeControl?: boolean } = {}
): Promise<
  GroupMembership & {
    parentControlByCorpId: Map<string, { corporationId: string; votingPercent: number }>;
  }
> {
  const corps = (await db
    .collection<Corporation>("corporations")
    .find(
      {},
      {
        projection: {
          ...(options.includeReserved
            ? { countryOwnerId: 1, suspended: 1, ceoVacant: 1, ceoId: 1 }
            : {}),
          shareholders: 1,
          totalShares: 1,
          superShareMultiplier: 1,
          subsidiaryFormalizedAtTurn: 1,
        },
      }
    )
    .toArray()) as GroupCorpRow[];

  // Read surfaces must agree with parent authorization while a control block is listed for sale.
  // Existing turn callers retain their established loading path; no extra reads when omitted.
  const reserved = options.includeReserved
    ? await loadReservedCorporatePositionsByTarget(db)
    : null;
  const effectiveCorps = corps.map((corp) =>
    corporationWithReservedHoldings(corp as Corporation, reserved?.get(corp._id.toString()) ?? [])
  );
  const groups = resolveGroupRows(effectiveCorps);
  const parentControlByCorpId = new Map<string, { corporationId: string; votingPercent: number }>();
  for (const corp of options.includeControl ? effectiveCorps : []) {
    const parent = getControllingCorporateParent(corp);
    if (parent)
      parentControlByCorpId.set(corp._id.toString(), {
        corporationId: parent.corporationId.toString(),
        votingPercent: parent.ownershipPct,
      });
  }
  if (options.includeReserved) {
    groups.eligibleManagementRoots = new Set(
      corps
        .filter((row) => {
          const c = row as Corporation;
          return (
            groups.membersByRootId.has(c._id.toString()) &&
            c.subsidiaryFormalizedAtTurn == null &&
            !c.countryOwnerId &&
            !c.suspended &&
            !c.ceoVacant &&
            !!c.ceoId
          );
        })
        .map((c) => c._id.toString())
    );
  }
  return { ...groups, parentControlByCorpId };
}

/** Adapt loaded Mongo identities to the portable membership rules. */
export function resolveGroupRows(corps: readonly GroupCorpRow[]): GroupMembership {
  return resolveMembershipRows(
    corps.map((c) => ({
      id: c._id.toString(),
      formalized: c.subsidiaryFormalizedAtTurn != null,
      parentId: getControllingCorporateParent(c as Corporation)?.corporationId.toString(),
    }))
  );
}
