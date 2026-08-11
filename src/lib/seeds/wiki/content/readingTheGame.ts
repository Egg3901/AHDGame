export const readingTheGameContent = `# Reading the Game

A House Divided is a living simulation. Every turn, elections resolve, bills advance, NPPs act, metrics shift. To make good decisions, you need to know how to interpret the data the game is constantly generating. This page is a guide to reading current game state effectively.

## Start with the dashboard

The main dashboard (for US players: \`/dashboard\`) is your primary situational awareness screen. It shows:

- **Current turn and timer**: How long until the next turn fires (hourly). Plan your actions around this.
- **Your character's stats**: Current actions, funds, favorability, political influence.
- **Your current office** (if any): Shows term expiration timing.
- **Active candidacies**: Elections you're entered in and their phase/status.
- **Notifications**: Turn-driven events (election results, bill updates, party actions).

The dashboard refreshes automatically after each turn completes.

---

## Checking national metrics

National metrics are the economic and social health indicators for each country. Find them on the country overview page (e.g., \`/country/us\`).

Key metrics to monitor:

| Metric | What it reflects | Why it matters |
|---|---|---|
| GDP index | Economic output | Affects corporate revenue, bond ratings |
| Inflation | Price level change | Affects purchasing power, central bank policy |
| Healthcare index | Public health quality | Affects demographic approval and electoral appeal |
| Education index | Education system quality | Long-term demographic effects |
| Environment index | Environmental health | Affects certain voter archetype appeal |

Metrics trend slowly: a single policy bill rarely causes dramatic movement. Watch the trend direction over 4 to 8 turns after major legislation passes to see the effect.

The **national approval rating** on the country page reflects the President's (or PM's/Chancellor's) favorability and gives a quick read on political health.

---

## Following active elections

The elections page (\`/country/us/legislature\` for Congress elections; country-specific paths for others) lists all active elections with:

- **Phase** (primary or general) and time remaining
- **Candidates** and their projected standings (from polling, if available)
- **Primary score leaders** (during primary phase)

In the **primary phase:** Look at the registered candidates and their party affiliations. If a player is in the primary, NPPs receive the 0.5× penalty. Running a Quick Poll (2 actions, ₳25k) at any point during the primary shows your projected score vs. the field.

In the **general phase:** Vote totals accumulate each turn. The candidate list shows running vote totals. Final-4-turn weighting means leads can close fast, so don't assume a 15% lead is safe with 3 turns left.

**Key elections to watch:**
- Presidential elections: National stakes, Electoral College math
- Senate elections: Control of the chamber determines legislative agenda
- Governor races: State-level approval and bill-signing power
- Parliamentary majority tracking (UK/DE/JP): Party seat counts determine who becomes PM/Chancellor

---

## Understanding the turn log

Each turn, the game generates a log of everything that happened. You won't see the raw log as a player, but its effects surface as:

**Notifications**: Direct events (your election resolved, your bill passed, you received an endorsement). Check the notification bell regularly.

**Election results**: The elections page updates immediately after turn processing with new standings and any resolved races.

**Metric changes**: State and national metrics update after each turn. If you're tracking a specific metric, check it the turn after a related policy passes.

**Campaign activity history**: Your campaign page shows an activity log with income, action generation, and any auto-downgrade events from each turn.

---

## Monitoring party standings

Party standings matter for both elections and legislation. Monitor via the parties page:

- **Seat counts by chamber**: Which party has the majority?
- **Party org by state**: Is your home-state party org above 70?
- **Active membership**: How many players vs. NPPs?

In parliamentary countries (UK, DE, JP), track whether any party is approaching the majority threshold (UK: 326, DE: 316, JP: 233). A government formation event happens automatically once a party/coalition crosses the threshold after an election.

For US presidential politics, track **party org in swing states** specifically: a party with 30% org in a swing state is giving away 20% of their vote total there.

---

## Checking NPP ideologies

NPPs vote on bills, enter elections, and fill legislative seats. Knowing the ideology distribution of NPPs in your target chamber helps predict:

- Which bills can pass with NPP support
- Which primaries have NPP competition and whether you'll beat the 0.5× penalty threshold
- Which party's NPPs are vulnerable to player challengers

NPP profiles are visible on the legislators page for each chamber. Look at their econ/social position to gauge how they'll vote on ideologically loaded legislation.

---

## Using poll data to make decisions

Polling is the most direct diagnostic tool for electoral decision-making:

**Quick Poll (2 actions, ₳25k):** Shows your overall appeal score and 5 strongest/weakest demographic groups. Use this:
- Before declaring candidacy (to decide if the race is winnable)
- After a major policy change or ad campaign (to measure impact)
- Early in campaign season (to identify groups to canvass)

**Full Demographic Poll (5 actions, ₳75k):** Shows your appeal across all demographic groups broken down by archetype. Use this:
- When you need to allocate a large ad budget
- When a race is close and you need to find pockets of untapped support
- Before the final 4-turn campaign season sprint

Poll projections use the same math as actual vote accumulation: they're accurate reflections of where you stand, not approximations.

---

## Reading party org and its impact

Party org is often invisible until something breaks. Check it:

1. Go to your party's state org page
2. Look at the org value (0 to 100) for your home state and target states
3. A value below 50 means every candidate in your party is getting fewer than 0.75× their base vote total

If org is low, the party chair can invest in org improvement. As a party member, you can lobby the chair to prioritize your target states. If you are the chair, prioritize org in states with the most competitive general elections.

---

## Reading the economic picture

If you're involved in the economy (corporations, bonds, forex), check:

**Corporate financials**: Revenue per sector, net income, quarterly changes. Rising sectors signal effective economic policy; falling sectors may need intervention.

**Bond yields**: The bond market page shows current yields by country. A widening spread between countries signals relative credit risk or interest rate divergence, useful for forex positioning.

**Central bank rates**: The central bank page for each country shows the current prime rate and rate history. Rate changes affect corporate borrowing costs and exchange rates.

**Wealth rankings**: The investor ranking page shows who is accumulating capital fastest. If you're falling behind, your corporate or investment strategy needs adjustment.

---

## Related

- [Advanced Strategy](/wiki/advanced-strategy): Using game data to inform strategic decisions.
- [Polling](/wiki/polling): Quick Poll vs Full Poll details.
- [Reference: Turn Order](/wiki/reference-turn-order): What happens each turn.
- [Reference: Formulas](/wiki/reference-formulas): All the math behind what you're reading.
- [Endgame Goals](/wiki/endgame-goals): What to aim for once you understand the game.
`;
