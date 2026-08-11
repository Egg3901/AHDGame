export const votingAndWhipsContent = `# Voting & whips

Every legislator, player or NPP, votes on every bill that passes through their chamber. This page covers how votes work, how whip directives influence them, and how party discipline affects your NPPs.

## Casting your vote

While a bill is in your chamber and its status is \`active\` or \`active_other\`, you can vote from the bill's detail page at \`/congress/bills/[id]\`.

**Options:** For, Against, or Abstain.

**Re-voting:** You can change your vote any time while the 24-hour voting window is still open. Only your most recent vote counts.

**Eligibility:** Only members of the current voting chamber can vote. If a bill is in the Senate, House members cannot vote, and vice versa.

## What determines the outcome

Bills pass by simple majority: For votes must exceed Against votes. Abstentions are neutral: they count toward participation records but do not help either side.

- **No quorum requirement** currently. A bill can pass with just one For vote if no one else votes Against.

## How NPPs vote

Non-Player Politicians vote automatically using a **cross-pressure model**. Every NPP's vote is the deterministic sum of four signed forces, each clamped to [-100, +100]. Positive pulls FOR, negative pulls AGAINST.

| Force | What it measures |
| --- | --- |
| **Ideology** | How well the bill's policy direction aligns with the NPP's recorded stance on that issue, plus a small economic-tint bonus. |
| **Whip** | Party whip directive, gated by the NPP's loyalty and stubbornness. |
| **District** | How the NPP's home-state demographics feel about the bill's selected policy option. |
| **Donors** | Whether the NPP's donor base and stance align with the bill's direction. |

**Verdict rule:**

- Sum > +5 → **For**
- Sum < -5 → **Against**
- Otherwise → **Abstain**

Only near-tied cross-pressure produces abstain. Most NPPs vote decisively one way or the other.

**Multi-seat blocs:** An NPP holding multiple seats contributes their full \`seatsHeld\` weight to the tally. A bloc of 7 seats voting For adds 7 to the For count.

**Catch-up:** Every turn, the system checks for NPPs that haven't voted yet on open bills and auto-assigns their vote. NPPs that gained seats after a bill opened will still vote before the bill closes.

## Whip directives

Party whips can issue a directive telling members how to vote on a specific bill. Whip directives are set on the Congress or Parliament page by the party's designated whip.

### How directives affect NPP votes

**Hard whips** trigger an immediate hidden roll when issued:

- The NPP has a base compliance chance of 55%, plus a loyalty bonus and a mode bonus (hard = +15, soft = +6), minus a stubbornness penalty.
- Final chance is clamped between 40% and 95%.
- If the roll succeeds, the NPP votes exactly as directed.
- If the roll fails, the vote falls back to the deterministic **cross-pressure verdict** (ideology + district + donors).

**Soft whips** are advisory only. They do not immediately cast votes. Instead, the directive persists so that future autonomous NPP bill votes (including catch-up votes each turn) can see the whip as part of their cross-pressure calculation. Soft whips are weaker in magnitude than hard whips.

**Leadership votes** (leadership and speaker elections, cabinet nominations, PM appointment votes, and confidence/no-confidence motions) are binding under a **hard** whip: same-party NPPs always fall in line and cannot defy the leadership directive. Only bill whips allow defiance. Under a **soft** whip these votes still use the hidden loyalty/stubbornness roll, and a resisting NPP falls back to a same-party / same-state heuristic.

### Whipping player members

Whip directives don't force player members to vote any particular way: players always retain full choice. However, breaking from the whip when you're in leadership can affect your standing with the party.

## Party discipline

Party discipline in A House Divided is shaped by whip mechanics and NPP personality traits:

1. **Whip directives** guide NPPs and signal players.
2. **NPP loyalty and stubbornness** determine how reliably the bloc follows the whip. High-loyalty, low-stubbornness NPPs usually comply; stubborn NPPs are more likely to resist and fall back to their own cross-pressure verdict.

There is no direct penalty for a player voting against their party's whip. The social and political consequences play out through favorability dynamics and leadership trust, not through automatic stat deductions.

## Abstentions and strategic voting

Abstaining is sometimes the optimal play:

- **Avoid a bad vote record.** Abstaining on a bill you oppose but can't afford to visibly fight leaves your record cleaner than a For vote you'd have to explain.
- **Don't feed the opposition.** If a bill is going to fail anyway, voting Against adds nothing strategically and exposes your position.
- **Protect swing-district NPPs.** If your party's NPP bloc holds marginal seats, consider a permissive directive (abstain-allowed) rather than forcing a hard For/Against that could cost them seats next election.

## Viewing vote records

Each bill's detail page shows live For / Against / Abstain percentages for both chambers. Individual vote choices are not shown publicly, only aggregate totals. Your own vote is always visible to you.

## Related pages

- [Bills & Legislation](/wiki/bills-legislation): full bill lifecycle from proposal to signature
- [Congress Leadership](/wiki/congress-leadership): who controls the whip apparatus
- [Committees](/wiki/committees): committee-stage influence on bills (future mechanic)
`;
