export const marketSafeguardsContent = `# Market Safeguards

The stock market has an automated kill switch watching over it. This page covers what it watches, what trips it, and what you see when it does.

## What it is

The launch guard is an admin-configured safeguard that runs every turn once the market has been switched on to a live-pricing tier (clearing or above). It compares the aggregate market cap of every corporation to a reference value stamped when the guard was armed. If that comparison shows too sharp a drop, the guard automatically reverts the market to a lower, safer tier, no human has to be watching in real time for a broken market to get caught.

This is not something you configure or trigger yourself. It runs in the background as a floor under the live market, the same way a real exchange's circuit breaker exists whether or not any one trader thinks about it.

## What counts as "too sharp"

The guard does not simply watch the raw price level. A market can fall for a good reason, for example a central bank tightening rates, which lowers what future earnings are worth and should pull prices down without anything being broken. The guard tries to tell that apart from an actual break:

- It tracks both the raw aggregate market cap and, once enough corporations are carrying a model-based fundamental valuation, an expected value implied by those fundamentals.
- A fall that fundamentals justify is excused. A fall that outruns what fundamentals justify is not, and can still trip the guard even if the raw drawdown alone would have looked survivable.
- Fundamentals can only ever make the guard more forgiving, never stricter. A market-wide sentiment swing on its own cannot permanently downgrade the market; only a drop with no fundamental basis can.
- There is a grace window of several turns right after the guard arms, before it starts evaluating trips at all. The market needs a little time to settle after any tier change before a comparison against it means anything.

## What happens when it trips

If the guard trips, the market tier drops one step:

- From the highest tier (plants, capacity-driven pricing) it falls back to capital, the nearest tier below that still has its own growth mechanism, so the economy keeps moving rather than going flat.
- From capital or clearing it falls back to ledger, an observability-only tier that does not move prices on its own.

The guard disarms itself once it has tripped. It does not keep re-tripping tier after tier on its own; getting the market back to a live-pricing tier is a deliberate admin decision, not something that happens automatically.

## What you see as a player

There is no separate player-facing panel for this. What you will notice, if the guard ever fires, is the market tier itself changing: pricing behavior shifts to whatever the safer tier does (see [Core Systems](/wiki/core-systems) and [Corporations](/wiki/corporations) for what each tier means for share pricing). Nothing about your holdings, orders, or corporate ownership is reversed or rolled back, only how prices are computed going forward changes.

## What this means for you

- A sudden change in how volatile or responsive share prices feel, without any news event behind it, can be this guard doing its job rather than a bug.
- The guard existing does not mean the market cannot fall hard for real reasons. Rate hikes, a genuine earnings collapse, and other fundamentals-driven moves are not what it is built to stop, and it will let those through.
- If the market tier drops, that is a system-level event affecting every corporation at once, not something specific to your portfolio.

See also: [Corporations](/wiki/corporations), [Central Banks](/wiki/central-banks), [Corporate Bonds](/wiki/corporate-bonds).
`;
