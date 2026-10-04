# Original-currency successor GDP normalization

Issue #3034 item 4 identifies GDP comparisons using old configuration factors
for 1991 successor countries. The authored regional bundles store millions of
PLZ, HUF, CSK, ROL, BGL and YUD. Their sum agrees with the original-currency
national seed anchors, but their config normalization factors still inherit
older rates. Poland's aggregate is valued about 380 times too high.

The six era definitions now use the reciprocal of their already-authored
`INITIAL_RATES_1991` opening parity. This is a seed-denomination correction,
not a live exchange-rate revaluation. It does not alter the raw regional GDP,
market quotes, player balances or contracts in the shared accounting unit.
The normalizer uses the initial stored unit basis when valuing local GDP.

| Country        | Before, accounting billions | Corrected, accounting billions |
| -------------- | --------------------------: | -----------------------------: |
| Poland         |                  36,194.256 |                         95.248 |
| Hungary        |                      80.780 |                         34.867 |
| Czechoslovakia |                     161.041 |                         44.807 |
| Romania        |                     484.858 |                         63.513 |
| Bulgaria       |                      69.379 |                          2.456 |
| Yugoslavia     |                      63.128 |                         84.598 |

These are the stored nominal local-currency output figures valued at the
opening game parity, not claims about published annual USD GDP. Transition-era
inflation and annual-average exchange rates can produce different historical
USD outturns. The distinction matters especially for Romania and Bulgaria.
Yugoslavia's source total is the latest pre-start observation, not a 1991
outturn. Source GDP observations and opening FX provenance remain in
`successorGdp1991.ts` and `constants/currencies.ts`.

Thirty-six cases pass across four suites. Qualification records the six
failures on the unchanged baseline before
correcting the config. Regression cases compare actual authored regional
bundles with national seed totals, then exercise the public GDP normalizer and
original seed currency resolver. Existing 1953 and other-era regressions guard
against denomination changes leaking between presets. No production data or
world simulation is used by these catalog checks.

Soviet and Nigerian denomination/seed questions remain separate acceptance,
as do the other seed-audit items, full-world qualification and release.
