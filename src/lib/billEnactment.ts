/**
 * Bill Enactment Hook
 *
 * Called when a bill is enacted (signed into law or veto overridden).
 * Updates the active policy for the state/federal level, records initial policy reactions,
 * and applies archetype approval impacts to legislators who voted for the bill.
 *
 * ## Currency convention (v0.2.6)
 *
 * Enacted-law cost fields are denominated in the **owning country's local currency**:
 *
 * - `annualCostUsd` — legacy name; value is country-local (JPY for JP, GBP for UK, USD
 *   for US, etc.). Rename deferred to a follow-up schema migration.
 * - `gdpPerCapitaMultiplier × gdp` — GDP is already in country currency, so the product
 *   is country-local with no conversion needed.
 * - `annualCostPerCapita × population` — per-capita amount treated as country-local.
 *
 * `federalBudget.spending.byCategory[*]` and `federalBudget.revenue` are also in country
 * currency (see `src/lib/db/types/budget.ts`), so every enactment read/write here is
 * same-currency — no FX conversion needed inside this file.
 */

import type { AnyBulkWriteOperation, Db, ObjectId } from "mongodb";
import { ObjectId as MongoObjectId } from "mongodb";
import type {
  Bill,
  StateBill,
  LegislationType,
  LegislationPolicyOption,
  StatePolicy,
  Character,
  NPP,
} from "@/lib/db/types";
import type { EnactedLaw } from "@/lib/db/types/budget";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { COST_INCOME_ANCHORS } from "@/lib/politicalLegislation/costAnchors";
import { computeLawCost } from "@/lib/politicalLegislation/costEngine";
import { countryFiscalBase, regionFiscalBase } from "@/lib/politicalLegislation/fiscalBase";
import type { LawCountryId } from "@/lib/politicalLegislation/types";
import { recordAudit } from "@/lib/audit/recordAudit";
import { needsPhaseIn, stepTaxRate } from "@/lib/budget/taxRatePhaseIn";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type {
  FederalBudget,
  FederalTaxRates,
  StateBudget,
  StateTaxRates,
} from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import { applyElectoralLawProvision } from "@/lib/elections/electoralLaws";
import type {
  CentralBankIndependenceProvision,
  ElectoralLawProvision,
} from "@/lib/db/types/legislation";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { getBankId } from "@/lib/centralBank/helpers";
import { seedFomcBoards } from "@/lib/centralBank/seedFomcBoard";
import { scrutinyAfterRevocation } from "@/lib/centralBank/independence";
import { createSystemNewsPost } from "@/lib/news";
import { recordPolicyReaction } from "@/lib/policyReactions";
import { validateFederalBudgetImpact } from "@/lib/budget/validation";
import { triggerDebtCeilingCrisis } from "@/lib/budget/debt";
import { recordEnactedLaw } from "@/lib/budget/enactedLaws";
import { sendCountryGameEvent, DISCORD_COLORS } from "@/lib/discordWebhooks";
import { calculateShiftImpacts } from "@/lib/archetypeAffinities";
import { regionalDefaultLevel } from "@/lib/politicalLegislation/regionalDefaults";
import {
  calculateFederalRevenue,
  calculateStateRevenue,
  normalizeFederalTaxRates,
  normalizeStateTaxRates,
  loadLatestSourcedImportAggregates,
} from "@/lib/budget/revenue";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { getCurrentTurn } from "@/lib/currentTurn";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { getSelectedPolicyOption } from "@/lib/budget/costs";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig, EU_EUROZONE_MEMBERS } from "@/lib/constants/countries";
import {
  inferCountryIdFromStateId,
  resolveBillCountryId,
} from "@/lib/congress/resolveBillCountryId";
import { syncFederalBudgetSpending } from "@/lib/budget/spending";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { STAT_MIN } from "@/lib/stats/statsConstants";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { applyInternationalWithdrawalMeasure } from "@/lib/internationalOrganizations/withdrawalBills";
import {
  applySeparationBill,
  isBankingSeparationLegislationType,
  separationPolicyFromOptionId,
} from "@/lib/banking/separationBill";

type EnactableBill = Pick<
  Bill | StateBill,
  "_id" | "title" | "legislationTypeId" | "effectDirection" | "provisions"
> & {
  stateId?: string;
  countryId?: CountryId;
  /** Bill category (e.g. "reunification") — used to skip the generic enacted webhook. */
  category?: string;
  sponsorId?: ObjectId | null;
  /** NPI spent at proposal time — refunded on passage */
  proposalNpiCost?: number;
  /** Action points spent at proposal time — refunded on passage */
  proposalActionCost?: number;
  // Votes from both chambers for federal bills
  votes?: Record<string, "for" | "against" | "abstain">;
  otherChamberVotes?: Record<string, "for" | "against" | "abstain">;
  /**
   * #3598: attribution tag threaded onto the resulting `EnactedLaw` row.
   * Omitted for ordinary bills; set to "scotus_ruling" by the SCOTUS docket
   * turn processor when synthesizing a diverged-case enactment, or
   * "scotus_surprise_ruling" (#3607) by the surprise-case turn processor, or
   * "uk_judicial_review_surprise" by the UK JR surprise turn.
   */
  source?: EnactedLaw["source"];
};

