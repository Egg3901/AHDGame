export const corporateMergersContent = `# Corporate Mergers & Acquisitions

You can offer to buy another player's corporation outright. If the acquirer's CEO and the target's CEO agree on a price, the target's shareholders get cashed out and the whole corporation, cash, sectors and all, becomes part of the acquirer. If the combined firm would end up dominating a national industry, the deal does not close automatically: it goes to a named minister for review first.

This is separate from a [hostile takeover](/wiki/corporations#privatization-buyouts), which squeezes out minority shareholders once you already control a corporation. A merger offer is how you buy a corporation you do not yet control.

## Proposing an offer

From the Deals tab on your corporation page, search for a target by name across **any country** (cross-border acquisitions are allowed) and propose an all-in price for the whole corporation. You cannot propose:

- Buying your own corporation
- A state-owned corporation (these are not for sale)
- A second offer on a target you already have a pending offer against
- Anything at all if your corporation is under an **overdue** divestiture order from a past merger review (see below). A still-current order does not stop you; only one you missed the deadline on does.

The offer stays open for **24 turns**. If the target's CEO does nothing, it expires.

Alongside your price, the game shows you a **reference valuation**: an independent fair-value estimate built from the target's share price times its shares outstanding, its liquid cash, and the replacement-cost value of its plants. This is not the price you have to pay, it's a sanity check so both sides can see whether an offer is generous or lowball.

## Responding to an offer

If you are the target's CEO, you can accept or reject. If you are the acquirer, you can withdraw before it is answered. Accepting is final and irreversible once processed.

**What accepting does NOT let you buy (yet):** a target carrying any un-matured corporate bond, or a target that itself holds shares in another corporation, cannot currently be acquired this way. Those cases are deferred; you'll get an error rather than a broken transfer.

## What happens when a deal closes

1. The acquirer pays the agreed price. If you don't have the cash, the deal fails outright before anything moves.
2. Every one of the target's shareholders is cashed out at the agreed price pool, the same payout mechanism used for nationalization buyouts.
3. The target's own liquid cash folds into the acquirer's treasury, on top of the price already paid to shareholders. This isn't double-counting: the price went to the people who owned the shares, and the cash sitting in the company is a separate asset that transfers with it.
4. Every sector the target owned moves to the acquirer with no value loss, currency-converted where needed.
5. The target corporation is deleted. Any other pending offer that named it, on either side, is automatically withdrawn.

## Merger review

Not every acquisition is free to close. If the combined firm would end up dominating a national industry, the country's competition authority gets a say before the deal can complete.

**When it applies.** Both corporations must be privately owned; a state-owned corporation on either side makes review inapplicable (the state consolidating its own firms isn't a market transaction). The target's country must not be a command economy, and it must actually have an antitrust law with a live minister holding the seat. Review is checked at the moment the two firms would actually combine, both for an agreed acquisition and for the squeeze-out that ends a hostile takeover.

**What trips it.** The combined firm's post-merger share of whichever national industry overlaps most between the two corporations, measured only within the target's home country. The trigger threshold depends on that country's enacted antitrust law level:

| Enforcement level | Referred at a combined share of |
| --- | --- |
| No enforcement | Never |
| Case-by-Case Review | 75% |
| Active Enforcement | 60% |
| Structural Enforcement | 50% |
| Open Markets Charter | 40% |

**Who decides.** The cabinet seat that country gives the job, the Attorney General in the United States, the Business Secretary in Britain (Board of Trade in earlier eras), Internal Trade elsewhere. Whoever holds the seat right now decides; if the seat changes hands mid-review, the new holder takes over the queue. The seat has **6 turns** to rule.

**What they can decide.** Clear it, block it outright, or clear it on condition of divesting the overlapping industry. If nobody rules within 6 turns, the game falls back to published bands, no hidden roll: within 5 points of the threshold it clears automatically, within 15 points it clears with a divestiture order, beyond that it's blocked.

**If you're blocked, that's final.** A blocked pairing cannot be retried. A cleared one doesn't need a second referral, so if a hostile takeover gets referred and later clears, you can simply run the squeeze-out again.

**If you're cleared with a remedy.** You get 12 turns to sell down the industry that tripped the threshold until your controlled group, you plus every corporation you control more than 50% of, no longer holds the flagged share. Spinning the business into a subsidiary changes nothing; the group's share is unchanged either way, so that alone never discharges the order. Miss the deadline and you're fined 5% of your controlled group's revenue in that industry every turn until it's resolved, and you can't open any new acquisition offers while overdue.

## Interaction with subsidiaries

A merger between two corporations you both formally control (see [Subsidiary Corporations](/wiki/subsidiary-corporations)) is not the same event as an acquisition here. Merger review only fires when two previously separate, independently-owned corporations become one. Consolidating within your own group is a different question entirely.

See also: [Corporations](/wiki/corporations), [Subsidiary Corporations](/wiki/subsidiary-corporations), [Nationalization & National Corporations](/wiki/nationalization), [Stock Market](/wiki/stock-market)
`;
