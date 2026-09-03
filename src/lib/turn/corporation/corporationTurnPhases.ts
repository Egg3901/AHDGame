import { ObjectId } from "mongodb";
import type { AnyBulkWriteOperation, Db } from "mongodb";
import type {
  Character,
  Corporation,
  FederalBudget,
  StateBudget,
  StateMetrics,
} from "@/lib/db/types";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";
import { GDP_DOMESTIC_CORPORATE_FACTOR, GDP_FOREIGN_CORPORATE_FACTOR } from "@/lib/budget/revenue";
import { COUNTRY_CURRENCY_MAP, MARKET_MAKER_SPREAD } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpCapital,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { computeLabourTightness, roundTightness } from "@/lib/labour/labourMarket";
import { emitTxBulk } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry, TxThresholds } from "@/lib/db/types/financialTxLog";
import { distributeConversionSpread } from "@/lib/currency/marketMaker";
import { buildEscrowFundingTxEntry } from "@/lib/corporations/escrowTxLog";
import type { CorporationLookups, CorpSnapshot } from "./types";

/**
 * v2: persist the per-state labour wage index (+ v2-3b: automation index) to
 * macroMetrics (SP5: economic.* re-homed off stateMetrics) so the macro
 * coupling (migration pull / medianIncome / unemployment, gated on
 * labourSystemMode ≥ "macro") can read it. Only written when the labour
 * system is on, so it's inert otherwise.
 */
