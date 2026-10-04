# Russian Council repeat preservation qualification

Run `npx tsx scripts/sim/1991-russian-council-repeat-fixture.ts` from the repository.
The fixture uses portable rules without database access or world-engine execution.

All 64 deterministic scenarios pass. Together they repeat 626 failed subject
polls with new ballot identities and fresh registers. Successful subjects retain
their original ballot objects and the predecessor remains unchanged. Each completed
generation has 177 mandates and one lawful second-seat vacancy, with no failed
poll remaining. That vacancy never causes a successful first mandate to be reopened.

The focused unit suite also verifies distinct identities, exact failed-subject
coverage, unchanged region bindings, repeated failures and player mandate limits.
A historical losing nomination does not bar a later nomination. A player cannot
contest multiple polls within the same repeat generation or acquire two subject
mandates across accumulated results.

These results qualify repeat planning and counting only. Runtime opening,
admission, filing, persistence, dispatch and seating require separate integration
and transaction verification. They do not establish historical turnout calibration.
