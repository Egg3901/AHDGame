export type BankingTurnSummary = {
  banksProcessed: number;
  depositInterestPaid: number;
  depositInterestShortfall: number;
  loanInterestCollected: number;
  loanPrincipalRepaid: number;
  defaultsWrittenOff: number;
  npcDepositDelta: number;
  npcBulkShortfall: number;
  /** Premium due that could not be paid from the bank's cash reserves. */
  premiumShortfall: number;
  /** Interbank interest paid borrower to lender. */
  interbankInterestPaid: number;
  /** Interbank principal written off on default. */
  interbankDefaultsWrittenOff: number;
  /** CB margin interest destroyed from borrower cash. */
  cbMarginInterestPaid: number;
  /** CB margin interest that could not be paid. */
  cbMarginInterestShortfall: number;
  /** Loans serviced on behalf of a bank that has already been wound up. */
  deadBankLoansServiced: number;
  /** Recovered into a failed bank's estate, before its waterfall runs. */
  deadBankRecoveredToEstate: number;
  /** Recovered to the insurance fund after the estate was closed. */
  deadBankRecoveredToInsurer: number;
  /** Settlements that started and never finished, as of the end of this pass. */
  unfinishedSettlements: number;
  /** What the recovery worker finished, and did not, before this pass began. */
  recovery: {
    resumedSettlements: number;
    stillPartial: number;
    estatesRecovered: number;
    estatesStillResolving: number;
  };
};

export const ZERO_BANKING_TURN_SUMMARY: BankingTurnSummary = {
  banksProcessed: 0,
  depositInterestPaid: 0,
  depositInterestShortfall: 0,
  loanInterestCollected: 0,
  loanPrincipalRepaid: 0,
  defaultsWrittenOff: 0,
  npcDepositDelta: 0,
  npcBulkShortfall: 0,
  premiumShortfall: 0,
  interbankInterestPaid: 0,
  interbankDefaultsWrittenOff: 0,
  cbMarginInterestPaid: 0,
  cbMarginInterestShortfall: 0,
  deadBankLoansServiced: 0,
  deadBankRecoveredToEstate: 0,
  deadBankRecoveredToInsurer: 0,
  unfinishedSettlements: 0,
  recovery: {
    resumedSettlements: 0,
    stillPartial: 0,
    estatesRecovered: 0,
    estatesStillResolving: 0,
  },
};
