# LOC settlement qualification

Related to #1328. This is bounded native Mongo and browser qualification, not a full-world banking stress run or authorization to change a live rollout.

## Source and scope

The fifteen-case native replay passed on clean source `5f89f1bc10ef3187675b6d44181bd332ccf60f25`. Its complete synthetic results are in [the JSON artifact](issue-1328-loc-settlement.json). The baseline loads the original `lineOfCreditTurn.ts` from `dde248f1cb2b1ab8aba882b3af2c6428dc490a89` against the same current dependencies; it does not represent an entire old checkout.

The changes preserve existing credit limits, interest and spread rates, payment modes, currency rounding and allocation. Original draw/repay commands have stable client IDs. A stored original plan joins the character's wallet and debt, then recovers reserve credits and immutable ledger receipts. Protected target generations and claimed/delivered/rejected outcomes remain until the journal durably acknowledges them; bounded receipt expiry cannot erase an unsettled outcome. Refusal and cash publication compete on the same target marker, so a delayed worker cannot reject already delivered cash. Each currency's recorded cash flows balance independently, including explicit existing FX mint/burn treatment.

Contractual interest can still increase obligations beyond available lending capacity. New draws revalidate actual underwriting while holding a recoverable bank publication guard. The companion reserve-transfer qualification covers both concurrent operation orders and recovery of an older waiter behind a newer durable owner; see the reserve-pool report when that dependent change is integrated.

## Native outcomes

| Case                                             | Verified result                                                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wallet principal/interest                        | Exact baseline monetary state; interest 208.33, payment 407.10, principal retirement 198.77.                                                                                                  |
| Interest-only                                    | Exact baseline state; payment 250, principal unchanged.                                                                                                                                       |
| Foreign-currency payment                         | Exact baseline personal/savings/campaign/debt/reserve state.                                                                                                                                  |
| Empty wallet                                     | Existing contractual arrears and distress preserved; no invented cash.                                                                                                                        |
| Income-supported unfreeze                        | Existing unfreeze rule preserved without a cash payment.                                                                                                                                      |
| Authoritative savings funded                     | Actual savings withdrawal pays the same original quote.                                                                                                                                       |
| Authoritative savings refused                    | Principal stays 100,000; arrears accrue 208.33. The baseline incorrectly retired 198.77 principal after a refused withdrawal.                                                                 |
| Character acknowledgement lost                   | Concurrent recovery publishes one wallet/debt mutation and one receipt.                                                                                                                       |
| Reserve acknowledgement lost                     | Interest credited once.                                                                                                                                                                       |
| Ledger acknowledgement lost                      | One original ledger row survives retry.                                                                                                                                                       |
| Receipt expiry at each of those three boundaries | Replacing all 200 bounded character and bank receipts still yields one wallet/debt mutation, one reserve credit and one original ledger row under concurrent recovery.                        |
| Garnished foreign income                         | Debt and residual payout share a receipt; one residual FX trade; retry after unfreeze unchanged; changed same-turn income rejected.                                                           |
| Actual bond source interrupted                   | Real `processBondTurn` debits the issuer before the joined borrower mutation. Pending LOC recovery completes interest/FX without rerunning issuer funding; a second recovery changes nothing. |

Every servicing case also repeats the same turn and checks unchanged balances, debt and ledger count. The actual bond-source case pays 208.3333333334 EUR from the synthetic issuer, interrupts after borrower publication, and completes one residual conversion. It does not claim that replaying the entire pre-existing bond phase is idempotent. Recovery resumes the accepted LOC journal directly.

## Measured database cost

One synthetic borrower, including actual production reads and writes. BSON byte counts exclude harness setup and assertions. These are bounded measurements, not a population-scale benchmark.

| Case                          | Commands before / after | Request bytes before / after | Response bytes before / after |
| ----------------------------- | ----------------------- | ---------------------------- | ----------------------------- |
| Wallet                        | 17 / 49                 | 4,881 / 21,228               | 2,134 / 20,331                |
| Interest-only                 | 16 / 49                 | 4,056 / 20,954               | 1,962 / 20,186                |
| Foreign payment               | 17 / 49                 | 5,051 / 22,436               | 2,230 / 21,711                |
| Empty wallet                  | 13 / 42                 | 3,280 / 16,280               | 1,803 / 15,372                |
| Income unfreeze               | 13 / 42                 | 3,394 / 16,738               | 1,903 / 15,728                |
| Funded authoritative savings  | 33 / 66                 | 12,649 / 30,072              | 3,233 / 22,164                |
| Refused authoritative savings | 24 / 50                 | 8,694 / 21,389               | 3,152 / 16,809                |

The increase pays for durable original plans, character receipts, reserve receipts and verified ledger delivery. Pending recovery prioritizes the bounded set of bank owners and attempts at most fifty distinct journals per call. The additive sparse `characters.pendingLocSettlement.key` migration supports protected-owner lookup; it does not rewrite balances. Legacy pre-version-2 partial journals without surviving delivery evidence stop for reconciliation rather than guessing that cash was never delivered. Existing phase telemetry retains its 500-command default warning threshold; this replay does not justify raising that threshold or asserting population-scale performance.

## Reproduction

Use a new isolated sandbox database prefix and a clean checkout. The runner requires the local sandbox endpoint and refuses reused targets.

```sh
SIM_MONGODB_URI=mongodb://127.0.0.1:27018/ \
  npx tsx --tsconfig tsconfig.json scripts/sim/lineOfCreditReplay.ts \
  --target=ahd_sim_loc_qualification --out=loc-qualification.json
```

The completed [actual browser qualification](issue-1328-loc-browser.md) separately verifies authenticated commands, lost-response retry, a new draw, repayment, LOC turn/read-model checks and the treasury transfer panel. Its source pin and evidence are distinct from this native replay.
