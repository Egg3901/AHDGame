export const imfSovereignFacilityContent = `# IMF Sovereign Facility

This is the "bailout" resolution path for a country in a full sovereign debt crisis, when its bonds have failed to sell repeatedly and its executive has to choose how to resolve it. It's the country-level counterpart to the [corporate IMF bailout](/wiki/imf): same lender, same style of amortizing loan capped against income, but the borrower here is the country's national budget rather than a single corporation. See [Sovereign Default](/wiki/sovereign-default) for how a country ends up facing this choice in the first place.

## When it's on the table

A country enters crisis after three consecutive bond auctions fail to attract enough demand. From there, the executive has a window to choose one of four resolution paths:

| Resolution path | Direct GDP penalty | Ongoing conditions? |
| --- | --- | --- |
| Repudiate | −12% | No |
| Restructure | −6% | No (one-time haircut) |
| **Bailout (this facility)** | **−2%** | **Yes: income capture, 240-turn term** |
| Monetize | No flat GDP hit | Inflation shock; unavailable at 8% inflation or above |

Bailout has a smaller flat GDP hit than repudiate or restructure. Monetize has no flat GDP hit, but substitutes an inflation shock and can be unavailable when inflation is already high. The bailout's continuing cost is a slice of the country's revenue for a long time afterward.

## How the loan is sized

The facility consolidates two things into a single loan: the face value of any bonds coming due in the next 12 turns (so the country doesn't have to try selling them into a market that just rejected it three times running), plus the country's projected annual deficit. A country running a genuine surplus can still take a bailout, but the loan is only sized to its rollover need in that case.

- **Interest rate:** a fixed **6% annual**, not risk-adjusted to the country's situation.
- **Term:** amortized over **240 turns**.
- **Income capture:** the IMF takes a share of the country's per-turn revenue as repayment, defaulting to **20%**, but the country's own IMF board can nudge that down to as little as 10% or up to 30% during the override window (see below).

## How repayment works, turn by turn

Every turn, the facility calculates a level annuity payment on the outstanding balance, exactly like a normal amortizing loan. But it's capped: the country never pays more than its income-capture fraction of that turn's revenue.

If the cap binds and doesn't cover even the interest due, the shortfall doesn't vanish, it gets **capitalized onto the principal**, and the amortization clock doesn't advance that turn. The loan grows and the country buys itself more time, but it doesn't buy down the balance. Once the principal is fully paid off, the facility closes automatically.

Note that this only credits the IMF; it does not separately deduct the payment from the country's own budget metrics as spending. Read your national budget's revenue figures with that in mind.

## The IMF board can intervene

For **12 turns** after a bailout is granted, any character who holds a share in the IMF Corp (an "IMF board member") gets one shot at influencing the terms:

- **Modify terms:** nudge the interest rate by up to 2 percentage points, or the income-capture fraction by up to 10 percentage points, in either direction.
- **Endorse or criticize:** make a public statement that shifts cross-country trust slightly, without touching the loan terms.
- **No action:** let the window close untouched.

Only one board member can act, and only once, per bailout. This is your chance to soften (or harden) a bailout's terms if you have a stake in the IMF Corp and get there first.

## Recovering afterward

Taking the bailout puts a country into a recovery state. Full recovery needs a minimum of **48 turns** plus a **5-turn streak of fiscal discipline**, rechecked periodically. The country's page shows recovery progress and whether the facility is still active, though the fine print (principal, rate, capture fraction) only appears on the IMF overview screen, not the country page itself.

## How this differs from the corporate bailout

| | Sovereign facility | Corporate bailout |
| --- | --- | --- |
| Who owes the money | The country's national budget | A single corporation |
| What triggers it | Executive choice during a sovereign crisis | Administrative restructuring of a distressed corp |
| Interest rate | Fixed 6% | Set per case |
| Term | 240 turns | Set at bailout time |
| Payment cap | 10-30% of per-turn revenue | 45% of per-turn corporate income |
| Ownership dilution | None | IMF takes an equity stake |
| Oversight | 12-turn IMF board override window | None |

See also: [Sovereign Default](/wiki/sovereign-default), [Corporate IMF Restructuring](/wiki/imf), [Sovereign Bonds](/wiki/sovereign-bonds), [National Budget](/wiki/national-budget), [Central Banks](/wiki/central-banks)
`;