interface ProvisionData {
  legislationTypeId: string;
  policyOptionId?: string;
  effectDirection: number;
  economic?: number;
  social?: number;
  /** Tax-slider laws (ruling #16): the slider-chosen rate. */
  proposedRate?: number;
}

/**
 * Apply tax rate changes when a tax bill provision is enacted.
 * Federal scope writes to federalBudget; state scope writes to the bill's stateBudget.
 * Both paths recalculate revenue + surplus immediately so the fiscal impact is visible
 * on the next turn rather than waiting until fiscal-year processing.
 */
async function applyTaxRateChange(
  db: Db,
  legislationType: LegislationType,
  selectedOptionRate: number | undefined,
  stateId: string
): Promise<void> {
  // Slider tax laws (ruling #16) carry scope+taxType on `taxSlider`, not the discrete
  // `taxRateChange` schema — the two are projected side by side, but only for freshly
  // seeded types. A stored `legislationTypes` doc written before that projection landed
  // has `taxSlider` alone, and the slider enactment path (see the call site) hands us such
  // a type. Requiring `taxRateChange` here is what made ticket 1102's Poon Choi Economic
  // Act enact its VAT/customs sliders without ever writing federalBudget.taxRates. Resolve
  // from whichever field the type carries so a slider provision always applies.
  const change = legislationType.taxRateChange ?? legislationType.taxSlider;
  if (!change || selectedOptionRate === undefined) {
    return;
  }

  const { scope, taxType } = change;

  if (scope === "federal") {
    const countryId = (
      legislationType.countryScope ?? "us"
    ).toUpperCase() as import("@/lib/constants/countries").CountryId;
    const budgetId = getNationalBudgetId(countryId);
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
    if (!budget) return;
    const normalizedTaxRates = normalizeFederalTaxRates(budget.taxRates);
    if (!normalizedTaxRates) return;

    // Ticket #1102: a big move ramps instead of landing whole. The rate starts
    // moving this turn and the legislature's figure is still exactly the
    // destination; only the speed changes. Anything within one step applies
    // outright, so ordinary budget tweaks behave as before.
    const currentRate = normalizedTaxRates[taxType as keyof FederalTaxRates];
    const rampedRate = stepTaxRate(currentRate, selectedOptionRate);
    const rampPending = needsPhaseIn(currentRate, selectedOptionRate);
    const newTaxRates: FederalTaxRates = {
      ...normalizedTaxRates,
      [taxType as keyof FederalTaxRates]: rampedRate,
    };

    // Money wiring (interstate-logistics plan step 5, phase B): a tax-rate
    // change bill is a rare event, not a per-turn hot loop, so a direct read
    // here is cheap. Only the tariffs base has a sourced-flow counterpart -
    // netting is a no-op (sourcedImports stays undefined) for every other tax.
    let sourcedImports: { tariffPaidAnchor: number; importValueAnchor: number } | undefined;
    if (taxType === "tariffs") {
      const moneyWiringConfig = await db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { interstateMoneyWiringEnabled: 1 } });
      if (moneyWiringConfig?.interstateMoneyWiringEnabled === true) {
        const sourcedByCountry = await loadLatestSourcedImportAggregates(
          db,
          await getCurrentTurn(db)
        );
        const agg = sourcedByCountry.get(countryId);
        if (agg) {
          sourcedImports = { tariffPaidAnchor: agg.tariffPaid, importValueAnchor: agg.importValue };
        }
      }
    }
    const fxByCurrency = sourcedImports ? await loadFxRatesByCurrency(db) : undefined;
    const newRevenue = await calculateFederalRevenue(
      db,
      newTaxRates,
      budgetId,
      undefined,
      undefined,
      undefined,
      fxByCurrency,
      sourcedImports
    );
    const newSurplus = newRevenue.total - budget.spending.total;

    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budgetId },
      {
        $set: {
          taxRates: newTaxRates,
          revenue: newRevenue,
          surplus: newSurplus,
          updatedAt: new Date(),
          ...(rampPending ? { [`taxRatePhaseIn.${taxType}`]: selectedOptionRate } : {}),
        },
        // A fresh enactment on the same tax replaces any ramp still running,
        // rather than leaving a stale target to drag the rate back later.
        ...(rampPending ? {} : { $unset: { [`taxRatePhaseIn.${taxType}`]: "" } }),
      }
    );
    return;
  }

  if (scope === "state") {
    // National pseudo-stateIds (federal, uk_national, jp_national) are not real state budgets.
    // Legitimate state-scope tax bills always carry an actual regional stateId (e.g. "US_CA", "UK_ENG").
    if (inferCountryIdFromStateId(stateId) != null) return;

    // DE Land budgets live in `regionalBudgets`, not `stateBudgets`. The current
    // per-Land statePolicy update (performed elsewhere in the enactment pipeline)
    // is enough on its own — `processDERegionalBudgets` runs each turn and
    // re-derives Gewerbesteuer revenue from the live `de_trade_tax` policy. No
    // direct budget write is needed (and would target a non-existent stateBudgets
    // doc anyway). See `deRegionalBudget.ts` for the per-turn recompute.
    if (legislationType.countryScope === "de") {
      return;
    }
    // CN provincial budgets live in `regionalBudgets` per the same pattern as DE.
    // statePolicy gets updated upstream; the per-turn `cnRegionalBudget.ts` recompute
    // will pick up the new resource-tax rate (recompute wiring lands in a follow-up
    // alongside the DE-style tradeTaxRevenue flow — see spec §13 deferred items).
    if (legislationType.countryScope === "cn") {
      return;
    }

    const stateBudgetCountryId = (
      legislationType.countryScope ?? "us"
    ).toUpperCase() as import("@/lib/constants/countries").CountryId;
    const budget = await db
      .collection<StateBudget>("stateBudgets")
      .findOne({ _id: stateId, countryId: stateBudgetCountryId });
    if (!budget) return;
    const normalizedTaxRates = normalizeStateTaxRates(budget.taxRates);
    if (!normalizedTaxRates) return;

    const newTaxRates: StateTaxRates = {
      ...normalizedTaxRates,
      [taxType as keyof StateTaxRates]: selectedOptionRate,
    };

    const federalGrants = budget.revenue?.federalGrants ?? 0;
    const newRevenue = await calculateStateRevenue(
      db,
      stateId,
      stateBudgetCountryId,
      newTaxRates,
      federalGrants
    );
    const newSurplus = newRevenue.total - (budget.spending?.total ?? 0);

    await db.collection<StateBudget>("stateBudgets").updateOne(
      { _id: stateId, countryId: stateBudgetCountryId },
      {
        $set: {
          taxRates: newTaxRates,
          revenue: newRevenue,
          surplus: newSurplus,
          updatedAt: new Date(),
        },
      }
    );
  }
}

