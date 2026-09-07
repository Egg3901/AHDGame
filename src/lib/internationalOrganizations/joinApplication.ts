import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import type { Bill } from "@/lib/db/types";
import type { BillStatus } from "@/lib/db/types/legislation";
import {
  getOrganizationMembershipsCollection,
  getOrganizationProposalsCollection,
} from "@/lib/db/collections";
import {
  isMember,
  loadOrganizationDef,
  recordOrgHistoryEvent,
} from "@/lib/internationalOrganizations/service";
import { removeOrganizationMembership } from "@/lib/internationalOrganizations/withdrawalBills";
import { clearOrganizationWithdrawal } from "@/lib/internationalOrganizations/withdrawalTombstone";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { rivalBlocOrgsFor } from "@/lib/world/blocMembership";

/**
 * Parallel-join coordination. A country is admitted only when BOTH gates pass:
 * the org's unanimous member vote (`orgApproved`) AND the domestic Join bill
 * (`domesticApproved`, read live from the linked bill's status). If either side
 * finishes as a failure, the still-pending counterpart is cancelled with a
 * recorded reason. The arbiter is idempotent — safe to call from the membership
 * turn resolver (which polls it) and the Join bill's enactment effect.
 */

// BillStatus terminal states (legislation.ts): success = "signed" | "veto_override";
// failure = "failed" | "vetoed" | "override_failed" | "withdrawn" | "filibustered".
const BILL_PASSED_STATUSES = new Set<string>(["signed", "veto_override"]);
const BILL_FAILED_STATUS_LIST: BillStatus[] = [
  "failed",
  "vetoed",
  "override_failed",
  "withdrawn",
  "filibustered",
];
const BILL_FAILED_STATUSES = new Set<string>(BILL_FAILED_STATUS_LIST);

/**
 * Admit a country to an org (idempotent upsert of a membership).
 *
 * `WorldEntityId`, not `CountryId`: a proxy war's hosts are world entities — North
 * and South Vietnam are the countries the war is fought over and neither is a
 * playable `CountryId` — and resolving one takes them into the winner's bloc. Every
 * real country id remains a valid value.
 */
export async function admitMember(
  db: Db,
  organizationId: string,
  countryId: WorldEntityId,
  currentTurn: number,
  opts?: { status?: "founding" | "active" }
): Promise<void> {
  await leaveRivalBlocs(db, organizationId, countryId, currentTurn);
  const memberships = await getOrganizationMembershipsCollection(db);
  await memberships.updateOne(
    { organizationId, countryId },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        organizationId,
        countryId,
        // "founding" for empty-org accession — the joiner effectively founds
        // the org; everything else is a normal "active" admission.
        status: opts?.status ?? "active",
        joinedAt: new Date(),
        joinedTurn: currentTurn,
      },
    },
    { upsert: true }
  );
  // Re-joining clears any prior withdrawal tombstone, so a future withdrawal can
  // re-tombstone and the self-heal treats this member as legitimately present.
  await clearOrganizationWithdrawal(db, organizationId, countryId);
}

/**
 * ONE COUNTRY, ONE BLOC. Give up the rival alliance's row before taking this one.
 *
 * Called from `admitMember` rather than from its callers because that is the one
 * chokepoint every accession runs through — the org turn phase, the parallel-join
 * arbiter, a proxy war's prize and the settlement actuation all land here, and a
 * rule enforced at four call sites is a rule that will be missed at the fifth.
 *
 * ⚠️ BEFORE the insert, not after. `loadBlocMembership` writes `out[countryId] =
 * bloc` once per row with no precedence, so a country holding a row in both poles
 * reads as whichever document Mongo happened to return last — its own bloc becomes
 * a coin flip that resolves differently on successive reads, and every military and
 * alignment call downstream reads that map. A throw between the two steps must
 * therefore leave the country in NEITHER pole, which is wrong but deterministic and
 * legible to an admin, rather than in BOTH. `settlement/actuate.ts` reached the same
 * conclusion for reunification and orders its own withdrawal first for this reason.
 *
 * Silent no-op for an org that does not govern accession: joining the UN costs a
 * country nothing it already holds.
 */
