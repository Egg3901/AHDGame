# Issue 2983: ledger witnesses stamp the turn their snapshot closes

Runtime source: `2e444f14a776bc558a48bd68ff206c86eafb674b`.

Turn T reconciles its ledger entries against the balance snapshot written near
the end of processing T. The game clock (`gameState.currentTurn`) only
advances when a turn completes. While turn T processes, the clock still reads
T - 1. Between turns, it reads the turn already reconciled.

Three witness contexts fell back to the clock itself when their caller supplied
no turn: the treasury cash context, the bond pool context and the spawned
corporation starting grant. Cash they witnessed was therefore stamped one turn
early. It was reconciled against a snapshot that never saw it, and the turn
whose snapshot did see it reported the movement as unexplained. In-turn callers
that pass their processing turn were already correct. The fallback is reached
by request paths (bond trades, admin spawns, fines and relief raised outside a
phase) and by event flows that run inside a turn without a turn argument.

Privatization, auction bids and whole-corporation nationalization forwarded the
executive route's turn, which is the clock, and had the same defect.

## Change

- `ledgerTurnFromClock` names the rule: cash that moves now belongs to
  `currentTurn + 1`.
- The three contexts default to it. Explicit processing turns from phases are
  unchanged.
- Privatization, auction bids and whole-corporation nationalization use the
  default instead of the caller's turn. Holder buyout rows follow the witness
  turn.
- Fixtures now set the clock to the turn before the one they reconcile, as
  production does. Previously the clock equaled the reconciled turn, which
  production never has, so the off-by-one went undetected.

## Verified outcomes

- `ledgerTurn.test.ts` checks that with the clock at 4 both contexts default to
  5, explicit turns are kept, and a starting grant without a founding turn lands
  in 5.
- The six ledger integration files (bond pool, secondary pool, starting grant,
  treasury cash, treasury events, state ownership cash) pass in memory and on an
  isolated replica set: 92 passed, 35 of them native or replica cases.
- Red check: with the old defaults and the corrected fixtures, 19 cases fail.
- Focused suites (283 files): 2,809 passed, 97 native opt-in cases skipped,
  0 failed. Scoped lint, formatting, semantic diagnostics for all 14 changed
  TypeScript files and the blocking architecture checks pass.

## Scope

Transaction log rows written on request paths carry the clock as their turn,
and wire transfers carry turn 0. Their derived ledger entries therefore land in
a turn that never reconciles them. That affects player actions across many
routes and needs its own decision. Simulated worlds have no request paths, so it
does not affect the #2159 cash gate. No production database was reset or
repaired.
