# Hungarian modern constituency vacancy qualification

Issue: #2488. Executed 2026-10-03. This is bounded rules, player filing and transactional custody qualification, not a whole-world simulation.

The authorized modern Assembly's frozen106 district identities now own vacancy ballots. The earlier176-district scheduler cannot reopen after the modern handover. Each departed direct deputy opens one single-seat plurality race, bound to the original certified chamber and remaining term. National-list awards are untouched. Equal or zero votes leave the seat vacant for a later fresh ballot. Withdrawal retains cast marks without seating an unavailable winner or awarding their seat to the runner-up.

The normal perpetual scheduler, primary processing, vote accumulation, filing API and general-election dispatcher consume this ballot. A player can occupy one mandate and reserve only one race in the vacancy cohort. Re-entry retains the original candidate, money, throttles and votes. Pending-relocation, foreign-region, incumbent, superseded and closed-filing cases retain their eligibility guards. Vote growth is capped at the frozen registered electorate, including votes already cast for withdrawn candidates.

Opening, final seating, owner counters, candidate/tally finalization, player career and notices use transactions with the shared chamber authority. Concurrent openings return one identical cohort. Concurrent counts settle once; replay is inert. The dispatcher defers a restricted selection that omits any of the cohort's polls. Original term expiry and a newer chamber cancel obsolete ballots. Original NPC financial owners supply virtual candidates, without cloned actors or changed private balances.

The UI identifies the frozen constituency and remaining term. Each ballot records its actual in-game calendar year, honoring founding-period offsets rather than retaining the original general-election year.

## Qualification

The existing focused rules, tally, normal resolver, primary, API, registration, read-projection and reset qualification comprises233 passing cases and one pre-existing skipped case across10 suites. The current Mongo suite additionally exercises authorized199-mandate handover, modern national-list replacement, player election, retained withdrawal, term expiry, superseding chamber and two simultaneous constituency vacancies. The two-vacancy case refuses partial selection before resolving both as one custody settlement. Injected final-journal failure rolls back seating and owner counters. All9 current modern Mongo cases and16 UI/title/navigation cases pass. The earlier18 native Assembly Mongo cases remain qualified separately.

Scoped TypeScript, changed-source lint and formatting and architecture audit are recorded separately. The final exact-head hosted gate remains required before merge.

## Read cost and boundaries

A paired concurrent one-vacancy opening measured44 Mongo commands,25,933 command bytes and458,473 reply bytes. A paired resolution measured44 commands,21,718 command bytes and105,995 reply bytes. These include both requests and possible contention retries; they are not per-turn or per-call fixed costs. Reads of NPC and character financial owners are projected and batched. No phase budget was raised.

The game's six campaign regions still project the106 frozen synthetic districts. This work does not claim a full historical2014 constituency boundary map or full statutory deadline simulation. Joint and linked lists, minority nominations, distinct constituency/list filing, legacy duplicate candidature reconciliation, wider country transitions and fresh source-pinned world horizons remain parent acceptance criteria. Integration into Track1 alone does not establish development or production delivery.
