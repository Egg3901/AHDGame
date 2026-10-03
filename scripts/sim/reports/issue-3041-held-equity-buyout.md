# Issue 3041: seized shareholdings are paid for in the buyout, not credited as cash

Runtime source: `e3bbf25bddaf84cba2918945587a45a4416d70f8`.

A whole-corporation taking moved the seized corporation's shares in other
companies to the National Corporation, and also credited the National
Corporation their market value in cash. Nothing paid for that credit, so every
taking of a holding company created money. #3013 made it visible as the named
mint `nationalization_held_equity`. The seized corporation's own shareholders
were never paid for those holdings, because the valuation left cross-company
equity out.

## Change (owner decision, 2026-10-03)

- The holdings are read once, with the other valuation inputs, and valued at
  market in anchor terms.
- Under plants they join `nonSectorAssetsAnchor`, taken at par like cash.
  Below plants they join balance-sheet equity.
- The buyout pool therefore pays the holders for them. The treasury recoup and
  CEO surplus split follow from the larger pool.
- The National Corporation receives the shares only. The cash credit and the
  held-equity mint are gone.

## Verified outcomes

`stateOwnershipCash.ledger.integration.test.ts` drives `nationalizeWholeCorp`
in memory and on an isolated replica set. The seized corporation has 40,000 GBP
of cash (80,000 anchor), 70,000 anchor of debt, and 50 shares worth 500 USD in
another company.

- The discounted buyout pool is (80,000 + 500 - 70,000) x 0.5 x 5 = 26,250
  anchor. Before this change it was 25,000.
- The National Corporation's cash is unchanged at 10,000 GBP, and it holds the
  50 shares.
- Eight entries reconcile with zero divergence, a green trial balance and
  nothing unattributed. No held-equity mint remains.

Memory and native replica-set runs both pass (10 of 10, 5 native). The focused nationalization, fund payout and route suites (56 files) pass: 475 passed, 17 native opt-in cases skipped, 0 failed. A unit test pins the share transfer with no cash credit. With the base code,
both cases fail: there is a cash credit and the pool is 25,000. Scoped lint,
formatting, semantic diagnostics and the blocking architecture checks pass.

## Scope

This changes payouts for whole-corporation takings of corporations that hold
shares elsewhere. Holders are paid more, and the National Corporation no longer
receives unpaid cash. Held bonds are still left out of the valuation. No
production database was reset or repaired.
