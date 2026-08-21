export const subsidiaryCorporationsContent = `# Subsidiary Corporations

A corporation you control the votes of, but that another player actually runs day to day, can be formalized as your **subsidiary**. That gets you real management powers over it: you can fund it directly, force a minimum dividend, appoint its CEO, and spin off pieces of your own business into new subsidiary corporations. In exchange, the subsidiary's equity is frozen and its finances are read alongside yours for tax purposes.

There is no stored "parent" field anywhere in the data. Whether a corporation is your subsidiary right now is **derived live** from two facts: do you currently control more than **50% of its voting power**, and did someone formally declare the relationship. If either fact goes away, so does the relationship.

## Becoming a parent

To formalize a subsidiary, you (as CEO of the parent) need:

- **More than 50% voting control** of the target, counting dual-class supershares, not just raw share count. Shares you have reserved in an open sell order or listing still count toward your control, so listing a block for sale doesn't accidentally drop your powers before the trade fills.
- The target must not already be a formalized subsidiary of anyone, and must not be state-owned.
- Your own corporation must not be national/state-owned or itself already a subsidiary. **No chains**: a subsidiary can never be a parent.
- **No ownership cycles**: you can't formalize a subsidiary that, through some other holding, already controls you.
- **A different human must run it.** The subsidiary's CEO can't be you, the parent's own CEO, or the CEO of any of your other subsidiaries. If it currently is, you need to seat someone else first, a player or an NPP caretaker.

Once formalized, the relationship isn't permanent by default: if your voting control ever drops back to 50% or below (dilution, selling down), the game automatically clears the formalization the next turn. Nobody has to do anything for it to end that way.

You can release a subsidiary yourself too, but not immediately: there's a **24-turn minimum age** between formalizing and releasing, so you can't flip the relationship on and off in the same session.

## What being a parent lets you do

**Capital injection.** Send cash straight into the subsidiary's treasury from your own, converted through currency exchange if needed. Capped at **25% of your liquid capital per injection**, with a **24-turn cooldown** per subsidiary. This is the main tool for propping up a struggling subsidiary or funding its growth without going through the stock market.

**Dividend floor.** Set a minimum dividend rate the subsidiary must pay out, which its own CEO cannot undercut (though they can still pay more if they choose). If you stop controlling it, the floor stops applying automatically, it isn't a lever you keep after losing control.

**CEO appointment.** Reseat the subsidiary's CEO, either with an NPP caretaker (the underlying human stays formally attached but a computer runs it day to day) or with a different human character, subject to the same one-person rule above.

**Spinning off a piece of your own business.** Rather than formalizing an existing corporation, you can carve one of your own sector types out into a brand-new, wholly-owned subsidiary. All the sectors of that type move to the new corp with their plant capacity intact; nothing is lost in the move. Costs a base fee plus a per-sector fee, paid to your country's treasury, and is on a **168-turn (roughly 7 real-day) cooldown** per parent. The new corp starts private, 100% owned by you, and is immediately a formalized subsidiary from the moment it's created.

## What you can't do to a formalized subsidiary

**No equity issuance.** A formalized subsidiary cannot go public, issue new shares to the float, or self-issue, for any reason, while the relationship holds. Diluting the cap table risks dropping your control below 50% and letting the subsidiary's CEO escape your oversight, so the game blocks the whole category outright. If you genuinely want it to raise equity, release it first.

## Tax relief within a group

Corporations connected by formalized subsidiary edges form a **group**. Each corporation is still taxed individually every turn, but afterward, if the group has both a profit-making member and a loss-making one in the **same country**, the loss shelters the profit and part of the tax already paid is rebated back. A loss in one country never shelters profit in another. Cross-border intra-group transfer pricing is a separate live audit system: exposure above ₳5 million can trigger an assessment with a 40% surcharge, while same-country intra-group pricing is intentionally ignored.

The rebate is capped at what was actually paid in tax, so it can never turn into the treasury handing money to a group that paid nothing, and it's allocated back to whichever members actually paid tax, in proportion to how much they paid.

## Marketing and logistics synergies

Weaker members of a group get pulled **up** toward the group's strongest Marketing Strength and Logistics Strength over time, never dragged down, so acquiring a struggling subsidiary never punishes an otherwise-strong parent. An ordinary member can be lifted to at most 60% of the group leader's strength; a corporation spun off from a current group member gets a more generous 85% ceiling for a limited window after the spin-off, reflecting inherited brand and process knowledge. The lift closes 5% of the remaining gap each turn, so it's a gradual convergence, not an instant boost.

## Group balance sheet

Your corporation page shows a read-only consolidated view of your group: total liquid capital, total sector revenue, sector count, and how many distinct industries and countries the group spans. This is a display aggregation only; each member still holds its own cash and shares independently.

See also: [Corporations](/wiki/corporations), [Corporate Mergers & Acquisitions](/wiki/corporate-mergers), [Corporate Bonds](/wiki/corporate-bonds), [Stock Market](/wiki/stock-market)
`;
