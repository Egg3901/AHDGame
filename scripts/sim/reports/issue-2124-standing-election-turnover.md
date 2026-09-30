# Standing election turnover qualification for #2124

## Source and scope

Report source: `b2c073054f15abbdffac120c9c91829a81314433`. Read-only retained world: run `4f55908e-1495-4a05-895c-369e285fae2d`, seed `audit-allflags-1991-r3`, preset `1991-default`, executed source `a6cca21537b4119ad9ae358fe9999b738f0089f2`, raw turn 480 / year 2000.

This is a historical reporting qualification. It does not replace the deterministic resolver matrix or claim reset qualification on the eventual release SHA. No simulation was started, no election replayed, and no source database written. The query used 12 Mongo read commands. The adjacent JSON contains aggregate results without candidate names or identities.

Current recorded flags are `redistrictingEnabled=true`, `nppAutonomyEnabled=true`, `nppAutonomyLevel=v5`. The original bootstrap feature manifest is absent. These flags are explicitly current context; the report does not infer historical resolver execution from them.

## Method

- Group by country and election family; compare adjacent resolved races only within the same state, seat and chamber-class scope. Missing outcomes, ambiguous duplicate cycles and changed seat capacity are excluded with counts. Different outcome coverage scopes never compare.
- A party seat-vector change differs from a unique leading-party flip. Ties count separately and are excluded from the unique-control denominator.
- An actual character or NPP may hold aggregate `seatsHeld` voting weight. Identity metrics count that actor once. Replacement means the winner identity set changed; full incumbent hold means the same set; any incumbent retained measures intersection. No anonymous individuals are manufactured for each seat.
- Player/NPP rates count cycles won by each actor kind among cycles with known winner kinds; both can win a mixed multi-seat race. Resolver shares use all resolved cycles, including unknown. Each metric preserves count, its own comparable denominator and rate per 100.
- New resolved holder receipts include actual direct and list representatives. Legacy AMS without those receipts is labeled direct tier only. Other old candidate allocations retain unknown historical composite coverage. Current offices never reconstruct past holders.
- Election turnover covers all resolved elections retained at query time. The checkpoint chart cutoff does not recreate a historical database snapshot. Presidential elections remain in the existing separate report.

## Retained-world results

1,153 resolved elections across 38 country/family groups yield 626 possible comparisons and 595 comparable pairs. There are 263 party seat-vector changes, 75 control flips among 510 uniquely led comparisons, and 184 representative-set changes. All 1,153 historical resolver paths remain unknown. This is missing instrumentation, not evidence that one resolver handled every family.

