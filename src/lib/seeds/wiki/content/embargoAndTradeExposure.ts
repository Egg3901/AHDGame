export const embargoAndTradeExposureContent = `# Embargoes & Trade Exposure

An embargo is a country restricting trade with another, and it can be imposed two ways: a cabinet minister acting fast on a limited leash, or legislation putting something durable on the books. What it actually does to corporations operating across that border depends on which trade model is active in your world.

## Imposing an embargo

**Ministerial embargoes** are the fast lever. A cabinet member spends one cabinet action to impose one, and it is deliberately short-leashed:

- It can target a specific commodity or "all" commodities.
- It can restrict exports, imports, or both directions between the two countries.
- It can either fully block the flow or cap it at a set amount.
- It lasts at most two game years (96 turns) before it must be renewed.
- A member can hold at most two active ministerial embargoes at once.
- Once a minister embargoes a target, that same source-to-target pair is locked out of a new ministerial embargo for three and a half game years (168 turns), counted from when it was enacted, not when it was lifted. Lifting one early does not reset that lock.

That cooldown exists so a minister cannot endlessly re-impose the same embargo the moment it lapses. If you want a restriction that outlasts the cooldown, or one that doesn't depend on a minister keeping it renewed, the durable path is **legislation** (see [Bills & Legislation](/wiki/bills-legislation)): an embargo written into a bill that passes doesn't expire on a timer and can only be lifted by repealing it the same way it was passed, not by a minister's lift action.

## What an embargo does to a corporation

This depends on which embargo model your world is running.

### Total block (legacy model)

Under the older model, a full block embargo (commodity "all", mode "block") mothballs every sector a target-nation corporation runs inside the embargoing country. Revenue and cost both go to zero for that sector, the whole operation goes dark, including sales the sector was making to buyers inside the host country itself. That last part is the flaw this model has: an embargo is supposed to restrict what crosses the border, not shut down a subsidiary's ordinary local business.

### Trade-exposure model

Under the newer model, an embargo only strips the sector's cross-border leg. The sector keeps operating on whatever domestic demand it was already serving in the host country; only the exported share of its output is lost.

The mechanics:

- Each sector has an **export exposure**: the share of its output that cleared abroad the prior turn, weighted by supply.
- An embargo scales the sector's revenue down by that exposure. A sector that was purely selling into the embargoing country loses close to everything; a sector that was mostly serving domestic demand barely notices.
- Maintenance costs scale down with the reduced revenue automatically, so the domestic remainder still operates at its normal margin rather than carrying costs sized for the business it no longer has.
- The export-premium margin bonus (the extra margin export-heavy sectors normally earn) is dropped too, since the sales generating it are the ones now gone.
- Fixed corporate-level overhead, marketing, logistics, R&D, the executive suite, is untouched by any single sector's embargo exposure and keeps applying its usual drag.

The practical read: a corporation built around exporting into a country that then embargoes it takes a real hit sized to how exposed it actually was, visible in its own financials, rather than an all-or-nothing shutdown that also zeroes out unrelated domestic business.

## What this means for you

- Check how exposed a corporation's sectors are to a single trading partner before you count on that revenue staying stable. A sector selling almost entirely into one country is the one an embargo against that country will hurt the most.
- A ministerial embargo you're hit with is temporary by construction, at most 96 turns, so a corporation can often ride out the export loss rather than restructure around it. A legislated embargo is a different bet: it does not expire on its own.
- If you're the one imposing an embargo to pressure a target country, remember it lands on that country's corporations operating in your territory, not on the target country's home economy directly. The commercial pressure is on companies with exposure to you, wherever they're chartered.
- The 168-turn cooldown means you cannot lift a ministerial embargo and immediately reload it against the same target to keep the pressure current. Plan around that gap, or use legislation if durability matters more than speed.

See also: [Trade System](/wiki/trade-system), [Bills & Legislation](/wiki/bills-legislation), [Cabinet](/wiki/cabinet), [Corporations](/wiki/corporations).
`;
