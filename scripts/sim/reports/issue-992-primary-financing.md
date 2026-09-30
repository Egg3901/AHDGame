# Issue 992: sovereign primary financing repair

Date: 2026-09-30. This repairs a confirmed account-lifecycle defect for #992 and #968. **Both issues remain open.** The whole-economy, authoritative-banking 12-turn gate is not established by this subsystem report.

## Source and inputs

- Treatment: `aca1b636a9fb197f7272d9df3f50f28ecd344adf`, clean at start and finish. [Runner](../sovereignPrimaryReplay.ts), [measured results](issue-992-primary-financing.json).
- Baseline runtime: `7d7ecad06dde93bf51ee6550f18cfc19ef1731a3`. Execution commit `322a2b0b7bd4171d7bd4c4d8a7839eeb027be303` adds only the identical runner; its `src` diff against the baseline is empty. No treatment source is loaded by the baseline process.
- Both start from completed retained run `4d943526-e75f-48c7-b46f-6a10d5aeff64`, generated at `2aa9c18195207a1726a04afae60e5a8f913045fd`, saved turn 241. The older run supplies input, not validation of new code.
- Eight copied collection selections have content SHA256 `76aafccbc5f63601cadab11ec931e5a9c597694f15051f282c1a56ea766cbe3e`. Both executions verify the source remains unchanged. Public output excludes database names, connection details and player identities.
- The scheduled case retains five national budgets, sovereign bonds and their currency context: US, UK, Germany, Japan and Ireland. Only Japan and the US need issuance at the next quarter, turn 252. Other cases preserve the retained US fiscal context but explicitly control buyer liquidity, new offers and central-bank policy. No live database, whole-world continuation or newly generated world is involved.

## Reproduced loss and repair

The baseline scheduled path creates funded debt and debits the buyer pool, but does not credit the issuer treasury:

| Currency | Baseline cash lost | Treatment unexplained cash change | Funded principal added |
| -------- | -----------------: | --------------------------------: | ---------------------: |
| JPY      |  2,043,801,529,000 |                                 0 |      2,043,801,529,000 |
| USD      |    729,544,829,000 |                                 0 |        729,544,829,000 |

Amounts are native currency, never summed across currencies. Treatment pays the same funded principal while conserving pool plus signed treasury cash. No compensating balance adjustment or larger reconciliation tolerance is used.

The old shadow check misleadingly stays green: the missing treasury receipt causes no treasury cash movement, and pool cash was absent from its account inventory. The repair adds the real pool account to snapshots and emits both primary cash legs. Historical debt securitization remains cash-neutral; its existing audit row no longer derives a phantom cash receipt.

## Actual command scenarios

All 19 treatment result rows pass the real ledger reconciler: balanced entries, zero stock-flow divergence in the copied scope and an empty unattributed bucket. Source preservation also passes.

| Scenario                             | Observed result                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Retained scheduled quarter           | Two funded issuers, two journal intents, matching cash and principal                                         |
| Administrative offer                 | 10,000 funded once; repeated request leaves cash and debt unchanged                                          |
| Partial buyer liquidity              | A 10,000 offer with 5,000 pool cash funds 4,000 under the existing appetite rule                             |
| No buyer funding                     | Zero funded face and no treasury credit; the offer remains unplaced                                          |
| Autonomous monetary financing        | 10,000 newly created cash reaches treasury; external broad money is not also credited                        |
| Crash after treasury credit          | Actual Mongo write lands, execution throws, journal recovery finishes the remaining projections exactly once |
| Twelve consecutive financed turns    | One 10,000 administrative placement each turn, with retry and reconciliation checks after every placement    |
| Later placement of an unfilled offer | Nine units placed through the actual quote path; proceeds, face and repeated-call checks pass                |

The journal claims an immutable key before cash moves. Buyer cash, treasury proceeds, issued units, principal, coupon obligations and durable receipts belong to that intent. A partial move remains visible for the existing recovery worker. A caller cannot recalculate a second issue while that intent is unfinished. Unfunded units incur no principal or coupon. Central-bank ownership is distinct from the pool's public inventory. All funded entry points refresh the canonical debt ratio, credit rating and rate immediately. Journal-owned audit receipts are explicitly excluded from generic ledger re-derivation, so receipt reprocessing cannot add a second cash witness.

Focused stateful tests additionally cover concurrent duplicate requests, interruptions after each cash leg and during debt/bond projections, rollover preserving the old holder's units until ordinary maturity, absence of a buyer pool, and cash-neutral historical reconciliation. Existing monetary integration tests verify a single M2 destination; the retained replay's monetary check is cash/ledger attribution, not a complete economic money-supply forecast.

## Mongo work

Same retained five-country scheduled input, one measured invocation:

| Executed path                | Mongo commands | Returned document BSON bytes |
| ---------------------------- | -------------: | ---------------------------: |
| Baseline scheduled issuance  |             41 |                      174,169 |
| Journaled scheduled issuance |             90 |                      182,099 |

The added 49 commands persist and witness two recoverable cash transfers and their projections. Returned documents grow by 7,930 bytes. This is quarter-only work. Funded administrative fixtures use 33 commands, the unfunded offer 20, monetary financing 34, and later unsold placement 25. Retry and snapshot assertions are excluded from these measured function calls. The post-crash 12-command measurement is the completed intent's replay, not the initial failed attempt.

The existing `bondTurn` budget is 1,000 commands. The measured issuance subset fits it; this report does not claim that the entire global bond phase was benchmarked. Pool snapshot coverage adds one projected collection read per snapshot. No budget or tolerance is raised.

## Remaining acceptance and rollout

- This is prospective repair. It does not invent reimbursement for cash lost in historical turns.
- Pool snapshot coverage will now expose other uninstrumented pool writers rather than silently omit that account class. This report does not qualify every secondary-market, corporate, calibration or currency-conversion writer.
- Twelve financed subsystem turns do not activate the authoritative savings cohort or run other economic phases. #992 still requires the full account inventory and its whole-economy 12-consecutive-turn gate; #968's remaining market and rollout gates also remain open.
- Land through development, qualify a staged cohort before production promotion, and observe treasury/pool cash, placed versus unplaced face, partial journal count and per-kind reconciliation after each quarter. A rollback must preserve and recover already-claimed journal intents; it must not delete receipts or replay old offers as fresh issues.