export async function persistLabourIndices(args: {
  db: Db;
  wagesEnabled: boolean;
  labourWageIndexByState: Map<string, number>;
  automationIndexByState: Map<string, number>;
}): Promise<void> {
  const { db, wagesEnabled, labourWageIndexByState, automationIndexByState } = args;
  if (wagesEnabled && labourWageIndexByState.size > 0) {
    // v2-2/v2-3b: capture each state's PRIOR wage + automation index before
    // this turn's overwrite (this is the corp turn — the only place that
    // still has last turn's value) so the metric engine can Δ-passthrough the
    // changes into medianIncome / unemployment. Missing prior (cold start /
    // labour just turned on) ⇒ delta 0 — no false first-turn signal.
    // automationIndexByState shares its keyset with labourWageIndexByState by
    // construction (both accumulate inside the same per-sector conditional).
    const stateIds = Array.from(labourWageIndexByState.keys());
    const priorDocs = await db
      .collection<StateMetrics>("macroMetrics")
      .find({ _id: { $in: stateIds } })
      .project<{
        _id: string;
        economic?: {
          labourWageIndex?: { value?: number };
          automationIndex?: { value?: number };
        };
      }>({
        "economic.labourWageIndex.value": 1,
        "economic.automationIndex.value": 1,
      })
      .toArray();
    const priorWageIndexByState = new Map(
      priorDocs.map((d) => [d._id, d.economic?.labourWageIndex?.value])
    );
    const priorAutomationIndexByState = new Map(
      priorDocs.map((d) => [d._id, d.economic?.automationIndex?.value])
    );
    const wageIndexOps = Array.from(labourWageIndexByState, ([stateId, index]) => {
      const priorWage = priorWageIndexByState.get(stateId);
      const wageDelta =
        typeof priorWage === "number" && Number.isFinite(priorWage) ? index - priorWage : 0;
      const automationIndex = automationIndexByState.get(stateId) ?? 1;
      const priorAutomation = priorAutomationIndexByState.get(stateId);
      const automationDelta =
        typeof priorAutomation === "number" && Number.isFinite(priorAutomation)
          ? automationIndex - priorAutomation
          : 0;
      return {
        updateOne: {
          filter: { _id: stateId },
          update: {
            $set: {
              "economic.labourWageIndex.value": index,
              "economic.labourWageIndexDelta.value": wageDelta,
              "economic.automationIndex.value": automationIndex,
              "economic.automationIndexDelta.value": automationDelta,
            },
          },
        },
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("macroMetrics").bulkWrite(wageIndexOps as any[]);
  }
}

/**
 * Phase 1 labour market telemetry: persist per-state corporate labour DEMAND and
 * the resulting tightness ratio against the metric engine's civilian labour
 * force.
 *
 * These two systems have never been compared. `economic.laborForce` is written
 * by the metric-engine phase from working-age population and participation;
 * sector `workers` is written by this turn from revenue. Nothing has ever
 * checked one against the other, which is how the live world reached a single
 * Arizona extraction sector holding 47,996,752 workers against a 314,613-person
 * state labour force while unemployment sat unmoved at 15%.
 *
 * Deliberately INERT. Nothing reads these fields back into the economy. Phase 1
 * exists so the rationing and scarcity-wage mechanics in phases 2 and 3 can be
 * tuned against a real distribution of tightness readings rather than a guess.
 *
 * Written whenever the corporation turn ran at all, NOT gated on
 * `wagesEnabled`, because desired headcount is a fact about the sectors and
 * would otherwise be blank in exactly the worlds most likely to need it. States
 * with no `laborForce` reading get their demand recorded but no tightness, since
 * unknown supply means unknown tightness rather than infinite tightness.
 */
export async function persistLabourMarketTelemetry(args: {
  db: Db;
  labourDemandByState: Map<string, number>;
  labourDemandWageIndexByState?: Map<string, number>;
  turn: number | undefined;
}): Promise<void> {
  const { db, labourDemandByState, labourDemandWageIndexByState, turn } = args;
  if (labourDemandByState.size === 0) return;

  const stateIds = Array.from(labourDemandByState.keys());
  const supplyDocs = await db
    .collection<StateMetrics>("macroMetrics")
    .find({ _id: { $in: stateIds } })
    .project<{ _id: string; economic?: { laborForce?: { value?: number } } }>({
      "economic.laborForce.value": 1,
    })
    .toArray();
  const supplyByState = new Map(supplyDocs.map((d) => [d._id, d.economic?.laborForce?.value]));

  const ops = Array.from(labourDemandByState, ([stateId, demand]) => {
    const set: Record<string, number> = {
      "economic.labourDemand.value": Math.round(demand),
      "economic.labourDemandWageIndex.value": labourDemandWageIndexByState?.get(stateId) ?? 1,
    };
    const tightness = computeLabourTightness(demand, supplyByState.get(stateId));
    if (tightness !== undefined) {
      set["economic.labourTightness.value"] = roundTightness(tightness);
    }
    if (typeof turn === "number") set["economic.labourDemandTurn"] = turn;
    return { updateOne: { filter: { _id: stateId }, update: { $set: set } } };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.collection("macroMetrics").bulkWrite(ops as any[]);
}

/**
 * Phase 3c: Credit dividends to corporate shareholders (₳ amounts → recipient corp treasury currency).
 * Characters receive dividend auto-conversion via executeMarketMakerTrade below; corp treasuries keep
 * cash in home currency using the same anchor→local conversion as operating flows.
 *
 * Dividend income received by a corp is taxed at the recipient's home-country
 * federal rate applied to 50% of the received amount (dividend-received
 * deduction convention). State/regional tax never applies to dividend income.
 * The recipient's `liquidCapital` increments by the net (gross − tax); the
 * tax amount is logged to `dividendTaxPaidByCountry` so the turn metrics
 * stay auditable (written to the same-turn corporationHistory row below).
 *
 * Returns `dividendTaxPaidByCountry` (corpId → countryId → ₳) so the ledger
 * emission phase can fold the dividend-received tax into gov totals.
 */
export async function creditCorpDividends(args: {
  db: Db;
  lookups: CorporationLookups;
  corpDividendPaymentsAnchorByCorpId: Map<string, number>;
  corpDividendPaymentsAnchorByCorpCurrency: Map<string, Map<CurrencyCode, number>>;
  turn: number | undefined;
  now: Date;
  thresholds: TxThresholds;
}): Promise<{
  dividendTaxPaidByCountry: Map<string, Map<string, number>>;
  dividendIncomeReceivedByCorpId: Map<string, number>;
}> {
  const {
    db,
    lookups,
    corpDividendPaymentsAnchorByCorpId,
    corpDividendPaymentsAnchorByCorpCurrency,
    turn,
    now,
    thresholds,
  } = args;
  const dividendTaxPaidByCountry = new Map<string, Map<string, number>>();
  // Net dividend income (local ccy, per-turn) each corp received from holding
  // other corps' shares. Reporting-only: the cash is already credited to
  // liquidCapital above; this map is threaded to the Phase 8 history snapshot so
  // the corp Financials can surface it as a P&L line (issue #3109) WITHOUT
  // touching the cash-driving `income` field.
  const dividendIncomeReceivedByCorpId = new Map<string, number>();
  const corpDividendRecipientTxEntries: Omit<
    FinancialTxLogEntry,
    "_id" | "expiresAt" | "flagged"
  >[] = [];
  // FX spreads skimmed from corp shareholders' foreign-currency dividend income,
  // routed to the CB system after the credits apply (denominated in the paying
  // corp's currency). Same rate players pay on auto_dividend conversion.
  const corpDividendSpreadFees: Array<{
    fromCurrency: CurrencyCode;
    toCurrency: CurrencyCode;
    fee: number;
  }> = [];
  if (corpDividendPaymentsAnchorByCorpId.size > 0) {
    const corpDivOps: AnyBulkWriteOperation<Corporation>[] = [];
    for (const [recipientCorpIdStr, anchorAmount] of corpDividendPaymentsAnchorByCorpId) {
      if (!Number.isFinite(anchorAmount) || anchorAmount <= 0) continue;
      const recipient = lookups.corpById.get(recipientCorpIdStr);
      if (!recipient) continue;
      const resolved = resolveCorpLiquidCurrencyCode(recipient);
      const recipientCcy = (resolved ?? "USD") as CurrencyCode;
      const fx = fxRateForCorpFromMap(recipient, lookups.exchangeRatesByCurrency);
      // Skim the FX spread on the foreign-currency portion of this corp's
      // dividend income (per paying currency), BEFORE tax + credit so it can
      // never push the recipient negative. The fee is denominated in the paying
      // (outflow) currency and routed so the recipient's CB accrues it as a
      // foreign reserve.
      const byCcy = corpDividendPaymentsAnchorByCorpCurrency.get(recipientCorpIdStr);
      let foreignSpreadAnchor = 0;
      if (byCcy) {
        for (const [payerCcy, payerAnchor] of byCcy) {
          if (payerCcy === recipientCcy || !(payerAnchor > 0)) continue;
          const feeAnchor = payerAnchor * MARKET_MAKER_SPREAD;
          foreignSpreadAnchor += feeAnchor;
          const payerRate = lookups.exchangeRatesByCurrency.get(payerCcy) ?? 1;
          const fee = Math.round(feeAnchor * (payerRate > 0 ? payerRate : 1));
          if (fee > 0) {
            corpDividendSpreadFees.push({ fromCurrency: payerCcy, toCurrency: recipientCcy, fee });
          }
        }
      }
      const grossAfterSpread = Math.max(0, anchorAmount - foreignSpreadAnchor);
      // Federal tax on 50% of the received dividend at recipient's home country DOMESTIC rate
      // (received-corp-to-received-corp dividend is domestic from the recipient's perspective).
      const fedRate = lookups.domesticCorpTaxRateByCountry.get(recipient.countryId) ?? 0;
      const dividendTaxAnchor = grossAfterSpread * 0.5 * (fedRate / 100);
      const netAnchor = Math.max(0, grossAfterSpread - dividendTaxAnchor);
      const liquidInc = anchorToCorpCapital(netAnchor, resolved, fx);
      if (!Number.isFinite(liquidInc) || liquidInc <= 0) continue;
      dividendIncomeReceivedByCorpId.set(
        recipientCorpIdStr,
        (dividendIncomeReceivedByCorpId.get(recipientCorpIdStr) ?? 0) + Math.round(liquidInc)
      );
      corpDivOps.push({
        updateOne: {
          filter: { _id: recipient._id },
          update: {
            $inc: { liquidCapital: Math.round(liquidInc) },
            $set: { updatedAt: now },
          },
        },
      });
      if (dividendTaxAnchor > 0) {
        const perCorp =
          dividendTaxPaidByCountry.get(recipientCorpIdStr) ?? new Map<string, number>();
        perCorp.set(
          recipient.countryId,
          (perCorp.get(recipient.countryId) ?? 0) + dividendTaxAnchor
        );
        dividendTaxPaidByCountry.set(recipientCorpIdStr, perCorp);
      }

      // corp_dividend tx for the recipient corp. Pre-Phase-3 the only record
      // of corp→corp dividend flows lived in corporationHistory; the financial
      // ledger had no entry, so admin-side reconciliation could not see them.
      // Amount is the NET (post-domestic-tax) credit landing in liquidCapital,
      // matching the actual cash movement. The tax slice gets its own
      // corp_tax_paid + gov_tax_revenue rows in Task 3.3.
      if (resolved) {
        corpDividendRecipientTxEntries.push({
          type: "corp_dividend",
          turn: turn ?? 0,
          createdAt: now,
          subjectType: "corporation",
          subjectId: recipient._id,
          subjectName: recipient.name,
          amount: Math.round(liquidInc),
          currencyCode: resolved,
          counterpartyType: "corporation",
          meta: {
            grossAnchor: Math.round(anchorAmount),
            netAnchor: Math.round(netAnchor),
            dividendTaxAnchor: Math.round(dividendTaxAnchor),
          },
        });
      }
    }
    if (corpDivOps.length > 0) {
      await db.collection<Corporation>("corporations").bulkWrite(corpDivOps);
    }
    // Route the skimmed cross-currency dividend spreads into the CB system after
    // the credits land (reserve slice → recipient corp's CB; revenue → payer CB).
    for (const { fromCurrency, toCurrency, fee } of corpDividendSpreadFees) {
      await distributeConversionSpread(db, fee, fromCurrency, toCurrency);
    }
    if (corpDividendRecipientTxEntries.length > 0) {
      void emitTxBulk(db, corpDividendRecipientTxEntries, thresholds);
    }

    // The dividend-received-deduction tax is folded into the same-turn
    // corporationHistory row's federal/combined + domestic per-country tax
    // fields — but that row does not exist yet at this point in Phase 3c
    // (it is INSERTED in Phase 8 by snapshotMarketCap). An updateOne here would
    // therefore no-op (#3115), so instead we return `dividendTaxPaidByCountry`
    // and snapshotMarketCap folds it into the row at insert time (mirroring how
    // #3109 threads dividendIncomeReceived).
  }
  return { dividendTaxPaidByCountry, dividendIncomeReceivedByCorpId };
}

/**
 * Phase 4: Update domestic/foreign corporate profits tax bases: 75% GDP-derived + 25% actual
 * annualised corp income. Domestic = corp HQ'd in the sector's country; foreign = elsewhere.
 * Only applies where we have real corp data — jurisdictions with no HQ'd corps keep existing base.
 *
 * The 75% "GDP-derived floor" uses THIS COUNTRY's own authored GDP-share for each base -
 * `federalBudget.taxBaseGdpShareBaseline`, captured once at seed time from the country's
 * actual seeded `taxBases` (see `buildNationalBudgetSeed` in seeds/reference/budgets.ts) -
 * falling back to the generic `GDP_DOMESTIC_CORPORATE_FACTOR`/`GDP_FOREIGN_CORPORATE_FACTOR`
 * constants only for budgets that predate the baseline field. Fiscal-scale audit,
 * 2026-07-29: this used to floor EVERY country at the same universal 6%/2%-of-GDP split
 * regardless of what was seeded. A command economy's authored enterprise-surplus base (e.g.
 * 1953 Eastern Bloc, ~13.5%/4.5% of GDP - the "Total Surplus Remittance" mechanism, not
 * Western-style corporate profit) got crashed down to the generic 4.5%/1.5% floor within the
 * first in-game year (real corp income for these SOEs is near-zero, so the 25% "actual"
 * term barely moved it), silently erasing ~9 points of GDP in revenue the country was never
 * told it lost. The same universal floor pushed countries seeded BELOW 6%/2% (e.g. CN, at
 * 3%/1%) the other way, inflating their revenue instead. Either direction is a seed-value
 * override the player has no way to see or reverse - using the country's own baseline
 * fixes both directions at once without touching the blend's actual/GDP-floor ratio.
 *
 * Currency convention (v0.2.6 locked decision #3):
 *   - `taxBases.domesticCorporateProfits` / `taxBases.foreignCorporateProfits` are stored in
 *     the owning country's currency (JPY for JP, GBP for UK, USD for US). NOT in ₳.
 *   - `domesticIncomeByCountry` / `foreignIncomeByCountry` (and state variants) are ₳
 *     accumulators populated by `sectorCalculations.ts`, which normalizes every sector's
 *     operating income to anchor regardless of the owning corp's home currency. Cross-corp
 *     summation is always anchor-native.
 *   - `b.gdp` / `sb.stateGdp` are stored in the country's currency.
 *   - Multiply the ₳ accumulator by fxRate (country-local per 1 ₳) so the 25% "actual corp"
 *     weight lands in the same units as the 75% GDP-derived floor before they're blended.
 *   - USD path keeps fxRate=1.0 — no-op for corps / states in the anchor-currency country.
 */
export async function updateCorporateTaxBases(args: {
  db: Db;
  lookups: CorporationLookups;
  domesticIncomeByCountry: Map<string, number>;
  foreignIncomeByCountry: Map<string, number>;
  domesticIncomeByOperatingState: Map<string, number>;
  foreignIncomeByOperatingState: Map<string, number>;
}): Promise<void> {
  const {
    db,
    lookups,
    domesticIncomeByCountry,
    foreignIncomeByCountry,
    domesticIncomeByOperatingState,
    foreignIncomeByOperatingState,
  } = args;
  const fxForCountry = (countryId: string): number => {
    const code = COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP];
    if (!code) return 1.0;
    const rate = lookups.exchangeRatesByCurrency.get(code as CurrencyCode);
    return Number.isFinite(rate) && rate && rate > 0 ? rate : 1.0;
  };

  // Federal tax bases: split domestic/foreign. Each side blends 75% GDP-derived floor
  // (scaled by its own factor, 6% domestic / 2% foreign of GDP) with 25% actual annualized
  // corp income. A budget is written to if EITHER pool has contributions — the other side
  // falls back to just the GDP-floor.
  const federalTaxBaseOps: AnyBulkWriteOperation<FederalBudget>[] = lookups.federalBudgets
    .filter(
      (b): b is typeof b & { countryId: string } =>
        !!b.countryId &&
        (domesticIncomeByCountry.has(b.countryId) || foreignIncomeByCountry.has(b.countryId))
    )
    .map((b) => {
      const fxRate = fxForCountry(b.countryId);
      const domSharePct = b.taxBaseGdpShareBaseline?.domesticCorporateProfits;
      const forSharePct = b.taxBaseGdpShareBaseline?.foreignCorporateProfits;
      const domGdp =
        (b.gdp ?? 0) * (domSharePct != null ? domSharePct : GDP_DOMESTIC_CORPORATE_FACTOR);
      const forGdp =
        (b.gdp ?? 0) * (forSharePct != null ? forSharePct : GDP_FOREIGN_CORPORATE_FACTOR);
      const domActual = (domesticIncomeByCountry.get(b.countryId) ?? 0) * fxRate;
      const forActual = (foreignIncomeByCountry.get(b.countryId) ?? 0) * fxRate;
      const domBlended = domGdp * 0.75 + domActual * 0.25;
      const forBlended = forGdp * 0.75 + forActual * 0.25;
      return {
        updateOne: {
          filter: { _id: b._id },
          update: {
            $set: {
              "taxBases.domesticCorporateProfits": domBlended,
              "taxBases.foreignCorporateProfits": forBlended,
            },
          },
        },
      };
    });
  if (federalTaxBaseOps.length > 0) {
    await db.collection<FederalBudget>("federalBudget").bulkWrite(federalTaxBaseOps);
  }

  // State tax bases: same split treatment. A state gets written to if it has any
  // domestic OR foreign corp activity in this turn.
  // NOTE: unlike the federal path above, this still floors on the universal
  // GDP_DOMESTIC/FOREIGN_CORPORATE_FACTOR constants - StateBudget has no
  // per-state equivalent of taxBaseGdpShareBaseline yet. Known residual from
  // the 2026-07-29 fiscal-scale audit; state-level seeds were not found to
  // author a divergent corporate-base ratio the way the 1953 Eastern Bloc
  // federal seeds do, so this is lower-priority than the federal fix but not
  // proven safe for every state seed - flag before relying on state-level
  // corporate tax-base shares in a command economy.
  const operatingStates = Array.from(
    new Set([...domesticIncomeByOperatingState.keys(), ...foreignIncomeByOperatingState.keys()])
  );
  if (operatingStates.length > 0) {
    const operatingStateBudgets = await db
      .collection<StateBudget>("stateBudgets")
      .find({ _id: { $in: operatingStates } }, { projection: { _id: 1, stateGdp: 1 } })
      .toArray();
    const stateTaxBaseOps: AnyBulkWriteOperation<StateBudget>[] = operatingStateBudgets.map(
      (sb) => {
        const countryId = lookups.stateCountryMap.get(sb._id);
        const fxRate = countryId ? fxForCountry(countryId) : 1.0;
        const domGdp = (sb.stateGdp ?? 0) * GDP_DOMESTIC_CORPORATE_FACTOR;
        const forGdp = (sb.stateGdp ?? 0) * GDP_FOREIGN_CORPORATE_FACTOR;
        const domActual = (domesticIncomeByOperatingState.get(sb._id) ?? 0) * fxRate;
        const forActual = (foreignIncomeByOperatingState.get(sb._id) ?? 0) * fxRate;
        const domBlended = domGdp * 0.75 + domActual * 0.25;
        const forBlended = forGdp * 0.75 + forActual * 0.25;
        return {
          updateOne: {
            filter: { _id: sb._id },
            update: {
              $set: {
                "taxBases.domesticCorporateProfits": domBlended,
                "taxBases.foreignCorporateProfits": forBlended,
              },
            },
          },
        };
      }
    );
    if (stateTaxBaseOps.length > 0) {
      await db.collection<StateBudget>("stateBudgets").bulkWrite(stateTaxBaseOps);
    }
  }

  // Phase 4b: Diagnostic — per-turn split of annualized operating income by domestic/foreign.
  // Staged post-split so we can eyeball the 75/25 bootstrap ratio settling toward actuals.
  // Remove or gate behind a flag if log volume becomes noisy.
  {
    let totalDomestic = 0;
    let totalForeign = 0;
    for (const v of domesticIncomeByCountry.values()) totalDomestic += v;
    for (const v of foreignIncomeByCountry.values()) totalForeign += v;
    if (totalDomestic > 0 || totalForeign > 0) {
      console.log(
        `[corp-turn] income split (annualized ₳): domestic=${Math.round(totalDomestic)} foreign=${Math.round(totalForeign)}`
      );
    }
  }
}

/**
 * Emit corp_revenue (per corp) + corp_salary + corp_dividend (per character)
 * + corp_tax_paid (per corp) + gov_tax_revenue (per country).
 *
 * Pre-Phase-3 the route emitted a single fund_credit row per (character,
 * currency) carrying mixed CEO salary + dividend amounts under
 * `meta.source = "corp_income"`. That made it impossible to split the two
 * flows in admin queries — and CEO salary forensics in particular needed
 * to distinguish "this came from MY corp's wage bill" from "this came as
 * shareholder dividend on a corp I don't run". Phase 3 splits them by
 * walking ceoSalaryPayments and dividendPayments separately so each
 * payment kind gets its own tx row with the matching counterparty corp.
 *
 * Tax flows were entirely off-ledger pre-Phase-3 — only the budget tax
 * bases got updated. Phase 3 emits both sides: `corp_tax_paid` per corp
 * (the deduction) and `gov_tax_revenue` per (country, taxType) (the
 * collection). The amount on each corp row is the sum of federal + state
 * tax paid by that corp this turn, in the corp's home currency. Per-country
 * gov_tax_revenue rows aggregate operating tax across every corp HQ'd in
 * or operating in that country — including the dividend-received tax slice
 * accumulated in `dividendTaxPaidByCountry`.
 * Fire-and-forget — must not throw into the turn pipeline.
 */
export async function emitCorporationTurnTx(args: {
  db: Db;
  lookups: CorporationLookups;
  corpSnapshots: CorpSnapshot[];
  ceoSalaryPayments: Map<string, Map<CurrencyCode, number>>;
  dividendPayments: Map<string, Map<CurrencyCode, number>>;
  dividendTaxPaidByCountry: Map<string, Map<string, number>>;
  turn: number | undefined;
  now: Date;
  thresholds: TxThresholds;
}): Promise<void> {
  const {
    db,
    lookups,
    corpSnapshots,
    ceoSalaryPayments,
    dividendPayments,
    dividendTaxPaidByCountry,
    turn,
    now,
    thresholds,
  } = args;
  const txEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];

  // Aggregate gov tax across corps. Keyed by countryId; values are anchor
  // units (₳) until emitted, since each country's tax revenue is a
  // currency-specific quantity that we display in country-local currency.
  const govTaxAnchorByCountry = new Map<string, number>();

  // corp_revenue + corp_tax_paid — one each per profitable corp this turn
  for (const snap of corpSnapshots) {
    const corp = lookups.corpById.get(snap.corpId.toString());
    if (!corp) continue;
    const resolved = resolveCorpLiquidCurrencyCode(corp);
    if (!resolved) continue;
    const fx = fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency);

    // Aggregate this corp's tax into the country totals (anchor units).
    // Walk taxPaidByCountry directly so multi-country sectors are split
    // across the right governments rather than lumped into the HQ country.
    for (const [countryId, taxAnchor] of snap.taxPaidByCountry) {
      if (taxAnchor <= 0) continue;
      govTaxAnchorByCountry.set(countryId, (govTaxAnchorByCountry.get(countryId) ?? 0) + taxAnchor);
    }

    const totalTaxAnchor = (snap.federalTaxPaid ?? 0) + (snap.stateTaxPaid ?? 0);

    // Emit corp_revenue at the PRE-TAX operating inflow (ticket #1260).
    //
    // `snap.income` is ALREADY net of corporate tax — the chain in
    // sectorCalculations is `incomePreDividends − tax − dividends = income`.
    // Crediting that net figure here and then debiting the full tax again in
    // the `corp_tax_paid` row below booked the tax TWICE on the corp's own
    // ledger, so its rows netted to `income − tax` instead of `income`. On
    // live Value Mart (IT #80) that read as −₤1.9M/turn for a corp whose cash
    // actually moved +₤70, and any corp whose tax exceeded its post-tax income
    // — 154 of 305 NPP corps and 24 of 47 player-run corps at turn 581 —
    // showed as loss-making on a turn it genuinely earned money.
    //
    // The corp side of this phase emits ONLY these two rows: `corp_salary` and
    // `corp_dividend` are character-side credits with no corp-side debit (see
    // emitCharRecipientTx below). So the pair must net to the cash the corp
    // actually keeps, which means crediting gross and letting the tax row take
    // it back out once. That also keeps `corp_revenue` an honest
    // `sector_revenue` mint and `corp_tax_paid` an honest transfer to
    // `gov_tax_revenue`, which is what the money-supply reconciler in
    // `deriveFromTx` assumes of the pair.
    //
    // Gate on the gross inflow, not on `snap.income`: a corp whose tax wiped
    // out its whole post-tax income still received that income, and the old
    // `income > 0` gate suppressed the credit while still emitting the debit,
    // leaving a lone tax row that understated cash by the full tax.
    const revenueAnchorPreTax = snap.income + Math.max(0, totalTaxAnchor);
    if (revenueAnchorPreTax > 0) {
      const incomeLocal = anchorToCorpCapital(revenueAnchorPreTax, resolved, fx);
      if (incomeLocal > 0) {
        txEntries.push({
          type: "corp_revenue",
          turn: turn ?? 0,
          createdAt: now,
          subjectType: "corporation",
          subjectId: corp._id,
          subjectName: corp.name,
          amount: Math.round(incomeLocal),
          currencyCode: resolved,
          meta: {
            revenue: Math.round(snap.revenue),
            federalTaxPaid: Math.round(snap.federalTaxPaid),
            stateTaxPaid: Math.round(snap.stateTaxPaid),
            // The post-tax figure the credit is grossed up from, so forensics
            // can still see retained cash without re-deriving it from the pair.
            netIncomeAfterTax: Math.round(snap.income),
          },
        });
      }
    }

    // Emit corp_tax_paid as a NEGATIVE-amount debit on the corp, in the
    // corp's home currency. Combines federal + state into one row so admin
    // queries can sum cleanly; meta carries the breakdown for forensics.
    if (totalTaxAnchor > 0) {
      const taxLocal = anchorToCorpCapital(totalTaxAnchor, resolved, fx);
      if (taxLocal > 0) {
        txEntries.push({
          type: "corp_tax_paid",
          turn: turn ?? 0,
          createdAt: now,
          subjectType: "corporation",
          subjectId: corp._id,
          subjectName: corp.name,
          amount: -Math.round(taxLocal),
          currencyCode: resolved,
          counterpartyType: "government",
          meta: {
            federalTaxPaid: Math.round(snap.federalTaxPaid),
            stateTaxPaid: Math.round(snap.stateTaxPaid),
            perCountryAnchor: Object.fromEntries(snap.taxPaidByCountry),
            perStateAnchor: Object.fromEntries(snap.taxPaidByState),
          },
        });
      }
    }

    // Per-turn escrow funding sweep (treasury → escrow). Internal,
    // money-conserving move; logged for admin cash forensics only.
    const escrowFundingEntry = buildEscrowFundingTxEntry({
      corpId: corp._id,
      corpName: corp.name,
      currencyCode: resolved,
      turn: turn ?? 0,
      createdAt: now,
      escrowFundingMove: snap.escrowFundingMove,
      escrowBalanceAfter: snap.escrowBalanceAfter,
    });
    if (escrowFundingEntry) txEntries.push(escrowFundingEntry);
  }

  // Fold dividend-received tax (computed in Phase 3c) into the gov totals.
  // dividendTaxPaidByCountry is keyed corpId → countryId → anchor amount.
  for (const [, perCountry] of dividendTaxPaidByCountry) {
    for (const [countryId, taxAnchor] of perCountry) {
      if (taxAnchor <= 0) continue;
      govTaxAnchorByCountry.set(countryId, (govTaxAnchorByCountry.get(countryId) ?? 0) + taxAnchor);
    }
  }

  // Emit one gov_tax_revenue row per country in country-local currency.
  for (const [countryId, taxAnchor] of govTaxAnchorByCountry) {
    const currency = (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
      "USD") as CurrencyCode;
    const fxRate = lookups.exchangeRatesByCurrency.get(currency);
    if (!fxRate || fxRate <= 0) continue;
    const taxLocal = taxAnchor * fxRate;
    if (taxLocal <= 0) continue;
    txEntries.push({
      type: "gov_tax_revenue",
      turn: turn ?? 0,
      createdAt: now,
      subjectType: "government",
      countryId,
      subjectName: `${countryId} Government`,
      amount: Math.round(taxLocal),
      currencyCode: currency,
      counterpartyType: "corporation",
      meta: {
        taxAnchor: Math.round(taxAnchor),
        source: "corp_operating_plus_dividend_received",
      },
    });
  }

  // Resolve names for both regular and imperial recipients in one batch each.
  const allRegularIds: ObjectId[] = [];
  const allImperialIds: ObjectId[] = [];
  for (const map of [ceoSalaryPayments, dividendPayments]) {
    for (const id of map.keys()) {
      if (id.startsWith("imperial:")) {
        allImperialIds.push(new ObjectId(id.slice("imperial:".length)));
      } else if (id.startsWith("npp:")) {
        // NPP recipients are parties, not characters. Their funds are credited
        // via the npps bulkWrite above, they have no character/imperial name to
        // resolve, and emitCharRecipientTx skips them. The raw key here is the
        // unstripped "npp:<id>" string, so feeding it to new ObjectId() would
        // throw BSONError and abort the entire corporation turn — skip it.
        continue;
      } else {
        allRegularIds.push(new ObjectId(id));
      }
    }
  }
  const [regularNameDocs, imperialNameDocs] = await Promise.all([
    allRegularIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: allRegularIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<Character, "_id" | "name">[]),
    allImperialIds.length > 0
      ? db
          .collection<ImperialCharacter>("imperialCharacters")
          .find({ _id: { $in: allImperialIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([] as Pick<ImperialCharacter, "_id" | "name">[]),
  ]);
  const regularNameById = new Map(regularNameDocs.map((c) => [c._id.toString(), c.name as string]));
  const imperialNameById = new Map(
    imperialNameDocs.map((c) => [c._id.toString(), c.name as string])
  );

  // For dividend tx, we'd love to attribute each row to a single paying
  // corp. The map shape doesn't carry that — `dividendPayments` is keyed by
  // recipient, not by source. We log the aggregate here and rely on
  // `corporationHistory.dividendPaidPerTurn` for the source-corp breakdown.
  // counterpartyName is left unset for the same reason.
  const emitCharRecipientTx = (
    paymentMap: Map<string, Map<CurrencyCode, number>>,
    txType: "corp_salary" | "corp_dividend",
    metaSource: string
  ) => {
    for (const [id, currencyAmounts] of paymentMap) {
      const isImperial = id.startsWith("imperial:");
      const cleanId = isImperial ? id.slice("imperial:".length) : id;
      const name = isImperial ? imperialNameById.get(cleanId) : regularNameById.get(cleanId);
      if (!name) continue;
      for (const [currency, amount] of currencyAmounts) {
        if (amount <= 0) continue;
        txEntries.push({
          type: txType,
          turn: turn ?? 0,
          createdAt: now,
          subjectType: "character",
          subjectId: new ObjectId(cleanId),
          subjectName: name,
          amount,
          currencyCode: currency,
          counterpartyType: "corporation",
          meta: {
            source: metaSource,
            ...(isImperial ? { imperial: true } : {}),
          },
        });
      }
    }
  };

  emitCharRecipientTx(ceoSalaryPayments, "corp_salary", "corp_salary");
  emitCharRecipientTx(dividendPayments, "corp_dividend", "corp_dividend");

  if (txEntries.length > 0) {
    // LOC underwriting now reads recurring personal income from these tx rows.
    // Keep the salary/dividend ledger durable instead of fire-and-forget so a
    // dropped audit write cannot silently shrink a borrower's verified income history.
    await emitTxBulk(db, txEntries, thresholds);
  }
}
