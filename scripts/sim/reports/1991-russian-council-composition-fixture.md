# Regional Russian Council composition qualification

Run `npx tsx scripts/sim/1991-russian-council-composition-fixture.ts`.
This portable fixture uses synthetic matched regional support. It does not run a
whole world or establish economic conservation or historical electoral outcomes.

The 64-case sweep supplies six existing financial groups and distinct executive
and legislative people for each of the 89 authored subjects. There are 56 viable
settlements and eight deferred cases with no eligible regional nominee. The
viable cases produce 9,968 head mandates and 9,912 delegate mandates, with no
financial profile created or mutated. Input profile order does not affect choices.

Each viable case preserves an existing party defection on replay. Regional
renewal replaces 177 expired NPC authorities and preserves one human authority
awaiting an explicit choice. Delegation preserves the remaining regional term
and never assigns a delegate for the expired human authority. The bounded
four-year regional term and Duma constituency support proxy are simulation
assumptions, not representations of every historical regional charter or election.

The separate permanent Mongo integration test exercises actual proposal,
enactment, regional journal and physical Council writes. It verifies that a late
final-receipt failure rolls back all 18 collections, concurrent claims produce
one handover, and committed replay does not change documents. Duma offices,
executive offices, original election roots and private accounts are preserved.
Synthetic signed bills isolate this handover test from the statutory vote tests.

Measured phase commands and projected read bytes are:

| Step               | Commands | Bytes read |
| ------------------ | -------: | ---------: |
| No law             |        2 |         17 |
| Heads handover     |       34 |    226,987 |
| Heads steady turn  |       19 |    300,200 |
| Regional renewal   |       27 |    420,319 |
| Delegates handover |       32 |    312,928 |
| Concurrent replay  |       19 |    300,200 |

All measured steps remain within the 100-command phase budget. Regional and NPC
inputs are shared inside the settlement transaction. Steady turns do not reload
full certified ballot data. These measurements are a controlled fixture, not
production throughput or complete-world acceptance evidence.

Historical formation chronology comes from the [Federation Council's official
history](https://www.council.gov.ru/en/structure/council/) and the [State Duma's
institutional history](https://duma.gov.ru/en/news/28785/). Dates open separate
formation laws; current office custody changes only after enactment and a viable
regional handover.
