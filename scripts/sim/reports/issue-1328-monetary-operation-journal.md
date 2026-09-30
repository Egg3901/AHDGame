# Monetary-operation journal qualification

Refs #1328 and #2159. This completes the QE, QT and treasury-advance journal adoption lane. The broader banking issue retains its separate activation and observation gates.

## Executed source

- Baseline: `c5ff9130b77dcb2d515bd455a6eabc76b6ad8a76`.
- Treatment: `6f053f3b0ab0893997dced317e7498118c2785f6`.
- Both checkouts were clean throughout execution. The companion JSON contains the fixture hash and results. The final branch also integrates development `d077f1193dd6ee12fe1ba2727013b4f2a34213f1`, including the separately qualified interbank income repair and market-formation telemetry. These measurements retain their executed source attribution.

## Scope and outcomes

Production monetary operations and `processBankingTurn` ran against isolated Mongo with one synthetic central bank, one sovereign bond, one market pool and one treasury at turn 300. Each scenario starts from the same fixture. The budget starts at -1,000 native cash with 1,000 outstanding bond principal; the market has 10,000 cash and 110 combined float and central-bank units.

| Operation             | Market cash after | Float / CB units | Treasury cash after | Lifetime creation |
| --------------------- | ----------------: | ---------------: | ------------------: | ----------------: |
| QE, 5 units           |            15,000 |          95 / 15 |              -1,000 |             5,000 |
| QT, 5 units           |             5,000 |          105 / 5 |              -1,000 |            -5,000 |
| Treasury advance, 250 |            10,000 |         100 / 10 |                -750 |               250 |

Every normal result matches the baseline exactly, including market price, support ratio, pool counters, history, treasury principal, central-bank reserves and external money. Combined bond units remain 110. Treasury advances preserve additive native credit and the original informational money-supply delta, which is zero while this fixture remains negative. The shadow treasury entry is balanced using the observed rate of 2 native units per anchor unit.

Six actual-Mongo financial interruption cases, three concurrent command cases and a compensated-refusal recovery case converge to their original outcomes through normal banking recovery. Audit delivery has two further actual-Mongo interruption cases. Completed money remains completed while its audit row is pending; recovery writes one fixed-ID row with the original actor, trace and sequence. Audit delivery failures do not repeat financial legs.

The audit outbox shares a pending-recovery flag with the command. A partial index and a 100-record limit bound the lookup. With 1,000 additional completed synthetic commands, the empty recovery lookup examines zero documents and zero index keys.

## Focused verification

- 16 atomic settlement regressions cover existing cash transitions and restricted noncash bond exchanges, including conservation, concurrent delivery, interruption recovery and rejection of cash-field updates without cash legs.
- 54 tests passed across the final monetary, audit, API and NPP suites. They include original command identity, native negative treasury cash, concurrent fiscal credits, shared pending-command exclusion, deliberate fresh admin commands, audit delivery and actor preservation.
- The earlier API/UI/NPP qualification passed 28 tests, including all four UI operation types retaining command IDs after network failure. Wrapper and liquidity qualification passed 29 tests before the audit extension; those financial outcomes were requalified in the final Mongo run.
- The focused bootstrap collection-classification gate passed. New command collections are classified as runtime data.

Native treasury credit remains available without FX when shadow accounting is disabled. With shadow accounting enabled, the canonical treasury valuation rules require valid active-currency rates or an authored budget-only valuation. No synthetic one-to-one rate is introduced. Original command policy and audit context are frozen before delivery.

## Performance

| Measured scope              | Baseline commands | Treatment commands | Baseline read BSON | Treatment read BSON |
| --------------------------- | ----------------: | -----------------: | -----------------: | ------------------: |
| One QE command              |                 5 |                 37 |                294 |               3,719 |
| One QT command              |                 5 |                 34 |                294 |               5,488 |
| One treasury advance        |                 7 |                 33 |                286 |               2,528 |
| Idle banking recovery phase |                 2 |                  3 |                 46 |                  46 |

Command measurements include durable plans, original quote checks, publication and fixed-ID audit delivery. The idle phase has private banking disabled and proves pending recovery still runs in that state. Its additional read is indexed and remains below the existing 1,000-command banking budget. This table measures individual commands, not a full autonomous monetary-policy sweep. Read bytes count returned cursor documents and exclude transport headers.

This is a synthetic subsystem qualification. It does not establish full-world accounting closure, real-liability activation, or production observation. Prices, allocation, authority, caps and cooldown rules remain unchanged.
