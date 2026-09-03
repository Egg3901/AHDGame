/**
 * Feature availability for banking, resolved once and carried as a value.
 *
 * Five switches govern this subsystem, and they were interpreted at forty-odd
 * call sites through four helper functions, each with its own default. A
 * request that asked twice could get two answers if the config changed between
 * reads; a turn phase that asked per bank paid a read per bank; and the LOC
 * switch, which defaults ON, was one typo away from being read with the
 * banking convention, which defaults OFF.
 *
 * This module is the one interpretation. The shell loads the config document
 * once per request or turn, resolves it here, and passes the frozen snapshot
 * down. Nothing below the shell asks the database what is enabled.
 */

export interface BankingPolicyConfig {
  privateBankingEnabled?: boolean;
  bankPropTradingEnabled?: boolean;
  bankContagionEnabled?: boolean;
  lineOfCreditEnabled?: boolean;
  playerAdvancedBankChartersEnabled?: boolean;
}

/** Projection for the one config read the shell performs. */
export const BANKING_POLICY_PROJECTION = Object.freeze({
  privateBankingEnabled: 1,
  bankPropTradingEnabled: 1,
  bankContagionEnabled: 1,
  lineOfCreditEnabled: 1,
  playerAdvancedBankChartersEnabled: 1,
} as const);

export interface BankingPolicySnapshot {
  /** Private banking as a whole. Off means a read-only freeze, not a drain. */
  privateBanking: boolean;
  /** Prop desks, interbank market, margin line. Requires private banking. */
  propTrading: boolean;
  /** Failure contagion between same-currency deposit takers. Requires private banking. */
  contagion: boolean;
  /** Player lines of credit at the central bank. */
  lineOfCredit: boolean;
  /** Investment and universal charters offered to players. Requires private banking. */
  advancedCharters: boolean;
}

/**
 * The defaults, stated once:
 *
 * - private banking is OFF unless explicitly `true`;
 * - prop trading and contagion are ON when banking is on, unless explicitly
 *   `false` (kill switches, not features);
 * - advanced charters are OFF unless explicitly `true`;
 * - line of credit is ON unless explicitly `false`.
 */
export function resolveBankingPolicy(
  config: BankingPolicyConfig | null | undefined
): BankingPolicySnapshot {
  const privateBanking = config?.privateBankingEnabled === true;
  return Object.freeze({
    privateBanking,
    propTrading: privateBanking && config?.bankPropTradingEnabled !== false,
    contagion: privateBanking && config?.bankContagionEnabled !== false,
    lineOfCredit: config?.lineOfCreditEnabled !== false,
    advancedCharters: privateBanking && config?.playerAdvancedBankChartersEnabled === true,
  });
}

/** Everything off: the snapshot for a world with no config document. */
export const BANKING_POLICY_OFF: BankingPolicySnapshot = resolveBankingPolicy(null);

/** Everything on: the snapshot the simulation harness and tests start from. */
export const BANKING_POLICY_ALL_ON: BankingPolicySnapshot = resolveBankingPolicy({
  privateBankingEnabled: true,
  bankPropTradingEnabled: true,
  bankContagionEnabled: true,
  lineOfCreditEnabled: true,
  playerAdvancedBankChartersEnabled: true,
});