async function leaveRivalBlocs(
  db: Db,
  organizationId: string,
  countryId: WorldEntityId,
  currentTurn: number
): Promise<void> {
  // A proxy war's hosts are world entities. North Vietnam holds no alliance rows
  // to give up and is not a `CountryId` the withdrawal path accepts.
  if (!(countryId in COUNTRY_CONFIGS)) return;

  const preset = await getGameStatePresetOrDefault(db);
  for (const rivalId of rivalBlocOrgsFor(preset, organizationId)) {
    // Checked, because `removeOrganizationMembership` writes a withdrawal
    // tombstone and a history line for every remaining member. Calling it for a
    // country that was never in the rival would announce a departure that never
    // happened, and the tombstone would then block a legitimate accession later.
    if (!(await isMember(db, rivalId as Parameters<typeof isMember>[1], countryId as CountryId)))
      continue;
    const def = await loadOrganizationDef(db, rivalId as Parameters<typeof loadOrganizationDef>[1]);
    await removeOrganizationMembership(
      db,
      countryId as CountryId,
      rivalId,
      def?.name ?? rivalId,
      currentTurn
    );
  }
}

/**
 * Decide a parallel-join application from its current state. No-op unless a
 * terminal decision is reachable.
 */
export async function resolveJoinApplication(
  db: Db,
  proposalId: ObjectId,
  currentTurn: number
): Promise<void> {
  const proposals = await getOrganizationProposalsCollection(db);
  const proposal = await proposals.findOne({ _id: proposalId });
  if (!proposal || proposal.status !== "pending") return;

  const organizationId = proposal.organizationId;
  const country = proposal.proposingCountryId as CountryId;
  const countryName = COUNTRY_CONFIGS[country]?.name ?? country;

  // Read the linked Join bill's live status (poll).
  let billStatus: string | undefined;
  if (proposal.domesticBillId) {
    const bill = await db
      .collection<Bill>("bills")
      .findOne({ _id: proposal.domesticBillId }, { projection: { status: 1 } });
    billStatus = bill?.status;
  }

  const orgApproved = proposal.orgApproved === true;
  const orgRejected = proposal.orgApproved === false;
  const domesticApproved =
    proposal.domesticApproved === true ||
    (billStatus ? BILL_PASSED_STATUSES.has(billStatus) : false);
  const domesticFailed =
    proposal.domesticApproved === false ||
    (billStatus ? BILL_FAILED_STATUSES.has(billStatus) : false);

  // Failure on either side → cancel the application + the still-pending counterpart.
  if (orgRejected || domesticFailed) {
    const reason = orgRejected ? "Members declined admission." : "Domestic ratification failed.";
    await proposals.updateOne(
      { _id: proposalId },
      {
        $set: {
          status: "cancelled",
          cancelledReason: reason,
          resolvedAt: new Date(),
          resolvedOnTurn: currentTurn,
        },
      }
    );
    // Cancel the linked bill only if it's still in progress (i.e. the org side failed).
    if (proposal.domesticBillId && !domesticFailed) {
      await db
        .collection<Bill>("bills")
        .updateOne(
          { _id: proposal.domesticBillId, status: { $nin: BILL_FAILED_STATUS_LIST } },
          { $set: { status: "failed", updatedAt: new Date() } }
        );
    }
    await recordOrgHistoryEvent(
      db,
      country,
      currentTurn,
      `${countryName}'s application to ${organizationId} failed: ${reason}`,
      { organizationId, proposalId: proposalId.toString() }
    );
    return;
  }

  // Both gates passed → admit.
  if (orgApproved && domesticApproved) {
    await admitMember(db, organizationId, country, currentTurn, {
      status: proposal.orgVoteExempt ? "founding" : "active",
    });
    await proposals.updateOne(
      { _id: proposalId },
      { $set: { status: "approved", resolvedAt: new Date(), resolvedOnTurn: currentTurn } }
    );
    await recordOrgHistoryEvent(
      db,
      country,
      currentTurn,
      `${countryName} admitted to ${organizationId}.`,
      { organizationId, proposalId: proposalId.toString() }
    );
  }
  // Otherwise one side is still pending — leave the proposal open.
}
