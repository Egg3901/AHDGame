# Issue 2978: state-enterprise treasury cash qualification

Runtime source: `ce11cde42570471b9e55a10cb232c4c626c1f243`.

The current-source twelve-turn cash diagnostic in #968 showed `government:UK:GBP` and
the UK primary national corporation diverging on every turn. The corporation's ledger
gained about 155,000 GBP of revenue per turn while its cash stayed near zero, and the
treasury gained unledgered cash. The two per-turn gaps differed by a constant 29,409
GBP.

A minimized native Mongo fixture (GBP rate 0.5, ledger shadow on) isolated the cause.
`remitToTreasury` for 150,000 GBP moved corporation cash by -300,000 anchor and
treasury cash by +300,000 anchor with no ledger movement on either account. A
30,000 anchor state capex grant moved treasury cash by -30,000 anchor with no ledger
movement. The treasury writers move `federalBudget.treasuryBalance` and enterprise
`liquidCapital` with direct increments, outside the fiscal accrual witness. The
constant world gap matches the per-turn capex grant offsetting the remittance.

## Change

- SOE profit remittances, CEO treasury draws, SOE loss backing and state capex grants
  publish the exact rounded native and anchor movement that landed on each real
  account. A leg is witnessed only when its write matched.
- Treasury legs use the balance snapshot's treasury valuation and currency.
  Enterprise legs use the snapshot's enterprise currency and exchange rate.
- Both sides of a remittance, draw or loss backing share the flow's settlement reason
  so the money-supply check nets the transfer. A capex grant sinks into the plant it
  buys.
- The corporation turn loads one accounting context with the processing turn and
  publishes one batch for the backing and remittance sweep, including when a later
  leg fails. Player draws publish immediately.
- No amount, rounding, unconditional debit, backing rule or reconciliation tolerance
  changed. Disabled shadow accounting behaves as before.

## Verified outcomes

The integration file runs eight cases against the memory store and the same eight
against an isolated local replica-set fixture. All 16 pass. Every reconciled fixture
has an unskipped stock check with zero divergences, a green trial balance and no
unattributed entries.

- A remittance of 150,000.4 GBP lands 150,000 on both accounts, nets under one reason
  and carries the processing turn rather than a stale game clock.
- A CEO draw into an enterprise held in USD reconciles both legs in their own
  currencies: +1,000 anchor for the enterprise and -2,000 anchor for the GBP treasury.
- Loss backing through the actual operations pass covers a -4,321.5 GBP hole and
  debits 4,322 GBP from the treasury; both legs reconcile.
- A state capex grant sinks 15,000 GBP into the plant it buys.
- A missing enterprise or treasury publishes only the legs that landed.
- Disabled shadow accounting keeps every cash outcome and writes no ledger rows.
- Landed cash is published when later phase work fails.
- The actual corporation sweep witnesses backing at the processing turn.

The focused nationalization, ledger, corporation turn and route suites (115 files)
pass: 1148 passed and 8 native opt-in cases skipped. Scoped lint, formatting,
semantic diagnostics for all 15 changed TypeScript files and the blocking
architecture checks pass. The full merge gate runs on the final pull request head.

## Cost and scope

The corporation turn adds one configuration read, and when shadow accounting is on
three projected reads (game state, exchange rates, treasury currencies) and at most
one batched ledger insert. A player draw adds the same reads and one insert. There is
no per-enterprise query.

Other treasury callers were audited. Spin-off fees, charter fund fees, the
corporation-creation premium, index petitions and the ownership-transition float
buyout already emit a government-side row. Nine event-driven call sites
(compensation, privatization proceeds, group relief, merger review fines and transfer
pricing assessments) do not; they are tracked in #2983.

These native fixtures qualify the state-enterprise boundary, not the whole world.
Whole-world residuals remain visible until a fresh run qualifies them, so this does
not clear #968 or the global cash gate in #2159. No production database was reset or
repaired.
