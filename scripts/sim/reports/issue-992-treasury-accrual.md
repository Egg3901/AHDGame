# Issue 992: treasury accrual ownership

Date: 2026-09-30. This fixes a reproduced attribution and retry defect in the largest retained divergent account class. **Issue #992 remains open:** these are fiscal subsystem turns, not an authoritative whole-economy qualification.

## Provenance

- Treatment runtime: `26167a5e4e960ac69959bc179e4c1d53173d4e7b`, clean at start and finish. [Runner](../treasuryAccrualReplay.ts), [measured data](issue-992-treasury-accrual.json).
- Baseline runtime: `89b20b09716801d3d952d9a3698ffe08b2d23b0a`. Execution commit `462134d876f48f1d498ca7f03a43a9fc217d3cf9` adds the identical runner only; its `src` diff is empty.
- Retained input: completed run `559d9701-e07f-48c8-ade1-294bc926820a`, generated at `b4eb48872d6b17d64cd91a85202619f181797713`, saved turn 13. That older execution supplies input and does not validate the new source.
- Six copied collection selections retain fiscal budgets, banks, currency rates, country registry, organization membership and game state. Content hash: `5dfdc74d7da666c70ad252c0e7badaa3998fea93ea8ef6e7f6685d483b235f18`. Both runs verify every copied selection remains unchanged in the source.
- All 23 saved budgets are retained. Twelve actual treasury phases advance turns 14 through 25 while other economic phases remain fixed. Shadow accounting is explicitly enabled in the isolated copy. No production settings, outbound configuration or live state is changed.

## Account inventory and causal reproduction

At the retained diagnostic's turn 13, the uncapped inventory ranks government first: 23 accounts and 1,418,264,815,448.7957 anchor units of absolute unexplained change. Corporations follow with 361 accounts / 324,058,827.3894, and funds with 35 / 24,832.9146. These are historical diagnostic readings, not the new replay's result.

`processTreasuryTurn` is the existing cash owner: it slices annual primary revenue/spending, charges live debt service and enforcement, and rounds the signed treasury balance. It previously emitted no ledger witness. A focused stateful test reproduced a 500 cash increase with zero explaining ledger entries.

Separately, corporation tax-base totals and bond-holder service totals emitted government rows without moving treasury cash. Those specific rows now carry an explicit non-cash marker, and the derivation layer excludes them from treasury cash stock-flow. Unmarked actual cash receipts and payments still derive normally. The original statistical audit rows remain available; this is not a blanket government-account skip or a tolerance change.

## Baseline versus treatment

| Measure                                         |             Baseline |   Treatment |
| ----------------------------------------------- | -------------------: | ----------: |
| Divergent government accounts, each of 12 turns |                   23 |           0 |
| First-turn absolute unexplained delta, anchor   | 700,872,403,355.6318 |           0 |
| Trial balance, each turn                        |                Green |       Green |
| Unattributed bucket, each turn                  |                Empty |       Empty |
| Native treasury cash, every country/turn        |            Reference | Exact match |

Every country's closing native cash matches the unchanged baseline exactly at every one of the 12 turns. The repair does not alter fiscal revenue, spending, borrowing, debt stock, rates or signed-overdraft mechanics. No reimbursement or unexplained balancing credit is introduced.

Treatment records named revenue, primary spending, debt-service, enforcement and rounding components. Macro fiscal revenue/spending retain their existing modeled source/sink semantics; the witness does not pretend they are transfers from individual player accounts. An explicit rounding component records only the existing whole-unit cash rule.

The cash update and its component receipt share one guarded document write. Repeated or concurrent phase calls cannot apply that turn again. A deterministic ledger upsert publishes the stored receipt; a later invocation recovers it before replacing it with the next turn's receipt. Tests cover interruptions after the cash write and before/after publication, plus recovery on the next turn.

The replay also calls the real bond ledger emitter with an explicitly synthetic 1,234 USD service statistic. Baseline produces a phantom treasury cash leg; treatment produces no additional ledger entry and leaves treasury cash unchanged. The fixture does not claim an actual holder payment occurred.

## Validation and Mongo work

Twenty focused tests pass, including the stateful regression, duplicate concurrent calls, crash recovery, signed negative cash, enforcement/service components and existing 120-turn budget coherence. The unchanged test-timeout default was too short for local cold imports under host load; the same targeted command passed with a 60-second per-test allowance. Remote CI remains the full source gate.

| Treasury phase invocation   | Mongo commands | Returned BSON bytes |
| --------------------------- | -------------: | ------------------: |
| Baseline, each turn         |             44 |             123,236 |
| Treatment, first turn       |             69 |             124,227 |
| Treatment, subsequent turns |             92 |  133,603 to 133,619 |

The first invocation adds two batched context reads and 23 receipt publications. Subsequent turns also recover/upsert the previous 23 deterministic receipts before advancing. The added persisted component context costs at most 10,383 returned BSON bytes over baseline.

Measurements include the real treasury function and all its Mongo commands, with returned cursor-document BSON bytes. Snapshot reads, retry probes and synthetic telemetry emission are outside the measured phase call. The existing default phase budget is 500 commands; no budget is raised.

## Remaining acceptance and rollout

- This witnesses future accruals and recovers future retries. It does not rewrite historical snapshots or invent historical cash corrections.
- Other economic phases are held fixed. Other government writers, corporations, funds and pool-account lifecycles still require whole-turn reconciliation evidence. Trial balance and attribution here are fiscal-scope checks, not a full money-supply model qualification.
- #992 still needs its complete account inventory and 12 consecutive authoritative-banking whole-economy turns. #968 and #2159 remain open wherever their own criteria are unmet.
- Qualify through development and staging, observe per-kind stock-flow, treasury receipts and retry failures each turn, and preserve stored receipts on rollback. A rollback to a version without per-turn claims must not replay an already accrued turn.
