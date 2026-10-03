# Issue 2983 part 3: crisis, settlement, peace and world-event treasury cash

Runtime source: `f4400a191eb485d133e99a8b727d078666f0d49d`.

After the nationalization family, two kinds of treasury writer were still
unwitnessed: callers of `budget/treasurySpend`, the canonical treasury mover,
and two direct `federalBudget.treasuryBalance` writers.

- Crisis responses: global response costs, collective contributions, Vietnam
  support, union strike concessions and the crisis engine's own option debit.
- Emergency aid pledges and their clawback when the aid vote fails.
- Settlement crisis plays and the per-turn mobilisation levy.
- Peace-term indemnities between two treasuries.
- World event treasury payouts already wrote a row, but the row had no reason
  mapping, so it fell into the unattributed backlog.

## Change

- `spendFromTreasury` and `creditTreasury` take an opt-in witness that books
  exactly the movement that landed, after the mover's own rounding of the
  balance.
- Crisis costs witness under `crisis_response`. Aid and its clawback share
  `crisis_aid`, so they net. Settlement plays and the levy witness under named
  reasons. The levy loads one context and publishes one batch per turn.
- Peace indemnities witness both treasury legs under `peace_indemnity` after
  the transfer commits, and only the legs that applied. A resumed or replayed
  transfer is witnessed once.
- `world_event_payout` maps to `world_event`.
- A crisis choice now checks approval before it charges the treasury.
  Previously a choice rejected for approval still lost its budget.
- The registry guard now also classifies every `treasurySpend` caller, so a new
  caller fails until somebody declares how its cash is witnessed. Adding it
  found one unregistered caller, the collective contribution, which is now
  witnessed.

## Verified outcomes

`treasurySpend.ledger.integration.test.ts` drives the real writers against the
real reconciler. GBP is valued at 0.5 anchor, and the four settlement seats cover
four currencies. 7 memory cases and 8 native cases pass, including a negotiated
indemnity replayed on an isolated replica set. Every reconciled case has zero
divergence, a green trial balance and nothing unattributed. The cases cover:

- a crisis response sink
- aid netted against its clawback
- a fractional spend whose witness equals the landed rounded movement
- the mobilisation levy on four seats in one batch
- an imposed indemnity across currencies, and a negotiated one witnessed once
- a named world event payout
- shadow accounting off

Red checks:

- With the base writers, all 6 reconciled memory cases fail. The shadow-off case
  passes.
- A crisis engine test that rejects a choice for approval fails against the old
  engine, which charged first.

Part one and part two native cases pass on this head too: 49 passed, 25 of them
native.

The focused crisis, conflict, settlement, military, events, budget, ledger,
nationalization, extraction, transaction log and route suites (376 files) pass:
4,257 passed, 26 skipped. Scoped lint, formatting, semantic diagnostics for all
20 changed TypeScript files and the blocking architecture checks pass.

## Scope

With this change no treasury writer in the guard is an open gap. Transaction log
rows written on request paths still stamp the game clock as their turn, which is
tracked separately. These fixtures qualify flow boundaries, not the whole world,
so this does not clear #968 or the #2159 cash gate. No production database was
reset or repaired.
