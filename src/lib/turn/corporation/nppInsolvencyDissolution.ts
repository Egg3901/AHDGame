import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { Bond, Corporation } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import { isCommandEconomy, isSoeSpared } from "@/lib/constants/commandEconomy";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";
import { executeCorporationBondDefaultDissolution } from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import { recordAuditBulk } from "@/lib/audit/recordAudit";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";

/**
 * NPP-run corporation auto-insolvency dissolution.
 *
 * Fills a real gap: a PLAYER corp that goes deeply insolvent gets nationalized
 * or dissolved (the government / a player acts on the financial-distress clock
 * stamped by trackFinancialDistress). An NPP-run corp had NO such exit — nobody
 * ever executes that path in a pure-NPP world — so a structurally-unprofitable
 * corp (common in a crowded 3-corps-per-sector market where the losers of the
 * revenue split still pay full operating costs) bled liquidCapital toward
 * arbitrarily negative values forever, polluting economy/wealth metrics and
 * index-fund NAVs it's a constituent of.
 *
 * This gives NPP corps the missing bankruptcy exit: any NPP-CEO'd corp whose
 * liquidCapital (anchor-converted) has fallen below a deep-negative threshold —
 * i.e. terminally insolvent, not a transient dip — is wound down via the same
 * `executeCorporationBondDefaultDissolution` used when a character is deleted.
 * That returns its sectors to the unowned market pool (so survivors/new
 * foundings can re-absorb the freed revenue), settles/cleans its share-market
 * activity and index-fund holdings, and removes the corp. The result is a
 * self-cleaning corporate economy: over-crowded sectors shed their weakest
 * corps until the survivors are viable.
 *
 * Issue #3237: the deep threshold alone was toothless against slow bleeders.
 * 1953-era 250-turn sims ended with ~31% of corps persistently negative —
 * median 52 CONSECUTIVE negative turns — but every one of them still above
 * -1M ₳, so none ever reached the exit. Two additional triggers close that:
 *
 *   1. PERSISTENT insolvency: each turn this phase stamps
 *      `nppInsolventSinceTurn` on an NPP corp whose effective cash
 *      (liquidCapital + positive share-buyback escrow, anchor-converted) is
 *      negative, and clears it on recovery. A corp continuously insolvent for
 *      PERSISTENT_INSOLVENCY_GRACE_TURNS is wound down even though it never
 *      reached the deep threshold. The grace window is deliberately long so
 *      corps riding a cyclical loss are spared — only true zombies exit.
 *   2. LINGERING bond default: bondTurn's auto-resolver tries refinance →
 *      restructure every turn; its step 3 ("default stands for the CEO to
 *      dissolve & settle") assumes a CEO that NPP corps don't have, so an
 *      unresolvable NPP default previously lingered forever (the "stuck bond
 *      defaults" audit finding). An NPP corp whose bond has been defaulted
 *      and unresolved for LINGERING_DEFAULT_GRACE_TURNS is wound down;
 *      bondholders take the haircut through the same settlement waterfall.
 *
 * Dissolution conserves value by construction: previewDissolveSettlement caps
 * bondholder + shareholder pools at (liquidCapital + salvaged sector NPV), so
 * nothing is minted; the ledger rows are emitted by the dissolution executor.
 *
 * Player corps are untouched: the query filters `ceoType: "npp"`, so
 * player-run corps keep the trackFinancialDistress → nationalization-grace
 * protection they have today. Natcorps (`countryOwnerId`) and suspended corps
 * are likewise excluded, exactly as before.
 *
 * Capped per turn so the one-time backlog (when this first runs against a world
 * that already accumulated insolvent corps) clears over a few turns rather than
 * stalling a single turn with hundreds of full settlements.
 */

