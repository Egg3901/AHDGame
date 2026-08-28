/**
 * NPP Fund Generation Turn Phase
 *
 * Processes fund generation for all active Non-Player Politicians each turn.
 * Uses 50% of player rate with diminishing returns, applies party taxes,
 * and grants 2 action points per turn (capped at 100).
 */

import type { Db, ObjectId } from "mongodb";
import type {
  NPP,
  StatePartyOrg,
  PoliticalParty,
  State,
  GameConfig,
  Character,
} from "@/lib/db/types";
import { projectNppGeneration, calculateTaxAmount } from "@/lib/utils/fundGeneration";
import { campaignAnchorToLocal, campaignLocalRate } from "@/lib/campaigns/campaignCurrency";
import { DEFAULT_NPP_STATE_TAX_RATE } from "@/lib/constants/partyOrg";
import {
  emitTreasuryTransactionsBulk,
  type BulkTreasuryTransactionArgs,
} from "@/lib/treasury/emit";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

/*
 * NPPs receive 2 action points per turn (vs. 3+ for player characters). The
 * reduced rate models that NPPs are autonomous agents without direct player
 * investment — they act less frequently and with less intensity. The 100-point
 * cap (half the player cap of 200) keeps NPP action stockpiles manageable and
 * prevents NPPs from accumulating enough points to dominate expensive actions
 * if left unprocessed for multiple turns.
 */
const NPP_ACTIONS_PER_TURN = 2;
const NPP_ACTION_CAP = 100;
const BATCH_SIZE = 100;

export interface NppFundGenerationResult {
  nppsProcessed: number;
  totalGenerated: number;
  totalStateTax: number;
  totalNationalTax: number;
}

/**
 * @param db - Database connection
 * @param currentTurn - Current turn number
 * @param preloadedStateMap - Optional pre-loaded state map to avoid duplicate DB query
 */
