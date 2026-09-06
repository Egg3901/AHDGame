# Defence appropriation atomic settlement report

This synthetic report documents the accounting invariant exercised by the
defence settlement tests. It contains no world or player data.

| Concurrent attempts | Appropriation change | Overdraft charge | Treasury change | Successful commits |
| ---: | ---: | ---: | ---: | ---: |
| 2 | -15 local units each | 5 local units each | -5 local units | 1 |

Both attempts read the same opening budget. The guarded write compares the
turn marker, appropriation balance, and treasury balance. One write succeeds;
the other receives a compare-and-swap miss and must retry. The resulting
treasury change is one overdraft charge, not two. Existing appropriation
accrual is included in the appropriation delta and is never charged to the
treasury again.
