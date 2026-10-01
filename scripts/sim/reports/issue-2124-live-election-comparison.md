# Fixed-window live and 1991-profile election comparison

## Observation and source

Collector source `a3bf8dcbbd117b0e06f8d3d0b7105956cf97a223`. Live observed at `2026-09-30T04:33:28.059Z`, current turn 1243/year 1977, preset `1953-default`. The bounded live selection is scheduled election end turns 764 through 1243 inclusive (480 turns); actual retained selected ends are 768 through 1228.

The 1991-profile sandbox is the retained `audit-allflags-1991-r3` run, raw turns 1 through 480 inclusive (480 turns), year 2000. All its retained resolved ends fall between 60 and 480, so the standing report has exactly this selection. Run and source provenance are in the standing report. It is historical evidence from source `a6cca21537b4119ad9ae358fe9999b738f0089f2`, not qualification of the eventual release SHA.

MCP analytics was attempted first but unavailable to the session token and did not offer election turnover aggregation. The authorized local fallback queried projected records through the same read-only collector. The main live read used 11 find, seven getMore and one aggregate command, including the historical-cutoff reconciliation. The isolated zero-key check used three find and three getMore commands. No live or sandbox database was written; no names or person identifiers are published.

## Reconcile the tracker reference

The earlier live reference is reproduced at scheduled end turn 1008 (1953 through 1972): 541 resolved US House races, 535 usable outcomes across 50 states, and 485 adjacent usable state-cycle transitions. Both definitions produce 78 unique top-party flips, 276 uniquely led comparisons and 182 tied-top outcome cycles.

- Retaining zero-seat party keys reproduces the tracker **307** vector changes.
- Removing zero-seat entries, as the canonical standing reporter does, produces **305** real positive-seat-vector changes, matching the earlier public #2124 audit.
- The two extra changes are appearance/disappearance of a zero-seat key. They transfer no seats. The tracker reference should state 305 canonical changes and explain the old 307 representation count.
- The latest whole retained live history is larger: 641 resolved races, 635 usable outcomes and 585 transitions, with 367 canonical vector changes, 93 unique flips in 332 uniquely led comparisons, and 217 tied-top cycles. These are history-wide reference counts, not the fixed-window comparison below.

The old audit skipped unusable races before building adjacent comparisons. The standing reporter instead preserves missing outcomes, rejects pairs with changed capacity, and separates complete versus partial outcome coverage. Its denominators therefore differ honestly from the legacy reference.

## Equivalent fixed-window definition

Both columns below use the same collector, 480 scheduled-turn selections, country/family grouping, state/seat/class scopes, positive-seat vectors and unchanged-capacity requirement. The selected eras differ intentionally: live is an old-world reference, not a balance target for 1991. Rates are per 100 comparable pairs and include their exact fractions. Missing evidence remains unknown.

