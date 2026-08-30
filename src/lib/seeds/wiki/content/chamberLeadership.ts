export const chamberLeadershipContent = `# Chamber Leadership

Every legislature in the game elects a presiding officer: the member who chairs the chamber's sessions. The rules for who can run and who can vote are not the same everywhere. This page walks through the presiding-officer elections in the US, Germany, Nigeria, and China, and how they differ from party-gated leadership like Majority Leader.

## The shared shape

All four countries' presiding-officer elections follow the same lifecycle:

1. **Open** - a fixed-duration ballot opens once the chamber's seats are finalized after a general election.
2. **Vote** - eligible members declare candidacy and cast votes. Plurality wins; there is no majority requirement.
3. **Resolve** - when the ballot closes, the candidate with the most votes wins. Everyone else is marked as failed. An empty candidate list closes the election with the seat left vacant.

The incumbent is automatically re-nominated at the start of each new ballot, provided they still hold a seat in the chamber and still qualify under the role's eligibility rule. A party that loses its majority status can knock its own incumbent off the ballot this way.

Ballot length varies by country: the US Speaker runs on a 12-hour window; the German, Nigerian, and Chinese presiding-officer elections run 24 hours.

## Who can run: two eligibility rules

Two different eligibility rules cover the presiding officer roles in this page:

- **Any seated member** - every party holding at least one seat in the chamber may declare a candidate and vote. This is the rule for the US Speaker, the German Bundestagspräsident, both Nigerian chamber officers, and China's NPCSC Chairman.
- **Largest single party only** - only the chamber's single biggest party may declare or vote. This is the rule for China's CPPCC Chairman.

This is a different (and looser) rule than [Majority/Minority Leader](/wiki/congress-leadership), which is explicitly party-gated: Majority Leader requires your party to hold the most seats, Minority Leader is open only to parties outside the majority bloc. Presiding officer elections under "any seated member" don't care about bloc or party at all, any member of any chamber party can run and vote.

## United States: Speaker of the House

The Speaker presides over the House, controls the legislative agenda, and sits second in the presidential line of succession. Any seated House member may declare candidacy and vote, regardless of party, though in practice the majority party's bloc size usually decides the outcome. The ballot runs 12 hours.

See [Congress Leadership](/wiki/congress-leadership) for the Speaker's role alongside Majority/Minority Leader and committee chairs.

## Germany: Bundestagspräsident

The Bundestagspräsident election opens automatically once the Bundestag's seats (487 in the 1953 preset, 630 modern) are filled through Germany's Additional-Member System (direct mandates plus list seats). Any seated member of the Bundestag may declare candidacy and vote, regardless of party. The ballot runs 24 hours and resolves the same way as the US Speaker race: top vote-getter wins.

## Nigeria: National Assembly presiding officers

Nigeria elects two presiding officers independently, one per chamber:

| Role | Chamber |
| --- | --- |
| **Speaker** | House of Representatives |
| **Senate President** | Senate |

Each runs its own 24-hour ballot, drawing votes only from members of that chamber. A House member cannot vote in the Senate President race and vice versa. Any seated member of the relevant chamber may declare candidacy and vote, regardless of party.

## China: CPPCC and NPCSC Chairmen

China runs two separate chair elections, both drawn from seated National People's Congress (NPC) delegates, but with different eligibility:

| Role | Eligibility | Why |
| --- | --- | --- |
| **NPCSC Chairman** (Standing Committee) | Any seated NPC delegate | Open ballot among delegates, same shape as the other countries' presiding officers |
| **CPPCC Chairman** | Largest single party only | The CPPCC is an advisory body that is appointed in the real system rather than elected; the game models this by restricting the race to whichever party holds the most NPC seats, the same eligibility rule used for the US Majority Leader |

Both run 24-hour ballots and resolve on plurality, same as the DE and NG races.

## Soviet Union: the Chairman of the Presidium is not one of these

The Chairman of the Presidium is elected by a joint sitting of both Supreme Soviet chambers, so it looks like a presiding-officer race and is often mistaken for one. It is not. It is the **ceremonial head of state**, and it is closer to a figurehead presidency than to a Speaker or a Majority Leader:

| | Presiding officers above | Chairman of the Presidium |
| --- | --- | --- |
| Actions per turn | Varies by office | **+0** |
| Party strength weight | Contributes | **0** |
| Controls the agenda | Chairs its chamber | No |

The office carries no action bonus and no party-strength weight at all: it is a capstone, not a power base. Real Soviet legislative power sits with the **Premier** (head of government, +4 actions) and the **General Secretary** of the CPSU.

The Supreme Soviet also has no Majority or Minority Leader, because the CPSU is the only seeded party and there is no second bloc for those roles to describe. See [Soviet Union](/wiki/ru-overview) for the full structure, including the convocation reset that clears the Presidium chair after the last election of each cycle.

## Vacancies

If a ballot closes with no candidates, the seat is left vacant rather than defaulting to anyone. A new election opens on the same cycle as the next chamber reconciliation. Losing a seat in the relevant chamber (a House seat for the US Speaker, an NPC delegate seat for either Chinese chair) drops an incumbent from re-nomination even mid-term.

## Related pages

- [Congress Leadership](/wiki/congress-leadership) - Majority/Minority Leader, Whip, and committee chairs, all party- or bloc-gated
- [Party Leadership & Authority](/wiki/party-leadership-authority) - acting chairs, tenure gates, and other party-side leadership rules
- [Government Formation](/wiki/government-formation) - how parliamentary governments (UK, JP, DE) form after elections
- [Voting & Whips](/wiki/voting-and-whips) - how whip directives interact with chamber votes
`;
