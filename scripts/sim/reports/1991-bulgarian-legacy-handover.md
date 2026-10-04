# Bulgarian legacy Assembly handover

Qualified runtime source: `aeacb3bd0cc5b3682bd2d23c64100ae954a3d601`.

The legacy handover previously wrote regional capacity, government formation and its completion marker separately, and recognized only the first ordinary election cycle. It now requires one transaction and a complete latest resolved cohort under the canonical game calendar. It reads at most six resolved ballots for Bulgaria's five regions. A later partial cohort cannot borrow results from an earlier one.

Regional mandate custody must fit the ordinary 240-seat capacity, including legitimate vacancies. A player may hold at most one mandate. Dissolved countries cannot reopen their Assembly. Existing elected officials, NPC financial owners and their accounts remain unchanged by the metadata handover.

Ten focused checks pass, including an actual isolated replica-set journey. That journey resolves the old weighted election, injects failures after partial regional writes and at the final marker, proves both transactions roll back, settles a later cycle while older ballots coexist, and proves concurrent attempts produce exactly one success. All original official and NPC documents remain identical. Completed replay performs one projected read. Eleven shared actual constitutional-consent and native ordinary-seating journeys and 46 changelog and turn-projection checks also pass.

| Journey                    | Commands | Request bytes | Response bytes |
| -------------------------- | -------: | ------------: | -------------: |
| Concurrent settlement pair |       21 |          9378 |           6863 |
| Completed replay           |        1 |           378 |            285 |

Scoped TypeScript, lint, formatting and the architecture audit qualify the component. The audit has zero blockers and 66 existing warnings. The durable transaction CI job includes this replica-set test.

This component repairs legacy metadata settlement. Full native counting for the founding 1990 election and collective quarter-member constitutional initiative remain separate acceptance criteria.
