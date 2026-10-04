# Hungarian constituency vacancy qualification

Issue: #2488. Runtime source: `bf1ed2460f29f1b254fb4a46300d405ee08d329a`, based on mixed Assembly merge `792abc18e201230ded6f3865bf7bff80363e7a0f`. Executed 2026-10-03. This is bounded election qualification, not a whole-world simulation.

The original [1989 election act](https://njt.jog.gov.hu/jogszabaly/1989-34-00-00.0) supplies the constituency ballot rules. Replacements fill physical vacant constituencies within the existing term without reallocating the certified territorial or national compensation mandates. The simulation uses a four-turn first campaign, two-turn second campaign and two-turn failed-generation cooldown. A regular election due within six turns suppresses a new replacement campaign; a perpetual regular campaign farther away does not.

## Integrated qualification

The final combined targeted run passes 129 cases across 14 suites, including 13 isolated writable-replica-set Mongo journeys, 48 filing API cases, three selector UI cases, portable rules, the ordinary calendar and fat-read projection guards. Scoped integration TypeScript passes and the architecture audit has zero blocking findings. Tests use synthetic actors and disposable loopback databases, removed after each case.

The persisted vacancy journeys qualify actual first-round refill, genuine second campaigning, invalid-ballot generations, original term expiry, concurrent resolution, final-journal rollback, superseded-parent cancellation, null-holder office archival, player filing through the production writer, normal turn dispatch, one-time win notice and one-time career history. Filing rejects occupied constituencies, a second physical mandate and a superseded parent. Original national counts, held list seats, private balances and the sitting term remain unchanged.

The measured NPC runoff fixture uses 17 Mongo commands to open and 20 to seat, including archival of the replaced empty office. Human career-history writes are batched; there is no per-person database query or financial profile creation. These figures describe fixture operations, not a full turn.

## Custody and limitations

Journal generation locks serialize openings. Parent receipt, active ballot IDs, round, district set and frozen register are checked again before counting and seating. Missing or unavailable winning people remain explicit unfilled mandates. Cancelled or expired elections retain their history. The ordinary receipt remains immutable apart from its by-election generation counter.

County campaign support and within-county registered electorate use the existing bounded geographic projection. This qualification does not claim exact historic candidate geography, a full autonomous world horizon or completion of the broader parent. Joint or linked lists, later electoral reform decisions, legacy duplicate candidature migration and list-vacancy replacements remain separate unfinished acceptance criteria.
