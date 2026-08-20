export const interbankLendingContent = `# Interbank Lending

Once you run a chartered bank (see [Private Banking](/wiki/private-banking)), you have two ways to borrow or lend cash outside the deposit market: lending to another bank directly, and drawing against the central bank's margin line. Both exist so a bank running a prop-trading book always has somewhere to get short-term liquidity, and so a bank sitting on spare reserves has somewhere to put them to work.

## Lending to another bank

A **retail or universal** bank can lend spare cash to an **investment or universal** bank, the kind of bank that actually runs a proprietary trading book and needs the funding for it. A bank can't lend to itself, and lender and borrower must share a charter currency.

**How much you can lend.** At most half of your lendable headroom (your deposits minus what reserve requirements force you to hold back), counted across every interbank loan you currently have outstanding, not just the new one. You also need the actual cash sitting in your reserves to cover it.

**Originating a loan.** You set the amount and the interest rate yourself. Cash moves straight from your reserves into the borrower's, and a loan record tracks the principal, outstanding balance, and rate. This is tracked completely separately from your ordinary loan book, an interbank loan you've made doesn't count toward your total loans figure.

**Getting repaid.** The borrower can repay any amount up to what's outstanding at any time; principal moves back to you and the loan's balance shrinks accordingly.

**Interest.** Every turn, the loan accrues interest at your agreed rate (annualized, paid out per turn). If the borrower's cash falls short of what's due, they pay what they can and the shortfall is tracked as arrears rather than being written off immediately. A loan sitting in arrears for **8 straight turns** gets written off entirely: you lose the remaining principal and the borrower's recorded interbank debt drops by the same amount. Chasing a defaulted borrower any further isn't modelled.

**If you're the lender and your own bank fails**, every interbank loan you made is automatically marked defaulted. Your borrowers keep the cash; the loss lands on your bank's estate as a straight write-off. This is treated as one failure, not compounded into a second by trying to claw the money back from a healthy counterparty.

## Central bank margin line

Separately from interbank lending, an investment or universal bank can draw directly against the central bank, collateralized by the mark-to-market value of its own proprietary trading book.

- **Rate:** the country's prime rate plus a fixed spread.
- **Collateral cap:** your total margin debt (including any unpaid interest arrears, which count against the cap too, a bank that can't service the margin loses room rather than quietly borrowing its arrears) can never exceed half the value of your prop book.

Drawing on this line **creates money**: cash appears directly in your reserves and the country's central bank records the increase in money created. Repaying the principal destroys it symmetrically, exactly mirroring how it was created. This mirrors how the central bank's discount window works for the government more broadly.

## Why this exists

Interbank lending and the CB margin line are how the banking system routes liquidity to where it's actually needed without every bank having to hold enough reserves to cover every possible shortfall on its own. A retail bank sitting on excess deposits earns a return by lending them out; a trading-focused bank gets funding it couldn't raise through deposits alone, since it doesn't take retail deposits in the first place.

## What happens to loans a failed bank made

If a bank you were lending money to (as its depositor or counterparty) fails, its charter is revoked and normal turn processing stops touching it, loans it had outstanding as a *lender* don't just evaporate.

- **Before the failed bank's own resolution has closed**, any cash still coming in from its borrowers lands in its own reserves, making the pot available to depositors and other claimants bigger.
- **After resolution has closed** (depositors already made whole through deposit insurance, any residual already paid to the owner), a late-arriving recovery doesn't go to the dead bank or its former owner. It's paid into the deposit insurance fund instead, the insurer stood behind those depositors, so a recovery that arrives after the fact belongs to it rather than becoming a windfall for someone already made whole.

You won't interact with this directly as a player; it just means a bank failure doesn't quietly strand money owed to the system.

See also: [Private Banking](/wiki/private-banking), [Central Banks](/wiki/central-banks), [Corporate Bonds](/wiki/corporate-bonds), [Currency Exchange](/wiki/currency-exchange)
`;
