/**
 * NPC household deposit-capture arithmetic. The shell (`banking/deposits.ts`)
 * moves a player's savings pointer; the banking turn moves the household cash.
 */

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
 * Each bank's raw share scales with its deposit-rate premium over the CB
 * savings APY:
 *
 *   share = clamp(0.08 * (1 + (depositRate - cbApy) / max(cbApy, 0.5)), 0, 0.25)
 *
 * When the sum across banks exceeds {@link NPC_DEPOSIT_MAX_TOTAL_SHARE}, every
 * share is scaled down proportionally.
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
