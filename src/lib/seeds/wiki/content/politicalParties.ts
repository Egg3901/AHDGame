export const politicalPartiesContent = `# Political parties

Parties are the central political structures of A House Divided. Everything meaningful, including elections, legislation, coalitions, and parliament formations, flows through party membership. If you want to do more than run as an independent, you need a party.

## What a party is

A political party is a country-scoped organization with its own name, abbreviation, color, treasury, and ideology position on a two-axis grid (economic left-right, social liberal-conservative). Parties hold seats, run candidates in primaries, and accumulate resources that leaders can spend on collective actions.

Each party also has a per-state footprint: **state party organizations** track regional membership, organization score, treasury, and leadership separately from the national party. What happens in Texas Democratic circles is distinct from what happens nationally.

## The two-axis ideology system

Party ideology lives on two axes:

| Axis | Left/Liberal end | Right/Conservative end |
| --- | --- | --- |
| Economic | -5 (far left) | +5 (far right) |
| Social | -5 (progressive) | +5 (conservative) |

The party's official position on these axes directly affects:
- Which NPPs align with the party (ideology proximity)
- Which voter demographics the party appeals to
- How your character's primary score is calculated (party alignment component)

## Party IDs and URLs

Each party has a short ID number used in its URL, like \`/parties/1?country=US\`. **This ID is only unique within a country.** The US Democratic Party and the UK Labour Party might both be party number 1, so country context is always required when looking up a party.

URLs always include a country parameter: \`/parties?country=UK\` lists UK parties, and party links always carry the country flag.

## Party pages

Navigate to \`/parties\` and select a country to browse all parties. Each party page shows:

- **Overview**: ideology position, seat counts by office type, member roster
- **Leadership**: current chair, vice chair, and treasurer with their term status
- **Organization**: per-state org scores and budget allocations
- **Treasury**: national treasury balance and tax rate settings

## Built-in vs. custom parties

**Built-in parties** (Democrat, Republican, Labour, Conservative, and their equivalents by country) are pre-configured with party colors, historical positions, and seeded membership. They cannot be deleted, and they don't go through the charter system.

**Custom parties** are created via a **Party Charter**, a founding agreement signed by **3 human founders**. One player drafts the charter (party name, abbreviation, the two-axis economic/social platform, and the three founders), and the party only materializes once all three founders have co-signed. The two co-founders must live in the proposer's home state or a state adjacent to it, and any replacement founder must satisfy the same rule relative to the anchor founder. Any founder can reject during the signing window, which opens a founder-replacement window with the same deadline: whichever is longer of 14 turns or 72 real-world hours. Custom parties that go empty (no members, no seats) are otherwise deleted automatically, but a party with a ratified charter is exempt from cleanup until the charter is dissolved.

Existing pre-Phase-6 third parties were migrated to the charter system in place: each was given an automatically generated charter, marked incomplete if fewer than three human officers were available at the time. Incomplete migrated parties keep their cleanup immunity; the remaining founder slots can be filled later from the charter detail page to fully ratify.

## Parties by country

Each country has its own set of default parties suited to its political system:

| Country | System | Key offices |
| --- | --- | --- |
| US | Presidential, FPTP | House, Senate, Governor, State Senate, President |
| UK | Westminster parliamentary | Commons, Regional Councils |
| CA | Westminster parliamentary | House of Commons (federal) |
| DE | Mixed-member proportional | Bundestag |
| JP | Mixed-member majoritarian | Shūgiin, Sangiin |

## Related

- [Party Membership](/wiki/party-membership): How to join, switch, and what membership unlocks.
- [Party Leadership](/wiki/party-leadership): Chair, vice chair, treasurer roles and elections.
- [Party Organization](/wiki/party-organization): The org score system, how it builds and decays.
- [Party Ideology](/wiki/party-ideology): The two-axis ideology grid and its effects.
- [Party Actions](/wiki/party-actions): What leaders can spend party resources on.
- [Coalitions](/wiki/coalitions): Cross-party alliances and their effects.
`;
