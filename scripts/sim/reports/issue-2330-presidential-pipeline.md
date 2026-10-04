# Issue 2330: presidential pipeline qualification

The controlled referendum comparison remains in
`issue-2330-economic-referendum-inflation-target.json`. It isolates the formula
with fixed synthetic votes. The presidential integration fixture now also calls
the actual `accumulatePresidentVoteTurn` orchestration twice for each of the
eight canonical presets: 1953, 1979, 1991, 1999, 2007, 2019, 2023, and 2027.
Storage reads are mocked with the same two player candidates and US electorate;
this does not represent historical election outcomes or an autonomous world.

For every authored US era target, inflation at target gives a zero referendum
shift; target plus two percentage points gives a -0.2 percentage-point shift.
The 1953 US lookup has no authored target and retains the legacy neutral band.
Its two cases use the band's midpoint and midpoint plus two, explicitly testing
that fallback rather than supplying a current policy target as historical data.

All sixteen pipeline calls produce positive cast votes. Above-band inflation
reduces incumbent votes, and the pipeline's national-environment factor ledger
records the negative incumbent effect and conserves the referendum's float vote
pool. Subsequent lean bonuses and integer rounding operate after that shift, so
the comparison does not assert identical final integer totals.

Run `npx vitest run src/lib/electionEngine/economicReferendum.test.ts
src/lib/presidentialElectionEngine.registration.test.ts --maxWorkers=2`.
The two suites pass all 38 tests, including the eight paired pipeline cases.
Combined repository qualification and merged delivery remain required.
