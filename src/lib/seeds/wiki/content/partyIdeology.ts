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

Primary scoring compares your character's economic and social positions against the **party's official positions**. The alignment component of your primary score is:

\`\`\`
econDiff = |yourEcon − partyEcon|
socialDiff = |yourSocial − partySocial|
alignment = max(0, 40 − (econDiff + socialDiff) × 2.0)
\`\`\`

This gives a maximum alignment score of **40 points** when you're at the party's exact position. Each point of Manhattan distance (econ + social combined) costs you **2 alignment points**. A candidate 10 points away from the party center scores 0 alignment. Even if they're ideologically reasonable, they won't win the primary without enormous favorability or influence advantages.

## How ideology affects NPP alignment

NPPs have their own personal positions on the same two axes. When NPPs vote on bills or evaluate Speaker and leadership candidates, they use an **alignment score** to measure how close they are to each option:

\`\`\`
alignmentScore(a, b) = max(0, 100 − |aEcon − bEcon| × 5 − |aSoc − bSoc| × 5)
\`\`\`

An NPP and a candidate at identical positions score 100 (full alignment). Opposite on both axes scores 0. This formula drives NPP bill votes, Speaker votes, and leadership election votes.

NPPs also get a **+80 bonus** for candidates who share their party (country-scoped), and a **+15 bonus** for real player candidates over NPPs. In practice, a player candidate close in ideology who shares the NPP's party will almost always get the NPP's vote.

## How ideology affects voter appeal

In general elections, voter appeal uses the same distance math but in a different formula:

\`\`\`
appeal (per demographic group) = (50 − |econDiff| × 5 − |socialDiff| × 5)² / 100 + reachBonus
\`\`\`

This is **quadratic**: small ideological gaps reduce appeal much less than large gaps. A candidate 1 point away from a demographic group's center loses only about 10% of max appeal. A candidate 3 points away loses nearly 50%. The quadratic formula rewards ideological proximity but doesn't punish modest deviation harshly.

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
