# Ticket 1353: minimum war duration

Date: 2026-09-24

## Question

Would a 24-turn minimum prevent a defender from ending a new war by briefly
falling from 100 percent control to 99 percent and immediately returning to the
starting pole, without breaking ordinary late-war victories?

## Method

`scripts/sim/warMinimumDuration2026-09-24.ts` replays fixed territorial paths
through both transition rules. This is a state-transition simulation, not a
combat-odds simulation: battle power, casualties, and occupation step sizes are
unchanged. The only changed output is the turn on which a pole may finalize.

Command:

```text
npx tsx scripts/sim/warMinimumDuration2026-09-24.ts
```

## Results

| Scenario                                   | Before                | After                 |
| ------------------------------------------ | --------------------- | --------------------- |
| Untouched defender opening                 | continues             | continues             |
| Shallow incursion, immediate counterattack | defender wins turn 2  | defender wins turn 24 |
| Early attacker sweep                       | attacker wins turn 4  | attacker wins turn 24 |
| Early pole broken before minimum           | defender wins turn 2  | continues             |
| Defender retakes pole after minimum        | defender wins turn 25 | defender wins turn 25 |
| Split German front reaches pole late       | side A wins turn 30   | side A wins turn 30   |

## Conclusion

The minimum removes the one-turn and two-turn resolution edge cases without
changing any victory that reaches a pole after turn 24. Requiring a pole-arrival
stamp prevents the defender's opening position from becoming an automatic win
on turn 24. The turn sweep makes an early pole resolve exactly when it matures,
unless a counterattack has broken control first.

## Membership and mutual defence follow-up

The accession path now distinguishes the timing of the threat:

| Applicant state                 | Admission warning               | Entry path                                                                              |
| ------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| Already defending a live war    | Live conflict and opposing side | Unanimous bloc vote, then immediate collective-defence entry                            |
| Target of a pending declaration | Declarer and pending status     | Automatic charter entry if admitted before enactment; otherwise the live-war vote above |
| No live or pending threat       | None                            | Normal charter enforcement on any future attack                                         |

This preserves the declaration-time guarantee for existing members while
avoiding retroactive entry merely because a country joined during a war. The
retroactive path is limited to the host side of the conflict. A vote to join
the attacking side remains an offensive coalition decision and still requires
national ratification.
