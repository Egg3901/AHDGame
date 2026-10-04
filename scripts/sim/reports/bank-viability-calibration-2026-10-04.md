# Bank viability and funded-bill calibration, 2026-10-04

## Finding

This deterministic model does not support a viability acceptance or a premium adjustment. Under the current treasury claim guard, the 1991 US seed produces no bank coupon cash or bank principal redemption during the 480-turn horizon. Claims remain due. A separate spendable treasury cash stock is required before bill yield can count toward bank income.

The 1991 seed starts with `treasuryBalance = -$3.665T` and bond principal of `$3.665T`. This is the legacy signed fiscal-position convention. It is not spendable opening cash. `processTreasuryTurn` and the bank claim transfer both use it, so the bank coupon guard cannot fund claims while it remains negative. The offline model preserves that starting value and only credits actually pool-funded issuance proceeds. After ten years of static opening-budget flows, scheduled issuance, coupon repricing, and finite pool cash, the modeled signed position remains about `-$2.749T`. The actual bank coupons paid are zero; `$0.767M` of bank coupon claims and `$20.665M` of bank maturity principal remain due in the 1991 balanced case. Due principal is reported separately as a government receivable, not cash or executable bill liquidity.

There is also a source-level rate mismatch that materially affects any cash model. The 1991 budget seed reports `$274.875B` annual debt interest, equivalent to 7.5% of `$3.665T`. Live `treasuryTurn` computes debt service from `sovereignDebtTerms`, which resolves to 2.0% for this seed, or about `$73.3B` annual service at opening. The budget's primary balance excluding its displayed debt-interest line is a `$72.002B` annual surplus. Quarterly issuance is still sized from the displayed deficit of `$202.873B`. The model keeps these separate and does not rewrite either value. A cash-ledger change must preserve the legacy signed fiscal track while making funded issue receipts and actual cash outflows explicit.

## Reproduction and inputs

Run `npx --no-install tsx scripts/sim/bankViabilityCalibration.ts` from the AHDGame checkout. The script reads no world data and queues no world simulation. It uses production loan, deposit, fee, premium, seed-budget, sovereign coupon, issuance ladder, bond quote, and pool-replenishment rules.

The 1991 US inputs are read from `getInitialNationalBudgetsForPreset("1991-default")`: GDP `$6.2T`, annual revenue `$939.2136B`, annual spending `$1,142.0865B`, displayed debt interest `$274.875B`, 3.0% prime, and 4.2% inflation. The bond-pool target uses 5% of a conservative seeded external broad-money baseline of `$4.03T`, or `$201.5B`. This is a lower-bound model input, not a read of live or restored pool documents. The first scheduled 48-turn rung is `$12.680B` face before underwriting depth. The scheduled issue starts after turn 0; bank purchase logic runs earlier in a turn, so a new issue is not available to the bank until a later turn.

Bank assumptions are explicitly representative, not population estimates: `$5M` opening capital from the existing charter formula, 250 financial-sector capacity units, 50% branch share, `$150M` branch deposit ceiling, 20% reserves, 480 turns, and a household liquidity pool equal to the seeded `$4.03T` external broad-money baseline. The model applies the existing cash floor and pool quote/depth rules. It does not infer 1991 bank counts or player balances.

The simulator recognizes a bank coupon only when the existing signed treasury-position check can fund its complete frozen claim. It does not treat requested sovereign face, pool inventory, budget display interest, or the opening negative position as spendable cash. Unpaid coupons and principal remain explicit due claims. The due principal receivable is included in ending equity at face for continuity, but it is excluded from cash, withdrawal coverage, and executable bill marks. This is diagnostic bookkeeping, not a claim about expected recovery.

## Results

