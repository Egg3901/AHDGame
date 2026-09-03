export const partyOrganizationContent = `# Party Organization

Party organization (org) is a 0-100 score that represents how well-organized your party is in a given state. High org boosts your candidates' vote totals in generals, improves your GOTV efficiency, and signals to other parties where you are strong. Low org means your party punches below its voter base.

## The org pool

Each state has a single 100-point organization pool. Every party's share comes out of that pool, and the leftover is the **Unaffiliated** share. The pool is the only ceiling: there is no per-party cap. The constraint is just:

\`\`\`
Σ (every party's organization in this state) + Unaffiliated = 100
\`\`\`

A party can grow as large as the unclaimed pool allows. When the unaffiliated share runs low, Build Org automatically starts poaching Org off rivals as well, including the dominant party in the state, so even a fully saturated state is still contestable. There is no separate "Contest" action.

Each party-state combination has its own tracked org score.

## Building org

Organization grows through the **Build Org** action on the state-party page. The state chair, state vice chair, the state campaigner, the national chair, the national vice chair, or any national campaigner can click Build Org. Each click grows your share by drawing from the state's Unaffiliated pool **and** poaching Org off rivals at the same time.

Every click costs **both Political Strength and money**. The two are billed to the same tier: a state officer spends the state party's PS and the state party's treasury, while a national officer spends the national pool and the national treasury. Building from the national pool costs **twice** the money of building from a state pool, so an officer who holds both a national and a state post is choosing between two different prices; each button shows its own. The cash price also scales with the PS cost, so a state where your pressure ladder has climbed costs more money as well as more PS, and it scales with your country's own currency so the burden is comparable everywhere.

**Bigger states cost more to organize.** A point of Org is a share of the state it sits in, so a point in a large state carries far more weight at election time than the same point in a small one. The price follows: organizing the largest states runs up to twice the national average, the smallest as little as half, on a curve that follows the square root of population rather than population itself. That deliberately keeps the gap narrower than the raw difference in size, so a small state is a bargain but never free. Because most parties concentrate their effort in the states that decide elections, expect this to raise your organizing bill overall rather than simply move it around: you are paying more where a point of Org is worth more. Building out into smaller states is now correspondingly cheaper if you want the reach. The projection panel names the multiplier where it applies.

Per-click gain scales with four factors, shown in the click projection panel:

- **Pool free**: the share of the state's pool not held by any party. Larger = bigger click. When the pool is empty, the click is sourced entirely from rivals.
- **Own diminishing returns**: the higher your own current Org, the smaller the next click. At Org 75 the multiplier is 0.5×; below 50 Org there is no penalty.
- **PS leverage**: your PS reserve vs the average rival PS reserve in this state. Range 0.5× to 1.5×. The reserve compared here is your **state PS plus a fraction of your national PS pool**, so national backing makes you organize a little harder everywhere.
- **Catch-up**: 1.5× when at least one rival has higher Org than you, 1.0× otherwise. Anti-snowball.

Build Org requires **presence**: the party must have at least one player character or elected official in this state (or be acted on by a national officer who can build org into vacant states).

### When the treasury is short

A thin treasury slows organizing rather than stopping it. If the paying treasury cannot cover the full price, the click still lands: it takes whatever money is there and grants a proportionally smaller share of the Org. Cover a quarter of the price and you get a quarter of the gain. Below a quarter the click is refused outright, and a refused click is free, costing you no Political Strength and adding nothing to the pressure ladder. The projection panel shows the price before you click and warns you when a click would only be partly funded.

## Org decay

Every turn, every party row with Org > 0 loses **0.03125 Org**, about 0.75 points per IRL day or 1.5 per game-year. Players counteract decay by clicking Build Org. There is no "decay pauses while investing" gate; you always have to actively defend your Org.

Decayed Org returns implicitly to the state's Unaffiliated pool.

## Poaching rivals

Build Org poaches rivals automatically: there is no separate action and no target picker. Each click distributes its rival-poaching across every rival in the state, and how much a given rival loses blends two things: **how large its Org share is** and **how far its PS reserve falls below yours**. The biggest party in the state is always a primary target by virtue of its size: even a rival that out-reserves you on PS still bleeds some Org rather than being immune, while out-muscling a PS-poor rival makes it bleed more on top of that. The reserve compared is each party's **state PS plus a fraction of its national PS pool**, so a nationally-backed rival defends its Org a little better even when its state PS is thin. Poached Org transfers to your party rather than being destroyed.

Two protections carry over: a rival already near 0 Org bleeds slowly (it can't be cheaply zeroed), and an abandoned default-party stronghold (a default party with no active human national chair) takes only half the poach. Poaching organized rivals is deliberately less efficient per click than recruiting from an open Unaffiliated pool, so grinding a saturated state is slower than growing in open space.

## Why org matters

In general elections, party Org enters the vote-appeal formula as a **normalized state-pool share**:

\`\`\`
orgShare(party) = party.organization / Σ(every party's organization in this state)
\`\`\`

Each party's share is a number in \`[0, 1]\`. The live vote weight applies diminishing returns: \`orgVoteWeight = orgShare ^ 0.2\`. This preserves the ranking while softening a dominant party's structural edge. A 3:1 Org lead produces about a 1.25:1 Org-weight advantage. If the state has no Org data at all, every party gets a neutral 1× fallback. A candidate with strong personal reach and approval can also earn a small personal floor, capped at 0.1, instead of being erased by zero party Org.

Two complementary signals also enter the per-candidate weight in general elections:

- **Reg resistance**: own-Reg multiplies weight by 1.0× (Reg=0) up to 1.3× (Reg=100). Higher own-Reg makes a party harder to peel away through persuasion.
- **Support mood**: candidate-level Support shifts weight between 0.6× (Support=0) and 1.4× (Support=100), neutral 1.0× at 50. Captures short-term mood / momentum from debates, scandals, endorsements.

These three factors combine multiplicatively in the per-group weight; a strongly-organized party with high Reg and a mood-positive candidate compounds across all three. **Primaries** continue to use the older intra-party formula because within-party normalization cancels out (every candidate of the same party shares the same Org).

GOTV budget spending also scales with org: a more organized party gets more out of the same GOTV dollar.

## Related

- [Party Leadership](/wiki/party-leadership): Who can spend PS on Build Org.
- [Party Actions](/wiki/party-actions): GOTV and suppression spending.
- [Party Ideology](/wiki/party-ideology): How ideology interacts with voter appeal.
`;
