import type { Db, UpdateFilter } from "mongodb";
import type {
  Corporation,
  CorporationPrivatizationVote,
  IndexFund,
  Shareholder,
} from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { PRIVATIZATION_FAILED_COOLDOWN_TURNS } from "@/lib/constants/corporations";
import { shareholderVotingPower } from "@/lib/corporations/superShares";
import { refundCharacterCash } from "@/lib/financialTxLog/atomicCashGuard";
import { loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  logWireEvent,
  wireHeadlineCorpPrivatized,
  wireHeadlineCorpPrivatizationVoteFailed,
} from "@/lib/wireEvent";
import { notifyVoteEventRaw } from "@/lib/corporations/votes/voteNotifications";
import { recordAudit } from "@/lib/audit/recordAudit";

export interface ResolveInput {
  db: Db;
  vote: CorporationPrivatizationVote;
  currentTurn: number;
  forexEnabled: boolean;
  force?: boolean;
}

export type ResolveResult =
  | { resolved: false; reason: "not_due" | "already_resolved" }
  | { resolved: true; status: "passed" | "failed" };

/**
 * Resolve a privatization vote past its deadline. Lazy — call from any read of
 * the vote doc (GET vote, corp detail, etc.). Idempotent: re-calls on already-
 * resolved votes are no-ops.
 *
 * Pass condition: yes voting power > no voting power AND some voting power cast
 * (no votes = fail). Weighted by voting power (supershares count), not raw shares.
 *
 * On pass: pay each non-CEO character/corp holder, pay corp treasury for the
 * float chunk (corporate buyback semantics), consolidate cap table, flip
 * isPrivate=true, retire publicFloat shares.
 *
 * On fail: refund CEO's reserved cash, set 96-turn cooldown.
 */
