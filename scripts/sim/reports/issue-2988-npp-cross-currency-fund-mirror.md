# Issue 2988: cross-currency NPP fund mirror qualification

Runtime source: `be00d66041a2e43de1ad77af49c13db81be8b2e5`, rebased onto #2987 and #2991 and requalified.

The current-source twelve-turn cash diagnostic in #968 reported all 18 index funds with
cash above ledger on turns 4, 8 and 12. On turn 4, NPP investing emitted 10,486
`index_fund_subscribe` rows. Every row derived its NPP-side entry, but only 4,663
derived the fund-side mirror. The other 5,823 came from NPPs whose home currency
differs from the fund's, and `fundMirrorAccount` failed closed on the currency
mismatch. Their anchor values sum to 2,610,312, exactly the turn-4 fund divergence
total.

## Change

- NPP investment cash is anchor-denominated, and its fund rows state the anchor value
  in both `amount` and `anchorAmount`. Such a row now settles against the fund's own
  currency key, `fund:<fundId>:<fundCurrency>`, for exactly the row's anchor amount, so
  the fund side is witnessed with no exchange-rate guess.
- The mirror's fund leg carries the fund key's currency. Same-currency rows behave
  exactly as before.
- Native-currency holders (characters, pension schemes) with a currency mismatch still
  fail closed.

## Verified outcomes

- Actual NPP investing by a UK NPP into a USD global fund reconciles in memory and on an
  isolated local replica-set fixture: no stock findings, no unbalanced entries, no
  unattributed movement, and the fund's primary legs equal the amount invested.
- With the base derivation the same fixture reports a fund stock finding.
- A native-currency character row across currencies still derives one single-sided
  entry.
- The queued cross-currency NPP redemption test now asserts the exact fund-side debit
  instead of its previous absence.
- Ledger, index fund, pension and transaction-log suites (70 files) pass: 656 passed
  and 56 native opt-in cases skipped. Scoped lint, formatting, semantic diagnostics for
  the 3 changed TypeScript files and the blocking architecture checks pass.

## Cost and scope

Derivation only: one extra mirror entry per cross-currency NPP fund row, no new
queries. Native fixtures qualify the derivation boundary, not the whole world, so this
does not clear #968 or the global cash gate in #2159. No production database was reset
or repaired.
