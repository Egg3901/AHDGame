/**
 * Per-turn caucus tax pass.
 *
 * Each active caucus with `taxRate > 0` levies that percentage against every
 * active member's campaign funds and deposits the total into the caucus
 * treasury. Mirrors the existing `nationalTaxRate` / `stateTaxRate` flows
 * already running in the turn loop, just scoped to caucus membership.
 */

import { getDb } from "@/lib/mongodb";
import type { Caucus, CaucusMembership, Character, NPP, State } from "@/lib/db/types";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { loadTxThresholds, emitTxBulk } from "@/lib/financialTxLog/emit";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { projectCharacterGeneration } from "@/lib/utils/fundGeneration";
import { campaignAnchorToLocal } from "@/lib/campaigns/campaignCurrency";
import type { ObjectId } from "mongodb";

interface CaucusTaxResult {
  caucusesProcessed: number;
  membersTaxed: number;
  totalTaxed: number;
}

/**
 * Apply the per-turn caucus tax. Reads forexEnabled to decide which currency
 * field each player member's funds live in — same semantics as the existing
 * party-level tax pass.
 *
 * Returns a small summary used for the TurnLog entry. Does NOT throw on
 * partial failure; missing characters / missing NPPs are skipped silently so
 * one bad row doesn't kill the whole pass.
 */
