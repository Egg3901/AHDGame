export const liveElectionResultsContent = `# Live Election Results

Some worlds turn on **election night**: a results page that drips out calls and projections instead of just showing a final number. It sits on top of the normal election math from [Election Mechanics](/wiki/election-mechanics); everything here is a display layer, not a second vote count.

## Is it on

Election night is feature-flagged per world and defaults off. If your world has it enabled, national races (House, Commons, Bundestag, Dáil, and the other multi-seat national chambers) get a dedicated results view with live calls. Single-seat local races still show results, just without the national seat board.

The turn engine is always the real authority on who won. The results page is a projection built from the same numbers; it never changes the outcome, it only decides when and how you get to see it.

## The final hour

Every election has a **final hour**: the real-world stretch between the second-to-last turn and the final turn. That's when the drip happens. Before the final hour, the page shows leads and a reporting percentage that creeps up as the general phase progresses, capped at 88% so nothing looks final too early.

Once the final hour starts, each region (state, constituency, whatever the race's unit is) gets a **reveal moment**: a deterministic point in that hour where its reporting percentage ramps up toward 98% and it becomes eligible to be called. Reveal order is fixed per election, so if you refresh, or your rival is watching the same race, everybody sees the same states report in the same order. Nothing is randomized live.

If the election clock is paused, the drip freezes with it. A paused final hour does not keep ticking in the background.

## When a unit gets called

A region is **called** when three things are all true:

- it isn't tied
- it has actually received votes
- it has been revealed by the drip (or the election has fully ended), **and** the leader is ahead by at least **5 percentage points**

Below that 5-point margin, the page shows a lead, not a call. Tied regions are never called, no matter how late it gets.

For President, called and leading regions roll up into electoral vote totals: \`calledEv\` from regions that have been called, \`leadingEv\` from regions still showing an uncalled lead. For multi-seat national chambers, the same idea rolls up into projected seats per party.

## National projection

For national aggregate races, the page also computes a top-line call:

- **Too early**: no seats projected anywhere yet.
- **Majority**: the leading party has cleared the seat threshold (half the chamber, plus one).
- **Hung parliament**: below threshold, in a Westminster-style chamber (Commons, Dáil, Bundestag, Shūgiin, and similar).
- **Largest party**: below threshold, in a chamber that doesn't use "hung parliament" framing; shown as a lead over the runner-up instead.

This projection reads live off however many regions have declared so far, so it can flip late if a handful of big regions are still uncalled going into the final minutes.

## What you're watching, mechanically

The results page polls every 30 seconds while an election is active. Nothing you do on the results page itself changes the outcome: canvassing, ads, and fundraising still work the way they always have, right up until the general phase's [final 4 turns](/wiki/general-elections), which carry 30% of the entire vote pool. Election night is just the moment that math becomes visible in public, one region at a time, instead of all at once.

If your race ends up close enough to fall short of a majority, see [Contingent Election](/wiki/contingent-election) for what happens next in a US presidential race with no Electoral College majority.

For a presidential general, the [Vote Factor Ledger](/wiki/vote-factor-ledger) on this page breaks each candidate's national total into the factors that built it, so you can see exactly why the numbers landed where they did.
`;