/**
 * Records a country's Euro adoption vote. When all EU_EUROZONE_MEMBERS have
 * voted, flips gameState.eurozoneEnabled to true.
 *
 * Idempotent: $addToSet is a no-op if the country already voted. Safe to
 * call for non-EU countries — returns early without any DB writes.
 */
export async function applyEuroAdoptionProvision(db: Db, countryId: CountryId): Promise<void> {
  if (!EU_EUROZONE_MEMBERS.includes(countryId)) return;

  await db
    .collection<GameState>("gameState")
    .updateOne({ _id: "current" }, { $addToSet: { euroAdoptedCountries: countryId } });

  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { euroAdoptedCountries: 1 } });
  const adopted = gs?.euroAdoptedCountries ?? [];

  if (EU_EUROZONE_MEMBERS.every((m) => adopted.includes(m as CountryId))) {
    await db
      .collection<GameState>("gameState")
      .updateOne({ _id: "current" }, { $set: { eurozoneEnabled: true } });
  }
}

/**
 * Central bank independence, enacted by law. Writes the explicit
 * `governmentControlled` flag (which always beats the historical default in
 * `src/lib/centralBank/governance.ts`). Granting independence also seeds the
 * bank's rate committee if it has none — the 1997 Bank of England Act created
 * the MPC in the same stroke. Revoking leaves any board doc in place but
 * dormant (the FOMC turn skips government-controlled banks), so restoring
 * independence later restores the same institution.
 */
export async function applyCentralBankIndependenceProvision(
  db: Db,
  provision: CentralBankIndependenceProvision,
  countryId: CountryId,
  currentTurn: number
): Promise<void> {
  const governmentControlled = provision.action === "revoke";
  const banks = db.collection<CentralBank>("centralBanks");
  const bankId = getBankId(countryId);

  // B5: revoking independence costs the INSTITUTION credibility. Taking the
  // bank by statute was previously free — the government got a bank that does
  // what it says at no cost to what that bank's word is worth, which is the
  // one thing that should have moved. Granting independence deliberately
  // refunds nothing: if it did, grant-revoke cycling would launder scrutiny.
  let revocationScrutiny: number | undefined;
  if (governmentControlled) {
    const bank = await banks.findOne({ _id: bankId }, { projection: { chairInfamy: 1 } });
    if (bank) revocationScrutiny = scrutinyAfterRevocation(bank);
  }

  await banks.updateOne(
    { _id: bankId },
    {
      $set: {
        governmentControlled,
        ...(revocationScrutiny !== undefined
          ? { chairInfamy: revocationScrutiny, resolveStreak: 0 }
          : {}),
        updatedAt: new Date(),
      },
    }
  );

  if (provision.action === "grant") {
    // Idempotent: only banks without a board (and not government-controlled,
    // which this bank no longer is) get seeded.
    await seedFomcBoards(db, currentTurn);
  }

  const bankName = getCountryConfig(countryId)?.centralBank.name ?? "central bank";
  const newsContent =
    provision.action === "grant"
      ? `The ${bankName} has been granted operational independence: rate-setting passes from the government to the bank and its new policy committee.`
      : `The ${bankName}'s operational independence has been revoked by law: rate-setting returns to the government, and markets have marked down what the bank's word is worth.`;
  await createSystemNewsPost(newsContent, "legislation").catch(() => {});
}

