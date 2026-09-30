# Full positive-use market coverage for issue 991

## Measurement repair

The entry-trial gate needs the share of positive-use US state-sector cells
without an active firm. Historical reports retain only 250 empty-cell examples.
The country coverage totals do not distinguish positive demand from measured
zero or missing demand, so those examples cannot supply the missing numerator
or denominator.

The snapshot now adds `demandCoverage` to each state and country coverage row:

- `observedCells`: cells with at least one finite calibrated demand observation
  for their output commodities.
- `positiveUseCells`: observed cells with positive gross local use, including
  both active and empty cells.
- `emptyPositiveUseCells`: positive-use cells without an active firm.

The trial ratio is `emptyPositiveUseCells / positiveUseCells`; a zero denominator
is unavailable. Report `observedCells / cells` alongside it so missing demand
cannot silently improve the result. Resident use remains distinct from the
demand available to a local producer after inbound delivery. Mothballed firms
do not make a cell active.

Counts are accumulated over the full existing cell universe before sampling.
No prices, capacity, demand calibration, entry eligibility or economic flows
change. Historical rows omit the optional field and remain unavailable;
normalization does not fabricate a zero or reconstruct history from examples.
No data migration or index is required.

## Verification

The focused market-formation suite passes 19 tests. New cases cover counts
entirely outside the example sample, active and mothballed firms, measured zero,
absent and nonfinite demand, and compatibility with old persisted rows.

A pure-builder comparison uses identical synthetic inputs: 300 state-sector
cells in one country, with positive use only in the final 50 cells. All 250
retained examples have zero demand. The complete counters correctly retain
300 observed cells, 50 positive-use cells and 50 empty positive-use cells.
Removing only the added counters yields an exact deep match to the baseline.

| Measurement                    |  Before |   After |
| ------------------------------ | ------: | ------: |
| Snapshot BSON bytes            | 230,261 | 257,050 |
| Additional database commands   |       0 |       0 |
| Additional database read bytes |       0 |       0 |

The extra persisted size is 26,789 bytes for 300 state rows and one country row,
or 89 bytes per coverage row. This fixture measures serialization overhead,
not release-world performance. The existing example cap remains 250.

The source reference for the unchanged baseline builder is
`8c7b4188f4e89fc08395a642cb1306a11a90aa20`. The implementation revision is the
commit containing this report. This is a telemetry prerequisite; issue 991's
controlled trial, guardrails and supplier-failure acceptance remain pending.
