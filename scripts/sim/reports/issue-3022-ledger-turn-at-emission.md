# Issue 3022: ledger entries land in the turn whose snapshot holds their cash

Runtime source: `901ef2ad29b9a24b308ce72bc70c75513e009914` (emission restamp `711b93aa24b02c175ea0fbb4edbf15222a9020a3`, journal pass on top).

Turn T reconciles its ledger entries against the balance snapshot written near
the end of processing T. The game clock only advances when a turn completes.
Request routes stamp their transaction rows with `getCurrentTurn`, which is the
turn already reconciled, and wire transfers stamp `turn: 0`. The shadow ledger
copied those turns onto derived entries, and journals that write their own
ledger entries copied their command's turn too. A player's cash was therefore
reconciled in a turn that had already closed (or never), and the turn whose
snapshot held it reported the movement as unexplained.

## Change (owner decision: restamp at emission)

- `emitLedgerEntries` stamps every entry with the turn whose closing snapshot
  will hold its cash, resolved once per batch: one past the clock, which is
  also right while a turn is processing.
- `processTurn` runs its phases inside a ledger turn scope, so phases resolve
  the processing turn without a clock read.
- Rows keep their own turn for display. Without a clock, entries keep theirs.
- Journals that write their own ledger entries resolve the turn once when they
  plan, and stamp only their ledger projections. This covers the treasury
  reserve transfer, monetary operations, fund float trades and their reversal,
  queued fund payouts, player fund command audits, lines of credit and sovereign
  primary settlement.
- Plans are persisted with their receipts, so replays reuse the same turn. A
  fund command audit, which is built after the cash moved, takes one past the
  clock its command recorded.

## Verified outcomes

- The acceptance fixture runs a wire transfer between two snapshots. The rows
  keep `turn: 0`, the ledger entries land in turn 5 (clock 4), and turn 5
  reconciles with zero divergence and a green trial balance.
- Inside the scope, a phase's entries take the processing turn with no clock
  read. With no clock, entries keep their turn.
- Red check: with the base emitter, the acceptance case fails (its entries stay
  at turn 0).
- Every native-capable ledger and journal fixture passes on an isolated replica
  set, in one run on the final head. The run covers treasury events, treasury
  cash, state ownership cash, treasury spend, starting grants, org building,
  petitions, the secondary bond pool with its replica-only phase budget,
  monetary pools, NPP fund mirrors, prop trading, fund float recovery and queued
  redemption recovery: 216 passed, 0 failed.
- Broad ledger-touching suites (1,270 files) pass: 12,976 passed. The only
  failures were two cold-import timeouts in
  `turnSystem.initializeGameState.test.ts`, which fail identically on
  development under host load.
- Journal suites (208 files) pass: 2,006 passed, 0 failed.
- Scoped lint, formatting, semantic diagnostics for all 22 changed TypeScript
  files and the blocking architecture checks pass.

Fixtures that set the clock to the turn they reconcile now set it one turn
earlier, as production does. The ones that simulate a phase with a stale clock
run inside the scope, as `processTurn` now does.

## Cost

Inside a turn: none. Outside a turn: one projected `gameState` read per
ledger emission batch, and one per journal plan. No production database was
reset or repaired.
