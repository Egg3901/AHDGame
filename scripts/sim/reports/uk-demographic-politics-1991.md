# UK 1991 demographic political sensitivity

Issue #3270. Reproduce: `npx tsx scripts/sim/ukDemographicPolitics1991.ts`.

Four stages isolate the changes: opening/live baseline (old social inputs, no release economic context, second era transform); release baseline (existing economic context plus second era transform); clean baseline (same old social inputs without that transform); treatment (corrected social inputs and unchanged 1991 shares).

| Region | Live econ/social | Release econ/social | Clean econ/social | Treatment econ/social | Old/retained total | Social label |
| ------ | ---------------- | ------------------- | ----------------- | --------------------- | ------------------ | ------------ |
| LON    | -2.29/0.86       | -2.21/0.86          | -2.33/0.83        | -2.33/1.06            | 100.00/99.99%      | Center-Trad  |
| SEE    | -1.41/0.94       | -0.34/0.94          | -0.37/0.92        | -0.37/1.18            | 99.00/100.01%      | Center-Trad  |
| SWE    | -1.31/0.91       | -0.41/0.91          | -0.56/0.86        | -0.56/1.24            | 98.00/100.01%      | Center-Trad  |
| EAE    | -1.41/0.89       | -0.48/0.89          | -0.51/0.88        | -0.51/1.24            | 99.00/99.99%       | Center-Trad  |
| EMI    | -1.42/0.89       | -1.26/0.89          | -1.32/0.86        | -1.32/1.30            | 98.00/100.01%      | Center-Trad  |
| WMI    | -1.75/0.86       | -1.79/0.86          | -1.81/0.82        | -1.81/1.29            | 99.00/100.01%      | Center-Trad  |
| YHU    | -1.59/0.84       | -2.17/0.84          | -2.24/0.82        | -2.24/1.30            | 99.00/99.99%       | Center-Trad  |
| NWE    | -1.67/0.86       | -2.26/0.86          | -2.29/0.84        | -2.29/1.30            | 100.00/99.99%      | Center-Trad  |
| NEE    | -1.63/0.89       | -2.58/0.89          | -2.63/0.85        | -2.63/1.34            | 99.00/100.00%      | Center-Trad  |
| SCO    | -1.57/0.84       | -2.55/0.84          | -2.61/0.82        | -2.61/1.24            | 99.00/100.02%      | Center-Trad  |
| WAL    | -1.53/0.84       | -2.57/0.84          | -2.60/0.81        | -2.60/1.33            | 99.00/100.01%      | Center-Trad  |
| NIR    | -1.75/0.82       | -1.75/0.82          | -1.78/0.81        | -1.78/1.28            | 99.00/100.00%      | Center-Trad  |

| Stage            | Population-weighted econ | Population-weighted social | Econ spread | Social spread |
| ---------------- | ------------------------ | -------------------------- | ----------- | ------------- |
| Live baseline    | -1.63                    | 0.88                       | 0.98        | 0.12          |
| Release baseline | -1.61                    | 0.88                       | 2.24        | 0.12          |
| Clean baseline   | -1.67                    | 0.85                       | 2.26        | 0.11          |
| Treatment        | -1.67                    | 1.24                       | 2.26        | 0.28          |

GB-only treatment means (excluding NIR): {"economic":-1.67,"social":1.24,"economicSpread":2.26,"socialSpread":0.28}.

## Actual campaign appeal and policy-distance sensitivity

Candidates both use economic -1.5 and influence 0, with social -2 versus +2. All other vote multipliers are equal. Shares normalize actual game appeal weights; distances are turnout-weighted Manhattan distances to the demographic positions. Granular columns use the actual pruned/coalesced vote substrate, including year resolution, rather than treating a cached regional average as every voter's position.

| Region | Group traditional share before/after | Granular traditional share before/after | Group liberal distance before/after | Group traditional distance before/after |
| ------ | ------------------------------------ | --------------------------------------- | ----------------------------------- | --------------------------------------- |
| LON    | 61.76/65.88%                         | 62.07/62.76%                            | 5.34/5.56                           | 3.67/3.53                               |
| SEE    | 59.54/65.52%                         | 63.07/63.98%                            | 5.16/5.46                           | 3.32/3.18                               |
| SWE    | 59.42/64.59%                         | 62.52/64.37%                            | 5.00/5.38                           | 3.21/3.01                               |
| EAE    | 59.21/65.95%                         | 62.66/64.18%                            | 5.02/5.44                           | 3.30/3.07                               |
| EMI    | 59.71/66.07%                         | 62.32/64.45%                            | 5.00/5.47                           | 3.26/2.98                               |
| WMI    | 59.64/66.76%                         | 62.14/64.43%                            | 5.12/5.60                           | 3.44/3.12                               |
| YHU    | 59.78/66.46%                         | 62.06/64.45%                            | 5.11/5.64                           | 3.45/3.15                               |
| NWE    | 60.00/67.12%                         | 62.24/64.48%                            | 5.26/5.71                           | 3.57/3.23                               |
| NEE    | 60.55/66.96%                         | 62.00/64.68%                            | 5.27/5.76                           | 3.53/3.19                               |
| SCO    | 60.03/65.79%                         | 62.20/64.12%                            | 5.25/5.69                           | 3.59/3.29                               |
| WAL    | 60.29/66.39%                         | 61.91/64.60%                            | 5.24/5.75                           | 3.58/3.20                               |
| NIR    | 59.34/65.95%                         | 61.65/64.20%                            | 4.97/5.48                           | 3.35/3.00                               |

## Source and limits

[Published 1991 BSA demographic attitudes](https://natcen.ac.uk/sites/default/files/2023-08/bsa35_full-report.pdf), Gender Table 1, printed p63, provide the age/education/income ordering. The code documents the game's proxy mapping and band approximations in `ukSocialAttitudes1991.ts`. One gender-role item is not a comprehensive social index, and non-disagreement includes neutral/unknown answers. Income tiers approximate the source groups; nominal modern pound thresholds are excluded. Other social input dimensions retain the existing values. No respondent records, fitted regional offsets or party vote labels are used to manufacture social variation.

Northern Ireland retains its separate regional census, receives no economic vote-margin offset, and is not claimed to have been calibrated to GB respondents. [NISA's separate 1991 attitudes](https://www.ark.ac.uk/sol/surveys/gen_social_att/nisa/1991/website/Political_Attitudes/) are a distinct source; this fixture does not infer religion or unionism from ethnicity.

Identical coarse labels can remain valid: the output preserves exact regional means and does not force label diversity. Composition shifts toward older voters or away from graduates now move social lean in the published direction. This bounded fixture establishes derivation and appeal sensitivity, not historical election prediction, multivariate causal estimates, whole-world turnover or long-run balance. The existing economic-context cache/granular distinction predates this change and is not retuned here. Existing worlds are not rewritten by changing seeds.
