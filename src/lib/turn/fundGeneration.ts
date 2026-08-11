import * as Sentry from "@sentry/nextjs";
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  Character,
  State,
  PoliticalParty as PoliticalPartyType,
  StatePartyOrg,
} from "@/lib/db/types";
import { projectCharacterGeneration, calculateTaxAmount } from "@/lib/utils/fundGeneration";
import { campaignAnchorToLocal } from "@/lib/campaigns/campaignCurrency";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import type { AnyBulkWriteOperation } from "mongodb";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import {
  emitTreasuryTransactionsBulk,
  type BulkTreasuryTransactionArgs,
} from "@/lib/treasury/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";

/**
 * Process fund generation for all characters each turn.
 * Calculates base + donor base + office bonuses, applies national and state
 * party taxes, and distributes remainder to character funds and treasuries.
 *
 * @param characters - All characters to process
 * @param now - Current game time
 * @param preloadedStateMap - Optional pre-loaded state map to avoid duplicate DB query
 */
export async function processFundGeneration(
  characters: Character[],
  now: Date,
  preloadedStateMap?: Map<string, State>,
  forexEnabled?: boolean,
  turn?: number
): Promise<{
  totalGenerated: number;
  totalStateTaxes: number;
  totalNationalTaxes: number;
}> {
  return Sentry.startSpan(
    {
      name: "turn.fundGeneration",
      op: "turn.phase",
      attributes: { turn: turn ?? 0, characterCount: characters.length },
    },
    async () => {
      const db = await getDb();

      const stateMap =
        preloadedStateMap ??
        new Map((await db.collection<State>("states").find({}).toArray()).map((s) => [s._id, s]));

      // Use composite keys to avoid cross-country sequential ID collisions
      const parties = await db
        .collection<PoliticalPartyType>("politicalParties")
        .find({})
        .toArray();
      const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p]));

      const statePartyOrgs = await db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray();
      const statePartyMap = new Map(
        statePartyOrgs.map((sp) => [`${sp.stateId}_${sp.partyId}`, sp])
      );

      let totalGenerated = 0;
      let totalStateTaxes = 0;
      let totalNationalTaxes = 0;

      const nationalTreasuryUpdates = new Map<string, { amount: number; _id: ObjectId }>();
      const stateTreasuryUpdates = new Map<string, number>();
      const characterOps: AnyBulkWriteOperation<Character>[] = [];
      // Both branches write the credit (totalFundGeneration / characterReceives) to
      // whichever local-currency field holds the truth. Forex on → the home-
      // currency stored balance; forex off → the legacy `funds` field. Phase 5 of
      // cf-inconsistency-fix dropped the dual-write to the anchor mirror entirely.
      const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
      // tx log accumulators
      const txCharEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];
      const taxByCountry = new Map<string, { stateTaxTotal: number; nationalTaxTotal: number }>();
      const nationalTreasuryTxEntries: BulkTreasuryTransactionArgs[] = [];
      const stateTreasuryTxEntries: BulkTreasuryTransactionArgs[] = [];

      for (const character of characters) {
        const state = stateMap.get(character.homeState);
        if (!state) continue;

        // Generation constants are anchor (₳); campaign funds are stored LOCAL and
        // are decoupled from live forex. Denominate to local at the frozen base
        // INITIAL_RATES scale (US ×1.0). All downstream math (taxes, characterReceives,
        // tx amounts, treasury credits) then operates in local.
        const totalFundGenerationAnchor = projectCharacterGeneration({
          population: state.population,
          donorBaseLevel: character.donorBaseLevel,
          currentOffice: character.currentOffice,
          stateGdpMillions: state.gdp,
          countryId: character.countryId,
          politicalInfluence: character.politicalInfluence ?? 0,
        });
        const totalFundGeneration = campaignAnchorToLocal(
          totalFundGenerationAnchor,
          character.countryId ?? "US"
        );

        if (character.party === "independent") {
          totalGenerated += totalFundGeneration;
          characterOps.push({
            updateOne: {
              filter: { _id: character._id },
              update: { $inc: { [campaignFundsField]: totalFundGeneration } },
            },
          });
          if (totalFundGeneration > 0) {
            txCharEntries.push({
              type: "office_income",
              turn: turn ?? 0,
              createdAt: now,
              subjectType: "character",
              subjectId: character._id,
              subjectName: character.name,
              amount: totalFundGeneration,
              currencyCode: getHomeCurrency(character),
              meta: { source: "income" },
            });
          }
          continue;
        }

        const partyKey = `${character.countryId ?? "US"}:${character.party}`;
        const party = partyMap.get(partyKey);
        const nationalTaxRate = party?.nationalTaxRate ?? 0;

        const statePartyKey = `${character.homeState}_${character.party}`;
        const stateParty = statePartyMap.get(statePartyKey);
        const stateTaxRate = stateParty?.stateTaxRate ?? 0;

        const stateTaxAmount = calculateTaxAmount(totalFundGeneration, stateTaxRate);
        const nationalTaxAmount = calculateTaxAmount(totalFundGeneration, nationalTaxRate);
        const characterReceives = totalFundGeneration - stateTaxAmount - nationalTaxAmount;

        totalGenerated += totalFundGeneration;
        totalStateTaxes += stateTaxAmount;
        totalNationalTaxes += nationalTaxAmount;

        characterOps.push({
          updateOne: {
            filter: { _id: character._id },
            update: { $inc: { [campaignFundsField]: characterReceives } },
          },
        });

        if (characterReceives > 0) {
          txCharEntries.push({
            type: "office_income",
            turn: turn ?? 0,
            createdAt: now,
            subjectType: "character",
            subjectId: character._id,
            subjectName: character.name,
            amount: characterReceives,
            currencyCode: getHomeCurrency(character),
            meta: { source: "income" },
          });
        }
        // Accumulate taxes per country for gov_tax_revenue event
        const cid = character.countryId ?? "US";
        const taxBucket = taxByCountry.get(cid) ?? { stateTaxTotal: 0, nationalTaxTotal: 0 };
        taxBucket.stateTaxTotal += stateTaxAmount;
        taxBucket.nationalTaxTotal += nationalTaxAmount;
        taxByCountry.set(cid, taxBucket);

        if (stateTaxAmount > 0) {
          stateTreasuryUpdates.set(
            statePartyKey,
            (stateTreasuryUpdates.get(statePartyKey) ?? 0) + stateTaxAmount
          );
        }
        if (nationalTaxAmount > 0 && party) {
          const key = String(party._id);
          const existing = nationalTreasuryUpdates.get(key);
          nationalTreasuryUpdates.set(key, {
            amount: (existing?.amount ?? 0) + nationalTaxAmount,
            _id: party._id,
          });
        }
      }

      if (characterOps.length > 0) {
        await db.collection<Character>("characters").bulkWrite(characterOps);
      }

      if (nationalTreasuryUpdates.size > 0) {
        const partyOps = [...nationalTreasuryUpdates.values()].map(({ amount, _id }) => ({
          updateOne: {
            filter: { _id },
            update: { $inc: { treasury: amount }, $set: { updatedAt: now } },
          },
        }));
        await db.collection<PoliticalPartyType>("politicalParties").bulkWrite(partyOps);

        // Emit per-party treasury audit rows. Fund-generation aggregates a
        // turn's worth of national-tax dues; one credit row per party.
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
            memo: `National tax (${party.nationalTaxRate ?? 0}%) on member fund generation`,
            turn: turn ?? 0,
            now,
          });
        }
        await emitTreasuryTransactionsBulk(db, nationalTreasuryTxEntries);
      }

      if (stateTreasuryUpdates.size > 0) {
        const statePartyOps = [...stateTreasuryUpdates.entries()].map(
          ([statePartyKey, amount]) => ({
            updateOne: {
              filter: { _id: statePartyKey },
              update: { $inc: { treasury: amount }, $set: { updatedAt: now } },
            },
          })
        );
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
            memo: `State tax (${sp.stateTaxRate ?? 0}%) on member fund generation`,
            turn: turn ?? 0,
            now,
          });
        }
        await emitTreasuryTransactionsBulk(db, stateTreasuryTxEntries);
      }

      // Emit office_income entries + gov_tax_revenue per country
      if (txCharEntries.length > 0 || taxByCountry.size > 0) {
        const thresholds = await loadTxThresholds(db);
        const govEntries = [...taxByCountry.entries()]
          .filter(([, t]) => t.stateTaxTotal + t.nationalTaxTotal > 0)
          .map(([cid, t]) => ({
            type: "gov_tax_revenue" as const,
            turn: turn ?? 0,
            createdAt: now,
            subjectType: "government" as const,
            countryId: cid,
            subjectName: `${cid} Government`,
            amount: t.stateTaxTotal + t.nationalTaxTotal,
            currencyCode: (COUNTRY_CURRENCY_MAP[cid as keyof typeof COUNTRY_CURRENCY_MAP] ??
              "USD") as CurrencyCode,
            meta: { stateTaxTotal: t.stateTaxTotal, nationalTaxTotal: t.nationalTaxTotal },
          }));
        void emitTxBulk(db, [...txCharEntries, ...govEntries], thresholds);
      }

      return { totalGenerated, totalStateTaxes, totalNationalTaxes };
    }
  );
}
