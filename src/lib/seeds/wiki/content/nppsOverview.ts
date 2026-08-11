export const nppsOverviewContent = `# NPPs overview

Non-Player Politicians (NPPs) are AI-controlled politicians that fill the political landscape. They hold office, run in elections, vote on bills, and participate in leadership elections, all autonomously, every turn. Without NPPs, legislatures would sit half-empty and elections would be uncontested. With them, the game world functions at full scale regardless of how many players are active.

## What NPPs are

NPPs are politician records in the \`npps\` collection. They have:
- A procedurally generated **name**
- A **home state** (or region in the UK, Land in DE, prefecture in JP)
- A **party affiliation**
- **Policy positions** on the economic and social axes (-5 to +5)
- A **personality** (loyalty, ambition, stubbornness, each 0 to 100)
- A **Political Influence** score (0 to 100, with a **floor of 10%** that never decays)
- A **favorability** score (0 to 100)

They appear on state pages, the Congress page, election candidate lists, and bill vote tallies. An "NPP" badge distinguishes them from player characters everywhere they appear.

## Why they matter

NPPs fill every office that players don't hold. In a legislature with 435 House seats and only 20 active players, 415+ seats are held by NPPs. Those NPPs:

1. **Vote on every bill**: NPP bill votes are weighted by seats held. An NPP with 7 House seats casts 7 votes. Their collective votes often determine whether legislation passes.
2. **Enter elections**: NPPs run in primaries and generals. They are your automatic opponents unless you actively compete.
3. **Vote in leadership elections**: Speaker of the House, Senate leadership, and similar positions are chosen partly by NPP votes. Building NPP support in your favor is a real strategic lever.

## How many exist

Admins can spawn NPPs in bulk (1 to 500 at a time) for any party, with weighting toward states that match the party's lean or existing NPP presence. The total NPP count scales with the game's needs: the simulation is designed to fill every seat in every country.

## Key constraints

- **NPPs cannot run for President**: presidential races are reserved for player candidates so there's always a meaningful player choice at the top
- **One NPP per party per primary**: NPPs don't split their own party's vote
- **Incumbent priority**: an NPP currently holding a seat gets first priority to defend it in the next primary
- **Country isolation**: US NPPs can only enter US elections; UK NPPs enter UK races only

## Influence system

Players can directly influence individual NPPs from the NPP profile page (\`/npp/[id]\`):

| Action | Actions | Funds | Base Chance |
| --- | --- | --- | --- |
| Request Endorsement | 5 | ₳0 | 40% |
| Request Withdrawal | 8 | ₳50,000 | 25% |
| Request Opposition | 5 | ₳25,000 | 35% |
| Request Leadership Support | 4 | ₳0 | 45% |

Success chance is modified by the NPP's stubbornness, your relationship score, and any fund boost you add (up to +15% for ₳150K spent). Outcomes affect your relationship with that NPP:

- **Success**: +10 relationship
- **Failure**: -5 relationship
- **Backfire** (roll ≥ 95): -25 relationship

Party leaders can also influence NPPs using party resources instead of personal character actions.

## Displaying NPPs

NPP profile pages are at \`/npp/[id]\`. NPPs appear with their assigned politician image (sourced from Wikimedia Commons where available) or an initial placeholder avatar.

## Related

- [NPP Autonomy](/wiki/npp-autonomy): graduated smarter-NPP levels (v0 to v3).
- [NPP Behavior](/wiki/npp-behavior): how NPPs decide to vote on bills and leadership elections.
- [NPP Elections](/wiki/npp-elections): how NPPs enter primaries and generals.
- [Party Actions](/wiki/party-actions): party-level NPP influence using party resources.
- [Party Ideology](/wiki/party-ideology): how ideology alignment drives NPP voting decisions.
`;
