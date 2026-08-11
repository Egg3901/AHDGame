export const billsLegislationContent = `# Bills & Legislation

Every law in A House Divided starts as a bill drafted by a sitting legislator. Bills must survive votes in both legislative chambers and then either be signed by the executive or lapse to automatic signature. This page explains how that process works from start to finish.

## Who can propose bills

| Country | Eligible legislators |
| --- | --- |
| US | Any sitting House or Senate member |
| UK | Any sitting Commons member |
| JP | Any sitting Shūgiin or Sangiin member |

Admins can propose bills from any country at any time and are exempt from all proposal costs.

## Bill structure

Every bill requires:

- **A category**: agriculture, defense, economy, education, environment, foreign policy, healthcare, immigration, industry, infrastructure, public safety, social, tax, technology, or trade. The category controls which legislation types can appear as provisions.
- **One to three provisions**: each provision is a legislation type (e.g., "Minimum Wage", "Income Tax") paired with a policy option that defines its ideological direction. Bills are capped at three provisions total.

### Provision types

Bills can contain the following kinds of provisions:

1. **Policy provisions**: the standard legislation type + policy option that changes national or state metrics. Most categories use these.
2. **Tariff provisions** (trade bills only): set import tariffs scoped to an entire economy, a specific sector, an origin country, or a single corporation.
3. **Subsidy provisions** (industry bills only): direct government subsidies to an economy-wide sector or a specific industry.
4. **End subsidy provisions**: repeal an existing subsidy.
5. **Embargo provisions**: enact a durable trade embargo against a target country (by commodity or all trade).
6. **End embargo provisions**: repeal an existing trade embargo.
7. **Nationalize provisions**: transfer corporate assets or an entire sector to state ownership.
8. **Privatize provisions**: spin state-owned assets out into a new private corporation (IPO or auction).
9. **Designate strategic sector provisions**: mark a sector as strategically vital, arming nationalization triggers.

### Proposal costs

Proposing a bill costs **10 action points** plus national influence for each provision:

| Provision | NPI cost |
| --- | --- |
| 1st | 5 national influence |
| 2nd | 10 national influence |
| 3rd | 15 national influence |

Tariff provisions do **not** cost national influence: only action points.

Your action and national influence balances are shown in the bill proposal form before you submit. If the bill is eventually enacted, both the action points and NPI spent are refunded to the sponsor.

### Policy options and the dual-axis grid

Each legislation type has policy options ranked on two axes:

- **Economic axis**: negative = left (more spending/redistribution), positive = right (less spending/free market)
- **Social axis**: negative = progressive, positive = conservative

US tax types use a bracketed scale. All other types use a 7-option scale (3 left, 1 center, 3 right). The option you select determines what happens to national metrics when the bill is signed.

## Bill guards

The system enforces several hard constraints on bill proposals:

- **One active bill per sponsor**: a legislator cannot propose a new bill while they already have one active in either chamber.
- **One pending PM/Chancellor**: if the government has no seated PM/Chancellor, all new bill proposals are blocked. Active bills remain in place until the freeze lifts.
- **Whip cooldown**: after a whip directive is issued, a cooldown period applies before another can be sent to the same target.
- **NPP catch-up**: every turn, the system ensures NPPs that gained seats after a bill opened still vote before it closes.

## The bill lifecycle

Bills move through a strict status pipeline managed automatically by the turn processor each hour.

| Status | Meaning |
| --- | --- |
| \`proposed\` | Drafted but not yet active (used for some internal flows) |
| \`active\` | Voting open in the origin chamber (24-hour window) |
| \`active_other\` | Voting open in the second chamber (24-hour window) |
| \`enrolled\` | Passed both chambers; awaiting executive action (10-hour window) |
| \`signed\` | Executive signed: bill is law |
| \`vetoed\` | Executive vetoed the bill |
| \`veto_override\` | Veto overridden by legislature: bill becomes law |
| \`override_failed\` | Override vote failed: bill dies |
| \`cabinet_review\` | Under review by the cabinet (parliamentary systems) |
| \`filibustered\` | Filibuster invoked; needs 3/5 of votes cast to pass |
| \`failed\` | Failed a chamber vote or pocket-expired |
| \`withdrawn\` | Sponsor withdrew before voting opened |

### Step 1: Proposal

Submit the bill from the Congress or Parliament page. On submission, the bill immediately enters \`active\` status with a 24-hour voting window. There is no cooldown before a bill becomes active.

### Step 2: origin chamber vote

While active, all members of the origin chamber can vote For, Against, or Abstain. Votes can be changed any time during the 24-hour window. The result is a simple majority: For must exceed Against. Abstentions are neutral.

### Step 3: second chamber

If the origin chamber passes, the bill opens for a fresh 24-hour vote in the second chamber. Same rules apply.

### Step 4: executive action

Once both chambers have passed, the bill is \`enrolled\`. The president or PM has 10 hours to sign or veto. If no action is taken within 10 hours, the bill is **automatically signed** (pocket signature).

Only the character currently holding the executive office can see the Sign / Veto buttons.

## How NPPs vote

Non-Player Politicians (NPPs) vote on every bill automatically. Their votes are determined by a **cross-pressure model** that weighs four forces:

- **Ideology**: alignment between the NPP's policy positions and the bill's direction
- **Whip**: party and caucus whip directives
- **District**: the demographics of the NPP's home state or region
- **Donors**: corporate and interest-group alignment

The four forces are summed into a single score. If the total is strongly positive the NPP votes For; strongly negative means Against; near-zero produces Abstain.

- NPP blocs holding multiple seats contribute their full seat-count weight.
- A catch-up run every turn ensures NPPs that gained seats after a bill opened still vote before it closes.

For full details on whip mechanics and the force model, see [Voting & Whips](/wiki/voting-and-whips).

## What happens when a bill is signed

### Metric effects

Each provision applies its policy effects to state or national metrics. Federal US bills divide their effect by 50 (one per state); UK national bills divide by 12 (one per region). Effects apply each turn the policy is active; see [Policy Effects](/wiki/policy-effects) for the full math.

### Archetype approval for legislators

Legislators who voted **For** the enacted bill receive demographic archetype approval changes based on how far the policy shifted on each axis:

- \`impact = shift × affinity × 0.15 × positionMultiplier\`, clamped to ±10 per bill
- The \`positionMultiplier\` is higher for extreme options (1.5 at the far ends) and lower for centrist ones (0.5 at the center), so bold shifts create stronger reactions.
- A bill moving education policy two steps rightward gives evangelicals (affinity +35) roughly +10 approval and public-sector archetypes (affinity −40) roughly −10 approval.

## Bicameral strategy

### Building votes

You need majorities in both chambers plus executive support. Strategies:

1. **Whip allies before the vote.** Use whip directives to push your party's members. See [Voting & Whips](/wiki/voting-and-whips).
2. **Propose in your stronger chamber first.** If you have a House majority but shaky Senate support, introduce in the House so momentum builds before the Senate vote.
3. **Keep provisions focused.** Each extra provision adds national influence cost and gives opponents more to vote against. A narrow one-provision bill is easier to pass than a three-provision omnibus.

### Parliamentary differences

In parliamentary countries (UK, JP, DE), the lower chamber (Commons, Shūgiin, or Bundestag) does most of the legislative work. The upper chambers (Lords, Sangiin) can also vote on bills; the Bundesrat is appointed by Land governments, and players cannot interact with it directly. If the government has no PM/Chancellor seated (including the window after a successful no-confidence vote or a snap dissolution), legislation is fully frozen: no new bills can be proposed and active bills stay in place until the freeze lifts.

## Viewing bills

Every bill has a detail page at \`/congress/bills/[id]\` showing:

- A timeline stepper from proposal through enactment
- Live vote bars (For / Against / Abstain percentages) for both chambers
- A live countdown timer while voting is open
- The presidential action panel (Sign / Veto), visible only to the executive

## Related pages

- [Voting & Whips](/wiki/voting-and-whips): Whip directives, how party discipline works, how to influence NPP votes
- [Policy Effects](/wiki/policy-effects): How signed bills change national and state metrics each turn
- [Congress Leadership](/wiki/congress-leadership): Speaker, floor leaders, how leadership shapes the legislative agenda
- [Committees](/wiki/committees): Committee assignments and their future role in bill flow
- [Government Formation](/wiki/government-formation): Parliamentary government status and the legislation freeze
`;
