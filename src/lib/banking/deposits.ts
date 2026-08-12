import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Character, Corporation } from "@/lib/db/types";
import type { SavingsHolder } from "@/lib/db/types/bank";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { isBlockedDepositor } from "@/lib/banking/blacklist";
import { getBankDepositCeiling } from "@/lib/banking/capacityAllocation";
import { isDepositTakingCharter } from "./charterKinds";

export type MoveCharacterSavingsResult =
  | { ok: true; holder: SavingsHolder }
  | { ok: false; error: string };

/**
 * Provisional NPC household deposit-capture math - flagged for user review.
 * Base share of externalBroadMoney each deposit-taking bank attracts at the
 * central-bank savings APY (zero premium).
 */
export const NPC_DEPOSIT_BASE_SHARE = 0.08;

/** Provisional - per-bank cap on NPC deposit share of externalBroadMoney. */
export const NPC_DEPOSIT_MAX_SHARE_PER_BANK = 0.25;

/** Provisional - total NPC share captured by all private banks combined. */
export const NPC_DEPOSIT_MAX_TOTAL_SHARE = 0.6;

/**
 * Provisional - APY floor (percent) used in the premium ratio so a near-zero
 * CB savings APY cannot explode the share multiplier.
 */
export const NPC_DEPOSIT_APY_COMPARISON_FLOOR = 0.5;

export type NpcDepositBankInput = {
  bankId: string;
  effectiveDepositRatePercent: number;
};

export type NpcDepositShare = {
  bankId: string;
  /** Fraction of externalBroadMoney captured by this bank (0..MAX_SHARE_PER_BANK). */
  share: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pure NPC household deposit-share math. Each bank's raw share scales with its
 * deposit-rate premium over the CB savings APY:
 *
 *   share = clamp(0.08 * (1 + (depositRate - cbApy) / max(cbApy, 0.5)), 0, 0.25)
 *
 * When the sum across banks exceeds {@link NPC_DEPOSIT_MAX_TOTAL_SHARE}, every
 * share is scaled down proportionally. Actual per-turn movement of
 * externalBroadMoney is wired in bankingTurn (phase 4) - this function is math only.
 */
export function computeNpcDepositShare(
  banks: readonly NpcDepositBankInput[],
  centralBankSavingsApyPercent: number
): NpcDepositShare[] {
  const cbApy = Number.isFinite(centralBankSavingsApyPercent) ? centralBankSavingsApyPercent : 0;
  const denom = Math.max(cbApy, NPC_DEPOSIT_APY_COMPARISON_FLOOR);

  const raw: NpcDepositShare[] = banks.map((bank) => {
    const rate = Number.isFinite(bank.effectiveDepositRatePercent)
      ? bank.effectiveDepositRatePercent
      : 0;
    const premiumRatio = (rate - cbApy) / denom;
    const share = clamp(
      NPC_DEPOSIT_BASE_SHARE * (1 + premiumRatio),
      0,
      NPC_DEPOSIT_MAX_SHARE_PER_BANK
    );
    return { bankId: bank.bankId, share };
  });

  const total = raw.reduce((sum, row) => sum + row.share, 0);
  if (total <= NPC_DEPOSIT_MAX_TOTAL_SHARE || total <= 0) {
    return raw;
  }

  const scale = NPC_DEPOSIT_MAX_TOTAL_SHARE / total;
  return raw.map((row) => ({
    bankId: row.bankId,
    share: row.share * scale,
  }));
}


/**
 * Move a character's whole savings balance for `currency` between the central
 * bank and a private bank. Pointer-only: `currencyBalances.savings` is never
 * read or written. Idempotent single updateOne.
 */
export async function moveCharacterSavings(
  db: Db,
  characterId: ObjectId,
  currency: CurrencyCode,
  holder: SavingsHolder
): Promise<MoveCharacterSavingsResult> {
  if (!(await isPrivateBankingEnabled())) {
    return { ok: false, error: "Private banking is not enabled" };
  }

  let targetBank: Corporation | null = null;
  if (holder !== "centralBank") {
    if (!ObjectId.isValid(holder) || holder.length !== 24) {
      return { ok: false, error: "Invalid bank corporation id" };
    }

    targetBank = await db.collection<Corporation>("corporations").findOne({
      _id: new ObjectId(holder),
    });
    if (!targetBank) {
      return { ok: false, error: "Bank corporation not found" };
    }
    if (!isDepositTakingCharter(targetBank.bankCharter)) {
      return {
        ok: false,
        error: "Target bank must have an active retail or universal charter",
      };
    }
    if (targetBank.bankCharter.currency !== currency) {
      return {
        ok: false,
        error: `Bank charter currency is ${targetBank.bankCharter.currency}, not ${currency}`,
      };
    }
    if (isBlockedDepositor(targetBank.bankCharter, characterId.toString())) {
      return { ok: false, error: "Character is blacklisted by this bank" };
    }
  }

  const character = await db.collection<Character>("characters").findOne(
    { _id: characterId },
    {
      projection: {
        _id: 1,
        [`currencyBalances.savings.${currency}`]: 1,
        [`currencyBalances.savingsHolder.${currency}`]: 1,
      },
    }
  );
  if (!character) {
    return { ok: false, error: "Character not found" };
  }

  // Cap accepted player deposits at the bank's capacity ceiling. Already-held
  // balances at this bank are grandfathered (idempotent pointer refresh).
  // Moving away from a private bank is always allowed.
  if (holder !== "centralBank" && targetBank) {
    const currentHolder = character.currencyBalances?.savingsHolder?.[currency];
    if (currentHolder !== holder) {
      const ceiling = await getBankDepositCeiling(db, targetBank);
      const myBalance = Math.max(0, character.currencyBalances?.savings?.[currency] ?? 0);
      const peerRows = await db
        .collection<Character>("characters")
        .aggregate<{ total: number }>([
          {
            $match: {
              [`currencyBalances.savingsHolder.${currency}`]: holder,
              _id: { $ne: characterId },
            },
          },
          {
            $group: {
              _id: null,
              total: { $sum: `$currencyBalances.savings.${currency}` },
            },
          },
        ])
        .toArray();
      const peerPlayerDeposits = peerRows[0]?.total ?? 0;
      const peerSafe =
        typeof peerPlayerDeposits === "number" && Number.isFinite(peerPlayerDeposits)
          ? Math.max(0, peerPlayerDeposits)
          : 0;
      if (peerSafe + myBalance > ceiling + 1e-9) {
        return {
          ok: false,
          error: "Bank deposit ceiling reached; cannot accept additional player deposits",
        };
      }
    }
  }

  // Pointer-only: never touch currencyBalances.savings.<CODE>.
  const holderPath = `currencyBalances.savingsHolder.${currency}`;
  await db.collection<Character>("characters").updateOne(
    { _id: characterId },
    {
      $set: {
        [holderPath]: holder,
        updatedAt: new Date(),
      },
    }
  );

  return { ok: true, holder };
}
