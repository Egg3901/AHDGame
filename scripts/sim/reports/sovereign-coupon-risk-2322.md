# #2322 sovereign coupon risk sensitivity

Source inputs: AHDGame commit `9461ef2e34abe44a91893615cef1b20074a21ae5` with the candidate issuer-risk correction. Reproduce with:

```sh
npx tsx --tsconfig tsconfig.json scripts/sim/sovereignCouponRisk2322.ts
```

The JSON output beside this report uses the production `calculateCreditRating`, `CREDIT_RATING_SPREADS`, `getEffectiveRate`, `getSovereignCouponRate`, and `computeMarketDemand` functions. With prime at 5%, 1B face, 48-turn maturity, and no chair or democracy spread, the issued/auction rating component moves from 5% at AAA, to 8% at BBB, to 17% at CCC, then back to 5% at AAA. Annual coupon service on a fixed 1B balance is 50M, 80M, 170M, and 50M. A rollover reprices newly issued paper at the current tier; an existing 5% instrument remains at 5%.

This is a formula sensitivity, not an endogenous debt trajectory. Debt/GDP and the rating path are scenario inputs, principal is held fixed, and there is no output, tax, primary-fill, or GDP feedback. The increase in quoted coupon alone does not establish whether higher coupons worsen or relieve a world-level debt spiral. Run a source-pinned sandbox comparison before claiming that balance acceptance.

The risk component now matches the rating-only yield in the auction snapshot for the clean 48-turn case. Full coupon parity is not claimed: the snapshot uses `getEffectiveRate` and can apply the recovery-credibility discount, but does not include bond term, chair-credibility, or democratic spreads. New coupons include term/chair/democratic spreads and do not consume the snapshot recovery discount. These pre-existing differences are outside the bounded issuer-rating correction and should be modeled as separate follow-up requirements if exact issued-yield parity is desired.

The fixed-principal refinance sensitivity spans turns 0 through 240, with externally supplied ratings AAA, CCC, AAA, BBB, CCC, AAA at successive 48-turn maturities. Newly created coupons are 5%, 17%, 5%, 8%, 17%, and 5%; each old instrument retains its stored coupon until maturity. This is a quoted debt-service sensitivity on an unchanged principal, with no claim that the world can finance those obligations.

Source regressions cover rating validation, normal/scheduled and rollover issuance, admin and deposit-insurance issuance, reconciliation, bootstrap seeding, auction snapshots and demand. All 103 tests across five suites pass. The issuer-risk calculation and coupon combination are portable rules. No additional Mongo read is introduced: callers reuse the budget they already loaded. Full combined qualification and endogenous-world acceptance remain pending.