| Scenario                                                 | Ending equity |  Deposits |     Loans | Actual bill coupons received | Unpaid bank coupons | Unpaid maturity principal | Ending signed fiscal position |
| -------------------------------------------------------- | ------------: | --------: | --------: | ---------------------------: | ------------------: | ------------------------: | ----------------------------: |
| 1991 seed, balanced, current settings                    |      `$7.97M` | `$23.01M` | `$10.30M` |                         `$0` |           `$0.767M` |                `$20.665M` |                    `-$2.749T` |
| 1991 seed, balanced, deposit rate APY + 2 pp             |      `$5.12M` | `$23.96M` | `$10.44M` |                         `$0` |           `$0.729M` |                `$18.629M` |                    `-$2.749T` |
| Neutral 8.5% prime, balanced, current midpoint           |     `-$0.73M` | `$22.59M` |  `$8.07M` |                         `$0` |           `$1.751M` |                `$13.767M` |                    `-$2.551T` |
| Neutral 8.5% prime, balanced, legal minimum deposit rate |      `$5.16M` | `$21.68M` |  `$9.52M` |                         `$0` |           `$1.954M` |                `$17.284M` |                    `-$2.551T` |
| Neutral, legal minimum deposits and maximum lending rate |      `$3.07M` | `$25.74M` |  `$6.61M` |                         `$0` |           `$2.184M` |                `$22.176M` |                    `-$2.551T` |
| Aggressive book, 5 pp prime shock at turn 240            |     `-$3.04M` | `$21.91M` |  `$8.46M` |                         `$0` |           `$1.587M` |                `$10.390M` |                    `-$2.376T` |

The minimum-deposit neutral case ends with only `$5.16M` equity and about `-$1.12%` annualized last-turn ROE. The current-midpoint neutral case is insolvent under this no-funded-coupon path, so ROE is not meaningful. The aggressive 5-point prime shock also ends insolvent, but this is not evidence that the credit-band recession model alone causes failure: unpaid Treasury claims are the dominant unresolved asset-side behavior. No 8 to 15 percent neutral ROE claim is made.

The model starts with no bills. It derives supply from quarterly issuance funded against the finite pool-cash lower bound. At the end of the 1991 scenario, the model has about 519.5M short-term public-float units available, but the bank has sold its holdings to protect cash; availability is not bank income. This supply projection is not production-world inventory evidence.

At the actual 1991 rate, a 48-turn `$1,000` sovereign bill has a 3% coupon, `$30` annual coupon, par mid, and `$990` bid / `$1,010` ask at target pool cash. Purchase-to-bid spread is `$20` per unit. The coupon is conditional on funded issuer cash. The neutral 8.5% rate unit case is included only as a rate sensitivity and is not the 1991 seed.

## Limits and next prerequisite

The 480-turn model holds GDP, tax revenue, primary spending, and the opening seed budget constant. It is a deterministic rules model, not a world forecast. Pool seed cash is inferred from the conservative broad-money seed; no live pool, bank, or player document was read. The model's funded public float comes from production issuance rules under that assumed pool depth. No actual-world inventory or performance claim follows from it.

The model exposed a missing accounting object: the repository has no separate government spendable-cash stock or general durable treasury arrears queue. `government:<country>:<currency>`, ledger snapshots, and money supply all map to `federalBudget.treasuryBalance`. A prerequisite cash-ledger change must leave that signed fiscal-position track intact, start fresh-world spendable cash at zero, credit only exact funded pool proceeds and collected fiscal cash, prevent cash from becoming negative, preserve unpaid obligations as durable claims, and split the bank coupon slice from aggregate debt service so the same coupon is not charged twice. It also needs an independent government-cash account for ledger and money-supply reconciliation. Existing worlds must not be silently healed or assigned an opening cash asset.

Premium calibration remains out of scope. Aggregate historical premiums and insurance payouts do not identify bank-year insured exposure, recovered asset paths, or failure frequency. Keep the premium constant unchanged until private identity-free loss denominators are available and funded bank income can be modeled without treating unpaid claims as cash.
