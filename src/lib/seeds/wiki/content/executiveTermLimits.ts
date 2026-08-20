export const executiveTermLimitsContent = `# Executive Term Limits

Some countries cap how many terms a character can hold the top executive office. This page covers how the cap is configured, how it's counted, and what it stops you from doing once you hit it.

## Which countries have a limit

Term limits are configured per country, not a universal rule. A country with no limit configured has no cap at all, you can run for that office as many times as you can win it.

| Country | Office | Term cap | Blocks running-mate picks too |
| --- | --- | --- | --- |
| United States | President | 2 terms | Yes |
| Ireland | Uachtarán (President) | 2 terms | No |

Other countries that carry a Presidency-style office with a term cap follow the same 2-term pattern unless their country page says otherwise.

**"Blocks running-mate picks"** is the important distinction. In the US, a term-limited character can't just get elected VP instead and skip the line, the 22nd Amendment reading used here also disqualifies them from being selected as a running mate. In Ireland, the limit only blocks re-election to the Uachtarán seat itself, a two-term former President isn't barred from other offices.

## How terms served are counted

Your terms-served count for a given country is the higher of two numbers:

1. **A running counter** on your character, incremented each time you start a term in that office.
2. **Your career history**, scanned for every time you were elected or appointed to that office in that country.

Taking the higher of the two means a character with an older career history but no counter yet still gets counted accurately, and a counter that's already ticked up never gets undercut by an incomplete history scan. You can't get a fresh two terms by having your history quietly under-report.

The count is tracked **per country**. If your character has some other route into a foreign executive office, terms served there don't count against your term limit at home, and vice versa.

## What happens when you hit the cap

Once your terms served reaches the country's cap, filing for that office again in that country is blocked at candidacy. For the US specifically, being picked as someone else's running mate is blocked too, since the office chain (VP inherits/succeeds to President) would otherwise be an end-run around the 22nd Amendment reading this game uses.

You can still run for every other office you're eligible for. A term-limited US President can run for Senate, Governor, or anything else that isn't gated by this specific limit. The block is scoped to the one office and the one country, nothing else.

## Why it matters for campaign planning

If you're building a multi-term political career, check your target country's term limit before you bank a strategy on running a character for a third term. Two-term US Presidents in particular need a succession plan: their running mate can't be them again, and if your world runs [Live Election Results](/wiki/live-election-results) election nights or your race ends up going to a [Contingent Election](/wiki/contingent-election), the candidate list itself is filtered by eligibility before any votes get cast, a term-limited character simply won't appear on the ballot to begin with.
`;
