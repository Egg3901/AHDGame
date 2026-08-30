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
3. **Hold party offices and fill legislatures**: NPPs occupy most seats and vote on bills. U.S. congressional leadership races (Speaker, House and Senate floor leaders) are player-only; NPPs do not autonomously vote in those.

## How many exist

Admins can spawn NPPs in bulk (1 to 500 at a time) for any party, with weighting toward states that match the party's lean or existing NPP presence. The total NPP count scales with the game's needs: the simulation is designed to fill every seat in every country.

## Key constraints

- **NPPs cannot run for President in a player country**: presidential races there are reserved for player candidates so there's always a meaningful player choice at the top. In a country nobody plays, with NPP autonomy active, NPPs do contest the presidency
- **One NPP per party per primary**: NPPs don't split their own party's vote
- **Incumbent priority**: an NPP currently holding a seat gets first priority to defend it in the next primary
- **Country isolation**: US NPPs can only enter US elections; UK NPPs enter UK races only

## Influence system

Players can directly influence individual NPPs from the NPP profile page (\`/npp/[id]\`). Those profile actions are **deterministic** (\`CAPITAL_ACTIONS\` in \`src/lib/capital/actions.ts\`), not a chance roll:

| Action | Actions | Funds | Min Relationship | Effect |
| --- | --- | --- | --- | --- |
| Request Endorsement | 6 | ₳0 | none (hidden policy/relationship gate) | Public endorsement of your current candidacy |
| Private Meeting | 3 | ₳0 | -50 | +5 relationship |
| Boost Favorability | 5 | ₳10,000 | none | +3 favorability, +2 relationship |
| Reduce Favorability | 5 | ₳10,000 | -100 | -3 favorability, -2 relationship |
| Boost Influence | 6 | ₳20,000 | none | +2 political influence, +2 relationship |
| Reduce Influence | 6 | ₳20,000 | -100 | -2 political influence, -2 relationship |

Withdrawal, opposition, and leadership-support asks are **party-level** influence actions (3 party actions each). See [Party Actions](/wiki/party-actions) and [Political Capital](/wiki/political-capital).

## Displaying NPPs

NPP profile pages are at \`/npp/[id]\`. NPPs appear with their assigned politician image (sourced from Wikimedia Commons where available) or an initial placeholder avatar.

## Related

- [NPP Autonomy](/wiki/npp-autonomy): graduated smarter-NPP levels (v0 to v3).
- [NPP Behavior](/wiki/npp-behavior): how NPPs decide to vote on bills and leadership elections.
- [NPP Elections](/wiki/npp-elections): how NPPs enter primaries and generals.
- [Party Actions](/wiki/party-actions): party-level NPP influence using party resources.
- [Party Ideology](/wiki/party-ideology): how ideology alignment drives NPP voting decisions.
`;
