# Naval repair simulation, turn 528

Constants under test: ceilings 100/90/80, REPAIR_LOT_SHARE 0.5, wornKnee 50.
Existing calibration, unchanged: inPort 12, onStation 5, minSupply 35.

## 1. Turns for a wreck to return to service

Before this branch: NEVER, at any supply, in any basing. That is the whole bug.

| basing  | resting | supply | turns to ceiling | ceiling |
| ------- | ------- | ------ | ---------------- | ------- |
| home    | yes     | 100%   | 9                | 100%    |
| home    | no      | 100%   | 16               | 80%     |
| home    | yes     | 75%    | 14               | 100%    |
| home    | no      | 75%    | 26               | 80%     |
| home    | yes     | 50%    | 37               | 100%    |
| home    | no      | 50%    | 70               | 80%     |
| home    | yes     | 40%    | 109              | 100%    |
| home    | no      | 40%    | 208              | 80%     |
| home    | yes     | 30%    | never            | 100%    |
| home    | no      | 30%    | never            | 80%     |
| allied  | yes     | 100%   | 8                | 90%     |
| allied  | no      | 100%   | 16               | 80%     |
| allied  | yes     | 75%    | 13               | 90%     |
| allied  | no      | 75%    | 26               | 80%     |
| allied  | yes     | 50%    | 33               | 90%     |
| allied  | no      | 50%    | 70               | 80%     |
| allied  | yes     | 40%    | 98               | 90%     |
| allied  | no      | 40%    | 208              | 80%     |
| allied  | yes     | 30%    | never            | 90%     |
| allied  | no      | 30%    | never            | 80%     |
| neutral | yes     | 100%   | 7                | 80%     |
| neutral | no      | 100%   | 16               | 80%     |
| neutral | yes     | 75%    | 11               | 80%     |
| neutral | no      | 75%    | 26               | 80%     |
| neutral | yes     | 50%    | 29               | 80%     |
| neutral | no      | 50%    | 70               | 80%     |
| neutral | yes     | 40%    | 87               | 80%     |
| neutral | no      | 40%    | 208              | 80%     |
| neutral | yes     | 30%    | never            | 80%     |
| neutral | no      | 30%    | never            | 80%     |

Supply scaling: at 35% or below, scale is 0 and nothing mends. This is why the withdraw rule matters: a front is exactly where supply is lowest, and a hull nudged off zero then sent back would plateau. Formations below 35% condition that the engine stationed are pulled home until seaworthy.

## 2. Arsenal pressure: does repair starve refit?

Lots each country's damaged naval and air formations would ask for, against what is in store. Repair draws first, so 'refit left' is what the existing sweep still sees.

| country | store (naval/air) | hulls below ceiling | repair lots wanted | refit lots wanted | refit left |
| ------- | ----------------- | ------------------- | ------------------ | ----------------- | ---------- |
| UK      | 0/4               | 7                   | 60                 | 36                | 0          |
| US      | 0/25              | 7                   | 28                 | 11                | 0          |
| RU      | 27/18             | 8                   | 21                 | 0                 | 24         |
| TR      | 0/0               | 3                   | 9                  | 30                | 0          |
| PL      | 0/0               | 2                   | 5                  | 45                | 0          |
| RO      | 0/0               | 1                   | 2                  | 23                | 0          |
| BG      | 0/0               | 1                   | 2                  | 21                | 0          |
| SE      | 0/0               | 1                   | 2                  | 61                | 0          |
| DD      | 4/35              | 1                   | 2                  | 0                 | 37         |
| JP      | 0/0               | 0                   | 0                  | 116               | 0          |
| IE      | 0/0               | 0                   | 0                  | 56                | 0          |
| BR      | 0/0               | 0                   | 0                  | 32                | 0          |
| CN      | 0/0               | 0                   | 0                  | 54                | 0          |
| HU      | 0/0               | 0                   | 0                  | 20                | 0          |
| YU      | 0/0               | 0                   | 0                  | 26                | 0          |
| BLR     | 0/0               | 0                   | 0                  | 11                | 0          |
| CS      | 0/0               | 0                   | 0                  | 33                | 0          |
| UKR     | 0/0               | 0                   | 0                  | 24                | 0          |
| BAL     | 0/0               | 0                   | 0                  | 11                | 0          |
| FR      | 0/0               | 0                   | 0                  | 102               | 0          |

Only formations below the 80% station ceiling draw materiel at all: above it free repair reaches unaided, and a lot buys one point of condition there against a hundred at the bottom. Without that gate the sweep drains the store on scratches and starves refit, which runs immediately after it.

## 3. Blockade pressure by hull condition

Share of nominal lane pressure one hull applies. 'Linear only' is the behaviour before this branch, where `baseCv` already scaled by `integrityMult` and nothing else did.

