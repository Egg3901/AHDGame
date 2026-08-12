import { type Db, ObjectId } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  getOrganizationLeadershipCollection,
  getOrganizationLeadershipElectionsCollection,
  getOrganizationLegislationCollection,
  getOrganizationMembershipsCollection,
} from "@/lib/db/collections";
import type { Bill, BillInternationalAction, OrganizationLegislation } from "@/lib/db/types";
import { recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";
import { recordOrganizationWithdrawal } from "@/lib/internationalOrganizations/withdrawalTombstone";
import { fireFtaRescissionSentiment } from "@/lib/tariffs/tariffEffects";

function inferCountryIdFromBill(bill: Pick<Bill, "countryId" | "stateId">): CountryId | null {
  if (bill.countryId) return bill.countryId;
  if (bill.stateId?.startsWith("uk_")) return "UK";
  if (bill.stateId?.startsWith("jp_")) return "JP";
  if (bill.stateId?.startsWith("de_")) return "DE";
  if (bill.stateId?.startsWith("us_") || bill.stateId === "federal") return "US";
  return null;
}

export function billRequiresExecutiveAction(
  bill: Pick<Bill, "countryId" | "stateId" | "internationalAction" | "provisions">
): boolean {
  const countryId = inferCountryIdFromBill(bill);
  if (!countryId) return true;
  // Presidential systems route passed bills to the president's desk;
  // parliamentary/one-party systems enact directly. Keying on country id
  // ("US only") silently skipped the signature stage for other presidential
  // countries — NG bills enacted instantly with no sign/veto (ticket #923).
  if (COUNTRY_CONFIGS[countryId].governmentType !== "presidential") return false;
  // International-org actions (legacy internationalAction OR the new provision)
  // auto-resolve — they don't go through executive action.
  const hasIntOrgProvision = bill.provisions?.some((p) => p.type === "international_organization");
  // A declaration of war is introduced BY the executive and ratified by the
  // chambers, so returning it to that same executive to sign would be a no-op --
  // and it would put two different two-thirds rules on one bill (two-thirds of
  // votes cast to pass, two-thirds of seats to override a veto).
  const hasDeclareWar = bill.provisions?.some((p) => p.type === "declare_war");
  // Entry at a bloc's call is the same shape: the chambers ratify a decision the
  // executive already stands behind, so there is no separate assent stage to
  // return it to. The return expression must consume this — the declaration
  // alone is inert.
  const hasJoinConflict = bill.provisions?.some((p) => p.type === "join_conflict");
  return !bill.internationalAction && !hasIntOrgProvision && !hasDeclareWar && !hasJoinConflict;
}

export function getInternationalActionLabel(action: BillInternationalAction): string {
  return action.type === "leave_free_trade_agreement"
    ? "FTA Withdrawal"
    : "Organization Withdrawal";
}

export function getInternationalActionSummary(action: BillInternationalAction): string {
  const countryName = COUNTRY_CONFIGS[action.targetCountryId]?.name ?? action.targetCountryId;
  if (action.type === "leave_free_trade_agreement") {
    const agreementName =
      action.organizationLegislationTitle ?? `${action.organizationName} free-trade agreement`;
    return `${countryName} would withdraw from ${agreementName}.`;
  }
  return `${countryName} would withdraw from ${action.organizationName}.`;
}

export function getInternationalActionDetail(action: BillInternationalAction): string {
  const countryName = COUNTRY_CONFIGS[action.targetCountryId]?.name ?? action.targetCountryId;
  if (action.type === "leave_free_trade_agreement") {
    return `${countryName} would leave the agreement while the remaining parties keep any valid continuation in force.`;
  }
  return `${countryName} would leave the organization and automatically exit any associated agreements hosted there.`;
}

function uniqueParties(parties: CountryId[] | undefined): CountryId[] {
  return [...new Set((parties ?? []).filter(Boolean))];
}

async function updateOrganizationLegislationForWithdrawal(
  db: Db,
  legislation: OrganizationLegislation,
  withdrawingCountryId: CountryId,
  now: Date,
  currentTurn: number
): Promise<void> {
  const legislationCol = await getOrganizationLegislationCollection(db);
  const originalParties = uniqueParties(legislation.parties as CountryId[]);
  if (!originalParties.includes(withdrawingCountryId)) return;

  // Snapshot pre-update state so the rescission-sentiment hook below knows
  // whether the withdrawal actually flipped any FTA pair coverage.
  const wasActiveFta =
    legislation.type === "free_trade_agreement" && legislation.status === "active";

  const remainingParties = originalParties.filter((partyId) => partyId !== withdrawingCountryId);
  const withdrawingCountryName =
    COUNTRY_CONFIGS[withdrawingCountryId]?.name ?? withdrawingCountryId;

  if (remainingParties.length >= 2) {
    await legislationCol.updateOne(
      { _id: legislation._id },
      {
        $set: {
          parties: remainingParties,
        },
      }
    );

    for (const partyId of originalParties) {
      const remainingNames = remainingParties
        .map((remainingPartyId) => COUNTRY_CONFIGS[remainingPartyId]?.name ?? remainingPartyId)
        .join(", ");
      const title =
        partyId === withdrawingCountryId
          ? `${withdrawingCountryName} withdrew from ${legislation.title}.`
          : `${withdrawingCountryName} withdrew from ${legislation.title}; the agreement remains in force for ${remainingNames}.`;
      await recordOrgHistoryEvent(db, partyId, currentTurn, title, {
        organizationId: legislation.organizationId,
        legislationId: legislation._id.toString(),
        parties: remainingParties,
      });
    }
  } else {
    await legislationCol.updateOne(
      { _id: legislation._id },
      {
        $set: {
          status: "terminated",
          terminatedAt: now,
        },
      }
    );

    for (const partyId of originalParties) {
      await recordOrgHistoryEvent(
        db,
        partyId,
        currentTurn,
        `${withdrawingCountryName}'s withdrawal terminated ${legislation.title}.`,
        {
          organizationId: legislation.organizationId,
          legislationId: legislation._id.toString(),
        }
      );
    }
  }

  // Sentiment shock from severing FTA coverage. Mirrors the bill-enactment
  // pulse fire: exactly one place in the code emits sector-tariff sentiment,
  // and rescission is the only "policy event" symmetric to enactment that the
  // sentiment system needs an explicit hook for. Margins / inflation / blend
  // re-derive from the now-current FTA pair set automatically; sentiment is
  // event-based with TTL so it can't passively pick up a state change.
  //
  // Fire pulses for every original party so each country whose tariff exposure
  // toward (now-) non-partners has changed gets a fresh foreign-side sentiment
  // hit. The pulse-application FTA filter (`pulseAppliesToCorp`) reads the
  // post-update FTA pair set and correctly suppresses pulses for any pair that
  // remains covered by another active FTA — only newly-exposed (and already-
  // non-partner) corps see the dip.
  if (wasActiveFta) {
    await Promise.all(originalParties.map((partyId) => fireFtaRescissionSentiment(db, partyId)));
  }
}

async function applyFreeTradeAgreementWithdrawal(
  db: Db,
  action: BillInternationalAction,
  now: Date,
  currentTurn: number
): Promise<void> {
  if (!action.organizationLegislationId) return;

  const legislationCol = await getOrganizationLegislationCollection(db);
  const legislation = await legislationCol.findOne({
    _id: new ObjectId(action.organizationLegislationId),
  });
  if (!legislation) return;

  await updateOrganizationLegislationForWithdrawal(
    db,
    legislation,
    action.targetCountryId,
    now,
    currentTurn
  );
}

/**
 * Remove a country's membership in an organization and clean up the fallout:
 * drop the membership doc, withdraw it from any org-hosted agreements, clear any
 * leadership seat / pending elections it holds, and record history for the
 * departing country + remaining members. Shared by the legacy
 * `internationalAction` leave path and the `international_organization` leave
 * provision so both behave identically.
 */
export async function removeOrganizationMembership(
  db: Db,
  targetCountryId: CountryId,
  organizationId: string,
  organizationName: string,
  currentTurn: number,
  now: Date = new Date()
): Promise<void> {
  const membershipsCol = await getOrganizationMembershipsCollection(db);
  const leadershipCol = await getOrganizationLeadershipCollection(db);
  const leadershipElectionsCol = await getOrganizationLeadershipElectionsCollection(db);
  const legislationCol = await getOrganizationLegislationCollection(db);

  const existingMembers = await membershipsCol
    .find({ organizationId }, { projection: { countryId: 1 } })
    .toArray();
  const memberCountryIds = existingMembers.map((member) => member.countryId as CountryId);
  const remainingMemberCountryIds = memberCountryIds.filter(
    (countryId) => countryId !== targetCountryId
  );

  await membershipsCol.deleteOne({ organizationId, countryId: targetCountryId });

  // Tombstone the departure so the founding-member self-heal doesn't re-add a
  // founder that deliberately left (the root cause of "DE keeps re-joining NATO").
  await recordOrganizationWithdrawal(db, organizationId, targetCountryId, currentTurn, now);

  const affectedLegislation = await legislationCol
    .find({
      organizationId,
      parties: targetCountryId,
      status: { $in: ["pending", "active"] },
    })
    .toArray();

  for (const legislation of affectedLegislation) {
    await updateOrganizationLegislationForWithdrawal(
      db,
      legislation,
      targetCountryId,
      now,
      currentTurn
    );
  }

  await leadershipCol.updateOne(
    { organizationId, holderCountryId: targetCountryId },
    {
      $set: {
        holderCharacterId: null,
        holderCharacterName: null,
        holderCountryId: null,
        electedAt: null,
        electedOnTurn: null,
        termEndsOnTurn: null,
        updatedAt: now,
      },
    }
  );

  await leadershipElectionsCol.updateMany(
    {
      organizationId,
      status: "pending",
      $or: [{ candidateCountryId: targetCountryId }, { nominatedByCountryId: targetCountryId }],
    },
    {
      $set: {
        status: "rejected",
        resolvedAt: now,
        resolvedOnTurn: currentTurn,
      },
    }
  );

  const withdrawingCountryName = COUNTRY_CONFIGS[targetCountryId]?.name ?? targetCountryId;

  await recordOrgHistoryEvent(
    db,
    targetCountryId,
    currentTurn,
    `${withdrawingCountryName} withdrew from ${organizationName}.`,
    { organizationId }
  );

  for (const memberCountryId of remainingMemberCountryIds) {
    await recordOrgHistoryEvent(
      db,
      memberCountryId,
      currentTurn,
      `${withdrawingCountryName} withdrew from ${organizationName}.`,
      { organizationId }
    );
  }
}

async function applyOrganizationWithdrawal(
  db: Db,
  action: BillInternationalAction,
  now: Date,
  currentTurn: number
): Promise<void> {
  await removeOrganizationMembership(
    db,
    action.targetCountryId,
    action.organizationId,
    action.organizationName,
    currentTurn,
    now
  );
}

export async function applyInternationalWithdrawalMeasure(
  db: Db,
  bill: Pick<Bill, "internationalAction">,
  currentTurn: number,
  now: Date = new Date()
): Promise<boolean> {
  const action = bill.internationalAction;
  if (!action) return false;

  if (action.type === "leave_free_trade_agreement") {
    await applyFreeTradeAgreementWithdrawal(db, action, now, currentTurn);
    return true;
  }

  await applyOrganizationWithdrawal(db, action, now, currentTurn);
  return true;
}
