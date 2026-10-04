# Bank Treasury positive-carry rule report

This deterministic report runs the same portable quote, funding-rate, and
automatic-sweep planner used by bank Treasury trading. It is not a world
simulation. Reproduce it with
`npx tsx scripts/sim/bankTreasuryPositiveCarryReport.ts`.

The current funding hurdle comes from the production next-turn interest rule
divided by recorded deposits and borrowings. In this example, a USD bank with
100,000 in deposits at a 4% deposit rate has a 3.99984% annualized hurdle after
the same currency rounding used by the bank cash floor. With no recorded
liabilities, the hurdle is 0%.

| Contract                  | Dealer ask | Maturity | Coupon | Annualized contract yield | Auto result   |
| ------------------------- | ---------: | -------: | -----: | ------------------------: | ------------- |
| Face 1,000, one-turn bill |      1,010 |   1 turn |     7% |                 -40.5941% | Skipped       |
| Face 1,000, long bill     |      1,010 | 48 turns |     8% |                   6.9307% | Ranked first  |
| Face 1,000, long bill     |      1,010 | 48 turns |     6% |                   4.9505% | Ranked second |

The first bill returns 1,001.4583 at maturity from a 1,010 purchase, before
funding cost. It fails even with a 0% funding hurdle. The two long bills cover
the example's 3.99984% hurdle, so the 8% bill ranks ahead of the 6% bill. The
planner consumes float and spendable cash in that ranked order, with remaining
maturity and bond ID as deterministic tie-breakers.

This report verifies rule arithmetic and ordering only. It does not make claims
about whole-world solvency, bank failures, or recession outcomes.
