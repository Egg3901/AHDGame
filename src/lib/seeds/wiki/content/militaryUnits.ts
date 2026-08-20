export const militaryUnitsContent = `# Units, Recruitment & Procurement

Your army is a list of **formations**. Each one is a real object with a headcount, a technology level, a veterancy grade, a posture, and (once you have generals) a commander. This page covers how you get them, what they cost, and how you improve them.

Everything here is done by the **defence seat holder** from their cabinet office → **Military** tab.

## Domains and branches

Units belong to one of six **domains**, and every domain is fielded through a **branch**: your country's actual named service.

| Domain | What it fields |
| --- | --- |
| **Ground** | Armour, mechanised, infantry, artillery, special forces, air defence |
| **Naval** | Carriers, destroyers, submarines, frigates, amphibious groups |
| **Air** | Fighters, bombers, airlift, air defence, drones |
| **Marine** | Expeditionary units, marine divisions, littoral teams |
| **Rocket** | Ballistic and cruise missile formations, strategic deterrent |
| **Space** | Orbital surveillance, launch operations, space defence |

Branches are historically named and **era-gated**. Recruiting is not a flat catalogue: you get what your country actually had, in the year it actually had it.

Some consequences worth knowing before you plan a build:

- **West Germany has no armed forces in 1953.** The Bundeswehr's first volunteers are sworn in 1955. A 1953 world seeds DE with zero branches: this is correct, not a bug.
- **East Germany's NVA stands up in 1956.** DD also has no defence cabinet seat until then.
- **Japan in 1953** fields the National Safety Force and Coastal Safety Force. These *dissolve* in 1954 and become the JGSDF/JMSDF/JASDF.
- **The US Air Force** exists from 1947; the **Space Force** from 2019.
- **The PLA Rocket Force** dates from 1966 (as the Second Artillery Corps).
- **Soviet Strategic Rocket Forces** from 1959; Space Forces from 1992.

Unit *types* are gated the same way. **Drone Commands** require 1995. **Every space archetype** requires 2019. You cannot invent a Predator in a Cold War game.

## The unit catalogue

Costs below are **catalogue values**, not what you pay: see pricing below. \`Establishment\` is the unit's full-strength headcount, which is also the manpower it costs to raise.

### Ground

| Type | Establishment | Cost | Upkeep |
| --- | --- | --- | --- |
| Armored Division | 15,000 | 4,200 | 180 |
| Infantry Division | 12,000 | 1,600 | 70 |
| Mechanized Brigade | 4,500 | 2,100 | 95 |
| Artillery Regiment | 3,000 | 1,300 | 55 |
| Special Forces Group | 1,400 | 2,400 | 120 |
| Air Defense Battalion | 900 | 1,900 | 88 |

### Naval

| Type | Establishment | Cost | Upkeep |
| --- | --- | --- | --- |
| Carrier Strike Group | 7,500 | 13,800 | 620 |
| Amphibious Group | 2,800 | 4,100 | 190 |
| Attack Submarine | 130 | 3,400 | 150 |
| Guided-Missile Destroyer | 330 | 2,200 | 110 |
| Frigate Squadron | 600 | 1,700 | 80 |

### Air

| Type | Establishment | Cost | Upkeep | Era |
| --- | --- | --- | --- | --- |
| Fighter Wing | 1,800 | 5,600 | 250 | None |
| Bomber Squadron | 900 | 4,800 | 220 | None |
| Air Defense Wing | 1,100 | 2,600 | 115 | None |
| Airlift Wing | 1,500 | 2,300 | 100 | None |
| Drone Command | 600 | 1,900 | 70 | 1995+ |

### Marine

| Type | Establishment | Cost | Upkeep |
| --- | --- | --- | --- |
| Marine Division | 18,000 | 4,600 | 210 |
| Marine Expeditionary Unit | 2,200 | 3,200 | 150 |
| Littoral Combat Team | 1,100 | 1,800 | 85 |

### Rocket

| Type | Establishment | Cost | Upkeep |
| --- | --- | --- | --- |
| Strategic Deterrent Force | 2,000 | 9,800 | 410 |
| Ballistic Missile Brigade | 1,200 | 6,200 | 240 |
| Cruise Missile Regiment | 800 | 3,100 | 130 |

### Space (2019+)

| Type | Establishment | Cost | Upkeep |
| --- | --- | --- | --- |
| Space Defense Squadron | 900 | 4,400 | 190 |
| Orbital Surveillance Delta | 700 | 3,800 | 160 |
| Launch Operations Delta | 500 | 2,900 | 120 |

Read those tables in pairs. A **Special Forces Group** is a formidable unit for 1,400 people; an **Infantry Division** is a modest one for 12,000. If manpower is your binding constraint, the small elite formations are efficient. If money is, infantry is by far the cheapest power you can buy.

## What a unit actually costs you

A unit costs **three separate resources**, and you must have all three.

### 1. A ministerial action

Recruiting costs **one ministerial action**. Your cabinet seat holds up to **4 ministerial actions**, and they refill to that cap **once per real day**, at midnight Eastern, not per turn.

That is the real throttle on how fast an army can grow, and it is far tighter than money. **You can raise at most four formations a day**, no matter how large your treasury or how deep your manpower pool. An army is built over real weeks.

Upgrading also costs one, so recruiting and modernising compete for the same daily budget. Setting a posture, assigning a unit to a general, and disbanding are all **free**.

### 2. Manpower

A new unit is raised at **full establishment**, so it draws its full headcount from your national manpower pool. An Armored Division costs 15,000 men whether or not you can afford it in cash.

**Manpower is the hard block.** If the pool is short, the order is refused outright with the exact numbers: there is no borrowing men. See [Manpower & Conscription](/wiki/manpower-conscription).

### 3. Treasury

Here is the part that trips people up: **the catalogue cost above is not a currency amount.**

A unit is priced as a **share of your country's own GDP**, then scaled by a per-country cost multiplier. An Infantry Division is the same fraction of national output in 1953 as in 2019 and in every country: roughly 0.4% of GDP before the country multiplier.

This is deliberate. Converting a fixed price through exchange rates fails three ways: the Eastern Bloc budget economies have no exchange rate at all, several countries hold USD-anchored GDP with local currency codes, and a converted price is still blind to whether the country can actually afford it. A share of GDP is denomination-agnostic and self-scaling.

The per-country cost multiplier:

| Multiplier | Countries |
| --- | --- |
| **2.6** | US |
| **2.4** | RU |
| **2.0** | CN |
| **1.7** | UK |
| **1.5** | FR |
| **1.4** | JP |
| **1.2** | IT, DD |
| **1.1** | SE, UKR |
| **1.0** | DE, IE, BR, PL, BLR, CS, BAL, ES, TR, SCO, WAL |
| **0.95** | YU |
| **0.9** | HU, RO, GR, FI |
| **0.85** | NG, BG, AT |

This is a **cost** multiplier, not a size multiplier. It does not make American divisions bigger; it makes them more expensive to buy and to keep. Army size comes from what you actually build.

**Spending past your surplus is not an error.** It becomes national debt. Nobody refuses to sell you an army because you are broke: the bill simply lands on the treasury and stays there.

## Building takes time

A newly recruited unit is **not immediately available**:

- Most units: **6 turns** to reach operational readiness.
- **Carrier Strike Groups: 10 turns.**

Until then it exists on your roster but is **excluded from battle entirely**: it does not fight and does not appear in forecasts. Six turns is six real hours. Plan your build-up before the war, not during it.

A fresh unit arrives at:

- **Standard** posture
- **Tech tier 1** (Standard)
- **Veterancy 1** (Regular)
- **70% readiness**
- Equipment level 1 across firepower, protection and support
- In **reserve**, with no general

## The four postures

Posture is a standing order for how hard a unit is being worked. It is **free** to change and takes effect immediately.

| Posture | Effect |
| --- | --- |
| **Garrison** | Cheapest to maintain, weakest in the field. Home-defence footing. |
| **Standard** | The baseline. |
| **Forward-Deployed** | Noticeably more capable, noticeably more expensive. |
| **High Alert** | The most capable and by far the most expensive. |

Two rules:

1. **A unit at a conflict cannot be on Garrison.** It floors up to Standard automatically. Garrison is a homeland posture only.
2. Posture forces **up** only. A unit returning to reserve keeps whatever posture it had: it does not drop back to Garrison on its own.

Posture is also visible nationally: a force sitting heavily on Forward/High Alert tilts public trust and social cohesion. A permanent war footing has a political price at home.

There is a separate **national force tier** (reduced / standard / elevated) set on the defence office Overview, which multiplies readiness and upkeep across your whole army at once.

## Technology tiers

Every unit sits at one of four tech tiers:

**Legacy → Standard → Modernized → Cutting-Edge**

Upgrading raises the tier by one step. It is not free, and it is not free *forever*:

- **You pay up front.** Priced through the same GDP-share model as building, at an escalating share of the unit's build cost, by the tier you are stepping *into*: **25%** to reach Standard, **35%** to reach Modernized, **50%** to reach Cutting-Edge. All three steps together come to about **1.1× a fresh build**, so modernising a formation from the bottom costs more than replacing it. Since new units arrive at Standard, a unit you build yourself faces the 35% and 50% steps.
- **You pay for it every turn afterwards.** Higher tiers cost materially more upkeep, and the upkeep curve is **steeper than the power curve**.

That second point is the whole design. A Cutting-Edge division is better than a Legacy one, and worse value than two Legacy ones. **Cheap old kit is a legitimate strategy** for a nation that needs mass rather than quality.

⚠️ Upkeep is derived on read, so a modernisation pass raises your *entire* running cost immediately, including on units you upgraded long ago. Check your defence envelope before a mass refit.

## Veterancy and strength

**Veterancy** runs from Green to Elite across five grades and is earned by fighting. Veterans are meaningfully better than green troops at the same headcount. The bonus is a grade table, not a compounding multiplier: preserving an experienced formation is still one of the highest-value things you can do.

**Strength** is current personnel divided by establishment, shown as a percentage on the unit card. A unit ground down in battle fights at reduced effect in proportion to its losses. **A division at 40% strength fights like a much smaller formation**: it is not a full-power unit with a cosmetic wound.

There is no "destroyed" state and no automatic disbanding. A mauled formation stays on the roster, keeps its general and its position, and rebuilds in place through reinforcement.

## Upkeep and the defence envelope

Every unit costs upkeep every turn, driven by its base cost, its posture, its tech tier, your national force tier, and your country's cost multiplier.

Your total upkeep is measured against a **defence discretionary envelope** derived from your appropriation. Coming in under it helps your budget balance; blowing through it hurts. Note that military upkeep is **not** a plain treasury spend: it pushes budget balance down while pushing your defence-industry metric up, so it is partly self-offsetting.

## Disbanding

Disbanding is **free** and instant. The unit's surviving personnel go back into the national manpower pool.

**There is no cash refund.** The purchase price is gone. That unrefunded cost is what keeps unit churn expensive and stops you from cycling formations to farm anything.

## Defence procurement contracts

The defence seat can award contracts to eligible domestic defence sectors from the cabinet office's **Military → Arsenal** area. A contract supplies the national arsenal over time; recruiting and upgrading draw equipment from that stock.

Signing a contract immediately reserves its full price against the defence appropriation. The server refuses an order that exceeds the **uncommitted** balance. Deliveries draw down that reservation, and cancelling, declining, or completing the contract releases whatever remains. Recruiting and upgrading also use the uncommitted balance, so they cannot spend money already promised to a supplier.

The minister chooses:

- **Lots ordered**
- **Price per lot**, inside the server-calculated floor and ceiling
- **Equipment grade**, from cheap mass production to premium equipment

The floor follows the supplier's current commodity and overhead costs. If input prices rise after signing, the contract can become unprofitable. A supplier with enough cash delivers at a loss; one that cannot fund the loss stalls and reports why.

The contractor assigns up to four production lines from each plant across its orders. More lines increase delivery speed without changing the agreed price per lot. A plant cannot assign the same line to two contracts.

Both the minister's and contractor's order books show lots ordered, built, carried, delivered, paid, and still committed. A stalled order names the reason. Awards to a corporation the minister owns or materially holds are marked on the contract, reported on the public wire, and reduce the minister's standing.

An admin may pause **new** defence procurement in an emergency. Existing contracts continue to deliver and may still be cancelled or declined.

## A sensible build order

1. **Check your era.** Open the recruit panel and see which branches and types actually exist this year.
2. **Check manpower before money.** Manpower refuses you outright; treasury just goes into debt.
3. **Build infantry for mass, specialists for edge.** Cheap divisions are the efficient way to hold ground; special forces and armour are how you break it.
4. **Build early, and build daily.** Four ministerial actions a day plus six turns of build time means a serious army takes real weeks. The force that fights your war is the one you started long before it.
5. **Modernise selectively.** Upgrade the formations you intend to keep and fight with. Upgrading everything triples your running costs for a modest capability gain.
6. **Leave postures low in peacetime.** High Alert on a peacetime army burns money and erodes cohesion at home for nothing.

## Next

- [Manpower & Conscription](/wiki/manpower-conscription): where the men come from.
- [Generals & the Officer Corps](/wiki/generals): how to get a commander for these units.
- [Fighting a Battle](/wiki/fighting-a-battle): how to actually use them.
`;
