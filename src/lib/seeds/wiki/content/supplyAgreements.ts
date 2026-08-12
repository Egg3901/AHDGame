export const supplyAgreementsContent = `# Supply Agreements

By default, every corporation buys and sells on the open market, where orders clear **cheapest-first** and there's no guarantee of who you trade with turn to turn. A **supply agreement** is the alternative: a private, standing contract between two corporations, where a supplier commits to sell a particular commodity directly to a specific buyer.

It's the in-game version of a wholesale supply deal: a locked-in relationship that sits *outside* the open scramble and gets settled first.

## How it works

An agreement is between two corporations for one commodity:

- One side is the **supplier**, who commits to sell.
- The other is the **buyer**, who commits to take that supply.

When the market clears each turn, the contract is honored **before** the open market:

1. **The buyer's demand is filled from the supplier's output first**, up to the volume the supplier can actually produce.
2. **The supplier's excess** (whatever it makes beyond the contract) flows out to the open market as normal.
3. **If the supplier falls short** of what it promised to produce, the buyer covers the gap on the open market **and** the supplier pays damages to the buyer (half the shortfall's market value, capped). A mothballed plant that still has a live contract is a damages machine.

So a supply agreement is a *priority claim*, not a magic supply. It moves the buyer to the front of the supplier's queue; it doesn't create commodities that don't exist.

## Both sides must agree

An agreement can't be imposed. One corporation makes an **offer**, and it only takes effect once the other **accepts**. Either party can **cancel** an existing agreement.

## The price stays honest

The two corporations set the contract price themselves, but it has to stay within **±35% of the prevailing market price** for that commodity. It can't drift far below (a disguised gift, dumping supply into an ally for free) or far above (gouging a captive partner). The band keeps the contract anchored to what the commodity is actually worth, and it moves as the market moves.

## Exclusivity and loyalty

Agreements can be made **exclusive**, which, paired with scarcity, is genuinely powerful: a supplier-and-buyer pair can lock up a slice of a commodity that rivals then have to do without. It's a real strategic tool for controlling a supply chain.

It also interacts with [brand loyalty](/wiki/brand-loyalty). A guaranteed contract means guaranteed sales for the supplier, which helps its **fill rate**, and delivering what you offer is exactly what earns loyalty. There's no separate bonus stapled on; the benefit flows through the normal loyalty rules. For the buyer, a locked-in source is a stable, predictable input, which makes planning production far easier.

## Clearing order, at a glance

Each turn, demand is satisfied in this sequence:

1. **Contracted**: supply agreements are filled first.
2. **Loyal slice**: loyal customers get their reserved share (see [brand loyalty](/wiki/brand-loyalty)).
3. **Cheapest-first**: everything that's left clears on the open market.

## Non-player corporations

NPP CEOs use the same contract book. They auto-accept an inbound proposal when they actually consume the commodity and the premium is honest (within 20%). They propose same-country NPP-to-NPP contracts when a seller has uncommitted plant and a buyer is input-starved, at a small glut discount or shortage premium. They never inbox-spam a player, and they serve cancel notice before a mothballed plant starts paying shortfall damages. State-owned enterprises are left to the command-economy pass.

## Strategy notes

- **Secure your critical inputs.** If a commodity you depend on is prone to shortage, a contract with a reliable supplier means you're filled before the open-market scramble even starts.
- **Lock in a buyer to protect your fill.** Selling under contract guarantees you move volume: good for cash-flow certainty and good for your brand loyalty.
- **Exclusivity is a weapon, and a commitment.** Cornering a scarce commodity can starve rivals, but it ties up your own supply, and the ±35% band means you still can't extract an abusive price from your partner.

## Related

- [Commodities](/wiki/commodities): supply, demand, and how the open market clears
- [Corporations](/wiki/corporations): running the businesses that sign these deals
- [Market System: A Player's Guide](/wiki/market-system-guide): how posted-price clearing works
`;