| Family                | Live seat changes / 100 | 1991 seat changes / 100 | Live unique flips / 100 | 1991 unique flips / 100 |
| --------------------- | ----------------------: | ----------------------: | ----------------------: | ----------------------: |
| AT:nationalrat        |             50.0 (5/10) |              60.0 (3/5) |               0.0 (0/9) |               0.0 (0/2) |
| BR:chamber            |                 unknown |              20.0 (1/5) |                 unknown |              20.0 (1/5) |
| BR:senate             |               0.0 (0/5) |             100.0 (5/5) |               0.0 (0/5) |                 unknown |
| CN:governor           |               0.0 (0/7) |               0.0 (0/7) |               0.0 (0/7) |               0.0 (0/7) |
| CN:npcDelegate        |               0.0 (0/7) |               0.0 (0/7) |               0.0 (0/7) |               0.0 (0/7) |
| CN:peoplesCongress    |               0.0 (0/7) |               0.0 (0/7) |               0.0 (0/7) |               0.0 (0/7) |
| FI:eduskunta          |              66.7 (4/6) |              83.3 (5/6) |              20.0 (1/5) |              20.0 (1/5) |
| FR:assembleeNationale |              87.5 (7/8) |              87.5 (7/8) |               0.0 (0/8) |              50.0 (3/6) |
| FR:senat              |                 unknown |                 unknown |                 unknown |                 unknown |
| GR:vouli              |             75.0 (9/12) |              66.7 (4/6) |               0.0 (0/8) |              20.0 (1/5) |
| IE:dail               |              50.0 (4/8) |            68.8 (11/16) |               0.0 (0/7) |              0.0 (0/12) |
| IE:governor           |               0.0 (0/8) |               0.0 (0/8) |               0.0 (0/8) |               0.0 (0/8) |
| IE:localCouncil       |              62.5 (5/8) |                 unknown |              12.5 (1/8) |                 unknown |
| IE:uachtaran          |                 unknown |                 unknown |                 unknown |                 unknown |
| IT:cameraDeputati     |              87.5 (7/8) |              62.5 (5/8) |               0.0 (0/6) |              14.3 (1/7) |
| IT:senato             |              50.0 (4/8) |              50.0 (4/8) |               0.0 (0/5) |               0.0 (0/7) |
| JP:governor           |               0.0 (0/8) |               0.0 (0/8) |               0.0 (0/8) |               0.0 (0/8) |
| JP:regionalCouncil    |           100.0 (16/16) |             100.0 (8/8) |             56.2 (9/16) |              12.5 (1/8) |
| JP:sangiin            |             42.9 (6/14) |              75.0 (6/8) |              12.5 (1/8) |              25.0 (2/8) |
| JP:shugiin            |            68.8 (11/16) |              50.0 (4/8) |              44.4 (4/9) |               0.0 (0/7) |
| NG:governor           |              33.3 (2/6) |              50.0 (3/6) |              33.3 (2/6) |              50.0 (3/6) |
| NG:house              |            50.0 (12/24) |            83.3 (15/18) |             21.1 (4/19) |             26.7 (4/15) |
| NG:regionalCouncil    |             100.0 (6/6) |             100.0 (6/6) |              16.7 (1/6) |              16.7 (1/6) |
| NG:senate             |              33.3 (2/6) |              33.3 (2/6) |               0.0 (0/3) |               0.0 (0/5) |
| SE:riksdag            |            68.8 (11/16) |              75.0 (6/8) |               0.0 (0/6) |               0.0 (0/6) |
| TR:milletMeclisi      |             100.0 (7/7) |              87.5 (7/8) |              42.9 (3/7) |               0.0 (0/5) |
| UK:commons            |           100.0 (12/12) |            91.7 (11/12) |             66.7 (8/12) |             33.3 (4/12) |
| UK:governor           |             100.0 (4/4) |              25.0 (1/4) |             100.0 (4/4) |              25.0 (1/4) |
| UK:regionalCouncil    |           100.0 (12/12) |             100.0 (5/5) |             36.4 (4/11) |              20.0 (1/5) |
| US:governor           |              8.0 (4/50) |            22.0 (11/50) |              8.0 (4/50) |            22.0 (11/50) |
| US:house              |           55.0 (94/171) |           28.5 (49/172) |            20.2 (20/99) |           10.4 (14/134) |
| US:senate             |            15.2 (10/66) |            22.4 (15/67) |            15.2 (10/66) |            22.4 (15/67) |
| US:stateSenate        |            79.2 (38/48) |            80.0 (40/50) |             17.5 (7/40) |             13.3 (6/45) |

## House differences and limits

Each fixed window contains 250 resolved House races and 200 potential adjacent comparisons. The live window has 171 comparable pairs (27 capacity changes and two missing-outcome exclusions); the 1991 window has 172 (21 capacity changes and seven missing-outcome exclusions).

- Live has 94/171 seat-vector changes (55.0%) and 20/99 unique-control flips (20.2%). The 1991 profile has 49/172 changes (28.5%) and 14/134 flips (10.4%). Neither is frozen.
- Tied-top outcome cycles are 91/248 usable live outcomes (36.7%) versus 42/244 (17.2%). A tied cycle is counted once, not once per adjacent pair.
- Representative-set replacement is 85/152 known-identity live comparisons (55.9%) versus 31/172 (18.0%). Missing live identity evidence excludes 19 comparisons from that denominator.
- The live House field mix is 200 NPP-only, 29 mixed and 21 unknown; the 1991 field is 244 NPP-only and six unknown. The game weights NPP candidates differently when a player is present. This observed actor difference is a concrete configuration distinction, not proof of a single causal explanation.
- Recorded autonomy is v4 live versus v5 in the retained 1991 run. Both currently record redistricting enabled, but historical executed resolver metadata is absent. Current flags do not reconstruct which path executed each older race.
- Different eras, party competition, actor mix, autonomy version and old runtime source confound a causal balance comparison. No new election defect is demonstrated by these observational rate differences alone. The separate deterministic matrix tests the actual threshold and constrained-regime behavior.
- Zero recorded flips in a family with little or no comparable history is not proof of a frozen engine. Exact release/profile qualification and global simulation gates remain separate.

## Reproduce the bounded selection

Use `collectElectionTurnoverReport(db, { scheduledEndTurnFrom: 764, scheduledEndTurnThrough: 1243 })` against an authorized read-only live connection, and the same collector against the retained 1991 sandbox with `{ scheduledEndTurnFrom: 1, scheduledEndTurnThrough: 480 }`. The committed collector projects only needed election fields; output is aggregate-only. The standalone sandbox command in the standing report produces the same retained 1991 selection because all resolved ends are in that interval.

The adjacent JSON contains the complete live per-family metrics, actor mixes, unknowns, exclusions, scheduled ranges and historical-cutoff reconciliation. The standing and AMS JSON files preserve their corresponding full reports.
