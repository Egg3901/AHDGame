export const pensionsContent = `# Pensions

Occupational pensions are the second retirement pillar in the game. The state pension (funded out of the national budget) is a separate, always-on system that this doesn't touch. An occupational pension is something a union **bargains for**, alongside wages, and it only exists where a union has actually won one from an employer.

## How a pension gets created

Pension contribution rates are part of a union's [collective bargaining](/wiki/unions) demands, negotiated the same way wage levels are. Either side's offer can propose a rate between **0% and 15%** of the covered wage bill. If mediation is needed, the settled rate is weighted toward the union side by its leverage, the more mandate a union carries into the negotiation, the closer the outcome lands to what it asked for.

If the settled rate is above zero, a **pension scheme** is created, one per union that has ever bargained one. A union that never won a pension has no scheme at all, not an empty one.

## Every turn: contribution, top-up, accrual

Once a scheme exists, three things happen every turn for every active agreement carrying a pension rate, in this order:

**1. Contribution.** The employer pays covered wage bill × bargained rate straight into the scheme's assets. If the employer can't afford it that turn, the payment is simply skipped, not forgiven, and workers still accrue their claim regardless (step 3).

**2. Top-up.** If the scheme's funding ratio (assets divided by liabilities) falls below **90%**, the employer is asked for an extra payment to help close the gap. This is always partial, only **5% of the shortfall per turn**, so a bad quarter can't bankrupt an employer chasing a slow-moving accounting number. A scheme typically takes a couple of game-years to recover from a real deficit, by design.

**3. Accrual.** Workers' claim against the scheme grows by covered wage bill × 8% every turn, no matter what happened in steps 1 and 2. This rate sits deliberately below the maximum contribution rate (15%): a scheme bargained at the ceiling builds a genuine surplus over time, while a scheme with a 0% contribution rate still racks up a liability nobody is funding. That's the honest picture of promising a pension and paying nothing toward it.

## Funding health

| Band | Funding ratio |
| --- | --- |
| Surplus | above 110% |
| Funded | 90% to 110% |
| Deficit | 60% to 90% |
| Critical | below 60% |

Below 90%, the employer owes a top-up every turn until the ratio recovers. Below 60%, the scheme is in serious trouble and benefit cuts (see below) are likely already happening.

## Paying benefits

Union membership isn't tracked person by person, it's an aggregate rate across a sector's workforce. So pension benefits aren't paid to named retirees; they're paid as a flow against the modelled covered workforce as a whole. Roughly **1% of not-yet-retired claims** come into payment each turn, and once in payment, **2% of that stock** is drawn down and paid out every turn. That's a deliberately slow drain: underfunding is meant to be a visible, gradual problem, not a one-turn cliff.

**Benefits are only ever paid from cash on hand, never borrowed.** If a scheme's cash falls short of what's due, every claim in payment takes the **same proportional cut** that turn, there's no basis in the model to pay some pensioners in full and others nothing. The unpaid portion isn't forgiven either; it stays on the books as an outstanding liability, which is exactly why the funding ratio keeps looking bad until the scheme genuinely catches up.

## Investing scheme assets

A scheme with cash on hand can put some of it into index funds (see [Index Funds](/wiki/index-funds)), the same way any other investor does, whenever index funds are enabled. This is optional and never a dependency, every other pension mechanic keeps working purely off cash if index funds are off.

Two limits keep a scheme from over-committing: it always keeps roughly **8 turns' worth of benefit payments** in cash, and it never invests more than **90% of cash** regardless. A scheme prefers a broad index fund from its own country, falling back to a global broad fund; sector-specific funds are never eligible, concentrating a union's pension money in the very sector its members work in is exactly the risk this rule avoids.

## Where you see it

- **Union page:** cash, invested value, total assets, liabilities, benefits currently in payment, funding ratio and band, plus running totals of contributions, top-ups, benefits paid and unpaid.
- **Employer's financial statement:** a "Pensions" line summing this turn's contribution and top-up cost, plus how many of your bargained schemes are currently in deficit. This is a live projection of what the agreement is charging you right now, not a history lookup.

## Constants at a glance

| Constant | Value |
| --- | --- |
| Contribution rate range | 0% to 15% of covered wage bill |
| Liability accrual rate | 8% of covered wage bill per turn |
| Deficit threshold | funding ratio below 90% |
| Critical threshold | funding ratio below 60% |
| Top-up pace | 5% of shortfall per turn |
| Retirement rate | 1% of not-yet-in-payment claims per turn |
| Benefit drawdown rate | 2% of in-payment stock per turn |
| Liquidity buffer | 8 turns of benefits kept in cash |
| Cash investable ceiling | 90% |

See also: [Unions](/wiki/unions), [Labour & Wages](/wiki/labour-and-wages), [Index Funds](/wiki/index-funds), [Corporations](/wiki/corporations)
`;
