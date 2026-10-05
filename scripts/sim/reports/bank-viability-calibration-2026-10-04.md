# Bank viability and funded bill calibration, 2026-10-04

## Finding

The neutral viability target is not qualified. The updated deterministic bank-only diagnostic reports 26.91% annual realized ROE for the actual 1991 US opening-rate scenario, above the agreed 8 to 15% band, but its production-rule auction trace reaches `crisisPending` at turn 328. The bank-only return must not be presented as a neutral ten-year result once sovereign distress has been detected. The aggressive legal-risk scenario becomes insolvent at turn 240 after the injected recession shock. Neither result is production acceptance.

The earlier 3% opening-prime, joint bank/public-float claim gate, omitted realized discount gains, and last-turn annualized income estimates are superseded. Actual 1991 US opening prime is 7%. Bank coupons and principal settle separately before public-float claims. Paid principal returns original acquisition basis; only the difference is realized income. Actual coupon receipts are income. Unpaid claims provide no cash.

## Reproduction

Run `npx --no-install tsx --tsconfig tsconfig.json scripts/sim/bankViabilityCalibration.ts`. The script reads public seed and rule code, prints JSONL, accesses no game database, and starts no world simulation.

This checkpoint uses the shared production positive-carry sweep, quote, funding-cost, cash-floor, public-float novation, market-demand, loan-demand, fee, premium, and solvency rules. The diagnostic tracks full-year income over average equity, equity movement over average equity, and compound annual equity growth separately. Cash transfers among the bank, households, market pool, Treasury and insurance fund are paired. Institutional pool inflow and sweep remain explicit system boundaries.

The annual auction trace uses the production US fiscal-year close calendar, `computeMarketDemand`, `classifyAuctionOutcome`, and `computeNextCrisisState`. It caps demand with the modeled aggregate primary-pool placed/requested ratio, and reports requested and placed units at each scheduled primary auction. The 1991 country seed is player-enabled, so the production crisis eligibility gate is active. This bank-only model has no NPP state, player or NPC holdings beyond the modeled bank, exchange-rate path, default history, executive decision, or crisis resolution. It stops crisis-state progression at `crisisPending`; it does not infer repudiation or apply a default credit overlay. The decision-window deadline is reported from the production 12-turn constant, not as a default date.

## Results

| Scenario                                                                       | Realized annual ROE | Economic annual ROE | Equity CAGR | Failure turn |
| ------------------------------------------------------------------------------ | ------------------: | ------------------: | ----------: | -----------: |
| 1991 US seeded rates, funded sweep and public-float novation                   |              26.91% |              24.64% |      27.74% |         none |
| Legacy nearest-maturity and cash-only comparison                               |             -24.58% |             -20.49% |     -12.33% |         none |
| 1991 US, zero-opening-pool sensitivity                                         |              27.58% |              25.31% |       26.9% |         none |
| 8.5% prime, midpoint deposits                                                  |              29.41% |              26.48% |      25.88% |         none |
| 8.5% prime, legal minimum deposits                                             |              25.74% |              23.47% |       36.3% |         none |
| 1991 aggressive, legal maximum deposits/minimum lending, recession at turn 240 |            -136.33% |            -136.33% |         n/a |          240 |

The seeded neutral auction trace is fully subscribed at turns 40, 88, and 136. Turn 184 is undersubscribed at a 0.708 pool fill. Turns 232, 280, and 328 fail at pool fills of 0.518, 0.443, and 0.401; the third consecutive annual failure enters `crisisPending` at turn 328. Those dates are the configured US fiscal closes, and the fills are sums of actual modeled primary placements over requested units. The source diagnostic's 12-turn executive decision window ends at turn 340. No resolution choice is modeled, and the bank-only ROE after that point is not a valid neutral acceptance result.

The baseline includes $30.424M of lifetime realized bill gains. Omitting those gains produces misleading operating-income ROE. The held-bill cost basis and unrealized gain bridge reconciles equity exactly in every scenario. Cash conservation error is at most $0.40 across the printed scenarios on trillion-dollar system stocks; this is floating-point arithmetic, with a $1 assertion tolerance.

## Inputs and boundaries

- The reference seed has $6.2T US GDP, $3.665T sovereign face and $4.03T external broad money. The registered pool migration initializes $201.5B of pool cash. Zero opening pool cash is an explicit sensitivity. Spendable Treasury cash opens at zero. Signed fiscal projections are not spendable cash.
- The representative bank starts with $5M capital, 250 financial-sector capacity units, 50% branch share and a $150M deposit ceiling. Seeded rate offsets are -1.75 percentage points for deposits and 4.125 for lending. The fixture runs 480 turns.
- Quarterly issuance, scheduled Treasury/BondTurn ordering, conserved par novation, residual public-float cash payment, unpaid maturity stock and contractual coupon cutoff are modeled. No coupon accrues after maturity.
- GDP, inflation, integrity, FX, entity participation and fiscal primary inputs are held constant. Market appetite responds to modeled debt, rating and prime through the production demand core. The neutral scenario falls below the sovereign distress threshold during its run, but the complete sovereign default/crisis state machine is outside this bank-only fixture. It must not be presented as a whole-world ten-year forecast.
- Recession scenarios inject a five-point prime increase, five-times loan default rate and the existing production stress-haircut formula. The shock is a conditional fixture, not evidence that an ordinary world will generate it.
- The reference seed fiscal budget differs from the final world after political budget initialization. This report is not a measurement of a deployed world or its final fiscal cash constraints.
- Retail service-fee and high-premium rows are labeled sensitivities. They do not introduce an approved runtime fee or select a premium. A single representative-bank failure cannot calibrate portfolio insurance frequency. Measured premiums retain the production fallback until cohort evidence qualifies.

## Remaining acceptance work

The production bank earnings projection must preserve actual funded coupons across TreasuryTurn/banking/BondTurn order and count genuine realized sale/redemption gains without treating returned principal as profit. Near-maturity executable quote economics and the evolving sovereign demand/default path require qualification before any balance adjustment. Full-program production rollout also needs the reviewed source promotion, startup migration/index verification and read-only or specifically authorized live checks. No feature activation or world advance is authorized by this report.

The target is still open. Do not close bank viability or insurance calibration on these results.
