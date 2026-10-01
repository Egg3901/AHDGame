# First Russian Council preference qualification

Run `npx tsx scripts/sim/1991-russian-council-fixture.ts` from the repository.
This controlled fixture never connects to a database and is not a full-world or
historical turnout calibration.

The run passes 768 scenarios with 12 sequential increments each: 64 preference
vectors, four frozen register sizes (0, 1, 1,000 and 1,000,000) and three approval
levels (0%, 50%, 100%). All scenarios use six individual nominees and matched
first-choice weights. The existing appeal formula and nominee approval determine
optional second choices. There is no party-only second-choice shortcut.

Across these scenarios, 192,192,000 valid ballots produce 207,612,970 nominee
marks, including 15,420,970 second marks. There are 384 elected outcomes and 384
required repeats. Low-count scenarios intentionally allow integer rounding and
insufficient turnout. No scenario exceeds its frozen register or two marks per
valid voter. A nominee never receives both mandates.

Assertions also verify nomination input-order independence, monotonic cumulative
participation, distinct choices within each ballot and no second marks for zero
approval alternatives. The unit suite separately exercises against-all ballots,
withdrawn nominee mark preservation and rejected registration changes. Database
persistence and full-world runtime effects need separate qualification.
