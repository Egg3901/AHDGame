export const unionsContent = `# Unions

The union system adds **sector unionization**, **standing labour premiums**, **strikes**, and (at full tier) **player-run unions** and **union-busting**. It builds on [Labour & Wages](/wiki/labour-and-wages): wage level, minimum-wage protection, and macro feedback must be live before union mechanics matter.

## Unionization

Each corporate sector carries a **unionization** score (0 to 100). It drifts toward a target each turn based on:

| Factor | Direction |
| --- | --- |
| Real wages below cost-of-living-adjusted expectations | ↑ pressure |
| High unemployment | ↓ pressure |
| Weak minimum-wage protection (low Kaitz ratio) | ↑ pressure |
| Pro-labour union law (country legislation) | ↑ pressure |
| Player-run union recruitment in that sector | ↑ pressure |

At **unions** tier, high unionization adds a **standing premium** to labour cost: a persistent surcharge, not a temporary event.

## Strikes

When unionization is high **and** real wages lag a slow-moving **worker expectation index** by enough, a sector can enter a **strike** (bounded-duration event):

- **Revenue throttle**: active strikes cut sector revenue (~25%).
- **Margin penalty**: additional profit-margin hit while the strike runs.
- **Resolution paths:**
  - **Concession**: CEO raises wage level until the expectation gap closes; strike ends, cooldown begins.
  - **Wait it out**: strike expires after a fixed duration; unionization bumps up ("radicalization").
  - **Union-busting** (full tier): CEO action to break the strike; see sector union-busting controls.

A **cooldown** after every strike prevents immediate re-trigger. Trigger and concession thresholds are separated (hysteresis) so wages cannot be oscillated to game the system.

## Union law

At **full** tier, countries can enact **union-law** legislation on a right-to-work ↔ collective-bargaining axis. The active option biases:

- Unionization drift targets
- Strike trigger thresholds (easier or harder to walk out)

Union law gives governments a political lever independent of corporate wage sliders.

## Player-run unions

At **full** tier, players can found and operate **unions** covering a country + sector type. Owned unions contribute **membership pressure** to unionization drift in matching sectors: organizing becomes a gameplay loop parallel to running a corporation.

Union pages live under \`/unions\` when the feature is enabled for your world.

Three mechanics give the membership a direct role: rank-and-file organizing, weighted leadership votes, and ratification ballots on every settlement.

### Rank-and-file organizing

Any character in the union's country can run an **organize drive** on any of that country's unions, led or not. It is the one union action that is not reserved for the president. A drive costs **5 action points**, not cash, so participation tracks turning up rather than net worth (a suspended or outlawed union cannot be organized).

Each drive adds **10 strength** to two places at once:

- The **union's pool**, which feeds its organizing score, dues income, unionization drift and strike capacity.
- Your own **banked strength** with that union, a personal, permanent record of the drives you ran.

The banked figure is your voice in everything below.

### Shop-floor organizing

The union president can organize a specific workplace from the union's Sectors tab (or from that sector's own page). A drive costs **1 action point** and a treasury spend, and raises that shop's unionization by **5% times the union's approval**. A well-liked union organizes faster. If another union already holds the shop, the same button is a raid.

### Weighted leadership votes

Organizers contest the presidency the same way shareholders contest a CEO seat: continuously, weighted by **banked organizing strength**, not one per head. Someone who ran fifty drives outvotes someone who ran one. Once the union reaches the strength threshold, the race stays open whether or not a president already sits — including against an NPP holder. The plurality leader is offered the seat and must accept; a tie keeps the sitting player president. Leadership follows organizing effort: the way to control a union is to build it.

### Ratification ballots

A settlement no longer takes effect on the president's signature. When the president moves to accept an employer's offer, the offer goes to a **ratification vote** of the members instead. Every organizer holding banked strength when the vote opens gets a ballot, weighted by that strength; the weights are frozen at open, so organizing during the vote buys you nothing until the next one. If nobody holds any strength, there is no electorate to ask and the president settles directly, as before.

The vote runs for **3 turns**, and the campaign clocks keep running underneath it: a president cannot park a campaign in a ballot to dodge the deadline. It closes early the moment one side holds a majority of **all** snapshot strength, since the result can no longer change. At the deadline, ratify wins on a tie, and silence counts for the settlement: an unanswered ballot leaves the president's acceptance standing, so an inactive membership cannot veto every deal by apathy. You can change your vote while the ballot is open.

**Ratified**: the collective agreement takes force exactly as a signed settlement always did, on the terms the members were shown.

**Rejected**: the employer's offer stays on the table and nothing else changes. The bargaining deadline still runs the campaign into dispute and the dispute still lapses, so a membership that rejects everything ends the campaign by the existing exits rather than freezing it. The president cannot simply re-table the identical offer to the same electorate; the way back to a vote is to move the package with a counteroffer.

## Union-busting

CEOs (full tier) can attempt **union-busting** on a striking or highly unionized sector. Success reduces unionization; failure can backfire. Costs and cooldowns apply: it is a high-risk management tool, not a free reset.

## Pension schemes

The state pension is a budget line: the social-insurance law sets what the country pays out of tax, and every worker gets it. A union pension scheme is different: a fund holding real assets, won as a term of a collective agreement.

**How one starts.** A union bargains a pension contribution as a term of a collective agreement, alongside the wage floor and the labour peace. The contribution is a percentage of the wage bill of the workplaces the agreement covers, up to 15%. Settle an agreement carrying a contribution and the scheme exists from that turn.

**Where the money comes from.** The employer, out of its own cash, every turn the agreement runs. Nothing is created for the scheme: if the employer cannot pay, nothing arrives.

**What the scheme owes.** Every turn covered workers are covered, they accrue a claim on the scheme. That is the number the assets are measured against, and the ratio between the two is the funding level. A scheme funded below the rate at which claims accrue falls further behind every turn, no matter how long it runs, so the contribution rate a union settles for is a real choice with a visible consequence.

**When it falls short.** Below 90% funded, the employer is asked for a top-up every turn, sized to a fraction of the shortfall rather than the whole of it. A deficit closes over game-years, not in one payment, because a top-up big enough to close it at once would break the employer instead.

**What an employer that cannot pay does not get.** Forgiveness. A missed contribution does not cancel the claim: the promise stands and the assets simply do not arrive, which is exactly how a scheme ends up underfunded.

**Who gets paid.** Members retire, and a retired member draws a pension from the scheme every turn. Benefits come out of the scheme's own cash and nowhere else. Paying a pension also discharges the claim behind it, so a scheme that pays its way improves its funding level as it goes.

**When the money is not there.** Pensions are cut, and every pensioner takes the same proportional cut. The scheme does not overdraw and it does not invent the difference. The unpaid part is not written off either: the claim stays on the books, the scheme still reads as underfunded, and the employer is still asked for a top-up next turn. This is the consequence the funding ratio has been warning about the whole time.

**Where the assets sit.** A scheme invests its spare cash in the broad index fund for its country, or the global broad index if its country has none. Not a sector fund: a pension whose assets collapse in the same turn its employer does is not a pension. The scheme keeps a cash buffer back first, enough for several turns of benefits, so investing can never itself be the reason a pension is cut.

**How investing shows up in the funding level.** The scheme's assets are its cash PLUS the current value of the fund units it holds, marked at today's quoted price. Moving cash into a fund does not change the funding ratio at all. A fund that rises does raise it, and lets the employer off a top-up; a fund that falls lowers it, and costs the employer more. That is the trade a funded scheme makes.

**With index funds switched off.** Schemes simply hold cash. Contributions, claims, benefits, cuts and top-ups all work exactly as described above.

## Phased rollout

| Tier | Unions content |
| --- | --- |
| **unions** | NPC unionization drift, standing premium, strikes |
| **full** | Union-law bias, union-busting, player-run unions |

Admins enable tiers via \`labourSystemMode\`; a world can run wages and macro without strikes until the next tier is flipped.

## Related

- [Labour & Wages](/wiki/labour-and-wages): wage slider, minimum wage, macro links
- [Corporations](/wiki/corporations): sector labour costs and CEO tools
- [Bills & Legislation](/wiki/bills-legislation): union-law provisions
- [National Metrics](/wiki/national-metrics): unemployment and median income context
`;
