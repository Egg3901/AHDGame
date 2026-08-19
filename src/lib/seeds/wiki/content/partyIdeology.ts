export const partyIdeologyContent = `# Party Ideology

Every party in A House Divided has an explicit ideology position on a two-dimensional grid. This position drives primary scoring, NPP alignment, and voter appeal. Understanding the ideology system is essential for picking the right party and understanding why some candidates outperform others.

## The two-axis grid

Party ideology is set on two independent axes:

| Axis | Range | Meaning |
| --- | --- | --- |
| Economic | -5 to +5 | -5 = far left (nationalization, high taxes) → +5 = far right (free market, low taxes) |
| Social | -5 to +5 | -5 = progressive (liberal social policy) → +5 = conservative (traditional social policy) |

Your character also has personal policy positions on these same axes. Your character's positions are not required to match your party's, but divergence costs you primary score.

## How ideology affects primaries

Primary scoring compares your character's economic and social positions against the **party's official positions**, and (for state-level races) against the state's own cached ideological lean.

The **live default** splits alignment into two pieces, worth 40 points combined:

\`\`\`
econDiffState = |yourEcon − stateEcon|
socialDiffState = |yourSocial − stateSocial|
alignmentState = max(0, 25 − (econDiffState + socialDiffState) × 1.25)

econDiffParty = |yourEcon − partyEcon|
socialDiffParty = |yourSocial − partySocial|
alignmentParty = max(0, 15 − (econDiffParty + socialDiffParty) × 0.75)

alignment = alignmentState + alignmentParty
\`\`\`

25 points ride on matching the state's lean, 15 on matching the party's official position. Only when the state has no cached lean on record does the game fall back to a single **40-point party-only** formula:

\`\`\`
alignment = max(0, 40 − (econDiffParty + socialDiffParty) × 2.0)
\`\`\`

Either way, the maximum alignment score is 40 points at perfect alignment, and it degrades to 0 well before 20 points of combined distance. Even if a badly-misaligned candidate is otherwise reasonable, they won't win the primary without enormous favorability or influence advantages.

## How ideology affects NPP alignment

NPPs have their own personal positions on the same two axes. When NPPs vote on bills or evaluate Speaker and leadership candidates, they use an **alignment score** to measure how close they are to each option:

\`\`\`
alignmentScore(a, b) = max(0, 100 − |aEcon − bEcon| × 5 − |aSoc − bSoc| × 5)
\`\`\`

An NPP and a candidate at identical positions score 100 (full alignment). Opposite on both axes scores 0. This formula drives NPP bill votes, Speaker votes, and leadership election votes.

NPPs also get a **+80 bonus** for candidates who share their party (country-scoped), and a **+15 bonus** for real player candidates over NPPs. In practice, a player candidate close in ideology who shares the NPP's party will almost always get the NPP's vote.

## How ideology affects voter appeal

In general elections, voter appeal uses the same distance math but runs it through a power curve with an exponent of **1.5**, not a square:

\`\`\`
positionScore = 25 × (positionRaw / 50) ^ 1.5   // plus a small position floor
appeal (per demographic group) = positionScore + reachBonus
\`\`\`

Squaring (exponent 2) was the old legacy curve; it was softened to 1.5 in a 2026-07-09 rebalance because the squared version made ideology overwhelmingly dominant, drowning out favorability, org, and campaigning. At 1.5, small ideological gaps still reduce appeal less than large gaps, but the gap between a close match and a middling one is less punishing than it used to be.

Different demographic groups have different ideological centers. Rural white voters, urban college-educated voters, and minority communities each sit at different points on the grid. Candidates who match their demographics outperform those who don't, regardless of party.

## How party positions are set

Party positions are set at party creation and can be updated by party leadership:
- **Economic position**: set on the party's record
- **Social position**: set on the party's record

Changing party positions affects every ongoing primary score calculation and every NPP alignment calculation immediately. There is no lag. If a party shifts its official position sharply, incumbents close to the old position may suddenly find their primary score dropping.

Built-in parties (Democrat, Republican, etc.) have historically calibrated positions. Custom parties can be placed anywhere on the grid.

## Ideology and the whip

Party whips can override NPP ideology preferences when they issue a directive. An NPP with 80% compliance might vote against their ideology if the state chair whips them. But low-loyalty, high-stubbornness NPPs resist whipping: ideology wins out.

## Related

- [Political Parties](/wiki/political-parties): party overview, positions, and party numbering.
- [Party Membership](/wiki/party-membership): why matching party ideology matters for primaries.
- [NPP Behavior](/wiki/npp-behavior): how NPPs use ideology when voting on bills and leadership.
- [Demographics & Targeting](/wiki/demographics-targeting): how demographic groups' ideological centers affect vote appeal.
`;
