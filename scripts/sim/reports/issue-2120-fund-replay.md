# Index fund round-trip acceptance, issue #2120

## Source and scope

Completed full-world source: `50de54b3-4e20-41f9-a07d-591e1a284dce`, source commit
`9c73c5ea76422c9a157f9645eec6980b3dfa471b`, 73 processed turns. The saved world is continued through
nine real `runIndexFundCron` calls at turns 74 through 82, using clean replay source
`1851dd3f280f8a3bc2a05e87f0006bf2c37dfd96`. The original source fund rows remain unchanged, verified
by SHA-256 `e9fbc85171390a2980c0aa0fdcd0b7a9c6421e63df4507c5c8712d4b0ed860c5`.

This is a focused continuation of saved simulation data. It does not rerun the
whole economy or claim the tracker-wide release matrix. No new full-world run
was needed for this child acceptance.

The saved configuration remains `indexFundsMode=full`, NPP redemption enabled,
equity liquidity facility enabled, and bond liquidity targeting disabled. The
replay copies the actual funds, positions, NPP investment balances, issuers,
bonds, market pools, open orders, FX quotes and required configuration. It
retains source query indexes except unused full-text search indexes.

## Acceptance

| Original requirement                             | Verified evidence                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subscribe, rebalance and redeem through fundCron | 17,927 new subscriptions; 3,386 new NAV-matched payouts and fully paid queue rows; 3,343 payouts share an NPP/fund pair with a new subscription.                                          |
| Fully backed with buffer                         | All 46 active funds pass at every post-cron step and after the market sell: backing at least 1, cash at least 5%, reserve at least 25%, within the existing 1e-6 numeric ratio tolerance. |
| No orphan holdings                               | Zero missing fund/corporation positions, zero cap-table mismatches and zero missing valuation quotes across every observed step.                                                          |
| Fund bids reachable from sell flow               | The real market-sell command fills one existing executable liquidity-provider fund bid and pays the seller from order escrow.                                                             |

### Strict minimums over the continuation and market fill

| Measure                                |              Observed |
| -------------------------------------- | --------------------: |
| Backing ratio                          |     0.999999999999999 |
| Liquid cash / allocation backing       |       5.000000117778% |
| Cash plus bonds / allocation backing   |      25.214325449020% |
| Direct NPP wallet comparisons          |                 2,944 |
| Maximum unexplained fund cash residual | 0.000000082422 anchor |
| Maximum bond dealer cash residual      |  0.000689697219 local |

Fund cash deltas reconcile to actual turn-stamped financial transaction rows,
including subscription/redemption counterpart entries and bid escrow/refunds.
Dealer cash changes reconcile to purchase and sale counters. The absolute
acceptance tolerance is two cents for floating-point cash arithmetic. These
checks cover this fund subsystem, not every economy account in #992.

Redemption wallet checks run on turns without new NPP accrual/subscription.
They compare each pre/post investment-wallet balance against that turn's
recorded payout. Queued-redemption transaction rows do not carry a turn, so the
comparison uses the turn-stamped financial log and separately verifies every
redemption transaction's units multiplied by NAV.

### Real market-sell settlement

A controlled seller is introduced only in the replay, with zero cash and one
share transferred from existing issuer public float. That setup conserves the
issuer's total shares. It is separate from the executed market flow: the
production `fillBestBuyOrderForMarketSell` command selects an existing fund bid,
transfers that share to the fund and credits
`22.697998889299` anchor from order escrow.
The escrow debit matches the seller credit, fund cash does not change at fill,
and total shares remain conserved after settlement. The preceding full-world
source also retained 1,822 filled fund bids.

## Repairs and inherited state

The initial source predates the fixes and intentionally retains its defects.
Its minimum backing is 0.999971424792, minimum cash share is
4.999838644140%, and minimum reserve share is
23.921590180798%. Those initial failures are not counted as
passing current-code evidence.

- #2571 already prevents the equity facility from committing the required
  reserve to open bid escrow.
- This PR carries forward #2572's dealer-ask purchase sizing, cash-floor guard,
  and post-deployment NAV refresh, preserving the original commit authorship.
- Existing depleted cash buffers are restored by cancelling unused fund bids
  first, then selling actual bonds to funded dealer pools if needed. No fund
  cash is patched or created. The retained bond book and outstanding queued
  units are included when NAV is refreshed.
- Fresh queue state gates the final liquidity quotes, including requests added
  by this turn's NPP pass.

## Validation and phase cost

Focused suites pass for bond purchases, reserve deployment, fund cron, queued
redemptions, the subscribe/redeem integration, cash-buffer restoration and
changelog validation. Buffer regressions cover exhausted dealer liquidity,
queued-unit NAV, unused escrow cancellation, and no repeat sale once restored.

The replay records at most 21,879
Mongo commands and 5,587,870 decoded read
bytes for an entire fund-cron call. This includes NPP investing and its thousands
of persisted positions, not just the repair. A healthy buffer adds no per-fund
query; the final quote phase adds one batched queued-unit read. Only an actually
depleted buffer enters the cancellation/sale/remark path.

Reproduction: run `scripts/sim/fundSavedWorldReplay.ts` with an explicit dedicated
sandbox URI and distinct `--source=ahd_sim_*` and `--target=ahd_sim_*` database
names. It refuses a nonempty target or a source without a completed,
source-attributed simulation record. The machine-readable report is
[issue-2120-fund-replay.json](issue-2120-fund-replay.json).

```sh
SIM_MONGODB_URI="$SANDBOX_MONGODB_URI" npx tsx scripts/sim/fundSavedWorldReplay.ts \
  --source=ahd_sim_saved_world --target=ahd_sim_fund_acceptance
```

Use the completed source world's actual database name for `ahd_sim_saved_world`.
The target must not already contain collections. The runner permits only the
dedicated loopback sandbox endpoint on port 27018.

### Changes after the replay pin

The NAV and cash-buffer helpers were moved unchanged from `fundCron.ts` into
`fundNav.ts` to satisfy the architecture size gate. Existing exports remain
available from `fundCron.ts`. The replay command-monitor reply received an
explicit TypeScript shape. These changes do not alter the executed settlement
logic, formulas, or evidence, so no additional simulation is required.
