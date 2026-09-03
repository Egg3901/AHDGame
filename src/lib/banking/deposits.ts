import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Character, Corporation } from "@/lib/db/types";
import type { SavingsHolder } from "@/lib/db/types/bank";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { isBlockedDepositor } from "@/lib/banking/blacklist";
import { getBankDepositCeiling } from "@/lib/banking/capacityAllocation";
import { charterMay } from "@/lib/banking/rules/capabilities";

export type MoveCharacterSavingsResult =
  { ok: true; holder: SavingsHolder } | { ok: false; error: string };

export {
  NPC_DEPOSIT_BASE_SHARE,
  NPC_DEPOSIT_MAX_SHARE_PER_BANK,
  NPC_DEPOSIT_MAX_TOTAL_SHARE,
  NPC_DEPOSIT_APY_COMPARISON_FLOOR,
  computeNpcDepositShare,
  type NpcDepositBankInput,
  type NpcDepositShare,
} from "@/lib/banking/rules/deposits";
export {
  NPC_DEPOSIT_MAX_EQUITY_LEVERAGE,
  equityCappedDepositCeiling,
} from "@/lib/banking/rules/balanceSheet";

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
    if (!charterMay(targetBank.bankCharter, "acceptPlayerDeposits")) {
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