export async function processCaucusTax(
  forexEnabled: boolean,
  turnNumber: number
): Promise<CaucusTaxResult> {
  const db = await getDb();

  const taxedCaucuses = await db
    .collection<Caucus>("caucuses")
    .find({ disbandedAt: null, taxRate: { $gt: 0 } })
    .toArray();
  if (taxedCaucuses.length === 0) {
    return { caucusesProcessed: 0, membersTaxed: 0, totalTaxed: 0 };
  }

  let membersTaxed = 0;
  let totalTaxed = 0;
  const now = new Date();
  const debitTxEntries: Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">[] = [];

  for (const caucus of taxedCaucuses) {
    const memberships = await db
      .collection<CaucusMembership>("caucusMemberships")
      .find({ caucusId: caucus._id, status: "active" })
      .toArray();
    if (memberships.length === 0) continue;

    const characterIds: ObjectId[] = [];
    const nppIds: ObjectId[] = [];
    for (const m of memberships) {
      if (m.memberType === "character") characterIds.push(m.memberId);
      else if (m.memberType === "npp") nppIds.push(m.memberId);
    }

    const [characters, npps] = await Promise.all([
      characterIds.length
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: characterIds } })
            .toArray()
        : Promise.resolve([] as Character[]),
      nppIds.length
        ? db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds } })
            .toArray()
        : Promise.resolve([] as NPP[]),
    ]);

    let caucusInflow = 0;

    // Player members — tax a percentage of per-turn income, not total balance.
    if (characters.length > 0) {
      const homeStateIds = [...new Set(characters.map((c) => c.homeState))];
      const stateDocs = await db
        .collection<State>("states")
        .find({ _id: { $in: homeStateIds } })
        .toArray();
      const stateMap = new Map(stateDocs.map((s) => [s._id, s]));

      const pendingDebits: { character: Character; tax: number; field: string }[] = [];
      for (const c of characters) {
        const state = stateMap.get(c.homeState);
        const incomeAnchor = state
          ? projectCharacterGeneration({
              population: state.population,
              donorBaseLevel: c.donorBaseLevel,
              currentOffice: c.currentOffice,
              stateGdpMillions: state.gdp,
              countryId: c.countryId,
              politicalInfluence: c.politicalInfluence ?? 0,
            })
          : 0;
        // Generation constants are anchor (₳); campaign funds are stored LOCAL
        // and decoupled from live forex. Denominate income to local at the
        // frozen base INITIAL_RATES scale (US ×1.0), then tax it — the tax and
        // the debit are both LOCAL home-currency amounts.
        const income = campaignAnchorToLocal(incomeAnchor, c.countryId ?? "US");
        if (income <= 0) continue;
        const tax = Math.floor((income * caucus.taxRate) / 100);
        if (tax <= 0) continue;
        // Skip members who can't afford the tax. The previous unguarded
        // deduction could push a broke caucus member into negative campaign
        // funds. We deliberately don't credit the caucus treasury for skipped
        // members, so accounting stays consistent. The pre-check must read the
        // SAME field the debit targets (forex-gated), otherwise a stale mirror
        // can pass the check while the guarded debit no-ops.
        const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
        const campaignFundsLocal = forexEnabled
          ? (c.currencyBalances?.campaign ?? 0)
          : (c.funds ?? 0);
        if (campaignFundsLocal < tax) continue;
        pendingDebits.push({ character: c, tax, field: campaignFundsField });
      }
      // Apply debits individually (not bulkWrite) so each guarded $gte debit
      // reports whether it landed. The caucus treasury is credited ONLY for
      // debits that actually modified the payer — a raced/failed debit must
      // not mint money into the caucus.
      if (pendingDebits.length > 0) {
        const results = await Promise.all(
          pendingDebits.map((d) =>
            db.collection<Character>("characters").updateOne(
              { _id: d.character._id, [d.field]: { $gte: d.tax } },
              {
                $inc: { [d.field]: -d.tax },
                $set: { updatedAt: now },
              }
            )
          )
        );
        for (let i = 0; i < pendingDebits.length; i++) {
          if ((results[i]?.modifiedCount ?? 0) !== 1) continue;
          const d = pendingDebits[i];
          const c = d.character;
          debitTxEntries.push({
            type: "caucus_tax_debit",
            turn: turnNumber,
            createdAt: now,
            subjectType: "character",
            subjectId: c._id,
            subjectName: typeof c.name === "string" ? c.name : String(c._id),
            amount: -d.tax,
            currencyCode: getHomeCurrency(c),
            counterpartyType: "party",
            counterpartyName: caucus.name,
            meta: { caucusId: String(caucus._id), taxRate: caucus.taxRate },
          });
          caucusInflow += d.tax;
          membersTaxed++;
        }
      }
    }

    // NPP members — funds is a single scalar, no currency conversion needed.
    // Same actual-debit accounting as characters: guard on balance and credit
    // the caucus only for debits that landed.
    if (npps.length > 0) {
      const nppDebits: { npp: NPP; tax: number }[] = [];
      for (const n of npps) {
        const funds = n.funds ?? 0;
        if (funds <= 0) continue;
        const tax = Math.floor((funds * caucus.taxRate) / 100);
        if (tax <= 0) continue;
        nppDebits.push({ npp: n, tax });
      }
      if (nppDebits.length > 0) {
        const results = await Promise.all(
          nppDebits.map((d) =>
            db.collection<NPP>("npps").updateOne(
              { _id: d.npp._id, funds: { $gte: d.tax } },
              {
                $inc: { funds: -d.tax },
                $set: { updatedAt: now },
              }
            )
          )
        );
        for (let i = 0; i < nppDebits.length; i++) {
          if ((results[i]?.modifiedCount ?? 0) !== 1) continue;
          caucusInflow += nppDebits[i].tax;
          membersTaxed++;
        }
      }
    }

    if (caucusInflow > 0) {
      await db.collection<Caucus>("caucuses").updateOne(
        { _id: caucus._id },
        {
          $inc: { treasury: caucusInflow },
          $set: { updatedAt: now },
        }
      );
      totalTaxed += caucusInflow;
      await emitTreasuryTransaction({
        db,
        countryId: caucus.countryId,
        partyId: caucus.partyId,
        holderType: "caucus",
        holderId: caucus._id.toString(),
        category: "caucus_tax",
        direction: "credit",
        amount: caucusInflow,
        memo: `Caucus tax (${caucus.taxRate}%)`,
        now,
      });
    }
  }

  if (debitTxEntries.length > 0) {
    const thresholds = await loadTxThresholds(db);
    void emitTxBulk(db, debitTxEntries, thresholds);
  }

  return {
    caucusesProcessed: taxedCaucuses.length,
    membersTaxed,
    totalTaxed,
  };
}
