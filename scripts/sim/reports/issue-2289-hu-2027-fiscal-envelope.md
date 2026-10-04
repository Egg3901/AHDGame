# Issue #2289: Hungary 2027 fiscal envelope stress sweep

Run on 2026-09-25 with
`npx tsx scripts/sim/hu2027FiscalEnvelope.ts`. The script consumes the
production `getInitialNationalBudgetsForPreset("2027-default")` builder; the
budget input was introduced in `4a616f2a17` and its spending-selection rule in
`0586eb438f`. It starts no world and reads no database or player data.

The source observations are KSH's revised 2025 nominal GDP of HUF 87.045554
trillion and 2025 general-government revenue, expenditure, and debt of HUF
37.082, 41.141, and 64.912 trillion. The 2027 preset uses these latest
completed observations as an opening fallback. The fiscal allocation and
stress adjustments below are game assumptions, not KSH projections. Sources:
[KSH GDP table](https://www.ksh.hu/stadat_files/gdp/en/gdp0094.html) and
[KSH 2026 EDP notification](https://www.ksh.hu/s/en/publications/notification-of-balance-and-debt-of-the-general-government-sector-first-edp-notification-in-2026/index.html).

| Scenario                  | Revenue (HUF tn) | Spending (HUF tn) | Deficit / GDP | Debt / GDP after one FY |
| ------------------------- | ---------------: | ----------------: | ------------: | ----------------------: |
| authored opening          |           37.082 |            41.141 |         4.66% |                  79.24% |
| revenue 5% below opening  |           35.228 |            41.141 |         6.79% |                  81.37% |
| spending 5% above opening |           37.082 |            43.198 |         7.03% |                  81.60% |

The sweep holds GDP fixed for one fiscal year and adds the modeled deficit to
opening debt. It proves the authored budget builder reproduces the source
envelope and makes the deficit/debt sensitivity visible. It is not a forecast
of Hungarian public finance or proof of a ten-year world trajectory. The
exact-release 2027 bootstrap and the coordinated final validation campaign
remain required under #2159.
