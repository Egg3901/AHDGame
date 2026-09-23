# Issue 2078: read-only sandbox audit replay

The transfer detectors from `fae3ba97c` were replayed against six-turn audit
windows in three isolated local sandbox databases. The replay read
`actionAuditLog` with the same projection as `runAuditAnomalyScan` and called all
six pure detectors. It did not write flags or advance a turn.

| Preset | Turns | Rows read | Rows flagged | Circular | Fan-in/out |
| ------ | ----: | --------: | -----------: | -------: | ---------: |
| 1953   | 53-58 |    44,958 |            0 |        0 |          0 |
| 1991   | 59-64 |    44,841 |            0 |        0 |          0 |
| 2019   | 59-64 |    47,313 |            0 |        0 |          0 |

All other detectors also returned zero findings in these windows. The earlier
issue reproduction recorded 62.82%, 65.78%, and 65.02% flagged shares in its
then-current snapshots. The sandbox databases have since advanced, so their
historical turn ranges now contain more audit rows than those snapshots. These
counts show the corrected detector behavior on real sandbox rows, but are not
matched before-and-after samples.

The replayed money rows were system-originated. For example, the 2019 window
contains 15,429 `bond.coupon`, 12,094 `corp.supply_agreement`, 4,250
`party.dues_received`, and 3,098 `corp.tax_paid` rows, all with
`actor.kind: system`. The zero findings show these routine actions no longer
fill the review queue. They do not establish precision on actor-controlled
transfers. Focused fixtures cover a distinct later return event, mirrored
settlement, and routine hub activity.

Single-run detector timings on these 45,000-47,000-row windows ranged from
23 to 581 ms for circular flow and 20 to 91 ms for fan-in/out. These timings
exclude Mongo reads, mapping, and writes and were taken while other jobs were
running on the host. A fresh corrected six-turn simulation remains necessary
for end-to-end scan duration and actor-level precision evidence before closing
the issue.
