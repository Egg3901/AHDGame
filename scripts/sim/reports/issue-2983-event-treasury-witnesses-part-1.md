# Issue 2983 part one: event-driven treasury witness qualification

Runtime source: `c8a7f351d9e9e4fc0cf705bf2828b0d6aeca0bd7`.

An audit of every caller of the nationalization treasury writers found event-driven
flows that moved `federalBudget.treasuryBalance` with no government-side witness.
This part repairs the ones whose counterparty side is already defined: merger review
fines and transfer pricing assessments, corporate group loss relief, and sector
nationalization compensation (single sector and sector wide), where the donor
corporation's credit was unwitnessed too.

## Change

- The generic treasury writers take an opt-in witness. A caller whose own rows lack a
  government side passes its flow; callers that already emit a government row pass
  nothing, so no treasury movement is booked twice.
- Fines pair with the corporation's `corp_fine` row under `regulatory_fine` (newly
  mapped; it previously fell to `unattributed`). Group relief pairs with
  `corp_group_relief` under `corporate_group_transfer`. Compensation witnesses the
  treasury debit and the donor credit under `nationalization_compensation`, the donor
  leg only when its update matched.
- A registry guard classifies every file that calls a treasury writer as built-in,
  opt-in flow, own row or tracked gap, and checks the declared flow is present. A new
  caller fails until classified.
- Whole-corporation nationalization and privatization proceeds stay registered as gaps
  under #2983 for part two. No amount, rounding or rule changes.

## Verified outcomes

The integration file drives the real treasury writers and the callers' own
corporation-side writes and rows through the real reconciler: four cases in memory
and the same four on an isolated local replica-set fixture. All 8 pass. Every
reconciled fixture has an unskipped stock check with zero divergences, a green trial
balance and no unattributed entries.

- A cross-border fine (USD corporation, GBP treasury) pairs `sink:regulatory_fine:USD`
  with `mint:regulatory_fine:GBP`.
- Group relief pairs both sides under `corporate_group_transfer`.
- Compensation witnesses both legs once.
- Calls without an opt-in publish nothing.

With the opt-in witness disabled, the three cash cases fail. Caller tests now assert
that compensation and the merger review fine pass their flows, and the guard covers
every other caller. The state-enterprise treasury file from #2984 still passes natively
on this runtime (24 of 24 across both files). The nationalization, corporate group,
merger review, ledger, transaction-log, petition, sponsorship and subsidiary suites (93
files) pass: 783 passed and 12 native opt-in cases skipped. Scoped lint, formatting,
semantic diagnostics for all 15 changed TypeScript files and the blocking architecture
checks pass.

## Scope

Each witnessed event adds the existing context reads and one ledger insert per leg when
shadow accounting is on. These fixtures qualify the treasury boundary for these flows,
not the whole world. No production database was reset or repaired.