export async function processNppFundGeneration(
  db: Db,
  currentTurn: number,
  preloadedStateMap?: Map<string, State>
): Promise<NppFundGenerationResult> {
  const config = await db.collection<GameConfig>("gameConfig").findOne({ _id: "default" });
  // NPP economy is on by default; only an explicit `false` disables it.
  if (config?.nppEconomyEnabled === false) {
    return { nppsProcessed: 0, totalGenerated: 0, totalStateTax: 0, totalNationalTax: 0 };
  }

  const stateMap =
    preloadedStateMap ??
    new Map((await db.collection<State>("states").find({}).toArray()).map((s) => [s._id, s]));

  const parties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
  const partyBySequentialId = new Map(
    parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p])
  );
  const statePartyOrgs = await db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray();
  const statePartyMap = new Map(statePartyOrgs.map((sp) => [`${sp.stateId}_${sp.partyId}`, sp]));

  const characters = await db
    .collection<Character>("characters")
    .find({ party: { $ne: "independent" } })
    .project<{ homeState: string; party: string }>({ homeState: 1, party: 1 })
    .toArray();
  const statePartiesWithPlayers = new Set(characters.map((c) => `${c.homeState}_${c.party}`));

  let nppsProcessed = 0;
  let totalGenerated = 0;
  let totalStateTax = 0;
  let totalNationalTax = 0;

  const nationalTreasuryUpdates = new Map<string, { amount: number; _id: ObjectId }>();
  const stateTreasuryUpdates = new Map<string, number>();
  const statePartiesToSetDefaultTax = new Set<string>();

  // Technocrat NPPs (e.g. autonomous central-bank chairs) are excluded via
  // isTechnocrat: { $ne: true } — they don't generate political campaign funds.
  const cursor = db.collection<NPP>("npps").find({ retiredAt: null, isTechnocrat: { $ne: true } });
  let batch: NPP[] = [];

  const processBatch = async (npps: NPP[]) => {
    const nppOps: {
      updateOne: {
        filter: { _id: ObjectId };
        update: {
          $inc: { funds: number };
          $set: { actionPoints: number; lastActionProcessedTurn: number };
        };
      };
    }[] = [];

    for (const npp of npps) {
      const state = stateMap.get(npp.homeState);
      if (!state) continue;

      const finite = (v: number | undefined | null) => (Number.isFinite(v) ? (v as number) : 0);
      // npp.funds is stored in LOCAL home currency. NPP funds are decoupled from
      // live forex: the anchor generation is denominated to local at the frozen
      // base INITIAL_RATES scale (US ×1.0). To keep the diminishing-returns soft
      // cap triggering at the same economic scale in every country, feed the
      // curve the ANCHOR-EQUIVALENT balance (localFunds ÷ rate).
      const rate = campaignLocalRate(npp.countryId ?? "US");
      const currentFundsLocal = finite(npp.funds);
      const currentFundsAnchor = rate > 0 ? currentFundsLocal / rate : currentFundsLocal;
      const donorBaseLevel = finite(npp.donorBaseLevel);
      const grossAnchor = projectNppGeneration({
        population: state.population,
        donorBaseLevel,
        currentFundsLocal: currentFundsAnchor,
        // This phase early-returns when the economy is disabled, so it only
        // reaches here when enabled.
        nppEconomyEnabled: true,
      });
      const grossFundsLocal = campaignAnchorToLocal(grossAnchor, npp.countryId ?? "US");

      const currentActions = finite(npp.actionPoints);
      const newActions = Math.min(NPP_ACTION_CAP, currentActions + NPP_ACTIONS_PER_TURN);

      let stateTaxAmountLocal = 0;
      let nationalTaxAmountLocal = 0;

      if (npp.party !== "independent") {
        const partyKey = `${npp.countryId ?? "US"}:${npp.party}`;
        const party = partyBySequentialId.get(partyKey);
        const nationalTaxRate = party?.nationalTaxRate ?? 0;

        const statePartyKey = `${npp.homeState}_${npp.party}`;
        const stateParty = statePartyMap.get(statePartyKey);
        const hasPlayersInStateParty = statePartiesWithPlayers.has(statePartyKey);
        const currentTaxRate = stateParty?.stateTaxRate ?? 0;

        let stateTaxRate = currentTaxRate;
        if (!hasPlayersInStateParty && currentTaxRate === 0) {
          stateTaxRate = DEFAULT_NPP_STATE_TAX_RATE;
          if (stateParty) {
            statePartiesToSetDefaultTax.add(statePartyKey);
          }
        }

        // Tax computed against local income → local tax amount → credited to
        // local-denominated party treasury. All same currency.
        stateTaxAmountLocal = calculateTaxAmount(grossFundsLocal, stateTaxRate);
        nationalTaxAmountLocal = calculateTaxAmount(grossFundsLocal, nationalTaxRate);

        if (stateTaxAmountLocal > 0) {
          stateTreasuryUpdates.set(
            statePartyKey,
            (stateTreasuryUpdates.get(statePartyKey) ?? 0) + stateTaxAmountLocal
          );
        }

        if (nationalTaxAmountLocal > 0 && party) {
          const key = String(party._id);
          const existing = nationalTreasuryUpdates.get(key);
          nationalTreasuryUpdates.set(key, {
            amount: (existing?.amount ?? 0) + nationalTaxAmountLocal,
            _id: party._id,
          });
        }
      }

      const netFundsLocal = grossFundsLocal - stateTaxAmountLocal - nationalTaxAmountLocal;

      totalGenerated += grossFundsLocal;
      totalStateTax += stateTaxAmountLocal;
      totalNationalTax += nationalTaxAmountLocal;

      nppOps.push({
        updateOne: {
          filter: { _id: npp._id },
          update: {
            $inc: { funds: netFundsLocal },
            $set: { actionPoints: newActions, lastActionProcessedTurn: currentTurn },
          },
        },
      });
    }

    if (nppOps.length > 0) {
      await db.collection<NPP>("npps").bulkWrite(nppOps);
    }

    nppsProcessed += nppOps.length;
  };

  for await (const npp of cursor) {
    batch.push(npp);
    if (batch.length >= BATCH_SIZE) {
      await processBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await processBatch(batch);
  }

  const partyDuesTxEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];
  const nationalTreasuryTxEntries: BulkTreasuryTransactionArgs[] = [];
  const stateTreasuryTxEntries: BulkTreasuryTransactionArgs[] = [];
  const now = new Date();

  if (nationalTreasuryUpdates.size > 0) {
    const partyOps = [...nationalTreasuryUpdates.values()].map(({ amount, _id }) => ({
      updateOne: {
        filter: { _id },
        update: { $inc: { treasury: amount } },
      },
    }));
    await db.collection<PoliticalParty>("politicalParties").bulkWrite(partyOps);

    const partyById = new Map(parties.map((p) => [String(p._id), p]));
    for (const { amount, _id } of nationalTreasuryUpdates.values()) {
      const party = partyById.get(String(_id));
      if (!party) continue;

      nationalTreasuryTxEntries.push({
        countryId: (party.countryId ?? "US") as BulkTreasuryTransactionArgs["countryId"],
        partyId: String(party.sequentialId),
        holderType: "party",
        holderId: String(party.sequentialId),
        category: "fund_generation",
        direction: "credit",
        amount,
        memo: `National tax (${party.nationalTaxRate ?? 0}%) on NPP fund generation`,
        turn: currentTurn,
        now,
      });

      const currency = (COUNTRY_CURRENCY_MAP[
        (party.countryId ?? "US") as keyof typeof COUNTRY_CURRENCY_MAP
      ] ?? "USD") as CurrencyCode;
      partyDuesTxEntries.push({
        type: "party_dues_received",
        turn: currentTurn,
        createdAt: now,
        subjectType: "party",
        subjectId: _id,
        subjectName: party.name,
        amount,
        currencyCode: currency,
        counterpartyType: "system",
        counterpartyName: "NPP fund generation tax",
        meta: { scope: "national", source: "npp_national_tax" },
      });
    }
    await emitTreasuryTransactionsBulk(db, nationalTreasuryTxEntries);
  }

  if (stateTreasuryUpdates.size > 0) {
    const statePartyOps = [...stateTreasuryUpdates.entries()].map(([statePartyKey, amount]) => ({
      updateOne: {
        filter: { _id: statePartyKey },
        update: { $inc: { treasury: amount } },
      },
    }));
    await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(statePartyOps);

    for (const [statePartyKey, amount] of stateTreasuryUpdates.entries()) {
      const sp = statePartyMap.get(statePartyKey);
      if (!sp) continue;

      stateTreasuryTxEntries.push({
        countryId: (sp.countryId ?? "US") as BulkTreasuryTransactionArgs["countryId"],
        partyId: sp.partyId,
        holderType: "state_party",
        holderId: statePartyKey,
        category: "fund_generation",
        direction: "credit",
        amount,
        memo: `State tax (${sp.stateTaxRate ?? 0}%) on NPP fund generation`,
        turn: currentTurn,
        now,
      });

      const countryId = sp.countryId ?? stateMap.get(sp.stateId)?.countryId ?? "US";
      const currency = (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
        "USD") as CurrencyCode;
      partyDuesTxEntries.push({
        type: "party_dues_received",
        turn: currentTurn,
        createdAt: now,
        subjectType: "party",
        subjectName: `${sp.stateId}:${sp.partyId}`,
        amount,
        currencyCode: currency,
        counterpartyType: "system",
        counterpartyName: "NPP fund generation tax",
        meta: {
          scope: "state",
          statePartyKey,
          stateId: sp.stateId,
          partyId: sp.partyId,
          source: "npp_state_tax",
        },
      });
    }
    await emitTreasuryTransactionsBulk(db, stateTreasuryTxEntries);
  }

  if (partyDuesTxEntries.length > 0) {
    const thresholds = await loadTxThresholds(db);
    await emitTxBulk(db, partyDuesTxEntries, thresholds);
  }

  if (statePartiesToSetDefaultTax.size > 0) {
    const taxRateOps = [...statePartiesToSetDefaultTax].map((statePartyKey) => ({
      updateOne: {
        filter: { _id: statePartyKey },
        update: { $set: { stateTaxRate: DEFAULT_NPP_STATE_TAX_RATE } },
      },
    }));
    await db.collection<StatePartyOrg>("statePartyOrg").bulkWrite(taxRateOps);
  }

  return { nppsProcessed, totalGenerated, totalStateTax, totalNationalTax };
}
