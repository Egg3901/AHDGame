export const subsidiaryCorporationsContent = `# Subsidiary Corporations

A corporation you control the votes of, but that another player actually runs day to day, can be formalized as your **subsidiary**. That gets you real management powers over it: you can fund it directly, force a minimum dividend, appoint its CEO, and spin off pieces of your own business into new subsidiary corporations. In exchange, the subsidiary's equity is frozen and its finances are read alongside yours for tax purposes.

There is no stored "parent" field anywhere in the data. Whether a corporation is your subsidiary right now is **derived live** from two facts: do you currently control more than **50% of its voting power**, and did someone formally declare the relationship. If either fact goes away, so does the relationship.

## Becoming a parent

To formalize a subsidiary, you (as CEO of the parent) need:

- **More than 50% voting control** of the target, counting dual-class supershares, not just raw share count. Shares you have reserved in an open sell order or listing still count toward your control, so listing a block for sale doesn't accidentally drop your powers before the trade fills.
- The target must not already be a formalized subsidiary of anyone, and must not be state-owned.
- Your own corporation must not be national/state-owned or itself already a subsidiary. **No chains**: a subsidiary can never be a parent.
- **No ownership cycles**: you can't formalize a subsidiary that, through some other holding, already controls you.
- **A different human must run it.** The subsidiary's sitting CEO can't be you, the parent's own CEO, or the sitting CEO of any of your other subsidiaries. An NPP caretaker counts as a different operator, so you can formalize or reseat even if the previous human is still attached for reclaim. If they later try to reclaim while already running another of your subsidiaries, that reclaim is refused.

Once formalized, the relationship isn't permanent by default: if your voting control ever drops back to 50% or below (dilution, selling down), the game automatically clears the formalization the next turn. Nobody has to do anything for it to end that way.

You can release a subsidiary yourself too, but not immediately: there's a **24-turn minimum age** between formalizing and releasing, so you can't flip the relationship on and off in the same session.

## What being a parent lets you do

**Capital injection.** Send cash straight into the subsidiary's treasury from your own, converted through currency exchange if needed. Capped at **25% of your liquid capital per injection**, with a **24-turn cooldown** per subsidiary. This is the main tool for propping up a struggling subsidiary or funding its growth without going through the stock market.

**Dividend floor.** Set a minimum dividend rate the subsidiary must pay out, which its own CEO cannot undercut (though they can still pay more if they choose). If you stop controlling it, the floor stops applying automatically, it isn't a lever you keep after losing control.

**CEO appointment.** Reseat the subsidiary's CEO, either with an NPP caretaker (the previous human stays attached so they can reclaim later, but a computer runs it day to day) or with a different human character. The one-person rule applies to sitting human CEOs, not to a caretaker stash. Reclaim is blocked if that human already runs another of your subsidiaries.

**Spinning off a piece of your own business.** Rather than formalizing an existing corporation, you can carve one of your own sector types out into a brand-new, wholly-owned subsidiary. All the sectors of that type move to the new corp with their plant capacity intact; nothing is lost in the move. Costs a base fee plus a per-sector fee, paid to your country's treasury, and is on a **168-turn (roughly 7 real-day) cooldown** per parent. The new corp starts private, 100% owned by you, and is immediately a formalized subsidiary from the moment it's created.

## What you can't do to a formalized subsidiary

**No equity issuance.** A formalized subsidiary cannot go public, issue new shares to the float, or self-issue, for any reason, while the relationship holds. Diluting the cap table risks dropping your control below 50% and letting the subsidiary's CEO escape your oversight, so the game blocks the whole category outright. If you genuinely want it to raise equity, release it first.

## Tax relief within a group

Corporations connected by formalized subsidiary edges form a **group**. Each corporation is still taxed individually every turn, but afterward, if the group has both a profit-making member and a loss-making one in the **same country**, the loss shelters the profit and part of the tax already paid is rebated back. A loss in one country never shelters profit in another. Cross-border intra-group transfer pricing is a separate live audit system: exposure above ₳5 million can trigger an assessment with a 40% surcharge, while same-country intra-group pricing is intentionally ignored.

The rebate is capped at what was actually paid in tax, so it can never turn into the treasury handing money to a group that paid nothing, and it's allocated back to whichever members actually paid tax, in proportion to how much they paid.

## Marketing and logistics synergies

Weaker members of a group get pulled **up** toward the group's strongest Marketing Strength and Logistics Strength over time, never dragged down, so acquiring a struggling subsidiary never punishes an otherwise-strong parent. An ordinary member can be lifted to at most 60% of the group leader's strength; a corporation spun off from a current group member gets a more generous 85% ceiling for a limited window after the spin-off, reflecting inherited brand and process knowledge. The lift closes 5% of the remaining gap each turn, so it's a gradual convergence, not an instant boost.

## Subsidiary Group hub

Open the Subsidiary Group page from the link below My Corporation or from the group summary on a corporation page. Select members to compare their daily revenue, cash and operating footprint. Authorized CEOs can also inspect completed-turn results, valued using the exchange rate recorded in each snapshot. Combined figures include internal transactions; members still hold their own cash independently.

The parent CEO can set a group name and logo and save subsidiary objectives. Player CEOs can acknowledge or decline their own suggestions. In qualified enabled plants economies, NPPs apply directions from the next turn using their existing strategy and cash safeguards. Player suggestions remain voluntary. Capital investment permission applies to new plant orders and expansion.

The supply section saves Commercial independence or Group members first as the group's preference. Under Group members first, player CEOs can choose to receive group supplies. This is receiving-only and never commits their corporation's own output. Participation changes become effective next turn and remain bound to the same CEO and group. Under Commercial independence, Group receiving controls are hidden and the corporation's CEO Office setting is disabled with an explanation; the saved preference is retained.

Automatic supply coordination is disabled by default and requires world qualification before activation. Enabled plants economies reserve only NPP output at the applicable market benchmark, after existing contracts. The parent CEO can choose an automatic Group Chain discount from 0% to 35%, matching the supply agreement price band. The default is zero. Discounts apply only to reserved inputs actually consumed, with a matching supplier operating charge and buyer credit. Gross sales remain at benchmark value; discounts redistribute operating profit before tax. Full benchmark cash is protected until consumption. Negotiated agreements retain their own prices and acceptance rules, and can be managed on the Group page by each corporation's own player CEO. Output, buyer needs, available funds and protected NPP reserves cap allocations. Allocations stay within the same country; with freight settlement they also require co-located plants and verified local delivery capacity. Unused output returns to normal market sales and per-turn allocations carry no shortfall damages.

After an enabled world completes a turn, authorized CEOs can compare fixed-output estimates for both policies. Changing receiving participation recalculates group and per-corporation direct revenue and operating-profit differences. Existing contracts, production changes, taxes and longer-term price responses are excluded. Group totals include internal trading and are not consolidated net accounts. Missing or stale inputs show estimates as unavailable.

## Group balance sheet

Your corporation page shows a read-only consolidated view of your group: total liquid capital, total sector revenue, sector count, and how many distinct industries and countries the group spans. This is a display aggregation only; each member still holds its own cash and shares independently.

See also: [Corporations](/wiki/corporations), [Corporate Mergers & Acquisitions](/wiki/corporate-mergers), [Corporate Bonds](/wiki/corporate-bonds), [Stock Market](/wiki/stock-market)
`;
