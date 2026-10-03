# Romanian electoral snapshot continuity

Qualified runtime source: `50e849839196e38ea917343fdbf35aa58af8f065`.

A historical campaign can retain its cast votes only in the latest cumulative snapshot. The earlier electoral decision read only current totals, so an otherwise open primary could incorrectly be treated as untouched. Adoption now checks both ledgers and preserves the full parliamentary cohort when either contains a nonzero vote.

The read loads only the latest snapshot. Bound enactment checks project the two chamber vote totals, preserving the complete voter maps in their original documents.

Nine actual isolated-database journeys pass, including the new snapshot-only campaign, ordinary cast totals, untouched and closed primaries, actual bicameral approval and rejection, NPC/human introduction, authority-write rollback, concurrent handover, duplicate-player refusal and unchanged financial accounts. Another 71 focused route, decision, handover, changelog and turn-projection checks pass. Scoped TypeScript, lint and formatting pass.

| Adoption journey         | Commands | Request bytes | Response bytes |
| ------------------------ | -------: | ------------: | -------------: |
| Untouched cohort         |       13 |          7817 |           6482 |
| Existing current totals  |       12 |          5521 |           6281 |
| Snapshot-only cast votes |       12 |          5521 |           6311 |
| Closed primary           |       12 |          5521 |           6270 |
| Rejected draft           |        2 |           763 |            553 |

The untouched response previously measured 44398 bytes. The current 6482-byte measurement includes the projected latest snapshots needed for continuity. Concurrent handover remains 34 commands/19180 request bytes/19789 response bytes and its replay 1/398/324.

This repair preserves the existing weighted Romanian handover. Native individual certification, national compensation and minority mandates remain separate criteria in the country audit.
