export const partyActionsContent = `# Party actions

Parties have their own resource pools (a treasury and a Political Strength reserve) that leadership can spend on collective actions affecting voter turnout, organization, and NPP behavior. These are distinct from your personal character actions and funds.

## Party resources

### Treasury

The party treasury accumulates from member taxes each turn. Tax rates are set separately at two levels:

- **National tax rate**: set by the national treasurer; applies to all members across all states
- **State tax rate**: set by the state treasurer; applies to members in that state on top of the national rate

Treasury funds are spent on budget allocations (GOTV, suppression, org building), on NPP influence actions, and on growing Political Strength.

### Political Strength

Political Strength (PS) is the renamed-from-action-pool reserve a party spends on direct actions like Build Org, Influence, Recruitment, and the like. Unlike the old flat \`+5/turn\` action pool, PS is a stored reserve that grows over time:

- a passive flat trickle, treasury-independent: **20 PS/turn** for national parties, **5 PS/turn** for state parties
- treasury-driven PS gains, normalized per country (state-party PS is generated at half the national rate in the same country)
- both streams grow at full rate up to the hard cap: the cap is the only ceiling, and once the reserve reaches it no further gain is added (or charged for)

Repeated PS spends in the same state or region escalate in cost (per-geography pressure ladder, decaying \`-3\` per turn). Acting in one state does not raise the cost of acting in another.

State chairs and vice chairs spend the state party's PS on state-scope actions; national chairs and vice chairs spend the national party's PS on national-scope actions.

### Party tier and PS cap (Major / Minor)

Every party is either a **Major** or a **Minor** party, shown as a badge on its page.

- **Minor parties** (all new and custom parties start here) have a reduced national PS cap that *grows with their footprint*: the cap rises for every region where the party holds **20%+ Organization**, and falls again if a region drops below 10%.
- A Minor party that reaches **20%+ Organization in a third of a country's regions** graduates to **Major** and unlocks the full national PS cap.
- A **Major** party that collapses below **10% Organization across two-thirds of regions** is shown an at-risk warning with a countdown. If it doesn't recover to the graduation level in time, it is demoted back to Minor (and its cap shrinks to match its footprint). Major parties have a **240-turn grace period** (MAJOR_DEMOTION_GRACE_TURNS) before demotion takes effect.

The historic governing parties begin as Major; small and regional parties begin as Minor and must build organization to rise. (In one-party states, the ruling party is always Major.)

### Registration

Registration grows automatically as your party builds Organization: Reg drifts toward your Org level each turn, raising the partisan base in states where you've put down roots. New registrations come first from the state's Independent and Unregistered voters; once that pool is spent, they come from parties whose registration has outrun their organization, in proportion to how far ahead of their Org they sit. A party that keeps its Org up defends its base; a party coasting on a seeded majority with little Org will see it erode toward organized rivals. There is no per-click registration action; focus on Build Org, and Reg will follow on its own. Registration is a slow, durable partisan base that resists persuasion at election time, so the climb pays off across many election cycles.

## Budget-based actions (percentage allocations)

These are set as a percentage of the state party's incoming revenue per turn. They run automatically each turn once configured: you don't spend individual actions for each turn's effect.

### GOTV (Get Out the Vote)

Allocate a percentage of state party income to **voter turnout boosting**. GOTV spending increases the turnout rate of your targeted demographic group in that state. You can target:
- A demographic **category** (e.g., "age", "income", "race")
- A specific **group** within that category (e.g., "18 to 29", "college-educated")

Higher org score improves the efficiency of GOTV spending: an organized party gets more turnout per dollar.

**Who can set it:** State chair, vice chair, treasurer, or national chair.

### Suppression

Allocate a percentage of state party income to **opposing turnout reduction**. Suppression targets a specific demographic group in the opposing party's voter base and reduces their effective turnout rate.

**Who can set it:** State chair, vice chair, treasurer, or national chair.

### Org building

Allocate a percentage of state party income to **organization score growth**. At the constant rate of ₳75,000 per +1 org per turn, this converts revenue into organization. The org building percent represents how much of your total state party revenue goes toward org growth.

**Who can set it:** State chair, vice chair, treasurer, national chair. National chairs can set this even in states where the party has no presence yet (to expand the party footprint). State officers require party presence in that state.

## NPP influence actions

Party chairs and vice chairs (at both state and national levels) can spend **party resources** (not personal character actions) to influence NPPs:

| Action | Description |
| --- | --- |
| **Endorse Candidate** | Get a same-party NPP to endorse your candidacy |
| **Oppose Candidate** | Direct a same-party NPP to oppose an opponent's candidacy |
| **Request Leadership Support** | Build NPP support for a leadership election bid |
| **Request Withdrawal** | Convince a same-party NPP to drop out of a race |

**State chairs/vice chairs** can influence NPPs in their own state.
**National chairs/vice chairs** can influence NPPs in states where no player holds state leadership, acting as a national fallback.

These influence attempts use party treasury and Political Strength, not personal character resources.

## Whip directives (free)

Whipping is **free**: no action cost. State chair and vice chair can issue directives to NPPs in their state telling them how to vote on bills and leadership elections. See [NPP Behavior](/wiki/npp-behavior) for the compliance formula.

Limits: each NPP can be whipped **twice per target per chamber** (allows one retry if the first directive doesn't stick).

## National party actions

The national party chair can recruit NPPs through the admin-facing recruitment tool. This costs party treasury and creates new NPP politicians aligned with the party, boosting representation in states where the party is thin.

## Related

- [Party Leadership](/wiki/party-leadership): who holds the authority to use party actions.
- [Party Organization](/wiki/party-organization): how org building budget translates to org score.
- [NPP Behavior](/wiki/npp-behavior): NPP compliance with whip directives.
- [NPPs Overview](/wiki/npps-overview): what NPPs do and why influencing them matters.
`;
