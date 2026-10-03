# Bulgarian Assembly clocks and timer custody

Qualified runtime source: `a8795fbeab9f8686e55d7a9e221ac861021bbe2a`. Qualification uses isolated Mongo replica-set fixtures and the production scheduler, vote authorization, national count, seating and admin timer adapters. This is component qualification; fresh integrated bootstrap and whole-world horizon acceptance remain separate.

## Political and calendar behavior

The founding400-seat Grand Assembly retains its original four-year term. Its next regular ballot anchors to June1994, including the offset from the founding phase. The amended1971 Constitution provides a four-year mandate and allows early self-dissolution; the historical1994 early election is not an automatic annual timer. [Amended Constitution, Articles6 and69](https://www.ciela.net/svobodna-zona-darjaven-vestnik/document/516706304/issue/349/konstitutsiya-na-narodna-republika-balgariya-ot-1971-g).

The currently supported enacted constitutional transition opens the first ordinary240-seat election from its actual authorization. Its bounded campaign uses four filing turns and two general-ballot turns, within the three-month transitional election limit. This represents the historical draft's dissolution route. An explicit alternate continuation draft and subsequent separate dissolution decision remain work in the wider repair program. [1991 Constitution, transitional sections1 and7](https://www.constcourt.bg/en/legal-info-92).

A complete untouched first-round cohort changes capacity, count flags and turn deadlines in the authorization transaction. Recorded votes, renewed ballots and certified receipts retain their original ballot rules and clocks. When a founding campaign finishes later, ordinary scheduling waits for that complete national count. The actual first ordinary ballot anchors later four-year terms. A late scheduler opens a six-turn campaign instead of silently skipping a term. Unmarked ordinary legacy schedules retain their existing canonical clock.

A settled founding cycle does not respawn while other countries remain in founding. No region starts another cohort while any latest-cycle region awaits national certification. Other presets keep their existing scheduler.

Native founding office dates align once the founding calendar unpins, using a projected receipt read and a required transaction. Only offices explicitly bound to the original native receipt change. Legacy offices and financial owners remain intact. A count completed after the original mandate expired receives a bounded fresh four-year term; its receipt retains that anchor. Authorized ordinary results can seat before the old November1991 gate, while unmarked legacy results keep the historical safeguard.

Admin recalibration changes derived wall-clock dates only for valid native Bulgarian campaigns. It retains cycle numbers, status, turn bounds, future filing windows, candidacies and tallies, and does not reactivate completed national counts or prune native cycles. Malformed native clocks remain unchanged for their owning resolver to investigate.

## Qualification

139 distinct targeted cases passed:

| Coverage                                                | Cases |
| ------------------------------------------------------- | ----: |
| Bulgarian portable clock and factory                    |    15 |
| Existing canonical-cycle regression suite               |    71 |
| Admin timer contracts                                   |    25 |
| Actual Mongo scheduler and400-office alignment          |     5 |
| Actual Mongo ordinary national count and seating        |     4 |
| Actual Mongo native founding and renewed count journeys |     7 |
| Actual Mongo constitutional consent journeys            |    11 |
| Actual Mongo admin POST custody journey                 |     1 |

The ordinary scheduler creates one coherent five-region240-seat campaign and then retains its four-year anchor. The Grand cohort retains400 seats and the June1994 calendar date. Missing national certification and ongoing global founding open no additional campaigns. Tests exercise a late receipt-write validation failure after office updates and verify full rollback before replay; legacy offices and financial balances are unchanged. The normal ordinary dispatcher seats an authorized early result, preserves a player's one-seat limit and tolerates replay.

The admin POST journey covers cycle-zero founding, renewed campaigns, high native cycle numbers, a future filing window, completed and resolved polls, shifted ordinary clocks and malformed custody. Candidate and tally documents remain byte-equivalent.

## Mongo work

| Journey                                       | Commands | Request bytes | Reply bytes |
| --------------------------------------------- | -------: | ------------: | ----------: |
| Five-region first ordinary spawn              |       12 |         7,125 |       5,155 |
| One-time400-office Grand clock alignment      |        5 |         2,285 |       1,160 |
| Native founding count and seating regression  |       43 |       664,195 |     671,384 |
| Five-region renewed-cohort opening regression |       14 |       180,816 |     169,614 |

Grand clock alignment uses one projected journal read on steady unadopted turns, with no per-office reads. It does no work during the founding phase or after ordinary authority exists. The first alignment adds a bounded transaction that updates all native office dates and its receipt together. It creates no character, financial owner or account. Constitutional rebinding retains batch writes; competing consent attempts stayed below the existing40-command qualification bound, and retained ballots below18.

Scoped TypeScript and ESLint passed. The architecture audit reports zero blocking findings and66 existing warnings. Formatting and staged diff checks passed. Full repository verification and build remain the exact-head hosted merge gates.

## Remaining program acceptance

Constituent continuation and separate dissolution, statutory vacancies, later political early elections, other country repairs, fresh integrated bootstrap, whole-world horizon acceptance and Track1 promotion are still active program work. This component does not close the parent repair issues.