export async function resolvePrivatizationVote(input: ResolveInput): Promise<ResolveResult> {
  const { db, vote, currentTurn, forexEnabled, force } = input;

  if (vote.status !== "open") return { resolved: false, reason: "already_resolved" };
  if (!force && currentTurn <= vote.deadlineAtTurn) return { resolved: false, reason: "not_due" };

  // Load corp BEFORE the atomic claim so we can re-evaluate each cast vote
  // against current shareholdings. A holder who sold their shares between
  // casting and the deadline should not influence the outcome, and a holder
  // who partially divested should only count for what they still own.
  const corp = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: vote.corporationId });

  const liveVotes = corp
    ? vote.votes.flatMap((v) => {
        const holder = corp.shareholders.find((s) => {
          if (v.characterId) return s.characterId?.toString() === v.characterId.toString();
          if (v.corporationId) return s.corporationId?.toString() === v.corporationId.toString();
          return false;
        });
        const currentShares = holder?.shares ?? 0;
        if (!holder || currentShares <= 0) return [];
        // Weight by VOTING POWER (supershares count), capped at the shares held
        // when the vote was cast so a holder can't buy in afterward to inflate
        // their weight. Divestment shrinks it automatically (current shares).
        const votableShares = Math.min(v.voteShares, currentShares);
        const weight = shareholderVotingPower(corp, {
          shares: votableShares,
          superShares: holder.superShares,
        });
        return [{ vote: v.vote, weight }];
      })
    : [];

  const tally = liveVotes.reduce(
    (acc, v) => {
      if (v.vote === "yes") acc.yes += v.weight;
      else acc.no += v.weight;
      return acc;
    },
    { yes: 0, no: 0 }
  );
  const passed = tally.yes > tally.no && tally.yes + tally.no > 0;
  const now = new Date();

  // ── Atomic claim ─────────────────────────────────────────────────────────
  // Resolution runs lazily on every read past the deadline. Two concurrent
  // GETs would both reach this point with the same vote doc, both compute the
  // same pass/fail, then both run the side effects (paying holders twice).
  //
  // Claim ownership by atomically transitioning status: "open" → terminal
  // FIRST. Only the winner of the transition does payouts. The loser sees
  // matchedCount === 0 and bails out as already_resolved.
  const finalStatus: "passed" | "failed" = passed ? "passed" : "failed";
  const claim = await db
    .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
    .updateOne(
      { _id: vote._id, status: "open" },
      { $set: { status: finalStatus, resolvedAt: now, updatedAt: now } }
    );
  if (claim.matchedCount === 0) {
    // Another resolver already claimed this vote. Bail out — they own the side effects.
    return { resolved: false, reason: "already_resolved" };
  }

  if (!corp) {
    // Corp went away mid-vote — refund the opener. Vote is already marked terminal
    // by the atomic claim above; we just need to release the held cash.
    await refundCharacterCash(
      db,
      vote.openedByCharacterId,
      vote.reservedCashCurrency,
      vote.totalReservedCash,
      forexEnabled
    );
    return { resolved: true, status: finalStatus };
  }

  if (!passed) {
    await refundCharacterCash(
      db,
      vote.openedByCharacterId,
      vote.reservedCashCurrency,
      vote.totalReservedCash,
      forexEnabled
    );
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corp._id },
      {
        $set: {
          privatizationCooldownUntilTurn: currentTurn + PRIVATIZATION_FAILED_COOLDOWN_TURNS,
          updatedAt: now,
        },
      }
    );
    logWireEvent(
      "corporation_privatization_vote_failed",
      wireHeadlineCorpPrivatizationVoteFailed(corp.name),
      { href: `/corporation/${corp.sequentialId ?? corp._id}` }
    );
    recordAudit({
      source: "api",
      action: "privatization.voteResolve",
      category: "corp",
      turn: currentTurn,
      ts: now,
      subject: { type: "corporation", id: corp._id, name: corp.name },
      refs: { corporationId: corp._id },
      outcome: "rejected",
      reason: "Privatization buyout vote failed",
      meta: { voteId: vote._id, tally },
    });
    void notifyVoteEventRaw({
      db,
      corporationId: corp._id,
      voteId: vote._id,
      corpName: corp.name,
      summary: "take the corporation private (buyout)",
      notificationType: "corp_vote_failed",
    });
    return { resolved: true, status: "failed" };
  }

  // ── Pass branch: settle the buyout ────────────────────────────────────────
  const ceoIdStr = corp.ceoId.toString();
  const nonCeoHolders = corp.shareholders.filter((s) => s.characterId?.toString() !== ceoIdStr);
  const publicFloat = corp.publicFloat ?? 0;

  // #3450: index-fund holders must be paid too. Previously a fund holder had its
  // payout counted into the CEO's outflow but was NEVER credited, and its shares
  // were absorbed into the CEO by the cap-table rebuild below — destroying money
  // and wiping the fund's stake for free. Funds hold cash in ₳, so convert the
  // buyout payout from the buyout currency. There is no `fund` subjectType for
  // financialTxLog yet (Phase-3 ledger gap), so the cash credit is the real,
  // conserving move and the fund leg stays unbooked — matching every other fund
  // cash flow today. Fund payouts are tracked separately so the CEO's booked
  // outflow leg reflects only the char/corp/float portions it can attribute.
  const hasFundHolder = nonCeoHolders.some((h) => h.fundId && !h.characterId && !h.corporationId);
  const fxByCurrency = hasFundHolder ? await loadFxRatesByCurrency(db) : null;

  let totalCharCorpPaid = 0;
  let totalFundPaidAnchor = 0;
  for (const holder of nonCeoHolders) {
    const payout = Math.round(holder.shares * vote.lockedBuyoutPrice);
    if (holder.characterId) {
      await refundCharacterCash(
        db,
        holder.characterId,
        vote.lockedBuyoutCurrency,
        payout,
        forexEnabled
      );
      void emitTx(db, {
        type: "share_buyout_payout",
        turn: currentTurn,
        createdAt: now,
        subjectType: "character",
        subjectId: holder.characterId,
        subjectName: "(shareholder)",
        amount: payout,
        currencyCode: vote.lockedBuyoutCurrency,
        counterpartyType: "corporation",
        counterpartyId: corp._id,
        counterpartyName: corp.name,
      });
      totalCharCorpPaid += payout;
    } else if (holder.corporationId) {
      await db
        .collection<Corporation>("corporations")
        .updateOne({ _id: holder.corporationId }, { $inc: { liquidCapital: payout } });
      void emitTx(db, {
        type: "share_buyout_payout",
        turn: currentTurn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: holder.corporationId,
        subjectName: "(corp shareholder)",
        amount: payout,
        currencyCode: vote.lockedBuyoutCurrency,
        counterpartyType: "corporation",
        counterpartyId: corp._id,
        counterpartyName: corp.name,
      });
      totalCharCorpPaid += payout;
    } else if (holder.fundId) {
      const rate = fxByCurrency?.get(vote.lockedBuyoutCurrency as CurrencyCode) ?? 1;
      const payoutAnchor = rate > 0 ? payout / rate : payout;
      await db.collection<IndexFund>("indexFunds").updateOne({ _id: holder.fundId }, {
        $inc: { cashAnchor: payoutAnchor },
        $pull: { holdings: { corporationId: corp._id } },
        $set: { updatedAt: now },
      } as unknown as UpdateFilter<IndexFund>);
      totalFundPaidAnchor += payoutAnchor;
    }
  }

  // Public float buyback: pay corp treasury for the retired float shares.
  const floatPayout = Math.round(publicFloat * vote.lockedBuyoutPrice);
  if (floatPayout > 0) {
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: corp._id }, { $inc: { liquidCapital: floatPayout } });
    void emitTx(db, {
      type: "share_buyout_buyback",
      turn: currentTurn,
      createdAt: now,
      subjectType: "corporation",
      subjectId: corp._id,
      subjectName: corp.name,
      amount: floatPayout,
      currencyCode: vote.lockedBuyoutCurrency,
      counterpartyType: "corporation",
      counterpartyId: corp._id,
      counterpartyName: corp.name,
      meta: { side: "float_retired" },
    });
  }

  // Consolidate cap table: CEO absorbs all non-CEO character/corp shares; float retires.
  const ceoEntry = corp.shareholders.find((s) => s.characterId?.toString() === ceoIdStr) as
    Shareholder | undefined;
  const ceoSharesAfter =
    (ceoEntry?.shares ?? 0) + nonCeoHolders.reduce((acc, h) => acc + h.shares, 0);
  const newShareholders: Shareholder[] = [
    {
      characterId: corp.ceoId,
      shares: ceoSharesAfter,
      ...(ceoEntry?.avgCostPerShare !== undefined
        ? { avgCostPerShare: ceoEntry.avgCostPerShare }
        : {}),
    },
  ];
  const newTotalShares = ceoSharesAfter; // = old totalShares − publicFloat

  await db.collection<Corporation>("corporations").updateOne(
    { _id: corp._id },
    {
      $set: {
        shareholders: newShareholders,
        totalShares: newTotalShares,
        publicFloat: 0,
        isPrivate: true,
        lastPrivatizationTurn: currentTurn,
        updatedAt: now,
      },
      // #908: a private corp is single-class — drop dual-class supershare state
      // so hasSuperShares() stops reporting 10× voting on a now-private corp
      // (the rebuilt CEO shareholder entry above already omits `superShares`).
      $unset: {
        privatizationCooldownUntilTurn: "",
        superShareMultiplier: "",
        superSharesAdoptedAtTurn: "",
      },
    }
  );

  void emitTx(db, {
    type: "share_buyout_outflow",
    turn: currentTurn,
    createdAt: now,
    subjectType: "character",
    subjectId: corp.ceoId,
    subjectName: "(CEO)",
    amount: -(totalCharCorpPaid + floatPayout),
    currencyCode: vote.lockedBuyoutCurrency,
    counterpartyType: "corporation",
    counterpartyId: corp._id,
    counterpartyName: corp.name,
    meta: { reservedCash: vote.totalReservedCash },
  });

  // Vote was already marked passed by the atomic claim at the top of this function;
  // no further status write needed here.
  logWireEvent("corporation_privatized", wireHeadlineCorpPrivatized(corp.name), {
    href: `/corporation/${corp.sequentialId ?? corp._id}`,
  });
  void notifyVoteEventRaw({
    db,
    corporationId: corp._id,
    voteId: vote._id,
    corpName: corp.name,
    summary: "take the corporation private (buyout)",
    notificationType: "corp_vote_passed",
  });

  recordAudit({
    source: "api",
    action: "privatization.voteResolve",
    category: "corp",
    turn: currentTurn,
    ts: now,
    actor: { kind: "player", userId: undefined, characterId: corp.ceoId },
    subject: { type: "corporation", id: corp._id, name: corp.name },
    amount: totalCharCorpPaid + floatPayout,
    currencyCode: vote.lockedBuyoutCurrency,
    refs: { corporationId: corp._id },
    outcome: "ok",
    meta: { voteId: vote._id, tally, floatPayout, fundPaidAnchor: totalFundPaidAnchor },
  });

  return { resolved: true, status: "passed" };
}
