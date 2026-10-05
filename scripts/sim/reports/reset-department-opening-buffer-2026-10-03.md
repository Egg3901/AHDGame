# Reset department opening buffer simulation report

Date: 2026-10-03

Scope: opening working capital for ordinary v2 Cabinet department accounts. Each ordinary
department starts with cash equal to one year of its net annual authority. Defense and intelligence
remain externally settled and receive no duplicate balance. The opening cash is treated as a
historical pre-reset transfer already represented within the country's seeded debt stock, so the
reset does not add another sovereign liability or Treasury expense.

## Method

`scripts/sim/resetDepartmentOpening240.ts` runs the portable department account rule for 240 turns,
or five complete 48-turn fiscal years, for the United States, United Kingdom, and Japan.

Two deterministic scenarios are compared:

- `source_funded`: Treasury pays every scheduled ordinary department claim.
- `authority_cut_20`: Treasury pays 80% of each scheduled ordinary department claim.

The harness measures opening and closing working capital, paid authority, actual program outlay,
unmet demand, arrears, overdrafts, and the accounting residual on every department settlement.

## Results

| Country | Scenario     |     Opening buffer |     Closing buffer |       Buffer drawn | Unmet demand | Largest residual |
| ------- | ------------ | -----------------: | -----------------: | -----------------: | -----------: | ---------------: |
| US      | Fully funded |    436,215,774,600 |    436,215,774,600 |                  0 |            0 |                0 |
| US      | 20% cut      |    436,215,774,600 |                 60 |    436,215,774,540 |          180 |                0 |
| UK      | Fully funded |    152,439,400,000 |    152,439,400,000 |                  0 |            0 |                0 |
| UK      | 20% cut      |    152,439,400,000 |                 80 |    152,439,399,920 |          240 |                0 |
| JP      | Fully funded | 85,814,200,000,000 | 85,814,200,000,000 |                  0 |            0 |                0 |
| JP      | 20% cut      | 85,814,200,000,000 |                 80 | 85,814,199,999,920 |          160 |                0 |

Under full funding, each country preserves the complete one-year buffer across five years. Under a
continuous 20% authority cut, the buffer sustains normal program outlay for almost exactly five
years before exhaustion, which is the expected duration for a one-year reserve covering a 20%
annual shortfall. No scenario creates an overdraft, supplier arrears, or an accounting residual.
For every cut scenario, program outlay equals current Treasury authority plus the measured draw
from opening working capital.

## Verification

```text
npx tsx scripts/sim/resetDepartmentOpening240.ts
npx vitest run scripts/sim/resetDepartmentOpening240.test.ts
```

The test also verifies that fully funded accounts preserve their opening buffer, cut scenarios
cannot draw more than the opening balance, and all six country-scenario runs conserve account cash.
