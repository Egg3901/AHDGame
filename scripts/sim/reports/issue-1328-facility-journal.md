# Central-bank facility journal qualification

Refs #1328, #2159. This verifies the liquidity advance and facility-servicing journal lane. The broader banking adoption and rollout criteria remain separate.

## Source and scope

Baseline: `56b969b464488ddf615caf4a1e528027bf2b0844`.
Treatment: `005d1178c52d5e3b1aec86aa9f917b300261ae21`.
Both executions used clean checkouts and isolated Mongo databases. The companion JSON records the private runner's SHA-256. Later evidence and CI fixture-typing commits do not change the executed game runtime. The nullable legacy cooldown read type was aligned with the existing query; its query and effects are unchanged.

The fixture contains ten synthetic USD banks at turn 100, a central bank with prime rate 4, and an observed native-per-anchor FX rate of 2. Ordinary deposit and loan-book work is explicitly pre-stamped complete to isolate facility servicing. This is actual production subsystem code against Mongo, not a new world simulation or retained-player-world qualification.

## Verified outcomes

- Normal facility outcomes match exactly: aggregate initial cash 2,000 becomes central-bank reserves 2,000, bank cash zero, margin arrears zero, discount-window arrears 604.1666666666667, and realized facility income -2,604.1666666666665.
- Normal liquidity outcomes match exactly: 4,000 delivered bank cash, 4,000 matching new margin debt, 4,000 lifetime creation, and ten native transaction receipts. Corporate liquid capital is unchanged.
- Duplicate delivery and repeated recovery preserve the original balances and receipt counts. Two actual-Mongo receipt interruption cases passed.
- Focused tests additionally cover pro-rata and zero-deposit allocation, reserve fallback, changed recipient eligibility, same-ID concurrency and input conflicts, cooldowns, deliberate repeated admin commands, missing FX valuation, facility payment priority, and original arrears recovery.
- API/UI tests cover authorized retry identity, fresh-command cooldown enforcement, and reuse after a network interruption.

Missing FX does not block the native command and does not fabricate an anchor amount. The native receipt explicitly records unavailable valuation. Vault receipts are marked so the generic corporation-cash derivation does not misattribute them to liquid capital; no new ledger account or reconciliation tolerance is introduced.

## Mongo cost

| Measured operation         | Baseline commands | Treatment commands | Baseline read BSON bytes | Treatment read BSON bytes |
| -------------------------- | ----------------: | -----------------: | -----------------------: | ------------------------: |
| Ten-bank facility phase    |               163 |                221 |                    8,451 |                     8,507 |
| Repeated phase             |                12 |                 15 |                    7,429 |                     8,861 |
| Ten-bank liquidity command |                10 |                108 |                    4,136 |                    28,359 |

The facility phase stays below its existing 1,000-command budget. Durable per-bank settlement replaces a bulk cash update in the admin liquidity command. Pending-command recovery adds one empty collection read in a normal banking turn; original facility receipts are batch-loaded, and central-bank rates reuse the already-loaded map.

Read bytes count returned cursor documents, excluding transport headers. Command windows include best-effort audit work, whose asynchronous batches can cross windows. These figures characterize this bounded cohort, not the largest world or wall-clock latency.

## Validation and limits

- 28 focused liquidity, monetary-operation wrapper and banking audit tests passed.
- 13 API/UI tests passed.
- The final audit-event follow-up passed all 11 liquidity tests and the clean-source Mongo qualification.
- Scoped ESLint and formatting passed; full remote CI remains the merge gate.

An older interrupted facility receipt without its original accounting projections requires explicit recovery. No historical charge is guessed. This report does not qualify production activation, shadow-account observation, other banking journal lanes, or long-horizon behavior.
