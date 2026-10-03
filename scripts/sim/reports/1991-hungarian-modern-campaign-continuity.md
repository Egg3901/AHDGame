# Hungarian modern campaign continuity qualification

Issue: #2488. Runtime source: `74efb6f173fd8e4392d135fd765fe6d5f80fe6da`. Executed 2026-10-03. Bounded normal-primary, vote-ledger and isolated-Mongo custody qualification.

Modern regional campaigns previously used the generic one-winner party primary, omitted the frozen register from vote accumulation and excluded withdrawn nominees from certification even when their cast votes remained. The native primary now advances all filed regional actors for the bounded individual slate. Binding preserves an existing earlier frozen register or calculates the new regional register from eligible population and registration pools, then carries the native ballot marker through primary tally initialization. Vacancy ballots are explicitly excluded from either general-cohort binder.

The tally uses the frozen electorate, retaining withdrawn cast votes and limiting only new growth. Older native receipts without a register use the existing registration fallback while preserving inherited overruns and allowing no additional votes above that live register. Older unmarked native tallies resolve their binding with one projected read before withdrawal cleanup. Foreign or unbound races retain their existing cleanup.

Certification freezes every filed actor with their cast marks; final settlement independently checks their current eligibility. An unavailable direct winner leaves a vacancy; an unavailable national nominee uses the original slate. Pending native modern pages advance the correct slate and suppress unrelated regional Hare seat projections.

All95 focused tally, primary, portable campaign and primary-eligibility cases pass, with one pre-existing skipped case. The12-case isolated-Mongo suite now invokes the real primary dispatcher before the modern whole-country count and concurrent handover, and withdraws a player before certification while preserving their999,999 cast votes. No unavailable player is seated or notified of a win. Existing list replacements, constituency elections, original vacancies, term expiry, superseding chamber and rollback cases remain qualified. Scope-specific TypeScript, lint, formatting and architecture audit are recorded separately; final hosted checks remain required before integration.

A single actual six-region binding measured10 Mongo commands,6,917 command bytes and3,453 reply bytes. Registration pools are read once for the whole cohort, with no per-candidate queries or raised phase budget.

This retains the bounded six-region support projection. Separate list campaigns, joint and linked slates, minority nominations, legacy duplicate candidature reconciliation and fresh whole-world horizons remain parent criteria. Track1 integration alone does not establish development or production delivery.
