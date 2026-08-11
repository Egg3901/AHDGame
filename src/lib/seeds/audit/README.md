# AHD Seed-Readiness Audit

A reusable, **dynamic** audit that validates every reset seed before an era goes
live. It loops the full country × era matrix — adding an era or a reference file
is auto-discovered, so there are no per-state hand-keyed assertions to maintain.

## Quick start

```bash
# Soft mode — calibration deviations report as warnings, structural defects fail
npx vitest run src/lib/seeds/audit/seedReadiness.test.ts --reporter=verbose

# Hard mode — every calibration tolerance must also pass
CALIBRATION_HARD=1 npx vitest run src/lib/seeds/audit/seedReadiness.test.ts
```

The `--reporter=verbose` run prints two console tables worth reading: the
**reconstruction summary** (per era: sign agreement, mean margin error, rank
correlation) and the **artifact completeness matrix**.

## Core principle: reconstruction, not enumeration

Leans are **not** hard-set region by region, and the audit does not check them
against a hand-curated list of "these states must be blue." Instead:

> The demographic seed, on its own, should reconstruct the **approximate** result
> of the real election nearest the era — the same election that seeds initial
> party Org. The election is the oracle.

A region's lean is a **starting point**, not an endpoint. AR being moderate-right
in 1991, WV being pre-realignment left in 2019 — these are correct seeds that the
game's org/campaign/crisis systems move over time. The audit therefore checks
_direction and approximate magnitude against the real result_, not pinpoint
values, and it confirms the seed leaves room for movement (see [3]).

## What it checks

Each block loops `ALL_COUNTRIES × ALL_ERAS` and skips cells with no data.

### [1] Baseline reconstruction _(soft)_

For every country × era with a curated by-region election table
(`src/lib/data/*ElectionResults.ts`, registered in
`calibration/electionBaselines.ts`), it projects each derived `display` lean back
to a margin (`margin ≈ −lean × 10`) and scores it against the real result:

- **Sign agreement** — fraction of _decisive_ regions (real margin > 2 pts) whose
  derived lean lands on the correct side. Coin-flip states are excluded so a
  D+0.3-vs-R+0.3 disagreement in a tossup isn't punished.
- **Mean abs margin error** — average |projected − real| in points.
- **Rank correlation** — Spearman ρ of derived vs real lean ordering.

Pass bars: sign ≥ 0.85, error ≤ 14 pts, ρ ≥ 0.7. Missing regions are a data
defect and fail regardless of mode.

### [2] Scale & accuracy _(soft)_

Spread floor (per-country, not US-forced) and center tolerance for every cell.
Qualitative sign anchors (`expectLeft`/`expectRight`/`ordering` from
`calibration/targets.ts`) are used **only** where there is no quantitative
baseline — for the US, reconstruction supersedes them.

### [3] Org ↔ lean coupling _(coupling soft, lockouts hard)_

From the same election that anchors the era, the favored party must out-organize
the other in every decisive state, **and** both parties must keep baseline
organizing capacity (> 0) so no region's lean is locked. A zeroed-out party is a
structural failure.

### [4] Completeness matrix _(LIVE eras hard, wip eras reported)_

Per era, presence of: census, election baseline, calibration target, states
bundle, state metrics, sector weights, base policies, registration lanes,
historical seats, era-correct national budget. Eras in `LIVE_ERAS` must have
every cell — a missing artifact is a release blocker. Other eras print a `wip`
warning listing what's missing.

### [5] Anachronism invariants _(hard)_

A declarative `ANACHRONISMS` table of era-bound metric rules (e.g. 1991:
`broadbandAccess === 0`, `lifeExpectancy ≤ 78`) applied to **every** state — no
`.slice()` sampling. Add a row to extend; the loop discovers it.

### [6] Structural invariants _(hard)_

US House districts sum to 435 per era; LIVE-era US federal budget carries the
right fiscal year; every census era's race/education/wealth/age dimensions sum to
100 per region.

## Soft vs hard

- **Soft (default):** calibration tolerances ([1], [2], [3] coupling) only warn.
  Lets you run the first audit and read the full deviation report without a wall
  of red. `CALIBRATION_HARD=1` promotes them to failures (CI gate).
- **Hard (always):** facts, not tolerances — missing data, party lockouts,
  anachronisms, broken structural invariants. These fail in either mode.

## Current status

`LIVE_ERAS = { 1991, 2019 }` — both fully wired and complete. `1979/1999/2007/
2023` have census + election baseline + calibration target but still need their
states/metrics/sector/policy/lane/budget stacks (the completeness matrix lists
the gaps). Reconstruction is strong for 1999/2007/2019/2023 (sign 90–98%, ρ
0.88–0.95); 1979 and 1991 are weaker (the 1980 Reagan/Anderson and 1988 maps are
the priority calibration targets).

## Adding a new era

1. Add the census bundle `src/lib/seeds/stateCensusData<era>.ts` (wire it into
   `calibration/deriveRegionLeans.ts`).
2. Add the real election table `src/lib/data/<year>ElectionResults.ts` and
   register it in **both** `calibration/electionBaselines.ts` (`ELECTION_BASELINES`)
   and `reference/statePartyOrg.ts` (`PRESET_MARGINS`) — keep them in sync.
3. Add the calibration target in `calibration/targets.ts`.
4. Add the reference stack: `states<era>.ts`, `stateMetrics<era>.ts`,
   `sectorSeedWeights<era>.ts`, `basePolicies<era>.ts`,
   `registration/registrationLanes<era>.ts`, seats in `historicalSeats.ts`,
   budgets in `reference/budgets.ts`.
5. Add any era-specific rows to `ANACHRONISMS` and the metric/states/census
   import maps in the test.
6. Run the audit; fix until the completeness matrix is full and reconstruction
   clears the bars.
7. Promote the era into `LIVE_ERAS` — the completeness matrix now enforces it.

## Design principles

1. **Reusable** — one file validates every era, country, and preset.
2. **Dynamic** — new eras/files are discovered via array iteration and
   `import.meta.glob`, not enumerated by hand.
3. **Reconstruction over enumeration** — the real election is the oracle; leans
   are scored, not pinned.
4. **Actionable** — every failure names the country/era/region and the gap.
5. **Graceful** — cells without data degrade to the next-best check and are
   surfaced as completeness gaps rather than silently skipped.

## Maintenance

Run before every preset deployment, after any lean/demographic recalibration,
after adding a country or era, and as a periodic health check.
