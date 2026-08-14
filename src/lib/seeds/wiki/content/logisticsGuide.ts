import {
  BUYER_TOLERANCE_SLACK,
  FREIGHT_CLASS_CAPACITY_SHARE,
  FREIGHT_TEU_PER_UNIT_HOP,
  SEA_FREIGHT_HOP_EQUIV,
} from "@/lib/logistics/sourcing";

const pct = (value: number) => `${Math.round(value * 100)}%`;

export const logisticsGuideContent = `# Logistics: Freight, Sourcing, and Supply Chains

Logistics connects the commodity market to the map. The game projects how a state with unmet input demand would source locally, across state lines, or from abroad after shipping and tariffs. Logistics sectors provide the freight capacity measured by that projection. Heavy haul becomes real Freight commodity demand, so tight capacity raises freight sold volume and price.

The distinction matters: the haul calculation currently drives the Freight market and the Logistics map. It does not yet replace aggregate commodity clearing with per-route settlement or send a separate shipping payment from each buyer to a logistics corporation.

## The short version

For a corporation, logistics answers three questions:

1. **Can the market supply the input locally?** Projected local supply fills first and uses no freight capacity.
2. **If not, where is the cheapest reachable seller?** The sourcing projection compares the seller's ask, shipping cost, and tariff.
3. **Can the route carry it?** Projected interstate haul consumes freight capacity in the seller's state. Capacity and price tolerance determine the haul load shown on the map.

For a logistics corporation, the practical loop is simpler: open logistics sectors where the map shows heavy haul load or weak freight capacity, then watch the Freight commodity page to see whether the market is short or oversupplied.

## Read the Freight commodity page first

The Freight & Transportation page shows the global or exchange-level price, supply, demand, cleared volume, unmet demand, and unsold capacity. The unit is **TEU**, a container-equivalent measure of transport capacity.

![The Freight and Transportation commodity page showing price, supply, demand, market flows, and price history](/static/wiki/player-guides/freight-market.png)

Use the page like this:

- **Demand above supply:** freight is scarce. Logistics sectors have room to sell more capacity, and shipping becomes more expensive for commodity buyers.
- **Supply above demand:** some freight capacity is going unsold. Expanding now risks low fill and weak margins.
- **Price above base:** the shortage has persisted long enough to lift the market price.
- **Cleared volume:** the amount of freight capacity the market actually used this turn.

Freight is itself a commodity. A logistics sector earns through the freight market just as an energy sector earns through electricity. Interstate haul is booked as demand for that commodity every market turn.

## Read the Logistics map second

Open a country's map and select **Logistics**. Green intensity follows the freight capacity available in each state. Hover a state to see:

- freight capacity in TEU;
- interstate haul per turn;
- utilization;
- the split between bulk and special freight.

![The United States map in Logistics mode, with freight capacity highlighted by state](/static/wiki/player-guides/logistics-map.png)

The map and commodity page answer different questions. The commodity page tells you whether freight is scarce overall. The map tells you where the network exists and where domestic haul is loading it.

## How sourcing chooses a route

For the haul projection, each state with unmet demand ranks eligible sellers by **landed price**:

\`landed price = seller ask + shipping + tariff\`

The cheapest eligible source fills first, up to four limits:

1. the buyer's remaining demand;
2. the seller's spare supply;
3. the freight capacity available for that class;
4. the buyer's price tolerance.

The tolerance ceiling is the local price plus ${pct(BUYER_TOLERANCE_SLACK)}. A technically reachable projected shipment can still be rejected when freight and tariffs make it too expensive. The sourcing report records that amount as unmet, while aggregate commodity clearing remains the source of truth for the commodity market itself.

Imports use a flat ${SEA_FREIGHT_HOP_EQUIV}-hop sea equivalent for landed-price comparison. Domestic states with no modeled route use the same fallback. Embargoes remove a route entirely; tariffs leave it open but make it more expensive.

## Bulk and special freight

The network divides state freight capacity into two classes:

| Class | Share of state freight capacity | TEU per commodity unit per hop | Typical cargo |
| --- | ---: | ---: | --- |
| Bulk | ${pct(FREIGHT_CLASS_CAPACITY_SHARE.bulk)} | ${FREIGHT_TEU_PER_UNIT_HOP.bulk} | Heavy raw materials and ordinary physical goods |
| Special | ${pct(FREIGHT_CLASS_CAPACITY_SHARE.special)} | ${FREIGHT_TEU_PER_UNIT_HOP.special} | Higher-care or specialized cargo |

Special freight consumes more TEU per unit per hop. A state can therefore have spare bulk capacity while its special network is tight. The map tooltip exposes both loads.

## What a logistics CEO should do

### Before opening a sector

1. Open the Freight commodity page and check the exchange where you plan to operate.
2. Open the country map in Logistics mode.
3. Look for a state with low capacity, meaningful haul, and an undersupplied freight market.
4. Check the target state's local business conditions and your corporation's type match.
5. Build only enough capacity to fit visible demand. Capacity arrives gradually and idle plants still cost money.

### After opening a sector

- Watch **selling %** on the sector page. Low selling means the market does not need all your output.
- Watch the Logistics map after each market turn. New industrial capacity can create new haul demand.
- Compare your freight price with the cost of inputs used by physical industries. A freight shortage can raise costs across manufacturing, agriculture, chemicals, extraction, and construction.
- Use a focused logistics strategy only when its output and input mix match the shortage you are trying to serve.

## Freight capacity and corporate logistics strength are different

These names are easy to confuse:

- **Freight capacity** is market output from logistics sectors. It moves goods between states and appears on the commodity page and Logistics map.
- **Corporate logistics strength** is an internal corporation stat built by the CEO's logistics budget. It reduces the sprawl penalty from operating many sectors.

Spending on corporate logistics strength does not create TEU. Opening and operating a logistics sector does.

## Common mistakes

**Building where the map is dark without checking demand.** A dark state may have no freight network because it has little industry and little haul. Check the commodity balance too.

**Treating global freight shortage as proof every state is profitable.** Sector economics are still local, national, and global. Check the exchange and state before building.

**Assuming imports use domestic freight capacity.** Overseas supply affects landed price through the sea-hop cost and tariffs, but it does not consume an origin state's domestic freight pool.

**Reading projected routes as settled commodity transfers.** The route calculation measures haul and creates Freight demand. Aggregate commodity clearing still determines commodity supply, demand, and margin effects.

**Expecting a separate shipping-fee transaction.** Logistics corporations earn through freight commodity sales. Haul raises freight demand and therefore sold volume and price; the UI does not book a separate player-to-player shipping invoice for each route.

## Related

- [Commodities](/wiki/commodities): supply, demand, clearing, and prices.
- [Running a Corporation under the Plants System](/wiki/plants-corp-guide): capacity, fill, build queues, and break-even.
- [Supply Agreements](/wiki/supply-agreements): contracted supply before open-market clearing.
- [Tariffs](/wiki/tariffs): how trade barriers change landed cost and margins.
- [International Trade](/wiki/trade-system): cross-border clearing, embargoes, and trade balances.
`;
