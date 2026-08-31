# Control drift balance report: removing the deep-push halving

Run on 2026-08-30 against the production world at turn 503 (conflict
`war_us_dd_415`) with:

```text
SIM_CAMPAIGNS=120 npx tsx scripts/sim/controlDrift2026-08-30.ts
```

The harness is read only and deterministic. It loads the live conflict and the
140 formations posted to it, builds both coalition sides with the production
`buildCoalitionSide`, and fights every engagement with the production
`resolvePvpBattle`. It opens no write path and does not advance a turn.

## What changed

`OCCUPATION.deepPushMult` (0.5) is gone, and with it the line in
`occupationShift` that halved every advance once the winner's absolute share of
the host reached `deepPushDepth` (0.75). Nothing else in the territorial math
moved: `maxShift` 5, `decisiveMargin` 45, `retreatYield` 0.7, the supply
penalties (`overextensionPenalty` 15, `compressionPenalty` 40) and
`deepPushDepth` itself, which still drives the Winding Down status and the
peace-offer ground threshold, are all as they were.

## Why it was worse than half pace

The halving keyed on the winner's share. Past the three-quarter mark that meant
the attacker's wins moved the line 2.5 points while the defender's wins still
moved it 5. On a front where the two sides win about half the time each, that
is not a slower advance, it is a drift back toward the three-quarter mark that
outruns the advance. The supply drag was already doing the job the halving was
meant to do: on a full-track invasion the attacker reaches the three-quarter
mark at supply 49 and the defender is compressed to 30 there; on this front,
which opened at 50, the attacker ends at 53 and the defender at 40.

## Method

Two arms, same seeds, same formations, same engine. The only difference is the
shift function: the BEFORE arm reproduces the removed halving exactly, the
AFTER arm is `occupationShift` as it now stands. Each campaign walks the front
from the conflict's starting line (50) to the attacker's pole (100 for the
Pact side, which is the side the live front has moved toward). Every step
re-derives both sides' supply from the front's distance from its start and
fights the next engagement at that supply, exactly as `applyOccupation` writes
it. A campaign is abandoned as stalled after 400 offensives.

## Outcome

| Measure                                           | BEFORE (halving) | AFTER (removed) |
| ------------------------------------------------- | ---------------: | --------------: |
| Campaigns reaching the pole within 400 offensives |            1/120 |          92/120 |
| Offensives to the pole, all campaigns, median     |        400 (cap) |             216 |
| Stalled campaigns: attacker share at cap, median  |              64% |             40% |
| Attacker win rate per offensive, median           |              52% |             54% |
| Lowest attacker supply on the way, median         |               51 |              53 |

Over the campaigns that did reach the pole (1 and 92 respectively):

| Measure                                 | BEFORE | AFTER |
| --------------------------------------- | -----: | ----: |
| Offensives to the pole, median          |    108 |   158 |
| Offensives in the first three quarters  |     45 |   106 |
| Offensives in the last quarter          |     63 |    36 |
| Last quarter as a share of the campaign |    58% |   23% |
| Attacker dead per campaign, median      |   583k |  888k |
| Defender dead per campaign, median      |  1.64M | 2.37M |

Raw output:

```text
== BEFORE: deep-push halving in place ==
  campaigns 120, reached the pole 1 (1%), cap 400
  offensives to the pole, all campaigns (stalled = cap)   p25 400.0  median 400.0  p75 400.0
  stalled campaigns: attacker held at the cap   p25 47%  median 64%  p75 74%
  over the 1 campaigns that reached the pole:
    offensives to the pole    p25 108.0  median 108.0  p75 108.0  mean 108.0
    first three quarters      p25 45.0  median 45.0  p75 45.0  mean 45.0
    last quarter              p25 63.0  median 63.0  p75 63.0  mean 63.0
    dead per campaign         attacker median 583,220   defender median 1,640,608
  attacker win rate           median 52%   lowest attacker supply median 51.0

== AFTER: halving removed (this change) ==
  campaigns 120, reached the pole 92 (77%), cap 400
  offensives to the pole, all campaigns (stalled = cap)   p25 100.0  median 216.0  p75 383.0
  stalled campaigns: attacker held at the cap   p25 27%  median 40%  p75 65%
  over the 92 campaigns that reached the pole:
    offensives to the pole    p25 92.0  median 158.0  p75 250.0  mean 172.7
    first three quarters      p25 54.0  median 106.0  p75 184.0  mean 131.0
    last quarter              p25 24.0  median 36.0  p75 54.0  mean 41.7
    dead per campaign         attacker median 887,746   defender median 2,368,029
  attacker win rate           median 54%   lowest attacker supply median 53.0

== Delta (AFTER vs BEFORE) ==
  campaigns reaching the pole                     1/120 -> 92/120
  offensives to the pole, all campaigns, median   400.0 -> 216.0
  over the campaigns that reached the pole (medians):
    offensives to the pole   108.0 -> 158.0  (46%)
    first three quarters     45.0 -> 106.0  (136%)
    last quarter             63.0 -> 36.0  (-43%)
    last quarter as a share of the campaign   58% -> 23%
```

## Reading it

- With the halving, 1 campaign in 120 reached the pole in 400 offensives. The
  other 119 stalled, and the median stalled campaign ends with the attacker
  holding 64 percent of the host: just short of the three-quarter mark, pushed
  back past it as often as it crosses. That is the "slowdown in the last
  stretch" reported in play.
- Without it, 92 in 120 reach the pole, and the whole-population median falls
  from the cap to 216 offensives. Over the campaigns that finish, the last
  quarter takes 36 offensives against 106 for the first three, about 35 a
  quarter: the closing stretch now moves at the same pace as the rest of the
  track. The supply penalty is what remains of the end-game drag; on this
  front it runs the attacker's logistics down to roughly 53 by the pole.
- Casualties per finished campaign rise in the AFTER arm only because more
  campaigns finish and the ones that finish are the long ones; per offensive
  they are unchanged, since the battle engine did not move.
- The attacker win rate is 52 to 54 percent on this front in both arms, which
  is why the halving mattered so much here: a near-even war has no margin to
  absorb an asymmetric step.

## What this does not settle

A first run of the same script earlier the same day, before a turn had
processed, put the BEFORE arm at 3 campaigns in 120 rather than 1, with the
AFTER arm within a few offensives of the figures above. The engine is seeded,
but the formations it fights with are the live ones, so the exact count moves
with readiness and strength between turns. The shape does not.

The front chosen is the one live war. A one-sided front (attacker winning 70
percent or more) would have punched through the halving in both arms and shown
a smaller difference. The change is still the right one there: the halving was
an asymmetry, not a pace dial, and the supply penalty already scales the pace
with depth on every front.