// Deep-insolvency trigger, in ₳. Roughly a half starting-capital of debt — well
// past a transient dip, so healthy corps riding a temporary loss are never
// caught; only terminally-underwater ones are. Fires immediately (no grace).
const DISSOLUTION_ANCHOR_THRESHOLD = -1_000_000;
// Consecutive turns of negative effective cash (LC + positive escrow) before a
// slow-bleeding NPP corp is wound down. Evidence basis (#3237): stuck corps in
// the 1953 sims had a median 52-turn negative streak; 30 turns is well past any
// cyclical dip while still clearing zombies within a season.
export const PERSISTENT_INSOLVENCY_GRACE_TURNS = 30;
// Turns a defaulted, unresolved bond may linger before its NPP issuer is wound
// down. The bondTurn auto-resolver gets this many attempts at refinance /
// restructure first; only defaults it could never cure land here.
export const LINGERING_DEFAULT_GRACE_TURNS = 30;
// Max dissolutions per turn — bounds the settlement work on any single turn.
const MAX_DISSOLUTIONS_PER_TURN = 25;

export async function processNppInsolventCorpDissolution(
  db: Db,
  turn: number
): Promise<{ dissolved: number; candidates: number }> {
  const now = new Date();

  // Soft budget constraint (v2 P1): whether an insolvent command-economy SOE is
  // SPARED or allowed to FOLD is now the per-country Gosbank budget-softness dial
  // (economicFactors.budgetSoftness, 0 hard … 1 soft), written each turn by the
  // command economy phase. SOFT (≥ threshold) → spared, as before (losses persist
  // → more overhang). HARD (< threshold) → the SOE folds via the normal exit
  // (efficiency pressure; the reform nudge flows through the marketization
  // policy-stance term, which reads hard budgets as reformist). NPP default is
  // fairly soft, so a hands-off world keeps the historical spare-everyone shape.
  const gc = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } });
  const commandEconomyEnabled = gc?.commandEconomyEnabled === true;
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1 } });
  const currentYear = gs?.currentYear ?? null;

  let corps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", countryOwnerId: { $exists: false }, suspended: { $ne: true } })
    .toArray();
  if (commandEconomyEnabled) {
    // Per-country budget softness (default fairly soft when not yet written).
    const softnessBudgets = await db
      .collection<FederalBudget>("federalBudget")
      .find({}, { projection: { countryId: 1, "economicFactors.budgetSoftness": 1 } })
      .toArray();
    const softnessByCountry = new Map<string, number>();
    for (const b of softnessBudgets) {
      const s = b.economicFactors?.budgetSoftness;
      if (typeof s === "number" && Number.isFinite(s)) softnessByCountry.set(b.countryId, s);
    }
    corps = corps.filter((corp) => {
      if (!isCommandEconomy(corp.countryId, currentYear, commandEconomyEnabled)) return true;
      // Keep as a dissolution candidate only under a HARD budget; soft budgets
      // spare the SOE entirely (no clock stamp, no fold).
      return !isSoeSpared(softnessByCountry.get(corp.countryId));
    });
  }
  if (corps.length === 0) return { dissolved: 0, candidates: 0 };

  const fxByCurrency = await loadFxRatesByCurrency(db);

  // NPP issuers whose bond default has lingered past the auto-resolver's reach.
  const lingeringDefaultIssuerIds = new Set(
    (
      await db.collection<Bond>("bonds").distinct("corporationId", {
        matured: false,
        defaulted: true,
        defaultedAtTurn: { $lte: turn - LINGERING_DEFAULT_GRACE_TURNS },
        issuerType: { $ne: "sovereign" },
      })
    ).map((id) => String(id))
  );

  // ── Maintain the persistent-insolvency clock ──────────────────────────────
  // Effective cash includes a positive share-buyback escrow because bondTurn
  // treats that as usable cash when covering shortfalls — a corp with negative
  // LC but a fat escrow is not actually insolvent. (Negative escrow — buyback
  // debt — is already reflected as a deeper hole at settlement; the clock
  // deliberately ignores it so this trigger is strictly conservative.)
  const clockOps: AnyBulkWriteOperation<Corporation>[] = [];
  const effectiveAnchorById = new Map<string, number>();
  const insolventSinceById = new Map<string, number>();
  for (const corp of corps) {
    const fxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    const effectiveLocal = (corp.liquidCapital ?? 0) + Math.max(0, corp.shareEscrowBalance ?? 0);
    const effectiveAnchor = corpLiquidCapitalToAnchor(effectiveLocal, corp, fxRate);
    const idStr = corp._id.toString();
    effectiveAnchorById.set(idStr, effectiveAnchor);

    const stamped = corp.nppInsolventSinceTurn;
    if (effectiveAnchor < 0) {
      const since = stamped ?? turn;
      insolventSinceById.set(idStr, since);
      if (stamped == null) {
        clockOps.push({
          updateOne: {
            filter: { _id: corp._id },
            update: { $set: { nppInsolventSinceTurn: turn, updatedAt: now } },
          },
        });
      }
    } else if (stamped != null) {
      clockOps.push({
        updateOne: {
          filter: { _id: corp._id },
          update: { $unset: { nppInsolventSinceTurn: "" }, $set: { updatedAt: now } },
        },
      });
    }
  }
  if (clockOps.length > 0) {
    await db.collection<Corporation>("corporations").bulkWrite(clockOps);
  }

  const insolvent = corps
    .filter((corp) => {
      const idStr = corp._id.toString();
      const anchor = corpLiquidCapitalToAnchor(
        corp.liquidCapital ?? 0,
        corp,
        fxRateForCorpFromMap(corp, fxByCurrency)
      );
      // Trigger 1: terminally deep hole — immediate (pre-#3237 behavior).
      if (anchor < DISSOLUTION_ANCHOR_THRESHOLD) return true;
      // Trigger 2: persistently insolvent past the grace window and still
      // effectively cashless this turn.
      const since = insolventSinceById.get(idStr);
      if (
        since != null &&
        turn - since >= PERSISTENT_INSOLVENCY_GRACE_TURNS &&
        (effectiveAnchorById.get(idStr) ?? 0) < 0
      ) {
        return true;
      }
      // Trigger 3: a bond default the auto-resolver could never cure.
      return lingeringDefaultIssuerIds.has(idStr);
    })
    // Deepest holes first — clear the worst offenders when the per-turn cap bites.
    .sort((a, b) => (a.liquidCapital ?? 0) - (b.liquidCapital ?? 0));

  let dissolved = 0;
  // Forensics/alt-detection audit spine (plan §3.1, T2.7) — an NPP corp
  // being wound down is a real "silent state change" (it disappears from
  // the wealth list, index-fund NAVs, etc. with nobody having acted), so
  // each dissolution gets its own entry (bounded by MAX_DISSOLUTIONS_PER_TURN
  // = 25, never unbounded). Collected and flushed with ONE `recordAuditBulk`
  // call after the loop, not per-corp.
  const actionAuditEntries: ActionAuditInput[] = [];
  for (const corp of insolvent) {
    if (dissolved >= MAX_DISSOLUTIONS_PER_TURN) break;
    try {
      const result = await withCorporationSettlementLock(
        db,
        corp._id,
        "bondSettlementInProgressAt",
        now,
        () => executeCorporationBondDefaultDissolution(db, corp, { requireDefaultedBonds: false })
      );
      // null → settlement already in progress elsewhere; skip, it'll be retried
      // next turn if still insolvent.
      if (result) {
        dissolved += 1;
        console.log(
          `[nppInsolvency] dissolved insolvent NPP corp ${corp.name} (${corp._id}) — liquidCapital ${Math.round(corp.liquidCapital ?? 0)}`
        );
        actionAuditEntries.push({
          source: "turn",
          category: "corp",
          action: "corp.auto_liquidate",
          phase: "corporationTurn",
          subject: { type: "corporation", id: corp._id.toString(), name: corp.name },
          outcome: "ok",
          turn,
          meta: {
            reason: "npp_insolvency",
            liquidCapital: Math.round(corp.liquidCapital ?? 0),
          },
        });
      }
    } catch (err) {
      console.error(
        `[nppInsolvency] failed to dissolve insolvent NPP corp ${corp._id.toString()}:`,
        err
      );
    }
  }
  if (actionAuditEntries.length > 0) {
    recordAuditBulk(actionAuditEntries);
  }

  return { dissolved, candidates: insolvent.length };
}
