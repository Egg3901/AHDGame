# Issue #742 catch-up growth balance report

Run on 2026-08-23 against isolated MongoDB databases on port 27018. No
production database was read or written.

## Design under test

- Cross-country GDP per capita uses the 1953 canonical era denomination.
- Only countries with an active `countryGameStates` status set the frontier.
- Infrastructure, transport, housing, and energy budgets form productive
  capital alongside paid corporate growth investment under one shared 5% of
  GDP cap.
- State-heavy economies can use a planned-development gate based on plan
  execution, workforce skill, transport efficiency, productive public
  investment, and trade.
- The convergence bonus remains capped, shrinks with the income gap, and is
  zero at the frontier. There is no negative US modifier.

## Matched full-economy smoke

The old and new engines started from the same turn-13 database clone and ran 12
turns with the 1953 preset, plants market mode, full labor mode, command economy,
and active US, UK, USSR, and DDR countries. Political and random-event phases
were frozen, but corporations, markets, budgets, inflation, forex, commodities,
and ledgers ran normally.

| Country | Potential old | Potential new | Change | Capital change vs old | Growth change |
| ------- | ------------: | ------------: | -----: | --------------------: | ------------: |
| US      |         2.33% |         2.29% |  -0.03 |                +806.0 |         +0.07 |
| UK      |         4.83% |         4.87% |  +0.04 |                 +42.1 |         -3.45 |
| USSR    |         3.41% |         3.86% |  +0.45 |              +7,668.9 |         +0.15 |
| DDR     |         4.03% |         4.27% |  +0.24 |                +374.5 |         -0.01 |

Capital is in each country's stored local-currency millions. The US potential
delta is simulation noise from labor and sector inputs, not a convergence
penalty: the US is the frontier and its convergence term is exactly zero in both
engines. The direct mechanism increases US capital too.

End commodity prices differed by 0.024 price units on average across all 28
commodities, with a maximum absolute difference of 0.28. This is small relative
to the much larger price drift already present in the market model. Inflation
remained finite in every player country.

The short-run GDP growth readout is volatile because the bounded output gap
closes independently of potential growth. The durable comparison is potential
growth and capital formation, which move in the intended direction for all three
catch-up countries.

## Six-year fixed-policy macro horizon

The matched control and proposal each ran 288 turns, from turn 13 through turn 301. These runs retain GDP, labor, fiscal, debt, inflation, command-economy,
forex, and commodity-price phases while holding politics and corporate strategy
fixed. Both completed with zero turn warnings.

GDP is converted to anchor-currency millions with the canonical 1953 era
normalizer. Changes compare the proposal's turn-301 level with the control's
turn-301 level.

| Country | Control GDP | Proposal GDP | GDP change | GDP/person change | Capital change | Potential change |
| ------- | ----------: | -----------: | ---------: | ----------------: | -------------: | ---------------: |
| US      |     455,155 |      453,868 |     -0.28% |            +0.12% |         +0.78% |         -0.04 pp |
| UK      |      48,774 |       48,894 |     +0.25% |            +0.45% |         +1.19% |         -0.05 pp |
| USSR    |     133,668 |      136,155 |     +1.86% |            +1.97% |         +4.14% |         +0.28 pp |
| DDR     |      13,388 |       13,528 |     +1.05% |            +1.09% |         +4.08% |         +0.12 pp |

The level comparison shows a real buff for all three catch-up countries. USSR
gets the largest gain, DDR gets a clear second-tier gain, and the UK gets a
smaller but still positive gain from recognizing transport spending as
productive capital. The UK's six-year GDP CAGR rises from 2.77% to 2.82%.

The US result is not a transfer to the other countries. Its convergence term is
zero at the frontier, while its capital stock is 0.78% higher and GDP per person
is 0.12% higher than the control. Total GDP is 0.28% lower because population is
0.40% lower after six years of endogenous demographic feedback. There is no
negative US modifier or shared growth pool.

| Country | Control inflation | Proposal inflation | Control debt/GDP | Proposal debt/GDP | Control unemployment | Proposal unemployment |
| ------- | ----------------: | -----------------: | ---------------: | ----------------: | -------------------: | --------------------: |
| US      |             2.35% |              2.40% |           64.91% |            65.02% |                1.95% |                 1.92% |
| UK      |             1.65% |              1.97% |          161.77% |           161.49% |                8.29% |                 8.31% |
| USSR    |             1.00% |              1.00% |            1.44% |             1.42% |                7.81% |                 8.25% |
| DDR     |             0.50% |              0.50% |            5.06% |             5.03% |                7.17% |                 7.39% |

Inflation and debt remain finite and close to control. USSR and DDR finish with
slightly higher unemployment, but their output, output per person, capital, and
potential growth all improve. That is a visible tradeoff to monitor, not a
macro-stability failure.

Across all 28 commodities, the mean turn-301 price/base ratio is 4.8181 in the
control and 4.8176 in the proposal. The largest relative price differences are
pharmaceuticals at +1.58% and construction services at -1.55%; every other
commodity is within 0.87% of control. The catch-up mechanics therefore do not
materially worsen the existing commodity-price drift.

## Assessment

Pass. The change creates a non-zero-sum catch-up path, materially strengthens
USSR and DDR, gives the UK a smaller positive level and per-capita gain, and
does not impose a direct cost on the US. The next balance pass should watch UK
effect size and late-horizon unemployment in USSR and DDR rather than increasing
the convergence cap immediately.
