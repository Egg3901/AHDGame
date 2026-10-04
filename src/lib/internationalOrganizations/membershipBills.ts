import {
  organizationCashContext,
  organizationLocalPerAnchor,
  organizationTreasuryLocalPerAnchor,
  settleOrganizationFundedCashMove,
  withOrganizationCashBatch,
  witnessOrganizationCash,
} from "./cashLedger";
import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { Bill, FederalBudget } from "@/lib/db/types";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import type { InternationalOrganizationProvision } from "@/lib/db/types/legislation";
import { isMember, recordOrgHistoryEvent } from "@/lib/internationalOrganizations/service";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  getOrganizationFundsCollection,
  getOrganizationProposalsCollection,
} from "@/lib/db/collections";
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
  p: InternationalOrganizationProvision,
  billId?: string
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
  const context = await organizationCashContext(db, { turn });
  const { fundCountry, amountFund } = await withOrganizationCashBatch(
    db,
    context,
    async (batch) => {
      if (batch?.treasuryCashLedgerEnabled) {
        if (!billId) throw new Error("Funded organization provision requires its bill id");
        const fundCountry = await resolveOrgFundCurrencyCountry(db, p.organizationId);
        const treasuryRate = organizationTreasuryLocalPerAnchor(batch, countryId);
        const fundRate = organizationLocalPerAnchor(batch, fundCountry);
        const amountFund = (amountLocal / treasuryRate) * fundRate;
        const fund = await getOrganizationFundsCollection(db);
        await fund.updateOne(
          { organizationId: p.organizationId },
          {
            $setOnInsert: {
              _id: new ObjectId(),
              organizationId: p.organizationId,
              currencyCountryId: fundCountry,
              balanceLocal: 0,
            },
          },
          { upsert: true }
        );
        const result = await settleOrganizationFundedCashMove(db, batch, {
          key: `organization-capitalization:${billId}`,
          kind: "organization_capitalization",
          source: {
            collection: "federalBudget",
            filter: { countryId, treasuryCashLocal: { $gte: amountLocal } },
            path: "treasuryCashLocal",
            amount: amountLocal,
            currencyCode: batch.budgetCurrencies.get(countryId) ?? "USD",
            localPerAnchor: treasuryRate,
          },
          destination: {
            collection: "organizationFunds",
            filter: { organizationId: p.organizationId },
            path: "balanceLocal",
            amount: amountFund,
            currencyCode: COUNTRY_CURRENCY_MAP[fundCountry] ?? "USD",
            localPerAnchor: fundRate,
          },
          sourceTreasuryCountry: countryId,
          command: "organization.capitalize",
        });
        if (result.status !== "applied" && result.status !== "replayed") {
          return { fundCountry, amountFund: 0 };
        }
        if (result.status === "applied") {
          await witnessOrganizationCash(db, batch, {
            kind: "government",
            ref: countryId,
            countryId,
            amount: -amountLocal,
            site: "capitalization_treasury",
            now: new Date(),
          });
          await witnessOrganizationCash(db, batch, {
            kind: "org",
            ref: p.organizationId,
            countryId: fundCountry,
            amount: amountFund,
            site: "capitalization_fund",
            now: new Date(),
          });
        }
        return { fundCountry, amountFund: result.status === "applied" ? amountFund : 0 };
      }
      const debit = await db
        .collection<FederalBudget>("federalBudget")
        .updateOne(
          { countryId },
          { $inc: { treasuryBalance: -amountLocal }, $set: { updatedAt: new Date() } }
        );
      if (debit.modifiedCount > 0) {
        await witnessOrganizationCash(db, batch, {
          kind: "government",
          ref: countryId,
          countryId,
          amount: -amountLocal,
          site: "capitalization_treasury",
          now: new Date(),
        });
      }
      // Credit the fund in its (founding) currency, converted from the member's.
      const fundCountry = await resolveOrgFundCurrencyCountry(db, p.organizationId);
      const amountFund = convertLocal(
        countryId,
        fundCountry,
        amountLocal,
        batch?.preset ?? (await loadWorldPreset(db))
      );
      await creditOrganizationFund(db, p.organizationId, amountFund, { context: batch });
      return { fundCountry, amountFund };
    }
  );
  if (!(amountFund > 0)) return;
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
