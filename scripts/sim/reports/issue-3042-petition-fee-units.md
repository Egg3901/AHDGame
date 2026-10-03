# Issue 3042: listing petition fee in the corporation's currency

Runtime source: `6e0d78980d9987ad4033a5347ef6c60d7c0bbc98`.

`fileListingPetition` takes an anchor-denominated contribution, but it debited
that number from the corporation as units of the corporation's own currency, and
credited a seated holder the same figure. At 2019 rates, a GBP corporation paid
about 1.3 times the anchor value and a JPY corporation about 1/110 of it. On the
treasury branch, the treasury received the properly converted anchor amount, so
it got a different value than the corporation paid.

## Change (owner decision, 2026-10-03)

- The contribution is converted at the corporation's rate (`getCorpFxRate`) for
  the debit, the refund on a failed insert and the seated holder's credit.
- The petition record and the automatic decision rule keep the anchor figure.

## Verified outcomes

`petitionCash.ledger.integration.test.ts`, with GBP valued at 0.5 anchor:

- A 1,000 anchor petition costs a GBP corporation 500 GBP.
- A seated holder receives exactly 500 GBP.
- On the treasury branch, the treasury receives 500 GBP.
- Both branches reconcile with zero divergence, a green trial balance and
  nothing unattributed.

With the base service, both cases fail: the corporation pays 1,000 GBP and the
holder receives 1,000. Memory and native replica-set runs both pass (4 of 4, 2 native). The focused index fund and petition route suites (54 files) pass: 461 passed, 58 native opt-in cases skipped, 0 failed. Scoped lint, formatting and semantic diagnostics pass.

## Scope

This changes only what non-USD corporations pay to petition. No production
database was reset or repaired.
