# Campaign era pricing acceptance (#2119)

## Result

Fresh worlds apply the existing GDP-per-capita-derived campaign price factor consistently to action spending and fundraising, campaign-manager upgrades and generated bundler income, campaign strength, campaign income and maintenance, NPP generation and action budgets, related tax projections, starting campaign endowments and onboarding rewards. The factor is an affordability proxy, not a measured consumer-price index.

Costs retain their modern ladder before conversion to whole era units. This prevents early 1953 donor-base upgrades from rounding to zero. Stored balances and player-directed transfers are not rescaled. Personal wealth is unchanged.

New configuration documents enable the factor. A non-reset seed uses `$setOnInsert` for this flag, preserving existing false or absent flags. No live configuration migration is part of this change.

## Existing full-world evidence and its limit

Two completed 1991 pilot worlds used source `d54c42626ad0e560c68c5eb2de977f43a5d2e83e`, with the same seed and explicit pricing off/on. Each processed 12 turns, ending at turn 13 with 2,729 NPPs, zero campaigns and no reported processing or integrity warnings/errors:

- Off: `2c23be7d-1d1c-4333-ba3f-87e2ee9cf7f3`.
- On: `0a36f6ac-cad6-41cb-8c98-aa91df948e9b`.

These worlds predate the completed wiring in this PR. They supply retained input data and prior pilot context, not proof that the new code ran or that player campaigns were exercised.

## Current-code replay

`campaignEraReplay.ts` reads only a completed sandbox source and runs the actual `processNppFundGeneration` and `processCampaignTurn` phases in a disposable database copy. It refuses non-loopback/non-sandbox connections and deletes only its generated replay database.

The cohort contains 128 retained NPPs, eight per country across 16 countries. Populations, currency bases and actor distributions remain fixed while the campaign price basis varies across all eight eras. Starting campaign balances are normalized to the same purchasing power. Three explicitly synthetic US NPP campaigns cover a level-zero campaign, a level-one campaign and an insolvent campaign with level-five maintenance and no fundraising upgrade. The source world had no campaigns, so these fixtures are not described as retained campaigns.

Each era executes 24 turns. A ninth arm repeats 1991 with pricing off. The replay requires nonnegative finite NPP balances, 72 campaign processings per arm, positive first donor-base costs and actual insolvency downgrades. The legacy-off arm must exactly equal the 2019 identity arm's normalized closing balances.

Every era's normalized campaign income, maintenance and closing balances is checked against 2019 with explicit whole-unit rounding bounds. Each rounded campaign flow permits at most 0.5 local unit per leg per turn, and each NPP's income plus two floored tax legs permits 2.5 units per turn; comparison includes rounding in both the era and reference arm. Mixed-currency cohort sums are only fixed-cohort parity diagnostics, not a measure of cross-country wealth.

Replay source: `59237642a1c4543aca526f5fb21f8416353eec70`, clean working tree. The final PR also contains runner-only TypeScript compatibility fixes, fixture mock updates and this report; gameplay code is identical to the replay source.

| Era  | Price factor | Campaign action | First donor upgrade | Maximum normalized campaign-balance drift | Allowed drift |
| ---- | -----------: | --------------: | ------------------: | ----------------------------------------: | ------------: |
| 1953 |      0.03673 |             735 |                 110 |                                   552.137 |       677.417 |
| 1979 |      0.16688 |            3338 |                 501 |                                    74.784 |       167.816 |
| 1991 |      0.35808 |            7162 |                1074 |                                    26.810 |        91.024 |
| 1999 |      0.49707 |            9941 |                1491 |                                    19.313 |        72.283 |
| 2007 |       0.6562 |           13124 |                1969 |                                    10.972 |        60.574 |
| 2019 |            1 |           20000 |                3000 |                                     0.000 |        48.000 |
| 2023 |      1.14996 |           22999 |                3450 |                                    13.774 |        44.870 |
| 2027 |      1.28579 |           25716 |                3857 |                                     4.013 |        42.666 |

All eight era arms passed their income, maintenance and balance drift bounds. All nine arms processed 72 campaign turns and produced exactly one campaign insolvency downgrade. NPP balances remained finite and nonnegative. The explicit 1991 flag-off control exactly matched the 2019 identity arm. This is 216 phase turns, 27,648 NPP processings and 648 campaign processings, without launching another full-world job.

## Performance and verification

The NPP income phase used 22 to 27 Mongo commands and 540,233 to 544,360 reply BSON bytes per invocation. The campaign phase used 15 to 18 commands and 7,325 to 10,801 reply bytes. Both remain below the default 500-command phase budget. Price loading adds two projected singleton reads per affected shell invocation, not a per-actor query; no budget increase is required. The GOTV projection reuses its existing preset/config reads.

Focused tests cover every authored era, flag-off identity, donor-base rounding, campaign-manager quote/debit parity, poll debit, batch affordability, NPP soft-cap normalization, starting campaign endowments without personal-wealth repricing, onboarding reward, configuration insertion, public price flags, client-status and income projections. The full PR CI gate covers typecheck, tests, format, lint, security and build.

## Scope of acceptance

The original issue asks for per-era costs or a deflator, consistent income rebalance and era-parameterized regression tests. The price basis now reaches the named action and campaign-manager paths, with focused stateful phase evidence and fresh-world activation. This report does not claim historical macroeconomic fidelity, a CPI model, all-era full-world release qualification, or validation of unrelated political recruitment and direct-NPP command pricing. Those are not acceptance criteria of #2119.