/**
 * Called when a bill is enacted (signed into law or veto overridden).
 * Updates the active StatePolicy for each provision and records initial group reactions.
 */
export async function onBillEnacted(
  db: Db,
  bill: EnactableBill,
  currentTurn: number
): Promise<void> {
  // Country-scoped national bills use pseudo-state ids (federal, uk_national, ca_national, …).
  const stateId = bill.stateId ?? "federal";
  const isNationalBill = inferCountryIdFromStateId(stateId) != null;

  // National budget gate (audit S6). onBillEnacted is the single choke-point
  // every national enactment path flows through (manual presidential sign,
  // pocket-sign, veto override, direct enactment), so run the federal budget
  // validation here and persist its outcome on the bill instead of letting the
  // timer paths silently skip it. The national gate is WARN-ONLY by design —
  // sovereign deficit spending is a deliberate lane — so validation never
  // blocks enactment; a debt-ceiling breach arms the debt-ceiling crisis
  // (idempotent upsert, so the manual-sign path's own trigger is harmless).
  if (isNationalBill && (bill.legislationTypeId || bill.provisions?.length)) {
    try {
      const budgetCountryId = inferCountryIdFromStateId(stateId) as CountryId;
      const validation = await validateFederalBudgetImpact(
        db,
        bill,
        getNationalBudgetId(budgetCountryId)
      );
      await db.collection("bills").updateOne(
        { _id: bill._id as unknown as ObjectId },
        {
          $set: {
            budgetValidation: {
              costAmount: validation.costAmount,
              newTotalSpending: validation.newTotalSpending,
              ...(validation.newDebt !== undefined ? { newDebt: validation.newDebt } : {}),
              ...(validation.warning ? { warning: validation.warning } : {}),
              validatedAt: new Date(),
            },
          },
        }
      );
      if (validation.warning === "DEBT_CEILING_EXCEEDED") {
        const budgetGateGameState = await db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" });
        await triggerDebtCeilingCrisis(
          db,
          budgetGateGameState?.currentYear ?? new Date().getFullYear()
        );
      }
    } catch (err) {
      // Validation is advisory on the national lane — never block enactment.
      console.error("[budgetGate] national budget validation failed:", err);
    }
  }

  // Country history: record enactments of national/federal-scope bills.
  // State-level bills are skipped to keep the country history table focused
  // on landmark laws rather than every local policy change.
  if (isNationalBill) {
    (async () => {
      const countryId = await resolveBillCountryId(db, bill);
      await recordCountryEvent(db, {
        countryId,
        turn: currentTurn,
        eventType: "bill_enacted",
        title: `Enacted: ${bill.title}`,
        billId: bill._id as unknown as ObjectId,
        billScope: "national",
        details: {
          sponsorId: bill.sponsorId?.toString(),
          legislationTypeId: bill.legislationTypeId,
        },
      });
    })().catch((err) => console.error("[countryHistory] bill_enacted failed:", err));
  }

  // Audit spine — single choke point for "a bill became law", regardless of
  // which caller reached it (direct presidential sign in
  // `presidentialBillAction.ts`, auto pocket-sign or veto-override enactment
  // in `billLifecycle.ts`). Fires for every enactment, including
  // provision-less/flavor bills, mirroring the country-history event above.
  recordAudit({
    // Runs for both API-triggered (direct presidential sign) and turn-phase
    // (pocket-sign, veto-override) enactments — mirrors `emitTx`'s
    // `buildAuditEnvelope` convention (financialTxLog/emit.ts) of "system"
    // when the same hook serves multiple origins.
    source: "system",
    action: "bill.enact",
    category: "governance",
    subject: { type: "bill", id: bill._id, name: bill.title },
    refs: { billId: bill._id },
    meta: { stateId, isNationalBill },
    outcome: "ok",
  });

  await applyInternationalWithdrawalMeasure(db, bill as Bill, currentTurn);

  // Electoral law: franchise + registration access. Applied before the policy
  // provisions below because both are national gameState writes the demographic
  // and politics phases read next turn, and neither depends on provision state.
  const electoralLawProvisions = (bill.provisions ?? []).filter((p) => p.type === "electoral_law");
  if (electoralLawProvisions.length > 0) {
    const enactingCountryId = await resolveBillCountryId(db, bill as Bill);
    for (const p of electoralLawProvisions) {
      await applyElectoralLawProvision(db, p as ElectoralLawProvision, enactingCountryId);
    }
  }

  // Euro adoption: record this country's vote; enable eurozone when all members adopt.
  if (bill.provisions?.some((p) => p.type === "euro_adoption")) {
    const enactingCountryId = await resolveBillCountryId(db, bill as Bill);
    await applyEuroAdoptionProvision(db, enactingCountryId as CountryId);
  }

  // Central bank independence: grant/revoke rate-setting authority.
  const centralBankProvisions = (bill.provisions ?? []).filter(
    (p) => p.type === "central_bank_independence"
  );
  if (centralBankProvisions.length > 0) {
    const enactingCountryId = await resolveBillCountryId(db, bill as Bill);
    for (const p of centralBankProvisions) {
      await applyCentralBankIndependenceProvision(
        db,
        p as CentralBankIndependenceProvision,
        enactingCountryId as CountryId,
        currentTurn
      );
    }
  }

  // Collect all provisions from the bill
  const provisions: ProvisionData[] = [];

  if (bill.provisions?.length) {
    for (const p of bill.provisions) {
      if (!isPolicyProvision(p)) continue;
      provisions.push({
        legislationTypeId: p.legislationTypeId,
        policyOptionId: p.policyOptionId,
        effectDirection: p.effectDirection,
        economic: p.economic,
        social: p.social,
        // Tax-slider laws (ruling #16): the chosen rate lives ONLY on the
        // provision — there is no options ladder to recover it from. Dropping
        // it here made every slider tax law inert: the statePolicy and
        // enactedLaw rows were written, but `processProvisionEnactment`'s
        // `provision.proposedRate !== undefined` guard never fired, so
        // federalBudget.taxRates never moved and the duties/VAT the bill
        // levied were never collected (ticket #1102).
        proposedRate: p.proposedRate,
      });
    }
  } else if (bill.legislationTypeId && bill.effectDirection != null) {
    provisions.push({
      legislationTypeId: bill.legislationTypeId,
      effectDirection: bill.effectDirection,
    });
  }

  // Bail out only for truly-empty bills. Bills carrying only non-policy provisions
  // (tariffs, subsidies, end_subsidies) still need webhook + sponsor refund — those
  // provisions have already been applied via applyLegislationEffect.
  const billHasAnyContent =
    (bill.provisions?.length ?? 0) > 0 ||
    (bill.legislationTypeId != null && bill.effectDirection != null);
  if (!billHasAnyContent) return;

  // Batch fetch legislation types for the policy provisions (empty list is a no-op).
  const uniqueLegTypeIds = [...new Set(provisions.map((p) => p.legislationTypeId))];
  const legTypes = uniqueLegTypeIds.length
    ? await db
        .collection<LegislationType>("legislationTypes")
        .find({ _id: { $in: uniqueLegTypeIds } })
        .toArray()
    : [];
  const legTypeMap = new Map<string, LegislationType>(
    legTypes.map((lt) => [lt._id, lt] as [string, LegislationType])
  );

  // Fetch fiscal year from game state
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const fiscalYear = gameState?.currentYear ?? new Date().getFullYear();

  // Collect all "for" voters from both chambers
  const forVoters: string[] = [];
  if (bill.votes) {
    for (const [charId, vote] of Object.entries(bill.votes)) {
      if (vote === "for") forVoters.push(charId);
    }
  }
  if ((bill as Bill).otherChamberVotes) {
    for (const [charId, vote] of Object.entries((bill as Bill).otherChamberVotes!)) {
      if (vote === "for") forVoters.push(charId);
    }
  }

  const resolvedCountry = await resolveBillCountryId(db, bill as Bill);
  // UK-only archetype routing hook (unchanged behavior for non-UK)
  const billCountryId = resolvedCountry ?? undefined;

  const nationalScopeCountry = inferCountryIdFromStateId(stateId);
  const policyScope: "national" | "state" = isNationalBill ? "national" : "state";

  // Process each policy provision and record enacted law if it has a budget cost.
  // Tariff/subsidy provisions are intentionally absent here — they've already been
  // routed through applyTariffProvision / applySubsidyProvision upstream.
  for (const provision of provisions) {
    const lt = legTypeMap.get(provision.legislationTypeId);
    await processProvisionEnactment(
      db,
      bill._id,
      stateId,
      policyScope,
      provision,
      legTypeMap,
      currentTurn,
      forVoters,
      billCountryId
    );

    // Record enacted law with dynamic cost metadata from the selected policy option.
    if (lt) {
      const policyOption = getSelectedPolicyOption(lt, provision);
      const scope = isNationalBill ? "national" : "state";
      // Political-legislation v2 (spec §5.1): revenue-bearing options carry
      // annualRevenueV2 on the record so the from-scratch lawRevenue recompute
      // keeps the line alive across re-enactments (audit pass 1 finding).
      let annualRevenueV2: number | undefined;
      const v2Model = policyOption?.costModelV2;
      if (v2Model?.gdpRevenueFraction && billCountryId && billCountryId in COST_INCOME_ANCHORS) {
        const v2Base =
          isNationalBill || !bill.stateId
            ? await countryFiscalBase(db, billCountryId)
            : await regionFiscalBase(db, bill.stateId);
        annualRevenueV2 = computeLawCost(
          { name: "", description: "", ...v2Model },
          v2Base,
          billCountryId as LawCountryId,
          null
        ).revenue;
      }
      await recordEnactedLaw(
        db,
        bill as Bill,
        lt,
        fiscalYear,
        scope,
        isNationalBill ? undefined : bill.stateId,
        policyOption,
        annualRevenueV2,
        bill.source
      );
    }
  }

  // Sync federal budget spending so newly-enacted spending laws are reflected
  // immediately. Tax bills are handled in applyTaxRateChange (revenue + surplus
  // only); this covers the spending side for all national bills.
  if (isNationalBill && nationalScopeCountry) {
    await syncFederalBudgetSpending(db, nationalScopeCountry);
  }

  // Record policy reactions for all provisions
  await recordPolicyReaction(db, bill, stateId, currentTurn);

  // Refund proposal costs to the sponsor (capped at action cap; NPI has no hard cap)
  if (bill.sponsorId && (bill.proposalNpiCost || bill.proposalActionCost)) {
    const sponsor = await db
      .collection<Character>("characters")
      .findOne(
        { _id: bill.sponsorId },
        { projection: { actions: 1, nationalInfluence: 1, stats: 1 } }
      );
    if (sponsor) {
      const refundNpi = bill.proposalNpiCost ?? 0;
      const refundActions = bill.proposalActionCost ?? 0;
      // Cap the refund at the sponsor's Energy-scaled action cap (matches actionRefresh).
      const energyCap = energyActionLimits(sponsor.stats?.energy ?? STAT_MIN).cap;
      const newActions = Math.min(energyCap, (sponsor.actions ?? 0) + refundActions);
      const updateOp: Record<string, unknown> = {
        $set: { actions: newActions, updatedAt: new Date() },
      };
      if (refundNpi > 0) {
        updateOp.$inc = { nationalInfluence: refundNpi };
      }
      await db.collection<Character>("characters").updateOne({ _id: bill.sponsorId }, updateOp);
    }
  }

  // Discord notification (fire-and-forget)
  const locationLabel = (() => {
    if (nationalScopeCountry && resolvedCountry === "UK") return "Westminster";
    if (nationalScopeCountry && resolvedCountry === "US") return "Federal";
    if (nationalScopeCountry && resolvedCountry === "DE") return "Bundestag";
    if (nationalScopeCountry && resolvedCountry === "JP") return "Kokkai";
    if (nationalScopeCountry) return getCountryConfig(resolvedCountry).name;
    return bill.stateId || "Federal";
  })();
  const countryLabel =
    resolvedCountry === "US"
      ? "USA"
      : resolvedCountry === "UK"
        ? "UK"
        : resolvedCountry === "DE"
          ? "Germany"
          : resolvedCountry === "JP"
            ? "Japan"
            : getCountryConfig(resolvedCountry).name;

  // Build policy domain label from the first provision's legislation type
  const firstLegType =
    provisions.length > 0 ? legTypeMap.get(provisions[0].legislationTypeId) : undefined;
  const policyLabel = firstLegType?.policyDomain
    ? firstLegType.policyDomain.charAt(0).toUpperCase() + firstLegType.policyDomain.slice(1)
    : undefined;

  // Build URL: national bills deep-link to shared bill page; subnational → state legislature hub
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
  const billUrl =
    nationalScopeCountry != null
      ? `${baseUrl}/congress/bills/${bill._id.toString()}`
      : bill.stateId
        ? `${baseUrl}/state/${bill.stateId}/legislature`
        : `${baseUrl}/congress/bills/${bill._id.toString()}`;

  const embedFields: { name: string; value: string; inline?: boolean }[] = [];
  if (policyLabel) {
    embedFields.push({ name: "Policy", value: policyLabel, inline: true });
  }
  embedFields.push({
    name: "View Bill",
    value: `[Open in A House Divided](${billUrl})`,
    inline: true,
  });

  // Reunification consent bills post their own bespoke referendum-process events
  // (see referendumWebhooks); skip the generic "Bill Enacted" notice to avoid a
  // duplicate post for the same event.
  if (bill.category !== "reunification") {
    sendCountryGameEvent(resolvedCountry ?? "US", {
      title: `${countryLabel} — Bill Enacted — ${locationLabel}`,
      description: `**${bill.title}** was signed into law.`,
      color: DISCORD_COLORS.billEnacted,
      fields: embedFields,
      url: billUrl,
      footer: { text: "A House Divided" },
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }
}

/**
 * Process a single provision and create/update the StatePolicy record.
 * Also applies archetype approval impacts to legislators who voted FOR the bill.
 */
async function processProvisionEnactment(
  db: Db,
  billId: ObjectId,
  stateId: string,
  scope: "national" | "state",
  provision: ProvisionData,
  legTypeMap: Map<string, LegislationType>,
  currentTurn: number,
  forVoters: string[],
  countryId?: string
): Promise<void> {
  const lt = legTypeMap.get(provision.legislationTypeId);

  // Find the matching policy option and its index
  let policyOption: LegislationPolicyOption | undefined;
  let newPolicyIndex = 3; // Default to center (index 3 in 0-6 range)

  if (lt?.policyOptions?.length) {
    // Prefer policyOptionId lookup (reliable), fall back to effectDirection matching
    let matchIndex = -1;
    if (provision.policyOptionId) {
      matchIndex = lt.policyOptions.findIndex((opt) => opt.id === provision.policyOptionId);
    }
    if (matchIndex === -1) {
      matchIndex = lt.policyOptions.findIndex(
        (opt) => opt.effectDirection === provision.effectDirection
      );
    }

    if (matchIndex !== -1) {
      newPolicyIndex = matchIndex;
      policyOption = lt.policyOptions[matchIndex];
    } else {
      // No exact match found, use center option if available
      const centerIndex = Math.floor(lt.policyOptions.length / 2);
      policyOption = lt.policyOptions[centerIndex];
      newPolicyIndex = centerIndex;
    }
  }

  // Get old policy index before updating
  const oldPolicy = await db
    .collection<StatePolicy>("statePolicies")
    .findOne({ stateId, legislationTypeId: provision.legislationTypeId });
  // Default a missing prior policy to the CENTER OF THIS TYPE'S OPTIONS (not the
  // hardcoded 3, which is out of bounds for any type with <4 options). An
  // out-of-bounds index makes optionScores[oldIndex] undefined, which drops
  // calculateShiftImpacts onto the legacy bare-index path that inverts every
  // archetype-approval sign for right→left-ordered option sets. Clamping keeps
  // it on the curated-score path so signs stay correct. (#2899 — ticket 921.)
  const optionCount = lt?.policyOptions?.length ?? 0;
  const centerIndex = optionCount ? Math.floor(optionCount / 2) : 3;
  // A region with no row for a new-generation `both` law sits at level 0 — what
  // getEnactedLevel reports to the engine, and what the propose modal now
  // previews the shift from. Falling through to the centre scored the approval
  // swing as 2 -> 3 instead of 0 -> 3, so the enacted outcome contradicted the
  // preview its own voters were shown. National scope keeps the centre: those
  // rows ARE seeded, so a missing one is a different problem.
  const regionalDefault =
    scope === "state" ? regionalDefaultLevel(provision.legislationTypeId) : undefined;
  const rawOldIndex = oldPolicy?.policyOptionIndex ?? regionalDefault ?? centerIndex;
  const oldPolicyIndex = optionCount
    ? Math.max(0, Math.min(optionCount - 1, rawOldIndex))
    : rawOldIndex;

  // Determine economic and social values
  // Priority: provision overrides > policy option values > defaults
  const economic = provision.economic ?? policyOption?.economic ?? 0;
  const social = provision.social ?? policyOption?.social ?? 0;
  const effectDirection = provision.effectDirection ?? policyOption?.effectDirection ?? 0;

  // Create the StatePolicy record. `scope` is required by the policy API
  // (statePolicies.find({ scope: "national" })) — omitting it hides enacted
  // policies from /api/country/[code]/policy, which is how JP legislation
  // silently stopped appearing on the JP National Policy page.
  const statePolicy: Omit<StatePolicy, "_id"> = {
    scope,
    stateId,
    legislationTypeId: provision.legislationTypeId,
    // Slider laws have no options ladder — keep the provision's rate-encoded
    // "rate:<value>" id so the enacted rate is readable from statePolicies.
    policyOptionId: policyOption?.id ?? provision.policyOptionId ?? "unknown",
    policyOptionIndex: newPolicyIndex,
    enactedAt: new Date(),
    enactedTurn: currentTurn,
    enactedByBillId: billId,
    enactedBy: { kind: "bill", id: billId },
    economic,
    social,
    effectDirection,
  };

  // If a prior executive order set this same policy, mark it superseded so
  // the order's turn-phase doesn't try to revert the bill's effect.
  const priorPolicy = await db
    .collection<StatePolicy>("statePolicies")
    .findOne({ stateId, legislationTypeId: provision.legislationTypeId });
  if (priorPolicy?.enactedBy?.kind === "order") {
    await db.collection("governorExecutiveOrders").updateOne(
      { _id: priorPolicy.enactedBy.id, status: "active" },
      {
        $set: {
          status: "superseded",
          supersededByBillId: billId,
          updatedAt: new Date(),
        },
      }
    );
  }

  // Upsert into statePolicies collection keyed by (stateId, legislationTypeId)
  await db
    .collection<StatePolicy>("statePolicies")
    .updateOne(
      { stateId, legislationTypeId: provision.legislationTypeId },
      { $set: statePolicy },
      { upsert: true }
    );

  // Apply tax rate changes if this is tax legislation
  if (lt?.taxRateChange && policyOption?.rate !== undefined) {
    await applyTaxRateChange(db, lt, policyOption.rate, stateId);
  }

  // Tax-slider laws (ruling #16): no options ladder — the provision carries the
  // slider-chosen rate; federalBudget.taxRates stays the source of truth (the
  // statePolicies record above stores the rate-encoded option id for readback).
  if (lt?.taxSlider && provision.proposedRate !== undefined) {
    await applyTaxRateChange(db, lt, provision.proposedRate, stateId);
  }

  // Banking separation: write bankingLaws.<countryId>.separation (reusable law).
  if (isBankingSeparationLegislationType(provision.legislationTypeId) && countryId) {
    const separation = separationPolicyFromOptionId(policyOption?.id ?? provision.policyOptionId);
    if (separation) {
      await applySeparationBill(
        db,
        countryId as CountryId,
        separation,
        billId.toString(),
        currentTurn
      );
    }
  }

  // Calculate and apply archetype approval impacts based on policy shift
  if (lt?.policyDomain && forVoters.length > 0) {
    const impacts = calculateShiftImpacts(
      lt.policyDomain,
      oldPolicyIndex,
      newPolicyIndex,
      countryId,
      // Curated position scores → correct shift direction even for right→left-ordered
      // option sets (all tax brackets, some CN/DE/JP types). Without these the bare
      // index flips every approval sign (e.g. libertarians "approve" a 50% income tax).
      lt.policyOptions?.map((o) => (o.economic ?? 0) + (o.social ?? 0))
    );

    if (Object.keys(impacts).length > 0) {
      await applyArchetypeImpactsToVoters(db, forVoters, impacts);
    }
  }
}

/**
 * Apply archetype approval impacts to a list of character IDs.
 * Handles both player characters and NPPs.
 */
async function applyArchetypeImpactsToVoters(
  db: Db,
  voterIds: string[],
  impacts: Record<string, number>
): Promise<void> {
  if (voterIds.length === 0 || Object.keys(impacts).length === 0) return;

  // Build the $inc updates
  const incUpdates: Record<string, number> = {};
  for (const [archetypeId, impact] of Object.entries(impacts)) {
    incUpdates[`archetypeApprovals.${archetypeId}`] = impact;
  }

  // Convert string IDs to ObjectIds, filtering invalid ones
  const validObjectIds = voterIds
    .filter((id) => MongoObjectId.isValid(id))
    .map((id) => new MongoObjectId(id));

  if (validObjectIds.length === 0) return;

  // Update characters
  await db
    .collection<Character>("characters")
    .updateMany({ _id: { $in: validObjectIds } }, { $inc: incUpdates });

  // Update NPPs (some voter IDs might be NPPs)
  await db
    .collection<NPP>("npps")
    .updateMany({ _id: { $in: validObjectIds } }, { $inc: incUpdates });

  // Clamp values for characters
  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: validObjectIds }, archetypeApprovals: { $exists: true } })
    .toArray();

  const charBulkOps: AnyBulkWriteOperation<Character>[] = [];
  for (const char of characters) {
    if (!char.archetypeApprovals) continue;
    let needsUpdate = false;
    const clamped: Record<string, number> = {};

    for (const [id, val] of Object.entries(char.archetypeApprovals)) {
      const clampedVal = Math.max(-100, Math.min(100, val));
      clamped[id] = clampedVal;
      if (clampedVal !== val) needsUpdate = true;
    }

    if (needsUpdate) {
      charBulkOps.push({
        updateOne: {
          filter: { _id: char._id },
          update: { $set: { archetypeApprovals: clamped } },
        },
      });
    }
  }
  if (charBulkOps.length > 0) {
    await db.collection<Character>("characters").bulkWrite(charBulkOps);
  }

  // Clamp values for NPPs
  const npps = await db
    .collection<NPP>("npps")
    .find({ _id: { $in: validObjectIds }, archetypeApprovals: { $exists: true } })
    .toArray();

  const nppBulkOps: AnyBulkWriteOperation<NPP>[] = [];
  for (const npp of npps) {
    if (!npp.archetypeApprovals) continue;
    let needsUpdate = false;
    const clamped: Record<string, number> = {};

    for (const [id, val] of Object.entries(npp.archetypeApprovals)) {
      const clampedVal = Math.max(-100, Math.min(100, val));
      clamped[id] = clampedVal;
      if (clampedVal !== val) needsUpdate = true;
    }

    if (needsUpdate) {
      nppBulkOps.push({
        updateOne: {
          filter: { _id: npp._id },
          update: { $set: { archetypeApprovals: clamped } },
        },
      });
    }
  }
  if (nppBulkOps.length > 0) {
    await db.collection<NPP>("npps").bulkWrite(nppBulkOps);
  }
}
