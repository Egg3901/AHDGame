# NPP bond cash witnesses (#2911)

## Defect and repair

The real bond processor credits NPP investment cash for coupons and matured principal without a shadow cash witness. A synthetic native three-holder coupon case reproduces three stock-versus-flow differences while the trial balance remains green. Retained world accounting independently found 180 NPP differences totaling 502.61 anchor units on its final turn.

The repair keeps the existing accumulated cash total, FX conversion, rounding, operation ordering and investment account. Coupon and principal attribution split the already rounded total. It never recomputes the cash total by regrouping floating-point inputs.

Each eligible NPP cash update carries a bounded publication stamp in the same atomic Mongo operation. A projected cohort read admits only matching landed stamps after a successful or partially failed batch. Ledger upserts reuse prepared ids, so publishing the same witnesses again adds no duplicate. Missing recipients and rejected operations produce no witness. Observer errors remain observational and cannot fail landed game cash.

This stamp is not a durable outbox. A process crash or observer failure still needs retained publication inputs to recover its receipt. It does not make retrying the entire bond phase idempotent.

## Native verification

Run `npx tsx scripts/sim/verify-npp-bond-cash.ts --out result.json` with `SIM_MONGODB_URI` pointing to an isolated local sandbox on port 27018. The script refuses other endpoints, asserts every case database is empty, and drops only its own newly created databases. It uses the actual writer, actual bond processor, authoritative balance reader and reconciler.

All nine cases pass their assertions:

- Normal USD/GBP/JPY investment accounts: three receipts, zero stock differences.
- Mixed coupon/principal returns: six separately attributed receipts, unchanged combined cash, zero differences.
- Real ordered Mongo failure after the first landed credit: one receipt, no receipt for either rejected or unexecuted operation, zero differences.
- First-operation rejection, missing recipients and zero returns: zero receipts and zero differences.
- Shadow disabled: identical cash credits, zero receipts and three expected unobserved differences. This case does not claim conservation qualification.
- Actual corporate-bond coupon and maturity processor calls: three and six NPP receipts respectively; all issuer and holder accounts reconcile with zero differences.
- Repeated and mismatched-stamp publication adds no duplicate receipt.

Every enabled case has a green trial balance and zero unattributed entries. The focused bond processor and rounding suites pass 64 tests. A native sovereign-maturity probe separately exposes an existing government-side cash-witness discrepancy; corporate-maturity qualification does not hide or waive that broader finding.

The normal observer call makes five Mongo commands and sends 3,124 request BSON bytes versus two commands and 703 bytes with shadow disabled. Mixed returns make five commands and send 4,592 bytes. Actual complete corporate coupon and maturity calls make 33 and 36 commands respectively, below the bond phase's 1,000-command budget. Measurements include the uncached flag lookup and use the same generated database-name length. Publication uses cohort reads and bulk writes, with no per-holder queries.

The implementation PR records the final source and hosted delivery checks. These bounded fixtures qualify the NPP observer repair, not global accounting, a full-world performance run, or the release gates under #968, #991 and #2159.
