# Standing targeted ads

Reproduce with `npx tsx scripts/sim/standing-targeted-ads.ts`. The adjacent JSON records synthetic results through the production electorate and both vote allocators.

A three-turn regional flight bought at turn 10 raises a symmetric candidate from 50% to 52.03% at turn 12. The same exposure raises a later race's share to 51.65% at turn 24 and decays to 50.10% at turn 84. These results agree for original and version-1 races, and for primary and general allocation. Turnout totals remain unchanged. Another region receives zero benefit.

Exposure belongs to the character, so no active race or candidacy is required at purchase. Each race reads the same exposure and the existing 15% bonus cap. The action does not copy or multiply exposure when a player enters another race, change turnout rules versions, or rewrite counted ballots. This synthetic example establishes composition and timing, not an estimate of live election outcomes.

Two copies of a 22,975-document synthetic world both completed turn 3. Primary snapshots remained at 29 database round trips and 1.3 MiB returned. Whole-turn totals were 6,248 before and 6,251 after, with 50.9 MiB returned in each run. Stochastic world activity makes the whole-turn difference descriptive; local wall time is not a performance claim. Both runs hit the same existing party-action generation budget warning.
