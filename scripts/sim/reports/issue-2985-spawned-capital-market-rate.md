# Issue 2985: spawned corporation starting capital at the market rate

Runtime source: `4ccf63f1ec37069dc35345a65dd0718510b75a7f`.

`spawnNppCorporation` sized a new corporation's default starting treasury by
dividing the era-scaled anchor amount (2M anchor times the era's nominal scale) by
the GDP normalization factor. That factor is the anchor value of one unit of a
country's stored seed currency. It matches the market rate only where authored GDP
is denominated at the era's market rate, so elsewhere the grant landed at a
different anchor value than intended. In the 1991 cash diagnostic in #968, a
Nigerian corporation founded on turn 4 received 3,125,000,000 NGN, about 290M
anchor at the world's rate, against an intended 2M.

## Change

- The default converts the era-scaled anchor amount with the live exchange rate for
  the corporation's currency, the same rate its cash is valued at in balance
  snapshots and in the starting grant's ledger witness. Without a live rate it falls
  back to the era's seeded rate.
- An explicit custom capital stays literal.
- Corporations already spawned in running worlds keep their treasuries. This
  changes new spawns only.

## Verified outcomes

`spawnNppCorporation.marketRate.test.ts` drives the actual spawn function.

- 15 mispriced countries across all five presets, with at least one overvalued and
  one starved country per preset (1953 NG, JP, IT; 1979 NG, UK, JP; 1991 NG, YU, PL,
  BG, RO; 2019 UK, RU; 2027 SCO, RU), each receive the intended anchor value at the
  seeded rate. The old conversion gave them between 0.002 and 2604 times the
  intended value.
- A live NGN rate of 10.75, off the seeded 9.9, is the rate used.
- 2019 US, where both factors agree, still receives exactly 2,000,000.
- An explicit capital stays literal.

With the old formula restored and the test kept, 16 of 18 cases fail. The agreeing
country and the explicit capital pass, as they should.

The focused spawn, founding, banking, extraction, bootstrap, seed reference and
starting grant suites (13 files) pass: 206 passed, 4 native opt-in cases skipped, 0
failed. Scoped lint, formatting, semantic diagnostics for all 3 changed TypeScript
files and the blocking architecture checks pass.

The currency test now imports the spawn module at collection time. Its first case
had timed out on a cold import under host load.

## Cost and scope

A default spawn adds one exchange-rate read, plus one game-state read only when no
live rate exists. An explicit capital adds none.

This changes only the size of future default grants. No running world was
rebalanced, and this does not clear #968 or the global cash gate in #2159. No
production database was reset or repaired.
