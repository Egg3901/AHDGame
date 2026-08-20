export const generalElectionsContent = `# General Elections

The general phase is the real contest. Primary nominees from every party compete for the seat (or seats). **Votes accumulate over the entire general window**, not in a single tally, and the final 4 turns are weighted heaviest. Sustained, well-timed campaigning wins.

For the overall election structure see [Election Mechanics](/wiki/election-mechanics). For primary-phase rules see [Primaries](/wiki/primaries). This page focuses on what happens between the end of the primary and resolution.

## The vote pool

Each election has a total vote pool derived from the state's **demographics**: the census is combined into voter segments, each with a size (share of total), a turnout rate, and policy leans on the economic and social axes.

Per-turn allocation of the pool:

| Turn phase | Share of pool | Per-turn weight |
| --- | --- | --- |
| Early turns | 50% | Spread evenly across the early band |
| Ramp (8 turns before election day) | 20% | Spread evenly across the ramp band |
| Election day (final 4 turns) | 30% | \`0.3 × pool / 4\` |

The final 4 turns are a sharp closing spike: they carry 30% of the pool on their own, well above their share of the turn count, and each one is heavier than any ramp or early turn.

**Implication:** your stats at the moment of each turn's vote snapshot matter. A dip in Favorability or a stale Political Influence on the last day can cost you the race even if you dominated the first three-quarters.

## The total appeal pipeline

General elections run on the **swing-flow model** by default, not the flat group-level split used in primaries and polls. Swing-flow starts from the same per-group appeal pipeline below, then layers presidential/gubernatorial **coattails**, a **median-voter** policy-distance reference, **persuasion drivers** (candidate support, policy distance, money, incumbency), and **party-tenure fatigue** on top, see [Formula Deep-Dive](/wiki/formula-deep-dive) for the driver math. The base pipeline:

Each turn, for each candidate, for each demographic group:

1. **Reach**: a sqrt curve on influence, capped at 1.0 once influence reaches 100. State races use Political Influence (already clamped to 100), presidential generals use National Political Influence (also saturates at 1.0, no celebrity bonus above 100).
2. **Appeal**: a power-curve position score (exponent 1.5, how close the candidate's positions are to the group's), plus a small floor, plus a directional bonus for candidates seen as tribally "us," plus, for presidential races only, an influence term (state races keep influence out of appeal, reach-only). Per-group calculation using the group's lean. Position alone maxes at ~25.5, direction bonus up to 10 (5 per axis), influence term up to 12.5 at influence=100 (presidential only).
3. **Approval scalar**: \`(favorability / 100) ^ 0.8\`. 0% approval = 0 votes. The exponent softens the curve compared to a straight percentage, so mid-favorability candidates lose less than a linear scalar would suggest.
4. **Party Org as normalized state share**: each party's organization score divided by the state's total organization. Range \`[0, 1]\`. A party with 60 Org in a state where the total is 100 gets a 0.6 multiplier on its weight; a party not present in the state gets 0 (no votes from that party's candidates). When the state has no Org data at all (test fixtures, unbootstrapped seeds) every candidate falls back to a neutral \`1×\` so the game doesn't zero the whole field.
5. **Reg resistance**: \`1 + 0.3 × (Reg / 100)\`. Range \`1.0×-1.3×\`. Higher own-Reg makes the party harder to peel away through persuasion. Independents and parties without a registration entry get neutral 1.0×. Reg data is bootstrap-deferred to a later phase, so most rows currently degrade to neutral.
6. **Support mood**: \`0.6 + 0.8 × (support / 100)\`. Range \`0.6×-1.4×\` with neutral 1.0× at support=50. Captures short-term candidate mood / momentum (debate performance, scandals, endorsements). New candidates without a stored support value default to 1.0×.
7. **Infamy scalar**: \`1 − 0.05 × (infamy/100)\`. Player characters lose up to 5% of their per-group weight at infamy=100. NPPs don't have infamy and aren't affected.
8. **Party strength modifier**: applied to the full turn pool, scaled by state government approval and office strength (Gov 1.0, House 0.9, Senate 0.8, State Senate 0.85).
9. **Group-level allocation**: each group contributes to the turn pool proportional to its size and turnout. Within each group, candidates split by their relative combined score across appeal, reach, approval, org share, reg resistance, support mood, and the infamy scalar.
10. **Votes summed** across groups. That's the candidate's turn vote total.

The org-share, reg-resistance, and support-mood factors are general-election-only. Primary elections are intra-party, so Org is applied as a uniform neutral \`1×\` (every candidate of a single party shares the same Org, which would cancel out of the within-party split anyway).

## FPTP spoiler effect

In FPTP states (the default), third-party candidates bleed votes from their ideologically nearest major party:

- \`4% x third-party's group-level votes\` moves from the nearest major-party candidate to the third party.
- "Nearest" = Manhattan distance on economic/social axes.
- Major parties are region-scoped: Democrat/Republican in the US, Labour/Conservative in England, SNP/Labour in Scotland, CDU/SPD in Germany, LDP/CDP in Japan.

**Consequences:**

- A strong Green candidate costs the Democrat votes; a strong Libertarian costs the Republican votes.
- Third parties rarely win under FPTP: they spoil the nearest major party into losing.
- Major-party candidates should treat viable third parties as existential threats in close races.

## RCV states

If a state has passed legislation switching to **Ranked Choice Voting**, the FPTP spoiler adjustment doesn't apply. Third parties compete on level footing. This is the strategic payoff for third-party legislative action.

## Multi-seat races

US House, US State Senate, UK Commons regions, DE Bundestag constituencies, and JP Shūgiin use proportional allocation:

- **Largest-remainder method** converts vote shares to seat shares.
- **Minimum threshold:** 20% of votes for US House and UK Commons; **10%** for US State Senate and Regional Council races, which run in larger districts where more parties split the vote.
- **2-seat special case (House):** winner takes both unless the runner-up reaches the threshold.
- **Seats estimate** updates each turn as votes accumulate.

If you're running for a 4-seat region and your party projects to 42% of the vote, you expect ~2 seats. If you're projected at 17% and another party is at 25%, you likely get 0 and they get all.

## Candidate strategy by phase

### Opening (turns 1 to ~25% of general)

Establish a base:

- Campaign **heavily in-state** to push Political Influence above 60 and hold it.
- Ads to lift Favorability to 65-70. Above 70 diminishing returns bite.
- Set up campaign upgrades (Ground Game, Media Spending, Opposition Research); see [Campaign Strategy](/wiki/campaign-strategy) and [Campaign Manager](/wiki/campaign-manager).

### Middle (middle 50%)

Consolidate:

- Maintain PI at 60+ through steady Campaign actions.
- Sustain Favorability via periodic ads.
- Commission a Full Demographic Poll (₳75k, 6 actions) to identify weak groups.
- Target weak groups with ads and canvassing.
- Watch opponent damage: if your Favorability drops 5+ points in a span, they're running Opposition Research or attacking. Counter with more ads or your own attacks.

### Final sprint (last 4 turns)

Peak everything:

- **Last-minute Campaign actions** to peak Political Influence on the final snapshot.
- **Last-minute ads** to peak Favorability immediately before each weighted turn.
- **Canvassing becomes 2× effective** in the final 4 turns (campaign season multiplier applies to the demographic-turnout canvassing action).
- **Media Spending and Opposition Research upgrade effects double** in the final 4 turns (passive campaign bonuses).
- **Log in hourly** if the race is close. A 2% Favorability dip at turn 141 of 144 can cost you the seat.

## What not to do

- **Don't burn money on ads at Favorability 80+.** Returns are severely diminished.
- **Don't sit on PI and hope decay is slow.** It's not. You'll lose 15% over 20 turns, about the length of a closing sprint.
- **Don't attack everyone.** Infamy accumulates, your own Favorability drains, and attacks cost 2 Infamy each **even on success**. Attack sparingly against high-Favorability opponents only.
- **Don't forget out-of-state costs.** If you're running in State A and also campaigning to help an ally in State B, State B costs 1.25× (neighbour) or 1.5× (non-neighbour) actions-per-effect.
- **Don't withdraw to "save resources" unless you're pivoting.** Withdrawn candidacies cannot be re-entered; your PI and Favorability carry into the next cycle either way.

## Resolution

When the general window closes:

1. The final-turn vote snapshot is captured.
2. Winners are declared.
3. Single-seat races: highest vote total wins.
4. Multi-seat races: largest-remainder allocation; 20% threshold applied.
5. Winners take office. Office action and fund bonuses kick in next turn.
6. Losers' campaign documents persist for historical records but the candidacy is marked resolved.
7. News post fires with results.

For presidential races, Electoral College resolution runs instead:

- Per-state vote totals sum to Electoral Votes per state (ME and NE split by congressional district).
- 270 EV to win.
- 269-269 tie: deterministic coin flip (hash of election ID + candidate IDs).

## Running mates (presidential)

After the primary, each presidential nominee selects a running mate (VP):

- Must be a valid character; cannot be the current President, cannot be the nominee themselves.
- If confirmed, the VP takes office alongside the President on win.
- **VP has +2 actions/turn and ₳25k/turn fund bonus.**

You can change your running mate any time before the election resolves, and clear it entirely if you want to run without one.

## Related

- [Election Mechanics](/wiki/election-mechanics): Overall framework.
- [Primaries](/wiki/primaries): What got you here.
- [Campaign Strategy](/wiki/campaign-strategy): Upgrades, fundraising, fog of war.
- [Primary vs General Tactics](/wiki/primary-general-tactics): Pivoting from primary playbook to general.
- [Canvassing](/wiki/canvassing): Turnout boosting per demographic.
- [Fundraising & Ads](/wiki/fundraising-ads): Money flow during a general.
- [Demographics & Targeting](/wiki/demographics-targeting): Group composition and appeal.
- [Formula Deep-Dive](/wiki/formula-deep-dive): Full math with derivations.
`;
