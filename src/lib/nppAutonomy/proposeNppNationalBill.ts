/**
 * proposeNppNationalBill — slimmed bill-proposal command for autonomous NPP sponsorship (SP2).
 *
 * This is a stripped sibling of proposeNationalBill.ts. It reuses the same provision
 * integrity guards but drops the character economy entirely (no AP/NPI spend, no
 * character lookup, no election-risk auto-fail gate).
 */

import { getNationalDocId } from "@/lib/constants/nationalScope";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types";
import type { Bill, BillChamber, ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import {
  checkDuplicateProvisions,
  checkCurrentPolicyLevel,
  NATIONAL_TERMINAL_STATUSES,
} from "@/lib/congress/billProposalLimits";
import { snapshotBillPolicyProvisions } from "@/lib/congress/billProposal";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  resolveTaxSliderProvisionFields,
  taxSliderNotchRate,
} from "@/lib/politicalLegislation/taxSlider";
import { buildActiveNationalBillFilter } from "@/lib/legislature/nationalBillScope";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { getChamberKeyForOfficeType } from "@/lib/legislature/chamberOfficeType";
import { CATEGORY_TO_POLICY_DOMAINS } from "@shared/constants/legislation";
import { NPP_BILL_VOTING_DURATION_HOURS } from "./constants";
import type { NppBillSelection } from "./selectNppBill";
import type { BillStatus } from "@/lib/db/types/legislation";

const VOTING_DURATION_HOURS = NPP_BILL_VOTING_DURATION_HOURS;

// Reverse of CATEGORY_TO_POLICY_DOMAINS: policyDomain -> bill category. Built once
// at module load so an NPP-sponsored bill carries the same `category` a player bill
// would, keeping it visible to the address-agenda cross-pressure path (billVoting.ts).
const POLICY_DOMAIN_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_TO_POLICY_DOMAINS).flatMap(([category, domains]) =>
    (domains ?? []).map((domain) => [domain, category])
  )
);

export interface ProposeNppBillResult {
  ok: true;
  billId: string;
}

export interface ProposeNppBillError {
  ok: false;
  reason: string;
}

/**
 * Insert an nppSponsored national bill into the bills collection.
 *
 * @param db - Live Mongo database.
 * @param countryId - The country in which to file the bill.
 * @param npp - The NPP organisation sponsoring the bill.
 * @param sponsorOfficial - A seated lower-chamber NPP official who will be the named sponsor.
 * @param selection - Output from selectNppBill: the chosen legislation type + policy option.
 * @param currentTurn - Current game-clock turn (used to set votingEndsOnTurn).
 * @param now - Wall-clock time for the proposal.
 */
