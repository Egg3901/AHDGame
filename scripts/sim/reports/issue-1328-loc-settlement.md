# LOC settlement qualification

Related to #1328. This is bounded native Mongo and browser qualification, not a full-world banking stress run or authorization to change a live rollout.

## Source and scope

The twelve-case native replay passed on clean source `2bede343811f7fe7ebcf1ecda9ac8a764eb8f0ea`. Its complete synthetic results are in [the JSON artifact](issue-1328-loc-settlement.json). The baseline loads the original `lineOfCreditTurn.ts` from `dde248f1cb2b1ab8aba882b3af2c6428dc490a89` against the same current dependencies; it does not represent an entire old checkout.

The changes preserve existing credit limits, interest and spread rates, payment modes, currency rounding and allocation. Original draw/repay commands have stable client IDs. A stored original plan joins the character's wallet and debt, then recovers reserve credits and immutable ledger receipts. Each currency's recorded cash flows balance independently, including explicit existing FX mint/burn treatment.

Contractual interest can still increase obligations beyond available lending capacity. New draws revalidate actual underwriting while holding a recoverable bank publication guard. The companion reserve-transfer qualification covers both concurrent operation orders and recovery of an older waiter behind a newer durable owner; see the reserve-pool report when that dependent change is integrated.

## Native outcomes

| Case                           | Verified result                                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet principal/interest      | Exact baseline monetary state; interest 208.33, payment 407.10, principal retirement 198.77.                                                                                                  |
| Interest-only                  | Exact baseline state; payment 250, principal unchanged.                                                                                                                                       |
| Foreign-currency payment       | Exact baseline personal/savings/campaign/debt/reserve state.                                                                                                                                  |
| Empty wallet                   | Existing contractual arrears and distress preserved; no invented cash.                                                                                                                        |
| Income-supported unfreeze      | Existing unfreeze rule preserved without a cash payment.                                                                                                                                      |
| Authoritative savings funded   | Actual savings withdrawal pays the same original quote.                                                                                                                                       |
| Authoritative savings refused  | Principal stays 100,000; arrears accrue 208.33. The baseline incorrectly retired 198.77 principal after a refused withdrawal.                                                                 |
| Character acknowledgement lost | Concurrent recovery publishes one wallet/debt mutation and one receipt.                                                                                                                       |
| Reserve acknowledgement lost   | Interest credited once.                                                                                                                                                                       |
| Ledger acknowledgement lost    | One original ledger row survives retry.                                                                                                                                                       |
| Garnished foreign income       | Debt and residual payout share a receipt; one residual FX trade; retry after unfreeze unchanged; changed same-turn income rejected.                                                           |
| Actual bond source interrupted | Real `processBondTurn` debits the issuer before the joined borrower mutation. Pending LOC recovery completes interest/FX without rerunning issuer funding; a second recovery changes nothing. |

Every servicing case also repeats the same turn and checks unchanged balances, debt and ledger count. The actual bond-source case pays 208.3333333334 EUR from the synthetic issuer, interrupts after borrower publication, and completes one residual conversion. It does not claim that replaying the entire pre-existing bond phase is idempotent. Recovery resumes the accepted LOC journal directly.

## Measured database cost

One synthetic borrower, including actual production reads and writes. BSON byte counts exclude harness setup and assertions. These are bounded measurements, not a population-scale benchmark.

| Case                          | Commands before / after | Request bytes before / after | Response bytes before / after |
| ----------------------------- | ----------------------- | ---------------------------- | ----------------------------- |
| Wallet                        | 17 / 35                 | 4,898 / 16,177               | 2,146 / 18,635                |
| Interest-only                 | 16 / 35                 | 4,072 / 15,959               | 1,973 / 18,514                |
| Foreign payment               | 15 / 35                 | 4,067 / 17,273               | 1,938 / 19,967                |
| Empty wallet                  | 13 / 35                 | 3,293 / 13,745               | 1,813 / 14,485                |
| Income unfreeze               | 13 / 35                 | 3,407 / 14,133               | 1,913 / 14,811                |
| Funded authoritative savings  | 33 / 52                 | 12,682 / 25,024              | 3,247 / 19,983                |
| Refused authoritative savings | 24 / 43                 | 8,718 / 18,792               | 3,167 / 15,896                |

The increase pays for durable original plans, character receipts, reserve receipts and verified ledger delivery. Pending recovery prioritizes the bounded set of bank owners and attempts at most fifty distinct journals per call. Existing phase telemetry retains its 500-command default warning threshold; this replay does not justify raising that threshold or asserting population-scale performance.

## Reproduction

Use a new isolated sandbox database prefix and a clean checkout. The runner requires the local sandbox endpoint and refuses reused targets.

```sh
SIM_MONGODB_URI=mongodb://127.0.0.1:27018/ \
  npx tsx --tsconfig tsconfig.json scripts/sim/lineOfCreditReplay.ts \
  --target=ahd_sim_loc_qualification --out=loc-qualification.json
```

The original browser page qualification is recorded separately after its authenticated command, lost-response retry, new draw, repayment and LOC turn/read-model checks complete. No browser result is implied by the native replay above.
