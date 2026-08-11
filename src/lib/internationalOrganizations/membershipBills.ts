import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Bill, FederalBudget } from "@/lib/db/types";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import type { InternationalOrganizationProvision } from "@/lib/db/types/legislation";
import { isMember, recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getOrganizationProposalsCollection } from "@/lib/db/collections";
import {
  convertLocal,
  creditOrganizationFund,
  resolveOrgFundCurrencyCountry,
} from "./organizationFund";
import { removeOrganizationMembership } from "./withdrawalBills";
import { resolveJoinApplication } from "./joinApplication";

/**
 * Enactment effects for the `international_organization` bill provision. Each
 * sub-type's effect runs when the domestic bill passes (dispatched from
 * `applyLegislationEffect`).
 */

/**
 * Fund provision: send `amountLocal` from the country's treasury to the org's
 * pooled fund (FX to USD, no cost). Members-only — voids if the country left the
 * org before enactment. Spends into debt if the treasury can't cover it (the
 * treasury turn resyncs the debt mirror), matching the dues/aid money-flow pattern.
 */
export async function applyOrgFundProvision(
  db: Db,
  countryId: CountryId,
  p: InternationalOrganizationProvision
): Promise<void> {
  const amountLocal = p.amountLocal ?? 0;
  if (!(amountLocal > 0)) return;
  const turn = await getCurrentTurn(db);
  if (!(await isMember(db, p.organizationId, countryId))) {
    await recordOrgHistoryEvent(
      db,
      countryId,
      turn,
      `${COUNTRY_CONFIGS[countryId].name}'s funding for ${p.organizationName} was voided — no longer a member.`,
      { organizationId: p.organizationId }
    );
    return;
  }
  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne(
      { countryId },
      { $inc: { treasuryBalance: -amountLocal }, $set: { updatedAt: new Date() } }
    );
  // Credit the fund in its (founding) currency, converted from the member's.
  const fundCountry = await resolveOrgFundCurrencyCountry(db, p.organizationId);
  const amountFund = convertLocal(countryId, fundCountry, amountLocal, await loadWorldPreset(db));
  await creditOrganizationFund(db, p.organizationId, amountFund);
  const fundCurrency = COUNTRY_CONFIGS[fundCountry]?.currencyCode ?? "USD";
  await recordOrgHistoryEvent(
    db,
    countryId,
    turn,
    `${COUNTRY_CONFIGS[countryId].name} funded ${p.organizationName} (${amountFund.toLocaleString()} ${fundCurrency}).`,
    { organizationId: p.organizationId }
  );
}

/**
 * Leave provision: domestic ratification of withdrawal. On enactment, remove the
 * country's membership (and its leadership/agreements) via the shared
 * `removeOrganizationMembership` helper — the same logic the legacy
 * `internationalAction` leave path uses.
 */
export async function applyOrgLeaveProvision(
  db: Db,
  _bill: Pick<Bill, "_id" | "countryId">,
  countryId: CountryId,
  p: InternationalOrganizationProvision
): Promise<void> {
  const turn = await getCurrentTurn(db);
  await removeOrganizationMembership(db, countryId, p.organizationId, p.organizationName, turn);
}

/**
 * Join provision: domestic ratification of an application. On enactment, mark the
 * linked membership proposal's domestic gate approved and let the arbiter decide
 * (admit if the member vote has also passed; otherwise wait for it).
 */
export async function applyOrgJoinProvision(
  db: Db,
  _bill: Pick<Bill, "_id" | "countryId">,
  p: InternationalOrganizationProvision
): Promise<void> {
  if (!p.membershipProposalId) return;
  const turn = await getCurrentTurn(db);
  const proposals = await getOrganizationProposalsCollection(db);
  await proposals.updateOne({ _id: p.membershipProposalId }, { $set: { domesticApproved: true } });
  await resolveJoinApplication(db, p.membershipProposalId, turn);
}
