# Native 1991 campaign timer custody

## Defect and delivered behavior

The admin timer route previously recognized Bulgarian native custody but applied
its generic calendar to bound Hungarian and Russian polls. High-cycle repeats or
vacancy polls could be renumbered or deleted, their completed rounds reactivated,
and their native filing and ballot deadlines replaced.

A portable custody rule recognizes country-matched Hungarian Assembly bindings
(original, runoff, older vacancy, modern and modern vacancy) and Russian
presidential, Duma and Council bindings. All four admin repair stages use this
rule. Bound polls keep status, cycle, round, receipts, turn bounds, candidates and
tallies. Active and upcoming polls receive repaired derived dates only, including
future filing windows and overdue ballots. Completed and resolved polls retain
the entire document. Missing or invalid native bounds are skipped without
inventing deadlines. Bulgarian custody retains its existing guard and validation.

This applies to the 1991 preset. Unmarked legacy races, unrelated country/type
markers and other presets retain the existing calendar path. No schema change,
new database read, turn-phase query or performance budget increase is introduced.

## Qualification

148 distinct focused cases passed across four suites:

- 60 admin calendar and custody cases, covering ten native campaign families,
  completed-round non-reactivation, malformed bounds and other preset behavior.
- 71 canonical cycle regressions.
- 16 Bulgarian clock and campaign factory regressions.
- One real admin POST journey on isolated transactional Mongo, containing 66
  polls: six existing Bulgarian cases plus ten Hungarian/Russian families with
  active, future upcoming, completed, resolved, malformed and overdue cases.
  Every campaign remains present. Immutable campaign fields, all candidate
  documents and all tally documents remain equal to their before snapshots;
  repaired dates equal the original native turn offsets.

Scoped strict TypeScript and changed-file lint passed. The architecture audit
reported zero blockers and 66 existing warnings.

The Mongo fixture is isolated test data, not a fresh complete-world bootstrap or
1991-to-2027 acceptance run. Broader institution and horizon acceptance remains
tracked separately in #2488 and #2159. Related native receipt work: #2545.
