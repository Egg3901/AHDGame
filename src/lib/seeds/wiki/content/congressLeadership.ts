export const congressLeadershipContent = `# Congress Leadership

Congressional leadership positions - Speaker, floor leaders, committee chairs - sit at the top of the legislative hierarchy. This page covers what each role does, how elections work, who votes, and what happens when a seat goes vacant.

## Leadership positions

### House of Representatives (US)

| Position | Role |
| --- | --- |
| **Speaker of the House** | Presides over the House, controls the legislative agenda, second in presidential line of succession |
| **House Majority Leader** | Floor leader for the chamber's single largest party, manages day-to-day scheduling |
| **House Minority Leader** | Leads the opposition in the House |

### Senate (US)

| Position | Role |
| --- | --- |
| **Senate President Pro Tempore** | Formal presiding officer; largely ceremonial, third in presidential line of succession |
| **Senate Majority Leader** | Most powerful Senate position - controls the Senate floor agenda |
| **Senate Minority Leader** | Leads the opposition in the Senate |

### UK Commons

The Commons has its own leadership structure. See the [United Kingdom](/wiki/united-kingdom) hub for details on the Speaker of the House of Commons and party leadership there.

### JP Diet

The Shugiin and Sangiin each elect a President (Speaker-equivalent). See the [Japan](/wiki/japan) hub.

### DE Bundestag, NG National Assembly, CN legislature

Presiding-officer elections use the same shared framework across countries, not just the US: DE elects a Bundestagspräsident, NG elects presiding officers for its National Assembly chambers, and CN elects a CPPCC Chairman and an NPCSC Chairman. All of these resolve top-vote-getter-wins on a fixed-duration ballot, differing only in electorate and eligibility gate. See the country hubs for details.

## How leadership elections work

Leadership elections run on their own election system, separate from constituency races.

### Declaring candidacy

Any eligible member of the relevant chamber can declare candidacy for a leadership position during the open declaration window. Eligibility typically requires:

- Being an elected member of the chamber (not just a candidate)
- Meeting the office's current party or bloc gate

### Voting

Leadership votes are cast by chamber members. The structure differs by position:

- **Speaker** - any seated House member may declare candidacy and vote, regardless of party
- **President Pro Tempore** - any seated Senator may declare candidacy and vote, regardless of party
- **Bundestagspräsident (DE)** - any seated MdB may declare candidacy and vote, regardless of party
- **Majority Leaders** - elected only by members of the chamber's single largest party
- **Minority Leaders** - elected only by non-majority parties outside the majority bloc
- **Committee chairs** - assigned or elected within the relevant committee

U.S. congressional leadership races are player-only. NPPs do not run for or vote in Speaker, Majority Leader, Minority Leader, or Pro Tempore elections.

### Coalitions and the majority bloc

In the US, coalitions aggregate party seats into blocs. The **majority bloc** is the largest coalition or single party controlling the most seats; the **minority bloc** is the second largest. This matters for leadership:

- Speaker, President Pro Tempore, and Bundestagspräsident are open to **any seated chamber member**: bloc and party affiliation do not gate candidacy or voting.
- House and Senate Majority Leader (and Whip) are party-gated: only the single national party with the most seats in that chamber may declare or vote.
- Minority-side leadership (Leader and Whip) remains open to non-majority parties outside the majority bloc.

## Vacancies and succession

When a leadership position goes vacant - through electoral defeat, resignation, or administrative removal - the turn processor runs a leadership vacancy phase.

- A new leadership election spawns automatically.
- Interim leadership may be handled by the next most senior member until a new election completes.
- The specific rules for each position (succession order, interim holder) vary; the turn system enforces the correct sequence.

### Motion to Vacate the Speaker

A sitting House member can force the Speaker out mid-term without waiting for the next general election, by filing a motion to vacate. Any House member may file, and any House member may vote For or Against. The motion needs an absolute majority of the House to pass, not a plurality. If it passes, the Speaker is vacated immediately and a fresh Speaker election opens right away. If it fails, the sitting Speaker stays in place.

## What leadership members do each turn

Leadership positions are not purely honorary - they affect game mechanics:

- **Speaker:** Future mechanic - controls which bills reach the floor for a vote (currently all eligible bills proceed automatically).
- **Majority/Minority Leaders:** Set the whip apparatus for their party's floor strategy.
- **Committee Chairs:** Control committee assignments (future mechanic).

Beyond game mechanics, leadership positions carry **prestige** - they are high-visibility offices that contribute to favorability and political influence generation in ways regular floor membership doesn't.

## Leadership election timeline

Leadership elections run concurrently with regular congressional cycles but on shorter timelines than constituency races:

- Leadership elections use a single 24-hour plurality window rather than separate primary and general phases.
- Because leadership races cover the full chamber rather than a state or district, the vote accumulation math uses chamber-wide rather than regional demographics.

## Tracking leadership

The current leadership roster is visible on the Congress page. Each position shows the current holder's name, party, and tenure. Upcoming leadership elections appear alongside regular elections in the elections list.

## Strategic notes

### Why pursue leadership?

- **Agenda control** - future mechanics will let the Speaker and Majority Leader gate which bills reach the floor.
- **Visibility** - leadership positions increase your national profile faster than a backbench seat.
- **Coalition leverage** - holding the Majority Leader seat in a closely divided chamber makes you a mandatory negotiating partner for any bill.

### Building a leadership coalition

To win a leadership race, you typically need:

1. **Strong personal favorability** with fellow chamber members - player votes and political alliances still matter even without NPP ballots.
2. **Party alignment** - Speaker, Pro Tempore, and Bundestagspräsident are open to any seated member; Majority Leader requires your party to be the chamber's single largest party.
3. **Active campaigning** - use influence actions to raise your profile before the declaration window opens.

## Related pages

- [Bills & Legislation](/wiki/bills-legislation) - How the Speaker's future agenda powers affect bill flow
- [Committees](/wiki/committees) - Committee chairs and how they relate to leadership
- [Voting & Whips](/wiki/voting-and-whips) - How whip directives flow from leadership to members
- [Government Formation](/wiki/government-formation) - Parliamentary equivalent for UK/JP/DE
`;