| condition | linear only (before) | with knee (after) | change |
| --------- | -------------------- | ----------------- | ------ |
| 100%      | 100.0%               | 100.0%            | 0%     |
| 80%       | 80.0%                | 80.0%             | 0%     |
| 60%       | 60.0%                | 60.0%             | 0%     |
| 50%       | 50.0%                | 50.0%             | 0%     |
| 40%       | 40.0%                | 25.6%             | -36%   |
| 25%       | 25.0%                | 6.3%              | -75%   |
| 20%       | 20.0%                | 3.2%              | -84%   |
| 10%       | 10.0%                | 0.4%              | -96%   |

The knee is at 50%, below the 80% ceiling free repair reaches on station, so a fleet mending where it stands always climbs clear of the penalty band. If the knee were ever raised above that ceiling a blockade would become unrecoverable without going home, which is the trap this design exists to remove.

## 4. How often the station ceiling binds

- naval and air formations in the world: 163
- damaged at all: 31
- at zero, unrecoverable before this branch: 11
- below the worn knee, blockading badly: 31
- in the 80-100% band where only a home port or materiel helps: 0

Live supply readings matter here: 15 formations currently sit at or below 35% supply, where free repair does nothing at all. Every one of those is either in a yard it should leave or holding water it cannot be sustained in.

## Recommendation on each new constant

### Free repair ceilings, home 100 / allied 90 / station 80 — KEEP

Recovery from a wreck is 9 turns in a home port at full supply and 16 on station, which
is a real rotation decision rather than a formality: a commander gives up nine turns of
lane pressure to get a hull back, or accepts 80% and keeps it on station.

The tail is the part worth watching. At 40% supply a home-port repair takes 109 turns, and
at 30% it never completes at all, because `REPAIR.minSupply` is 35 and the scale hits zero
there. That is the existing calibration, not a new constant, and it is survivable only
because the withdraw rule pulls a badly damaged formation back to home water, where supply
is highest. Without that rule these rows would be the plateau the config's docblock warns
about. **If any future change weakens the withdraw rule, these numbers become the argument
against it.**

### REPAIR_LOT_SHARE 0.5 — KEEP, and revisit first

This is the constant with the least evidence behind it, and the one to change if anything
here proves wrong.

What the live world shows: the UK's seven damaged hulls want 60 lots and the UK holds 0
naval lots, so paid repair does nothing for them until they award a naval contract. RU
wants 21 and holds 27, so a well-stocked navy clears its entire damaged fleet from store
in a single turn. That looks cheap, but the honest caveat is that a stock is an
accumulation and this sim does not model per-turn contract throughput, which is what
actually paces the tier. Nothing here justifies moving it yet.

The gate matters more than the price. Only formations below the 80% station ceiling draw
materiel at all: above it a lot buys one point of condition against a hundred at the
bottom, and repair runs before refit, so an ungated sweep would drain the store on
scratches and starve the refit pipeline entirely.

### BLOCKADE.wornKnee 50 — KEEP

The knee costs a hull at 40% condition 36% of its remaining lane pressure, at 25% it costs
75%, and at 10% it costs 96%. That is the intended shape: a ship held together by
damage-control parties cannot sustain patient blockade work.

One live observation that should be recorded rather than smoothed over: **all 31 damaged
formations in the world are below 50% condition, and not one sits between 50% and 100%.**
Damage in this game is bimodal, because engagements take large bites and nothing has ever
healed the small ones. So on today's data the knee is not a gradient at all, it is an
always-on penalty for every damaged formation. That will change once repair exists and
hulls start occupying the middle of the range, which is exactly when the knee begins doing
the job it was designed for. Re-measure this distribution a few dozen turns after release
before concluding anything about the value 50.

The knee sits below the 80% station ceiling, so a fleet mending where it stands always
climbs clear of the penalty band. That relationship is a constraint, not a coincidence:
raising the knee above the ceiling would make a blockade unrecoverable without going home.
`blockade.test.ts` asserts the ordering so a future edit cannot break it silently.

## Observed consequence, recorded rather than smoothed over

`WITHDRAW_INTEGRITY` is 35 and `BLOCKADE.wornKnee` is 50, so a formation the engine
withdraws stops being withdrawn while it is still inside the worn-hull penalty band.

Traced against the live world: the UK's seven hulls sit at zero in `mea` on 10% supply.
On the first turn they withdraw to `weu`, supply jumps to 100, and they mend 12 a turn.
After three turns they pass 35, `stationOf` returns them to the front, and there they sit
on 10% supply where `supplyScale` is zero. They stop at roughly 36% condition: seaworthy,
but permanently inside the knee, applying about 19% of nominal lane pressure.

That is a coherent outcome rather than a bug. The engine restores basic seaworthiness for
free and no further; getting a fleet back to full is a decision a commander makes, by
ordering it into port or by spending materiel. Both routes are now stated on the command
page and in the war room, so the player is told why and what to do.

It is recorded here because it is the sort of thing that reads as a bug six months from
now. Raising `WITHDRAW_INTEGRITY` to sit above the knee would make automatic recovery
complete, but it also holds ships out of the fighting for longer and changes the mission
doctrine that constant already governs. That is a separate balance question and should not
be settled as a side effect of this branch.
