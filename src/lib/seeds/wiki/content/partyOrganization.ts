export const partyOrganizationContent = `# Party Organization

Party organization (Org) is your party's percentage share of the organization built in a given state. High Org boosts your candidates' vote totals in general elections, improves your GOTV efficiency, and signals to other parties where you are strong. Low Org means your party punches below its voter base.

## The org pool

Each state has an organization bucket. Every successful Build Org click adds **one organization unit** to your party's balance in that bucket. Org% is derived from the units accumulated by every party in the state.

\`\`\`
Org% = party units / (100 permanent Unaffiliated units + all party units) × 100
\`\`\`

Every state or region begins with a permanent **Unaffiliated** stake of 100 units. It remains in the bucket, never decays, and cannot be spent by a party. Party percentages are proportional shares of the Unaffiliated stake plus every party's accumulated units. Adding a unit slightly dilutes every other share without removing any of their units.

The units are durable investment history. A new party still gains one unit per click, but it cannot erase an established party's long lead with only a few clicks.

Each party-state combination has its own tracked org score.

## Building org

Organization grows through the **Build Org** action on the state-party page. The state chair, state vice chair, the state campaigner, the national chair, the national vice chair, or any national campaigner can click Build Org. Every successful click adds exactly one unit and keeps that party active in the state.

Every click costs **both Political Strength and money**. The two are billed to the same tier: a state officer spends the state party's PS and the state party's treasury, while a national officer spends the national pool and the national treasury. Building from the national pool costs **twice** the money of building from a state pool, so an officer who holds both a national and a state post is choosing between two different prices; each button shows its own. The cash price also scales with the PS cost, so a state where your pressure ladder has climbed costs more money as well as more PS, and it scales with your country's own currency so the burden is comparable everywhere.

**Bigger states cost more to organize.** A point of Org is a share of the state it sits in, so a point in a large state carries far more weight at election time than the same point in a small one. The price follows: organizing the largest states runs up to twice the national average, the smallest as little as half, on a curve that follows the square root of population rather than population itself. That deliberately keeps the gap narrower than the raw difference in size, so a small state is a bargain but never free. Because most parties concentrate their effort in the states that decide elections, expect this to raise your organizing bill overall rather than simply move it around: you are paying more where a point of Org is worth more. Building out into smaller states is now correspondingly cheaper if you want the reach. The projection panel names the multiplier where it applies.

The unit contribution never changes with your current Org, rival PS, or how full the state is. The visible percentage change can become smaller as the bucket grows because one unit is a smaller fraction of a larger accumulated total.

Build Org requires **presence**: the party must have at least one player character or elected official in this state (or be acted on by a national officer who can build org into vacant states).

### When the treasury is short

A thin treasury can still part-fund organizing. Once the treasury covers the minimum quarter-price floor, a successful click deposits the same one unit as any other successful click and takes the available money. Below that floor the click is refused outright, and a refused click is free, costing no Political Strength and adding nothing to the pressure ladder. The projection panel shows the price before you click and warns when a click would only be partly funded.

## Org decay

Organization can decay if the party becomes inactive in that state or region. Continuing to invest through Build Org keeps the party's organization active, while returning parties can resume building from the units they retain.

## Competing with established parties

Build Org has no target picker and does not directly remove a rival's units. Competition happens through bucket ownership. Your new unit increases your balance and the larger denominator proportionally lowers the displayed shares of every other party and Unaffiliated. Equal party unit balances receive equal shares, regardless of Political Strength reserves.

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
