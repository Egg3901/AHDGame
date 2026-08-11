export const primariesContent = `# Primaries

Primaries are intra-party competitions: you beat other members of your own party for the nomination slot. They're decided by a **primary score** (not votes), and they close at the primary deadline. Miss the window, wait a full cycle.

This page covers declaration mechanics, scoring, NPP dynamics, and tactics. For the overall election structure see [Election Mechanics](/wiki/election-mechanics).

## Declaration window

- The primary phase opens when a new election cycle spawns.
- The window closes at the primary deadline. For a US House race that's 48 hours after spawn; for a Senate race it's 240 hours. General elections last 48 turns for both chambers.
- **You can only declare during this window.** After the primary deadline passes, the primary resolves and no new candidacies are accepted.
- Party membership is required **at the moment of declaration.** Joining a party between spawn and the primary window closing is fine.
- **One race at a time.** Active candidacy blocks a new declaration. Withdraw first, then re-enter.

If you're switching parties, a prior candidacy in a different party is **auto-withdrawn** when you declare under the new party, so no manual cleanup is needed.

## The standard primary score (state races)

Scores go 0 to 100. Four components, with an infamy penalty applied at the end:

| Bucket | Max | How it's scored |
| --- | --- | --- |
| Alignment (state) | 25 | Points lost scale with how far your positions sit from the state's economic and social lean |
| Alignment (party) | 15 | Points lost scale with how far your positions sit from your party's official platform |
| Favorability | 35 | A straight percentage of your Favorability score |
| Political Influence | 25 | A square-root curve of your Political Influence, capped once it reaches 100 |

The raw score is then reduced by an infamy penalty: at most a 5% cut, scaling linearly up to that cap as infamy rises from 0 to 100.

### Reading the formula

- **Alignment splits state vs. party.** Of the 40 alignment points, 25 measure how close you are to the state's cached economic and social lean, and 15 measure closeness to your party platform. State match is the bigger factor: a candidate who fits the state's politics gets a real edge over a perfect partisan match who's out of step with the state. If a state has no cached lean, scoring falls back to a single 40-point party alignment.
- **Favorability.** Linear. 50 Favorability is worth 17.5 pts; 80 Favorability is worth 28 pts.
- **Influence.** A square-root curve, capped once PI reaches 100. PI of 100 scores 25; PI of 85 scores about 23; PI of 50 scores about 17.7; PI of 20 scores about 11.2.
- **Infamy.** A clean candidate (infamy 0) keeps their full score. A maxed-out infamous candidate (infamy 100) loses 5% of their score.

**Highest score per party advances to the general.** Other candidates in that party's primary are marked withdrawn.

## The presidential primary score

Presidential primaries reward national reach and party infrastructure more than state-level campaigning:

| Bucket | Max | How it's scored |
| --- | --- | --- |
| Policy alignment (party only) | 40 | Points lost scale with how far your positions sit from your party's official platform |
| Party organization (home state) | 25 | A straight percentage of your party's organization score in your home state |
| National Political Influence | 25 | A curve based on your national reach, capped at the maximum |
| Favorability | 10 | A straight percentage of your Favorability score |

The raw score gets the same infamy penalty as the state-level formula. Presidential primaries are national, so there's no state-position alignment component: only the party platform applies.

Presidential contenders live or die on NPI and party-org investment in their home state. A candidate with low NPI but high state PI can win state races but loses presidential primaries.

## NPP primary candidates

NPPs (Non-Player Politicians) autonomously enter primaries. Entry is deterministic, not random:

- **50% primary-score penalty** when a player is in the same party's primary. A raw 60-point NPP effectively scores 30 against you.
- **Entry is deterministic, not probabilistic.** NPPs follow a strict priority order:
  1. **Incumbent defense.** If the sitting officeholder is an NPP and their party has no player candidate, the incumbent NPP always enters to defend the seat.
  2. **Slate fill.** Each party aims to field at least one NPP candidate in every open race. NPPs are assigned to empty primaries first.
  3. **One generic NPP per party.** After slate fill, at most one additional generic NPP may enter any party's primary if no player is present. This prevents races from becoming overcrowded with autonomous candidates.
- NPPs do **not** drop out based on appeal. Once entered, they remain until primary resolution or manual withdrawal.

### How NPPs shape your primary

- **NPPs are beaten by alignment and favorability.** The 50% penalty means a player sitting at alignment 35 + favorability 25 + influence 15 (= 75) beats a raw-80 NPP scoring an effective 40.

## Tactics during primary

1. **Run a Quick Poll before declaring.** 2 actions + ₳25k. Shows your topline appeal and the 5 best/worst groups. Use it to decide whether this is your race.
2. **Alignment first.** If your policy positions are more than about 6 points away from your party's official position, reconsider. Check the party page: the official positions are visible there.
3. **Don't attack fellow party members.** If someone else wins the primary, you want them at full strength going into the general.
4. **Pump Political Influence.** Campaign 6-10 actions/day in-state. PI compounds over the primary window because decay is much slower than Campaign's +1% per action.
5. **Request NPP endorsements.** Each success lifts your appeal across a demographic. 5 actions + 40% base success. Only endorse from NPPs whose party matches yours or who are independent; opposition-party NPPs won't endorse you even if alignment is close.
6. **Don't sleep on Favorability.** 35 points of the score live here. Going into primary with Favorability 80 is worth 28 pts vs. 17 at Favorability 50, an 11-point swing.

## Withdrawal during primary

Allowed but typically a mistake:

- Withdrawal marks your candidacy withdrawn, and you cannot re-enter.
- The only legitimate reason to withdraw mid-primary is pivoting to a different office you prefer, before that election's primary window closes.
- If you're losing the primary but want to keep your option open, don't withdraw, just lose. Your PI, Favorability, and donor base persist for the next cycle.

## After primary resolution

When the primary deadline passes:

1. The turn processor resolves all primaries that have closed.
2. Each party's candidates are scored; the highest advances.
3. Losers receive a notification and are marked withdrawn.
4. The winner's candidacy moves into the general election phase.
5. A general-phase vote tally is initialized for the election.

## Common primary mistakes

- **Declaring without a poll.** You walk in blind. Always commission a Quick Poll first.
- **Entering a crowded primary where you're 4th in alignment.** You'll lose; save your actions for a next-cycle race where you're first or second.
- **Attacking primary rivals.** Favorability drain. Net negative.
- **Skipping Party Influence investment pre-primary.** The party bonus actions you miss out on could have funded another 2-3 Campaign actions per day.
- **Underestimating NPP density in unsexy races.** State Senate primaries in rural states can have 5+ NPPs all scoring 50. A halfway-competent player wins, but you need the 50% penalty working, so don't be surprised if a player-less seat gets fully NPP'd.

## Related

- [Election Mechanics](/wiki/election-mechanics): Full election structure.
- [General Elections](/wiki/general-elections): What happens after you win the primary.
- [Primary vs General Tactics](/wiki/primary-general-tactics): Pivoting once the general starts.
- [NPP Opponents](/wiki/npp-opponents): Strategies for competing against autonomous candidates.
- [Parties](/wiki/parties): Party platform positions, how to see them.
- [Polling](/wiki/polling): Quick and Full poll details.
`;
