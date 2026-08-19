export const contingentElectionContent = `# Contingent Election

If no presidential ticket wins a majority of the Electoral College, the race doesn't stay unresolved. The US Constitution's 12th Amendment fallback kicks in: the **House elects the President**, the **Senate elects the Vice President**. This page covers how that resolves in-game.

This only applies to the US presidential race, and only when the Electoral College comes up short. See [Election Mechanics](/wiki/election-mechanics) for how the normal vote count and Electoral College tally work before it ever gets here.

## Who's on the ballot

The two chambers don't vote on the same candidate lists, and neither one is a free-for-all:

| Chamber | Elects | Eligible candidates |
| --- | --- | --- |
| House | President | The **top 3** presidential candidates by electoral vote |
| Senate | Vice President | The running mates of the **top 2** tickets by electoral vote |

If the VP ballot only has one eligible running mate (because two tickets shared a running mate, for example), that candidate wins outright and the Senate doesn't need to vote at all.

## The House votes by state, not by member

This is the part that surprises people: the House doesn't do a normal 435-member roll call. Each **state delegation** casts one combined vote. Your state's representatives don't each get a vote in the contingent count, they decide how their state's single vote gets cast. Winning the Presidency this way takes **26 states**, a majority of state delegations.

DC has electoral votes in the normal count but no voting House delegation, so it's excluded from this ballot entirely.

A delegation votes for whichever candidate has a strict majority of that state's weighted representative picks. If a delegation is split with no majority, that state's vote is a tie and it **abstains**. A delegation with no eligible voters or no eligible candidates also abstains.

## The Senate votes one senator, one vote

No delegation weighting here. Every senator casts a single vote among the eligible VP candidates. Electing the Vice President takes **51 votes**.

## How each member picks

Every House member and senator scores each eligible candidate on two things: whether the candidate shares their party, and how far apart their policy positions are.

A shared party affiliation is worth a flat bonus, large enough to usually decide things on its own, but not so large that a big ideology gap can't still flip a close call. Distance is measured the same way as everywhere else in the game: the sum of the economic and social axis gaps between the voter's own position and the candidate's.

Each member votes for whoever scores best against them personally. If two candidates tie for a given voter, the game breaks the tie deterministically off the election's own ID, so replaying the same election always produces the same picks, nothing here is decided by a fresh coin flip each time.

## Winning, and what happens on a deadlock

Once both ballots are tallied:

1. Whoever has the most votes leads.
2. If the leader clears the chamber's threshold, 26 states or 51 senators, they win outright.
3. If nobody clears the threshold and there's a tie among the leaders, the game breaks the deadlock deterministically rather than looping forever. The tiebreak is seeded off the election, so it's reproducible, not random each time you check.
4. In the rare case where a chamber produces no usable votes at all (nobody could pick, or the chamber ballot itself was empty), the game falls back to the original Electoral College count from before the contingent election even started, breaking ties by original electoral votes.

Either way, a winner is always produced. A contingent election never leaves the Presidency or Vice Presidency vacant.

## What you actually see

The result records whether the outcome was a clean majority or needed a deadlock tiebreak, plus the full vote breakdown: every state's House pick, every senator's Senate pick, and the aggregated totals. If your candidate makes the top 3 in electoral votes but falls short of an outright Electoral College win, your campaign isn't over, it moves to Capitol Hill, and now your state delegation relationships and your party's House and Senate composition matter as much as anything you did on the campaign trail.
`;