| Family                | Resolved | Comparable | Seat changes / 100 | Control flips / 100 unique | Representative changes / 100 | Full holds / 100 |
| --------------------- | -------: | ---------: | -----------------: | -------------------------: | ---------------------------: | ---------------: |
| AT:nationalrat        |       10 |          5 |         60.0 (3/5) |                  0.0 (0/2) |                    0.0 (0/5) |      100.0 (5/5) |
| BR:chamber            |       10 |          5 |         20.0 (1/5) |                 20.0 (1/5) |                   40.0 (2/5) |       60.0 (3/5) |
| BR:senate             |       10 |          5 |        100.0 (5/5) |                    unknown |                  100.0 (5/5) |        0.0 (0/5) |
| CN:governor           |       14 |          7 |          0.0 (0/7) |                  0.0 (0/7) |                   14.3 (1/7) |       85.7 (6/7) |
| CN:npcDelegate        |       14 |          7 |          0.0 (0/7) |                  0.0 (0/7) |                   71.4 (5/7) |       28.6 (2/7) |
| CN:peoplesCongress    |       14 |          7 |          0.0 (0/7) |                  0.0 (0/7) |                   42.9 (3/7) |       57.1 (4/7) |
| DE:bundestag          |       32 |         16 |        31.2 (5/16) |                10.0 (1/10) |                  18.8 (3/16) |     81.2 (13/16) |
| DE:landtag            |       29 |         13 |      100.0 (13/13) |                 8.3 (1/12) |                  53.8 (7/13) |      46.2 (6/13) |
| DE:ministerPresident  |       29 |         10 |        30.0 (3/10) |                30.0 (3/10) |                  30.0 (3/10) |      70.0 (7/10) |
| ES:congresoDiputados  |       16 |          8 |         75.0 (6/8) |                  0.0 (0/5) |                    0.0 (0/8) |      100.0 (8/8) |
| ES:senado             |       16 |          8 |         25.0 (2/8) |                  0.0 (0/4) |                    0.0 (0/8) |      100.0 (8/8) |
| FI:eduskunta          |       12 |          6 |         83.3 (5/6) |                 20.0 (1/5) |                    0.0 (0/6) |      100.0 (6/6) |
| FR:assembleeNationale |       16 |          8 |         87.5 (7/8) |                 50.0 (3/6) |                   37.5 (3/8) |       62.5 (5/8) |
| FR:senat              |        8 |          0 |            unknown |                    unknown |                      unknown |          unknown |
| GR:vouli              |       12 |          6 |         66.7 (4/6) |                 20.0 (1/5) |                    0.0 (0/6) |      100.0 (6/6) |
| IE:dail               |       24 |         16 |       68.8 (11/16) |                 0.0 (0/12) |                  43.8 (7/16) |      56.2 (9/16) |
| IE:governor           |       16 |          8 |          0.0 (0/8) |                  0.0 (0/8) |                   25.0 (2/8) |       75.0 (6/8) |
| IE:localCouncil       |        8 |          0 |            unknown |                    unknown |                      unknown |          unknown |
| IE:uachtaran          |        1 |          0 |            unknown |                    unknown |                      unknown |          unknown |
| IT:cameraDeputati     |       16 |          8 |         62.5 (5/8) |                 14.3 (1/7) |                    0.0 (0/8) |      100.0 (8/8) |
| IT:senato             |       16 |          8 |         50.0 (4/8) |                  0.0 (0/7) |                   37.5 (3/8) |       62.5 (5/8) |
| JP:governor           |       16 |          8 |          0.0 (0/8) |                  0.0 (0/8) |                   12.5 (1/8) |       87.5 (7/8) |
| JP:regionalCouncil    |       16 |          8 |        100.0 (8/8) |                 12.5 (1/8) |                   62.5 (5/8) |       37.5 (3/8) |
| JP:sangiin            |       24 |          8 |         75.0 (6/8) |                 25.0 (2/8) |                   87.5 (7/8) |       12.5 (1/8) |
| JP:shugiin            |       16 |          8 |         50.0 (4/8) |                  0.0 (0/7) |                   50.0 (4/8) |       50.0 (4/8) |
| NG:governor           |       12 |          6 |         50.0 (3/6) |                 50.0 (3/6) |                   66.7 (4/6) |       33.3 (2/6) |
| NG:house              |       24 |         18 |       83.3 (15/18) |                26.7 (4/15) |                 83.3 (15/18) |      16.7 (3/18) |
| NG:regionalCouncil    |       12 |          6 |        100.0 (6/6) |                 16.7 (1/6) |                   66.7 (4/6) |       33.3 (2/6) |
| NG:senate             |       12 |          6 |         33.3 (2/6) |                  0.0 (0/5) |                   83.3 (5/6) |       16.7 (1/6) |
| SE:riksdag            |       16 |          8 |         75.0 (6/8) |                  0.0 (0/6) |                   12.5 (1/8) |       87.5 (7/8) |
| TR:milletMeclisi      |       16 |          8 |         87.5 (7/8) |                  0.0 (0/5) |                    0.0 (0/8) |      100.0 (8/8) |
| UK:commons            |       24 |         12 |       91.7 (11/12) |                33.3 (4/12) |                  41.7 (5/12) |      58.3 (7/12) |
| UK:governor           |        8 |          4 |         25.0 (1/4) |                 25.0 (1/4) |                   25.0 (1/4) |       75.0 (3/4) |
| UK:regionalCouncil    |       17 |          5 |        100.0 (5/5) |                 20.0 (1/5) |                   60.0 (3/5) |       40.0 (2/5) |
| US:governor           |      100 |         50 |       22.0 (11/50) |               22.0 (11/50) |                 34.0 (17/50) |     66.0 (33/50) |
| US:house              |      250 |        172 |      28.5 (49/172) |              10.4 (14/134) |                18.0 (31/172) |   82.0 (141/172) |
| US:senate             |      167 |         67 |       22.4 (15/67) |               22.4 (15/67) |                 35.8 (24/67) |     64.2 (43/67) |
| US:stateSenate        |      100 |         50 |       80.0 (40/50) |                13.3 (6/45) |                 26.0 (13/50) |     74.0 (37/50) |

Per-family actor mixes, player/NPP win rates, exclusions, method shares and seat-history coverage are included in the JSON and standing checkpoint output. Missing denominators show `unknown`, never a misleading zero turnover rate.

## Verification

- 10 focused turnover tests cover ties, capacity changes, missing outcomes, duplicate cycles, identity uncertainty, mixed wins, actual resolver receipts and separate AMS list holders.
- 21 existing checkpoint-report tests pass.
- Focused ESLint and Prettier checks pass. Full CI remains the merge gate.

## Reproduce

```sh
SIM_MONGODB_URI="<isolated sandbox URI>" npx tsx --tsconfig tsconfig.json \
  scripts/sim/electionTurnoverReport.ts \
  --db=ahd_sim_audit-allflags-1991-r3 --out=turnover.json
```

The runner accepts only the local isolated sandbox server and an `ahd_sim_` database. `scripts/sim/checkpointReport.ts` now embeds the same collector and renders the family rate table.
