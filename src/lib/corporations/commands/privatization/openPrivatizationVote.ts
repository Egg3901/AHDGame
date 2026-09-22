import type { Db, ObjectId } from "mongodb";
import type { Character, Corporation, CorporationPrivatizationVote } from "@/lib/db/types";
import {
  PRIVATIZATION_BUYOUT_PREMIUM,
  PRIVATIZATION_THRESHOLD_PCT,
  PRIVATIZATION_VOTE_DURATION_TURNS,
} from "@/lib/constants/corporations";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
} from "@/lib/financialTxLog/atomicCashGuard";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
} from "@/lib/currency/corporationCapital";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import {
  applyBankNavFloor,
  bankNavFloorPerShareAnchor,
  takeoverBankNav,
} from "../takeovers/rules/bankNavFloor";
import { shareholderVotingPower, totalVotingPower } from "@/lib/corporations/superShares";
import { executeFundOnlyBuyout } from "./fundOnlyBuyout";

export interface OpenPrivatizationVoteInput {
  db: Db;
  corporation: Corporation;
  character: Character;
  currentTurn: number;
  forexEnabled: boolean;
}

export type OpenPrivatizationVoteResult =
  | { ok: false; error: string; status: number }
  | { ok: true; immediate: true }
  | {
      ok: true;
      immediate?: false;
      voteId: ObjectId;
      lockedBuyoutPrice: number;
      totalReservedCash: number;
      bankNavFloorApplied: boolean;
    };

/**
 * Open a privatization buyout vote for a public corporation.
 *
 * Preconditions:
 *  - corporation is public (isPrivate !== true)
 *  - no other vote currently open for this corp
 *  - CEO holds > PRIVATIZATION_THRESHOLD_PCT of total shares
 *  - currentTurn >= privatizationCooldownUntilTurn (if set from a prior failed vote)
 *  - CEO has personal cash for worst-case payout, atomically reserved
 *
 * Locks `buyoutPrice = sharePrice * (1 + PRIVATIZATION_BUYOUT_PREMIUM)` at open time.
 * Reserved cash is refunded on fail or cancel; on pass it's paid out to non-CEO
 * holders + corp treasury (for the public-float chunk).
 */
