export const defenceProcurementContent = `# Defence Procurement

Recruiting units and paying for equipment are two different systems. This page is about the second one: how the defence appropriation turns into materiel, who suppliers can be, and the guardrails that stop the budget turning into free cash for whoever holds the defence chair. See [Units, Recruitment & Procurement](/wiki/military-units) for unit costs and upkeep.

## Who awards contracts

The defence seat holder writes procurement contracts against the national defence appropriation. A contract names a corporation with a defence-strategy plant as the supplier and commits the country to buying a run of "lots" of equipment from it.

## Contracting windows

Contracts are budgeted in quarterly tranches, not against an open-ended future stream. Each country gets a new contracting window every 12 turns (one quarter of a game year). Inside one window:

- The country's total new obligations are capped at roughly 45% of its annual defence line, scaled to the window (the other 55% is assumed to be sustaining the seeded force, not buying more of it).
- **No private supplier may take more than one third of that window's tranche.** This is the concentration cap: it stops a minister emptying the entire quarter's procurement budget into a single corporation.
- **State-owned industry is exempt from the one-third cap.** In a command economy the buying country typically seeds one National Corporation per sector, so applying the private-supplier cap there would leave two thirds of the window unspendable with no other plant able to use it. A National Corporation has no player CEO who personally profits from the award, which is the reason the cap exists in the first place.

When the window rolls over, unspent capacity does not carry forward and a fresh tranche opens.

## The price band and why cost tracks price

A lot's price is anchored to a GDP-scaled figure and does not move turn to turn just because a plant's input costs do. What DOES move is the plant's production cost: it is priced off the live commodity market, using the same world price-ratio the plant's own turn economics use, so a lot's cost floor and a plant's actual input bill move together instead of drifting apart. A supplier building lots in a world where steel has gotten expensive pays more to build them; a minister paying 1953-era prices for a contract struck when commodities were cheap does not get to keep quoting that price forever, because cost is re-derived from the live market on each delivery sweep.

The gap between what a lot sells for and what it costs to build is the supplier's margin. This margin is the entire economic point of a defence contract: it is deliberate profit for the arms industry, not free money. Contracts written before this cost model shipped keep settling on the terms they were signed under; that is not something you as a player can trigger or exploit going forward, it only matters for very old, already-existing contracts.

## The self-dealing check

Every award is checked for whether the minister writing it has a stake in the corporation receiving it:

- **Owner.** The same player controls both the ministry and the corporation (checked against the corporation's appointing owner, so installing a caretaker CEO does not launder the relationship).
- **Material shareholding.** The minister personally holds 5% or more of the corporation's shares.

A self-dealt award is not blocked. It is disclosed publicly, on the order book, in plain language: who awarded it, what stake they hold, how many lots, and what it's worth. The minister also takes a favorability hit that scales with how much of the country's procurement tranche the contract represents: a token order to a company you own costs almost nothing, but routing a large share of the quarter's whole budget to yourself is a real political event. The penalty is capped, so no single award ends a career outright, but it is designed to make a big self-dealt contract genuinely costly to sign.

## Tearing up a contract

A contract can be cancelled by the minister who holds the defence seat, and how much that costs depends entirely on which of three things it is.

**Withdrawing an offer.** An award starts as an offer and does nothing until the supplying CEO accepts it. Until they do, the minister can withdraw it for nothing: no fee, no disclosure, and the lots go straight back into the window's tranche. Nobody was promised anything.

**Terminating for cause.** If a plant misses three delivery turns in a row for a reason of its own making, the contract can be torn up for free and the tranche is handed back. The three supplier-side reasons are: the plant produced nothing, the supplier is no longer eligible to be paid from the appropriation, or input prices overtook the struck price and the supplier cannot fund the loss. A buyer running out of appropriation is NOT one of them: underfunding your own defence budget does not earn you a free cancellation.

**Terminating for convenience.** Anything else. The supplier accepted, the plant is working, and the minister has decided the order should stop. Three things follow:

- **A break fee.** The supplier is paid its margin on every lot it was ordered to build and now will not. This comes out of the defence appropriation, and it comes out immediately. If the appropriation cannot cover the fee, the termination is refused: a minister does not get to walk away and leave the company holding the bill.
- **The tranche stays spent.** The cancelled lots are NOT returned to the contracting window. Cancelling an order does not create room to award a new one this quarter, to anyone, including yourself.
- **Public disclosure and a political price.** The cancellation goes on the wire with the minister's name on it, and they take a favorability hit that scales with how much of the quarter's procurement the order was. If the minister holds an interest in a different domestic defence supplier, one that competes for the same work, the wire says so and the penalty doubles.

The break fee is always less than what delivering the rest of the order would have cost, so getting out of a contract the country genuinely does not need is still the cheaper option. What it is not is free, and it is no longer invisible.

## The turn spend cap

The window cap limits how much a country can OBLIGATE across a quarter. It does not, by itself, limit how fast an already-obligated contract PAYS OUT. A large committed contract could otherwise be delivered in one or two turns, moving an entire quarter's defence appropriation into one corporation's cash balance in a single tick.

To stop that, deliveries are also throttled per turn:

- Each turn, a country can pay suppliers at most three times its normal per-turn procurement income (its annual defence line's procurement share, divided evenly across the year).
- Within that, one private supplier can be paid at most its capped share of the country total (the same one-third share used for awards); state-owned industry can take the full country cap.
- There is always a one-lot floor: if a country has paid nothing yet this turn, at least one lot goes through even if its price exceeds the strict cap, so a small country's contract is never permanently stuck.

Because the per-turn cap is three times the steady rate and a window is twelve turns, the cap can never reduce what a legitimate buyer spends across a full window; it only prevents a whole quarter's budget landing in one or two turns.

## What this means for you

- If you hold the defence seat, plan contracts against the quarterly tranche, not against however much cash the treasury happens to be holding.
- Awarding to your own corporation is legal but public and costly. Small orders are close to free politically; large ones are not.
- Cancelling a rival's contract is legal too, and it now costs you money, tranche room, and standing. Check the quoted break fee on the cancel button before you confirm it.
- If you supply defence contracts, an order that gets torn up mid-build pays you the margin you were promised on the rest of it. You will be notified, and the reason is on your order book.
- Deliveries on a large contract will spread across several turns even after the contract is signed. That is the spend cap working as designed, not a bug.
- State industry in a command economy can absorb a whole window's tranche where private suppliers cannot; this is intentional, not an oversight.

See also: [Units, Recruitment & Procurement](/wiki/military-units), [Corporations](/wiki/corporations), [Conflicts & the Military System](/wiki/conflicts-overview).
`;
