# Issue 2983 part 4: index listing petition treasury receipts

Runtime source: `9fe29bfb9105e437b45b13ff683df17c9338db20`.

The issue asked to verify the petitions row's units. Both rows of the treasury
branch were wrong.

When nobody holds the index committee seat, a listing petition's contribution
goes to the country treasury.

- The corporation's row pointed at a government counterparty. Government
  counterparties have no account id on a row, so its contra sank as
  `unattributed`.
- The treasury's row booked the anchor contribution as an amount in the
  corporation's currency. The treasury actually received the anchor amount
  converted to its own currency, so the treasury's stock check diverged by the
  difference.

## Change

- The treasury writer witnesses the credit that landed, under a named
  `index_listing_lobbying` reason.
- The corporation's row sinks under the same reason, so the pair is reported
  together.
- The treasury's row records the amount received in the treasury's currency. It
  is marked so it derives no second ledger entry.
- The branch where a seated holder receives the contribution is unchanged. Its
  two linked rows were already exact.

## Verified outcomes

`petitionCash.ledger.integration.test.ts` drives the real `fileListingPetition`
on both branches, with GBP valued at 0.5 anchor. It runs in memory and on an
isolated local replica set. Every case reconciles with zero divergence, a green
trial balance and nothing unattributed. On the treasury branch, the treasury row
records 500 GBP, which is what the treasury received.

With the base service and derivation map, the treasury branch fails and the
holder branch passes. The part-three and part-one native files also pass on this
head: 27 passed, 14 of them native. The focused index fund, ledger,
nationalization, transaction log and budget suites (163 files) pass: 1,523
passed, 84 native opt-in cases skipped, 0 failed. Scoped lint, formatting,
semantic diagnostics for all 5 changed TypeScript files and the blocking
architecture checks pass.

## Found, not changed

The corporation is debited the anchor contribution as if it were already in its
own currency, and a seated holder is credited the same figure. A GBP
corporation therefore pays twice the anchor value and a JPY corporation pays a
small fraction of it. That is an amount bug, left for an owner decision. The
money-supply check now reports it as net drift under the named reason. No
production database was reset or repaired.