export async function proposeNppNationalBill(
  db: Db,
  countryId: CountryId,
  npp: NPP,
  sponsorOfficial: ElectedOfficial,
  selection: NppBillSelection,
  currentTurn: number,
  now: Date
): Promise<ProposeNppBillResult | ProposeNppBillError> {
  const config = COUNTRY_CONFIGS[countryId];

  // ── One-party-state banned-party guard ─────────────────────────────────────
  const runtimeState = await getCountryState(db, countryId);
  if (runtimeState.governmentType === "onePartyState" && npp.party) {
    const sponsorParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parseInt(npp.party, 10), countryId });
    if (isBannedParty(config, sponsorParty)) {
      return { ok: false, reason: "Banned parties cannot propose legislation." };
    }
  }

  // ── Chamber key for the sponsor official ──────────────────────────────────
  const sponsorChamberKey = getChamberKeyForOfficeType(countryId, sponsorOfficial.officeType);
  const chamberKey = sponsorChamberKey as BillChamber;

  // ── Build provision for the selected policy option ────────────────────────
  const { legType, option } = selection;

  let rawProvision: {
    legislationTypeId: string;
    policyOptionId: string;
    effectDirection: number;
    economic: number;
    social: number;
    proposedRate?: number;
    policyOptionNameSnapshot?: string;
    currentPolicyOptionNameSnapshot?: string;
  } = {
    legislationTypeId: legType._id,
    policyOptionId: option.id,
    effectDirection: option.effectDirection,
    economic: option.economic,
    social: option.social,
  };

  // Tax-slider laws (ruling #16): the selection carries only a DIRECTION —
  // resolve the concrete rate (one notch) against the live budget and run the
  // same server-side validation players go through. Bounds-blocked or
  // sub-step moves simply skip this sponsorship attempt.
  if (legType.taxSlider && selection.taxSliderDirection) {
    const budgetId = getNationalBudgetId(countryId);
    const budget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: budgetId }, { projection: { taxRates: 1 } });
    const currentRate =
      (budget?.taxRates as Record<string, number> | undefined)?.[legType.taxSlider.taxType] ??
      legType.taxSlider.baselineRate;
    const targetRate = taxSliderNotchRate(
      legType.taxSlider,
      currentRate,
      selection.taxSliderDirection
    );
    if (targetRate === null) {
      return { ok: false, reason: "The rate is already at its bound in that direction." };
    }
    const resolved = await resolveTaxSliderProvisionFields(
      db,
      legType,
      targetRate,
      undefined,
      countryId
    );
    if (!resolved.ok) {
      return { ok: false, reason: resolved.error };
    }
    rawProvision = { legislationTypeId: legType._id, ...resolved.fields };
  }

  // ── Duplicate-provision guard ─────────────────────────────────────────────
  const activeBillFilter = buildActiveNationalBillFilter(
    countryId,
    NATIONAL_TERMINAL_STATUSES as BillStatus[]
  );
  const duplicateError = await checkDuplicateProvisions(db, "bills", activeBillFilter, [
    {
      legislationTypeId: rawProvision.legislationTypeId,
      policyOptionId: rawProvision.policyOptionId,
    },
  ]);
  if (duplicateError) {
    return { ok: false, reason: duplicateError.error };
  }

  // ── Current-policy-level guard ────────────────────────────────────────────
  const policyStoreId = getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`;
  const policyLevelError = await checkCurrentPolicyLevel(db, policyStoreId, [
    {
      legislationTypeId: rawProvision.legislationTypeId,
      policyOptionId: rawProvision.policyOptionId,
    },
  ]);
  if (policyLevelError) {
    return { ok: false, reason: policyLevelError.error };
  }

  // ── Snapshot provision labels at proposal time ────────────────────────────
  const snapshottedProvisions = await snapshotBillPolicyProvisions(
    db,
    { scope: "national", countryId },
    [rawProvision]
  );

  const firstPolicy = snapshottedProvisions[0];
  const votingEndsAt = new Date(now.getTime() + VOTING_DURATION_HOURS * 60 * 60 * 1000);
  const votingEndsOnTurn = currentTurn + VOTING_DURATION_HOURS;

  // Derive a human-readable title and summary (slider bills use the resolved
  // rate label — the synthetic scoring option's name is a placeholder).
  const title = `${rawProvision.policyOptionNameSnapshot ?? option.name} — ${legType.name}`;
  const summary = legType.description ?? `${legType.name} policy change proposed by ${npp.name}.`;

  const stateId = getNationalDocId(countryId) ?? `${countryId.toLowerCase()}_national`;

  // Map the legislation type's policy domain back to a bill category so NPP bills
  // match the player-path doc shape (a player bill always carries `category`).
  const category = POLICY_DOMAIN_TO_CATEGORY[legType.policyDomain];

  const bill: Omit<Bill, "_id"> = {
    countryId,
    stateId,
    title,
    summary,
    originChamber: chamberKey,
    currentChamber: chamberKey,
    sponsorId: npp._id,
    sponsorName: npp.name,
    sponsorParty: npp.party ?? undefined,
    ...(category ? { category } : {}),
    nppSponsored: true,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    provisions: snapshottedProvisions,
    ...(firstPolicy && {
      legislationTypeId: firstPolicy.legislationTypeId,
      effectDirection: firstPolicy.effectDirection,
    }),
    proposedAt: now,
    votingStartedAt: now,
    votingEndsAt,
    votingEndsOnTurn,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const result = await db.collection<Omit<Bill, "_id">>("bills").insertOne(bill);
    return { ok: true, billId: result.insertedId.toString() };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `DB insert failed: ${msg}` };
  }
}
