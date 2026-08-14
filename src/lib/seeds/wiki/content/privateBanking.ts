export const privateBankingContent = `# Private Banking

Finance corporations can charter a private bank when the world flag is on. A bank takes deposits, lends against a reserve requirement, posts rates inside a corridor set by the central bank, and can fail. This guide covers charters, rates, deposits, loans, runs, insurance, and proprietary trading.

## Charters and the separation law

A corporation that owns at least one financial sector may issue exactly one bank charter. Chartering posts minimum capital from the corporation treasury (scaled by era and currency) and is automatic once the objective gates pass: financial sector ownership, legal charter type, matching treasury currency, and enough cash.

Charter types:

| Type | Deposits | Lending book | Prop trading |
| --- | --- | --- | --- |
| Retail | Yes | Yes | No |
| Investment | No | No | Yes |
| Universal | Yes | Yes | Yes |

Most nations start with a **banking separation** law that allows retail or investment, but not universal. A bill can switch the country to universal charters. Command economies do not offer private bank charters.

The central bank chair (or an admin) can revoke a charter. Posted capital is refunded only when the bank has no deposits left.

## Capacity allocation (no double count)

A chartered financial sector's capacity does one job or the other:

- **Branch share** runs the deposit network and sets the deposit ceiling.
- **Commodity share** produces financial services for the commodity market.

The CEO sets the branch share between 10% and 90% (default 50%). Without this split, the same capacity would earn twice and chartering would dominate every other use of a financial sector.

## Rates and the corridor

Retail and universal banks set **deposit** and **lending** offsets against the central bank prime rate. Offsets must sit inside the Regulation Q style corridor for that country and era. Historical worlds often cap deposit rates below prime and floor lending rates above it. Investment charters do not set deposit or lending offsets.

Effective rates are floored at small positive minima so a zero or negative quote cannot clear the market for free.

## Deposits and the insured cap

Banks attract NPC household deposits from the central bank's external broad money pool, competing on deposit rate versus the central bank savings APY. Players can move their savings pointer to a private bank (one holder per currency).

Total deposits (players + NPC) are capped by the bank's **deposit ceiling**, derived from financial-sector capacity allocated to branches. NPC inflow stops at the ceiling; outflow is always allowed. Player balances already above the ceiling are grandfathered, but the bank cannot accept new player deposits that would push further over.

Each currency has a deposit insurance fund with an insured cap (era and FX anchored). Balances up to the cap are protected on failure; amounts above the cap take a haircut.

## Loans

Deposit taking banks lend:

- An **NPC bulk book** sized off regional GDP and the lending rate (higher rates mean less volume and a worse credit mix).
- Named **player** loans to characters and corporations. Character loans credit **personal cash** in the loan currency immediately (not savings). Corporation loans credit that company's **liquid capital**. Proceeds never appear in the banking hub savings list; open loans are listed under Your accounts, with the destination named.

Reserve requirements set by the central bank limit how much of the deposit base can be lent. Banks may blacklist corporations, characters, and every constituent of a named index fund.

## Runs and the warning badge

Each solvency pass scores the bank on reserves, capital, and loan losses. The score maps to a published warning band:

| Band | Meaning |
| --- | --- |
| Green | Healthy |
| Amber | Stress; players see the warning one turn before NPC flight intensifies |
| Red | Failure path |

NPC deposits flee in proportion to low confidence. A failed bank can raise panic at peer banks in the same currency when contagion is enabled. Contagion and prop trading each have independent kill switches under the master private banking flag.

## Insurance

Chartered banks pay a per turn premium on insured deposits, risk weighted by how thin their reserves are versus the required ratio. Premiums fund the national insurance pool. Payouts come from the fund first; a drained fund is covered by the Treasury and lands in the federal budget.

## Prop trading

Investment and universal charters (when the prop trading kill switch is on) run a proprietary book in equities, bonds, index units, and forex. Positions are marked each solvency turn. Funding comes from:

- The **interbank** market: retail banks may lend part of their non reserved deposits to investment banks at a negotiated rate.
- A **central bank margin** line against posted collateral at prime plus a spread.

Forced liquidation feeds the confidence score. Flag off freezes prop and interbank actions without unwinding existing books.

## Capital requirements and supervision

The warning badge and the run mechanic are the **market** disciplining a bank after the fact. Supervision is the regulator disciplining it before.

Your bank's **capital ratio** is its capital — posted capital plus the corporation's own free cash — divided by its risk assets, meaning the loan book plus any proprietary book.

| Test | Requirement | What failing costs you |
| --- | --- | --- |
| Minimum | 8% capital ratio | Recapitalize within 12 turns or the charter is revoked |
| Stress scenario | 6% after a 15% loss on the book | No distributions and no new proprietary positions until fixed |

**The stress scenario is published and fixed.** The supervisor assumes 15% of the book defaults at once, absorbed by capital. There is no dice roll: you can compute your own result before the regulator does, which makes the requirement something to plan against rather than a periodic surprise.

**Two thresholds, not one.** A single line would make supervision binary — fine one turn, dead the next. Failing the *stress* test does not endanger your bank and does not touch your charter; what you lose is the right to pay yourself. A bank that cannot survive a downturn on paper does not get to distribute in the meantime. Falling below the *minimum* is the serious one, and it starts a clock.

**Recapitalizing** moves cash from the corporation into the bank's posted capital. It is the same balance sheet, but a different claim: posted capital absorbs losses before depositors do, and cannot be spent on anything else. The interface tells you the exact amount that cures the breach.

**Missing the deadline revokes the charter — it does not fail the bank.** Those are different outcomes and the difference matters to your depositors. A failure means the bank ran out of money to pay them, and they take a haircut above the insured cap. A revocation means the regulator pulled the licence of a bank that would not recapitalize; the book is unwound in an orderly way and posted capital is returned. Depositors should not be punished because an owner ignored a deadline.

A bank that cures a breach and later breaches again gets a fresh 12 turns. The clock tracks the current breach, not your history.

## The discount window

When a bank cannot fund itself, the central bank will lend to it. That is what a lender of last resort is for, and until now no such facility existed: a deposit-taking bank facing a run could sell assets into a falling market, or it could fail.

The window is open to **retail and universal** charters only. An investment bank has no depositors to protect; its facility is the collateralized margin line.

| | |
| --- | --- |
| Rate | Prime + 3 percentage points |
| Limit | 25% of the deposit base |
| Cost beyond the rate | A confidence penalty while the debt is outstanding |

**The stigma is the mechanic.** A cheap facility with no consequence is free money, and every bank would sit on it permanently. Borrowing from the lender of last resort is a signal: the market reads it as a bank nobody else would lend to. So drawing lowers your confidence score, which feeds the same run mechanic the window is helping you survive.

That is the real trade-off. The window funds you through a run and makes the run marginally more likely. It is a decision, not an obvious yes.

The penalty scales with how much of your **limit** you have used, not the raw amount — a small bank at its ceiling is in more trouble than a large one borrowing the same sum against a much bigger book. It decays as you repay, so a bank that uses the window briefly and clears it is not marked forever.

**The limit is deliberately low.** The window is a bridge across a liquidity shortfall, not a funding source. A bank that needs more than a quarter of its deposit base is not illiquid, it is insolvent, and resolution is the right answer rather than a bigger loan.

Interest is serviced each banking turn on the same terms as the margin line: paid to the central bank, and any shortfall accrues as arrears against your headroom, so a bank that cannot service the facility loses access rather than borrowing its unpaid interest indefinitely.

Drawing creates money at the central bank; repaying destroys it. Both legs are ledgered.

## Related

- [Central Banks](/wiki/central-banks): prime rate, reserves, and money supply.
- [Savings & Interest](/wiki/savings-interest): central bank savings APY and accrual.
- [Line of Credit](/wiki/line-of-credit): character borrowing from the central bank.
- [Stock Market](/wiki/stock-market): equities the prop book can hold.
- [Index Funds](/wiki/index-funds): fund units and blacklist constituents.
- [Corporations](/wiki/corporations): founding and running financial sectors.
`;