export async function openPrivatizationVote(
  input: OpenPrivatizationVoteInput
): Promise<OpenPrivatizationVoteResult> {
  const { db, corporation, character, currentTurn, forexEnabled } = input;

  if (corporation.isPrivate) {
    return { ok: false, error: "Corporation is already private", status: 400 };
  }
  if (
    corporation.privatizationCooldownUntilTurn !== undefined &&
    currentTurn < corporation.privatizationCooldownUntilTurn
  ) {
    return {
      ok: false,
      error: `Privatization on cooldown until turn ${corporation.privatizationCooldownUntilTurn}`,
      status: 400,
    };
  }

  const ceoEntry = corporation.shareholders.find(
    (s) => s.characterId?.toString() === corporation.ceoId.toString()
  );
  const ceoShares = ceoEntry?.shares ?? 0;
  // Eligibility is measured by VOTING POWER (supershares count), not economic
  // stake, so a dual-class founder who controls the corp can call the buyout.
  // The cash reservation and per-share payouts below stay economic.
  const totalVp = totalVotingPower(corporation);
  const ceoVotingPct =
    totalVp > 0
      ? (shareholderVotingPower(corporation, ceoEntry ?? { shares: 0, superShares: 0 }) / totalVp) *
        100
      : 0;
  if (ceoVotingPct <= PRIVATIZATION_THRESHOLD_PCT) {
    return {
      ok: false,
      error: `CEO must control more than ${PRIVATIZATION_THRESHOLD_PCT}% of voting power (currently ${ceoVotingPct.toFixed(2)}%)`,
      status: 400,
    };
  }

  const existingOpen = await db
    .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
    .findOne({ corporationId: corporation._id, status: "open" });
  if (existingOpen) {
    return { ok: false, error: "A privatization vote is already open", status: 400 };
  }

  const nonCeoShares = corporation.totalShares - ceoShares;

  // CEO holds 100% — no minority holders to buy out, skip the vote entirely.
  if (nonCeoShares === 0) {
    const now = new Date();
    // #908: a private corp is single-class. This path never rebuilds the
    // shareholders array, so strip the CEO's per-holder `superShares` flag and
    // drop the corp-level dual-class fields, or hasSuperShares() would keep
    // reporting 10× voting on the now-private corp.
    const cleanedShareholders = (corporation.shareholders ?? []).map(
      ({ superShares: _superShares, ...rest }) => rest
    );
    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporation._id },
      {
        $set: {
          isPrivate: true,
          lastPrivatizationTurn: currentTurn,
          updatedAt: now,
          shareholders: cleanedShareholders,
        },
        $unset: {
          privatizationCooldownUntilTurn: "",
          superShareMultiplier: "",
          superSharesAdoptedAtTurn: "",
          // Approved-but-unissued public float is void once the corp leaves
          // the public market; the paced placement loop skips private corps,
          // so a surviving flag would block future share proposals forever.
          pendingShareIssuance: "",
        },
      }
    );
    return { ok: true, immediate: true };
  }

  // #71: the only non-CEO holders are index funds (no non-CEO character/corp
  // holders who could vote, and no public float). A privatization vote is
  // structurally unwinnable because index funds have no vote path, so the CEO
  // would be stuck forever. Buy the funds out from the corporate treasury
  // (a corporate buyback) and take the corp private directly.
  const hasNonCeoCharOrCorp = corporation.shareholders.some(
    (s) =>
      (s.characterId && s.characterId.toString() !== corporation.ceoId.toString()) ||
      Boolean(s.corporationId)
  );
  const hasFundHolders = corporation.shareholders.some(
    (s) => s.fundId && !s.characterId && !s.corporationId
  );
  if (!hasNonCeoCharOrCorp && (corporation.publicFloat ?? 0) === 0 && hasFundHolders) {
    const buyout = await executeFundOnlyBuyout(db, corporation, currentTurn);
    if (!buyout.ok) return buyout;
    return { ok: true, immediate: true };
  }

  const lockedCurrency = corporation.liquidCurrencyCode ?? "USD";
  const ceoCurrency = getHomeCurrency(character);

  // Round to two decimal places to avoid float drift through later arithmetic.
  const marketLockedPrice =
    Math.round(corporation.sharePrice * (1 + PRIVATIZATION_BUYOUT_PREMIUM) * 100) / 100;
  // Bank-NAV floor (issue #1750): a take-private buys out the minority by force,
  // exactly like the hostile-takeover squeeze-out, so it shares the same floor.
  // Without it a CEO could take a bank-heavy corp private at the haircut market
  // price and capture the bank's realizable net assets for less than they are
  // worth. Inert for corps without an active charter; a missing floor fails open
  // to the market locked price, never to zero.
  let lockedBuyoutPrice = marketLockedPrice;
  let bankNavFloorApplied = false;
  const activeCharter =
    corporation.bankCharter?.status === "active" ? corporation.bankCharter : null;
  if (activeCharter) {
    try {
      const fxByCurrency = await loadFxRatesByCurrency(db);
      const bankCurrency = activeCharter.currency;
      let playerDepositsAreLiabilities = false;
      try {
        const bankingPolicy = await loadBankingPolicy(db);
        playerDepositsAreLiabilities = bankCurrency
          ? savingsReadsAuthoritative(bankingPolicy, bankCurrency)
          : false;
      } catch {
        playerDepositsAreLiabilities = false;
      }
      const navAnchor = corpCapitalToAnchor(
        takeoverBankNav(activeCharter, { playerDepositsAreLiabilities }),
        bankCurrency,
        bankCurrency ? (fxByCurrency.get(bankCurrency) ?? 1) : 1
      );
      const floorLocked = anchorToCorpCapital(
        bankNavFloorPerShareAnchor({
          bankNavAnchor: navAnchor,
          totalShares: corporation.totalShares ?? 0,
        }),
        lockedCurrency,
        fxRateForCorpFromMap(corporation, fxByCurrency)
      );
      const floored = applyBankNavFloor(marketLockedPrice, floorLocked);
      if (floored.floorApplied) {
        lockedBuyoutPrice = Math.round(floored.pricePerShareAnchor * 100) / 100;
        bankNavFloorApplied = true;
      }
    } catch {
      // Floor infra unavailable: proceed at the market locked price.
    }
  }
  const totalReservedCash = Math.ceil(nonCeoShares * lockedBuyoutPrice);

  // Cross-currency privatization is out of scope for v1 — surface a clear error.
  // This only matters under forex; legacy USD corps + USD CEOs always pass.
  if (forexEnabled && lockedCurrency !== ceoCurrency) {
    return {
      ok: false,
      error: "Cross-currency privatization is not yet supported",
      status: 400,
    };
  }

  const debit = await atomicallyDebitCharacterCash(
    db,
    character._id,
    lockedCurrency,
    totalReservedCash,
    forexEnabled
  );
  if (!debit.ok) {
    return {
      ok: false,
      error: `Insufficient personal funds. Need ${totalReservedCash.toLocaleString()} reserved.`,
      status: 400,
    };
  }

  // Insert can fail for two reasons we need to handle:
  //   1. The partial unique index on (corporationId, status="open") rejects a
  //      duplicate when another open() raced past our existing-vote check.
  //   2. Any other DB error. In both cases we MUST refund the cash we just
  //      debited; otherwise the CEO is silently deducted with no vote to show.
  const now = new Date();
  let insertedId;
  try {
    const result = await db
      .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
      .insertOne({
        corporationId: corporation._id,
        openedByCharacterId: character._id,
        openedAtTurn: currentTurn,
        deadlineAtTurn: currentTurn + PRIVATIZATION_VOTE_DURATION_TURNS,
        lockedBuyoutPrice,
        lockedBuyoutCurrency: lockedCurrency,
        totalReservedCash,
        reservedCashCurrency: lockedCurrency,
        votes: [],
        status: "open",
        createdAt: now,
        updatedAt: now,
      } as unknown as CorporationPrivatizationVote);
    insertedId = result.insertedId;
  } catch (err) {
    await refundCharacterCash(db, character._id, lockedCurrency, totalReservedCash, forexEnabled);
    // Duplicate-key error from the partial unique index ⇒ another vote slipped
    // past the check. Surface the user-friendly version.
    const code = (err as { code?: number })?.code;
    if (code === 11000) {
      return { ok: false, error: "A privatization vote is already open", status: 400 };
    }
    throw err;
  }

  return {
    ok: true,
    voteId: insertedId,
    lockedBuyoutPrice,
    totalReservedCash,
    bankNavFloorApplied,
  };
}
