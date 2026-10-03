# Bulgarian renewed nomination qualification

Qualified runtime source: pending final source pin.

The founding count already recognized failed single-candidate constituencies, but every second-round filing was closed. [Article73(3) of the original April1990 law](https://www.ciela.net/svobodna-zona-darjaven-vestnik/document/2132293633/issue/1081/zakon-za-izbirane-na-veliko-narodno-sabranie) permits new nominations when the sole candidate is not elected. Such constituencies now expose one turn of filing in the existing two-turn renewed campaign. This is bounded campaign timing. Ordinary top-two runoffs retain their qualified candidates.

Admission reads the transactional national receipt, its unresolved constituencies and frozen first ballots. An advertised eligibility flag cannot authorize a nomination on its own. Players select an eligible local constituency, retain one identity per election, and reserve one party slot atomically. Withdrawal and re-entry preserve the admitted person. New nominees join only the direct tier; original first ballots, party lists and list allocations remain unchanged.

One eligible existing NPC owner per registered local party supplies distinct direct-only people for uncovered reopened constituencies. Selection excludes banned parties, retired owners, incompatible offices and owners already filed in a live campaign. No NPC profile, bank account or second copy of campaign money is created. A no-vote renewal opens another real poll, retains the new people and waits for actual renewed ballots before seating.

Qualification passes79 distinct checks across six suites:15 portable ballot/majority/admission checks,55 filing-route checks, two rendered constituency-selector checks and seven actual replica-set Mongo journeys. The new Mongo journey verifies bounded NPC slates, concurrent player admission, withdrawal/re-entry, deadline rejection, failed late journal-write rollback, a no-vote repeat, final400-seat handover and one player seat. Bank accounts remain identical and the NPC collection stays at ten owners. Original first ballots and list quotas remain identical.

| Isolated operation                 | Commands | Request bytes | Response bytes |
| ---------------------------------- | -------: | ------------: | -------------: |
| Normal founding count and handover |       43 |        664194 |         671382 |
| Reopened five-region cohort        |       14 |        180816 |         169614 |

Scoped TypeScript passes. Touched lint has no errors and one existing client-effect warning. Architecture reports zero blockers and66 existing warnings. These measurements cover isolated operations, not a whole turn. Ordinary campaigns retain the two-read, transaction-free founding fast path.

Migration is additive. Existing first ballots, resolved histories and closed historical runoff windows remain intact. Newly opened qualifying windows carry eligible constituency ids; the receipt remains authoritative. No new collection is required. Statutory vacancy continuation, constituent dissolution or continuation, later early-election decisions and fresh integrated whole-world qualification remain active in the parent repair program.
