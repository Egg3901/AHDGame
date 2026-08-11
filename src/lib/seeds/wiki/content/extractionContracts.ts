export const extractionContractsContent = `# Extraction Contracts

An extraction contract grants a named corporation an exclusive share of a state's resource capacity for a specific resource, in exchange for a signing fee and an ongoing royalty. Contracts are the primary tool governments use to direct natural resource extraction, and they have direct consequences for commodity supply, prices, and who benefits from a state's sovereign wealth.

## What a contract does

A contract reserves a fraction (its **share**) of a state's total extraction capacity for one corporation. That corporation's extraction sectors in that state are guaranteed access to their allocated portion and cannot be squeezed out by competing sectors.

For example: if Texas has 450,000 bbl/turn of oil capacity and a contract grants 50% (0.5 share) to Lone Star Energy Corp, that corporation can extract up to 225,000 bbl/turn regardless of how many other extraction sectors are operating in Texas.

The remaining share is the **open-access pool**, available to all uncontracted extraction sectors in the state, allocated proportionally if demand exceeds the pool.

## Contract fields

Each contract records:

| Field | Description |
| --- | --- |
| State | Which state the contract covers |
| Resource | One specific extractable resource (oil, coal, iron, etc.) |
| Share | Fraction of state capacity reserved (0.01 to 0.75 for new contracts) |
| Corporation | The corporation granted exclusive access |
| Status | offered, active, declined, expired, or defaulted |
| Signing fee | One-time payment the corporation pays on acceptance |
| Royalty rate | Percent of contracted output's market value paid every turn (0 to 2%) |
| Term | How many turns the contract runs before it expires |
| Granted by | Which government issued the contract, and at what level |

A contract covers exactly one state and one resource. A corporation operating in multiple states, or extracting multiple resources, needs a separate contract for each combination.

## Two ways a contract gets made

**Player-issued offers** are how contracts normally come about. A qualifying government official proposes a contract to a specific corporation. The corporation's CEO then decides whether to accept it. This is the flow described in the rest of this page.

**Admin grants** are an administrative tool that inserts a contract directly as active, bypassing the offer step. Admin grants can push a state's total contracted share past 100%, collapsing the open-access pool to zero for that resource. This is a deliberate escape hatch for setup and correction, not something regular players can do.

## Who can issue a player offer

Contract authority is set by a country's **Resource Extraction Authority Act**. Depending on which option is enacted:

- **Federal licensing** (the default when no such law has been passed): only national officials can issue offers.
- **Concurrent licensing**: both national and state officials can issue offers.
- **State licensing**: only that state's governor can issue offers.

At the national level, the country's executive (president, prime minister, or equivalent) or its finance minister can issue an offer. At the state level, that state's governor issues offers for their own state.

## The offer-to-contract lifecycle

1. **Issue.** A qualifying official picks a state, a resource, and a corporation with an extraction sector already operating there, then sets the share, royalty rate, term, and signing fee. The offer is created with status "offered" and expires automatically in 24 turns if nobody responds.
2. **Accept.** The corporation's CEO reviews the offer, including the exact signing fee and royalty terms, and accepts it. The signing fee is charged immediately and the contract becomes "active" with an expiration turn set from its term.
3. **Decline.** The CEO can decline instead. The offer is marked "declined" and never allocates capacity.

An offered contract does not reserve capacity and does not appear in the state's contracted-share numbers until it is accepted.

## Signing fee, royalty, and term

- **Signing fee**: a one-time payment, charged to the corporation the moment it accepts. This goes to the issuing government (the national treasury, or the state budget for a state-issued contract).
- **Royalty rate**: a percentage (0 to 2%) of the contracted capacity's market value, charged to the corporation every turn for as long as the contract is active. Royalties are calculated from the current commodity price, so royalty income rises and falls with the market.
- **Term**: how long the contract runs (24 to 480 turns for new contracts). When the term runs out, the contract expires automatically and the capacity returns to the open-access pool.

## Missed payments and default

If a corporation cannot afford a royalty payment, it is recorded as a missed payment and the corporation is notified. After three missed payments in a row, the contract defaults: it is revoked immediately, the corporation loses its guaranteed share, and both sides are notified. Keeping enough liquid capital to cover royalty obligations is part of holding an extraction contract.

## The 75% cap

New player-issued offers cannot push a state's total contracted share (summing every offered and active contract for that resource, from any issuer) past 75%. If an offer would exceed the cap, it is rejected and the interface shows how much headroom remains. This guarantees at least a quarter of every resource's capacity stays open-access, no matter how aggressively a government issues contracts.

This cap does not apply to admin grants, which can still push a state past 100% as an administrative override.

## Revoking a contract

An issuing government can revoke a contract it issued (or an offer it made). Contracts are revoked by setting a timestamp rather than deleting the record, preserving the history. A revoked, expired, declined, or defaulted contract stops allocating capacity starting the following turn, and the corporation's extraction sectors fall back into the open-access pool.

## Turn processing

Two turn phases keep contracts and capacity in sync:

1. **Commodity prices** (each turn): active contracts are summed per state and resource. If total contracted share reaches 75% (or more, for a state with an admin-granted over-allocation), the open-access pool shrinks or collapses accordingly. Extraction sectors are capped to their contract's share, or share the remaining open-access pool proportionally.
2. **Contract settlement** (after commodity prices, so current prices are available): every active contract with a royalty owes a payment based on that turn's price. Payments are collected, missed payments are tracked toward default, offers past their 24-turn window expire, and contracts past their term expire.

## Viewing contracts

| Location | What you see |
| --- | --- |
| State Resources tab | Capacity, contract headroom under the 75% cap, and contracts for that state |
| Corporation page Contracts tab | Pending offers to respond to and this corporation's active contracts |
| Congress Contracts tab | Contracts across the country, pending national offers, and the Issue Contract action |
| Country map (Resources mode) | Choropleth showing capacity and allocation per state |

## Strategic implications

**For governments:** Issuing a contract locks in a signing fee up front and a royalty stream for as long as the contract runs, at the cost of guaranteeing a competitor-proof share to one corporation. The 75% cap means a government can't fully corner a resource through offers alone, unlike the old admin-grant path.

**For corporations:** Accepting an extraction contract trades a signing fee and ongoing royalty payments for guaranteed, competition-proof output. It's most valuable in contested states where open-access output would otherwise get squeezed. Falling behind on royalty payments risks losing the contract entirely through default.

**For the commodity market:** Heavy contracting in a major producing state reduces the open-access pool, which affects how exposed uncontracted sectors are to squeeze effects. This ripples into every sector that uses those commodities as inputs.

See [Resources](/wiki/resources-overview) for which states hold which resources and how prospecting grows capacity, and [Corporations](/wiki/corporations) for how extraction sectors use resource capacity in their production calculations.
`;
