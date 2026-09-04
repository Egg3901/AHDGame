# Intelligence sabotage balance report — GATE NOT SATISFIED

**Date:** 2026-08-31
**Branch:** `feature/national-intelligence` (phase 3)
**Issue:** https://github.com/Egg3901/AHDGame/issues/1246
**Harness:** `scripts/sim/intelligenceSabotage2026-08-31.ts`
**Constants under test:** `SABOTAGE_SUPPLY_POINTS`, `SABOTAGE_READINESS_POINTS`,
`SABOTAGE_UNIT_COUNT` in `src/lib/intelligence/config.ts`

## Verdict

**The measurement could not be made, and no number in this report should be used to
justify a magnitude.** The live world currently has nothing to measure against.

Because CLAUDE.md requires a simulation report before a balance change merges, and this
report cannot supply one, **the sabotage effects ship gated OFF** behind
`intelligenceMilitarySabotageEnabled` (default false). The code is written, reviewed and
tested; it simply does nothing until someone turns it on, which should follow a real
measurement rather than precede it.

## Why the measurement is impossible right now

Verified against `MONGODB_URI_LIVE` on 2026-08-31, read-only:

| Fact                                        | Value                                                    |
| ------------------------------------------- | -------------------------------------------------------- |
| Conflicts in the world                      | 1 (`war_us_dd_415`)                                      |
| Its status                                  | `resolved`, control 100 (side A took the front outright) |
| `conflictAssignments` across all formations | **0**                                                    |
| Formations                                  | 369, **all** with `theaterId: "reserve"`                 |
| Formations carrying an `assignedGeneralId`  | 79, all on the eastern coalition                         |
| Commissioned generals                       | 38                                                       |

A formation only engages when its `assignedGeneralId` names a general holding a
`ConflictAssignment` at the theatre. With no postings anywhere, every arm resolves with
zero casualties on both sides and an identical 5.8% attacker win rate — a broken harness
reading, not a finding.

Posting each side's real generals to the theatre **in memory** (no writes to live) fixes
the eastern side, which fields 159 formations under 7 generals. The western side still
fields **0 generals**, because no western formation carries an `assignedGeneralId` at all.
Manufacturing western command would mean inventing general identities and their stats,
and those stats are direct inputs to the battle maths. That is fabricating the thing being
measured, so the harness stops there rather than print a number.

The full-world alternative is also closed: `MONGODB_URI` is an Atlas free tier that
[cannot run `runWorld`](../../..) at all (512 MB storage and a 500-collection cap both
blow out well before a 60-turn run completes).

## What the harness will do once a front exists

It is written and working, and needs only a live engaged front:

- **Supply arm.** Cuts side B's seeded supply base by `SABOTAGE_SUPPLY_POINTS`, derives
  the live supply through `occupation.derivedSupplies` exactly as the game does, and
  re-fights the same formations. Supply is a `buildCoalitionSide` input, so this is the
  arm that can move who wins.
- **Readiness arm.** Cuts the readiest `SABOTAGE_UNIT_COUNT` formations by
  `SABOTAGE_READINESS_POINTS` and re-fights.

Run it with `npx tsx scripts/sim/intelligenceSabotage2026-08-31.ts`, optionally
`SIM_THEATER=<conflictId> SIM_TRIALS=800`.

## One finding that did not need the simulation

**Readiness cannot move win probability, and it was important to establish that before
shipping a "degrade readiness" operation.**

`readiness` never enters `battleSides.ts` and is not an input to `basePower`. It appears
in the battle engine only inside `unitOutcomes` (`battle.ts:869-877`), where it sets a
`depletion` term that increases how much further readiness drops in the fight:

```
depletion = clamp(1 - readiness / readinessBaselineOf(posture))
drop      = READINESS_DROP_BASE * ... * (1 + READINESS_TEMPO_K * depletion)
```

So degrading readiness makes a formation **wear out faster in the battles it fights**. It
does not make it lose them. That is a real effect and worth having, but it is not the
effect the phase-3 design assumed, and a report claiming a win-rate swing from readiness
sabotage would have been measuring noise.

Supply, by contrast, is a genuine combat input and is where the balance risk actually sits.

## What is needed to close this gate

1. A live conflict with formations posted to it on both sides, or
2. An agreed fixture front committed to the repo so the arms are reproducible without
   depending on whatever the live world happens to be doing.

Until then `intelligenceMilitarySabotageEnabled` stays off.
